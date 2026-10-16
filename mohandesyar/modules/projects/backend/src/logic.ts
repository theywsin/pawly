import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, ModuleEventContext, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { daysBetween, workingDayAt, workingDaysBetween, type WorkCalendar } from '@mohandesyar/persian';

/** The organisation's working days (Fridays, fixed official holidays and holidays it entered are off). */
async function calendarOf(ctx: { workCalendar(): Promise<{ weeklyOff: number[]; holidays: string[] }> }): Promise<WorkCalendar> {
  const c = await ctx.workCalendar();
  return { weeklyOff: c.weeklyOff, holidays: new Set(c.holidays) };
}

/** Identifies a calendar, so a schedule computed with another calendar is recomputed. */
const fingerprint = (cal: WorkCalendar) => `${[...cal.weeklyOff].sort().join(',')}|${[...cal.holidays].sort().join(',')}`;

/** Recomputes the schedule when it was computed with a different calendar (holidays added or removed). */
async function ensureSchedule(tx: Db, p: { id: string; planned_start: string | null }, cal: WorkCalendar) {
  const r = await one<{ schedule_calendar: string | null }>(tx, sql`SELECT schedule_calendar FROM projects_projects WHERE id = ${p.id}`);
  if (r && r.schedule_calendar !== fingerprint(cal) && (await one(tx, sql`SELECT 1 FROM projects_activities WHERE project_id = ${p.id} AND deleted_at IS NULL LIMIT 1`))) await reschedule(tx, p, cal);
}

/** Working-day index of `date` from the project start (0 = first working day; −1 before the start). */
const workIndex = (start: string, date: string, cal: WorkCalendar) => (date < start ? -1 : workingDaysBetween(start, date, cal) - 1);
import { actualPercent, computeCpm, CycleError, plannedPercent, type DepType } from './cpm.js';
import { conflict, forbidden, invalid, notFound } from './errors.js';
import type { activityInput, changeRequestInput, dailyReportInput, dependencyInput, issueInput, listQuery, memberInput, phaseInput, phaseStatusInput, progressInput, projectInput, riskInput } from './inputs.js';

type Row = Record<string, unknown>;
const rows = async <T = Row>(tx: Db, q: SQL) => (await tx.execute(q)).rows as T[];
const one = async <T = Row>(tx: Db, q: SQL) => (await rows<T>(tx, q))[0];

export interface ProjectRow {
  id: string;
  company_id: string;
  code: string;
  title: string;
  project_type: string;
  employer_name: string;
  crm_account_id: string | null;
  contracts_contract_id: string | null;
  manager_id: string | null;
  province: string;
  city: string;
  location: string;
  specs: string;
  description: string;
  planned_start: string | null;
  planned_finish: string | null;
  actual_start: string | null;
  actual_finish: string | null;
  budget_amount: string | null;
  status: string;
  created_by: string;
  created_at: string;
  version: number;
}

const PROJECT_COLUMNS = sql`p.id, p.company_id, p.code, p.title, p.project_type, p.employer_name, p.crm_account_id, p.contracts_contract_id, p.manager_id,
  p.province, p.city, p.location, p.specs, p.description, p.planned_start::text, p.planned_finish::text, p.actual_start::text, p.actual_finish::text,
  p.budget_amount::text, p.status, p.created_by, p.created_at, p.version`;

/** Row filter: all company projects with company scope, otherwise projects the user manages or belongs to. */
function visible(ctx: ModuleRequestContext, permission: string): SQL {
  if (ctx.can(permission, 'company')) return sql`TRUE`;
  if (!ctx.can(permission, 'project')) return sql`FALSE`;
  return sql`(p.manager_id = ${ctx.userId} OR EXISTS (SELECT 1 FROM projects_members m WHERE m.project_id = p.id AND m.user_id = ${ctx.userId}))`;
}

/** The project if the caller holds `permission` on it (company-wide or as a member); 404 otherwise. */
async function load(tx: Db, ctx: ModuleRequestContext, id: string, permission: string, lock = false): Promise<ProjectRow> {
  const p = await one<ProjectRow>(tx, sql`SELECT ${PROJECT_COLUMNS} FROM projects_projects p WHERE p.id = ${id} AND p.deleted_at IS NULL AND ${visible(ctx, 'projects.project.view')} ${lock ? sql`FOR UPDATE OF p` : sql``}`);
  if (!p) throw notFound();
  if (permission !== 'projects.project.view') {
    const ok = await one(tx, sql`SELECT 1 FROM projects_projects p WHERE p.id = ${id} AND ${visible(ctx, permission)}`);
    if (!ok) throw forbidden('اجازه این کار را در این پروژه ندارید');
  }
  return p;
}

async function validateUsers(ctx: ModuleRequestContext, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (!wanted.length) return;
  const found = await ctx.directory(wanted);
  if (found.length !== wanted.length) throw invalid('UNKNOWN_USER', 'کاربر انتخاب‌شده عضو فعال سازمان نیست');
}

const audit = (ctx: ModuleRequestContext, tx: Db, action: string, entityId: string, after?: unknown) => ctx.audit({ action: `projects.${action}`, entityType: 'project', entityId, after }, tx);

// ---------------------------------------------------------------- schedule

interface ActivityRow {
  id: string;
  parent_id: string | null;
  sort: number;
  name: string;
  duration_days: number;
  weight: string;
  assignee_id: string | null;
  progress: string;
  actual_start: string | null;
  actual_finish: string | null;
  es: number | null;
  ef: number | null;
  ls: number | null;
  lf: number | null;
  total_float: number | null;
  critical: boolean;
  planned_start: string | null;
  planned_finish: string | null;
}

const activitiesOf = (tx: Db, projectId: string) =>
  rows<ActivityRow>(tx, sql`SELECT id, parent_id, sort, name, duration_days, weight::text, assignee_id, progress::text, actual_start::text, actual_finish::text,
    es, ef, ls, lf, total_float, critical, planned_start::text, planned_finish::text FROM projects_activities WHERE project_id = ${projectId} AND deleted_at IS NULL ORDER BY sort, created_at`);

