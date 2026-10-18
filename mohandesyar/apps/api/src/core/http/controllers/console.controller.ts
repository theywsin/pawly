import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { Services } from '../../../app/services.js';
import { uuidv7 } from '../../../infra/ids.js';
import { Console, CurrentAdmin, RequestMetaParam, type AdminIdentity } from '../context.js';
import { badRequest, forbidden, notFound, parse } from '../errors.js';
import type { RequestMeta } from '../../auth/auth.service.js';
import type { Actor } from '../../modules/lifecycle.service.js';

const otpBody = z.object({ otp: z.string().regex(/^\d{6}$/, 'کد تأیید دومرحله‌ای ۶ رقمی لازم است') });
const MODULE_ID = z.string().regex(/^[a-z][a-z0-9-]{1,30}$/);

interface MultipartReq {
  file(opts?: { limits?: { fileSize?: number } }): Promise<{ filename: string; file: NodeJS.ReadableStream & { truncated?: boolean } } | undefined>;
}

/** Platform console (docs/04 §4). Module operations require the tech-admin role and a fresh TOTP code. */
@Controller('console')
export class ConsoleController {
  constructor(@Inject(Services) private readonly s: Services) {}

  private actor(a: AdminIdentity, meta: RequestMeta): Actor {
    return { type: 'admin', id: a.adminId, ip: meta.ip };
  }

  private async fresh2fa(a: AdminIdentity, body: unknown): Promise<void> {
    const { otp } = parse(otpBody, body);
    if (!(await this.s.auth.checkTotp('admin', a.adminId, otp))) throw forbidden('INVALID_OTP', 'کد تأیید دومرحله‌ای نادرست است');
  }

  // ---------------------------------------------------------------- modules

  @Console()
  @Get('modules')
  async modules() {
    const [mods, counts, runtime] = await Promise.all([
      this.s.db.app.execute(sql`SELECT m.*, v.manifest, v.signer_key_id, v.package_sha256 FROM core_modules m
        LEFT JOIN core_module_versions v ON v.module_id = m.id AND v.version = m.active_version ORDER BY m.id`),
      this.s.db.app.execute(sql`SELECT module_id, count(*)::int AS n FROM core_tenant_modules WHERE enabled GROUP BY module_id`),
      this.s.db.app.execute(sql`SELECT * FROM core_module_runtime_status WHERE reported_at > now() - interval '1 day' ORDER BY instance_id`),
    ]);
    const tenantCount = new Map((counts.rows as { module_id: string; n: number }[]).map((r) => [r.module_id, r.n]));
    return (mods.rows as { id: string; manifest: { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> } | null }[]).map((m) => ({
      ...m,
      activeTenants: tenantCount.get(m.id) ?? 0,
      dependencies: m.manifest?.dependencies ?? {},
      optionalDependencies: m.manifest?.optionalDependencies ?? {},
      runtime: (runtime.rows as { module_id: string }[]).filter((r) => r.module_id === m.id),
    }));
  }

  @Console('tech_admin')
  @Post('modules/upload')
  @HttpCode(200)
  async upload(@Req() req: MultipartReq, @CurrentAdmin() a: AdminIdentity, @RequestMetaParam() meta: RequestMeta) {
    const part = await req.file({ limits: { fileSize: 50 * 1024 * 1024 } });
    if (!part) throw badRequest('NO_FILE', 'فایل بسته ارسال نشده است');
    await mkdir(this.s.config.MODULE_UPLOAD_DIR, { recursive: true });
    const tmp = join(this.s.config.MODULE_UPLOAD_DIR, `incoming-${uuidv7()}.mypkg`);
    await pipeline(part.file, createWriteStream(tmp));
    if (part.file.truncated) throw badRequest('TOO_LARGE', 'حجم بسته بیش از ۵۰ مگابایت است');
    return this.s.lifecycle.upload(tmp, this.actor(a, meta));
  }

  @Console('tech_admin')
  @Get('modules/uploads/:uploadId')
  upload_(@Param('uploadId') uploadId: string) {
    return this.s.lifecycle.getUpload(parse(z.uuid(), uploadId));
  }

