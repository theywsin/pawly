import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Grant, PermissionSet } from '../rbac/permissions.js';

export const META_CONSOLE = 'mohandesyar:console';
export const META_MODULE = 'mohandesyar:module';

export type PlatformRole = 'super_admin' | 'tech_admin' | 'sales_admin' | 'support';

/** Marks a console (platform admin) route; with roles, at least one is required. */
export const Console = (...roles: PlatformRole[]) => SetMetadata(META_CONSOLE, roles);

export interface Identity {
  userId: string;
  tenantId: string;
  sessionId: string;
  membershipId: string;
  companyId: string;
  companyIds: string[];
  allowedCompanyIds: string[];
  permissions: PermissionSet;
  /** All grants of the membership (per company or tenant-wide), e.g. for holding-level checks. */
  grants: readonly Grant[];
  amr: string[];
}

export interface AdminIdentity {
  adminId: string;
  sessionId: string;
  roles: PlatformRole[];
  otpAt: number | null;
}

export const IDENTITY_KEY = 'mohandesyarIdentity';
export const ADMIN_KEY = 'mohandesyarAdmin';

export const CurrentIdentity = createParamDecorator((_d: unknown, ctx: ExecutionContext): Identity => {
  const v = ctx.switchToHttp().getRequest<Record<string, unknown>>()[IDENTITY_KEY];
  if (!v) throw new Error('identity missing');
  return v as Identity;
});

export const CurrentAdmin = createParamDecorator((_d: unknown, ctx: ExecutionContext): AdminIdentity => {
  const v = ctx.switchToHttp().getRequest<Record<string, unknown>>()[ADMIN_KEY];
  if (!v) throw new Error('admin identity missing');
  return v as AdminIdentity;
});

export const RequestMetaParam = createParamDecorator((_d: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<{ ip?: string; headers: Record<string, string | undefined> }>();
  return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
});
