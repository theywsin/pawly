import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@mohandesyar/module-sdk/server';
import type { Database } from '../infra/db.js';
import { uuidv7 } from '../infra/ids.js';
import type { AuditService } from '../core/audit/audit.service.js';
import { BLOCKED_EXT, type FileService } from '../core/files/file.service.js';
import type { NotificationService } from '../core/notifications/notification.service.js';
import { badRequest, conflict, notFound } from '../core/http/errors.js';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 5;

export const ticketSchema = z.object({
  subject: z.string().trim().min(3, 'موضوع را کامل بنویسید').max(200),
  category: z.enum(['technical', 'billing', 'feature', 'other']).default('technical'),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  body: z.string().trim().min(5, 'شرح درخواست را بنویسید').max(10_000),
  attachmentIds: z.array(z.uuid()).max(MAX_FILES).default([]),
});
export const replySchema = z.object({
  body: z.string().trim().min(1, 'متن پاسخ را بنویسید').max(10_000),
  attachmentIds: z.array(z.uuid()).max(MAX_FILES).default([]),
});

export interface Member {
  tenantId: string;
  userId: string;
  /** May see every ticket of the organisation, not only their own. */
  seeAll: boolean;
}
export interface SupportDeps {
  db: Database;
  files: FileService;
  audit: AuditService;
  notifications: NotificationService;
}

type Author = { type: 'user'; userId: string; tenantId: string } | { type: 'admin'; adminId: string };

/** Support tickets (docs/07): members ask, the platform team answers; every reply notifies the other side. */
export class SupportService {
  constructor(private readonly s: SupportDeps) {}

  // ------------------------------------------------------------------ attachments

  async upload(file: { name: string; mime: string; data: Buffer }, by: Author, ticketId?: string): Promise<{ id: string; name: string; size: number }> {
    if (file.data.length === 0) throw badRequest('EMPTY_FILE', 'فایل خالی است');
    if (file.data.length > MAX_ATTACHMENT_BYTES) throw badRequest('FILE_TOO_LARGE', 'حجم پیوست بیش از ۱۰ مگابایت است');
    if (BLOCKED_EXT.test(file.name)) throw badRequest('FILE_TYPE_BLOCKED', 'این نوع فایل مجاز نیست');
    let tenantId: string;
    if (by.type === 'user') tenantId = by.tenantId;
    else {
      const t = await this.s.db.app.execute(sql`SELECT tenant_id FROM platform_tickets WHERE id = ${ticketId ?? null}`);
      const row = t.rows[0] as { tenant_id: string } | undefined;
      if (!row) throw notFound('تیکت یافت نشد');
      tenantId = row.tenant_id;
    }
    const id = uuidv7();
    const key = `tk/${tenantId}/${id}`;
    const mime = (file.mime || 'application/octet-stream').slice(0, 100);
    await this.s.files.putObject(key, file.data, mime, file.name);
    await this.s.db.app.execute(sql`INSERT INTO platform_ticket_files (id, tenant_id, uploader_type, uploaded_by, object_key, name, mime, size)
      VALUES (${id}, ${tenantId}, ${by.type}, ${by.type === 'user' ? by.userId : by.adminId}, ${key}, ${file.name.slice(0, 255)}, ${mime}, ${file.data.length})`);
    return { id, name: file.name, size: file.data.length };
  }

  /** Attaches the sender's own, not yet used uploads to a message. */
  private async attach(tx: Db, by: Author, tenantId: string, ticketId: string, messageId: string, ids: string[]) {
    if (!ids.length) return;
    const r = await tx.execute(sql`UPDATE platform_ticket_files SET ticket_id = ${ticketId}, message_id = ${messageId}
      WHERE id = ANY (${`{${ids.join(',')}}`}::uuid[]) AND message_id IS NULL AND tenant_id = ${tenantId}
        AND uploader_type = ${by.type} AND uploaded_by = ${by.type === 'user' ? by.userId : by.adminId} RETURNING id`);
    if (r.rows.length !== new Set(ids).size) throw badRequest('ATTACHMENT_NOT_FOUND', 'یکی از پیوست‌ها یافت نشد؛ دوباره بارگذاری کنید');
  }

  // ------------------------------------------------------------------ organisation side

