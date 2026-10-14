import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../../src/app/app.factory.js';
import { Services } from '../../src/app/services.js';
import { loadConfig } from '../../src/config.js';
import { totp } from '../../src/core/auth/crypto.js';
import { createTestDatabase, type TestDatabase } from './db.js';

export const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:63799/1';
export const S3_ENDPOINT = process.env.TEST_S3_ENDPOINT ?? 'http://127.0.0.1:39000';

export interface Res {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  headers: Record<string, string | string[] | undefined>;
}

/**
 * A full API instance against a fresh database. `reload()` simulates the graceful restart that follows
 * install/upgrade/uninstall in production: the HTTP app is rebuilt and modules are loaded again from the store.
 */
export class TestApp {
  app!: NestFastifyApplication;
  services!: Services;
  reloads: string[] = [];
  private constructor(
    readonly tdb: TestDatabase,
    readonly dirs: { root: string; store: string; uploads: string; backups: string },
    private readonly env: Record<string, string>,
  ) {}

  static async start(env: Record<string, string> = {}): Promise<TestApp> {
    const tdb = await createTestDatabase();
    const root = await mkdtemp(join(tmpdir(), 'my-api-'));
    const dirs = { root, store: join(root, 'store'), uploads: join(root, 'uploads'), backups: join(root, 'backups') };
    const t = new TestApp(tdb, dirs, env);
    await t.boot();
    await t.services.redis.flushdb();
    return t;
  }

  private config() {
    return loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: this.tdb.appUrl,
      DATABASE_MIGRATOR_URL: this.tdb.migratorUrl,
      REDIS_URL,
      S3_ENDPOINT,
      S3_ACCESS_KEY: 'test',
      S3_SECRET_KEY: 'test',
      S3_BUCKET: `b-${this.tdb.name.replace(/_/g, '-')}`,
      JWT_SECRET: 'test-secret-test-secret-test-secret-0123',
      APP_ENCRYPTION_KEY: 'ab'.repeat(32),
      MODULE_STORE_DIR: this.dirs.store,
      MODULE_UPLOAD_DIR: this.dirs.uploads,
      MODULE_BACKUP_DIR: this.dirs.backups,
      COOKIE_SECURE: 'false',
      ...this.env,
    } as NodeJS.ProcessEnv);
  }

  private async boot(): Promise<void> {
    this.services = new Services(this.config(), {
      requestReload: async (reason) => {
        this.reloads.push(reason);
      },
    });
    this.app = await createApp(this.services);
  }

  /** Equivalent of the rolling restart: new process state, modules re-imported from the store. */
  async reload(): Promise<void> {
    await this.app.close();
    await this.services.close();
    await this.boot();
  }

  async req(method: string, url: string, opts: { token?: string; body?: unknown; headers?: Record<string, string>; payload?: Buffer | string } = {}): Promise<Res> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    const r = await this.app.inject({
      method: method as 'GET',
      url,
      headers,
      ...(opts.payload !== undefined ? { payload: opts.payload } : opts.body !== undefined ? { payload: opts.body as object } : {}),
    });
    let body: unknown = r.body;
    try {
      body = JSON.parse(r.body);
    } catch {
      /* not json */
    }
    return { status: r.statusCode, body, headers: r.headers as Res['headers'] };
  }

  async stop(): Promise<void> {
    await this.app?.close();
    await this.services?.close();
    await this.tdb.drop();
    await rm(this.dirs.root, { recursive: true, force: true });
  }

  // ------------------------------------------------------------ helpers

  async signup(name: string): Promise<{ token: string; tenantId: string; email: string; password: string }> {
    const email = `${name}-${Date.now()}@example.ir`;
    const password = 'Passw0rd-strong';
    const r = await this.req('POST', '/api/auth/signup', { body: { fullName: `کاربر ${name}`, email, password, tenantName: `سازمان ${name}` } });
    if (r.status !== 201) throw new Error(`signup failed: ${JSON.stringify(r.body)}`);
    return { token: r.body.accessToken, tenantId: r.body.tenantId, email, password };
  }

  /** Creates a platform admin with TOTP enrolled and returns a console token. */
  async consoleAdmin(roles: string[] = ['tech_admin', 'super_admin']): Promise<{ token: string; otp: () => string }> {
    const email = `admin-${Date.now()}@platform.ir`;
    const password = 'Admin-Passw0rd';
    await this.services.auth.createAdmin({ email, fullName: 'مدیر فنی', password, roles });
    const login = await this.req('POST', '/api/console/auth/login', { body: { email, password } });
    if (!login.body.mfaEnrollmentRequired) throw new Error(`expected enrolment: ${JSON.stringify(login.body)}`);
    const start = await this.req('POST', '/api/console/auth/2fa/enroll/start', { body: { pendingToken: login.body.pendingToken } });
    const secret: string = start.body.secret;
    const confirm = await this.req('POST', '/api/console/auth/2fa/enroll/confirm', { body: { pendingToken: login.body.pendingToken, code: totp(secret) } });
    if (!confirm.body.accessToken) throw new Error(`enrolment failed: ${JSON.stringify(confirm.body)}`);
    return { token: confirm.body.accessToken, otp: () => totp(secret) };
  }
}
