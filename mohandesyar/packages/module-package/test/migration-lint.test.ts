import { describe, expect, it } from 'vitest';
import { lintMigration } from '../src/migration-lint.js';

const lint = (sql: string) => lintMigration('0001.sql', sql, 'demo_');

describe('migration lint', () => {
  it('accepts ordinary module DDL with RLS', async () => {
    const issues = await lint(`
      CREATE TABLE demo_items (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, company_id uuid NOT NULL, title text);
      CREATE INDEX demo_items_tenant ON demo_items (tenant_id);
      ALTER TABLE demo_items ENABLE ROW LEVEL SECURITY;
      ALTER TABLE demo_items FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON demo_items AS RESTRICTIVE USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
      ALTER TABLE demo_items ADD COLUMN note text;
      UPDATE demo_items SET note = '' WHERE note IS NULL;
    `);
    expect(issues).toEqual([]);
  });

  it.each([
    ['CREATE INDEX CONCURRENTLY demo_i ON demo_items (id);', 'CONCURRENTLY'],
    ['CREATE TABLE core_users_copy (id int);', 'core_users_copy'],
    ['SELECT * FROM core_users;', 'core_users'],
    ['ALTER TABLE core_tenants ADD COLUMN x int;', 'core_tenants'],
    ['GRANT SELECT ON demo_items TO public;', 'GrantStmt'],
    ['SET ROLE postgres;', 'VariableSetStmt'],
    ['CREATE EXTENSION pg_trgm;', 'CreateExtensionStmt'],
    ["COPY demo_items FROM PROGRAM 'id';", 'CopyStmt'],
    ['DROP TABLE core_users;', 'core_users'],
    ['CREATE TABLE pg_catalog.demo_x (id int);', 'pg_catalog'],
    ["DO $$ BEGIN PERFORM 1; END $$;", 'DoStmt'],
    ["CREATE FUNCTION demo_f() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'select 1';", 'SECURITY DEFINER'],
    ['INSERT INTO demo_items SELECT * FROM core_audit_log;', 'core_audit_log'],
    ['ALTER SYSTEM SET work_mem = 1;', 'AlterSystemStmt'],
    ['this is not sql', 'خطای نحوی'],
  ])('rejects %s', async (sql, fragment) => {
    const issues = await lint(sql);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.map((i) => i.message).join(' | ')).toContain(fragment);
  });
});
