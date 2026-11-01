import { describe, expect, it } from 'vitest';
import { EntitlementService, type TenantEntitlement } from '../../src/core/entitlement/entitlement.service.js';

const base: TenantEntitlement = { tenantStatus: 'active', subscriptionStatus: 'active', planKey: 'pro', modules: new Set(['x']), userLimit: 10 };

describe('access mode truth table (docs/09 §2)', () => {
  it.each([
    ['active', 'trialing', 'read-only', 'full'],
    ['active', 'active', 'read-only', 'full'],
    ['active', 'past_due', 'read-only', 'full'],
    ['active', 'expired', 'read-only', 'read-only'],
    ['active', 'canceled', 'read-only', 'read-only'],
    ['active', 'expired', 'hidden-keep-data', 'hidden-keep-data'],
    ['active', null, 'read-only', 'full'],
    ['trial', 'trialing', 'read-only', 'full'],
    ['suspended', 'active', 'read-only', 'read-only'],
    ['suspended', 'active', 'hidden-keep-data', 'read-only'],
    ['closed', 'active', 'read-only', 'blocked'],
  ] as const)('tenant=%s subscription=%s policy=%s → %s', (tenantStatus, subscriptionStatus, policy, expected) => {
    expect(EntitlementService.accessMode({ ...base, tenantStatus, subscriptionStatus }, policy)).toBe(expected);
  });
});
