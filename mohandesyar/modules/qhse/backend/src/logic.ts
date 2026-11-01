import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, ModuleEventContext, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { frequencyRates, inspectionScore, riskRating } from './calc.js';
import { conflict, forbidden, invalid, notFound } from './errors.js';
import type {
  actionDoneInput, actionInput, actionQuery, checklistInput, incidentInput, incidentQuery, inspectionInput, investigationInput, manhoursInput, ncrInput, ppeInput, reportQuery,
  riskInput, settingsInput, trainingInput,
} from './inputs.js';

type Row = Record<string, unknown>;
const rows = async <T = Row>(tx: Db, q: SQL) => (await tx.execute(q)).rows as T[];
const one = async <T = Row>(tx: Db, q: SQL) => (await rows<T>(tx, q))[0];
const uuids = (ids: readonly string[]) => sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `);
const fa = (n: number) => n.toLocaleString('fa-IR');

type Projects = { memberOf(u: string): Promise<string[]>; get(id: string): Promise<{ id: string; code: string; title: string } | null>; search(q: string, l: number): Promise<{ id: string; code: string; title: string }[]> };
const projectsOf = (ctx: { services: ModuleRequestContext['services'] }) => ctx.services.get<Projects>('projects.projects', '^1');

// ---------------------------------------------------------------- scope

/** null = whole company; otherwise the user's projects. */
async function scopeOf(ctx: ModuleRequestContext, permission: string): Promise<string[] | null> {
  if (ctx.can(permission, 'company')) return null;
  if (!ctx.can(permission, 'project')) return [];
  return (await projectsOf(ctx)?.memberOf(ctx.userId)) ?? [];
}
/** Row filter on `<alias>.projects_project_id`; `own` adds rows the user created regardless of project. */
function inScope(scope: string[] | null, alias: string, own?: SQL): SQL {
  if (scope === null) return sql`TRUE`;
  const col = sql.raw(`${alias}.projects_project_id`);
  const mine = scope.length ? sql`${col} IN (${uuids(scope)})` : sql`FALSE`;
  return own ? sql`(${mine} OR ${own})` : mine;
}
async function assertProject(ctx: ModuleRequestContext, permission: string, projectId: string | null) {
  const scope = await scopeOf(ctx, permission);
  if (scope !== null && (!projectId || !scope.includes(projectId))) throw forbidden('فقط برای پروژه‌هایی که عضو آن هستید ممکن است');
  if (projectId) {
    const svc = projectsOf(ctx);
    if (svc && !(await svc.get(projectId))) throw invalid('PROJECT', 'پروژه یافت نشد');
  }
}
/** Loads a row of `table` and checks it lies within the caller's `permission` scope. */
async function loadScoped<T extends { projects_project_id: string | null }>(ctx: ModuleRequestContext, tx: Db, permission: string, table: string, id: string, what: string, lock = false) {
  const r = await one<T>(tx, sql`SELECT * FROM ${sql.raw(table)} WHERE id = ${id} ${lock ? sql`FOR UPDATE` : sql``}`);
  if (!r) throw notFound(what);
  const scope = await scopeOf(ctx, permission);
  if (scope !== null && (!r.projects_project_id || !scope.includes(r.projects_project_id))) throw notFound(what);
  return r;
}
async function nextNumber(tx: Db, table: 'qhse_incidents' | 'qhse_ncrs', companyId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${table}:${companyId}`}))`);
  return (await one<{ n: number }>(tx, sql`SELECT coalesce(max(number), 0)::int + 1 AS n FROM ${sql.raw(table)} WHERE company_id = ${companyId}`))!.n;
}
async function validUsers(ctx: ModuleRequestContext, ids: (string | null | undefined)[]) {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return;
  const found = new Set((await ctx.directory(want)).map((u) => u.id));
  if (want.some((x) => !found.has(x))) throw invalid('USER', 'کاربر معتبر نیست');
}

export const KIND_FA: Record<string, string> = { injury: 'حادثه با آسیب', near_miss: 'شبه‌حادثه', unsafe_condition: 'شرایط ناایمن', property_damage: 'خسارت به اموال', environmental: 'رویداد زیست‌محیطی' };
const SEVERITY_FA: Record<string, string> = { low: 'کم', medium: 'متوسط', high: 'زیاد', critical: 'بحرانی' };

// ---------------------------------------------------------------- incidents

export const Incidents = {
  async list(ctx: ModuleRequestContext, f: z.infer<typeof incidentQuery>) {
    const view = await scopeOf(ctx, 'qhse.view');
    // Reporters without view rights see the incidents they reported.
    const where = ctx.can('qhse.view', 'project') ? inScope(view, 'i', sql`i.reported_by = ${ctx.userId}`) : sql`i.reported_by = ${ctx.userId}`;
    return ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT i.id, i.number, i.kind, i.severity, i.occurred_on::text, i.occurred_time, i.projects_project_id, i.location, i.title, i.injured_count, i.lost_days, i.fatality, i.status,
          i.reported_by, (SELECT count(*)::int FROM qhse_actions a WHERE a.incident_id = i.id AND a.status <> 'verified') AS open_actions
        FROM qhse_incidents i WHERE ${where}
          ${f.status ? sql`AND i.status = ${f.status}` : sql``} ${f.kind ? sql`AND i.kind = ${f.kind}` : sql``} ${f.projectId ? sql`AND i.projects_project_id = ${f.projectId}` : sql``}
        ORDER BY i.occurred_on DESC, i.number DESC LIMIT 1000`),
    );
  },

  async get(ctx: ModuleRequestContext, id: string) {
    return ctx.db.transaction(async (tx) => {
      const i = await one<{ projects_project_id: string | null; reported_by: string }>(tx, sql`SELECT i.*, i.occurred_on::text FROM qhse_incidents i WHERE i.id = ${id}`);
      if (!i) throw notFound('حادثه');
      const view = await scopeOf(ctx, 'qhse.view');
      const visible = i.reported_by === ctx.userId || view === null || (!!i.projects_project_id && view.includes(i.projects_project_id));
      if (!visible) throw notFound('حادثه');
      const actions = await rows(tx, sql`SELECT id, kind, title, owner_id, due_on::text, status, done_note, verified_by FROM qhse_actions WHERE incident_id = ${id} ORDER BY due_on`);
      const ncrs = await rows(tx, sql`SELECT id, number, title, status FROM qhse_ncrs WHERE incident_id = ${id} ORDER BY number`);
      const manage = await scopeOf(ctx, 'qhse.manage');
      const canManage = manage === null || (!!i.projects_project_id && manage.includes(i.projects_project_id));
      return { incident: i, actions, ncrs, canManage };
    });
  },

  async report(ctx: ModuleRequestContext, input: z.infer<typeof incidentInput>) {
    await assertProject(ctx, 'qhse.incident.report', input.projectId);
    const r = await ctx.db.transaction(async (tx) => {
      const n = await nextNumber(tx, 'qhse_incidents', ctx.companyId);
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO qhse_incidents (id, tenant_id, company_id, number, kind, severity, occurred_on, occurred_time, projects_project_id, location, title, description,
          injured_count, lost_days, fatality, immediate_action, reported_by)
        VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${n}, ${input.kind}, ${input.fatality ? 'critical' : input.severity}, ${input.occurredOn}, ${input.occurredTime}, ${input.projectId},
          ${input.location}, ${input.title}, ${input.description}, ${input.injuredCount}, ${input.lostDays}, ${input.fatality}, ${input.immediateAction}, ${ctx.userId})`);
      await ctx.audit({ action: 'qhse.incident.reported', entityType: 'incident', entityId: id, after: { number: n, kind: input.kind, severity: input.severity } }, tx);
      await ctx.publish('qhse.incident.reported', { incidentId: id, number: n, kind: input.kind, severity: input.fatality ? 'critical' : input.severity, projectId: input.projectId, companyId: ctx.companyId }, tx);
      const s = await one<{ urgent_recipients: string[] }>(tx, sql`SELECT urgent_recipients FROM qhse_settings WHERE company_id = ${ctx.companyId}`);
      return { id, number: n, recipients: s?.urgent_recipients ?? [] };
    });
    // Urgent notification (in-app + e-mail through the core) for high and critical incidents.
    const severity = input.fatality ? 'critical' : input.severity;
    let notified = 0;
    if ((severity === 'high' || severity === 'critical') && r.recipients.length) {
      const users = (await ctx.directory(r.recipients)).map((u) => u.id).filter((u) => u !== ctx.userId);
      if (users.length) {
        await ctx.notify({
          userIds: users,
          type: 'qhse.incident.urgent',
          title: `فوری: ${KIND_FA[input.kind]} با شدت ${SEVERITY_FA[severity]} — ${input.title}`,
          body: `${input.location ? `محل: ${input.location}. ` : ''}${input.injuredCount ? `مصدوم: ${fa(input.injuredCount)} نفر. ` : ''}${input.fatality ? 'فوت گزارش شده است. ' : ''}${input.immediateAction}`,
          link: `/app/qhse/incidents/${r.id}`,
        });
        notified = users.length;
      }
    }
    return { id: r.id, number: r.number, notified };
  },

  async investigate(ctx: ModuleRequestContext, id: string, input: z.infer<typeof investigationInput>) {
    await ctx.db.transaction(async (tx) => {
      const i = await loadScoped<{ projects_project_id: string | null; status: string }>(ctx, tx, 'qhse.manage', 'qhse_incidents', id, 'حادثه', true);
      if (i.status === 'closed') throw conflict('CLOSED', 'این حادثه بسته شده است');
      if (input.status === 'closed' && (await one(tx, sql`SELECT 1 FROM qhse_actions WHERE incident_id = ${id} AND status = 'open'`))) {
        throw conflict('OPEN_ACTIONS', 'اقدامات این حادثه هنوز انجام نشده‌اند');
      }
      await tx.execute(sql`UPDATE qhse_incidents SET status = ${input.status}, root_cause = ${input.rootCause}, lost_days = coalesce(${input.lostDays ?? null}::int, lost_days),
          closed_by = ${input.status === 'closed' ? ctx.userId : null}, closed_at = ${input.status === 'closed' ? sql`now()` : sql`NULL`} WHERE id = ${id}`);
      await ctx.audit({ action: `qhse.incident.${input.status}`, entityType: 'incident', entityId: id, after: { rootCause: input.rootCause } }, tx);
    });
  },
};

// ---------------------------------------------------------------- man-hours

export const Manhours = {
  async list(ctx: ModuleRequestContext) {
    const scope = await scopeOf(ctx, 'qhse.view');
    return ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT m.id, m.projects_project_id, m.month, m.hours::float, m.headcount FROM qhse_manhours m WHERE ${scope === null ? sql`TRUE` : inScope(scope, 'm')} ORDER BY m.month DESC LIMIT 500`),
    );
  },
  async save(ctx: ModuleRequestContext, input: z.infer<typeof manhoursInput>) {
    await assertProject(ctx, 'qhse.manage', input.projectId);
    await ctx.db.transaction(async (tx) => {
      const existing = await one<{ id: string }>(tx, sql`SELECT id FROM qhse_manhours WHERE company_id = ${ctx.companyId} AND projects_project_id IS NOT DISTINCT FROM ${input.projectId}::uuid AND month = ${input.month}`);
      if (existing) await tx.execute(sql`UPDATE qhse_manhours SET hours = ${input.hours}, headcount = ${input.headcount}, recorded_by = ${ctx.userId}, recorded_at = now() WHERE id = ${existing.id}`);
      else {
        await tx.execute(sql`INSERT INTO qhse_manhours (id, tenant_id, company_id, projects_project_id, month, hours, headcount, recorded_by)
          VALUES (${randomUUID()}, ${ctx.tenantId}, ${ctx.companyId}, ${input.projectId}, ${input.month}, ${input.hours}, ${input.headcount}, ${ctx.userId})`);
      }
      await ctx.audit({ action: 'qhse.manhours.saved', entityType: 'manhours', after: input }, tx);
    });
  },
};

