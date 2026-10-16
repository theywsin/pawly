import type { ServerResponse } from 'node:http';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { RequirePermission, AllowInReadOnly } from '@mohandesyar/module-sdk/server';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { Services } from '../../../app/services.js';
import { CurrentIdentity, RequestMetaParam, type Identity } from '../context.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../errors.js';
import { taskInput, taskUpdate } from '../../tasks/task.service.js';
import { toLatinDigits } from '@mohandesyar/persian';
import { channelName } from '../../notifications/notification.service.js';
import type { RequestMeta } from '../../auth/auth.service.js';
import { directoryOf, workCalendarOf } from '../../modules/context.js';
import { uuidv7 } from '../../../infra/ids.js';
import { runImport } from '../../imports/import.service.js';
import { paramsInput, savedInput } from '../../reports/report.service.js';

/** Permissions defined by the core itself (modules register theirs from their manifests). */
export const CORE_PERMISSIONS = [
  'core.user.view', 'core.user.create', 'core.user.update',
  'core.role.view', 'core.role.manage',
  'core.company.view', 'core.company.manage',
  'core.module.view', 'core.module.manage_tenant',
  'core.settings.manage', 'core.audit.view',
  'core.task.view', 'core.task.create', 'core.task.update',
  'core.file.upload', 'core.file.download',
  'core.workflow.manage_definitions', 'core.workflow.start',
] as const;

const scope = (id: Identity) => ({ tenantId: id.tenantId, companyId: id.companyId, companyIds: id.companyIds, userId: id.userId });

@Controller('core')
export class CoreController {
  constructor(@Inject(Services) private readonly s: Services) {}

  // ---------------------------------------------------------------- me / shell bootstrap

  @Get('me')
  async me(@CurrentIdentity() id: Identity) {
    const [profile, tenant, effective, catalogue, companies] = await Promise.all([
      this.s.auth.userProfile(id.userId),
      this.s.tenancy.getTenant(id.tenantId),
      this.s.registry.effectiveFor(id.tenantId),
      this.s.db.app.execute(sql`SELECT key FROM core_permissions`),
      this.s.db.tx({ tenantId: id.tenantId }, (tx) => this.s.tenancy.listCompanies(tx)),
    ]);
    const keys = [...CORE_PERMISSIONS, ...(catalogue.rows as { key: string }[]).map((r) => r.key)];
    const can = (p?: string) => !p || id.permissions.can(p);
    return {
      user: profile,
      tenant,
      company: { id: id.companyId, ids: id.companyIds },
      companies: companies.filter((c) => id.allowedCompanyIds.includes(c.id)),
      permissions: id.permissions.resolve(keys),
      modules: effective.map((m) => ({
        id: m.id,
        version: m.version,
        mode: m.mode,
        name: m.manifest.name,
        frontend: m.manifest.frontend.entry ? `/modules-assets/${m.id}/${m.version}/${m.manifest.frontend.entry}` : null,
        styles: m.manifest.frontend.styles.map((f) => `/modules-assets/${m.id}/${m.version}/${f}`),
        menu: m.manifest.menu.filter((x) => can(x.permission)),
        routes: m.manifest.routes.map((r) => ({ path: r.path, export: r.export })),
        widgets: m.manifest.widgets.filter((w) => can(w.permission)).map((w) => ({ key: w.key, title: w.title, export: w.export, sizes: w.sizes })),
        optionalDependencies: Object.keys(m.manifest.optionalDependencies),
      })),
    };
  }

  // ---------------------------------------------------------------- organisation

  @Get('companies')
  @RequirePermission('core.company.view')
  async companies(@CurrentIdentity() id: Identity) {
    return this.s.db.tx({ tenantId: id.tenantId }, (tx) => this.s.tenancy.listCompanies(tx));
  }

