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

  /** Adds a member to the caller's organisation with one role and returns their app token. */
  async member(ownerToken: string, roleKey: string, name = roleKey): Promise<{ token: string; userId: string }> {
    const email = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.ir`;
    const password = 'Passw0rd-strong';
    const add = await this.req('POST', '/api/core/members', { token: ownerToken, body: { email, fullName: `کاربر ${name}`, initialPassword: password, roleKey } });
    if (add.status >= 300) throw new Error(`add member failed: ${JSON.stringify(add.body)}`);
    const login = await this.req('POST', '/api/auth/login', { body: { email, password } });
    if (!login.body.accessToken) throw new Error(`login failed: ${JSON.stringify(login.body)}`);
    const me = await this.req('GET', '/api/core/me', { token: login.body.accessToken });
    return { token: login.body.accessToken, userId: me.body.user.id };
  }

  /**
   * Installs signed module packages through the console (trusting `publicKeyPem` first), reloads, and
   * enables the modules for the given tenants.
   */
  async installModules(admin: { token: string; otp: () => string }, publicKeyPem: string, pkgs: string[], tenantIds: string[]): Promise<void> {
    const { readFile } = await import('node:fs/promises');
    const keys = await this.req('POST', '/api/console/keys', { token: admin.token, body: { publicKeyPem, label: 'test key', otp: admin.otp() } });
    if (keys.status !== 201 && keys.status !== 409) throw new Error(`key: ${JSON.stringify(keys.body)}`);
    const ids: string[] = [];
    for (const pkg of pkgs) {
      const { payload, headers } = multipart(await readFile(pkg), 'm.mypkg');
      const up = await this.req('POST', '/api/console/modules/upload', { token: admin.token, payload, headers });
      if (!up.body.ok) throw new Error(`upload ${pkg}: ${JSON.stringify(up.body)}`);
      await this.services.redis.del(...(await this.services.redis.keys('rl:otpcheck:*')), 'none');
      const inst = await this.req('POST', '/api/console/modules/install', { token: admin.token, body: { uploadId: up.body.uploadId, otp: admin.otp(), enableGlobally: true } });
      if (inst.status !== 200) throw new Error(`install ${pkg}: ${JSON.stringify(inst.body)}`);
      ids.push(up.body.manifest?.id ?? inst.body.moduleId);
      await this.reload();
    }
    for (const id of [...this.services.registry.loaded.keys()]) {
      const r = await this.req('POST', `/api/console/modules/${id}/tenants`, { token: admin.token, body: { tenantIds, enabled: true } });
      if (!r.body.results?.every((x: { ok: boolean }) => x.ok)) throw new Error(`enable ${id}: ${JSON.stringify(r.body)}`);
    }
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

/** A 1×1 PNG for image uploads. */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/** Minimal multipart/form-data body with one file field. */
export function multipart(file: Buffer, filename: string, field = 'file', fields: Record<string, string> = {}): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----mohandesyar${Date.now()}`;
  const pre = Object.entries(fields).map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('');
  const head = Buffer.from(`${pre}--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, file, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
