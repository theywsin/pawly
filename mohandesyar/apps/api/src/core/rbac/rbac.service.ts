import { sql } from 'drizzle-orm';
import type { PermissionScope } from '@mohandesyar/module-sdk';
import type { Database, Db } from '../../infra/db.js';
import { uuidv7 } from '../../infra/ids.js';
import type { Grant } from './permissions.js';

export interface SystemRoleDef {
  key: string;
  name: string;
  grants: { permission: string; scope?: PermissionScope }[];
}

/** Core roles created for every tenant (docs/06 §3). Modules add their own grants when enabled. */
export const SYSTEM_ROLES: SystemRoleDef[] = [
  { key: 'company_admin', name: 'مدیر شرکت', grants: [{ permission: '*' }] },
  { key: 'ceo', name: 'مدیرعامل', grants: [{ permission: '*.view' }, { permission: '*.export' }, { permission: '*.approve' }] },
  { key: 'auditor', name: 'ناظر/حسابرس', grants: [{ permission: '*.view' }, { permission: '*.export' }, { permission: 'core.audit.view' }] },
  {
    key: 'employee',
    name: 'کارمند',
    grants: [
      { permission: 'core.task.view', scope: 'own' },
      { permission: 'core.task.create', scope: 'own' },
      { permission: 'core.task.update', scope: 'own' },
      { permission: 'core.file.upload', scope: 'own' },
      { permission: 'core.file.download', scope: 'own' },
    ],
  },
  { key: 'readonly', name: 'فقط‌خواندنی', grants: [{ permission: '*.view' }] },
];

export class RbacService {
  constructor(private readonly db: Database) {}

  /** Creates or extends a tenant role; grants are added, never removed (tenants may have customised the role). */
  async ensureRole(tx: Db, tenantId: string, def: SystemRoleDef, opts: { system: boolean; moduleId?: string }): Promise<string> {
    const existing = await tx.execute(sql`SELECT id FROM core_roles WHERE tenant_id = ${tenantId} AND key = ${def.key}`);
    let roleId = (existing.rows[0] as { id: string } | undefined)?.id;
    if (!roleId) {
      roleId = uuidv7();
      await tx.execute(sql`INSERT INTO core_roles (id, tenant_id, key, name, is_system, module_id)
        VALUES (${roleId}, ${tenantId}, ${def.key}, ${def.name}, ${opts.system}, ${opts.moduleId ?? null})`);
    }
    for (const g of def.grants) {
      await tx.execute(sql`INSERT INTO core_role_permissions (tenant_id, role_id, permission, scope)
        VALUES (${tenantId}, ${roleId}, ${g.permission}, ${g.scope ?? 'company'}) ON CONFLICT DO NOTHING`);
    }
    return roleId;
  }

  async assignRole(tx: Db, tenantId: string, membershipId: string, roleKey: string, companyId: string | null): Promise<void> {
    const r = await tx.execute(sql`SELECT id FROM core_roles WHERE tenant_id = ${tenantId} AND key = ${roleKey}`);
    const roleId = (r.rows[0] as { id: string } | undefined)?.id;
    if (!roleId) throw new Error(`role ${roleKey} not found`);
    await tx.execute(sql`INSERT INTO core_role_assignments (id, tenant_id, membership_id, role_id, company_id)
      VALUES (${uuidv7()}, ${tenantId}, ${membershipId}, ${roleId}, ${companyId})`);
  }

  /** All grants of a membership (role grants + cross-company grants), valid now. Runs inside a tenant tx. */
  async grantsOf(tx: Db, membershipId: string): Promise<Grant[]> {
    const r = await tx.execute(sql`
      SELECT rp.permission, rp.scope, ra.company_id
        FROM core_role_assignments ra JOIN core_role_permissions rp ON rp.role_id = ra.role_id
       WHERE ra.membership_id = ${membershipId}
         AND (ra.valid_from IS NULL OR ra.valid_from <= now()) AND (ra.valid_to IS NULL OR ra.valid_to > now())
      UNION ALL
      SELECT unnest(g.permissions), 'company', g.company_id
        FROM core_company_grants g
       WHERE g.membership_id = ${membershipId}
         AND (g.valid_from IS NULL OR g.valid_from <= now()) AND (g.valid_to IS NULL OR g.valid_to > now())`);
    return (r.rows as { permission: string; scope: PermissionScope; company_id: string | null }[]).map((x) => ({
      permission: x.permission,
      scope: x.scope,
      companyId: x.company_id,
    }));
  }

  async listRoles(tenantId: string) {
    return this.db.tx({ tenantId }, async (tx) => {
      const r = await tx.execute(sql`SELECT r.id, r.key, r.name, r.is_system, r.module_id, r.approval_limit::text,
          coalesce(json_agg(json_build_object('permission', p.permission, 'scope', p.scope)) FILTER (WHERE p.permission IS NOT NULL), '[]') AS grants
        FROM core_roles r LEFT JOIN core_role_permissions p ON p.role_id = r.id GROUP BY r.id ORDER BY r.is_system DESC, r.name`);
      return r.rows;
    });
  }

  /** Highest amount (rial) a role may approve in workflows with amounts; null = no limit. */
  async setApprovalLimit(tenantId: string, key: string, limit: string | null): Promise<boolean> {
    return this.db.tx({ tenantId }, async (tx) => {
      const r = await tx.execute(sql`UPDATE core_roles SET approval_limit = ${limit} WHERE key = ${key} RETURNING id`);
      return r.rows.length > 0;
    });
  }
}