  @Console('tech_admin')
  @Post('modules/install')
  @HttpCode(200)
  async install(@Body() body: unknown, @CurrentAdmin() a: AdminIdentity, @RequestMetaParam() meta: RequestMeta) {
    await this.fresh2fa(a, body);
    const { uploadId, enableGlobally } = parse(z.object({ uploadId: z.uuid(), enableGlobally: z.boolean().default(false) }), body);
    const r = await this.s.lifecycle.install(uploadId, this.actor(a, meta));
    if (enableGlobally) await this.s.lifecycle.setGlobal(r.moduleId, true, this.actor(a, meta));
    return r;
  }

  @Console('tech_admin')
  @Post('modules/:moduleId/global')
  @HttpCode(200)
  async global(@Param('moduleId') moduleId: string, @Body() body: unknown, @CurrentAdmin() a: AdminIdentity, @RequestMetaParam() meta: RequestMeta) {
    const { enabled } = parse(z.object({ enabled: z.boolean() }), body);
    await this.s.lifecycle.setGlobal(parse(MODULE_ID, moduleId), enabled, this.actor(a, meta));
    return { ok: true };
  }

  @Console('tech_admin', 'sales_admin', 'super_admin')
  @Get('modules/:moduleId/tenants')
  async moduleTenants(@Param('moduleId') moduleId: string) {
    const r = await this.s.db.app.execute(sql`SELECT t.id, t.name, t.slug, t.status, coalesce(tm.enabled, false) AS enabled, tm.enabled_at, tm.disabled_at
      FROM core_tenants t LEFT JOIN core_tenant_modules tm ON tm.tenant_id = t.id AND tm.module_id = ${parse(MODULE_ID, moduleId)} ORDER BY t.name`);
    return r.rows;
  }

  @Console('tech_admin', 'sales_admin', 'super_admin')
  @Post('modules/:moduleId/tenants')
  @HttpCode(200)
  async setTenants(@Param('moduleId') moduleId: string, @Body() body: unknown, @CurrentAdmin() a: AdminIdentity, @RequestMetaParam() meta: RequestMeta) {
    const b = parse(z.object({ tenantIds: z.array(z.uuid()).min(1).max(500), enabled: z.boolean() }), body);
    const results: { tenantId: string; ok: boolean; error?: string }[] = [];
    for (const tenantId of b.tenantIds) {
      try {
        await this.s.lifecycle.setTenant(tenantId, parse(MODULE_ID, moduleId), b.enabled, this.actor(a, meta));
        results.push({ tenantId, ok: true });
      } catch (err) {
        results.push({ tenantId, ok: false, error: (err as { response?: { message?: string } }).response?.message ?? (err as Error).message });
      }
    }
    return { results };
  }

  @Console('tech_admin')
  @Post('modules/:moduleId/rollback')
  @HttpCode(200)
  async rollback(@Param('moduleId') moduleId: string, @Body() body: unknown, @CurrentAdmin() a: AdminIdentity, @RequestMetaParam() meta: RequestMeta) {
    await this.fresh2fa(a, body);
    return this.s.lifecycle.rollback(parse(MODULE_ID, moduleId), this.actor(a, meta));
  }

  @Console('tech_admin')
  @Get('modules/:moduleId/uninstall-preview')
  uninstallPreview(@Param('moduleId') moduleId: string) {
    return this.s.lifecycle.uninstallPreview(parse(MODULE_ID, moduleId));
  }

  @Console('tech_admin')
  @Post('modules/:moduleId/uninstall')
  @HttpCode(200)
  async uninstall(@Param('moduleId') moduleId: string, @Body() body: unknown, @CurrentAdmin() a: AdminIdentity, @RequestMetaParam() meta: RequestMeta) {
    await this.fresh2fa(a, body);
    const b = parse(z.object({ purgeData: z.boolean().default(false), confirmName: z.string() }), body);
    return this.s.lifecycle.uninstall(parse(MODULE_ID, moduleId), b, this.actor(a, meta));
  }

  @Console()
  @Get('modules/operations')
  operations(@Query('moduleId') moduleId?: string) {
    return this.s.lifecycle.operations(moduleId);
  }

  @Console()
  @Get('modules/operations/:opId')
  operation(@Param('opId') opId: string) {
    return this.s.lifecycle.operation(parse(z.uuid(), opId));
  }

  // ---------------------------------------------------------------- trusted keys

  @Console('tech_admin')
  @Get('keys')
  async keys() {
    return (await this.s.db.app.execute(sql`SELECT key_id, label, status, created_at, revoked_at FROM core_trusted_keys ORDER BY created_at`)).rows;
  }