const depsOf = (tx: Db, projectId: string) =>
  rows<{ id: string; predecessor_id: string; successor_id: string; type: DepType; lag_days: number }>(tx, sql`SELECT d.id, d.predecessor_id, d.successor_id, d.type, d.lag_days FROM projects_dependencies d
    JOIN projects_activities a ON a.id = d.predecessor_id AND a.deleted_at IS NULL JOIN projects_activities b ON b.id = d.successor_id AND b.deleted_at IS NULL WHERE d.project_id = ${projectId}`);

/** Leaf activities are scheduled by CPM; summary (parent) activities span their children. */
function leaves(acts: ActivityRow[]): ActivityRow[] {
  const parents = new Set(acts.map((a) => a.parent_id).filter(Boolean));
  return acts.filter((a) => !parents.has(a.id));
}

/** Recomputes CPM for the project and stores results and planned dates. Throws 400 on a dependency cycle. */
async function reschedule(tx: Db, p: { id: string; planned_start: string | null }, cal: WorkCalendar) {
  const acts = await activitiesOf(tx, p.id);
  const deps = await depsOf(tx, p.id);
  const leafs = leaves(acts);
  let r: ReturnType<typeof computeCpm>;
  try {
    r = computeCpm(
      leafs.map((a) => ({ id: a.id, duration: a.duration_days })),
      deps.map((d) => ({ predecessorId: d.predecessor_id, successorId: d.successor_id, type: d.type, lag: d.lag_days })),
    );
  } catch (err) {
    if (err instanceof CycleError) {
      const names = acts.filter((a) => err.ids.includes(a.id)).map((a) => a.name);
      throw invalid('DEPENDENCY_CYCLE', `وابستگی‌ها حلقه ایجاد می‌کنند: ${names.join('، ')}`);
    }
    throw err;
  }
  const dateAt = (offset: number) => (p.planned_start ? workingDayAt(p.planned_start, offset, cal) : null);
  const result = new Map<string, { es: number; ef: number; ls: number; lf: number; total_float: number; critical: boolean }>();
  for (const a of leafs) {
    const x = r.results.get(a.id)!;
    result.set(a.id, { es: x.es, ef: x.ef, ls: x.ls, lf: x.lf, total_float: x.totalFloat, critical: x.critical });
  }
  // Summaries bottom-up: span of children; critical when any child is.
  const children = new Map<string, string[]>();
  for (const a of acts) if (a.parent_id) children.set(a.parent_id, [...(children.get(a.parent_id) ?? []), a.id]);
  const resolve = (id: string): ReturnType<typeof result.get> => {
    if (result.has(id)) return result.get(id);
    const ch = (children.get(id) ?? []).map(resolve).filter((x): x is NonNullable<typeof x> => !!x);
    if (!ch.length) return undefined;
    const v = {
      es: Math.min(...ch.map((c) => c.es)),
      ef: Math.max(...ch.map((c) => c.ef)),
      ls: Math.min(...ch.map((c) => c.ls)),
      lf: Math.max(...ch.map((c) => c.lf)),
      total_float: Math.min(...ch.map((c) => c.total_float)),
      critical: ch.some((c) => c.critical),
    };
    result.set(id, v);
    return v;
  };
  for (const a of acts) {
    const v = resolve(a.id);
    if (!v) continue;
    const start = dateAt(v.es);
    const finish = dateAt(Math.max(v.es, v.ef - 1));
    await tx.execute(sql`UPDATE projects_activities SET es = ${v.es}, ef = ${v.ef}, ls = ${v.ls}, lf = ${v.lf}, total_float = ${v.total_float}, critical = ${v.critical},
      planned_start = ${start}, planned_finish = ${finish} WHERE id = ${a.id}`);
  }
  await tx.execute(sql`UPDATE projects_projects SET schedule_error = NULL, schedule_calendar = ${fingerprint(cal)} WHERE id = ${p.id}`);
  return r.projectDuration;
}

/** Planned/actual physical, time and financial progress of one project at `today`. */
async function progressOf(tx: Db, ctx: { services: ModuleRequestContext['services'] }, p: ProjectRow, today: string, cal: WorkCalendar) {
  const acts = await activitiesOf(tx, p.id);
  const leafs = leaves(acts);
  const weight = (a: ActivityRow) => Number(a.weight);
  const day = p.planned_start ? workIndex(p.planned_start, today, cal) : null;
  const calDay = p.planned_start ? daysBetween(p.planned_start, today) : null;
  const planned = day === null || !leafs.length ? null : plannedPercent(leafs.map((a) => ({ es: a.es ?? 0, duration: a.duration_days, weight: weight(a) })), day);
  const actual = leafs.length ? actualPercent(leafs.map((a) => ({ percent: Number(a.progress), weight: weight(a) }))) : null;
  const span = p.planned_start && p.planned_finish ? daysBetween(p.planned_start, p.planned_finish) + 1 : null;
  const time = span && calDay !== null ? Math.min(100, Math.max(0, ((calDay + 1) / span) * 100)) : null;
  let financial: number | null = null;
  const contracts = ctx.services.get<{ byProject(id: string): Promise<{ direction: string; status: string; current_amount: string; approved_gross: string }[]> }>('contracts.contracts', '^1');
  if (contracts) {
    const cs = (await contracts.byProject(p.id)).filter((c) => c.direction === 'income' && c.status !== 'draft');
    const total = cs.reduce((s, c) => s + Number(c.current_amount), 0);
    if (total > 0) financial = (cs.reduce((s, c) => s + Number(c.approved_gross), 0) / total) * 100;
  }
  return { planned, actual, time, financial };
}

