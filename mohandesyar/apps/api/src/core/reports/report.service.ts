import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ModuleManifest } from '@mohandesyar/module-sdk';
import type { ReportResult } from '@mohandesyar/module-sdk/server';
import { toXlsx } from '@mohandesyar/export';
import { todayIso } from '@mohandesyar/persian';
import type { Database } from '../../infra/db.js';
import type { AuditService } from '../audit/audit.service.js';
import type { FileService } from '../files/file.service.js';
import type { ModuleContextFactory } from '../modules/context.js';
import type { ModuleRegistry } from '../modules/registry.js';
import type { NotificationService } from '../notifications/notification.service.js';
import type { RbacService } from '../rbac/rbac.service.js';
import type { TenancyService } from '../tenancy/tenancy.service.js';
import type { Identity } from '../http/context.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { buildIdentity } from '../http/identity.js';
import { nextRun, RANGES, resolveRange, type Range } from './period.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ معتبر نیست');
export const paramsInput = z
  .object({ range: z.enum(RANGES), from: isoDate.nullable().default(null), to: isoDate.nullable().default(null), filters: z.record(z.string(), z.string().max(200)).default({}) })
  .refine((p) => p.range !== 'custom' || (p.from && p.to && p.from <= p.to), { message: 'بازه دلخواه را کامل و درست وارد کنید', path: ['to'] });
export const savedInput = z.object({
  moduleId: z.string().min(1).max(64),
  reportKey: z.string().min(1).max(120),
  name: z.string().trim().min(2, 'نام گزارش الزامی است').max(120),
  params: paramsInput,
  schedule: z.enum(['none', 'daily', 'weekly', 'monthly']).default('none'),
  recipients: z.array(z.uuid()).max(50).default([]),
});
type Params = z.infer<typeof paramsInput>;
type Declared = ModuleManifest['reportProviders'][number];
export const REPORT_FILE_OWNER = 'core.reports';

/**
 * Reports from module providers (docs/03): on-screen runs, saved filters and scheduled delivery. A provider
 * always runs with the reader's own context, so a scheduled report never shows a recipient more than the
 * module itself would.
 */
export interface ReportDeps {
  db: Database;
  rbac: RbacService;
  tenancy: TenancyService;
  registry: ModuleRegistry;
  contexts: ModuleContextFactory;
  files: FileService;
  notifications: NotificationService;
  audit: AuditService;
}

export class ReportService {
  constructor(private readonly s: ReportDeps) {}

  /** Reports of the tenant's active modules that `id` may run. */
  async available(id: Identity) {
    const out: { moduleId: string; moduleName: unknown; key: string; title: unknown; description?: unknown; filters: Declared['filters'] }[] = [];
    for (const eff of await this.s.registry.effectiveFor(id.tenantId)) {
      const m = this.s.registry.loaded.get(eff.id);
      if (!m) continue;
      for (const r of m.manifest.reportProviders) {
        if (!m.definition.reports?.[r.key] || (r.permission && !id.permissions.can(r.permission))) continue;
        out.push({ moduleId: m.id, moduleName: m.manifest.name, key: r.key, title: r.title, description: r.description, filters: r.filters });
      }
    }
    return out;
  }

  private async provider(id: Identity, moduleId: string, key: string) {
    const check = await this.s.registry.check(id.tenantId, moduleId);
    if (!check.ok) throw notFound('ماژول فعال نیست');
    const m = check.module;
    const declared = m.manifest.reportProviders.find((r) => r.key === key);
    const fn = m.definition.reports?.[key];
    if (!declared || !fn) throw notFound('گزارش یافت نشد');
    if (declared.permission && !id.permissions.can(declared.permission)) throw forbidden();
    return { m, declared, fn };
  }

