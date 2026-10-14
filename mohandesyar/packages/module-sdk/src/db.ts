import { sql } from 'drizzle-orm';
import { pgPolicy, timestamp, uuid, integer } from 'drizzle-orm/pg-core';

/**
 * Drizzle helpers for module tables. Every table holding tenant data must carry these columns and
 * policies; the migration runner refuses any module table with `tenant_id` but without forced RLS.
 * See docs/04-multitenancy-holding-rls.md §4.
 */

export const tenantIdColumn = () => uuid('tenant_id').notNull();
export const companyIdColumn = () => uuid('company_id').notNull();

/** Standard columns for a company-scoped business table. */
export function companyScopedColumns() {
  return {
    id: uuid('id').primaryKey(),
    tenantId: tenantIdColumn(),
    companyId: companyIdColumn(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
  };
}

const tenantMatch = sql`tenant_id = current_setting('app.tenant_id', true)::uuid`;
const companyMatch = sql`company_id = ANY (current_setting('app.company_ids', true)::uuid[])`;

/** Policies for a company-scoped table (pass to the third argument of `pgTable(...).enableRLS()`). */
export function companyScopedPolicies() {
  return [
    pgPolicy('tenant_isolation', { as: 'restrictive', for: 'all', using: tenantMatch, withCheck: tenantMatch }),
    pgPolicy('company_scope', { as: 'permissive', for: 'all', using: companyMatch, withCheck: companyMatch }),
  ];
}

/** Policies for a tenant-level table without `company_id`. */
export function tenantScopedPolicies() {
  return [
    pgPolicy('tenant_isolation', { as: 'restrictive', for: 'all', using: tenantMatch, withCheck: tenantMatch }),
    pgPolicy('tenant_rows', { as: 'permissive', for: 'all', using: sql`true`, withCheck: sql`true` }),
  ];
}

/** Raw SQL for a hand-written migration, equivalent to the policies above. */
export function rlsSql(table: string, opts: { company: boolean }): string {
  const lines = [
    `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`,
    `CREATE POLICY tenant_isolation ON ${table} AS RESTRICTIVE FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);`,
  ];
  lines.push(
    opts.company
      ? `CREATE POLICY company_scope ON ${table} AS PERMISSIVE FOR ALL USING (company_id = ANY (current_setting('app.company_ids', true)::uuid[])) WITH CHECK (company_id = ANY (current_setting('app.company_ids', true)::uuid[]));`
      : `CREATE POLICY tenant_rows ON ${table} AS PERMISSIVE FOR ALL USING (true) WITH CHECK (true);`,
  );
  return lines.join('\n');
}