/** Inserts a project with its manager as a member (shared by create and the spreadsheet import). */
export async function insertProject(ctx: ModuleRequestContext, tx: Db, id: string, input: z.infer<typeof projectInput>, manager: string) {
  await tx.execute(sql`INSERT INTO projects_projects (id, tenant_id, company_id, code, title, project_type, employer_name, crm_account_id, contracts_contract_id, manager_id, province, city, location,
      specs, description, planned_start, planned_finish, budget_amount, status, created_by)
    VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.code}, ${input.title}, ${input.projectType}, ${input.employerName}, ${input.crmAccountId}, ${input.contractId}, ${manager},
      ${input.province}, ${input.city}, ${input.location}, ${input.specs}, ${input.description}, ${input.plannedStart}, ${input.plannedFinish}, ${input.budgetAmount}, ${input.status}, ${ctx.userId})`);
  await tx.execute(sql`INSERT INTO projects_members (id, tenant_id, company_id, project_id, user_id, role) VALUES (${randomUUID()}, ${ctx.tenantId}, ${ctx.companyId}, ${id}, ${manager}, 'manager')`);
  await audit(ctx, tx, 'project.created', id, { code: input.code });
  await ctx.publish('projects.project.created', { projectId: id, code: input.code, title: input.title }, tx);
}

