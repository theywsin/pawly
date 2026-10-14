import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Db } from '../../infra/db.js';
import { uuidv7 } from '../../infra/ids.js';
import type { AuditService } from '../audit/audit.service.js';
import type { EventBus } from '../events/event-bus.js';
import type { NotificationService } from '../notifications/notification.service.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';

/**
 * Approval workflow engine (docs/01 CORE-WF). A definition is an ordered list of steps; a step applies
 * when the amount reaches its threshold. Hard rules: the starter never approves their own request,
 * one person decides at most one step per instance, and a role's approval limit caps the amount.
 */
export const workflowDefinition = z.object({
  title: z.string().min(1),
  steps: z
    .array(
      z.object({
        key: z.string().regex(/^[a-z][a-z0-9_]*$/),
        label: z.string().min(1),
        approverRole: z.string().optional(),
        approverUserId: z.uuid().optional(),
        minAmount: z.number().nonnegative().optional(),
      }).refine((s) => !!s.approverRole !== !!s.approverUserId, 'هر مرحله باید دقیقاً یکی از نقش یا کاربر تأییدکننده را داشته باشد'),
    )
    .min(1),
});
export type WorkflowDefinition = z.infer<typeof workflowDefinition>;

export interface StartInput {
  moduleId: string;
  key: string;
  entityType: string;
  entityId: string;
  title: string;
  amount?: number | null;
}

interface Scope {
  tenantId: string;
  companyId: string;
  companyIds: readonly string[];
  userId: string;
}

export const WORKFLOW_COMPLETED = 'core.workflow.completed';