  private visible(m: Member) {
    return sql`t.tenant_id = ${m.tenantId} ${m.seeAll ? sql`` : sql`AND t.created_by = ${m.userId}`}`;
  }

  async list(m: Member) {
    const r = await this.s.db.app.execute(sql`SELECT t.id, t.number, t.subject, t.category, t.priority, t.status, t.created_at, t.updated_at, u.full_name AS created_by_name
      FROM platform_tickets t JOIN core_users u ON u.id = t.created_by WHERE ${this.visible(m)} ORDER BY t.updated_at DESC LIMIT 300`);
    return r.rows;
  }

  async create(m: Member, input: z.infer<typeof ticketSchema>): Promise<{ id: string; number: number }> {
    const id = uuidv7();
    const number = await this.s.db.app.transaction(async (raw) => {
      const tx = raw as unknown as Db;
      const r = await tx.execute(sql`INSERT INTO platform_tickets (id, tenant_id, created_by, subject, category, priority) VALUES (${id}, ${m.tenantId}, ${m.userId}, ${input.subject}, ${input.category}, ${input.priority}) RETURNING number`);
      const msg = uuidv7();
      await tx.execute(sql`INSERT INTO platform_ticket_messages (id, ticket_id, author_type, author_id, body) VALUES (${msg}, ${id}, 'user', ${m.userId}, ${input.body})`);
      await this.attach(tx, { type: 'user', userId: m.userId, tenantId: m.tenantId }, m.tenantId, id, msg, input.attachmentIds);
      return Number((r.rows[0] as { number: string }).number);
    });
    await this.s.audit.append({ tenantId: m.tenantId, actorType: 'user', actorId: m.userId, action: 'support.ticket_created', entityType: 'ticket', entityId: id, after: { subject: input.subject } });
    return { id, number };
  }

  private async load(where: ReturnType<typeof sql>, id: string) {
    const r = await this.s.db.app.execute(sql`SELECT t.*, u.full_name AS created_by_name, u.email AS created_by_email, tn.name AS tenant_name
      FROM platform_tickets t JOIN core_users u ON u.id = t.created_by JOIN core_tenants tn ON tn.id = t.tenant_id WHERE t.id = ${id} AND ${where}`);
    const t = r.rows[0] as { id: string; tenant_id: string; created_by: string; status: string; number: string; subject: string } | undefined;
    if (!t) throw notFound('تیکت یافت نشد');
    const [messages, files] = await Promise.all([
      this.s.db.app.execute(sql`SELECT m.id, m.author_type, m.body, m.created_at,
          CASE WHEN m.author_type = 'user' THEN (SELECT full_name FROM core_users WHERE id = m.author_id) ELSE 'پشتیبانی' END AS author_name
        FROM platform_ticket_messages m WHERE m.ticket_id = ${id} ORDER BY m.created_at`),
      this.s.db.app.execute(sql`SELECT id, message_id, name, size, mime FROM platform_ticket_files WHERE ticket_id = ${id} ORDER BY created_at`),
    ]);
    const byMessage = new Map<string, unknown[]>();
    for (const f of files.rows as { message_id: string }[]) byMessage.set(f.message_id, [...(byMessage.get(f.message_id) ?? []), f]);
    return { ...t, messages: (messages.rows as { id: string }[]).map((x) => ({ ...x, files: byMessage.get(x.id) ?? [] })) };
  }

  get(m: Member, id: string) {
    return this.load(this.visible(m), id);
  }

  async reply(m: Member, id: string, input: z.infer<typeof replySchema>) {
    const t = await this.get(m, id);
    await this.s.db.app.transaction(async (raw) => {
      const tx = raw as unknown as Db;
      const msg = uuidv7();
      await tx.execute(sql`INSERT INTO platform_ticket_messages (id, ticket_id, author_type, author_id, body) VALUES (${msg}, ${id}, 'user', ${m.userId}, ${input.body})`);
      await this.attach(tx, { type: 'user', userId: m.userId, tenantId: m.tenantId }, m.tenantId, id, msg, input.attachmentIds);
      // A customer reply reopens a closed ticket.
      await tx.execute(sql`UPDATE platform_tickets SET status = 'customer_reply', updated_at = now() WHERE id = ${t.id}`);
    });
  }

