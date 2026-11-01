import type { PermissionScope } from '@mohandesyar/module-sdk';

export const SCOPE_RANK: Record<PermissionScope, number> = { own: 1, project: 2, unit: 3, company: 4 };

export interface Grant {
  permission: string;
  scope: PermissionScope;
  /** null = every company in the tenant */
  companyId: string | null;
}

const patternCache = new Map<string, RegExp>();
function toRegex(pattern: string): RegExp {
  let r = patternCache.get(pattern);
  if (!r) {
    r = new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    patternCache.set(pattern, r);
  }
  return r;
}

export function matchesPermission(pattern: string, key: string): boolean {
  return pattern === key || (pattern.includes('*') && toRegex(pattern).test(key));
}

/** Effective permission set of one member in one company. */
export class PermissionSet {
  constructor(private readonly grants: readonly Grant[]) {}

  bestScope(key: string): PermissionScope | null {
    let best: PermissionScope | null = null;
    for (const g of this.grants) {
      if (matchesPermission(g.permission, key) && (!best || SCOPE_RANK[g.scope] > SCOPE_RANK[best])) best = g.scope;
    }
    return best;
  }

  can(key: string, scope?: PermissionScope): boolean {
    const best = this.bestScope(key);
    if (!best) return false;
    return !scope || SCOPE_RANK[best] >= SCOPE_RANK[scope];
  }

  /** Concrete keys from a catalogue that this set grants (for the SPA to hide UI; never a substitute for server checks). */
  resolve(catalogue: readonly string[]): string[] {
    return catalogue.filter((k) => this.bestScope(k) !== null);
  }
}

export function forCompany(grants: readonly Grant[], companyId: string): PermissionSet {
  return new PermissionSet(grants.filter((g) => g.companyId === null || g.companyId === companyId));
}
