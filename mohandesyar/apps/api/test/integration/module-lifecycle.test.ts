import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateSigningKey, type KeyPairPem } from '@mohandesyar/module-package';
import { multipart, TestApp } from '../helpers/app.js';
import { buildHello } from '../helpers/packages.js';

/**
 * Phase-1 exit criteria (docs/10 §2, T3–T6):
 *  (b) install hello-module from the console, enable it for one tenant, disable, re-enable — data preserved
 *  (c) unsigned / untrusted / tampered packages are refused and never executed
 *  (d) a failing migration rolls the whole install back
 * plus upgrade, rollback, dependency of entitlement on enablement, and uninstall keeping data.
 */
let t: TestApp;
let admin: { token: string; otp: () => string };
let key: KeyPairPem;
let tenantA: { token: string; tenantId: string };
let tenantB: { token: string; tenantId: string };

async function upload(pkg: string) {
  const { payload, headers } = multipart(await readFile(pkg), 'hello.mypkg');
  return t.req('POST', '/api/console/modules/upload', { token: admin.token, payload, headers });
}

async function install(pkg: string, enableGlobally = true) {
  const up = await upload(pkg);
  expect(up.status, JSON.stringify(up.body)).toBe(200);
  if (!up.body.ok && !pkg.includes('bad')) console.error(JSON.stringify(up.body.checks));
  return t.req('POST', '/api/console/modules/install', { token: admin.token, body: { uploadId: up.body.uploadId, otp: admin.otp(), enableGlobally } });
}

async function tableExists(name: string): Promise<boolean> {
  const r = await t.services.db.migratorPool.query(`SELECT to_regclass($1) AS t`, [`public.${name}`]);
  return r.rows[0].t !== null;
}