// ---------------------------------------------------------------- risks

export const Risks = {
  async list(ctx: ModuleRequestContext) {
    const scope = await scopeOf(ctx, 'qhse.view');
    const list = await ctx.db.transaction((tx) =>
      rows<{ likelihood: number; severity: number; residual_likelihood: number | null; residual_severity: number | null }>(tx, sql`SELECT r.*, r.review_on::text FROM qhse_risks r
        WHERE ${inScope(scope, 'r')} ORDER BY r.status, r.likelihood * r.severity DESC, r.updated_at DESC LIMIT 1000`),
    );
    return list.map((r) => ({
      ...r,
      rating: riskRating(r.likelihood, r.severity),
      residual: r.residual_likelihood && r.residual_severity ? riskRating(r.residual_likelihood, r.residual_severity) : null,
    }));
  },
  async save(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof riskInput>) {
    await assertProject(ctx, 'qhse.manage', input.projectId);
    await validUsers(ctx, [input.ownerId]);
    return ctx.db.transaction(async (tx) => {
      const f = sql`projects_project_id = ${input.projectId}, activity = ${input.activity}, hazard = ${input.hazard}, consequence = ${input.consequence}, likelihood = ${input.likelihood},
        severity = ${input.severity}, controls = ${input.controls}, residual_likelihood = ${input.residualLikelihood}, residual_severity = ${input.residualSeverity}, owner_id = ${input.ownerId},
        review_on = ${input.reviewOn}, status = ${input.status}, updated_at = now()`;
      if (id) {
        await loadScoped(ctx, tx, 'qhse.manage', 'qhse_risks', id, 'ریسک', true);
        await tx.execute(sql`UPDATE qhse_risks SET ${f} WHERE id = ${id}`);
      } else {
        id = randomUUID();
        await tx.execute(sql`INSERT INTO qhse_risks (id, tenant_id, company_id, activity, hazard, likelihood, severity, created_by) VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.activity}, ${input.hazard}, ${input.likelihood}, ${input.severity}, ${ctx.userId})`);
        await tx.execute(sql`UPDATE qhse_risks SET ${f} WHERE id = ${id}`);
      }
      await ctx.audit({ action: 'qhse.risk.saved', entityType: 'risk', entityId: id, after: { score: input.likelihood * input.severity, status: input.status } }, tx);
      return { id };
    });
  },
};

