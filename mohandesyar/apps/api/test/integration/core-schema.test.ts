import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, pgMessage, type TestDatabase } from '../helpers/db.js';
import { Database } from '../../src/infra/db.js';
import { uuidv7 } from '../../src/infra/ids.js';
import { sql } from 'drizzle-orm';

let tdb: TestDatabase;
let db: Database;

beforeAll(async () => {
  tdb = await createTestDatabase();
  db = new Database(tdb.appUrl, tdb.migratorUrl);
});
afterAll(async () => {
  await db?.close();
  await tdb?.drop();
});

describe('core schema and RLS', () => {
  it('every core table with tenant_id has RLS enabled (forced, except the audit log)', async () => {
    const r = await db.migratorPool.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id')`);
    // Platform-owned rows read by the console across organisations; tenant endpoints filter by the caller's tenant.
    const platform = new Set(['core_tenant_modules', 'core_subscriptions', 'core_subscription_addons', 'core_tenant_grants', 'core_sessions', 'core_invoices', 'core_payments']);
    for (const t of r.rows) {
      if (platform.has(t.relname)) continue;
      expect(t.relrowsecurity, t.relname).toBe(true);
      if (t.relname !== 'core_audit_log') expect(t.relforcerowsecurity, t.relname).toBe(true);
    }
  });

  it('the app role cannot bypass RLS and sees nothing without a tenant context', async () => {
    const tenantA = uuidv7();
    await db.appPool.query(`INSERT INTO core_tenants (id, slug, name) VALUES ($1, 'a', 'A')`, [tenantA]);
    // FORCE RLS applies even to the table owner: inserting without a matching tenant context fails.
    await expect(db.migratorPool.query(`INSERT INTO core_companies (id, tenant_id, name) VALUES ($1, $2, 'A co')`, [uuidv7(), tenantA])).rejects.toThrow(/row-level security/);
    await db.tx({ tenantId: tenantA }, (tx) => tx.execute(sql`INSERT INTO core_companies (id, tenant_id, name) VALUES (${uuidv7()}, ${tenantA}, 'A co')`));
    const err = await db
      .tx({ tenantId: tenantA }, (tx) => tx.execute(sql`INSERT INTO core_companies (id, tenant_id, name) VALUES (${uuidv7()}, ${uuidv7()}, 'other')`))
      .catch((e: unknown) => e);
    expect(pgMessage(err)).toMatch(/row-level security/);
    const role = await db.appPool.query(`SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`);
    expect(role.rows[0].rolbypassrls).toBe(false);
    const none = await db.appPool.query('SELECT count(*)::int AS n FROM core_companies');
    expect(none.rows[0].n).toBe(0);
    const scoped = await db.tx({ tenantId: tenantA }, (tx) => tx.execute(sql`SELECT count(*)::int AS n FROM core_companies`));
    expect((scoped as unknown as pg.QueryResult).rows[0].n).toBe(1);
  });

  it('the app role cannot write the audit log directly but can append through the chained function', async () => {
    await expect(db.appPool.query(`INSERT INTO core_audit_log (actor_type, action, prev_hash, hash) VALUES ('system', 'x', '', '')`)).rejects.toThrow(/permission denied/);
    await db.appPool.query(`SELECT core_audit_append(NULL, 'system', NULL, 'test.one', NULL, NULL, NULL, NULL, NULL, NULL)`);
    await db.appPool.query(`SELECT core_audit_append(NULL, 'system', NULL, 'test.two', NULL, NULL, NULL, NULL, '{"a":1}', NULL)`);
    const ok = await db.appPool.query('SELECT core_audit_verify() AS broken');
    expect(ok.rows[0].broken).toBeNull();
    await db.migratorPool.query(`UPDATE core_audit_log SET action = 'tampered' WHERE action = 'test.one'`);
    const broken = await db.appPool.query('SELECT core_audit_verify() AS broken');
    expect(broken.rows[0].broken).not.toBeNull();
  });

  it('core migrations are idempotent and detect edited files', async () => {
    const { migrateCore, readMigrationDir, applyMigrations } = await import('../../src/core/migrations/runner.js');
    const { apiRoot } = await import('../../src/infra/paths.js');
    const { join } = await import('node:path');
    expect(await migrateCore(db.migratorPool, join(apiRoot(), 'migrations/core'), '1.0.0')).toEqual([]);
    const files = await readMigrationDir(join(apiRoot(), 'migrations/core'));
    const client = await db.migratorPool.connect();
    try {
      await client.query('BEGIN');
      await expect(applyMigrations(client, { moduleId: 'core', version: '1.0.0', files: [{ ...files[0]!, checksum: 'changed' }] })).rejects.toThrow(/تغییر کرده/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
