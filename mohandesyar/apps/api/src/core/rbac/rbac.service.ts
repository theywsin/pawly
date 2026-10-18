import { sql } from 'drizzle-orm';
import type { PermissionScope } from '@mohandesyar/module-sdk';
import type { Database, Db } from '../../infra/db.js';
import { uuidv7 } from '../../infra/ids.js';
import type { Grant } from './permissions.js';
import { conflict, notFound } from '../http/errors.js';

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

  /**
   * Creates (key null) or replaces a role's name and grants. The organisation administrator role cannot be
   * changed, so an organisation can never lock itself out; system and module roles keep their key.
   */
  async saveRole(tenantId: string, key: string | null, input: { name: string; grants: { permission: string; scope: PermissionScope }[] }): Promise<string> {
    return this.db.tx({ tenantId }, async (tx) => {
      let roleId: string;
      let roleKey = key;
      if (key === null) {
        roleId = uuidv7();
        roleKey = `custom_${roleId.replace(/-/g, '').slice(-10)}`;
        await tx.execute(sql`INSERT INTO core_roles (id, tenant_id, key, name, is_system) VALUES (${roleId}, ${tenantId}, ${roleKey}, ${input.name}, false)`);
      } else {
        if (key === 'company_admin') throw conflict('ROLE_LOCKED', 'نقش «مدیر شرکت» همه دسترسی‌ها را دارد و قابل تغییر نیست');
        const r = await tx.execute(sql`UPDATE core_roles SET name = ${input.name} WHERE key = ${key} RETURNING id`);
        const row = r.rows[0] as { id: string } | undefined;
        if (!row) throw notFound('نقش یافت نشد');
        roleId = row.id;
        await tx.execute(sql`DELETE FROM core_role_permissions WHERE role_id = ${roleId}`);
      }
      for (const g of input.grants) {
        await tx.execute(sql`INSERT INTO core_role_permissions (tenant_id, role_id, permission, scope) VALUES (${tenantId}, ${roleId}, ${g.permission}, ${g.scope}) ON CONFLICT DO NOTHING`);
      }
      return roleKey!;
    });
  }

  /** Deletes a role the organisation created, once nobody holds it. */
  async deleteRole(tenantId: string, key: string): Promise<void> {
    await this.db.tx({ tenantId }, async (tx) => {
      const r = await tx.execute(sql`SELECT r.id, r.is_system, r.module_id, (SELECT count(*)::int FROM core_role_assignments a WHERE a.role_id = r.id) AS holders FROM core_roles r WHERE r.key = ${key}`);
      const row = r.rows[0] as { id: string; is_system: boolean; module_id: string | null; holders: number } | undefined;
      if (!row) throw notFound('نقش یافت نشد');
      if (row.is_system || row.module_id) throw conflict('ROLE_BUILT_IN', 'نقش‌های پیش‌فرض سامانه و ماژول‌ها حذف نمی‌شوند');
      if (row.holders > 0) throw conflict('ROLE_IN_USE', 'این نقش به کاربرانی داده شده است؛ ابتدا نقش آن‌ها را تغییر دهید');
      await tx.execute(sql`DELETE FROM core_roles WHERE id = ${row.id}`);
    });
  }

  /**
   * Replaces a member's roles (each for every company or one company). The organisation always keeps at
   * least one active member with the administrator role.
   */
  async setMemberRoles(tenantId: string, membershipId: string, roles: { roleKey: string; companyId: string | null }[]): Promise<void> {
    await this.db.tx({ tenantId }, async (tx) => {
      const m = await tx.execute(sql`SELECT id FROM core_memberships WHERE id = ${membershipId}`);
      if (!m.rows.length) throw notFound('کاربر یافت نشد');
      const keys = [...new Set(roles.map((r) => r.roleKey))];
      const found = await tx.execute(sql`SELECT key, id FROM core_roles WHERE key = ANY (${`{${keys.join(',')}}`}::text[])`);
      const ids = new Map((found.rows as { key: string; id: string }[]).map((r) => [r.key, r.id]));
      const missing = keys.filter((k) => !ids.has(k));
      if (missing.length) throw notFound(`نقش ${missing.join('، ')} یافت نشد`);
      await tx.execute(sql`DELETE FROM core_role_assignments WHERE membership_id = ${membershipId}`);
      for (const r of roles) {
        await tx.execute(sql`INSERT INTO core_role_assignments (id, tenant_id, membership_id, role_id, company_id) VALUES (${uuidv7()}, ${tenantId}, ${membershipId}, ${ids.get(r.roleKey)}, ${r.companyId})`);
      }
      await this.assertAdminRemains(tx);
    });
  }

  async setMemberStatus(tenantId: string, membershipId: string, status: 'active' | 'disabled'): Promise<void> {
    await this.db.tx({ tenantId }, async (tx) => {
      const r = await tx.execute(sql`UPDATE core_memberships SET status = ${status} WHERE id = ${membershipId} RETURNING id`);
      if (!r.rows.length) throw notFound('کاربر یافت نشد');
      await this.assertAdminRemains(tx);
    });
  }

  private async assertAdminRemains(tx: Db) {
    const r = await tx.execute(sql`SELECT count(*)::int AS n FROM core_role_assignments a JOIN core_roles r ON r.id = a.role_id JOIN core_memberships m ON m.id = a.membership_id
      WHERE r.key = 'company_admin' AND a.company_id IS NULL AND m.status = 'active'`);
    if ((r.rows[0] as { n: number }).n === 0) throw conflict('LAST_ADMIN', 'سازمان باید دست‌کم یک مدیر فعال با دسترسی همه شرکت‌ها داشته باشد');
  }

  /** Highest amount (rial) a role may approve in workflows with amounts; null = no limit. */
  async setApprovalLimit(tenantId: string, key: string, limit: string | null): Promise<boolean> {
    return this.db.tx({ tenantId }, async (tx) => {
      const r = await tx.execute(sql`UPDATE core_roles SET approval_limit = ${limit} WHERE key = ${key} RETURNING id`);
      return r.rows.length > 0;
    });
  }
}

/** Persian labels of the core's own permissions (module permissions carry theirs in their manifests). */
export const CORE_PERMISSION_LABELS: Record<string, string> = {
  'core.user.view': 'مشاهده کاربران',
  'core.user.create': 'افزودن کاربر',
  'core.user.update': 'تغییر نقش و وضعیت کاربران',
  'core.role.view': 'مشاهده نقش‌ها',
  'core.role.manage': 'ساخت و ویرایش نقش‌ها',
  'core.company.view': 'مشاهده شرکت‌ها',
  'core.company.manage': 'مدیریت شرکت‌ها',
  'core.module.view': 'مشاهده ماژول‌ها',
  'core.module.manage_tenant': 'فعال/غیرفعال کردن ماژول‌ها',
  'core.settings.manage': 'تنظیمات سازمان',
  'core.audit.view': 'گزارش رویدادها',
  'core.task.view': 'مشاهده وظایف',
  'core.task.create': 'ایجاد وظیفه',
  'core.task.update': 'به‌روزرسانی وظیفه',
  'core.file.upload': 'بارگذاری فایل',
  'core.file.download': 'دریافت فایل',
  'core.workflow.manage_definitions': 'تعریف گردش‌های تأیید',
  'core.workflow.start': 'شروع گردش تأیید',
  'core.integration.manage': 'کلید API و Webhook',
  'core.billing.manage': 'اشتراک و پرداخت',
  'core.support.view_all': 'مشاهده همه تیکت‌های سازمان',
};