  @Post('companies')
  @RequirePermission('core.company.manage')
  async createCompany(@CurrentIdentity() id: Identity, @Body() body: unknown) {
    const { name } = parse(z.object({ name: z.string().trim().min(2, 'نام شرکت الزامی است').max(120) }), body);
    return { id: await this.s.tenancy.createCompany(id.tenantId, id.userId, name) };
  }

  // ---------------------------------------------------------------- onboarding & organisation profile

  @Get('onboarding')
  async onboarding(@CurrentIdentity() id: Identity) {
    const [tenant, company] = await Promise.all([this.s.tenancy.getTenant(id.tenantId), this.s.tenancy.company(id.tenantId, id.companyId)]);
    return { completedAt: tenant?.onboarding_completed_at ?? null, tenant, company };
  }

  @Put('companies/:companyId')
  @RequirePermission('core.company.manage')
  async updateCompany(@CurrentIdentity() id: Identity, @Param('companyId') companyId: string, @Body() body: unknown) {
    const cid = parse(z.uuid(), companyId);
    if (!id.allowedCompanyIds.includes(cid)) throw forbidden('COMPANY_FORBIDDEN', 'به این شرکت دسترسی ندارید');
    const b = parse(
      z.object({
        name: z.string().trim().min(2, 'نام شرکت الزامی است').max(120),
        legalName: z.string().trim().max(200).nullable().optional(),
        nationalId: z
          .string()
          .trim()
          .nullable()
          .optional()
          .transform((v) => (v ? toLatinDigits(v) : null))
          .refine((v) => !v || /^\d{11}$/.test(v), 'شناسه ملی شخص حقوقی باید ۱۱ رقم باشد'),
        economicCode: z.string().trim().max(20).nullable().optional(),
        phone: z.string().trim().max(40).nullable().optional(),
        address: z.string().trim().max(400).nullable().optional(),
      }),
      body,
    );
    await this.s.tenancy.updateCompany(id.tenantId, id.userId, cid, b);
    return { ok: true };
  }

  @Put('tenant')
  @RequirePermission('core.settings.manage')
  async updateTenant(@CurrentIdentity() id: Identity, @Body() body: unknown) {
    const b = parse(
      z.object({
        name: z.string().trim().min(2, 'نام سازمان الزامی است').max(120),
        timezone: z.string().refine((tz) => {
          try {
            new Intl.DateTimeFormat('en', { timeZone: tz });
            return true;
          } catch {
            return false;
          }
        }, 'منطقه زمانی معتبر نیست'),
        numberStyle: z.enum(['fa', 'latn']),
      }),
      body,
    );
    await this.s.tenancy.updateTenant(id.tenantId, id.userId, b);
    return { ok: true };
  }

  @Post('onboarding/complete')
  @HttpCode(200)
  @RequirePermission('core.settings.manage')
  async completeOnboarding(@CurrentIdentity() id: Identity) {
    await this.s.tenancy.completeOnboarding(id.tenantId, id.userId);
    return { ok: true };
  }

  /** Names of active members, for pickers in any module (every member may see colleagues' names). */
  @Get('directory')
  directory(@CurrentIdentity() id: Identity) {
    return directoryOf(this.s.db, id.tenantId);
  }

  /** Turn email copies of one's own notifications on or off. */
  @Put('profile/email-notifications')
  async emailNotifications(@CurrentIdentity() id: Identity, @Body() body: unknown) {
    const b = parse(z.object({ enabled: z.boolean() }), body);
    await this.s.db.app.execute(sql`UPDATE core_users SET email_notifications = ${b.enabled} WHERE id = ${id.userId}`);
    return { ok: true };
  }

  // ---------------------------------------------------------------- work calendar

