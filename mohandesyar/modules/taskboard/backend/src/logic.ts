import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, ModuleEventContext, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { addDays, isWorkingDay, zonedToUtc, type WorkCalendar } from '@mohandesyar/persian';
import { dueAt, dutyOccursOn, isTime, lateMinutes, percent, performance, scorePercent, type Components, type DutySchedule } from './calc.js';
import { conflict, forbidden, invalid, notFound } from './errors.js';
import type { attendanceInput, doneInput, dutyInput, rangeQuery, reportInput, reviewInput, scoreInput, taskInput, taskQuery } from './inputs.js';

type Row = Record<string, unknown>;
const rows = async <T = Row>(tx: Db, q: SQL) => (await tx.execute(q)).rows as T[];
const one = async <T = Row>(tx: Db, q: SQL) => (await rows<T>(tx, q))[0];
const TZ = 'Asia/Tehran';
const MANAGE = 'taskboard.manage';

async function calendarOf(ctx: { workCalendar(): Promise<{ weeklyOff: number[]; holidays: string[] }> }): Promise<WorkCalendar> {
  const c = await ctx.workCalendar();
  return { weeklyOff: c.weeklyOff, holidays: new Set(c.holidays) };
}

export interface Settings { workStart: string; workEnd: string; graceMinutes: number }
async function settingsOf(ctx: { settings<T extends Record<string, unknown>>(): Promise<T> }): Promise<Settings> {
  const s = await ctx.settings<Partial<Settings> & Record<string, unknown>>();
  return {
    workStart: isTime(s.workStart) ? s.workStart : '08:00',
    workEnd: isTime(s.workEnd) ? s.workEnd : '16:00',
    graceMinutes: typeof s.graceMinutes === 'number' && s.graceMinutes >= 0 ? s.graceMinutes : 10,
  };
}

const isManager = (ctx: ModuleRequestContext) => ctx.can(MANAGE, 'company');
function requireManager(ctx: ModuleRequestContext) {
  if (!isManager(ctx)) throw forbidden('این کار فقط برای مدیر یا سرپرست کارکنان مجاز است');
}

async function validateUsers(ctx: ModuleRequestContext, ids: string[]) {
  const wanted = [...new Set(ids)];
  if (wanted.length && (await ctx.directory(wanted)).length !== wanted.length) throw invalid('UNKNOWN_USER', 'یکی از افراد انتخاب‌شده عضو فعال سازمان نیست');
}

const dayStart = (day: string) => zonedToUtc(day, '00:00', TZ);
const TASK_COLS = sql`t.id, t.title, t.description, t.assignee_id, t.created_by, t.duty_id, t.occurrence_on::text, t.due_at, t.priority, t.status,
  t.done_at, t.done_note, t.reviewed_by, t.reviewed_at, t.score, t.review_note, t.created_at`;

interface TaskRow { id: string; assignee_id: string; status: string; title: string; created_by: string; company_id: string }

async function loadTask(tx: Db, id: string): Promise<TaskRow> {
  const t = await one<TaskRow>(tx, sql`SELECT id, assignee_id, status, title, created_by, company_id FROM taskboard_tasks WHERE id = ${id} FOR UPDATE`);
  if (!t) throw notFound('کار');
  return t;
}

