import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { Services } from '../app/services.js';
import { Console, CurrentAdmin, CurrentIdentity, type AdminIdentity, type Identity } from '../core/http/context.js';
import { badRequest, notFound, parse } from '../core/http/errors.js';
import { contentDisposition } from '../core/files/file.service.js';
import { MAX_ATTACHMENT_BYTES, replySchema, ticketSchema, type Member } from './support.service.js';

interface UploadReq {
  file(opts?: { limits?: { fileSize?: number } }): Promise<{ filename: string; mimetype: string; toBuffer(): Promise<Buffer>; file: { truncated?: boolean }; fields: Record<string, { value?: string } | undefined> } | undefined>;
}
interface FileReply {
  header(k: string, v: string): FileReply;
  type(t: string): FileReply;
}

async function readUpload(req: UploadReq) {
  const part = await req.file({ limits: { fileSize: MAX_ATTACHMENT_BYTES + 1 } });
  if (!part) throw badRequest('NO_FILE', 'فایلی ارسال نشده است');
  const data = await part.toBuffer().catch(() => null);
  if (!data || part.file.truncated) throw badRequest('FILE_TOO_LARGE', 'حجم پیوست بیش از ۱۰ مگابایت است');
  return { file: { name: part.filename, mime: part.mimetype, data }, fields: part.fields };
}

function send(reply: FileReply, f: { data: Buffer; name: string; mime: string }) {
  reply.type(f.mime || 'application/octet-stream');
  reply.header('content-disposition', contentDisposition(f.name));
  reply.header('cache-control', 'private, no-store');
  reply.header('content-security-policy', "default-src 'none'");
  return f.data;
}

const member = (id: Identity): Member => ({ tenantId: id.tenantId, userId: id.userId, seeAll: id.permissions.can('core.support.view_all') });

/**
 * Support tickets for every member of an organisation (no permission needed to ask for help); members
 * see their own tickets, those with core.support.view_all see the organisation's.
 */
@Controller('support')
export class SupportController {
  constructor(@Inject(Services) private readonly s: Services) {}

  @Get('tickets')
  list(@CurrentIdentity() id: Identity) {
    return this.s.support.list(member(id));
  }

  @Post('tickets')
  @HttpCode(201)
  create(@CurrentIdentity() id: Identity, @Body() body: unknown) {
    return this.s.support.create(member(id), parse(ticketSchema, body));
  }

  @Get('tickets/:id')
  get(@CurrentIdentity() id: Identity, @Param('id') ticketId: string) {
    return this.s.support.get(member(id), parse(z.uuid(), ticketId));
  }

  @Post('tickets/:id/reply')
  @HttpCode(200)
  async reply(@CurrentIdentity() id: Identity, @Param('id') ticketId: string, @Body() body: unknown) {
    await this.s.support.reply(member(id), parse(z.uuid(), ticketId), parse(replySchema, body));
    return { ok: true };
  }

  @Post('tickets/:id/close')
  @HttpCode(200)
  async close(@CurrentIdentity() id: Identity, @Param('id') ticketId: string) {
    await this.s.support.close(member(id), parse(z.uuid(), ticketId));
    return { ok: true };
  }

  @Post('attachments')
  @HttpCode(201)
  async upload(@CurrentIdentity() id: Identity, @Req() req: UploadReq) {
    const { file } = await readUpload(req);
    return this.s.support.upload(file, { type: 'user', userId: id.userId, tenantId: id.tenantId });
  }

  @Get('attachments/:id')
  async download(@CurrentIdentity() id: Identity, @Param('id') fileId: string, @Res({ passthrough: true }) reply: FileReply) {
    return send(reply, await this.s.support.file(member(id), parse(z.uuid(), fileId)));
  }
}

/** Console: the support queue. */
@Controller('console/support')
export class ConsoleSupportController {
  constructor(@Inject(Services) private readonly s: Services) {}

  @Console('super_admin', 'sales_admin', 'tech_admin', 'support')
  @Get('tickets')
  list(@Query('status') status?: string, @Query('tenantId') tenantId?: string) {
    return this.s.support.adminList({
      status: status && ['waiting', 'open', 'answered', 'customer_reply', 'closed'].includes(status) ? status : undefined,
      tenantId: tenantId && z.uuid().safeParse(tenantId).success ? tenantId : undefined,
    });
  }