  @Get('calendar')
  async calendar(@CurrentIdentity() id: Identity, @Query('year') year?: string) {
    const { fixedHolidays, toJalali, todayIso } = await import('@mohandesyar/persian');
    const jy = year ? parse(z.coerce.number().int().min(1300).max(1600), year) : toJalali(...(todayIso().split('-').map(Number) as [number, number, number])).jy;
    const cal = await workCalendarOf(this.s.db, id.tenantId);
    const custom = await this.s.db.tx({ tenantId: id.tenantId }, (tx) => tx.execute(sql`SELECT id, date::text AS date, title, kind FROM core_holidays ORDER BY date`));
    return { year: jy, weeklyOff: cal.weeklyOff, fixed: fixedHolidays(jy), holidays: custom.rows };
  }

  @Put('calendar/weekly-off')
  @RequirePermission('core.settings.manage')
  async setWeeklyOff(@CurrentIdentity() id: Identity, @Body() body: unknown) {
    const b = parse(z.object({ weeklyOff: z.array(z.number().int().min(0).max(6)).max(3) }), body);
    await this.s.db.app.execute(sql`UPDATE core_tenants SET weekly_off = ${`{${[...new Set(b.weeklyOff)].join(',')}}`}::smallint[] WHERE id = ${id.tenantId}`);
    await this.s.audit.append({ tenantId: id.tenantId, actorType: 'user', actorId: id.userId, action: 'core.calendar.weekly_off', after: b });
    return { ok: true };
  }

  @Post('calendar/holidays')
  @RequirePermission('core.settings.manage')
  async addHoliday(@CurrentIdentity() id: Identity, @Body() body: unknown) {
    const b = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ معتبر نیست'), title: z.string().trim().min(2, 'عنوان تعطیلی الزامی است').max(120), kind: z.enum(['official', 'company']).default('official') }), body);
    const hid = uuidv7();
    try {
      await this.s.db.tx({ tenantId: id.tenantId }, (tx) => tx.execute(sql`INSERT INTO core_holidays (id, tenant_id, date, title, kind, created_by) VALUES (${hid}, ${id.tenantId}, ${b.date}, ${b.title}, ${b.kind}, ${id.userId})`));
    } catch (err) {
      if ((err as { code?: string; cause?: { code?: string } }).code === '23505' || (err as { cause?: { code?: string } }).cause?.code === '23505') throw conflict('DUPLICATE', 'برای این روز قبلاً تعطیلی ثبت شده است');
      throw err;
    }
    await this.s.audit.append({ tenantId: id.tenantId, actorType: 'user', actorId: id.userId, action: 'core.calendar.holiday_added', after: b });
    return { id: hid };
  }

  @Delete('calendar/holidays/:holidayId')
  @HttpCode(200)
  @RequirePermission('core.settings.manage')
  async removeHoliday(@CurrentIdentity() id: Identity, @Param('holidayId') holidayId: string) {
    await this.s.db.tx({ tenantId: id.tenantId }, (tx) => tx.execute(sql`DELETE FROM core_holidays WHERE id = ${parse(z.uuid(), holidayId)}`));
    return { ok: true };
  }

  @Get('members')
  @RequirePermission('core.user.view')
  members(@CurrentIdentity() id: Identity) {
    return this.s.tenancy.listMembers(id.tenantId);
  }

  @Post('members')
  @RequirePermission('core.user.create')
  async addMember(@CurrentIdentity() id: Identity, @Body() body: unknown) {
    const b = parse(
      z.object({
        email: z.email('ایمیل معتبر نیست'),
        fullName: z.string().trim().min(2).max(120),
        initialPassword: z.string().max(128).optional(),
        roleKey: z.string().min(1),
        companyId: z.uuid().nullable().default(null),
      }),
      body,
    );
    if (b.companyId && !id.allowedCompanyIds.includes(b.companyId)) throw forbidden('COMPANY_FORBIDDEN', 'به این شرکت دسترسی ندارید');
    const ent = await this.s.entitlement.get(id.tenantId);
    if (ent.userLimit !== null) {
      const n = await this.s.db.tx({ tenantId: id.tenantId }, (tx) => tx.execute(sql`SELECT count(*)::int AS n FROM core_memberships WHERE status = 'active'`));
      if ((n.rows[0] as { n: number }).n >= ent.userLimit) throw forbidden('USER_LIMIT_REACHED', 'به سقف تعداد کاربران اشتراک رسیده‌اید');
    }
    return this.s.tenancy.addMember(id.tenantId, id.userId, b);
  }