export const Taskboard = {
  /** My day: attendance, today's tasks (plus overdue open ones), my report. */
  async today(ctx: ModuleRequestContext, today: string) {
    const s = await settingsOf(ctx);
    const cal = await calendarOf(ctx);
    return ctx.db.transaction(async (tx) => {
      const [attendance, tasks, report] = await Promise.all([
        one(tx, sql`SELECT id, day::text, check_in, check_out, late_minutes, note FROM taskboard_attendance WHERE company_id = ${ctx.companyId} AND user_id = ${ctx.userId} AND day = ${today}::date`),
        rows(tx, sql`SELECT ${TASK_COLS} FROM taskboard_tasks t WHERE t.company_id = ${ctx.companyId} AND t.assignee_id = ${ctx.userId} AND t.status <> 'cancelled'
          AND ((t.due_at >= ${dayStart(today)} AND t.due_at < ${dayStart(addDays(today, 1))}) OR (t.status IN ('todo', 'returned') AND t.due_at < ${dayStart(today)}))
          ORDER BY t.due_at`),
        one(tx, sql`SELECT id, day::text, body, hours::float8 AS hours, score, review_note, updated_at FROM taskboard_reports WHERE company_id = ${ctx.companyId} AND user_id = ${ctx.userId} AND day = ${today}::date`),
      ]);
      return { today, workingDay: isWorkingDay(today, cal), settings: s, attendance: attendance ?? null, tasks, report: report ?? null };
    });
  },

  async tasks(ctx: ModuleRequestContext, f: z.infer<typeof taskQuery>) {
    const team = f.scope === 'team';
    if (team) requireManager(ctx);
    const status =
      f.status === 'open' ? sql`AND t.status IN ('todo', 'returned')` : f.status === 'review' ? sql`AND t.status = 'done'` : f.status === 'closed' ? sql`AND t.status IN ('approved', 'cancelled')` : sql``;
    return ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT ${TASK_COLS} FROM taskboard_tasks t WHERE t.company_id = ${ctx.companyId}
        ${team ? (f.assigneeId ? sql`AND t.assignee_id = ${f.assigneeId}` : sql``) : sql`AND t.assignee_id = ${ctx.userId}`}
        ${status} ${f.from ? sql`AND t.due_at >= ${dayStart(f.from)}` : sql``} ${f.to ? sql`AND t.due_at < ${dayStart(addDays(f.to, 1))}` : sql``}
        ORDER BY t.due_at DESC LIMIT 500`),
    );
  },

  async createTasks(ctx: ModuleRequestContext, input: z.infer<typeof taskInput>) {
    requireManager(ctx);
    const ids = [...new Set(input.assigneeIds)];
    await validateUsers(ctx, ids);
    const due = dueAt(input.dueDate, input.dueTime, TZ);
    const created = await ctx.db.transaction(async (tx) => {
      const out: string[] = [];
      for (const assignee of ids) {
        const id = randomUUID();
        await tx.execute(sql`INSERT INTO taskboard_tasks (id, tenant_id, company_id, title, description, assignee_id, created_by, due_at, priority)
          VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.title}, ${input.description}, ${assignee}, ${ctx.userId}, ${due}, ${input.priority})`);
        out.push(id);
      }
      await ctx.audit({ action: 'taskboard.task.assigned', entityType: 'taskboard_task', entityId: out[0]!, after: { title: input.title, assignees: ids.length, dueAt: due } }, tx);
      return out;
    });
    const others = ids.filter((u) => u !== ctx.userId);
    if (others.length) await ctx.notify({ userIds: others, type: 'taskboard.task.assigned', title: `کار جدید: ${input.title}`, body: `مهلت: ${input.dueDate} ساعت ${input.dueTime}`, link: '/app/taskboard' });
    return { ids: created };
  },

  async done(ctx: ModuleRequestContext, id: string, input: z.infer<typeof doneInput>) {
    const t = await ctx.db.transaction(async (tx) => {
      const t = await loadTask(tx, id);
      if (t.assignee_id !== ctx.userId) throw forbidden('فقط مسئول همین کار می‌تواند آن را انجام‌شده علامت بزند');
      if (t.status !== 'todo' && t.status !== 'returned') throw conflict('TASK_STATE', 'این کار در وضعیتی نیست که بتوان آن را انجام‌شده زد');
      await tx.execute(sql`UPDATE taskboard_tasks SET status = 'done', done_at = now(), done_note = ${input.note} WHERE id = ${id}`);
      return t;
    });
    if (t.created_by !== ctx.userId) await ctx.notify({ userIds: [t.created_by], type: 'taskboard.task.done', title: `کار انجام شد: ${t.title}`, link: '/app/taskboard/team' });
    return { ok: true };
  },

  async undo(ctx: ModuleRequestContext, id: string) {
    await ctx.db.transaction(async (tx) => {
      const t = await loadTask(tx, id);
      if (t.assignee_id !== ctx.userId) throw forbidden('فقط مسئول همین کار می‌تواند علامت انجام را بردارد');
      if (t.status !== 'done') throw conflict('TASK_STATE', 'کار بازبینی‌شده را نمی‌توان برگرداند');
      await tx.execute(sql`UPDATE taskboard_tasks SET status = 'todo', done_at = NULL, done_note = '' WHERE id = ${id}`);
    });
    return { ok: true };
  },

  async review(ctx: ModuleRequestContext, id: string, input: z.infer<typeof reviewInput>) {
    requireManager(ctx);
    const t = await ctx.db.transaction(async (tx) => {
      const t = await loadTask(tx, id);
      if (t.assignee_id === ctx.userId) throw forbidden('بازبینی و نمره‌دهی کار خودتان مجاز نیست');
      if (t.status !== 'done') throw conflict('TASK_STATE', 'فقط کار انجام‌شده را می‌توان بازبینی کرد');
      if (input.decision === 'approve') {
        await tx.execute(sql`UPDATE taskboard_tasks SET status = 'approved', score = ${input.score}, review_note = ${input.note}, reviewed_by = ${ctx.userId}, reviewed_at = now() WHERE id = ${id}`);
      } else {
        await tx.execute(sql`UPDATE taskboard_tasks SET status = 'returned', score = NULL, review_note = ${input.note}, reviewed_by = ${ctx.userId}, reviewed_at = now() WHERE id = ${id}`);
      }
      await ctx.audit({ action: `taskboard.task.${input.decision}`, entityType: 'taskboard_task', entityId: id, after: { score: input.score } }, tx);
      return t;
    });
    await ctx.notify({
      userIds: [t.assignee_id],
      type: 'taskboard.task.reviewed',
      title: input.decision === 'approve' ? `کار «${t.title}» تأیید شد (نمره ${input.score} از ۵)` : `کار «${t.title}» برای اصلاح برگشت خورد`,
      body: input.note || undefined,
      link: '/app/taskboard',
    });
    return { ok: true };
  },

  async cancel(ctx: ModuleRequestContext, id: string) {
    requireManager(ctx);
    await ctx.db.transaction(async (tx) => {
      const t = await loadTask(tx, id);
      if (t.status === 'approved' || t.status === 'cancelled') throw conflict('TASK_STATE', 'این کار بسته شده است');
      await tx.execute(sql`UPDATE taskboard_tasks SET status = 'cancelled' WHERE id = ${id}`);
      await ctx.audit({ action: 'taskboard.task.cancelled', entityType: 'taskboard_task', entityId: id }, tx);
    });
    return { ok: true };
  },

  // -------------------------------------------------------------- duties

  async duties(ctx: ModuleRequestContext) {
    requireManager(ctx);
    return ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT id, title, description, assignee_id, recurrence, weekdays::int[] AS weekdays, month_day, due_time, priority, skip_days_off, active, created_at
        FROM taskboard_duties WHERE company_id = ${ctx.companyId} ORDER BY active DESC, due_time, title`),
    );
  },

  async saveDuty(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof dutyInput>, today: string) {
    requireManager(ctx);
    await validateUsers(ctx, [input.assigneeId]);
    const weekdays = input.recurrence === 'weekly' ? [...new Set(input.weekdays)].sort() : [];
    const monthDay = input.recurrence === 'monthly' ? input.monthDay : null;
    const wd = sql`${`{${weekdays.join(',')}}`}::smallint[]`;
    const dutyId = await ctx.db.transaction(async (tx) => {
      if (id) {
        const r = await tx.execute(sql`UPDATE taskboard_duties SET title = ${input.title}, description = ${input.description}, assignee_id = ${input.assigneeId}, recurrence = ${input.recurrence},
          weekdays = ${wd}, month_day = ${monthDay}, due_time = ${input.dueTime}, priority = ${input.priority}, skip_days_off = ${input.skipDaysOff}
          WHERE id = ${id} AND company_id = ${ctx.companyId} RETURNING id`);
        if (!r.rows.length) throw notFound('وظیفه');
        await ctx.audit({ action: 'taskboard.duty.updated', entityType: 'taskboard_duty', entityId: id, after: { title: input.title } }, tx);
        return id;
      }
      const nid = randomUUID();
      await tx.execute(sql`INSERT INTO taskboard_duties (id, tenant_id, company_id, title, description, assignee_id, recurrence, weekdays, month_day, due_time, priority, skip_days_off, created_by)
        VALUES (${nid}, ${ctx.tenantId}, ${ctx.companyId}, ${input.title}, ${input.description}, ${input.assigneeId}, ${input.recurrence}, ${wd}, ${monthDay}, ${input.dueTime}, ${input.priority}, ${input.skipDaysOff}, ${ctx.userId})`);
      await ctx.audit({ action: 'taskboard.duty.created', entityType: 'taskboard_duty', entityId: nid, after: { title: input.title } }, tx);
      return nid;
    });
    // today's occurrence appears at once instead of waiting for the next scheduler run
    await generateDuties(ctx, today, dutyId);
    return { id: dutyId };
  },

  async setDutyActive(ctx: ModuleRequestContext, id: string, active: boolean) {
    requireManager(ctx);
    await ctx.db.transaction(async (tx) => {
      const r = await tx.execute(sql`UPDATE taskboard_duties SET active = ${active} WHERE id = ${id} AND company_id = ${ctx.companyId} RETURNING id`);
      if (!r.rows.length) throw notFound('وظیفه');
      await ctx.audit({ action: active ? 'taskboard.duty.activated' : 'taskboard.duty.deactivated', entityType: 'taskboard_duty', entityId: id }, tx);
    });
    return { ok: true };
  },

  // -------------------------------------------------------------- attendance

  async checkIn(ctx: ModuleRequestContext, input: z.infer<typeof attendanceInput>, today: string, now = new Date()) {
    const s = await settingsOf(ctx);
    const at = now.toISOString();
    const late = lateMinutes(at, s.workStart, s.graceMinutes, TZ);
    return ctx.db.transaction(async (tx) => {
      const r = await tx.execute(sql`INSERT INTO taskboard_attendance (id, tenant_id, company_id, user_id, day, check_in, late_minutes, note)
        VALUES (${randomUUID()}, ${ctx.tenantId}, ${ctx.companyId}, ${ctx.userId}, ${today}::date, ${at}, ${late}, ${input.note}) ON CONFLICT (company_id, user_id, day) DO NOTHING RETURNING id`);
      if (!r.rows.length) throw conflict('ALREADY_CHECKED_IN', 'ورود امروز قبلاً ثبت شده است');
      return { checkIn: at, lateMinutes: late };
    });
  },

  async checkOut(ctx: ModuleRequestContext, today: string, now = new Date()) {
    return ctx.db.transaction(async (tx) => {
      const a = await one<{ id: string; check_in: string; check_out: string | null }>(tx, sql`SELECT id, check_in, check_out FROM taskboard_attendance
        WHERE company_id = ${ctx.companyId} AND user_id = ${ctx.userId} AND day = ${today}::date FOR UPDATE`);
      if (!a) throw conflict('NOT_CHECKED_IN', 'هنوز ورود امروز را ثبت نکرده‌اید');
      if (a.check_out) throw conflict('ALREADY_CHECKED_OUT', 'خروج امروز قبلاً ثبت شده است');
      if (now.getTime() <= new Date(a.check_in).getTime()) throw conflict('CHECK_OUT_EARLY', 'زمان خروج باید بعد از ورود باشد');
      await tx.execute(sql`UPDATE taskboard_attendance SET check_out = ${now.toISOString()} WHERE id = ${a.id}`);
      return { checkOut: now.toISOString() };
    });
  },

  async attendance(ctx: ModuleRequestContext, r: z.infer<typeof rangeQuery>, userId: string | undefined) {
    const team = isManager(ctx);
    const who = team ? (userId ? sql`AND user_id = ${userId}` : sql``) : sql`AND user_id = ${ctx.userId}`;
    return ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT id, user_id, day::text, check_in, check_out, late_minutes, note FROM taskboard_attendance
        WHERE company_id = ${ctx.companyId} AND day BETWEEN ${r.from}::date AND ${r.to}::date ${who} ORDER BY day DESC, check_in LIMIT 2000`),
    );
  },

  // -------------------------------------------------------------- reports

  async saveReport(ctx: ModuleRequestContext, input: z.infer<typeof reportInput>, today: string) {
    return ctx.db.transaction(async (tx) => {
      const cur = await one<{ id: string; score: number | null }>(tx, sql`SELECT id, score FROM taskboard_reports WHERE company_id = ${ctx.companyId} AND user_id = ${ctx.userId} AND day = ${today}::date FOR UPDATE`);
      if (cur?.score != null) throw conflict('REPORT_SCORED', 'گزارش امروز نمره گرفته و دیگر قابل ویرایش نیست');
      if (cur) {
        await tx.execute(sql`UPDATE taskboard_reports SET body = ${input.body}, hours = ${input.hours}, updated_at = now() WHERE id = ${cur.id}`);
        return { id: cur.id };
      }
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO taskboard_reports (id, tenant_id, company_id, user_id, day, body, hours) VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${ctx.userId}, ${today}::date, ${input.body}, ${input.hours})`);
      return { id };
    });
  },

  async reports(ctx: ModuleRequestContext, r: z.infer<typeof rangeQuery>, userId: string | undefined) {
    const team = isManager(ctx);
    const who = team ? (userId ? sql`AND user_id = ${userId}` : sql``) : sql`AND user_id = ${ctx.userId}`;
    return ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT id, user_id, day::text, body, hours::float8 AS hours, score, scored_by, scored_at, review_note, updated_at FROM taskboard_reports
        WHERE company_id = ${ctx.companyId} AND day BETWEEN ${r.from}::date AND ${r.to}::date ${who} ORDER BY day DESC, updated_at DESC LIMIT 1000`),
    );
  },

  async scoreReport(ctx: ModuleRequestContext, id: string, input: z.infer<typeof scoreInput>) {
    requireManager(ctx);
    const rep = await ctx.db.transaction(async (tx) => {
      const rep = await one<{ user_id: string; day: string }>(tx, sql`SELECT user_id, day::text FROM taskboard_reports WHERE id = ${id} AND company_id = ${ctx.companyId} FOR UPDATE`);
      if (!rep) throw notFound('گزارش');
      if (rep.user_id === ctx.userId) throw forbidden('نمره‌دهی به گزارش خودتان مجاز نیست');
      await tx.execute(sql`UPDATE taskboard_reports SET score = ${input.score}, review_note = ${input.note}, scored_by = ${ctx.userId}, scored_at = now() WHERE id = ${id}`);
      await ctx.audit({ action: 'taskboard.report.scored', entityType: 'taskboard_report', entityId: id, after: { score: input.score } }, tx);
      return rep;
    });
    await ctx.notify({ userIds: [rep.user_id], type: 'taskboard.report.scored', title: `گزارش کار ${rep.day} نمره ${input.score} از ۵ گرفت`, body: input.note || undefined, link: '/app/taskboard' });
    return { ok: true };
  },

  // -------------------------------------------------------------- scorecard

  async scorecard(ctx: ModuleRequestContext, r: z.infer<typeof rangeQuery>, today: string) {
    const team = isManager(ctx);
    const cal = await calendarOf(ctx);
    const people = await ctx.db.transaction((tx) =>
      rows<{ user_id: string }>(tx, team
        ? sql`SELECT DISTINCT assignee_id AS user_id FROM taskboard_tasks WHERE company_id = ${ctx.companyId} AND due_at >= ${dayStart(r.from)} AND due_at < ${dayStart(addDays(r.to, 1))}
            UNION SELECT DISTINCT user_id FROM taskboard_attendance WHERE company_id = ${ctx.companyId} AND day BETWEEN ${r.from}::date AND ${r.to}::date
            UNION SELECT DISTINCT user_id FROM taskboard_reports WHERE company_id = ${ctx.companyId} AND day BETWEEN ${r.from}::date AND ${r.to}::date`
        : sql`SELECT ${ctx.userId}::uuid AS user_id`),
    );
    const out = [];
    for (const p of people) out.push({ userId: p.user_id, ...(await components(ctx, ctx.companyId, r.from, r.to, p.user_id, cal, today)) });
    return out;
  },
};

// ---------------------------------------------------------------- figures (scorecard + KPI providers)

export interface Figures extends Components {
  tasks: number;
  onTime: number;
  late: number;
  missed: number;
  workingDays: number;
  presentDays: number;
  lateDays: number;
  reports: number;
  performance: number | null;
}

/**
 * Figures for one person (or the whole company when `userId` is null) over [from, to] — only the part of the
 * range up to `today` counts, so future days and tasks not yet due never lower the rates.
 */
async function components(ctx: ModuleEventContext | ModuleRequestContext, companyId: string, from: string, to: string, userId: string | null, cal: WorkCalendar, today: string): Promise<Figures> {
  const end = to < today ? to : today;
  const lo = dayStart(from);
  const hi = dayStart(addDays(to, 1));
  const who = (col: string) => (userId ? sql`AND ${sql.raw(col)} = ${userId}` : sql``);
  const f = await ctx.db.transaction(async (tx) => {
    const t = await one<{ total: number; on_time: number; late: number; missed: number }>(tx, sql`SELECT
        count(*) FILTER (WHERE status IN ('done', 'approved') OR due_at < now())::int AS total,
        count(*) FILTER (WHERE status IN ('done', 'approved') AND done_at <= due_at)::int AS on_time,
        count(*) FILTER (WHERE status IN ('done', 'approved') AND done_at > due_at)::int AS late,
        count(*) FILTER (WHERE status IN ('todo', 'returned') AND due_at < now())::int AS missed
      FROM taskboard_tasks WHERE company_id = ${companyId} AND status <> 'cancelled' AND due_at >= ${lo} AND due_at < ${hi} ${who('assignee_id')}`);
    const sc = await one<{ avg: number | null }>(tx, sql`SELECT avg(s)::float8 AS avg FROM (
        SELECT score AS s FROM taskboard_tasks WHERE company_id = ${companyId} AND status = 'approved' AND due_at >= ${lo} AND due_at < ${hi} ${who('assignee_id')}
        UNION ALL SELECT score FROM taskboard_reports WHERE company_id = ${companyId} AND score IS NOT NULL AND day BETWEEN ${from}::date AND ${to}::date ${who('user_id')}) x`);
    const at = await one<{ present: number; late: number }>(tx, sql`SELECT count(*)::int AS present, count(*) FILTER (WHERE late_minutes > 0)::int AS late
      FROM taskboard_attendance WHERE company_id = ${companyId} AND day BETWEEN ${from}::date AND ${end}::date ${who('user_id')}`);
    const rp = await one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM taskboard_reports WHERE company_id = ${companyId} AND day BETWEEN ${from}::date AND ${end}::date ${who('user_id')}`);
    return { t: t!, avg: sc!.avg, at: at!, reports: rp!.n };
  });
  let workingDays = 0;
  for (let d = from; d <= end; d = addDays(d, 1)) if (isWorkingDay(d, cal)) workingDays++;
  // per person: on-time arrivals over working days; company-wide: share of arrivals that were on time
  const attendanceRate = userId ? percent(f.at.present - f.at.late, workingDays) : percent(f.at.present - f.at.late, f.at.present);
  const c: Components = {
    onTimeRate: percent(f.t.on_time, f.t.total),
    averageScore: scorePercent(f.avg),
    attendanceRate: attendanceRate === null ? null : Math.min(100, attendanceRate),
    reportRate: userId ? (workingDays ? Math.min(100, percent(f.reports, workingDays)!) : null) : null,
  };
  return {
    ...c,
    tasks: f.t.total,
    onTime: f.t.on_time,
    late: f.t.late,
    missed: f.t.missed,
    workingDays,
    presentDays: f.at.present,
    lateDays: f.at.late,
    reports: f.reports,
    performance: performance(c),
  };
}

