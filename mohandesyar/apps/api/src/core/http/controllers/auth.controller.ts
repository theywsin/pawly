import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { Public } from '@mohandesyar/module-sdk/server';
import { z } from 'zod';
import { Services } from '../../../app/services.js';
import type { LoginResult, RequestMeta } from '../../auth/auth.service.js';
import { REFRESH_TTL_DAYS } from '../../auth/auth.service.js';
import { CurrentAdmin, CurrentIdentity, RequestMetaParam, Console, type AdminIdentity, type Identity } from '../context.js';
import { badRequest, forbidden, parse, tooMany, unauthorized } from '../errors.js';
import { rateLimit } from '../../../infra/redis.js';

interface Reply {
  setCookie(name: string, value: string, opts: Record<string, unknown>): void;
  clearCookie(name: string, opts: Record<string, unknown>): void;
}
interface CookieReq {
  cookies: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
}

const loginSchema = z.object({ email: z.email('ایمیل معتبر نیست'), password: z.string().min(1).max(200), tenantId: z.uuid().optional() });
const otpSchema = z.object({ pendingToken: z.string().min(10), code: z.string().regex(/^\d{6}$/, 'کد باید ۶ رقم باشد') });
const pendingSchema = z.object({ pendingToken: z.string().min(10) });
const signupSchema = z.object({
  fullName: z.string().trim().min(2, 'نام را کامل وارد کنید').max(120),
  email: z.email('ایمیل معتبر نیست'),
  password: z.string().max(128),
  tenantName: z.string().trim().min(2, 'نام سازمان الزامی است').max(120),
  companyName: z.string().trim().min(2).max(120).optional(),
  /** Plan chosen on the pricing page: the trial (if any) runs on it and checkout follows. */
  planKey: z.string().max(40).optional(),
});
const passwordSchema = z.object({ current: z.string().min(1), next: z.string().min(1).max(128) });

function cookieName(kind: 'user' | 'admin') {
  return kind === 'user' ? { name: 'my_rt', path: '/api/auth' } : { name: 'my_crt', path: '/api/console/auth' };
}

/** CSRF defence for cookie-authenticated endpoints: require a custom header (forces a CORS preflight). */
function requireCsrfHeader(req: CookieReq) {
  if (req.headers['x-requested-with'] !== 'mohandesyar') throw unauthorized('CSRF', 'درخواست نامعتبر است');
}

abstract class BaseAuth {
  constructor(protected readonly s: Services) {}

  protected respond(kind: 'user' | 'admin', r: LoginResult, reply: Reply) {
    if (r.refreshToken) {
      const c = cookieName(kind);
      reply.setCookie(c.name, r.refreshToken, {
        path: c.path,
        httpOnly: true,
        sameSite: 'strict',
        secure: this.s.config.COOKIE_SECURE,
        maxAge: REFRESH_TTL_DAYS * 86400,
      });
    }
    const { refreshToken: _rt, ...rest } = r;
    return rest;
  }

  protected async doRefresh(kind: 'user' | 'admin', req: CookieReq, reply: Reply, meta: RequestMeta) {
    requireCsrfHeader(req);
    const token = req.cookies[cookieName(kind).name];
    if (!token) throw unauthorized('NO_SESSION');
    return this.respond(kind, await this.s.auth.refresh(kind, token, meta), reply);
  }

  protected async doLogout(kind: 'user' | 'admin', req: CookieReq, reply: Reply, sid?: string) {
    requireCsrfHeader(req);
    await this.s.auth.logout(kind, req.cookies[cookieName(kind).name], sid);
    reply.clearCookie(cookieName(kind).name, { path: cookieName(kind).path });
    return { ok: true };
  }
}

@Controller('auth')
export class AuthController extends BaseAuth {
  constructor(@Inject(Services) s: Services) {
    super(s);
  }