// ---------------------------------------------------------------- checklists and inspections

export const Inspections = {
  checklists: (ctx: ModuleRequestContext) => ctx.db.transaction((tx) => rows(tx, sql`SELECT id, name, area, items, archived FROM qhse_checklists ORDER BY archived, name`)),

  async saveChecklist(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof checklistInput>) {
    return ctx.db.transaction(async (tx) => {
      const items = JSON.stringify(input.items.map((text) => ({ text })));
      try {
        if (id) {
          if (!(await rows(tx, sql`UPDATE qhse_checklists SET name = ${input.name}, area = ${input.area}, items = ${items}::jsonb, archived = ${input.archived} WHERE id = ${id} RETURNING id`)).length) throw notFound('چک‌لیست');
        } else {
          id = randomUUID();
          await tx.execute(sql`INSERT INTO qhse_checklists (id, tenant_id, company_id, name, area, items, archived) VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.name}, ${input.area}, ${items}::jsonb, ${input.archived})`);
        }
      } catch (e) {
        if ((e as { cause?: { code?: string } }).cause?.code === '23505') throw conflict('DUPLICATE', 'چک‌لیستی با این نام وجود دارد');
        throw e;
      }
      return { id };
    });
  },

  async list(ctx: ModuleRequestContext) {
    const scope = await scopeOf(ctx, 'qhse.view');
    return ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT x.id, x.checklist_name, x.projects_project_id, x.inspected_on::text, x.location, x.inspector_id, x.ok_count, x.nok_count, x.score::float,
          (SELECT n.id FROM qhse_ncrs n WHERE n.inspection_id = x.id LIMIT 1) AS ncr_id
        FROM qhse_inspections x WHERE ${inScope(scope, 'x')} ORDER BY x.inspected_on DESC LIMIT 1000`),
    );
  },

  async get(ctx: ModuleRequestContext, id: string) {
    return ctx.db.transaction(async (tx) => {
      const x = await loadScoped(ctx, tx, 'qhse.view', 'qhse_inspections', id, 'بازرسی');
      return { ...x, inspected_on: String((x as Row).inspected_on).slice(0, 10) };
    });
  },

  /** Records an inspection from a checklist; optionally raises one non-conformance listing the failed items. */
  async create(ctx: ModuleRequestContext, input: z.infer<typeof inspectionInput>) {
    await assertProject(ctx, 'qhse.manage', input.projectId);
    return ctx.db.transaction(async (tx) => {
      const c = await one<{ name: string; area: string; items: { text: string }[]; archived: boolean }>(tx, sql`SELECT name, area, items, archived FROM qhse_checklists WHERE id = ${input.checklistId}`);
      if (!c || c.archived) throw invalid('CHECKLIST', 'چک‌لیست معتبر نیست');
      if (input.results.length !== c.items.length) throw invalid('RESULTS', `نتیجه هر ${fa(c.items.length)} بند را وارد کنید`);
      const results = c.items.map((it, i) => ({ text: it.text, result: input.results[i]!.result, note: input.results[i]!.note }));
      const s = inspectionScore(results);
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO qhse_inspections (id, tenant_id, company_id, checklist_id, checklist_name, projects_project_id, inspected_on, location, inspector_id, results, ok_count, nok_count, score, notes)
        VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.checklistId}, ${c.name}, ${input.projectId}, ${input.inspectedOn}, ${input.location}, ${ctx.userId}, ${JSON.stringify(results)}::jsonb,
          ${s.ok}, ${s.nok}, ${s.score}, ${input.notes})`);
      let ncrId: string | null = null;
      if (input.raiseNcr) {
        const failed = results.filter((r) => r.result === 'nok');
        if (!failed.length) throw invalid('NO_FAILURES', 'بند نامنطبقی برای ثبت عدم انطباق وجود ندارد');
        ncrId = randomUUID();
        const n = await nextNumber(tx, 'qhse_ncrs', ctx.companyId);
        await tx.execute(sql`INSERT INTO qhse_ncrs (id, tenant_id, company_id, number, source, inspection_id, projects_project_id, area, title, description, severity, raised_by, raised_on)
          VALUES (${ncrId}, ${ctx.tenantId}, ${ctx.companyId}, ${n}, 'inspection', ${id}, ${input.projectId}, ${c.area}, ${`عدم انطباق بازرسی «${c.name}»`},
            ${failed.map((r) => `- ${r.text}${r.note ? `: ${r.note}` : ''}`).join('\n')}, ${failed.length >= 3 ? 'major' : 'minor'}, ${ctx.userId}, ${input.inspectedOn})`);
      }
      await ctx.audit({ action: 'qhse.inspection.recorded', entityType: 'inspection', entityId: id, after: { score: s.score, ncr: ncrId } }, tx);
      return { id, score: s.score, ncrId };
    });
  },
};