type KpiParams = { companyId: string; from: string; to: string; dimensions?: Record<string, string> };
export async function kpi(ctx: ModuleEventContext, p: KpiParams, key: keyof Components | 'performance', today: string): Promise<number | null> {
  const person = p.dimensions?.subjectType === 'person' && p.dimensions.subjectId ? p.dimensions.subjectId : (p.dimensions?.person ?? null);
  const f = await components(ctx, p.companyId, p.from, p.to, person, await calendarOf(ctx), today);
  return f[key];
}

// ---------------------------------------------------------------- scheduler: recurring duties + overdue alerts

/** Creates the day's task for every active duty falling on `day` (idempotent per duty and day). */
export async function generateDuties(ctx: ModuleEventContext | ModuleRequestContext, day: string, onlyDuty?: string): Promise<number> {
  const cal = await calendarOf(ctx);
  return ctx.db.transaction(async (tx) => {
    const duties = await rows<DutySchedule & { id: string; company_id: string; title: string; description: string; assignee_id: string; due_time: string; priority: string; created_by: string }>(tx,
      sql`SELECT id, company_id, title, description, assignee_id, recurrence, weekdays::int[] AS weekdays, month_day, due_time, priority, skip_days_off, created_by
        FROM taskboard_duties WHERE active ${onlyDuty ? sql`AND id = ${onlyDuty}` : sql``}`);
    let n = 0;
    for (const d of duties) {
      if (!dutyOccursOn(d, day, cal)) continue;
      const r = await tx.execute(sql`INSERT INTO taskboard_tasks (id, tenant_id, company_id, title, description, assignee_id, created_by, duty_id, occurrence_on, due_at, priority)
        VALUES (${randomUUID()}, ${ctx.tenantId}, ${d.company_id}, ${d.title}, ${d.description}, ${d.assignee_id}, ${d.created_by}, ${d.id}, ${day}::date, ${dueAt(day, d.due_time, TZ)}, ${d.priority})
        ON CONFLICT (duty_id, occurrence_on) WHERE duty_id IS NOT NULL DO NOTHING RETURNING id`);
      n += r.rows.length;
    }
    return n;
  });
}

