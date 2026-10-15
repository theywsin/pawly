/**
 * Process entry (docs/03 §5 "graceful reload"):
 *   serve         cluster primary: forks API workers, performs rolling restarts on reload requests
 *   migrate       core migrations, trusted keys from MODULE_TRUSTED_KEYS, preinstalled module packages
 *   create-admin  creates a platform admin (password from ADMIN_PASSWORD; TOTP enrolment at first login)
 */
import 'reflect-metadata';
import cluster, { type Worker } from 'node:cluster';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { CORE_VERSION, loadConfig } from './config.js';
import { createApp } from './app/app.factory.js';
import { RELOAD_CHANNEL, Services } from './app/services.js';
import { migrateCore } from './core/migrations/runner.js';
import { logger } from './infra/logger.js';
import { apiRoot } from './infra/paths.js';
import { createRedis } from './infra/redis.js';
import { keyIdOf } from '@mohandesyar/module-package';
import { sql } from 'drizzle-orm';

async function serveWorker(): Promise<void> {
  const config = loadConfig();
  const services = new Services(config);
  const app = await createApp(services);
  services.events.start();
  services.scheduler.start();
  await app.listen(config.PORT, config.HOST);
  logger.info({ pid: process.pid, modules: [...services.registry.loaded.keys()], loadErrors: Object.fromEntries(services.registry.loadErrors) }, 'worker ready');
  process.send?.({ type: 'ready' });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    logger.info({ pid: process.pid }, 'worker draining');
    const timer = setTimeout(() => process.exit(0), 30_000);
    timer.unref();
    await services.scheduler.stop().catch(() => undefined);
    await app.close().catch(() => undefined);
    // This instance stops reporting; remove its rows so the console shows only live instances.
    await services.db.app.execute(sql`DELETE FROM core_module_runtime_status WHERE instance_id = ${services.instanceId}`).catch(() => undefined);
    await services.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('message', (m: { type?: string }) => m?.type === 'shutdown' && void shutdown());
}

function forkWorker(): Promise<Worker> {
  return new Promise((resolve, reject) => {
    const w = cluster.fork();
    const timer = setTimeout(() => reject(new Error('worker did not become ready in 60s')), 60_000);
    w.on('message', (m: { type?: string }) => {
      if (m?.type === 'ready') {
        clearTimeout(timer);
        resolve(w);
      }
    });
    w.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`worker exited during start (code ${code})`));
    });
  });
}

/**
 * Primary process: holds no application state. On a reload request (published after a module
 * install/upgrade/rollback/uninstall) it replaces workers one at a time — a new worker is started and
 * ready before the old one drains — so requests keep being served throughout.
 */
async function servePrimary(): Promise<void> {
  const config = loadConfig();
  let workers: Worker[] = [];
  for (let i = 0; i < config.API_WORKERS; i++) workers.push(await forkWorker());
  logger.info({ workers: workers.length }, 'api started');
  let reloading: Promise<void> | null = null;
  let again = false;
  const rolling = async () => {
    const next: typeof workers = [];
    for (const old of workers) {
      next.push(await forkWorker());
      old.send({ type: 'shutdown' });
    }
    workers = next;
    logger.info({ workers: workers.length }, 'rolling reload complete');
  };
  const reload = () => {
    if (reloading) {
      again = true;
      return;
    }
    reloading = rolling()
      .catch((err) => logger.error({ err }, 'reload failed; previous workers keep serving'))
      .finally(() => {
        reloading = null;
        if (again) {
          again = false;
          reload();
        }
      });
  };
  const sub = createRedis(config.REDIS_URL);
  await sub.subscribe(RELOAD_CHANNEL);
  sub.on('message', (_c, msg) => {
    logger.info({ msg }, 'reload requested');
    reload();
  });
  cluster.on('exit', (w, code) => {
    if (workers.includes(w) && !reloading) {
      logger.error({ pid: w.process.pid, code }, 'worker died; replacing');
      workers = workers.filter((x) => x !== w);
      void forkWorker().then((nw) => workers.push(nw));
    }
  });
  const stop = () => {
    for (const w of workers) w.send({ type: 'shutdown' });
    sub.disconnect();
    setTimeout(() => process.exit(0), 31_000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

async function migrate(): Promise<void> {
  const config = loadConfig();
  const services = new Services(config);
  try {
    const done = await migrateCore(services.db.migratorPool, join(apiRoot(), 'migrations', 'core'), CORE_VERSION, (l) => logger.info(l));
    logger.info({ applied: done }, 'core migrations done');
    for (const path of config.MODULE_TRUSTED_KEYS.split(',').map((x) => x.trim()).filter(Boolean)) {
      const pem = await readFile(path, 'utf8');
      await services.lifecycle.addTrustedKey(pem, `bootstrap:${keyIdOf(pem)}`, { type: 'system', id: null });
      logger.info({ keyId: keyIdOf(pem) }, 'trusted key registered');
    }
    if (config.PREINSTALLED_MODULES_DIR) {
      await services.lifecycle.bootstrapPreinstalled(config.PREINSTALLED_MODULES_DIR, { type: 'system', id: null }, (l) => logger.info(l));
    }
  } finally {
    await services.close();
  }
}

async function createAdmin(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { email: { type: 'string' }, name: { type: 'string' }, roles: { type: 'string', default: 'super_admin,tech_admin' } } });
  const password = process.env.ADMIN_PASSWORD;
  if (!values.email || !values.name || !password) throw new Error('usage: ADMIN_PASSWORD=... main create-admin --email <e> --name <n> [--roles super_admin,tech_admin]');
  const services = new Services(loadConfig());
  try {
    const id = await services.auth.createAdmin({ email: values.email, fullName: values.name, password, roles: values.roles!.split(',') });
    logger.info({ id }, 'platform admin created; two-factor enrolment is required at first login');
  } finally {
    await services.close();
  }
}

const [cmd = 'serve', ...rest] = process.argv.slice(2);
const run = async () => {
  if (cmd === 'serve') return cluster.isPrimary ? servePrimary() : serveWorker();
  if (cmd === 'serve-single') return serveWorker();
  if (cmd === 'migrate') return migrate();
  if (cmd === 'create-admin') return createAdmin(rest);
  throw new Error(`unknown command ${cmd}`);
};
run().catch((err: unknown) => {
  logger.error({ err }, 'fatal');
  console.error(err);
  process.exit(1);
});