export const Projects = {
  async list(ctx: ModuleRequestContext, f: z.infer<typeof listQuery>, today: string) {
    const cal = await calendarOf(ctx);
    const q = f.q ? `%${f.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null;
    const s = await ctx.settings<{ delayThreshold: number }>();
    return ctx.db.transaction(async (tx) => {
      const ps = await rows<ProjectRow>(tx, sql`SELECT ${PROJECT_COLUMNS} FROM projects_projects p WHERE p.deleted_at IS NULL AND ${visible(ctx, 'projects.project.view')}
        ${f.status ? sql`AND p.status = ${f.status}` : sql``} ${q ? sql`AND (p.code ILIKE ${q} OR p.title ILIKE ${q} OR p.employer_name ILIKE ${q})` : sql``}
        ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'planning' THEN 1 WHEN 'on_hold' THEN 2 ELSE 3 END, p.created_at DESC LIMIT 300`);
      const out = [];
      for (const p of ps) {
        await ensureSchedule(tx, p, cal);
        const pr = await progressOf(tx, ctx, p, today, cal);
        out.push({ ...p, progress: pr, delayed: p.status === 'active' && pr.planned !== null && pr.actual !== null && pr.planned - pr.actual > s.delayThreshold });
      }
      return out;
    });
  },

  async get(ctx: ModuleRequestContext, id: string, today: string) {
    const cal = await calendarOf(ctx);
    return ctx.db.transaction(async (tx) => {
      const p = await load(tx, ctx, id, 'projects.project.view');
      await ensureSchedule(tx, p, cal);
      const [members, activities, dependencies, phases, issues, risks, reports, changes] = await Promise.all([
        rows(tx, sql`SELECT id, user_id, role FROM projects_members WHERE project_id = ${id} ORDER BY created_at`),
        activitiesOf(tx, id),
        depsOf(tx, id),
        rows(tx, sql`SELECT id, kind, name, planned_date::text, delivered_on::text, client_approved_on::text, notes FROM projects_phases WHERE project_id = ${id} AND deleted_at IS NULL ORDER BY sort, planned_date NULLS LAST`),
        rows(tx, sql`SELECT id, kind, title, description, cause, impact_days, owner_id, due_on::text, status, resolved_on::text, created_at FROM projects_issues WHERE project_id = ${id} AND deleted_at IS NULL ORDER BY status, created_at DESC`),
        rows(tx, sql`SELECT id, title, probability, impact, probability * impact AS score, response, owner_id, status FROM projects_risks WHERE project_id = ${id} AND deleted_at IS NULL ORDER BY status, probability * impact DESC`),
        rows(tx, sql`SELECT id, report_date::text, weather, workforce, equipment, work_done, problems, created_by FROM projects_daily_reports WHERE project_id = ${id} AND deleted_at IS NULL ORDER BY report_date DESC LIMIT 60`),
        rows(tx, sql`SELECT id, number, title, description, cost_impact::text, time_impact_days, status, created_by, created_at, decided_at FROM projects_change_requests WHERE project_id = ${id} AND deleted_at IS NULL ORDER BY number DESC`),
      ]);
      const progress = await progressOf(tx, ctx, p, today, cal);
      const leafIds = new Set(leaves(activities).map((a) => a.id));
      const finishDay = Math.max(0, ...activities.map((a) => a.ef ?? 0));
      return {
        project: p,
        progress,
        computedFinish: p.planned_start && activities.length ? workingDayAt(p.planned_start, Math.max(0, finishDay - 1), cal) : null,
        members,
        activities: activities.map((a) => ({ ...a, leaf: leafIds.has(a.id) })),
        dependencies,
        phases,
        issues,
        risks,
        reports,
        changes,
        can: {
          update: await allowed(tx, ctx, id, 'projects.project.update'),
          schedule: await allowed(tx, ctx, id, 'projects.schedule.edit'),
          progress: await allowed(tx, ctx, id, 'projects.progress.record'),
          change: await allowed(tx, ctx, id, 'projects.change.create'),
        },
      };
    });
  },

  async create(ctx: ModuleRequestContext, input: z.infer<typeof projectInput>) {
    await validateUsers(ctx, [input.managerId]);
    const id = randomUUID();
    const manager = input.managerId ?? ctx.userId;
    await ctx.db.transaction(async (tx) => {
      if (await one(tx, sql`SELECT 1 FROM projects_projects WHERE company_id = ${ctx.companyId} AND code = ${input.code} AND deleted_at IS NULL`)) throw conflict('DUPLICATE_CODE', 'پروژه‌ای با این کد در این شرکت ثبت شده است');
      await insertProject(ctx, tx, id, input, manager);
    });
    return { id };
  },

  async update(ctx: ModuleRequestContext, id: string, version: number, input: z.infer<typeof projectInput>) {
    const cal = await calendarOf(ctx);
    await validateUsers(ctx, [input.managerId]);
    await ctx.db.transaction(async (tx) => {
      const p = await load(tx, ctx, id, 'projects.project.update', true);
      if (p.version !== version) throw conflict('STALE', 'این پروژه هم‌زمان توسط کاربر دیگری تغییر کرده است؛ صفحه را تازه کنید');
      if (input.code !== p.code && (await one(tx, sql`SELECT 1 FROM projects_projects WHERE company_id = ${p.company_id} AND code = ${input.code} AND deleted_at IS NULL AND id <> ${id}`))) {
        throw conflict('DUPLICATE_CODE', 'پروژه‌ای با این کد در این شرکت ثبت شده است');
      }
      const actualStart = input.status === 'active' && !p.actual_start ? sql`coalesce(actual_start, now()::date)` : sql`actual_start`;
      const actualFinish = input.status === 'completed' ? sql`coalesce(actual_finish, now()::date)` : sql`actual_finish`;
      await tx.execute(sql`UPDATE projects_projects SET code = ${input.code}, title = ${input.title}, project_type = ${input.projectType}, employer_name = ${input.employerName},
          crm_account_id = ${input.crmAccountId}, contracts_contract_id = ${input.contractId}, manager_id = ${input.managerId ?? p.manager_id}, province = ${input.province}, city = ${input.city},
          location = ${input.location}, specs = ${input.specs}, description = ${input.description}, planned_start = ${input.plannedStart}, planned_finish = ${input.plannedFinish},
          budget_amount = ${input.budgetAmount}, status = ${input.status}, actual_start = ${actualStart}, actual_finish = ${actualFinish},
          updated_at = now(), updated_by = ${ctx.userId}, version = version + 1 WHERE id = ${id}`);
      if (input.managerId && input.managerId !== p.manager_id) {
        await tx.execute(sql`INSERT INTO projects_members (id, tenant_id, company_id, project_id, user_id, role) VALUES (${randomUUID()}, ${ctx.tenantId}, ${p.company_id}, ${id}, ${input.managerId}, 'manager')
          ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'manager'`);
      }
      if (input.plannedStart !== p.planned_start) await reschedule(tx, { id, planned_start: input.plannedStart }, cal);
      await audit(ctx, tx, 'project.updated', id, { status: input.status });
    });
  },

  async remove(ctx: ModuleRequestContext, id: string) {
    await ctx.db.transaction(async (tx) => {
      await load(tx, ctx, id, 'projects.project.delete', true);
      if (await one(tx, sql`SELECT 1 FROM projects_progress_entries WHERE project_id = ${id} LIMIT 1`)) throw conflict('HAS_PROGRESS', 'برای این پروژه پیشرفت ثبت شده است؛ به‌جای حذف، وضعیت آن را «لغوشده» کنید');
      await tx.execute(sql`UPDATE projects_projects SET deleted_at = now(), updated_by = ${ctx.userId} WHERE id = ${id}`);
      await audit(ctx, tx, 'project.deleted', id);
    });
  },

  // ------------------------------------------------------------- team

  async addMember(ctx: ModuleRequestContext, id: string, input: z.infer<typeof memberInput>) {
    await validateUsers(ctx, [input.userId]);
    await ctx.db.transaction(async (tx) => {
      const p = await load(tx, ctx, id, 'projects.project.update');
      await tx.execute(sql`INSERT INTO projects_members (id, tenant_id, company_id, project_id, user_id, role) VALUES (${randomUUID()}, ${ctx.tenantId}, ${p.company_id}, ${id}, ${input.userId}, ${input.role})
        ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`);
      await audit(ctx, tx, 'member.added', id, input);
    });
  },

  async removeMember(ctx: ModuleRequestContext, id: string, userId: string) {
    await ctx.db.transaction(async (tx) => {
      const p = await load(tx, ctx, id, 'projects.project.update');
      if (p.manager_id === userId) throw conflict('IS_MANAGER', 'مدیر پروژه را نمی‌توان از تیم حذف کرد؛ ابتدا مدیر دیگری تعیین کنید');
      await tx.execute(sql`DELETE FROM projects_members WHERE project_id = ${id} AND user_id = ${userId}`);
      await audit(ctx, tx, 'member.removed', id, { userId });
    });
  },

  // ------------------------------------------------------------- schedule

  async addActivity(ctx: ModuleRequestContext, id: string, input: z.infer<typeof activityInput>) {
    const cal = await calendarOf(ctx);
    await validateUsers(ctx, [input.assigneeId]);
    return ctx.db.transaction(async (tx) => {
      const p = await load(tx, ctx, id, 'projects.schedule.edit', true);
      if (input.parentId) {
        const parent = await one(tx, sql`SELECT id FROM projects_activities WHERE id = ${input.parentId} AND project_id = ${id} AND deleted_at IS NULL`);
        if (!parent) throw notFound('فعالیت والد');
        if (await one(tx, sql`SELECT 1 FROM projects_dependencies WHERE predecessor_id = ${input.parentId} OR successor_id = ${input.parentId} LIMIT 1`)) {
          throw conflict('PARENT_HAS_DEPENDENCIES', 'فعالیتی که وابستگی دارد نمی‌تواند زیرفعالیت داشته باشد؛ ابتدا وابستگی‌های آن را حذف کنید');
        }
        if (await one(tx, sql`SELECT 1 FROM projects_progress_entries WHERE activity_id = ${input.parentId} LIMIT 1`)) {
          throw conflict('PARENT_HAS_PROGRESS', 'برای این فعالیت پیشرفت ثبت شده و نمی‌تواند زیرفعالیت داشته باشد');
        }
      }
      const aid = randomUUID();
      await tx.execute(sql`INSERT INTO projects_activities (id, tenant_id, company_id, project_id, parent_id, sort, name, duration_days, weight, assignee_id, created_by)
        VALUES (${aid}, ${ctx.tenantId}, ${p.company_id}, ${id}, ${input.parentId}, ${input.sort ?? sql`(SELECT coalesce(max(sort), 0) + 1 FROM projects_activities WHERE project_id = ${id})`},
          ${input.name}, ${input.durationDays}, ${input.weight}, ${input.assigneeId}, ${ctx.userId})`);
      await reschedule(tx, p, cal);
      return { id: aid };
    });
  },

  async updateActivity(ctx: ModuleRequestContext, id: string, aid: string, input: z.infer<typeof activityInput>) {
    const cal = await calendarOf(ctx);
    await validateUsers(ctx, [input.assigneeId]);
    await ctx.db.transaction(async (tx) => {
      const p = await load(tx, ctx, id, 'projects.schedule.edit', true);
      const a = await one<{ parent_id: string | null }>(tx, sql`SELECT parent_id FROM projects_activities WHERE id = ${aid} AND project_id = ${id} AND deleted_at IS NULL`);
      if (!a) throw notFound('فعالیت');
      if (input.parentId !== a.parent_id) throw invalid('PARENT_FIXED', 'جابه‌جایی فعالیت در ساختار شکست کار هنوز پشتیبانی نمی‌شود');
      await tx.execute(sql`UPDATE projects_activities SET name = ${input.name}, duration_days = ${input.durationDays}, weight = ${input.weight}, assignee_id = ${input.assigneeId},
        sort = coalesce(${input.sort ?? null}, sort), updated_at = now() WHERE id = ${aid}`);
      await reschedule(tx, p, cal);
    });
  },

  async removeActivity(ctx: ModuleRequestContext, id: string, aid: string) {
    const cal = await calendarOf(ctx);
    await ctx.db.transaction(async (tx) => {
      const p = await load(tx, ctx, id, 'projects.schedule.edit', true);
      if (await one(tx, sql`SELECT 1 FROM projects_activities WHERE parent_id = ${aid} AND deleted_at IS NULL LIMIT 1`)) throw conflict('HAS_CHILDREN', 'ابتدا زیرفعالیت‌ها را حذف کنید');
      if (await one(tx, sql`SELECT 1 FROM projects_progress_entries WHERE activity_id = ${aid} LIMIT 1`)) throw conflict('HAS_PROGRESS', 'برای این فعالیت پیشرفت ثبت شده و قابل حذف نیست');
      const r = await rows(tx, sql`UPDATE projects_activities SET deleted_at = now() WHERE id = ${aid} AND project_id = ${id} AND deleted_at IS NULL RETURNING id`);
      if (!r.length) throw notFound('فعالیت');
      await tx.execute(sql`DELETE FROM projects_dependencies WHERE predecessor_id = ${aid} OR successor_id = ${aid}`);
      await reschedule(tx, p, cal);
    });
  },

  async addDependency(ctx: ModuleRequestContext, id: string, input: z.infer<typeof dependencyInput>) {
    const cal = await calendarOf(ctx);
    if (input.predecessorId === input.successorId) throw invalid('SELF_DEPENDENCY', 'فعالیت نمی‌تواند پیش‌نیاز خودش باشد');
    return ctx.db.transaction(async (tx) => {
      const p = await load(tx, ctx, id, 'projects.schedule.edit', true);
      const acts = await activitiesOf(tx, id);
      const leafIds = new Set(leaves(acts).map((a) => a.id));
      for (const x of [input.predecessorId, input.successorId]) {
        if (!acts.some((a) => a.id === x)) throw notFound('فعالیت');
        if (!leafIds.has(x)) throw invalid('SUMMARY_DEPENDENCY', 'وابستگی فقط بین فعالیت‌های جزء (بدون زیرفعالیت) تعریف می‌شود');
      }
      if (await one(tx, sql`SELECT 1 FROM projects_dependencies WHERE predecessor_id = ${input.predecessorId} AND successor_id = ${input.successorId}`)) throw conflict('DUPLICATE', 'این وابستگی قبلاً ثبت شده است');
      const did = randomUUID();
      await tx.execute(sql`INSERT INTO projects_dependencies (id, tenant_id, company_id, project_id, predecessor_id, successor_id, type, lag_days)
        VALUES (${did}, ${ctx.tenantId}, ${p.company_id}, ${id}, ${input.predecessorId}, ${input.successorId}, ${input.type}, ${input.lagDays})`);
      await reschedule(tx, p, cal); // throws on a cycle → the insert is rolled back
      return { id: did };
    });
  },

  async removeDependency(ctx: ModuleRequestContext, id: string, did: string) {
    const cal = await calendarOf(ctx);
    await ctx.db.transaction(async (tx) => {
      const p = await load(tx, ctx, id, 'projects.schedule.edit', true);
      const r = await rows(tx, sql`DELETE FROM projects_dependencies WHERE id = ${did} AND project_id = ${id} RETURNING id`);
      if (!r.length) throw notFound('وابستگی');
      await reschedule(tx, p, cal);
    });
  },

  async recordProgress(ctx: ModuleRequestContext, id: string, aid: string, input: z.infer<typeof progressInput>) {
    await ctx.db.transaction(async (tx) => {
      const p = await load(tx, ctx, id, 'projects.progress.record');
      const acts = await activitiesOf(tx, id);
      if (!acts.some((a) => a.id === aid)) throw notFound('فعالیت');
      if (!leaves(acts).some((a) => a.id === aid)) throw invalid('SUMMARY_PROGRESS', 'پیشرفت فعالیت‌های خلاصه از زیرفعالیت‌ها محاسبه می‌شود');
      await tx.execute(sql`INSERT INTO projects_progress_entries (id, tenant_id, company_id, project_id, activity_id, entry_date, percent, note, created_by)
        VALUES (${randomUUID()}, ${ctx.tenantId}, ${p.company_id}, ${id}, ${aid}, ${input.date}, ${input.percent}, ${input.note}, ${ctx.userId})`);
      // The activity's current percent is its latest entry by date (then by entry time).
      await tx.execute(sql`UPDATE projects_activities a SET
          progress = (SELECT percent FROM projects_progress_entries e WHERE e.activity_id = a.id ORDER BY entry_date DESC, created_at DESC LIMIT 1),
          actual_start = (SELECT min(entry_date) FROM projects_progress_entries e WHERE e.activity_id = a.id AND percent > 0),
          actual_finish = (SELECT min(entry_date) FROM projects_progress_entries e WHERE e.activity_id = a.id AND percent >= 100),
          updated_at = now()
        WHERE a.id = ${aid}`);
      await tx.execute(sql`UPDATE projects_projects SET actual_start = coalesce(actual_start, ${input.date}::date) WHERE id = ${id} AND ${input.percent} > 0`);
    });
  },

  async progressHistory(ctx: ModuleRequestContext, id: string, aid: string) {
    return ctx.db.transaction(async (tx) => {
      await load(tx, ctx, id, 'projects.project.view');
      return rows(tx, sql`SELECT id, entry_date::text, percent::text, note, created_by, created_at FROM projects_progress_entries WHERE activity_id = ${aid} AND project_id = ${id} ORDER BY entry_date DESC, created_at DESC`);
    });
  },

  /** S-curve: planned vs actual weighted physical progress at evenly spaced dates. */
  async curve(ctx: ModuleRequestContext, id: string, today: string) {
    const cal = await calendarOf(ctx);
    return ctx.db.transaction(async (tx) => {
      const p = await load(tx, ctx, id, 'projects.project.view');
      if (!p.planned_start) return { points: [], reason: 'NO_START' };
      const acts = leaves(await activitiesOf(tx, id));
      if (!acts.length) return { points: [], reason: 'NO_ACTIVITIES' };
      const entries = await rows<{ activity_id: string; entry_date: string; percent: string }>(tx, sql`SELECT activity_id, entry_date::text, percent::text FROM projects_progress_entries WHERE project_id = ${id} ORDER BY entry_date, created_at`);
      const finishDay = Math.max(1, ...acts.map((a) => a.ef ?? 0));
      const lastDay = Math.max(finishDay - 1, workIndex(p.planned_start, today, cal));
      const steps = Math.min(24, Math.max(2, lastDay + 1));
      const points = [];
      const todayDay = workIndex(p.planned_start, today, cal);
      const days = [...new Set([...Array.from({ length: steps }, (_, i) => Math.round((lastDay * i) / (steps - 1))), ...(todayDay >= 0 && todayDay <= lastDay ? [todayDay] : [])])].sort((x, y) => x - y);
      for (const day of days) {
        const date = workingDayAt(p.planned_start, day, cal);
        const planned = plannedPercent(acts.map((a) => ({ es: a.es ?? 0, duration: a.duration_days, weight: Number(a.weight) })), day);
        const latest = new Map<string, number>();
        for (const e of entries) if (e.entry_date <= date) latest.set(e.activity_id, Number(e.percent));
        const actual = date <= today ? actualPercent(acts.map((a) => ({ percent: latest.get(a.id) ?? 0, weight: Number(a.weight) }))) : null;
        points.push({ date, planned, actual });
      }
      return { points };
    });
  },

  // ------------------------------------------------------------- phases, issues, risks, reports

  async addPhase(ctx: ModuleRequestContext, id: string, input: z.infer<typeof phaseInput>) {
    return ctx.db.transaction(async (tx) => {
      const p = await load(tx, ctx, id, 'projects.project.update');
      const pid = randomUUID();
      await tx.execute(sql`INSERT INTO projects_phases (id, tenant_id, company_id, project_id, kind, name, planned_date, notes, sort, created_by)
        VALUES (${pid}, ${ctx.tenantId}, ${p.company_id}, ${id}, ${input.kind}, ${input.name}, ${input.plannedDate}, ${input.notes}, (SELECT coalesce(max(sort), 0) + 1 FROM projects_phases WHERE project_id = ${id}), ${ctx.userId})`);
      return { id: pid };
    });
  },

  async setPhaseStatus(ctx: ModuleRequestContext, id: string, phaseId: string, input: z.infer<typeof phaseStatusInput>) {
    await ctx.db.transaction(async (tx) => {
      await load(tx, ctx, id, 'projects.project.update');
      const r = await rows(tx, sql`UPDATE projects_phases SET delivered_on = ${input.deliveredOn}, client_approved_on = ${input.clientApprovedOn} WHERE id = ${phaseId} AND project_id = ${id} AND deleted_at IS NULL RETURNING kind, name`);
      if (!r.length) throw notFound('مرحله');
      await audit(ctx, tx, 'phase.status', id, { phaseId, ...input });
    });
  },

  async addIssue(ctx: ModuleRequestContext, id: string, input: z.infer<typeof issueInput>) {
    await validateUsers(ctx, [input.ownerId]);
    return ctx.db.transaction(async (tx) => {
      const p = await load(tx, ctx, id, 'projects.progress.record');
      const iid = randomUUID();
      await tx.execute(sql`INSERT INTO projects_issues (id, tenant_id, company_id, project_id, kind, title, description, cause, impact_days, owner_id, due_on, created_by)
        VALUES (${iid}, ${ctx.tenantId}, ${p.company_id}, ${id}, ${input.kind}, ${input.title}, ${input.description}, ${input.cause}, ${input.impactDays}, ${input.ownerId}, ${input.dueOn}, ${ctx.userId})`);
      if (input.ownerId && input.ownerId !== ctx.userId) await ctx.notify({ userIds: [input.ownerId], type: 'projects.issue.assigned', title: `پیگیری «${input.title}» در پروژه ${p.code} به شما سپرده شد`, link: `/app/projects/${id}?tab=issues` });
      return { id: iid };
    });
  },

  async resolveIssue(ctx: ModuleRequestContext, id: string, iid: string, resolvedOn: string | null) {
    await ctx.db.transaction(async (tx) => {
      await load(tx, ctx, id, 'projects.progress.record');
      const r = await rows(tx, sql`UPDATE projects_issues SET status = ${resolvedOn ? 'resolved' : 'open'}, resolved_on = ${resolvedOn} WHERE id = ${iid} AND project_id = ${id} AND deleted_at IS NULL RETURNING id`);
      if (!r.length) throw notFound('مورد');
    });
  },

  async addRisk(ctx: ModuleRequestContext, id: string, input: z.infer<typeof riskInput>) {
    await validateUsers(ctx, [input.ownerId]);
    return ctx.db.transaction(async (tx) => {
      const p = await load(tx, ctx, id, 'projects.progress.record');
      const rid = randomUUID();
      await tx.execute(sql`INSERT INTO projects_risks (id, tenant_id, company_id, project_id, title, probability, impact, response, owner_id, created_by)
        VALUES (${rid}, ${ctx.tenantId}, ${p.company_id}, ${id}, ${input.title}, ${input.probability}, ${input.impact}, ${input.response}, ${input.ownerId}, ${ctx.userId})`);
      return { id: rid };
    });
  },

  async setRiskStatus(ctx: ModuleRequestContext, id: string, rid: string, status: 'open' | 'closed') {
    await ctx.db.transaction(async (tx) => {
      await load(tx, ctx, id, 'projects.progress.record');
      const r = await rows(tx, sql`UPDATE projects_risks SET status = ${status}, updated_at = now() WHERE id = ${rid} AND project_id = ${id} AND deleted_at IS NULL RETURNING id`);
      if (!r.length) throw notFound('ریسک');
    });
  },

  async addDailyReport(ctx: ModuleRequestContext, id: string, input: z.infer<typeof dailyReportInput>) {
    return ctx.db.transaction(async (tx) => {
      const p = await load(tx, ctx, id, 'projects.progress.record');
      if (await one(tx, sql`SELECT 1 FROM projects_daily_reports WHERE project_id = ${id} AND report_date = ${input.reportDate} AND deleted_at IS NULL`)) throw conflict('DUPLICATE_DAY', 'گزارش این روز قبلاً ثبت شده است');
      const rid = randomUUID();
      await tx.execute(sql`INSERT INTO projects_daily_reports (id, tenant_id, company_id, project_id, report_date, weather, workforce, equipment, work_done, problems, created_by)
        VALUES (${rid}, ${ctx.tenantId}, ${p.company_id}, ${id}, ${input.reportDate}, ${input.weather}, ${input.workforce}, ${input.equipment}, ${input.workDone}, ${input.problems}, ${ctx.userId})`);
      return { id: rid };
    });
  },

  // ------------------------------------------------------------- change requests

  async addChange(ctx: ModuleRequestContext, id: string, input: z.infer<typeof changeRequestInput>) {
    return ctx.db.transaction(async (tx) => {
      const p = await load(tx, ctx, id, 'projects.change.create', true);
      const n = await one<{ n: number }>(tx, sql`SELECT coalesce(max(number), 0)::int + 1 AS n FROM projects_change_requests WHERE project_id = ${id}`);
      const cid = randomUUID();
      await tx.execute(sql`INSERT INTO projects_change_requests (id, tenant_id, company_id, project_id, number, title, description, cost_impact, time_impact_days, created_by)
        VALUES (${cid}, ${ctx.tenantId}, ${p.company_id}, ${id}, ${n!.n}, ${input.title}, ${input.description}, ${input.costImpact}, ${input.timeImpactDays}, ${ctx.userId})`);
      return { id: cid, number: n!.n };
    });
  },

  async submitChange(ctx: ModuleRequestContext, id: string, cid: string) {
    return ctx.db.transaction(async (tx) => {
      const p = await load(tx, ctx, id, 'projects.change.create');
      const c = await one<{ number: number; title: string; status: string; cost_impact: string }>(tx, sql`SELECT number, title, status, cost_impact::text FROM projects_change_requests WHERE id = ${cid} AND project_id = ${id} AND deleted_at IS NULL FOR UPDATE`);
      if (!c) throw notFound('درخواست تغییر');
      if (c.status !== 'draft') throw conflict('NOT_DRAFT', 'این درخواست قبلاً ارسال شده است');
      const wf = await ctx.startWorkflow({ key: 'projects.change_request', entityType: 'change_request', entityId: cid, title: `درخواست تغییر ${c.number} پروژه ${p.code}: ${c.title}`, amount: Math.abs(Number(c.cost_impact)) }, tx);
      await tx.execute(sql`UPDATE projects_change_requests SET status = 'submitted', workflow_instance_id = ${wf.instanceId} WHERE id = ${cid}`);
      await audit(ctx, tx, 'change_request.submitted', id, { changeRequestId: cid });
      return { state: wf.state };
    });
  },

  // ------------------------------------------------------------- lookups for linking

  async lookup(ctx: ModuleRequestContext, kind: 'contracts' | 'accounts', q: string) {
    if (kind === 'accounts') {
      const svc = ctx.services.get<{ search(q: string, limit: number): Promise<{ id: string; title: string }[]> }>('crm.accounts', '^1');
      return svc ? svc.search(q, 20) : [];
    }
    const svc = ctx.services.get<{ search?(q: string, limit: number): Promise<{ id: string; code: string; title: string }[]> }>('contracts.contracts', '^1');
    return svc?.search ? svc.search(q, 20) : [];
  },

  async linked(ctx: ModuleRequestContext, p: ProjectRow) {
    const contracts = ctx.services.get<{ byProject(id: string): Promise<unknown[]> }>('contracts.contracts', '^1');
    const accounts = ctx.services.get<{ get(id: string): Promise<{ id: string; title: string } | null> }>('crm.accounts', '^1');
    return {
      contracts: contracts ? await contracts.byProject(p.id) : null,
      account: p.crm_account_id && accounts ? await accounts.get(p.crm_account_id) : null,
    };
  },
};

async function allowed(tx: Db, ctx: ModuleRequestContext, id: string, permission: string) {
  return !!(await one(tx, sql`SELECT 1 FROM projects_projects p WHERE p.id = ${id} AND ${visible(ctx, permission)}`));
}

// ---------------------------------------------------------------- tenant-wide: events, widgets, providers

export async function onWorkflowCompleted(ctx: ModuleEventContext, p: { moduleId: string; entityType: string; entityId: string; state: 'approved' | 'rejected' }) {
  if (p.moduleId !== 'projects' || p.entityType !== 'change_request') return;
  await ctx.db.transaction(async (tx) => {
    const c = await one<{ id: string; project_id: string; number: number; created_by: string; cost_impact: string; time_impact_days: number }>(
      tx,
      sql`UPDATE projects_change_requests SET status = ${p.state}, decided_at = now() WHERE id = ${p.entityId} AND status = 'submitted' RETURNING id, project_id, number, created_by, cost_impact::text, time_impact_days`,
    );
    if (!c) return;
    if (p.state === 'approved') await ctx.publish('projects.change_request.approved', { projectId: c.project_id, changeRequestId: c.id, costImpact: c.cost_impact, timeImpactDays: c.time_impact_days }, tx);
  });
}

export async function overview(ctx: ModuleRequestContext, today: string) {
  const list = await Projects.list(ctx, {}, today);
  const active = list.filter((p) => p.status === 'active');
  return {
    total: list.length,
    active: active.length,
    delayed: active.filter((p) => p.delayed).length,
    items: active
      .sort((a, b) => Number(b.delayed) - Number(a.delayed))
      .slice(0, 8)
      .map((p) => ({ id: p.id, code: p.code, title: p.title, planned: p.progress.planned, actual: p.progress.actual, delayed: p.delayed })),
  };
}

export async function openIssues(ctx: ModuleRequestContext) {
  return ctx.db.transaction(async (tx) => {
    const vis = visible(ctx, 'projects.project.view');
    const issues = await rows(tx, sql`SELECT i.id, i.kind, i.title, i.due_on::text, p.id AS project_id, p.code FROM projects_issues i JOIN projects_projects p ON p.id = i.project_id
      WHERE i.deleted_at IS NULL AND i.status = 'open' AND p.deleted_at IS NULL AND ${vis} ORDER BY i.due_on NULLS LAST, i.created_at LIMIT 8`);
    const counts = await one<{ issues: number; risks: number }>(tx, sql`SELECT
      (SELECT count(*)::int FROM projects_issues i JOIN projects_projects p ON p.id = i.project_id WHERE i.deleted_at IS NULL AND i.status = 'open' AND p.deleted_at IS NULL AND ${vis}) AS issues,
      (SELECT count(*)::int FROM projects_risks r JOIN projects_projects p ON p.id = r.project_id WHERE r.deleted_at IS NULL AND r.status = 'open' AND r.probability * r.impact >= 15 AND p.deleted_at IS NULL AND ${vis}) AS risks`);
    return { ...counts!, issues_list: issues };
  });
}

export async function search(ctx: ModuleRequestContext, q: string, limit: number) {
  const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const r = await ctx.db.transaction((tx) =>
    rows<{ id: string; code: string; title: string; employer_name: string }>(tx, sql`SELECT p.id, p.code, p.title, p.employer_name FROM projects_projects p
      WHERE p.deleted_at IS NULL AND ${visible(ctx, 'projects.project.view')} AND (p.code ILIKE ${like} OR p.title ILIKE ${like} OR p.employer_name ILIKE ${like}) LIMIT ${limit}`),
  );
  return r.map((x) => ({ entityType: 'project', entityId: x.id, title: `${x.code} — ${x.title}`, snippet: x.employer_name, link: `/app/projects/${x.id}` }));
}

/** Public service projects.projects@1 (used by contracts, crm, meetings). */
export function publicService(ctx: ModuleEventContext) {
  return {
    search: (q: string, limit: number) => {
      const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      return ctx.db.transaction((tx) =>
        rows<{ id: string; code: string; title: string }>(tx, sql`SELECT id, code, title FROM projects_projects WHERE deleted_at IS NULL AND (${q === ''} OR code ILIKE ${like} OR title ILIKE ${like})
          ORDER BY created_at DESC LIMIT ${Math.min(50, limit)}`),
      );
    },
    get: async (id: string) =>
      (await ctx.db.transaction((tx) => one<{ id: string; code: string; title: string; status: string }>(tx, sql`SELECT id, code, title, status FROM projects_projects WHERE id = ${id} AND deleted_at IS NULL`))) ?? null,
    /** Since 1.1: projects the user manages or belongs to (for "project" permission scope in other modules). */
    memberOf: (userId: string) =>
      ctx.db.transaction(async (tx) =>
        (await rows<{ id: string }>(tx, sql`SELECT p.id FROM projects_projects p WHERE p.deleted_at IS NULL
          AND (p.manager_id = ${userId} OR EXISTS (SELECT 1 FROM projects_members m WHERE m.project_id = p.id AND m.user_id = ${userId}))`)).map((r) => r.id),
      ),
    /** Since 1.1: planned and actual physical progress (percent) on working days, e.g. for earned value. */
    progress: async (id: string, today: string) => {
      const cal = await calendarOf(ctx);
      return ctx.db.transaction(async (tx) => {
        const p = await one<ProjectRow>(tx, sql`SELECT ${PROJECT_COLUMNS} FROM projects_projects p WHERE p.id = ${id} AND p.deleted_at IS NULL`);
        if (!p) return null;
        await ensureSchedule(tx, p, cal);
        const pr = await progressOf(tx, ctx, p, today, cal);
        return { planned: pr.planned, actual: pr.actual };
      });
    },
  };
}

export async function activeCount(ctx: ModuleEventContext, p: { companyId: string }) {
  const r = await ctx.db.transaction((tx) => one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM projects_projects WHERE deleted_at IS NULL AND status = 'active' AND company_id = ${p.companyId}`));
  return r!.n;
}

export async function delayedCount(ctx: ModuleEventContext, p: { companyId: string }, today: string) {
    const cal = await calendarOf(ctx);
  const s = await ctx.settings<{ delayThreshold: number }>();
  return ctx.db.transaction(async (tx) => {
    const ps = await rows<ProjectRow>(tx, sql`SELECT ${PROJECT_COLUMNS} FROM projects_projects p WHERE p.deleted_at IS NULL AND p.status = 'active' AND p.company_id = ${p.companyId}`);
    let n = 0;
    for (const x of ps) {
      const pr = await progressOf(tx, ctx, x, today, cal);
      if (pr.planned !== null && pr.actual !== null && pr.planned - pr.actual > s.delayThreshold) n++;
    }
    return n;
  });
}