/** Tells the assignee once when an open task passes its due time. */
export async function overdueAlerts(ctx: ModuleEventContext): Promise<number> {
  const due = await ctx.db.transaction((tx) =>
    rows<{ id: string; title: string; assignee_id: string }>(tx, sql`UPDATE taskboard_tasks SET overdue_notified = true
      WHERE status IN ('todo', 'returned') AND due_at < now() AND NOT overdue_notified RETURNING id, title, assignee_id`),
  );
  for (const t of due) await ctx.notify({ userIds: [t.assignee_id], type: 'taskboard.task.overdue', title: `مهلت کار گذشت: ${t.title}`, link: '/app/taskboard' });
  return due.length;
}

// ---------------------------------------------------------------- widgets

export async function todayWidget(ctx: ModuleRequestContext, today: string) {
  return ctx.db.transaction(async (tx) => {
    const items = await rows(tx, sql`SELECT t.id, t.title, t.due_at, t.status FROM taskboard_tasks t WHERE t.company_id = ${ctx.companyId} AND t.assignee_id = ${ctx.userId}
      AND t.status IN ('todo', 'returned') AND t.due_at < ${dayStart(addDays(today, 1))} ORDER BY t.due_at LIMIT 8`);
    const att = await one(tx, sql`SELECT check_in, check_out, late_minutes FROM taskboard_attendance WHERE company_id = ${ctx.companyId} AND user_id = ${ctx.userId} AND day = ${today}::date`);
    return { items, attendance: att ?? null };
  });
}

export async function teamWidget(ctx: ModuleRequestContext, today: string) {
  return ctx.db.transaction(async (tx) => {
    const t = await one<{ open: number; overdue: number; review: number }>(tx, sql`SELECT
        count(*) FILTER (WHERE status IN ('todo', 'returned') AND due_at >= ${dayStart(today)} AND due_at < ${dayStart(addDays(today, 1))})::int AS open,
        count(*) FILTER (WHERE status IN ('todo', 'returned') AND due_at < now())::int AS overdue,
        count(*) FILTER (WHERE status = 'done')::int AS review
      FROM taskboard_tasks WHERE company_id = ${ctx.companyId}`);
    const a = await one<{ present: number; late: number }>(tx, sql`SELECT count(*)::int AS present, count(*) FILTER (WHERE late_minutes > 0)::int AS late
      FROM taskboard_attendance WHERE company_id = ${ctx.companyId} AND day = ${today}::date`);
    return { ...t!, ...a! };
  });
}