  @Console('super_admin', 'sales_admin', 'tech_admin', 'support')
  @Get('tickets/:id')
  get(@Param('id') id: string) {
    return this.s.support.adminGet(parse(z.uuid(), id));
  }

  @Console('super_admin', 'sales_admin', 'tech_admin', 'support')
  @Post('tickets/:id/reply')
  @HttpCode(200)
  async reply(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() a: AdminIdentity) {
    await this.s.support.adminReply(a.adminId, parse(z.uuid(), id), parse(replySchema.extend({ close: z.boolean().default(false) }), body));
    return { ok: true };
  }

  @Console('super_admin', 'sales_admin', 'tech_admin', 'support')
  @Post('tickets/:id')
  @HttpCode(200)
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() a: AdminIdentity) {
    const b = parse(z.object({ status: z.enum(['open', 'answered', 'customer_reply', 'closed']).optional(), priority: z.enum(['low', 'normal', 'high']).optional() }), body);
    await this.s.support.adminUpdate(a.adminId, parse(z.uuid(), id), b);
    return { ok: true };
  }

  @Console('super_admin', 'sales_admin', 'tech_admin', 'support')
  @Post('attachments')
  @HttpCode(201)
  async upload(@Req() req: UploadReq, @Query('ticketId') ticketId: string, @CurrentAdmin() a: AdminIdentity) {
    const { file } = await readUpload(req);
    return this.s.support.upload(file, { type: 'admin', adminId: a.adminId }, parse(z.uuid(), ticketId));
  }

  @Console('super_admin', 'sales_admin', 'tech_admin', 'support')
  @Get('attachments/:id')
  async download(@Param('id') fileId: string, @Res({ passthrough: true }) reply: FileReply) {
    return send(reply, await this.s.support.file(null, parse(z.uuid(), fileId)));
  }
}

/** Console: everything about one customer organisation on one page. */
@Controller('console/customers')
export class ConsoleCustomerController {
  constructor(@Inject(Services) private readonly s: Services) {}

  @Console('super_admin', 'sales_admin', 'tech_admin', 'support')
  @Get(':id')
  async detail(@Param('id') id: string) {
    const tenantId = parse(z.uuid(), id);
    const t = await this.s.db.app.execute(sql`SELECT t.*, u.active_users, u.companies AS company_count, u.storage_bytes FROM core_tenants t JOIN core_tenant_usage() u ON u.tenant_id = t.id WHERE t.id = ${tenantId}`);
    const tenant = t.rows[0];
    if (!tenant) throw notFound('مشتری یافت نشد');
    const [companies, members, lastLogins, ent, billing, payments, tickets, modules] = await Promise.all([
      this.s.db.tx({ tenantId }, async (tx) => (await tx.execute(sql`SELECT id, name, legal_name, national_id, economic_code, phone, address, status, created_at FROM core_companies ORDER BY created_at`)).rows),
      this.s.tenancy.listMembers(tenantId),
      this.s.db.app.execute(sql`SELECT s.subject_id AS user_id, max(s.created_at) AS last_login FROM core_sessions s WHERE s.subject_type = 'user' AND s.tenant_id = ${tenantId} GROUP BY s.subject_id`),
      this.s.entitlement.get(tenantId),
      this.s.billing.overview(tenantId),
      this.s.billing.adminPayments({ tenantId }),
      this.s.support.adminList({ tenantId }),
      this.s.db.app.execute(sql`SELECT tm.module_id, tm.enabled, tm.source, tm.enabled_at, m.name FROM core_tenant_modules tm JOIN core_modules m ON m.id = tm.module_id WHERE tm.tenant_id = ${tenantId} ORDER BY tm.module_id`),
    ]);
    const last = new Map((lastLogins.rows as { user_id: string; last_login: string }[]).map((r) => [r.user_id, r.last_login]));
    return {
      tenant,
      companies,
      members: (members as { user_id: string }[]).map((m) => ({ ...m, last_login: last.get(m.user_id) ?? null })),
      subscription: billing.subscription,
      entitledModules: [...ent.modules].sort(),
      modules: modules.rows,
      addons: billing.addons,
      invoices: billing.invoices,
      payments,
      tickets,
    };
  }
}