beforeAll(async () => {
  t = await TestApp.start();
  admin = await t.consoleAdmin();
  key = generateSigningKey();
  const r = await t.req('POST', '/api/console/keys', { token: admin.token, body: { publicKeyPem: key.publicKeyPem, label: 'test release key', otp: admin.otp() } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  tenantA = await t.signup('mod-a');
  tenantB = await t.signup('mod-b');
});
afterAll(async () => t?.stop());
// The fresh-2FA check is rate limited (10 codes / 5 min / admin); this suite legitimately uses more.
beforeEach(async () => {
  const keys = await t.services.redis.keys('rl:otpcheck:*');
  if (keys.length) await t.services.redis.del(...keys);
});

describe('package verification (c)', () => {
  it('refuses an unsigned package', async () => {
    const r = await upload(await buildHello({ sign: false }));
    expect(r.body.ok).toBe(false);
    expect(r.body.checks.map((c: { key: string }) => c.key)).toContain('MISSING_SIGNATURE');
    const inst = await t.req('POST', '/api/console/modules/install', { token: admin.token, body: { uploadId: r.body.uploadId, otp: admin.otp() } });
    expect(inst.status).toBe(400);
    expect(inst.body.code).toBe('PACKAGE_NOT_INSTALLABLE');
  });

  it('refuses a package signed by an untrusted key', async () => {
    const r = await upload(await buildHello({ key: generateSigningKey() }));
    expect(r.body.ok).toBe(false);
    expect(r.body.checks.map((c: { key: string }) => c.key)).toContain('UNKNOWN_KEY');
  });

  it('refuses a corrupted package', async () => {
    const pkg = await buildHello({ key });
    const bytes = await readFile(pkg);
    bytes[bytes.length - 40] = bytes[bytes.length - 40]! ^ 0xff;
    const { payload, headers } = multipart(bytes, 'x.mypkg');
    const r = await t.req('POST', '/api/console/modules/upload', { token: admin.token, payload, headers });
    expect(r.body.ok).toBe(false);
  });

  it('records rejections in the platform audit log', async () => {
    const audit = await t.req('GET', '/api/console/audit', { token: admin.token });
    expect(audit.body.filter((e: { action: string }) => e.action === 'module.package_rejected').length).toBeGreaterThanOrEqual(3);
  });

  it('requires the tech-admin role and a valid fresh TOTP code to install', async () => {
    const support = await t.consoleAdmin(['support']);
    const { payload, headers } = multipart(await readFile(await buildHello({ key })), 'h.mypkg');
    expect((await t.req('POST', '/api/console/modules/upload', { token: support.token, payload, headers })).status).toBe(403);
    const up = await upload(await buildHello({ key }));
    expect(up.body.ok).toBe(true);
    const bad = await t.req('POST', '/api/console/modules/install', { token: admin.token, body: { uploadId: up.body.uploadId, otp: '000000' } });
    expect(bad.status).toBe(403);
    expect(await tableExists('hello_module_notes')).toBe(false);
  });
});

describe('failure handling (d)', () => {
  it('rolls back completely when a migration fails half-way', async () => {
    const r = await install(await buildHello({ key, fixture: 'bad-migration' }));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('INSTALL_FAILED');
    // Neither the first migration's table nor the table created before the failing statement survive.
    expect(await tableExists('hello_module_notes')).toBe(false);
    expect(await tableExists('hello_module_leftover')).toBe(false);
    const ledger = await t.services.db.migratorPool.query(`SELECT count(*)::int AS n FROM core_module_migrations WHERE module_id = 'hello-module'`);
    expect(ledger.rows[0].n).toBe(0);
    const mods = await t.req('GET', '/api/console/modules', { token: admin.token });
    expect(mods.body.find((m: { id: string }) => m.id === 'hello-module')).toBeUndefined();
    expect(existsSync(`${t.dirs.store}/hello-module/1.0.1`)).toBe(false);
    const ops = await t.req('GET', '/api/console/modules/operations?moduleId=hello-module', { token: admin.token });
    expect(ops.body[0].status).toBe('failed');
    expect(ops.body[0].log.map((l: { line: string }) => l.line).join('\n')).toMatch(/برگردانده شد/);
  });

  it('refuses a module whose tables lack forced RLS', async () => {
    const r = await install(await buildHello({ key, fixture: 'no-rls' }));
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/RLS/);
    expect(await tableExists('hello_module_unsafe')).toBe(false);
    expect(await tableExists('hello_module_notes')).toBe(false);
  });

  it('refuses code that fails to load, before touching the database', async () => {
    const r = await install(await buildHello({ key, fixture: 'bad-code' }));
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/بارگذاری آزمایشی/);
    expect(await tableExists('hello_module_notes')).toBe(false);
  });
});