  @Get('roles')
  @RequirePermission('core.role.view')
  roles(@CurrentIdentity() id: Identity) {
    return this.s.rbac.listRoles(id.tenantId);
  }

  @Put('roles/:key/approval-limit')
  @RequirePermission('core.role.manage')
  async approvalLimit(@CurrentIdentity() id: Identity, @Param('key') key: string, @Body() body: unknown) {
    const b = parse(z.object({ limit: z.string().regex(/^\d{1,20}$/, 'مبلغ معتبر نیست').nullable() }), body);
    if (!(await this.s.rbac.setApprovalLimit(id.tenantId, key, b.limit))) throw notFound();
    await this.s.audit.append({ tenantId: id.tenantId, actorType: 'user', actorId: id.userId, action: 'role.approval_limit', entityType: 'role', entityId: key, after: b });
    return { ok: true };
  }

  // ---------------------------------------------------------------- modules (tenant view)

  @Get('modules')
  @RequirePermission('core.module.view')
  async modules(@CurrentIdentity() id: Identity) {
    const [list, ent] = await Promise.all([this.s.lifecycle.tenantModules(id.tenantId), this.s.entitlement.get(id.tenantId)]);
    return (list as { id: string }[]).map((m) => ({ ...m, entitled: ent.modules.has(m.id) }));
  }

  @Post('modules/:moduleId/enable')
  @HttpCode(200)
  @RequirePermission('core.module.manage_tenant')
  async enableModule(@CurrentIdentity() id: Identity, @Param('moduleId') moduleId: string, @RequestMetaParam() meta: RequestMeta) {
    await this.s.lifecycle.setTenant(id.tenantId, moduleId, true, { type: 'user', id: id.userId, ip: meta.ip });
    return { ok: true };
  }

  @Post('modules/:moduleId/disable')
  @HttpCode(200)
  @RequirePermission('core.module.manage_tenant')
  async disableModule(@CurrentIdentity() id: Identity, @Param('moduleId') moduleId: string, @RequestMetaParam() meta: RequestMeta) {
    await this.s.lifecycle.setTenant(id.tenantId, moduleId, false, { type: 'user', id: id.userId, ip: meta.ip });
    return { ok: true };
  }

  private async activeModule(id: Identity, moduleId: string) {
    const check = await this.s.registry.check(id.tenantId, moduleId);
    if (!check.ok) throw notFound('ماژول فعال نیست');
    return check.module;
  }

  @Get('modules/:moduleId/settings')
  @RequirePermission('core.settings.manage')
  async moduleSettings(@CurrentIdentity() id: Identity, @Param('moduleId') moduleId: string) {
    const m = await this.activeModule(id, moduleId);
    return { schema: m.manifest.settings?.schema ?? null, value: await this.s.settings.getModuleSettings(id.tenantId, m.manifest) };
  }

  @Put('modules/:moduleId/settings')
  @RequirePermission('core.settings.manage')
  async putModuleSettings(@CurrentIdentity() id: Identity, @Param('moduleId') moduleId: string, @Body() body: unknown) {
    const m = await this.activeModule(id, moduleId);
    const value = await this.s.settings.setModuleSettings(id.tenantId, m.manifest, body, id.userId);
    await this.s.audit.append({ tenantId: id.tenantId, actorType: 'user', actorId: id.userId, action: 'module.settings_changed', moduleId, entityType: 'module', entityId: moduleId, after: value });
    return { value };
  }

  // ---------------------------------------------------------------- dashboard widgets & search (providers of active modules)

