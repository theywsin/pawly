import type { ServerResponse } from 'node:http';
import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { RequirePermission, AllowInReadOnly } from '@mohandesyar/module-sdk/server';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { Services } from '../../../app/services.js';
import { CurrentIdentity, RequestMetaParam, type Identity } from '../context.js';
import { badRequest, forbidden, notFound, parse } from '../errors.js';
import { taskInput, taskUpdate } from '../../tasks/task.service.js';
import { channelName } from '../../notifications/notification.service.js';
import type { RequestMeta } from '../../auth/auth.service.js';

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
    return this.s.files.upload(scope(id), { name: part.filename, mime: part.mimetype, data }, {
      confidentiality: conf === 'public' || conf === 'confidential' || conf === 'secret' ? conf : 'internal',
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
