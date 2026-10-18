import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../infra/db.js';
import { uuidv7 } from '../../infra/ids.js';
import type { AuditService } from '../audit/audit.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import { notFound } from '../http/errors.js';

export const taskInput = z.object({
  title: z.string().trim().min(1, 'عنوان الزامی است').max(300),
  description: z.string().max(5000).optional(),
  assigneeId: z.uuid().optional(),
  dueAt: z.iso.datetime({ offset: true }).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  source: z.object({ module: z.string(), entityType: z.string(), entityId: z.string() }).optional(),
});

export const taskUpdate = z.object({
  status: z.enum(['open', 'in_progress', 'done', 'canceled']).optional(),
  title: z.string().trim().min(1).max(300).optional(),
  assigneeId: z.uuid().nullable().optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

interface Scope {
  tenantId: string;
  companyId: string;
  companyIds: readonly string[];
  userId: string;
}

/** General-purpose tasks that any module can attach to its entities (docs/01 CORE-TASK). */
export class TaskService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  async create(s: Scope, input: z.infer<typeof taskInput>): Promise<string> {
    const id = uuidv7();
    await this.db.tx({ tenantId: s.tenantId, companyIds: s.companyIds, userId: s.userId }, async (tx) => {
      if (input.assigneeId) {
        const m = await tx.execute(sql`SELECT 1 FROM core_memberships WHERE user_id = ${input.assigneeId} AND status = 'active'`);
        if (!m.rows.length) throw notFound('کاربر مسئول در این سازمان یافت نشد');
      }
      await tx.execute(sql`INSERT INTO core_tasks (id, tenant_id, company_id, title, description, assignee_id, due_at, priority, source_module, source_entity_type, source_entity_id, created_by)
        VALUES (${id}, ${s.tenantId}, ${s.companyId}, ${input.title}, ${input.description ?? null}, ${input.assigneeId ?? null}, ${input.dueAt ?? null}, ${input.priority},
                ${input.source?.module ?? null}, ${input.source?.entityType ?? null}, ${input.source?.entityId ?? null}, ${s.userId})`);
      await this.audit.append({ tenantId: s.tenantId, actorType: 'user', actorId: s.userId, action: 'task.created', entityType: 'task', entityId: id, after: { title: input.title } }, tx);
      if (input.assigneeId && input.assigneeId !== s.userId) {
        await this.notifications.notify({ tenantId: s.tenantId, userIds: [input.assigneeId], type: 'core.task.assigned', title: `وظیفه جدید: ${input.title}`, link: `/app/tasks?id=${id}` }, tx);
      }
    });
    return id;
  }

  async list(s: Scope, opts: { mine?: boolean; status?: string; ownOnly: boolean }) {
    return this.db.tx({ tenantId: s.tenantId, companyIds: s.companyIds }, async (tx) => {
      const r = await tx.execute(sql`SELECT t.*, u.full_name AS assignee_name FROM core_tasks t LEFT JOIN core_users u ON u.id = t.assignee_id
        WHERE true
          ${opts.mine || opts.ownOnly ? sql`AND (t.assignee_id = ${s.userId} OR t.created_by = ${s.userId})` : sql``}
          ${opts.status ? sql`AND t.status = ${opts.status}` : sql``}
        ORDER BY (t.status IN ('done','canceled')), t.due_at NULLS LAST, t.created_at DESC LIMIT 200`);
      return r.rows;
    });
  }

  async update(s: Scope, id: string, patch: z.infer<typeof taskUpdate>, ownOnly: boolean): Promise<void> {
    await this.db.tx({ tenantId: s.tenantId, companyIds: s.companyIds, userId: s.userId }, async (tx) => {
      const cur = await tx.execute(sql`SELECT * FROM core_tasks WHERE id = ${id} FOR UPDATE`);
      const row = cur.rows[0] as { assignee_id: string | null; created_by: string } | undefined;
      if (!row || (ownOnly && row.assignee_id !== s.userId && row.created_by !== s.userId)) throw notFound();
      await tx.execute(sql`UPDATE core_tasks SET
        status = coalesce(${patch.status ?? null}, status),
        title = coalesce(${patch.title ?? null}, title),
        priority = coalesce(${patch.priority ?? null}, priority),
        assignee_id = CASE WHEN ${patch.assigneeId !== undefined} THEN ${patch.assigneeId ?? null}::uuid ELSE assignee_id END,
        due_at = CASE WHEN ${patch.dueAt !== undefined} THEN ${patch.dueAt ?? null}::timestamptz ELSE due_at END,
        updated_at = now() WHERE id = ${id}`);
      await this.audit.append({ tenantId: s.tenantId, actorType: 'user', actorId: s.userId, action: 'task.updated', entityType: 'task', entityId: id, after: patch }, tx);
    });
  }
}