  private filtersOf(declared: Declared, filters: Record<string, string>) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(filters)) {
      if (v === '') continue;
      const f = declared.filters.find((x: Declared['filters'][number]) => x.key === k);
      if (!f) throw badRequest('FILTER', `فیلتر «${k}» برای این گزارش تعریف نشده است`);
      if (f.options && !(v in f.options)) throw badRequest('FILTER', `مقدار فیلتر «${f.label}» معتبر نیست`);
      out[k] = v;
    }
    return out;
  }

  async run(id: Identity, moduleId: string, key: string, params: Params): Promise<ReportResult & { period: { from: string; to: string } }> {
    const { m, declared, fn } = await this.provider(id, moduleId, key);
    const period = resolveRange(params, todayIso());
    const result = await fn(await this.s.contexts.forRequest(m, id), { ...period, filters: this.filtersOf(declared, params.filters) });
    return { ...result, period };
  }

  // ---------------------------------------------------------------- saved reports

  async listSaved(id: Identity) {
    return this.s.db.tx({ tenantId: id.tenantId, companyIds: [id.companyId] }, async (tx) =>
      (await tx.execute(sql`SELECT id, module_id, report_key, name, params, schedule, recipients, next_run_at, last_run_at, owner_id = ${id.userId} AS mine
        FROM core_saved_reports WHERE company_id = ${id.companyId} AND (owner_id = ${id.userId} OR ${id.userId}::uuid = ANY (recipients)) ORDER BY name`)).rows,
    );
  }

  async save(id: Identity, savedId: string | null, input: z.infer<typeof savedInput>) {
    const { declared } = await this.provider(id, input.moduleId, input.reportKey);
    this.filtersOf(declared, input.params.filters);
    const recipients = [...new Set(input.recipients)];
    if (input.schedule !== 'none' && !recipients.length) throw badRequest('RECIPIENTS', 'برای ارسال زمان‌بندی‌شده دست‌کم یک گیرنده انتخاب کنید');
    if (recipients.length) {
      const members = await this.s.db.tx({ tenantId: id.tenantId }, async (tx) =>
        (await tx.execute(sql`SELECT m.user_id FROM core_memberships m WHERE m.status = 'active' AND m.user_id = ANY (${`{${recipients.join(',')}}`}::uuid[])`)).rows as { user_id: string }[],
      );
      if (members.length !== recipients.length) throw badRequest('RECIPIENTS', 'یکی از گیرندگان عضو فعال سازمان نیست');
    }
    const next = input.schedule === 'none' ? null : nextRun(input.schedule, new Date());
    return this.s.db.tx({ tenantId: id.tenantId, companyIds: [id.companyId], userId: id.userId }, async (tx) => {
      const rid = savedId ?? randomUUID();
      const ids = `{${recipients.join(',')}}`;
      try {
        if (savedId) {
          const r = await tx.execute(sql`UPDATE core_saved_reports SET name = ${input.name}, params = ${JSON.stringify(input.params)}::jsonb, schedule = ${input.schedule}, recipients = ${ids}::uuid[],
              next_run_at = ${next} WHERE id = ${savedId} AND owner_id = ${id.userId} AND company_id = ${id.companyId} RETURNING id`);
          if (!r.rows.length) throw notFound('گزارش ذخیره‌شده');
        } else {
          await tx.execute(sql`INSERT INTO core_saved_reports (id, tenant_id, company_id, owner_id, module_id, report_key, name, params, schedule, recipients, next_run_at)
            VALUES (${rid}, ${id.tenantId}, ${id.companyId}, ${id.userId}, ${input.moduleId}, ${input.reportKey}, ${input.name}, ${JSON.stringify(input.params)}::jsonb, ${input.schedule}, ${ids}::uuid[], ${next})`);
        }
      } catch (e) {
        if ((e as { cause?: { code?: string } }).cause?.code === '23505') throw conflict('DUPLICATE', 'گزارشی با این نام دارید');
        throw e;
      }
      await this.s.audit.append({ tenantId: id.tenantId, actorType: 'user', actorId: id.userId, action: 'core.report.saved', entityType: 'saved_report', entityId: rid, after: { name: input.name, schedule: input.schedule, recipients } }, tx);
      return { id: rid, nextRunAt: next };
    });
  }

  async remove(id: Identity, savedId: string) {
    await this.s.db.tx({ tenantId: id.tenantId, companyIds: [id.companyId] }, async (tx) => {
      const r = await tx.execute(sql`DELETE FROM core_saved_reports WHERE id = ${savedId} AND owner_id = ${id.userId} RETURNING id`);
      if (!r.rows.length) throw notFound('گزارش ذخیره‌شده');
    });
  }

  /** Deliveries addressed to the current user. */
  async myRuns(id: Identity) {
    return this.s.db.tx({ tenantId: id.tenantId, companyIds: id.allowedCompanyIds }, async (tx) =>
      (await tx.execute(sql`SELECT r.id, r.saved_report_id, s.name, r.period_from::text, r.period_to::text, r.status, r.row_count, r.error, r.created_at, (r.file_id IS NOT NULL) AS has_file
        FROM core_report_runs r JOIN core_saved_reports s ON s.id = r.saved_report_id WHERE r.recipient_id = ${id.userId} ORDER BY r.created_at DESC LIMIT 200`)).rows,
    );
  }

  /** A delivery's file is served to its recipient only. */
  async download(id: Identity, runId: string) {
    const run = await this.s.db.tx({ tenantId: id.tenantId, companyIds: id.allowedCompanyIds }, async (tx) =>
      (await tx.execute(sql`SELECT file_id, recipient_id, company_id FROM core_report_runs WHERE id = ${runId}`)).rows[0] as { file_id: string | null; recipient_id: string; company_id: string } | undefined,
    );
    if (!run || run.recipient_id !== id.userId || !run.file_id) throw notFound('فایل گزارش');
    return this.s.files.downloadUrl({ tenantId: id.tenantId, companyId: run.company_id, companyIds: [run.company_id], userId: id.userId }, run.file_id, REPORT_FILE_OWNER);
  }

  /** Runs one saved report now for every recipient (also used by "send now"). */
  async deliver(tenantId: string, companyId: string, savedId: string): Promise<number> {
    const saved = await this.s.db.tx({ tenantId, companyIds: [companyId] }, async (tx) =>
      (await tx.execute(sql`SELECT id, company_id, module_id, report_key, name, params, recipients FROM core_saved_reports WHERE id = ${savedId}`)).rows[0] as
        | { id: string; company_id: string; module_id: string; report_key: string; name: string; params: Params; recipients: string[] }
        | undefined,
    );
    if (!saved) return 0;
    let delivered = 0;
    for (const userId of saved.recipients) {
      const runId = randomUUID();
      let row: { status: 'ok' | 'failed'; rows: number; fileId: string | null; error: string | null; period: { from: string | null; to: string | null } };
      try {
        const id = await buildIdentity(this.s, { userId, tenantId, sessionId: 'scheduled-report', amr: [], companyHeader: saved.company_id });
        const r = await this.run(id, saved.module_id, saved.report_key, saved.params);
        const data = Buffer.from(toXlsx(saved.name.slice(0, 31), r.columns.map((c) => ({ header: c.header, value: (x: Record<string, string | number | null>) => x[c.key], kind: c.kind === 'number' ? ('number' as const) : ('text' as const) })), r.rows));
        const file = await this.s.files.upload({ tenantId, companyId: saved.company_id, companyIds: [saved.company_id], userId }, { name: `${saved.name} ${r.period.from}..${r.period.to}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data },
          { confidentiality: 'confidential', owner: { module: REPORT_FILE_OWNER, entityType: 'report_run', entityId: runId } });
        row = { status: 'ok', rows: r.rows.length, fileId: file.id, error: null, period: r.period };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        row = { status: 'failed', rows: 0, fileId: null, error: msg.slice(0, 300), period: { from: null, to: null } };
      }
      await this.s.db.tx({ tenantId, companyIds: [saved.company_id] }, async (tx) => {
        await tx.execute(sql`INSERT INTO core_report_runs (id, tenant_id, company_id, saved_report_id, recipient_id, period_from, period_to, status, row_count, file_id, error)
          VALUES (${runId}, ${tenantId}, ${saved.company_id}, ${saved.id}, ${userId}, ${row.period.from}, ${row.period.to}, ${row.status}, ${row.rows}, ${row.fileId}, ${row.error})`);
        if (row.status === 'ok') {
          await this.s.notifications.notify({ tenantId, userIds: [userId], type: 'core.report.delivered', title: `گزارش «${saved.name}» آماده است (${row.rows.toLocaleString('fa-IR')} ردیف)`, link: '/app/reports?tab=inbox' }, tx);
        }
      });
      if (row.status === 'ok') delivered++;
    }
    await this.s.db.tx({ tenantId, companyIds: [saved.company_id] }, (tx) => tx.execute(sql`UPDATE core_saved_reports SET last_run_at = now() WHERE id = ${saved.id}`));
    return delivered;
  }

  /** Scheduler pass: claims due reports across tenants, delivers them and sets the next run. */
  async tick(now = new Date()): Promise<number> {
    const due = (await this.s.db.app.execute(sql`SELECT * FROM core_reports_claim(20)`)).rows as { id: string; tenant_id: string; company_id: string }[];
    let n = 0;
    for (const d of due) {
      n += await this.deliver(d.tenant_id, d.company_id, d.id);
      await this.s.db.tx({ tenantId: d.tenant_id, companyIds: [d.company_id] }, async (tx) => {
        const r = (await tx.execute(sql`SELECT schedule FROM core_saved_reports WHERE id = ${d.id}`)).rows[0] as { schedule: 'none' | 'daily' | 'weekly' | 'monthly' } | undefined;
        if (r && r.schedule !== 'none') await tx.execute(sql`UPDATE core_saved_reports SET next_run_at = ${nextRun(r.schedule, now)} WHERE id = ${d.id}`);
      });
    }
    return n;
  }
}

export type { Range };