// ---------------------------------------------------------------- non-conformances and actions

export const Ncrs = {
  async list(ctx: ModuleRequestContext) {
    const scope = await scopeOf(ctx, 'qhse.view');
    return ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT n.id, n.number, n.source, n.projects_project_id, n.area, n.title, n.severity, n.status, n.raised_by, n.raised_on::text,
          (SELECT count(*)::int FROM qhse_actions a WHERE a.ncr_id = n.id) AS actions,
          (SELECT count(*)::int FROM qhse_actions a WHERE a.ncr_id = n.id AND a.status = 'verified') AS verified
        FROM qhse_ncrs n WHERE ${inScope(scope, 'n')} ORDER BY n.status DESC, n.number DESC LIMIT 1000`),
    );
  },
  async get(ctx: ModuleRequestContext, id: string) {
    return ctx.db.transaction(async (tx) => {
      const n = await loadScoped(ctx, tx, 'qhse.view', 'qhse_ncrs', id, 'عدم انطباق');
      const actions = await rows(tx, sql`SELECT id, kind, title, owner_id, due_on::text, status, done_note, verified_by FROM qhse_actions WHERE ncr_id = ${id} ORDER BY due_on`);
      return { ncr: { ...n, raised_on: String((n as Row).raised_on).slice(0, 10) }, actions };
    });
  },
  async create(ctx: ModuleRequestContext, input: z.infer<typeof ncrInput>) {
    await assertProject(ctx, 'qhse.manage', input.projectId);
    return ctx.db.transaction(async (tx) => {
      if (input.incidentId) await loadScoped(ctx, tx, 'qhse.manage', 'qhse_incidents', input.incidentId, 'حادثه');
      const n = await nextNumber(tx, 'qhse_ncrs', ctx.companyId);
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO qhse_ncrs (id, tenant_id, company_id, number, source, incident_id, projects_project_id, area, title, description, severity, raised_by, raised_on)
        VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${n}, ${input.incidentId ? 'incident' : input.source}, ${input.incidentId}, ${input.projectId}, ${input.area}, ${input.title}, ${input.description},
          ${input.severity}, ${ctx.userId}, ${input.raisedOn})`);
      await ctx.audit({ action: 'qhse.ncr.raised', entityType: 'ncr', entityId: id, after: { number: n } }, tx);
      return { id, number: n };
    });
  },
  /** Closed only when it has at least one action and every action is verified. */
  async close(ctx: ModuleRequestContext, id: string) {
    await ctx.db.transaction(async (tx) => {
      const n = await loadScoped<{ projects_project_id: string | null; status: string }>(ctx, tx, 'qhse.manage', 'qhse_ncrs', id, 'عدم انطباق', true);
      if (n.status === 'closed') throw conflict('CLOSED', 'قبلاً بسته شده است');
      const a = (await one<{ total: number; verified: number }>(tx, sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'verified')::int AS verified FROM qhse_actions WHERE ncr_id = ${id}`))!;
      if (a.total === 0) throw conflict('NO_ACTIONS', 'برای بستن، دست‌کم یک اقدام اصلاحی لازم است');
      if (a.verified < a.total) throw conflict('UNVERIFIED', 'اثربخشی همه اقدامات هنوز تأیید نشده است');
      await tx.execute(sql`UPDATE qhse_ncrs SET status = 'closed', closed_by = ${ctx.userId}, closed_at = now() WHERE id = ${id}`);
      await ctx.audit({ action: 'qhse.ncr.closed', entityType: 'ncr', entityId: id }, tx);
    });
  },
};

export const Actions = {
  async list(ctx: ModuleRequestContext, f: z.infer<typeof actionQuery>, today: string) {
    const scope = await scopeOf(ctx, 'qhse.view');
    const where = ctx.can('qhse.view', 'project') ? inScope(scope, 'a', sql`a.owner_id = ${ctx.userId}`) : sql`a.owner_id = ${ctx.userId}`;
    return ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT a.id, a.kind, a.title, a.owner_id, a.due_on::text, a.status, a.done_note, a.verified_by, a.ncr_id, a.incident_id, a.projects_project_id,
          (a.status = 'open' AND a.due_on < ${today}::date) AS overdue, n.number AS ncr_number, i.number AS incident_number
        FROM qhse_actions a LEFT JOIN qhse_ncrs n ON n.id = a.ncr_id LEFT JOIN qhse_incidents i ON i.id = a.incident_id
        WHERE ${where} ${f.mine ? sql`AND a.owner_id = ${ctx.userId}` : sql``}
          ${f.status === 'overdue' ? sql`AND a.status = 'open' AND a.due_on < ${today}::date` : f.status ? sql`AND a.status = ${f.status}` : sql``}
        ORDER BY (a.status = 'verified'), a.due_on LIMIT 1000`),
    );
  },
  async create(ctx: ModuleRequestContext, input: z.infer<typeof actionInput>) {
    if (!input.ncrId && !input.incidentId) throw invalid('SOURCE', 'اقدام باید به یک عدم انطباق یا حادثه مربوط باشد');
    await validUsers(ctx, [input.ownerId]);
    const id = randomUUID();
    await ctx.db.transaction(async (tx) => {
      const src = input.ncrId
        ? await loadScoped<{ projects_project_id: string | null; status: string }>(ctx, tx, 'qhse.manage', 'qhse_ncrs', input.ncrId, 'عدم انطباق')
        : await loadScoped<{ projects_project_id: string | null; status: string }>(ctx, tx, 'qhse.manage', 'qhse_incidents', input.incidentId!, 'حادثه');
      if (src.status === 'closed') throw conflict('CLOSED', 'مورد بسته شده است');
      await tx.execute(sql`INSERT INTO qhse_actions (id, tenant_id, company_id, kind, ncr_id, incident_id, projects_project_id, title, owner_id, due_on, created_by)
        VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.kind}, ${input.ncrId}, ${input.ncrId ? null : input.incidentId}, ${src.projects_project_id}, ${input.title}, ${input.ownerId}, ${input.dueOn}, ${ctx.userId})`);
      await ctx.audit({ action: 'qhse.action.created', entityType: 'qhse_action', entityId: id, after: { owner: input.ownerId, dueOn: input.dueOn } }, tx);
    });
    if (input.ownerId !== ctx.userId) await ctx.notify({ userIds: [input.ownerId], type: 'qhse.action.assigned', title: `اقدام ${input.kind === 'corrective' ? 'اصلاحی' : 'پیشگیرانه'} به شما سپرده شد: ${input.title}`, link: '/app/qhse/actions' });
    return { id };
  },
  /** Only the owner reports the action done. */
  async done(ctx: ModuleRequestContext, id: string, input: z.infer<typeof actionDoneInput>) {
    await ctx.db.transaction(async (tx) => {
      const a = await one<{ owner_id: string; status: string }>(tx, sql`SELECT owner_id, status FROM qhse_actions WHERE id = ${id} FOR UPDATE`);
      if (!a) throw notFound('اقدام');
      if (a.owner_id !== ctx.userId) throw forbidden('فقط مسئول اقدام انجام آن را ثبت می‌کند');
      if (a.status !== 'open') throw conflict('NOT_OPEN', 'این اقدام قبلاً انجام شده است');
      await tx.execute(sql`UPDATE qhse_actions SET status = 'done', done_note = ${input.note}, done_at = now() WHERE id = ${id}`);
      await ctx.audit({ action: 'qhse.action.done', entityType: 'qhse_action', entityId: id, after: { note: input.note } }, tx);
    });
  },
  /** Effectiveness check by someone with manage rights other than the owner (also a DB constraint). */
  async verify(ctx: ModuleRequestContext, id: string, accept: boolean) {
    await ctx.db.transaction(async (tx) => {
      const a = await loadScoped<{ projects_project_id: string | null; owner_id: string; status: string }>(ctx, tx, 'qhse.manage', 'qhse_actions', id, 'اقدام', true);
      if (a.owner_id === ctx.userId) throw forbidden('مسئول اقدام نمی‌تواند اثربخشی کار خود را تأیید کند');
      if (a.status !== 'done') throw conflict('NOT_DONE', 'اقدام هنوز انجام‌شده گزارش نشده است');
      if (accept) await tx.execute(sql`UPDATE qhse_actions SET status = 'verified', verified_by = ${ctx.userId}, verified_at = now() WHERE id = ${id}`);
      else await tx.execute(sql`UPDATE qhse_actions SET status = 'open', done_at = NULL WHERE id = ${id}`);
      await ctx.audit({ action: accept ? 'qhse.action.verified' : 'qhse.action.reopened', entityType: 'qhse_action', entityId: id }, tx);
    });
  },
};