  @Get('widgets/:moduleId/:key')
  async widgetData(@CurrentIdentity() id: Identity, @Param('moduleId') moduleId: string, @Param('key') key: string, @Query() q: Record<string, string>) {
    const m = await this.activeModule(id, moduleId);
    const w = m.manifest.widgets.find((x) => x.key === key);
    const provider = m.definition.widgetData?.[key];
    if (!w || !provider) throw notFound();
    if (w.permission && !id.permissions.can(w.permission)) throw forbidden();
    return { data: await provider(await this.s.contexts.forRequest(m, id), q), at: new Date().toISOString() };
  }

  @Get('search')
  async search(@CurrentIdentity() id: Identity, @Query('q') q?: string) {
    const query = (q ?? '').trim();
    if (query.length < 2) throw badRequest('QUERY_TOO_SHORT', 'دست‌کم دو نویسه وارد کنید');
    const groups: { module: string; provider: string; title: unknown; hits: unknown[] }[] = [];
    for (const eff of await this.s.registry.effectiveFor(id.tenantId)) {
      const m = this.s.registry.loaded.get(eff.id);
      if (!m) continue;
      for (const p of m.manifest.searchProviders) {
        const fn = m.definition.searchProviders?.[p.key];
        if (!fn || (p.permission && !id.permissions.can(p.permission))) continue;
        const hits = await fn(await this.s.contexts.forRequest(m, id), query, 10);
        if (hits.length) groups.push({ module: m.id, provider: p.key, title: p.title, hits });
      }
    }
    return { query, groups };
  }

  // ---------------------------------------------------------------- spreadsheet import (module templates)

  /** Import templates of the tenant's active modules that the user may use (template permission). */
  @Get('imports/templates')
  async importTemplates(@CurrentIdentity() id: Identity) {
    const out: unknown[] = [];
    for (const eff of await this.s.registry.effectiveFor(id.tenantId)) {
      const m = this.s.registry.loaded.get(eff.id);
      if (!m) continue;
      for (const t of m.manifest.importTemplates) {
        if (!m.definition.importers?.[t.key] || !id.permissions.can(t.permission)) continue;
        out.push({ moduleId: m.id, moduleName: m.manifest.name, ...t });
      }
    }
    return out;
  }

  /**
   * Upload a filled template (xlsx or CSV, multipart field `file`; `commit=1` to write). Always validated
   * first; nothing is written unless every row is valid (all or nothing, inside the module importer).
   */
  @Post('imports/:moduleId/:key')
  @HttpCode(200)
  async runImport(
    @CurrentIdentity() id: Identity,
    @Param('moduleId') moduleId: string,
    @Param('key') key: string,
    @Req() req: { file(): Promise<{ filename: string; toBuffer(): Promise<Buffer>; fields: Record<string, { value?: string } | undefined> } | undefined> },
  ) {
    const m = await this.activeModule(id, moduleId);
    const t = m.manifest.importTemplates.find((x) => x.key === key);
    const importer = m.definition.importers?.[key];
    if (!t || !importer) throw notFound('قالب ورود داده یافت نشد');
    if (!id.permissions.can(t.permission)) throw forbidden();
    const part = await req.file();
    if (!part) throw badRequest('NO_FILE', 'فایلی ارسال نشده است');
    const data = await part.toBuffer();
    const commit = part.fields.commit?.value === '1';
    const r = await runImport(t, importer, await this.s.contexts.forRequest(m, id), { data, name: part.filename }, commit);
    if (r.imported) {
      await this.s.audit.append({ tenantId: id.tenantId, actorType: 'user', actorId: id.userId, action: 'core.import.completed', moduleId, after: { template: key, file: part.filename, rows: r.total, created: r.created } });
    }
    return r;
  }

  // ---------------------------------------------------------------- reports (module providers, saved, scheduled)

  /** Reports of active modules the user may run (each report's own permission). */
  @Get('reports')
  reports(@CurrentIdentity() id: Identity) {
    return this.s.reports.available(id);
  }