  @Console('tech_admin')
  @Post('keys')
  async addKey(@Body() body: unknown, @CurrentAdmin() a: AdminIdentity, @RequestMetaParam() meta: RequestMeta) {
    await this.fresh2fa(a, body);
    const b = parse(z.object({ publicKeyPem: z.string().min(40).max(2000), label: z.string().min(1).max(100) }), body);
    return { keyId: await this.s.lifecycle.addTrustedKey(b.publicKeyPem, b.label, this.actor(a, meta)) };
  }

  @Console('tech_admin')
  @Post('keys/:keyId/revoke')
  @HttpCode(200)
  async revokeKey(@Param('keyId') keyId: string, @Body() body: unknown, @CurrentAdmin() a: AdminIdentity, @RequestMetaParam() meta: RequestMeta) {
    await this.fresh2fa(a, body);
    await this.s.lifecycle.revokeTrustedKey(keyId, this.actor(a, meta));
    return { ok: true };
  }

  // ---------------------------------------------------------------- tenants & plans

  @Console('super_admin', 'sales_admin', 'tech_admin', 'support')
  @Get('tenants')
  async tenants() {
    const r = await this.s.db.app.execute(sql`SELECT t.id, t.slug, t.name, t.status, t.created_at, u.active_users, u.companies, u.storage_bytes,
        s.plan_key, s.status AS subscription_status, s.period_end,
        (SELECT coalesce(array_agg(module_id ORDER BY module_id), '{}') FROM core_tenant_modules tm WHERE tm.tenant_id = t.id AND tm.enabled) AS modules
      FROM core_tenants t JOIN core_tenant_usage() u ON u.tenant_id = t.id LEFT JOIN core_subscriptions s ON s.tenant_id = t.id ORDER BY t.created_at DESC`);
    return r.rows;
  }

  @Console('super_admin', 'sales_admin')
  @Post('tenants/:tenantId/status')
  @HttpCode(200)
  async tenantStatus(@Param('tenantId') tenantId: string, @Body() body: unknown, @CurrentAdmin() a: AdminIdentity, @RequestMetaParam() meta: RequestMeta) {
    const { status } = parse(z.object({ status: z.enum(['active', 'suspended']) }), body);
    const r = await this.s.db.app.execute(sql`UPDATE core_tenants SET status = ${status}, updated_at = now() WHERE id = ${parse(z.uuid(), tenantId)} RETURNING id`);
    if (!r.rows.length) throw notFound();
    this.s.entitlement.invalidate(tenantId);
    await this.s.audit.append({ tenantId: null, actorType: 'admin', actorId: a.adminId, action: `tenant.${status === 'active' ? 'activated' : 'suspended'}`, entityType: 'tenant', entityId: tenantId, ip: meta.ip });
    return { ok: true };
  }

  @Console('super_admin', 'sales_admin', 'tech_admin')
  @Get('plans')
  async plans() {
    const r = await this.s.db.app.execute(sql`SELECT p.*, coalesce(json_agg(json_build_object('moduleId', pm.module_id, 'included', pm.included, 'addonPrice', pm.addon_price))
      FILTER (WHERE pm.module_id IS NOT NULL), '[]') AS modules FROM core_plans p LEFT JOIN core_plan_modules pm ON pm.plan_key = p.key GROUP BY p.key ORDER BY p.sort`);
    return r.rows;
  }

