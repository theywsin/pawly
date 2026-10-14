import { sql } from 'drizzle-orm';
import type { Database, Db } from '../../infra/db.js';
import { uuidv7 } from '../../infra/ids.js';
import { conflict, badRequest } from '../http/errors.js';
import { hashPassword, passwordPolicyError } from '../auth/crypto.js';
import type { RbacService} from '../rbac/rbac.service.js';
import { SYSTEM_ROLES } from '../rbac/rbac.service.js';
import type { AuditService } from '../audit/audit.service.js';

export interface SignupInput {
  fullName: string;
  email: string;
  password: string;
  tenantName: string;
  companyName: string;
  slug?: string;
}

export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  status: 'trial' | 'active' | 'suspended' | 'closed';
  timezone: string;
  number_style: 'fa' | 'latn';
}

function slugify(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return s.length >= 3 ? s.slice(0, 40) : `t-${uuidv7().slice(-8)}`;
}

export class TenancyService {
  constructor(
    private readonly db: Database,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  /** Creates user (or reuses an existing one after password check by the caller), tenant, first company and admin role. */
  async signup(input: SignupInput, opts: { trialDays?: number; defaultPlan?: string } = {}): Promise<{ userId: string; tenantId: string; companyId: string }> {
    const policy = passwordPolicyError(input.password);
    if (policy) throw badRequest('WEAK_PASSWORD', policy);
    const passwordHash = await hashPassword(input.password);
    const userId = uuidv7();
    const tenantId = uuidv7();
    const companyId = uuidv7();
    const membershipId = uuidv7();
    let slug = input.slug ?? slugify(input.tenantName);

    return this.db.app.transaction(async (rawTx) => {
      const tx = rawTx as unknown as Db;
      const existing = await tx.execute(sql`SELECT 1 FROM core_users WHERE lower(email) = lower(${input.email})`);
      if (existing.rows.length) throw conflict('EMAIL_TAKEN', 'این ایمیل قبلاً ثبت شده است؛ وارد شوید');
      const slugTaken = await tx.execute(sql`SELECT 1 FROM core_tenants WHERE slug = ${slug}`);
      if (slugTaken.rows.length) slug = `${slug.slice(0, 30)}-${uuidv7().slice(-6)}`;

      await tx.execute(sql`INSERT INTO core_users (id, email, full_name, password_hash) VALUES (${userId}, ${input.email}, ${input.fullName}, ${passwordHash})`);
      await tx.execute(sql`INSERT INTO core_tenants (id, slug, name, status) VALUES (${tenantId}, ${slug}, ${input.tenantName}, ${opts.trialDays ? 'trial' : 'active'})`);
      if (opts.defaultPlan) {
        const days = opts.trialDays ?? 30;
        await tx.execute(sql`INSERT INTO core_subscriptions (id, tenant_id, plan_key, status, period_start, period_end, trial_end)
          VALUES (${uuidv7()}, ${tenantId}, ${opts.defaultPlan}, ${opts.trialDays ? 'trialing' : 'active'}, now(), now() + make_interval(days => ${days}),
                  ${opts.trialDays ? sql`now() + make_interval(days => ${days})` : sql`NULL`})`);
      }
      // Switch the RLS context to the new tenant for tenant-table writes.
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.company_ids', ${`{${companyId}}`}, true)`);
      await tx.execute(sql`INSERT INTO core_companies (id, tenant_id, name) VALUES (${companyId}, ${tenantId}, ${input.companyName})`);
      await tx.execute(sql`INSERT INTO core_memberships (id, tenant_id, user_id, title) VALUES (${membershipId}, ${tenantId}, ${userId}, 'مدیر سامانه')`);
      for (const role of SYSTEM_ROLES) await this.rbac.ensureRole(tx, tenantId, role, { system: true });
      await this.rbac.assignRole(tx, tenantId, membershipId, 'company_admin', null);
      await this.audit.append({ tenantId, actorType: 'user', actorId: userId, action: 'tenant.created', entityType: 'tenant', entityId: tenantId, after: { name: input.tenantName, slug } }, tx);
      return { userId, tenantId, companyId };
    });
  }

  async getTenant(tenantId: string): Promise<TenantInfo | null> {
    const r = await this.db.app.execute(sql`SELECT id, slug, name, status, timezone, number_style FROM core_tenants WHERE id = ${tenantId}`);
    return (r.rows[0] as unknown as TenantInfo | undefined) ?? null;
  }

  async membershipOf(tx: Db, userId: string): Promise<{ id: string; status: string } | null> {
    const r = await tx.execute(sql`SELECT id, status FROM core_memberships WHERE user_id = ${userId}`);
    return (r.rows[0] as { id: string; status: string } | undefined) ?? null;
  }

  async listCompanies(tx: Db): Promise<{ id: string; name: string }[]> {
    const r = await tx.execute(sql`SELECT id, name FROM core_companies WHERE status = 'active' ORDER BY created_at`);
    return r.rows as { id: string; name: string }[];
  }

  async createCompany(tenantId: string, actorId: string, name: string): Promise<string> {
    const id = uuidv7();
    await this.db.tx({ tenantId, companyIds: [id] }, async (tx) => {
      await tx.execute(sql`INSERT INTO core_companies (id, tenant_id, name) VALUES (${id}, ${tenantId}, ${name})`);
      await this.audit.append({ tenantId, actorType: 'user', actorId, action: 'company.created', entityType: 'company', entityId: id, after: { name } }, tx);
    });
    return id;
  }

  /** Adds a user (new or existing by email) to the tenant with a role. Returns whether a new account was created. */
  async addMember(
    tenantId: string,
    actorId: string,
    input: { email: string; fullName: string; initialPassword?: string; roleKey: string; companyId: string | null },
  ): Promise<{ userId: string; membershipId: string; created: boolean }> {
    const found = await this.db.app.execute(sql`SELECT id FROM core_users WHERE lower(email) = lower(${input.email})`);
    let userId = (found.rows[0] as { id: string } | undefined)?.id;
    let created = false;
    if (!userId) {
      if (!input.initialPassword) throw badRequest('PASSWORD_REQUIRED', 'برای کاربر جدید رمز اولیه لازم است');
      const policy = passwordPolicyError(input.initialPassword);
      if (policy) throw badRequest('WEAK_PASSWORD', policy);
      userId = uuidv7();
      created = true;
      await this.db.app.execute(sql`INSERT INTO core_users (id, email, full_name, password_hash)
        VALUES (${userId}, ${input.email}, ${input.fullName}, ${await hashPassword(input.initialPassword)})`);
    }
    const membershipId = uuidv7();
    await this.db.tx({ tenantId }, async (tx) => {
      const dup = await tx.execute(sql`SELECT 1 FROM core_memberships WHERE user_id = ${userId}`);
      if (dup.rows.length) throw conflict('ALREADY_MEMBER', 'این کاربر قبلاً عضو سازمان است');
      await tx.execute(sql`INSERT INTO core_memberships (id, tenant_id, user_id) VALUES (${membershipId}, ${tenantId}, ${userId})`);
      await this.rbac.assignRole(tx, tenantId, membershipId, input.roleKey, input.companyId);
      await this.audit.append({ tenantId, actorType: 'user', actorId, action: 'member.added', entityType: 'membership', entityId: membershipId, after: { email: input.email, role: input.roleKey } }, tx);
    });
    return { userId: userId!, membershipId, created };
  }

  async listMembers(tenantId: string) {
    return this.db.tx({ tenantId }, async (tx) => {
      const r = await tx.execute(sql`
        SELECT m.id, m.user_id, m.status, m.title, u.email, u.full_name,
               coalesce(json_agg(json_build_object('role', r.key, 'name', r.name, 'companyId', ra.company_id)) FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
          FROM core_memberships m
          JOIN core_users u ON u.id = m.user_id
          LEFT JOIN core_role_assignments ra ON ra.membership_id = m.id
          LEFT JOIN core_roles r ON r.id = ra.role_id
         GROUP BY m.id, u.id ORDER BY u.full_name`);
      return r.rows;
    });
  }
}