  async close(m: Member, id: string) {
    await this.get(m, id);
    await this.s.db.app.execute(sql`UPDATE platform_tickets SET status = 'closed', updated_at = now() WHERE id = ${id}`);
  }

  /** Attachment for a member who can see the ticket, or for the platform (member = null). */
  async file(m: Member | null, fileId: string): Promise<{ data: Buffer; name: string; mime: string }> {
    const r = await this.s.db.app.execute(sql`SELECT f.object_key, f.name, f.mime, f.ticket_id FROM platform_ticket_files f
      JOIN platform_tickets t ON t.id = f.ticket_id WHERE f.id = ${fileId} ${m ? sql`AND ${this.visible(m)}` : sql``}`);
    const row = r.rows[0] as { object_key: string; name: string; mime: string } | undefined;
    if (!row) throw notFound('پیوست یافت نشد');
    return { data: await this.s.files.getObject(row.object_key), name: row.name, mime: row.mime };
  }

  // ------------------------------------------------------------------ platform side

  async adminList(filter: { status?: string; tenantId?: string }) {
    const r = await this.s.db.app.execute(sql`SELECT t.id, t.number, t.subject, t.category, t.priority, t.status, t.created_at, t.updated_at, tn.id AS tenant_id, tn.name AS tenant_name, u.full_name AS created_by_name
      FROM platform_tickets t JOIN core_tenants tn ON tn.id = t.tenant_id JOIN core_users u ON u.id = t.created_by
      WHERE true ${filter.status === 'waiting' ? sql`AND t.status IN ('open', 'customer_reply')` : filter.status ? sql`AND t.status = ${filter.status}` : sql``}
        ${filter.tenantId ? sql`AND t.tenant_id = ${filter.tenantId}` : sql``}
      ORDER BY (t.status IN ('open', 'customer_reply')) DESC, t.priority = 'high' DESC, t.updated_at DESC LIMIT 500`);
    return r.rows;
  }

  adminGet(id: string) {
    return this.load(sql`true`, id);
  }

  async adminReply(adminId: string, id: string, input: z.infer<typeof replySchema> & { close?: boolean }) {
    const t = await this.adminGet(id);
    await this.s.db.app.transaction(async (raw) => {
      const tx = raw as unknown as Db;
      const msg = uuidv7();
      await tx.execute(sql`INSERT INTO platform_ticket_messages (id, ticket_id, author_type, author_id, body) VALUES (${msg}, ${id}, 'admin', ${adminId}, ${input.body})`);
      await this.attach(tx, { type: 'admin', adminId }, t.tenant_id, id, msg, input.attachmentIds);
      await tx.execute(sql`UPDATE platform_tickets SET status = ${input.close ? 'closed' : 'answered'}, updated_at = now() WHERE id = ${id}`);
    });
    await this.s.audit.append({ tenantId: t.tenant_id, actorType: 'admin', actorId: adminId, action: 'support.ticket_answered', entityType: 'ticket', entityId: id });
    await this.s.notifications
      .notify({ tenantId: t.tenant_id, userIds: [t.created_by], type: 'support.answered', title: `پاسخ پشتیبانی به تیکت ${t.number}`, body: t.subject, link: `/app/support/${id}` })
      .catch(() => undefined);
  }

  async adminUpdate(adminId: string, id: string, patch: { status?: string; priority?: string }) {
    const t = await this.adminGet(id);
    if (!patch.status && !patch.priority) throw conflict('NOTHING_TO_CHANGE', 'تغییری ارسال نشده است');
    await this.s.db.app.execute(sql`UPDATE platform_tickets SET status = coalesce(${patch.status ?? null}, status), priority = coalesce(${patch.priority ?? null}, priority), updated_at = now() WHERE id = ${id}`);
    await this.s.audit.append({ tenantId: t.tenant_id, actorType: 'admin', actorId: adminId, action: 'support.ticket_updated', entityType: 'ticket', entityId: id, after: patch });
  }

  async waitingCount(): Promise<number> {
    const r = await this.s.db.app.execute(sql`SELECT count(*)::int AS n FROM platform_tickets WHERE status IN ('open', 'customer_reply')`);
    return (r.rows[0] as { n: number }).n;
  }
}