  @Post('reports/run/:moduleId/:key')
  @HttpCode(200)
  runReport(@CurrentIdentity() id: Identity, @Param('moduleId') moduleId: string, @Param('key') key: string, @Body() body: unknown) {
    return this.s.reports.run(id, moduleId, key, parse(paramsInput, body));
  }

  @Get('reports/saved')
  savedReports(@CurrentIdentity() id: Identity) {
    return this.s.reports.listSaved(id);
  }

  @Post('reports/saved')
  saveReport(@CurrentIdentity() id: Identity, @Body() body: unknown) {
    return this.s.reports.save(id, null, parse(savedInput, body));
  }

  @Put('reports/saved/:id')
  updateReport(@CurrentIdentity() id: Identity, @Param('id') savedId: string, @Body() body: unknown) {
    return this.s.reports.save(id, parse(z.uuid(), savedId), parse(savedInput, body));
  }

  @Delete('reports/saved/:id')
  async removeReport(@CurrentIdentity() id: Identity, @Param('id') savedId: string) {
    await this.s.reports.remove(id, parse(z.uuid(), savedId));
    return { ok: true };
  }

  /** "Send now" for a saved report the user owns: one delivery per recipient, each with their own access. */
  @Post('reports/saved/:id/send')
  @HttpCode(200)
  async sendReport(@CurrentIdentity() id: Identity, @Param('id') savedId: string) {
    const sid = parse(z.uuid(), savedId);
    const mine = (await this.s.reports.listSaved(id)) as { id: string; mine: boolean }[];
    if (!mine.some((r) => r.id === sid && r.mine)) throw notFound('گزارش ذخیره‌شده');
    return { delivered: await this.s.reports.deliver(id.tenantId, id.companyId, sid) };
  }

  @Get('reports/inbox')
  reportInbox(@CurrentIdentity() id: Identity) {
    return this.s.reports.myRuns(id);
  }

  @Get('reports/inbox/:id/download')
  reportDownload(@CurrentIdentity() id: Identity, @Param('id') runId: string) {
    return this.s.reports.download(id, parse(z.uuid(), runId));
  }

  // ---------------------------------------------------------------- notifications (+ real-time stream)

  @Get('notifications')
  notifications(@CurrentIdentity() id: Identity, @Query('unread') unread?: string) {
    return this.s.notifications.list(id.tenantId, id.userId, { unreadOnly: unread === '1' });
  }

  @Post('notifications/read')
  @HttpCode(200)
  @AllowInReadOnly()
  async markRead(@CurrentIdentity() id: Identity, @Body() body: unknown) {
    const b = parse(z.object({ ids: z.union([z.array(z.uuid()).max(200), z.literal('all')]) }), body);
    await this.s.notifications.markRead(id.tenantId, id.userId, b.ids);
    return { ok: true };
  }

  /** Server-sent events; the SPA reads it with fetch (Authorization header) rather than EventSource. */
  @Get('notifications/stream')
  async stream(@CurrentIdentity() id: Identity, @Req() req: { raw: NodeJS.EventEmitter }, @Res() reply: { raw: ServerResponse; hijack(): void }) {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(': connected\n\n');
    const sub = this.s.redis.duplicate();
    const channel = channelName(id.tenantId, id.userId);
    await sub.subscribe(channel);
    sub.on('message', (_c, msg) => res.write(`event: notification\ndata: ${msg}\n\n`));
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    const close = () => {
      clearInterval(ping);
      sub.disconnect();
    };
    req.raw.on('close', close);
    res.on('close', close);
  }

  // ---------------------------------------------------------------- tasks

  @Get('tasks')
  @RequirePermission('core.task.view', 'own')
  tasks(@CurrentIdentity() id: Identity, @Query('mine') mine?: string, @Query('status') status?: string) {
    return this.s.tasks.list(scope(id), { mine: mine === '1', status, ownOnly: !id.permissions.can('core.task.view', 'company') });
  }

