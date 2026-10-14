import { sql } from 'drizzle-orm';
import type { Database } from '../../infra/db.js';

/** docs/09-subscription-entitlement.md §2 */
export type AccessMode = 'full' | 'read-only' | 'hidden-keep-data' | 'blocked';

export interface TenantEntitlement {
  tenantStatus: string;
  subscriptionStatus: string | null;
  planKey: string | null;
  /** Modules the tenant may use: plan-included ∪ addons ∪ manual grants. */
  modules: Set<string>;
  userLimit: number | null;
}

export class EntitlementService {
  private cache = new Map<string, { at: number; value: TenantEntitlement }>();
  constructor(
    private readonly db: Database,
    private readonly ttlMs = 5_000,
  ) {}

  invalidate(tenantId?: string): void {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }

  async get(tenantId: string): Promise<TenantEntitlement> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;
    const r = await this.db.app.execute(sql`
      SELECT t.status AS tenant_status, s.status AS sub_status, s.plan_key,
             (p.user_limit + coalesce(s.user_limit_extra, 0)) AS user_limit,
             ARRAY(
               SELECT pm.module_id FROM core_plan_modules pm WHERE pm.plan_key = s.plan_key AND pm.included
               UNION SELECT a.module_id FROM core_subscription_addons a WHERE a.tenant_id = t.id AND (a.valid_to IS NULL OR a.valid_to > now())
               UNION SELECT g.module_id FROM core_tenant_grants g WHERE g.tenant_id = t.id AND (g.valid_to IS NULL OR g.valid_to > now())
             ) AS modules
        FROM core_tenants t
        LEFT JOIN core_subscriptions s ON s.tenant_id = t.id
        LEFT JOIN core_plans p ON p.key = s.plan_key
       WHERE t.id = ${tenantId}`);
    const row = r.rows[0] as { tenant_status: string; sub_status: string | null; plan_key: string | null; user_limit: number | null; modules: string[] } | undefined;
    const value: TenantEntitlement = row
      ? { tenantStatus: row.tenant_status, subscriptionStatus: row.sub_status, planKey: row.plan_key, modules: new Set(row.modules), userLimit: row.user_limit }
      : { tenantStatus: 'closed', subscriptionStatus: null, planKey: null, modules: new Set(), userLimit: null };
    this.cache.set(tenantId, { at: Date.now(), value });
    return value;
  }

  /** How the tenant may use a module it is entitled to, given subscription and tenant state. */
  static accessMode(e: TenantEntitlement, expiryPolicy: 'read-only' | 'hidden-keep-data'): AccessMode {
    if (e.tenantStatus === 'closed') return 'blocked';
    if (e.tenantStatus === 'suspended') return 'read-only';
    if (e.subscriptionStatus === 'expired' || e.subscriptionStatus === 'canceled') return expiryPolicy;
    return 'full';
  }
}