describe('install, enable per tenant, disable, re-enable (b)', () => {
  let noteId: string;

  it('installs hello-module 1.0.0 from the console and reloads', async () => {
    const r = await install(await buildHello({ key }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.version).toBe('1.0.0');
    expect(t.reloads.at(-1)).toBe('hello-module@1.0.0');
    await t.reload();
    expect(t.services.registry.loaded.has('hello-module')).toBe(true);
    const sys = await t.req('GET', '/api/console/system', { token: admin.token });
    expect(sys.body.runtime.find((x: { module_id: string }) => x.module_id === 'hello-module').status).toBe('loaded');
  });

  it('is not reachable by a tenant until enabled for that tenant', async () => {
    const r = await t.req('GET', '/api/m/hello-module/v1/notes', { token: tenantA.token });
    expect(r.status).toBe(403);
    const me = await t.req('GET', '/api/core/me', { token: tenantA.token });
    expect(me.body.modules).toEqual([]);
  });

  it('enables the module for tenant A only', async () => {
    const r = await t.req('POST', '/api/console/modules/hello-module/tenants', { token: admin.token, body: { tenantIds: [tenantA.tenantId], enabled: true } });
    expect(r.body.results[0].ok, JSON.stringify(r.body)).toBe(true);
    const me = await t.req('GET', '/api/core/me', { token: tenantA.token });
    expect(me.body.modules.map((m: { id: string }) => m.id)).toEqual(['hello-module']);
    expect(me.body.modules[0].menu[0].path).toBe('/app/hello');
    const meB = await t.req('GET', '/api/core/me', { token: tenantB.token });
    expect(meB.body.modules).toEqual([]);
    expect((await t.req('GET', '/api/m/hello-module/v1/notes', { token: tenantB.token })).status).toBe(403);
  });

  it('stores data for tenant A through the module API (validated, audited, evented)', async () => {
    const bad = await t.req('POST', '/api/m/hello-module/v1/notes', { token: tenantA.token, body: { title: '' } });
    expect(bad.status).toBe(400);
    const r = await t.req('POST', '/api/m/hello-module/v1/notes', { token: tenantA.token, body: { title: 'جلسه هماهنگی', body: 'ساعت ۱۰ صبح' } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    noteId = r.body.id;
    const list = await t.req('GET', '/api/m/hello-module/v1/notes', { token: tenantA.token });
    expect(list.body.map((n: { title: string }) => n.title)).toEqual(['جلسه هماهنگی']);
    // Outbox → event handler → notification
    expect(await t.services.events.dispatchOnce()).toBeGreaterThan(0);
    const notes = await t.req('GET', '/api/core/notifications', { token: tenantA.token });
    expect(notes.body.items.map((n: { title: string }) => n.title)).toContain('یادداشت «جلسه هماهنگی» ثبت شد');
    // Widget, search and settings providers
    const w = await t.req('GET', '/api/core/widgets/hello-module/hello-module.count', { token: tenantA.token });
    expect(w.body.data.count).toBe(1);
    const s = await t.req('GET', '/api/core/search?q=' + encodeURIComponent('هماهنگی'), { token: tenantA.token });
    expect(s.body.groups[0].hits[0].entityId).toBe(noteId);
    const set = await t.req('PUT', '/api/core/modules/hello-module/settings', { token: tenantA.token, body: { greeting: 'درود' } });
    expect(set.status).toBe(200);
    expect((await t.req('PUT', '/api/core/modules/hello-module/settings', { token: tenantA.token, body: { unknown: 1 } })).status).toBe(400);
    const g = await t.req('GET', '/api/m/hello-module/v1/notes/greeting', { token: tenantA.token });
    expect(g.body).toEqual({ greeting: 'درود', financeActive: false });
  });

  it('seeds the module default role for the tenant', async () => {
    const roles = await t.req('GET', '/api/core/roles', { token: tenantA.token });
    expect(roles.body.map((r: { key: string }) => r.key)).toContain('hello_editor');
  });

  it('isolates module data between tenants at the database level', async () => {
    await t.req('POST', '/api/console/modules/hello-module/tenants', { token: admin.token, body: { tenantIds: [tenantB.tenantId], enabled: true } });
    const listB = await t.req('GET', '/api/m/hello-module/v1/notes', { token: tenantB.token });
    expect(listB.body).toEqual([]);
    expect((await t.req('DELETE', `/api/m/hello-module/v1/notes/${noteId}`, { token: tenantB.token })).status).toBe(404);
    const raw = await t.services.db.appPool.query('SELECT count(*)::int AS n FROM hello_module_notes');
    expect(raw.rows[0].n).toBe(0); // no tenant context → RLS hides everything
    await t.req('POST', '/api/console/modules/hello-module/tenants', { token: admin.token, body: { tenantIds: [tenantB.tenantId], enabled: false } });
  });

  it('disabling for tenant A blocks the API and hides the module, without deleting data', async () => {
    const r = await t.req('POST', '/api/console/modules/hello-module/tenants', { token: admin.token, body: { tenantIds: [tenantA.tenantId], enabled: false } });
    expect(r.body.results[0].ok).toBe(true);
    const blocked = await t.req('GET', '/api/m/hello-module/v1/notes', { token: tenantA.token });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('MODULE_DISABLED');
    expect((await t.req('GET', '/api/core/me', { token: tenantA.token })).body.modules).toEqual([]);
    expect((await t.req('GET', '/api/core/widgets/hello-module/hello-module.count', { token: tenantA.token })).status).toBe(404);
    const rows = await t.services.db.tx({ tenantId: tenantA.tenantId, companyIds: [] }, async (tx) => {
      const { sql } = await import('drizzle-orm');
      return (await tx.execute(sql`SELECT count(*)::int AS n FROM hello_module_notes`)).rows;
    });
    void rows;
    const stats = await t.req('GET', '/api/console/modules/hello-module/uninstall-preview', { token: admin.token });
    expect(stats.body.tables.find((x: { table: string }) => x.table === 'hello_module_notes').rows).toBe(1);
  });

  it('re-enabling restores everything', async () => {
    await t.req('POST', '/api/console/modules/hello-module/tenants', { token: admin.token, body: { tenantIds: [tenantA.tenantId], enabled: true } });
    const list = await t.req('GET', '/api/m/hello-module/v1/notes', { token: tenantA.token });
    expect(list.status).toBe(200);
    expect(list.body.map((n: { id: string }) => n.id)).toEqual([noteId]);
    const g = await t.req('GET', '/api/m/hello-module/v1/notes/greeting', { token: tenantA.token });
    expect(g.body.greeting).toBe('درود');
  });

  it('global disable blocks every tenant; global enable restores', async () => {
    await t.req('POST', '/api/console/modules/hello-module/global', { token: admin.token, body: { enabled: false } });
    expect((await t.req('GET', '/api/m/hello-module/v1/notes', { token: tenantA.token })).status).toBe(403);
    await t.req('POST', '/api/console/modules/hello-module/global', { token: admin.token, body: { enabled: true } });
    expect((await t.req('GET', '/api/m/hello-module/v1/notes', { token: tenantA.token })).status).toBe(200);
  });

  it('a tenant admin cannot enable a module outside its entitlement', async () => {
    const c = await t.signup('mod-c');
    const r = await t.req('POST', '/api/core/modules/hello-module/enable', { token: c.token });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('NOT_ENTITLED');
  });

  it('read-only access after subscription expiry: reads allowed, writes refused, data kept', async () => {
    await t.services.db.app.execute((await import('drizzle-orm')).sql`INSERT INTO core_plans (key, name) VALUES ('basic', 'پایه') ON CONFLICT DO NOTHING`);
    await t.services.db.app.execute((await import('drizzle-orm')).sql`INSERT INTO core_subscriptions (id, tenant_id, plan_key, status, period_start, period_end)
      VALUES (gen_random_uuid(), ${tenantA.tenantId}, 'basic', 'expired', now() - interval '60 days', now() - interval '30 days')`);
    t.services.registry.invalidate();
    expect((await t.req('GET', '/api/m/hello-module/v1/notes', { token: tenantA.token })).body).toHaveLength(1);
    const w = await t.req('POST', '/api/m/hello-module/v1/notes', { token: tenantA.token, body: { title: 'نباید ثبت شود' } });
    expect(w.status).toBe(403);
    expect(w.body.code).toBe('SUBSCRIPTION_READ_ONLY');
    await t.services.db.app.execute((await import('drizzle-orm')).sql`UPDATE core_subscriptions SET status = 'active', period_end = now() + interval '30 days' WHERE tenant_id = ${tenantA.tenantId}`);
    t.services.registry.invalidate();
    expect((await t.req('POST', '/api/m/hello-module/v1/notes', { token: tenantA.token, body: { title: 'پس از تمدید' } })).status).toBe(201);
  });
});

describe('upgrade and rollback', () => {
  it('upgrades to 1.1.0 applying only the new migration, keeping data', async () => {
    const up = await upload(await buildHello({ key, fixture: 'v1.1.0' }));
    expect(up.body.kind).toBe('upgrade');
    expect(up.body.migrations).toEqual([
      { file: '0001_notes.sql', kind: 'expand', pending: false },
      { file: '0002_pinned.sql', kind: 'expand', pending: true },
    ]);
    const r = await t.req('POST', '/api/console/modules/install', { token: admin.token, body: { uploadId: up.body.uploadId, otp: admin.otp() } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await t.reload();
    expect(t.services.registry.loaded.get('hello-module')?.version).toBe('1.1.0');
    const cols = await t.services.db.migratorPool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'hello_module_notes'`);
    expect(cols.rows.map((c) => c.column_name)).toContain('pinned');
    const list = await t.req('GET', '/api/m/hello-module/v1/notes', { token: tenantA.token });
    expect(list.body.length).toBe(2);
    const backups = await t.req('GET', '/api/console/modules/operations?moduleId=hello-module', { token: admin.token });
    expect(backups.body[0].log.map((l: { line: string }) => l.line).join('\n')).toMatch(/پشتیبان/);
  });

  it('rolls back to 1.0.0 (expand-only migrations stay, code switches)', async () => {
    const r = await t.req('POST', '/api/console/modules/hello-module/rollback', { token: admin.token, body: { otp: admin.otp() } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await t.reload();
    expect(t.services.registry.loaded.get('hello-module')?.version).toBe('1.0.0');
    expect((await t.req('GET', '/api/m/hello-module/v1/notes', { token: tenantA.token })).body.length).toBe(2);
  });
});

describe('uninstall', () => {
  it('refuses while the module is in use, then uninstalls keeping data and a backup', async () => {
    const blocked = await t.req('POST', '/api/console/modules/hello-module/uninstall', { token: admin.token, body: { otp: admin.otp(), confirmName: 'hello-module' } });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('MODULE_IN_USE');
    await t.req('POST', '/api/console/modules/hello-module/tenants', { token: admin.token, body: { tenantIds: [tenantA.tenantId], enabled: false } });
    await t.req('POST', '/api/console/modules/hello-module/global', { token: admin.token, body: { enabled: false } });
    const wrong = await t.req('POST', '/api/console/modules/hello-module/uninstall', { token: admin.token, body: { otp: admin.otp(), confirmName: 'hello' } });
    expect(wrong.status).toBe(400);
    const r = await t.req('POST', '/api/console/modules/hello-module/uninstall', { token: admin.token, body: { otp: admin.otp(), confirmName: 'hello-module' } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(existsSync(`${r.body.backup}/hello_module_notes.jsonl.gz`)).toBe(true);
    await t.reload();
    expect(t.services.registry.loaded.has('hello-module')).toBe(false);
    expect(await tableExists('hello_module_notes')).toBe(true); // data retained by default
  });

  it('reinstalling restores access to the retained data', async () => {
    const r = await install(await buildHello({ key }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await t.reload();
    await t.req('POST', '/api/console/modules/hello-module/tenants', { token: admin.token, body: { tenantIds: [tenantA.tenantId], enabled: true } });
    expect((await t.req('GET', '/api/m/hello-module/v1/notes', { token: tenantA.token })).body.length).toBe(2);
  });

  it('no tenant table leaks rows across tenants or without a tenant context (SQL sweep)', async () => {
    const tables = await t.services.db.migratorPool.query<{ table_name: string }>(`SELECT DISTINCT c.relname AS table_name FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity ORDER BY 1`);
    expect(tables.rows.map((r) => r.table_name)).toContain('hello_module_notes');
    let checked = 0;
    for (const { table_name } of tables.rows) {
      const client = await t.services.db.appPool.connect();
      try {
        const none = await client.query(`SELECT count(*)::int AS n FROM "${table_name}"`);
        expect(none.rows[0].n, `${table_name} without context`).toBe(0);
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.company_ids', '{}', true)`, [tenantB.tenantId]);
        const foreign = await client.query(`SELECT count(*)::int AS n FROM "${table_name}" WHERE tenant_id <> $1`, [tenantB.tenantId]);
        expect(foreign.rows[0].n, `${table_name} foreign rows`).toBe(0);
        await client.query('ROLLBACK');
        checked++;
      } finally {
        client.release();
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('keeps the audit chain intact through the whole lifecycle', async () => {
    const v = await t.req('GET', '/api/console/audit/verify', { token: admin.token });
    expect(v.body).toEqual({ intact: true, firstBrokenId: null });
  });
});