// ---------------------------------------------------------------- training and PPE

export const Training = {
  async list(ctx: ModuleRequestContext) {
    const scope = await scopeOf(ctx, 'qhse.view');
    return ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT t.id, t.title, t.topic, t.held_on::text, t.hours::float, t.trainer, t.projects_project_id,
          coalesce((SELECT json_agg(json_build_object('userId', a.user_id, 'name', a.person_name) ORDER BY a.person_name) FROM qhse_training_attendees a WHERE a.training_id = t.id), '[]') AS attendees
        FROM qhse_trainings t WHERE ${inScope(scope, 't')} ORDER BY t.held_on DESC LIMIT 500`),
    );
  },
  async create(ctx: ModuleRequestContext, input: z.infer<typeof trainingInput>) {
    await assertProject(ctx, 'qhse.manage', input.projectId);
    await validUsers(ctx, input.attendees.map((a) => a.userId));
    return ctx.db.transaction(async (tx) => {
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO qhse_trainings (id, tenant_id, company_id, title, topic, held_on, hours, trainer, projects_project_id, created_by)
        VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.title}, ${input.topic}, ${input.heldOn}, ${input.hours}, ${input.trainer}, ${input.projectId}, ${ctx.userId})`);
      for (const a of input.attendees) {
        await tx.execute(sql`INSERT INTO qhse_training_attendees (id, tenant_id, company_id, training_id, user_id, person_name) VALUES (${randomUUID()}, ${ctx.tenantId}, ${ctx.companyId}, ${id}, ${a.userId}, ${a.name})`);
      }
      return { id };
    });
  },
};