export class WorkflowService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly events: EventBus,
  ) {}

  async define(tenantId: string, moduleId: string, key: string, definition: unknown, actorId: string | null): Promise<number> {
    const def = workflowDefinition.parse(definition);
    return this.db.tx({ tenantId }, async (tx) => {
      const v = await tx.execute(sql`SELECT coalesce(max(version), 0) + 1 AS v FROM core_workflow_defs WHERE key = ${key}`);
      const version = (v.rows[0] as { v: number }).v;
      await tx.execute(sql`UPDATE core_workflow_defs SET active = false WHERE key = ${key}`);
      await tx.execute(sql`INSERT INTO core_workflow_defs (id, tenant_id, key, module_id, version, definition) VALUES (${uuidv7()}, ${tenantId}, ${key}, ${moduleId}, ${version}, ${JSON.stringify(def)}::jsonb)`);
      await this.audit.append({ tenantId, actorType: actorId ? 'user' : 'system', actorId, action: 'workflow.defined', moduleId, entityType: 'workflow_def', entityId: key, after: { version, ...def } }, tx);
      return version;
    });
  }

  async start(s: Scope, input: StartInput, txIn?: Db): Promise<{ instanceId: string; state: string }> {
    const run = async (tx: Db) => {
      const d = await tx.execute(sql`SELECT id, definition FROM core_workflow_defs WHERE key = ${input.key} AND active`);
      const defRow = d.rows[0] as { id: string; definition: WorkflowDefinition } | undefined;
      if (!defRow) throw notFound(`گردش کار «${input.key}» تعریف نشده است`);
      const steps = defRow.definition.steps.filter((st) => st.minAmount === undefined || (input.amount ?? 0) >= st.minAmount);
      const instanceId = uuidv7();
      const state = steps.length ? 'pending' : 'approved';
      await tx.execute(sql`INSERT INTO core_workflow_instances (id, tenant_id, company_id, def_id, module_id, entity_type, entity_id, title, amount, state, started_by, finished_at)
        VALUES (${instanceId}, ${s.tenantId}, ${s.companyId}, ${defRow.id}, ${input.moduleId}, ${input.entityType}, ${input.entityId}, ${input.title}, ${input.amount ?? null}, ${state}, ${s.userId},
                ${state === 'approved' ? sql`now()` : sql`NULL`})`);
      let i = 0;
      for (const st of steps) {
        await tx.execute(sql`INSERT INTO core_workflow_steps (id, tenant_id, instance_id, step_index, step_key, approver_role, approver_user_id)
          VALUES (${uuidv7()}, ${s.tenantId}, ${instanceId}, ${i++}, ${st.key}, ${st.approverRole ?? null}, ${st.approverUserId ?? null})`);
      }
      await this.audit.append({ tenantId: s.tenantId, actorType: 'user', actorId: s.userId, action: 'workflow.started', moduleId: input.moduleId, entityType: input.entityType, entityId: input.entityId, after: { instanceId, amount: input.amount, steps: steps.length } }, tx);
      if (state === 'approved') await this.complete(tx, s, instanceId, input, 'approved');
      else await this.notifyApprovers(tx, s, instanceId);
      return { instanceId, state };
    };
    return txIn ? run(txIn) : this.db.tx({ tenantId: s.tenantId, companyIds: s.companyIds, userId: s.userId }, run);
  }

  private async eligibleUsers(tx: Db, step: { approver_role: string | null; approver_user_id: string | null }, companyId: string): Promise<string[]> {
    if (step.approver_user_id) return [step.approver_user_id];
    const r = await tx.execute(sql`SELECT DISTINCT m.user_id FROM core_role_assignments ra
      JOIN core_roles r ON r.id = ra.role_id JOIN core_memberships m ON m.id = ra.membership_id
      WHERE r.key = ${step.approver_role} AND m.status = 'active' AND (ra.company_id IS NULL OR ra.company_id = ${companyId})`);
    return (r.rows as { user_id: string }[]).map((x) => x.user_id);
  }

  private async notifyApprovers(tx: Db, s: Scope, instanceId: string): Promise<void> {
    const r = await tx.execute(sql`SELECT st.approver_role, st.approver_user_id, i.title, i.company_id, i.started_by FROM core_workflow_instances i
      JOIN core_workflow_steps st ON st.instance_id = i.id AND st.step_index = i.current_step WHERE i.id = ${instanceId}`);
    const row = r.rows[0] as { approver_role: string | null; approver_user_id: string | null; title: string; company_id: string; started_by: string } | undefined;
    if (!row) return;
    const users = (await this.eligibleUsers(tx, row, row.company_id)).filter((u) => u !== row.started_by);
    await this.notifications.notify({ tenantId: s.tenantId, userIds: users, type: 'core.workflow.pending', title: `در انتظار تأیید: ${row.title}`, link: '/app/approvals' }, tx);
  }

  async decide(s: Scope, instanceId: string, decision: 'approve' | 'reject', comment?: string): Promise<{ state: string }> {
    return this.db.tx({ tenantId: s.tenantId, companyIds: s.companyIds, userId: s.userId }, async (tx) => {
      const r = await tx.execute(sql`SELECT * FROM core_workflow_instances WHERE id = ${instanceId} FOR UPDATE`);
      const inst = r.rows[0] as { id: string; state: string; current_step: number; started_by: string; company_id: string; amount: string | null; module_id: string; entity_type: string; entity_id: string; title: string } | undefined;
      if (!inst) throw notFound();
      if (inst.state !== 'pending') throw conflict('WORKFLOW_FINISHED', 'این درخواست قبلاً نهایی شده است');
      if (inst.started_by === s.userId) throw forbidden('SELF_APPROVAL', 'درخواست‌دهنده نمی‌تواند درخواست خودش را تأیید کند');
      const prior = await tx.execute(sql`SELECT 1 FROM core_workflow_steps WHERE instance_id = ${instanceId} AND decided_by = ${s.userId}`);
      if (prior.rows.length) throw forbidden('DUPLICATE_APPROVER', 'هر فرد فقط می‌تواند یک مرحله از این درخواست را تأیید کند');
      const st = await tx.execute(sql`SELECT * FROM core_workflow_steps WHERE instance_id = ${instanceId} AND step_index = ${inst.current_step}`);
      const step = st.rows[0] as { id: string; approver_role: string | null; approver_user_id: string | null; step_key: string } | undefined;
      if (!step) throw badRequest('WORKFLOW_BROKEN', 'مرحله جاری یافت نشد');
      if (!(await this.eligibleUsers(tx, step, inst.company_id)).includes(s.userId)) throw forbidden('NOT_APPROVER', 'شما تأییدکننده این مرحله نیستید');
      if (decision === 'approve' && step.approver_role && inst.amount !== null) {
        const lim = await tx.execute(sql`SELECT approval_limit FROM core_roles WHERE key = ${step.approver_role}`);
        const limit = (lim.rows[0] as { approval_limit: string | null } | undefined)?.approval_limit;
        if (limit !== null && limit !== undefined && BigInt(inst.amount) > BigInt(limit)) throw forbidden('OVER_APPROVAL_LIMIT', 'مبلغ از سقف اختیار تأیید این نقش بیشتر است');
      }
      await tx.execute(sql`UPDATE core_workflow_steps SET decision = ${decision}, comment = ${comment ?? null}, decided_by = ${s.userId}, decided_at = now() WHERE id = ${step.id}`);
      await this.audit.append({ tenantId: s.tenantId, actorType: 'user', actorId: s.userId, action: `workflow.${decision}`, moduleId: inst.module_id, entityType: inst.entity_type, entityId: inst.entity_id, after: { instanceId, step: step.step_key, comment } }, tx);
      const total = await tx.execute(sql`SELECT count(*)::int AS n FROM core_workflow_steps WHERE instance_id = ${instanceId}`);
      const n = (total.rows[0] as { n: number }).n;
      const input = { moduleId: inst.module_id, entityType: inst.entity_type, entityId: inst.entity_id, title: inst.title, key: '' };
      if (decision === 'reject') {
        await this.complete(tx, s, instanceId, input, 'rejected', inst.started_by);
        return { state: 'rejected' };
      }
      if (inst.current_step + 1 >= n) {
        await this.complete(tx, s, instanceId, input, 'approved', inst.started_by);
        return { state: 'approved' };
      }
      await tx.execute(sql`UPDATE core_workflow_instances SET current_step = current_step + 1 WHERE id = ${instanceId}`);
      await this.notifyApprovers(tx, s, instanceId);
      return { state: 'pending' };
    });
  }

  private async complete(tx: Db, s: Scope, instanceId: string, input: Omit<StartInput, 'amount'>, state: 'approved' | 'rejected', startedBy?: string): Promise<void> {
    await tx.execute(sql`UPDATE core_workflow_instances SET state = ${state}, finished_at = now() WHERE id = ${instanceId}`);
    await this.events.publish(tx, { tenantId: s.tenantId, companyId: s.companyId, moduleId: 'core', type: WORKFLOW_COMPLETED, payload: { instanceId, state, moduleId: input.moduleId, entityType: input.entityType, entityId: input.entityId } });
    if (startedBy && startedBy !== s.userId) {
      await this.notifications.notify({ tenantId: s.tenantId, userIds: [startedBy], type: 'core.workflow.finished', title: `${state === 'approved' ? 'تأیید شد' : 'رد شد'}: ${input.title}`, link: '/app/approvals' }, tx);
    }
  }

  /** Pending steps the user can decide now (their approval inbox). */
  async inbox(s: Scope) {
    return this.db.tx({ tenantId: s.tenantId, companyIds: s.companyIds }, async (tx) => {
      const r = await tx.execute(sql`SELECT i.id, i.title, i.amount, i.module_id, i.entity_type, i.entity_id, i.started_at, i.started_by, u.full_name AS started_by_name,
             st.step_key, st.approver_role, st.approver_user_id
        FROM core_workflow_instances i JOIN core_workflow_steps st ON st.instance_id = i.id AND st.step_index = i.current_step
        JOIN core_users u ON u.id = i.started_by
        WHERE i.state = 'pending' AND i.started_by <> ${s.userId}
          AND NOT EXISTS (SELECT 1 FROM core_workflow_steps p WHERE p.instance_id = i.id AND p.decided_by = ${s.userId})
          AND (st.approver_user_id = ${s.userId} OR st.approver_role IN (
                SELECT r.key FROM core_role_assignments ra JOIN core_roles r ON r.id = ra.role_id JOIN core_memberships m ON m.id = ra.membership_id
                 WHERE m.user_id = ${s.userId} AND (ra.company_id IS NULL OR ra.company_id = i.company_id)))
        ORDER BY i.started_at`);
      return r.rows;
    });
  }

  async instancesFor(s: Scope, moduleId: string, entityType: string, entityId: string) {
    return this.db.tx({ tenantId: s.tenantId, companyIds: s.companyIds }, async (tx) => {
      const r = await tx.execute(sql`SELECT i.*, (SELECT json_agg(st ORDER BY st.step_index) FROM core_workflow_steps st WHERE st.instance_id = i.id) AS steps
        FROM core_workflow_instances i WHERE module_id = ${moduleId} AND entity_type = ${entityType} AND entity_id = ${entityId} ORDER BY started_at DESC`);
      return r.rows;
    });
  }
}