  @Public()
  @Post('signup')
  async signup(@Body() body: unknown, @Res({ passthrough: true }) reply: Reply, @RequestMetaParam() meta: RequestMeta) {
    const input = parse(signupSchema, body);
    const mode = await this.s.site.signupMode();
    if (mode === 'closed') throw forbidden('SIGNUP_CLOSED', 'ثبت‌نام عمومی در حال حاضر بسته است؛ از صفحه تماس با ما در ارتباط باشید');
    if (!(await rateLimit(this.s.redis, `signup:${meta.ip ?? '-'}`, 10, 3600))) throw tooMany();
    const { sql } = await import('drizzle-orm');
    // The chosen public plan, else the plan marked as the signup default.
    const plans = await this.s.db.app.execute(sql`SELECT key, (features->>'trialDays')::int AS trial FROM core_plans
      WHERE status = 'active' AND (${input.planKey ? sql`key = ${input.planKey} AND is_public` : sql`(features->>'signupDefault')::boolean IS TRUE`}) LIMIT 1`);
    const plan = plans.rows[0] as { key: string; trial: number | null } | undefined;
    // The console's trial length wins over the plan's; 0 means no trial (read-only until the first payment).
    const trialSetting = (await this.s.billing.settings()).trialDays;
    const r = await this.s.tenancy.signup(
      { fullName: input.fullName, email: input.email, password: input.password, tenantName: input.tenantName, companyName: input.companyName ?? input.tenantName },
      { defaultPlan: plan?.key, trialDays: trialSetting ?? plan?.trial ?? undefined, pendingApproval: mode === 'approval' },
    );
    if (mode === 'approval') return { pendingApproval: true, tenantId: r.tenantId };
    const login = await this.s.auth.login('user', input.email, input.password, r.tenantId, meta);
    return { ...this.respond('user', login, reply), tenantId: r.tenantId };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) reply: Reply, @RequestMetaParam() meta: RequestMeta) {
    const b = parse(loginSchema, body);
    return this.respond('user', await this.s.auth.login('user', b.email, b.password, b.tenantId, meta), reply);
  }

  @Public()
  @Post('2fa')
  @HttpCode(200)
  async secondFactor(@Body() body: unknown, @Res({ passthrough: true }) reply: Reply, @RequestMetaParam() meta: RequestMeta) {
    const b = parse(otpSchema, body);
    return this.respond('user', await this.s.auth.verifySecondFactor('user', b.pendingToken, b.code, meta), reply);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Req() req: CookieReq, @Res({ passthrough: true }) reply: Reply, @RequestMetaParam() meta: RequestMeta) {
    return this.doRefresh('user', req, reply, meta);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Req() req: CookieReq, @Res({ passthrough: true }) reply: Reply) {
    return this.doLogout('user', req, reply);
  }

  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(@CurrentIdentity() id: Identity, @Res({ passthrough: true }) reply: Reply, @RequestMetaParam() meta: RequestMeta) {
    const n = await this.s.auth.logoutAll('user', id.userId, meta);
    reply.clearCookie('my_rt', { path: '/api/auth' });
    return { revoked: n };
  }

  @Get('sessions')
  sessions(@CurrentIdentity() id: Identity) {
    return this.s.auth.listSessions('user', id.userId);
  }

  @Post('password')
  @HttpCode(200)
  async password(@CurrentIdentity() id: Identity, @Body() body: unknown, @RequestMetaParam() meta: RequestMeta) {
    const b = parse(passwordSchema, body);
    await this.s.auth.changePassword('user', id.userId, b.current, b.next, meta);
    return { ok: true };
  }

  @Post('2fa/enroll/start')
  @HttpCode(200)
  enrollStart(@CurrentIdentity() id: Identity) {
    return this.s.auth.beginTotpEnrollment('user', { subjectId: id.userId });
  }

  @Post('2fa/enroll/confirm')
  @HttpCode(200)
  enrollConfirm(@CurrentIdentity() id: Identity, @Body() body: unknown, @RequestMetaParam() meta: RequestMeta) {
    const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), body);
    return this.s.auth.confirmTotpEnrollment('user', { subjectId: id.userId }, code, meta);
  }
}

@Controller('console/auth')
export class ConsoleAuthController extends BaseAuth {
  constructor(@Inject(Services) s: Services) {
    super(s);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) reply: Reply, @RequestMetaParam() meta: RequestMeta) {
    const b = parse(loginSchema.omit({ tenantId: true }), body);
    return this.respond('admin', await this.s.auth.login('admin', b.email, b.password, undefined, meta), reply);
  }

  @Public()
  @Post('2fa')
  @HttpCode(200)
  async secondFactor(@Body() body: unknown, @Res({ passthrough: true }) reply: Reply, @RequestMetaParam() meta: RequestMeta) {
    const b = parse(otpSchema, body);
    return this.respond('admin', await this.s.auth.verifySecondFactor('admin', b.pendingToken, b.code, meta), reply);
  }

  @Public()
  @Post('2fa/enroll/start')
  @HttpCode(200)
  enrollStart(@Body() body: unknown) {
    return this.s.auth.beginTotpEnrollment('admin', parse(pendingSchema, body));
  }

  @Public()
  @Post('2fa/enroll/confirm')
  @HttpCode(200)
  async enrollConfirm(@Body() body: unknown, @Res({ passthrough: true }) reply: Reply, @RequestMetaParam() meta: RequestMeta) {
    const b = parse(otpSchema, body);
    const r = await this.s.auth.confirmTotpEnrollment('admin', { pendingToken: b.pendingToken }, b.code, meta);
    if (!('accessToken' in r)) throw badRequest('UNEXPECTED', 'unexpected enrolment state');
    return this.respond('admin', r, reply);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Req() req: CookieReq, @Res({ passthrough: true }) reply: Reply, @RequestMetaParam() meta: RequestMeta) {
    return this.doRefresh('admin', req, reply, meta);
  }

  @Console()
  @Post('logout')
  @HttpCode(200)
  logout(@Req() req: CookieReq, @Res({ passthrough: true }) reply: Reply, @CurrentAdmin() a: AdminIdentity) {
    return this.doLogout('admin', req, reply, a.sessionId);
  }

  @Console()
  @Get('me')
  me(@CurrentAdmin() a: AdminIdentity) {
    return this.s.auth.adminProfile(a.adminId);
  }
}