export const Ppe = {
  async list(ctx: ModuleRequestContext, today: string) {
    const scope = await scopeOf(ctx, 'qhse.view');
    return ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT p.id, p.user_id, p.person_name, p.item, p.quantity, p.issued_on::text, p.replace_on::text, p.projects_project_id, p.issued_by,
          (p.replace_on IS NOT NULL AND p.replace_on <= ${today}::date) AS replace_due
        FROM qhse_ppe_issues p WHERE ${inScope(scope, 'p')} ORDER BY p.issued_on DESC LIMIT 2000`),
    );
  },
  async issue(ctx: ModuleRequestContext, input: z.infer<typeof ppeInput>) {
    await assertProject(ctx, 'qhse.manage', input.projectId);
    await validUsers(ctx, [input.userId]);
    return ctx.db.transaction(async (tx) => {
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO qhse_ppe_issues (id, tenant_id, company_id, user_id, person_name, item, quantity, issued_on, replace_on, projects_project_id, issued_by)
        VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.userId}, ${input.personName}, ${input.item}, ${input.quantity}, ${input.issuedOn}, ${input.replaceOn}, ${input.projectId}, ${ctx.userId})`);
      return { id };
    });
  },
};

// ---------------------------------------------------------------- settings

export const Settings = {
  async get(ctx: ModuleRequestContext) {
    return ctx.db.transaction(async (tx) => (await one<{ urgent_recipients: string[] }>(tx, sql`SELECT urgent_recipients FROM qhse_settings WHERE company_id = ${ctx.companyId}`)) ?? { urgent_recipients: [] });
  },
  async save(ctx: ModuleRequestContext, input: z.infer<typeof settingsInput>) {
    await validUsers(ctx, input.urgentRecipients);
    const ids = `{${[...new Set(input.urgentRecipients)].join(',')}}`;
    await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO qhse_settings (id, tenant_id, company_id, urgent_recipients) VALUES (${randomUUID()}, ${ctx.tenantId}, ${ctx.companyId}, ${ids}::uuid[])
        ON CONFLICT (company_id) DO UPDATE SET urgent_recipients = EXCLUDED.urgent_recipients, updated_at = now()`);
      await ctx.audit({ action: 'qhse.settings.saved', entityType: 'qhse_settings', after: input }, tx);
    });
  },
};

// ---------------------------------------------------------------- safety status report

/** Period status: counts by kind and severity, frequency rates from recorded man-hours, inspections, actions. */
export async function statusReport(ctx: ModuleRequestContext, f: z.infer<typeof reportQuery>, today: string) {
  if (f.from > f.to) throw invalid('RANGE', 'ابتدای بازه باید قبل از انتهای آن باشد');
  const scope = await scopeOf(ctx, 'qhse.view');
  const proj = (alias: string) => (f.projectId ? sql`${sql.raw(alias)}.projects_project_id = ${f.projectId}` : sql`TRUE`);
  return ctx.db.transaction(async (tx) => {
    const inc = await rows<{ kind: string; severity: string; n: number; injured: number; lost: number; lti: number; fatal: number }>(
      tx,
      sql`SELECT i.kind, i.severity, count(*)::int AS n, sum(i.injured_count)::int AS injured, sum(i.lost_days)::int AS lost,
          count(*) FILTER (WHERE i.kind = 'injury' AND (i.lost_days > 0 OR i.fatality))::int AS lti, count(*) FILTER (WHERE i.fatality)::int AS fatal
        FROM qhse_incidents i WHERE i.occurred_on BETWEEN ${f.from}::date AND ${f.to}::date AND ${inScope(scope, 'i')} AND ${proj('i')} GROUP BY 1, 2`,
    );
    const hours = Number((await one<{ h: string }>(tx, sql`SELECT coalesce(sum(m.hours), 0)::text AS h FROM qhse_manhours m
      WHERE m.month BETWEEN ${f.from.slice(0, 7)} AND ${f.to.slice(0, 7)} AND ${inScope(scope, 'm')} AND ${proj('m')}`))!.h);
    const insp = (await one<{ n: number; avg: number | null }>(tx, sql`SELECT count(*)::int AS n, round(avg(x.score), 1)::float AS avg FROM qhse_inspections x
      WHERE x.inspected_on BETWEEN ${f.from}::date AND ${f.to}::date AND ${inScope(scope, 'x')} AND ${proj('x')}`))!;
    const actions = (await one<{ open: number; overdue: number; verified: number }>(tx, sql`SELECT count(*) FILTER (WHERE a.status <> 'verified')::int AS open,
        count(*) FILTER (WHERE a.status = 'open' AND a.due_on < ${today}::date)::int AS overdue, count(*) FILTER (WHERE a.status = 'verified')::int AS verified
      FROM qhse_actions a WHERE ${inScope(scope, 'a')} AND ${proj('a')}`))!;
    const ncrs = (await one<{ open: number }>(tx, sql`SELECT count(*) FILTER (WHERE n.status = 'open')::int AS open FROM qhse_ncrs n WHERE ${inScope(scope, 'n')} AND ${proj('n')}`))!;
    const highRisks = (await one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM qhse_risks r WHERE r.status <> 'closed'
      AND coalesce(r.residual_likelihood * r.residual_severity, r.likelihood * r.severity) >= 15 AND ${inScope(scope, 'r')} AND ${proj('r')}`))!.n;
    const sum = (k: 'n' | 'injured' | 'lost' | 'lti' | 'fatal', where: (r: (typeof inc)[number]) => boolean = () => true) => inc.filter(where).reduce((s, r) => s + r[k], 0);
    const injuries = sum('n', (r) => r.kind === 'injury');
    return {
      byKind: Object.keys(KIND_FA).map((k) => ({ kind: k, n: sum('n', (r) => r.kind === k) })),
      bySeverity: ['low', 'medium', 'high', 'critical'].map((s) => ({ severity: s, n: sum('n', (r) => r.severity === s) })),
      injured: sum('injured'),
      lostDays: sum('lost'),
      lti: sum('lti'),
      fatalities: sum('fatal'),
      manhours: hours,
      rates: frequencyRates(hours, sum('lti'), injuries, sum('lost')),
      inspections: insp,
      actions,
      openNcrs: ncrs.open,
      highRisks,
    };
  });
}

