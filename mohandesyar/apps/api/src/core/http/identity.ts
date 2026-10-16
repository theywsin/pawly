import { sql } from 'drizzle-orm';
import type { Database } from '../../infra/db.js';
import type { RbacService } from '../rbac/rbac.service.js';
import type { TenancyService } from '../tenancy/tenancy.service.js';
import { forCompany, type Grant } from '../rbac/permissions.js';
import type { Identity } from './context.js';
import { forbidden } from './errors.js';

/**
 * Membership, allowed companies and grants of a user in a tenant, computed under RLS — for a request
 * (company from the X-Company-Id header) or for work done on a user's behalf (scheduled reports).
 */
/** What identity building needs from the core (kept narrow to avoid import cycles). */
export interface IdentityDeps {
  db: Database;
  rbac: RbacService;
  tenancy: TenancyService;
}

export async function buildIdentity(s: IdentityDeps, a: { userId: string; tenantId: string; sessionId: string; amr: string[]; companyHeader: string | string[] | undefined }): Promise<Identity> {
  const { userId, tenantId, sessionId, amr, companyHeader } = a;
  return s.db.tx({ tenantId }, async (tx) => {
    const m = await tx.execute(sql`SELECT id, status FROM core_memberships WHERE user_id = ${userId}`);
    const membership = m.rows[0] as { id: string; status: string } | undefined;
    if (!membership || membership.status !== 'active') throw forbidden('NOT_A_MEMBER', 'عضویت شما در این سازمان فعال نیست');
    const grants: Grant[] = await s.rbac.grantsOf(tx, membership.id);
    const companies = (await s.tenancy.listCompanies(tx)).map((c) => c.id);
    const allowed = grants.some((g) => g.companyId === null) ? companies : companies.filter((c) => grants.some((g) => g.companyId === c));
    if (allowed.length === 0) throw forbidden('NO_COMPANY_ACCESS', 'به هیچ شرکتی در این سازمان دسترسی ندارید');
    const header = Array.isArray(companyHeader) ? companyHeader[0] : companyHeader;
    let companyId = allowed[0]!;
    let companyIds = [companyId];
    if (header === 'all') {
      companyIds = allowed;
    } else if (header) {
      if (!allowed.includes(header)) throw forbidden('COMPANY_FORBIDDEN', 'به این شرکت دسترسی ندارید');
      companyId = header;
      companyIds = [header];
    }
    return {
      userId,
      tenantId,
      sessionId,
      membershipId: membership.id,
      companyId,
      companyIds,
      allowedCompanyIds: allowed,
      permissions: forCompany(grants, companyId),
      grants,
      amr,
    };
  });
}