  @Post('tasks')
  @RequirePermission('core.task.create', 'own')
  async createTask(@CurrentIdentity() id: Identity, @Body() body: unknown) {
    return { id: await this.s.tasks.create(scope(id), parse(taskInput, body)) };
  }

  @Patch('tasks/:taskId')
  @RequirePermission('core.task.update', 'own')
  async updateTask(@CurrentIdentity() id: Identity, @Param('taskId') taskId: string, @Body() body: unknown) {
    await this.s.tasks.update(scope(id), parse(z.uuid(), taskId), parse(taskUpdate, body), !id.permissions.can('core.task.update', 'company'));
    return { ok: true };
  }

  // ---------------------------------------------------------------- approvals (workflow engine)

  @Get('approvals')
  approvals(@CurrentIdentity() id: Identity) {
    return this.s.workflow.inbox(scope(id));
  }

  @Post('approvals/:instanceId/decide')
  @HttpCode(200)
  async decide(@CurrentIdentity() id: Identity, @Param('instanceId') instanceId: string, @Body() body: unknown) {
    const b = parse(z.object({ decision: z.enum(['approve', 'reject']), comment: z.string().max(2000).optional() }), body);
    return this.s.workflow.decide(scope(id), parse(z.uuid(), instanceId), b.decision, b.comment);
  }

  @Get('workflows')
  @RequirePermission('core.workflow.manage_definitions')
  workflows(@CurrentIdentity() id: Identity) {
    return this.s.workflow.definitions(id.tenantId);
  }

  @Put('workflows/:key')
  @RequirePermission('core.workflow.manage_definitions')
  async defineWorkflow(@CurrentIdentity() id: Identity, @Param('key') key: string, @Body() body: unknown) {
    const b = parse(z.object({ moduleId: z.string().min(1), definition: z.unknown() }), body);
    try {
      return { version: await this.s.workflow.define(id.tenantId, b.moduleId, parse(z.string().regex(/^[a-z][a-z0-9_.-]*$/), key), b.definition, id.userId) };
    } catch (err) {
      if (err instanceof z.ZodError) throw badRequest('INVALID_WORKFLOW', 'تعریف گردش کار معتبر نیست', err.issues);
      throw err;
    }
  }

  // ---------------------------------------------------------------- files

  @Post('files')
  @RequirePermission('core.file.upload', 'own')
  async upload(@CurrentIdentity() id: Identity, @Req() req: { file(): Promise<{ filename: string; mimetype: string; toBuffer(): Promise<Buffer>; fields: Record<string, { value?: string } | undefined> } | undefined> }) {
    const part = await req.file();
    if (!part) throw badRequest('NO_FILE', 'فایلی ارسال نشده است');
    const data = await part.toBuffer();
    const conf = part.fields.confidentiality?.value;
    // Uploaded for a module: the module attaches it to its record (ctx.files.claim) and controls downloads.
    const module = part.fields.module?.value;
    if (module && !(await this.s.registry.effectiveFor(id.tenantId)).some((m) => m.id === module)) throw badRequest('MODULE_INACTIVE', 'ماژول مقصد فعال نیست');
    return this.s.files.upload(scope(id), { name: part.filename, mime: part.mimetype, data }, {
      confidentiality: conf === 'public' || conf === 'confidential' || conf === 'secret' ? conf : 'internal',
      owner: module ? { module } : undefined,
    });
  }

  @Get('files/:fileId/url')
  @RequirePermission('core.file.download', 'own')
  @AllowInReadOnly()
  download(@CurrentIdentity() id: Identity, @Param('fileId') fileId: string) {
    return this.s.files.downloadUrl(scope(id), parse(z.uuid(), fileId));
  }

  // ---------------------------------------------------------------- audit

  @Get('audit')
  @RequirePermission('core.audit.view')
  audit(@CurrentIdentity() id: Identity, @Query('before') before?: string) {
    return this.s.audit.listForTenant(id.tenantId, 100, before ? Number(before) : undefined);
  }
}