// ---------------------------------------------------------------- reminders, widget, KPI, search

/** Overdue actions: one reminder per day to the owner. */
export async function remindOverdue(ctx: ModuleEventContext, today: string) {
  const due = await ctx.db.transaction((tx) =>
    rows<{ id: string; owner_id: string; title: string }>(tx, sql`UPDATE qhse_actions SET reminded_on = ${today}::date
      WHERE status = 'open' AND due_on < ${today}::date AND reminded_on IS DISTINCT FROM ${today}::date RETURNING id, owner_id, title`),
  );
  for (const a of due) await ctx.notify({ userIds: [a.owner_id], type: 'qhse.action.overdue', title: `مهلت اقدام گذشته است: ${a.title}`, link: '/app/qhse/actions' });
  return due.length;
}

export async function statusWidget(ctx: ModuleRequestContext, today: string) {
  const scope = await scopeOf(ctx, 'qhse.view');
  return ctx.db.transaction(async (tx) => {
    const last = await one<{ d: string | null }>(tx, sql`SELECT max(i.occurred_on)::text AS d FROM qhse_incidents i WHERE i.kind = 'injury' AND (i.lost_days > 0 OR i.fatality) AND ${inScope(scope, 'i')}`);
    const r = (await one<{ open_incidents: number; open_ncrs: number; overdue_actions: number; month_incidents: number }>(tx, sql`SELECT
        (SELECT count(*)::int FROM qhse_incidents i WHERE i.status <> 'closed' AND ${inScope(scope, 'i')}) AS open_incidents,
        (SELECT count(*)::int FROM qhse_ncrs n WHERE n.status = 'open' AND ${inScope(scope, 'n')}) AS open_ncrs,
        (SELECT count(*)::int FROM qhse_actions a WHERE a.status = 'open' AND a.due_on < ${today}::date AND ${inScope(scope, 'a')}) AS overdue_actions,
        (SELECT count(*)::int FROM qhse_incidents i WHERE i.occurred_on >= date_trunc('month', ${today}::date) AND ${inScope(scope, 'i')}) AS month_incidents`))!;
    const daysSinceLti = last?.d ? Math.round((Date.parse(today) - Date.parse(last.d)) / 86_400_000) : null;
    return { ...r, lastLti: last?.d ?? null, daysSinceLti };
  });
}

