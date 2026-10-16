import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { META_ALLOW_READ_ONLY, META_PERMISSION, META_PUBLIC, REQUEST_CONTEXT_KEY, type PermissionRequirement } from '@mohandesyar/module-sdk/server';
import { Services } from '../../app/services.js';
import { buildIdentity } from './identity.js';
import { ADMIN_KEY, IDENTITY_KEY, META_CONSOLE, META_MODULE, type AdminIdentity, type Identity, type PlatformRole } from './context.js';
import { forbidden, unauthorized, ApiError } from './errors.js';
import { HttpStatus } from '@nestjs/common';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface Req {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  [key: string]: unknown;
}

const MODULE_REASON: Record<string, [string, string]> = {
  NOT_LOADED: ['MODULE_UNAVAILABLE', 'این ماژول روی سرور در دسترس نیست'],
  DISABLED: ['MODULE_DISABLED', 'این ماژول برای سازمان شما فعال نیست'],
  NOT_ENTITLED: ['MODULE_NOT_ENTITLED', 'این ماژول در اشتراک سازمان شما نیست'],
  DEPENDENCY_INACTIVE: ['MODULE_DEPENDENCY_INACTIVE', 'ماژول‌های پیش‌نیاز این بخش فعال نیستند'],
  BLOCKED: ['TENANT_BLOCKED', 'دسترسی سازمان مسدود است'],
};

/**
 * The single server-side gate for every route (docs/02 §5):
 *   public? → authenticate (audience app|console, live session) → tenant & company scope →
 *   module effective? → entitlement mode (read-only blocks writes) → permission (deny by default on module routes).
 */
@Injectable()
export class CoreGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(Services) private readonly s: Services,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(META_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<Req>();
    const auth = req.headers.authorization;
    const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) throw unauthorized();

    const consoleRoles = this.reflector.getAllAndOverride<PlatformRole[] | undefined>(META_CONSOLE, targets);
    if (consoleRoles) return this.console(req, token, consoleRoles);

    const claims = await this.s.jwt.verify(token, 'app').catch(() => null);
    if (!claims?.tid || !(await this.s.auth.isSessionActive(claims.sid))) throw unauthorized();
    const tenant = await this.s.tenancy.getTenant(claims.tid);
    if (!tenant || tenant.status === 'closed') throw forbidden('TENANT_CLOSED', 'حساب این سازمان بسته شده است');
    if (tenant.status === 'pending') throw forbidden('TENANT_PENDING', 'درخواست ثبت‌نام سازمان شما در انتظار تأیید مدیر سامانه است');

    const identity = await this.identity(claims.sub, claims.tid, claims.sid, claims.amr, req.headers['x-company-id']);
    req[IDENTITY_KEY] = identity;

    const moduleId = this.reflector.getAllAndOverride<string | undefined>(META_MODULE, targets);
    const perm = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(META_PERMISSION, targets);
    const allowReadOnly = this.reflector.getAllAndOverride<boolean>(META_ALLOW_READ_ONLY, targets);

    if (moduleId) {
      const check = await this.s.registry.check(identity.tenantId, moduleId);
      if (!check.ok) {
        const [code, msg] = MODULE_REASON[check.reason]!;
        throw forbidden(code, msg);
      }
      if (check.mode !== 'full' && MUTATING.has(req.method) && !allowReadOnly) {
        throw new ApiError(HttpStatus.FORBIDDEN, 'SUBSCRIPTION_READ_ONLY', 'اشتراک سازمان منقضی شده است؛ فقط مشاهده و خروجی ممکن است');
      }
      if (!perm) throw forbidden('PERMISSION_UNDECLARED', 'این مسیر مجوز تعریف‌شده ندارد');
      if (!identity.permissions.can(perm.key, perm.scope)) throw forbidden();
      req[REQUEST_CONTEXT_KEY] = await this.s.contexts.forRequest(check.module, identity);
      return true;
    }

    if (tenant.status === 'suspended' && MUTATING.has(req.method) && !allowReadOnly) {
      throw forbidden('TENANT_SUSPENDED', 'حساب سازمان تعلیق شده است؛ فقط مشاهده ممکن است');
    }
    if (perm && !identity.permissions.can(perm.key, perm.scope)) throw forbidden();
    return true;
  }

  private async console(req: Req, token: string, roles: PlatformRole[]): Promise<boolean> {
    const claims = await this.s.jwt.verify(token, 'console').catch(() => null);
    if (!claims || !(await this.s.auth.isSessionActive(claims.sid))) throw unauthorized();
    if (!claims.amr.includes('otp')) throw unauthorized('MFA_REQUIRED', 'ورود به پنل مدیریت بدون تأیید دومرحله‌ای ممکن نیست');
    const admin = await this.s.auth.adminProfile(claims.sub);
    if (!admin) throw unauthorized();
    const adminRoles = admin.roles as PlatformRole[];
    if (roles.length && !roles.some((r) => adminRoles.includes(r))) throw forbidden();
    const identity: AdminIdentity = { adminId: admin.id, sessionId: claims.sid, roles: adminRoles, otpAt: claims.otp_at ?? null };
    req[ADMIN_KEY] = identity;
    return true;
  }
  private identity(userId: string, tenantId: string, sessionId: string, amr: string[], companyHeader: string | string[] | undefined): Promise<Identity> {
    return buildIdentity(this.s, { userId, tenantId, sessionId, amr, companyHeader });
  }
}