  @Console('super_admin', 'sales_admin')
  @Put('plans/:key')
  async upsertPlan(@Param('key') key: string, @Body() body: unknown, @CurrentAdmin() a: AdminIdentity, @RequestMetaParam() meta: RequestMeta) {
    const b = parse(
      z.object({
        name: z.string().min(1).max(80),
        description: z.string().max(1000).default(''),
        priceMonthly: z.number().int().nonnegative().nullable().default(null),
        priceYearly: z.number().int().nonnegative().nullable().default(null),
        userLimit: z.number().int().positive().nullable().default(null),
        storageGb: z.number().int().positive().nullable().default(null),
        isPublic: z.boolean().default(true),
        sort: z.number().int().default(0),
        features: z.record(z.string(), z.unknown()).default({}),
        modules: z.array(z.object({ moduleId: MODULE_ID, included: z.boolean().default(true), addonPrice: z.number().int().nonnegative().nullable().default(null) })).default([]),
      }),
      body,
    );
    const k = parse(z.string().regex(/^[a-z][a-z0-9_-]{1,30}$/), key);
    await this.s.db.app.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO core_plans (key, name, description, price_monthly, price_yearly, user_limit, storage_gb, features, is_public, sort)
        VALUES (${k}, ${b.name}, ${b.description}, ${b.priceMonthly}, ${b.priceYearly}, ${b.userLimit}, ${b.storageGb}, ${JSON.stringify(b.features)}::jsonb, ${b.isPublic}, ${b.sort})
        ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, price_monthly = EXCLUDED.price_monthly, price_yearly = EXCLUDED.price_yearly,
          user_limit = EXCLUDED.user_limit, storage_gb = EXCLUDED.storage_gb, features = EXCLUDED.features, is_public = EXCLUDED.is_public, sort = EXCLUDED.sort`);
      await tx.execute(sql`DELETE FROM core_plan_modules WHERE plan_key = ${k}`);
      for (const m of b.modules) {
        await tx.execute(sql`INSERT INTO core_plan_modules (plan_key, module_id, included, addon_price) VALUES (${k}, ${m.moduleId}, ${m.included}, ${m.addonPrice})`);
      }
    });
    this.s.entitlement.invalidate();
    await this.s.audit.append({ tenantId: null, actorType: 'admin', actorId: a.adminId, action: 'plan.saved', entityType: 'plan', entityId: k, after: b, ip: meta.ip });
    return { ok: true };
  }

  // ---------------------------------------------------------------- audit & system

  @Console('super_admin', 'tech_admin')
  @Get('audit')
  async audit(@Query('before') before?: string) {
    return (await this.s.db.app.execute(sql`SELECT * FROM core_audit_platform(200, ${before ? Number(before) : null})`)).rows;
  }

  @Console('super_admin', 'tech_admin')
  @Get('audit/verify')
  async verify() {
    const broken = await this.s.audit.verifyChain();
    return { intact: broken === null, firstBrokenId: broken };
  }

  @Console()
  @Get('system')
  async system() {
    const runtime = await this.s.db.app.execute(sql`SELECT * FROM core_module_runtime_status ORDER BY instance_id, module_id`);
    const outbox = await this.s.db.app.execute(sql`SELECT status, n::int AS n FROM core_outbox_stats()`);
    return {
      instance: this.s.instanceId,
      bootedAt: this.s.bootedAt,
      runtime: runtime.rows,
      outbox: outbox.rows,
      email: { enabled: this.s.mailer.enabled, queue: await this.s.mailer.stats() },
      loadErrors: Object.fromEntries(this.s.registry.loadErrors),
    };
  }

  /** Sends a test message through the configured SMTP server, reporting the server's error if any. */
  @Console('super_admin', 'tech_admin')
  @Post('system/test-email')
  @HttpCode(200)
  async testEmail(@Body() body: unknown, @CurrentAdmin() a: AdminIdentity) {
    const b = parse(z.object({ to: z.email('ایمیل معتبر نیست') }), body);
    if (!this.s.mailer.enabled) throw badRequest('SMTP_NOT_CONFIGURED', 'سرور ایمیل (SMTP_URL) تنظیم نشده است');
    try {
      await this.s.mailer.sendNow(b.to, 'ایمیل آزمایشی مهندیکس', 'این پیام برای آزمایش تنظیمات ایمیل سامانه ارسال شده است.');
    } catch (err) {
      throw badRequest('SMTP_FAILED', `ارسال ناموفق بود: ${(err as Error).message}`);
    }
    await this.s.audit.append({ tenantId: null, actorType: 'admin', actorId: a.adminId, action: 'system.test_email', after: { to: b.to } });
    return { ok: true };
  }

  // ---------------------------------------------------------------- tenant approval, signup policy

  @Console('super_admin', 'sales_admin')
  @Post('tenants/:tenantId/approve')
  @HttpCode(200)
  async approveTenant(@Param('tenantId') tenantId: string, @CurrentAdmin() a: AdminIdentity, @RequestMetaParam() meta: RequestMeta) {
    const r = await this.s.db.app.execute(sql`UPDATE core_tenants SET status = 'active', updated_at = now() WHERE id = ${parse(z.uuid(), tenantId)} AND status = 'pending' RETURNING id`);
    if (!r.rows.length) throw notFound('سازمانی در انتظار تأیید با این شناسه یافت نشد');
    this.s.entitlement.invalidate(tenantId);
    await this.s.audit.append({ tenantId: null, actorType: 'admin', actorId: a.adminId, action: 'tenant.approved', entityType: 'tenant', entityId: tenantId, ip: meta.ip });
    return { ok: true };
  }

  @Console()
  @Get('settings/signup')
  async signupSettings() {
    return { mode: await this.s.site.signupMode() };
  }

  @Console('super_admin', 'sales_admin')
  @Put('settings/signup')
  async setSignup(@Body() body: unknown, @CurrentAdmin() a: AdminIdentity) {
    const { mode } = parse(z.object({ mode: z.enum(['open', 'approval', 'closed']) }), body);
    await this.s.site.setSignupMode(mode, a.adminId);
    return { mode };
  }

  @Console('super_admin', 'sales_admin')
  @Post('plans/:key/archive')
  @HttpCode(200)
  async archivePlan(@Param('key') key: string, @Body() body: unknown, @CurrentAdmin() a: AdminIdentity) {
    const { archived } = parse(z.object({ archived: z.boolean() }), body);
    const r = await this.s.db.app.execute(sql`UPDATE core_plans SET status = ${archived ? 'archived' : 'active'} WHERE key = ${key} RETURNING key`);
    if (!r.rows.length) throw notFound();
    this.s.entitlement.invalidate();
    await this.s.audit.append({ tenantId: null, actorType: 'admin', actorId: a.adminId, action: archived ? 'plan.archived' : 'plan.restored', entityType: 'plan', entityId: key });
    return { ok: true };
  }

  // ---------------------------------------------------------------- leads (demo/contact requests)

  @Console('super_admin', 'sales_admin', 'support')
  @Get('leads')
  leads(@Query('status') status?: string, @Query('kind') kind?: string) {
    return this.s.site.listLeads({ status, kind });
  }

  @Console('super_admin', 'sales_admin', 'support')
  @Get('leads/:id')
  lead(@Param('id') id: string) {
    return this.s.site.lead(parse(z.uuid(), id));
  }

  @Console('super_admin', 'sales_admin')
  @Post('leads/:id')
  @HttpCode(200)
  async updateLead(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() a: AdminIdentity) {
    const b = parse(z.object({ status: z.enum(['new', 'contacted', 'qualified', 'won', 'lost', 'spam']).optional(), note: z.string().trim().min(1).max(4000).optional() }), body);
    await this.s.site.updateLead(parse(z.uuid(), id), b, a.adminId);
    return { ok: true };
  }

  // ---------------------------------------------------------------- landing content

  @Console('super_admin', 'sales_admin')
  @Get('content')
  async content() {
    return { content: await this.s.site.allContent(), faq: await this.s.site.listFaq() };
  }

  @Console('super_admin', 'sales_admin')
  @Put('content/:key')
  async setContent(@Param('key') key: string, @Body() body: unknown, @CurrentAdmin() a: AdminIdentity) {
    const k = parse(z.enum(['contact', 'about', 'terms', 'privacy']), key);
    try {
      return { value: await this.s.site.setContent(k, body, a.adminId) };
    } catch (err) {
      if (err instanceof z.ZodError) throw badRequest('VALIDATION_FAILED', 'محتوا معتبر نیست', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
      throw err;
    }
  }

  @Console('super_admin', 'sales_admin')
  @Post('content/:key/delete')
  @HttpCode(200)
  async deleteContent(@Param('key') key: string, @CurrentAdmin() a: AdminIdentity) {
    await this.s.site.deleteContent(parse(z.enum(['contact', 'about', 'terms', 'privacy']), key), a.adminId);
    return { ok: true };
  }

  @Console('super_admin', 'sales_admin')
  @Put('faq/:id')
  async saveFaq(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() a: AdminIdentity) {
    const { faqSchema } = await import('../../../platform/site.service.js');
    return { id: await this.s.site.saveFaq(id === 'new' ? null : parse(z.uuid(), id), parse(faqSchema, body), a.adminId) };
  }

  @Console('super_admin', 'sales_admin')
  @Post('faq/:id/delete')
  @HttpCode(200)
  async deleteFaq(@Param('id') id: string, @CurrentAdmin() a: AdminIdentity) {
    await this.s.site.deleteFaq(parse(z.uuid(), id), a.adminId);
    return { ok: true };
  }
}