export const kpi = {
  count: (near: boolean) => (ctx: ModuleEventContext, p: { companyId: string; from: string; to: string }) =>
    ctx.db.transaction(async (tx) => (await one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM qhse_incidents WHERE company_id = ${p.companyId}
      AND occurred_on BETWEEN ${p.from}::date AND ${p.to}::date AND ${near ? sql`kind = 'near_miss'` : sql`kind <> 'near_miss'`}`))!.n),
  ltifr: (ctx: ModuleEventContext, p: { companyId: string; from: string; to: string }) =>
    ctx.db.transaction(async (tx) => {
      const lti = (await one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM qhse_incidents WHERE company_id = ${p.companyId} AND kind = 'injury' AND (lost_days > 0 OR fatality)
        AND occurred_on BETWEEN ${p.from}::date AND ${p.to}::date`))!.n;
      const h = Number((await one<{ h: string }>(tx, sql`SELECT coalesce(sum(hours), 0)::text AS h FROM qhse_manhours WHERE company_id = ${p.companyId} AND month BETWEEN ${p.from.slice(0, 7)} AND ${p.to.slice(0, 7)}`))!.h);
      return frequencyRates(h, lti, 0, 0).ltifr;
    }),
  overdue: (ctx: ModuleEventContext, p: { companyId: string; to: string }) =>
    ctx.db.transaction(async (tx) => (await one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM qhse_actions WHERE company_id = ${p.companyId} AND due_on < ${p.to}::date
      AND (status = 'open' OR (done_at IS NOT NULL AND done_at::date > ${p.to}::date))`))!.n),
  inspectionScore: (ctx: ModuleEventContext, p: { companyId: string; from: string; to: string }) =>
    ctx.db.transaction(async (tx) => (await one<{ v: number | null }>(tx, sql`SELECT round(avg(score), 1)::float AS v FROM qhse_inspections WHERE company_id = ${p.companyId}
      AND inspected_on BETWEEN ${p.from}::date AND ${p.to}::date`))!.v),
};

export async function search(ctx: ModuleRequestContext, q: string, limit: number) {
  const scope = await scopeOf(ctx, 'qhse.view');
  const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const r = await ctx.db.transaction((tx) =>
    rows<{ id: string; number: number; title: string }>(tx, sql`SELECT i.id, i.number, i.title FROM qhse_incidents i WHERE ${inScope(scope, 'i')}
      AND (i.title ILIKE ${like} OR i.location ILIKE ${like} OR i.number::text = ${q}) ORDER BY i.occurred_on DESC LIMIT ${limit}`),
  );
  return r.map((x) => ({ entityType: 'incident', entityId: x.id, title: `حادثه ${x.number.toLocaleString('fa-IR')} — ${x.title}`, link: `/app/qhse/incidents/${x.id}` }));
}

export async function projectOptions(ctx: ModuleRequestContext) {
  const svc = projectsOf(ctx);
  if (!svc) return [];
  const all = await svc.search('', 50);
  const scope = await scopeOf(ctx, 'qhse.incident.report');
  return scope === null ? all : all.filter((p) => scope.includes(p.id));
}
