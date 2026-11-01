import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, ModuleEventContext, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { toJalali, workingDaysBetween, type WorkCalendar } from '@mohandesyar/persian';
import { conflict, forbidden, invalid, notFound } from './errors.js';
import type { contractInput, employeeInput, endInput, leaveInput, leaveQuery, leaveTypesInput, listQuery, recordInput, reviewInput, skillsInput, trainingInput } from './inputs.js';

type Row = Record<string, unknown>;
const rows = async <T = Row>(tx: Db, q: SQL) => (await tx.execute(q)).rows as T[];
const one = async <T = Row>(tx: Db, q: SQL) => (await rows<T>(tx, q))[0];

export const jalaliYear = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return toJalali(y, m, d).jy;
};

/** Unique-violation → readable 409 (personnel number, national ID, linked user). */
async function uniqueGuard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const c = (e as { cause?: { code?: string; constraint?: string }; code?: string; constraint?: string }).cause ?? (e as { code?: string; constraint?: string });
    if (c.code === '23505') {
      if (c.constraint?.includes('national_id')) throw conflict('NATIONAL_ID_TAKEN', 'کارمندی با این کد ملی ثبت شده است');
      if (c.constraint?.includes('user')) throw conflict('USER_LINKED', 'این کاربر به پرونده کارمند دیگری متصل است');
      if (c.constraint?.includes('period')) throw conflict('REVIEW_EXISTS', 'برای این کارمند در این دوره ارزیابی ثبت شده است');
      throw conflict('PERSONNEL_NO_TAKEN', 'این شماره پرسنلی قبلاً ثبت شده است');
    }
    throw e;
  }
}

/** own scope: only the employee file linked to the signed-in user. */
function scope(ctx: ModuleRequestContext, permission: string): SQL {
  if (ctx.can(permission, 'company')) return sql`TRUE`;
  if (ctx.can(permission, 'own')) return sql`e.user_id = ${ctx.userId}`;
  return sql`FALSE`;
}

async function validateUsers(ctx: ModuleRequestContext, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter(Boolean) as string[])];
  if (wanted.length && (await ctx.directory(wanted)).length !== wanted.length) throw invalid('UNKNOWN_USER', 'کاربر انتخاب‌شده عضو فعال سازمان نیست');
}

// ---------------------------------------------------------------- leave types & balances

export const DEFAULT_LEAVE_TYPES = [
  { name: 'استحقاقی', annualDays: 26, paid: true },
  { name: 'استعلاجی', annualDays: null, paid: true },
  { name: 'بدون حقوق', annualDays: null, paid: false },
];

export interface LeaveType {
  id: string;
  name: string;
  annual_days: number | null;
  paid: boolean;
  archived: boolean;
}

async function typesOf(tx: Db, tenantId: string, companyId: string): Promise<LeaveType[]> {
  const q = sql`SELECT id, name, annual_days::float, paid, archived FROM hr_leave_types WHERE company_id = ${companyId} ORDER BY created_at, name`;
  let t = await rows<LeaveType>(tx, q);
  if (!t.length) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`hr-leave-types:${companyId}`}))`);
    t = await rows<LeaveType>(tx, q);
    if (!t.length) {
      for (const d of DEFAULT_LEAVE_TYPES) {
        // clock_timestamp(): distinct creation times inside one transaction keep the listed order.
        await tx.execute(sql`INSERT INTO hr_leave_types (id, tenant_id, company_id, name, annual_days, paid, created_at) VALUES (${randomUUID()}, ${tenantId}, ${companyId}, ${d.name}, ${d.annualDays}, ${d.paid}, clock_timestamp())`);
      }
      t = await rows<LeaveType>(tx, q);
    }
  }
  return t;
}

/** Allowance, used (approved) and pending days per leave type for a Jalali year. */
async function balances(tx: Db, tenantId: string, companyId: string, employeeId: string, year: number) {
  const types = await typesOf(tx, tenantId, companyId);
  const used = await rows<{ type_id: string; approved: number; pending: number }>(
    tx,
    sql`SELECT type_id, coalesce(sum(days) FILTER (WHERE status = 'approved'), 0)::float AS approved, coalesce(sum(days) FILTER (WHERE status = 'pending'), 0)::float AS pending
      FROM hr_leave_requests WHERE employee_id = ${employeeId} AND jalali_year = ${year} GROUP BY type_id`,
  );
  return types
    .filter((t) => !t.archived || used.some((u) => u.type_id === t.id))
    .map((t) => {
      const u = used.find((x) => x.type_id === t.id);
      const approved = u?.approved ?? 0;
      const pending = u?.pending ?? 0;
      return { typeId: t.id, name: t.name, paid: t.paid, allowance: t.annual_days, approved, pending, remaining: t.annual_days === null ? null : t.annual_days - approved - pending };
    });
}

async function calendarOf(ctx: { workCalendar(): Promise<{ weeklyOff: number[]; holidays: string[] }> }): Promise<WorkCalendar> {
  const c = await ctx.workCalendar();
  return { weeklyOff: c.weeklyOff, holidays: new Set(c.holidays) };
}

// ---------------------------------------------------------------- employees

export const Employees = {
  list: (ctx: ModuleRequestContext, f: z.infer<typeof listQuery>) =>
    ctx.db.transaction((tx) => {
      const like = f.q ? `%${f.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null;
      return rows(tx, sql`SELECT e.id, e.personnel_no, e.full_name, e.department, e.position, e.mobile, e.email, e.user_id, e.manager_user_id, e.hired_on::text, e.ended_on::text, e.status,
          EXISTS (SELECT 1 FROM hr_leave_requests l WHERE l.employee_id = e.id AND l.status = 'approved' AND current_date BETWEEN l.starts_on AND l.ends_on) AS on_leave
        FROM hr_employees e WHERE ${scope(ctx, 'hr.employee.view')}
          ${f.status === 'all' ? sql`` : sql`AND e.status = ${f.status}`}
          ${like ? sql`AND (e.full_name ILIKE ${like} OR e.personnel_no ILIKE ${like} OR e.position ILIKE ${like})` : sql``}
          ${f.department ? sql`AND e.department = ${f.department}` : sql``}
        ORDER BY e.status, e.full_name LIMIT 1000`);
    }),

  async get(ctx: ModuleRequestContext, id: string, today: string) {
    return ctx.db.transaction(async (tx) => {
      const e = await one<{ id: string; company_id: string; user_id: string | null }>(tx, sql`SELECT e.id, e.company_id, e.personnel_no, e.full_name, e.national_id, e.mobile, e.email, e.user_id,
          e.recruitment_candidate_id, e.department, e.position, e.manager_user_id, e.hired_on::text, e.ended_on::text, e.end_reason, e.status, e.notes, e.created_at
        FROM hr_employees e WHERE e.id = ${id} AND ${scope(ctx, 'hr.employee.view')}`);
      if (!e) throw notFound('پرونده کارمند');
      const self = e.user_id === ctx.userId;
      const canContracts = ctx.can('hr.contract.view', 'company');
      const reviewScope = ctx.can('hr.review.view', 'company') ? sql`TRUE` : self && ctx.can('hr.review.view', 'own') ? sql`status = 'final'` : sql`FALSE`;
      const year = jalaliYear(today);
      const [records, skills, trainings, leave, reviews, contracts, bal] = await Promise.all([
        rows(tx, sql`SELECT id, kind, occurred_on::text, title, notes, created_at FROM hr_records WHERE employee_id = ${id} ORDER BY occurred_on DESC NULLS LAST, created_at DESC`),
        rows(tx, sql`SELECT id, kind, name, level FROM hr_skills WHERE employee_id = ${id} ORDER BY kind, level DESC, name`),
        rows(tx, sql`SELECT id, title, provider, completed_on::text, hours::float, certificate FROM hr_trainings WHERE employee_id = ${id} ORDER BY completed_on DESC`),
        rows(tx, sql`SELECT l.id, l.type_id, t.name AS type_name, l.starts_on::text, l.ends_on::text, l.days::float, l.reason, l.status, l.created_at FROM hr_leave_requests l
          JOIN hr_leave_types t ON t.id = l.type_id WHERE l.employee_id = ${id} ORDER BY l.starts_on DESC LIMIT 100`),
        rows(tx, sql`SELECT id, period, reviewer_id, criteria, score::float, strengths, improvements, status, finalized_at, updated_at FROM hr_reviews WHERE employee_id = ${id} AND ${reviewScope} ORDER BY created_at DESC`),
        canContracts
          ? rows(tx, sql`SELECT id, kind, starts_on::text, ends_on::text, monthly_salary::text, weekly_hours::float, notes, created_at FROM hr_contracts WHERE employee_id = ${id} ORDER BY starts_on DESC`)
          : Promise.resolve(null),
        balances(tx, ctx.tenantId, e.company_id, id, year),
      ]);
      // Opening someone else's file, and every view of salaries, is recorded.
      if (!self || canContracts) await ctx.audit({ action: canContracts ? 'hr.contract.viewed' : 'hr.employee.viewed', entityType: 'employee', entityId: id }, tx);
      return { employee: e, records, skills, trainings, leave, reviews, contracts, balances: { year, items: bal }, self };
    });
  },

  async mine(ctx: ModuleRequestContext) {
    const r = await ctx.db.transaction((tx) => one<{ id: string }>(tx, sql`SELECT id FROM hr_employees WHERE user_id = ${ctx.userId} AND status = 'active'`));
    return { id: r?.id ?? null };
  },

  async save(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof employeeInput>) {
    await validateUsers(ctx, [input.userId, input.managerUserId]);
    if (input.userId && input.userId === input.managerUserId) throw invalid('MANAGER_SELF', 'مدیر مستقیم نمی‌تواند خود کارمند باشد');
    return uniqueGuard(() =>
      ctx.db.transaction(async (tx) => {
        const fields = sql`personnel_no = ${input.personnelNo}, full_name = ${input.fullName}, national_id = ${input.nationalId}, mobile = ${input.mobile}, email = ${input.email},
          user_id = ${input.userId}, manager_user_id = ${input.managerUserId}, department = ${input.department}, position = ${input.position}, hired_on = ${input.hiredOn}, notes = ${input.notes}`;
        if (id) {
          const r = await rows(tx, sql`UPDATE hr_employees SET ${fields}, updated_at = now() WHERE id = ${id} RETURNING id`);
          if (!r.length) throw notFound('پرونده کارمند');
          await ctx.audit({ action: 'hr.employee.updated', entityType: 'employee', entityId: id }, tx);
          return { id };
        }
        id = randomUUID();
        await tx.execute(sql`INSERT INTO hr_employees (id, tenant_id, company_id, personnel_no, full_name, hired_on, recruitment_candidate_id, created_by)
          VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.personnelNo}, ${input.fullName}, ${input.hiredOn}, ${input.recruitmentCandidateId}, ${ctx.userId})`);
        await tx.execute(sql`UPDATE hr_employees SET ${fields} WHERE id = ${id}`);
        await tx.execute(sql`INSERT INTO hr_records (id, tenant_id, company_id, employee_id, kind, occurred_on, title, created_by)
          VALUES (${randomUUID()}, ${ctx.tenantId}, ${ctx.companyId}, ${id}, 'hire', ${input.hiredOn}, ${`شروع همکاری${input.position ? ` — ${input.position}` : ''}`}, ${ctx.userId})`);
        for (const r of input.records) {
          await tx.execute(sql`INSERT INTO hr_records (id, tenant_id, company_id, employee_id, kind, occurred_on, title, notes, created_by)
            VALUES (${randomUUID()}, ${ctx.tenantId}, ${ctx.companyId}, ${id}, ${r.kind}, ${r.occurredOn}, ${r.title}, ${r.notes}, ${ctx.userId})`);
        }
        for (const s of input.skills) {
          await tx.execute(sql`INSERT INTO hr_skills (id, tenant_id, company_id, employee_id, kind, name, level) VALUES (${randomUUID()}, ${ctx.tenantId}, ${ctx.companyId}, ${id}, ${s.kind}, ${s.name}, ${s.level})
            ON CONFLICT (employee_id, kind, name) DO NOTHING`);
        }
        await ctx.audit({ action: 'hr.employee.created', entityType: 'employee', entityId: id, after: { fromCandidate: input.recruitmentCandidateId, skills: input.skills.length, records: input.records.length } }, tx);
        return { id };
      }),
    );
  },

  async end(ctx: ModuleRequestContext, id: string, input: z.infer<typeof endInput>) {
    await ctx.db.transaction(async (tx) => {
      const e = await one<{ hired_on: string; company_id: string }>(tx, sql`SELECT hired_on::text, company_id FROM hr_employees WHERE id = ${id} AND status = 'active' FOR UPDATE`);
      if (!e) throw notFound('پرونده کارمند فعال');
      if (input.endedOn < e.hired_on) throw invalid('END_DATE', 'تاریخ پایان همکاری قبل از تاریخ استخدام است');
      await tx.execute(sql`UPDATE hr_employees SET status = 'left', ended_on = ${input.endedOn}, end_reason = ${input.reason}, updated_at = now() WHERE id = ${id}`);
      await tx.execute(sql`INSERT INTO hr_records (id, tenant_id, company_id, employee_id, kind, occurred_on, title, notes, created_by)
        VALUES (${randomUUID()}, ${ctx.tenantId}, ${e.company_id}, ${id}, 'other', ${input.endedOn}, 'پایان همکاری', ${input.reason}, ${ctx.userId})`);
      await ctx.audit({ action: 'hr.employee.ended', entityType: 'employee', entityId: id, after: input }, tx);
    });
  },

  async addRecord(ctx: ModuleRequestContext, id: string, input: z.infer<typeof recordInput>) {
    return ctx.db.transaction(async (tx) => {
      const e = await one<{ company_id: string }>(tx, sql`SELECT company_id FROM hr_employees WHERE id = ${id}`);
      if (!e) throw notFound('پرونده کارمند');
      const rid = randomUUID();
      await tx.execute(sql`INSERT INTO hr_records (id, tenant_id, company_id, employee_id, kind, occurred_on, title, notes, created_by)
        VALUES (${rid}, ${ctx.tenantId}, ${e.company_id}, ${id}, ${input.kind}, ${input.occurredOn}, ${input.title}, ${input.notes}, ${ctx.userId})`);
      await ctx.audit({ action: 'hr.record.added', entityType: 'employee', entityId: id, after: { kind: input.kind, title: input.title } }, tx);
      return { id: rid };
    });
  },

  async setSkills(ctx: ModuleRequestContext, id: string, input: z.infer<typeof skillsInput>) {
    await ctx.db.transaction(async (tx) => {
      const e = await one<{ company_id: string }>(tx, sql`SELECT company_id FROM hr_employees WHERE id = ${id}`);
      if (!e) throw notFound('پرونده کارمند');
      await tx.execute(sql`DELETE FROM hr_skills WHERE employee_id = ${id}`);
      for (const s of input.skills) {
        await tx.execute(sql`INSERT INTO hr_skills (id, tenant_id, company_id, employee_id, kind, name, level) VALUES (${randomUUID()}, ${ctx.tenantId}, ${e.company_id}, ${id}, ${s.kind}, ${s.name}, ${s.level})
          ON CONFLICT (employee_id, kind, name) DO UPDATE SET level = greatest(hr_skills.level, EXCLUDED.level)`);
      }
    });
  },

  async addTraining(ctx: ModuleRequestContext, id: string, input: z.infer<typeof trainingInput>) {
    return ctx.db.transaction(async (tx) => {
      const e = await one<{ company_id: string }>(tx, sql`SELECT company_id FROM hr_employees WHERE id = ${id}`);
      if (!e) throw notFound('پرونده کارمند');
      const tid = randomUUID();
      await tx.execute(sql`INSERT INTO hr_trainings (id, tenant_id, company_id, employee_id, title, provider, completed_on, hours, certificate, created_by)
        VALUES (${tid}, ${ctx.tenantId}, ${e.company_id}, ${id}, ${input.title}, ${input.provider}, ${input.completedOn}, ${input.hours}, ${input.certificate}, ${ctx.userId})`);
      return { id: tid };
    });
  },

  async removeTraining(ctx: ModuleRequestContext, id: string, tid: string) {
    await ctx.db.transaction(async (tx) => {
      const r = await rows(tx, sql`DELETE FROM hr_trainings WHERE id = ${tid} AND employee_id = ${id} RETURNING id`);
      if (!r.length) throw notFound('آموزش');
    });
  },

  async addContract(ctx: ModuleRequestContext, id: string, input: z.infer<typeof contractInput>) {
    return ctx.db.transaction(async (tx) => {
      const e = await one<{ company_id: string }>(tx, sql`SELECT company_id FROM hr_employees WHERE id = ${id}`);
      if (!e) throw notFound('پرونده کارمند');
      const overlap = await one(tx, sql`SELECT 1 FROM hr_contracts WHERE employee_id = ${id} AND starts_on <= ${input.endsOn ?? '9999-12-31'}::date AND coalesce(ends_on, '9999-12-31') >= ${input.startsOn}::date`);
      if (overlap) throw conflict('CONTRACT_OVERLAP', 'این بازه با قرارداد دیگری از همین کارمند هم‌پوشانی دارد');
      const cid = randomUUID();
      await tx.execute(sql`INSERT INTO hr_contracts (id, tenant_id, company_id, employee_id, kind, starts_on, ends_on, monthly_salary, weekly_hours, notes, created_by)
        VALUES (${cid}, ${ctx.tenantId}, ${e.company_id}, ${id}, ${input.kind}, ${input.startsOn}, ${input.endsOn}, ${input.monthlySalary}, ${input.weeklyHours}, ${input.notes}, ${ctx.userId})`);
      await ctx.audit({ action: 'hr.contract.added', entityType: 'employee', entityId: id, after: { kind: input.kind, startsOn: input.startsOn, endsOn: input.endsOn } }, tx);
      return { id: cid };
    });
  },
};

/** Field-by-field transfer from recruitment: the screen shows what exists; the user decides what to copy. */
export const Transfer = {
  hired: async (ctx: ModuleRequestContext) => {
    const svc = ctx.services.get<{ hired(): Promise<{ id: string; full_name: string; job_title: string; hired_on: string }[]> }>('recruitment.candidates', '^1');
    if (!svc) return [];
    const list = await svc.hired();
    const done = await ctx.db.transaction((tx) => rows<{ c: string }>(tx, sql`SELECT recruitment_candidate_id AS c FROM hr_employees WHERE recruitment_candidate_id IS NOT NULL`));
    const taken = new Set(done.map((d) => d.c));
    return list.filter((c) => !taken.has(c.id));
  },
  candidate: async (ctx: ModuleRequestContext, id: string) => {
    const svc = ctx.services.get<{ get(id: string): Promise<Row | null> }>('recruitment.candidates', '^1');
    const c = svc ? await svc.get(id) : null;
    if (!c) throw notFound('متقاضی');
    await ctx.audit({ action: 'hr.transfer.viewed', entityType: 'recruitment_candidate', entityId: id });
    return c;
  },
};

// ---------------------------------------------------------------- leave

export const Leave = {
  types: (ctx: ModuleRequestContext) => ctx.db.transaction((tx) => typesOf(tx, ctx.tenantId, ctx.companyId)),

  async saveTypes(ctx: ModuleRequestContext, input: z.infer<typeof leaveTypesInput>) {
    await ctx.db.transaction(async (tx) => {
      const cur = await typesOf(tx, ctx.tenantId, ctx.companyId);
      const sent = new Set(input.types.map((t) => t.id).filter(Boolean));
      if (cur.some((t) => !sent.has(t.id))) throw invalid('TYPE_MISSING', 'نوع مرخصی حذف نمی‌شود؛ آن را بایگانی کنید');
      if (!input.types.some((t) => !t.archived)) throw invalid('NO_TYPE', 'دست‌کم یک نوع مرخصی فعال لازم است');
      for (const t of input.types) {
        if (t.id) {
          if (!cur.some((c) => c.id === t.id)) throw notFound('نوع مرخصی');
          await tx.execute(sql`UPDATE hr_leave_types SET name = ${t.name}, annual_days = ${t.annualDays}, paid = ${t.paid}, archived = ${t.archived} WHERE id = ${t.id}`);
        } else {
          await tx.execute(sql`INSERT INTO hr_leave_types (id, tenant_id, company_id, name, annual_days, paid, archived, created_at) VALUES (${randomUUID()}, ${ctx.tenantId}, ${ctx.companyId}, ${t.name}, ${t.annualDays}, ${t.paid}, ${t.archived}, clock_timestamp())`);
        }
      }
      await ctx.audit({ action: 'hr.leave_types.saved', entityType: 'company', entityId: ctx.companyId, after: input.types }, tx);
    });
  },

  /** Working days only (weekly days off and holidays of the organisation's calendar are not counted). */
  async request(ctx: ModuleRequestContext, input: z.infer<typeof leaveInput>) {
    if (jalaliYear(input.startsOn) !== jalaliYear(input.endsOn)) throw invalid('YEAR_SPAN', 'مرخصی‌ای که از سال شمسی بعد می‌گذرد را در دو درخواست ثبت کنید');
    const days = workingDaysBetween(input.startsOn, input.endsOn, await calendarOf(ctx));
    if (!days) throw invalid('NO_WORKING_DAYS', 'در این بازه روز کاری وجود ندارد');
    const r = await ctx.db.transaction(async (tx) => {
      const e = input.employeeId
        ? await one<{ id: string; company_id: string; full_name: string; user_id: string | null; status: string }>(tx, sql`SELECT id, company_id, full_name, user_id, status FROM hr_employees WHERE id = ${input.employeeId} FOR UPDATE`)
        : await one<{ id: string; company_id: string; full_name: string; user_id: string | null; status: string }>(tx, sql`SELECT id, company_id, full_name, user_id, status FROM hr_employees WHERE user_id = ${ctx.userId} AND status = 'active' FOR UPDATE`);
      if (!e) throw notFound(input.employeeId ? 'پرونده کارمند' : 'پرونده کارمندی متصل به حساب شما');
      if (e.user_id !== ctx.userId && !ctx.can('hr.leave.request', 'company')) throw forbidden('فقط برای خودتان می‌توانید مرخصی درخواست کنید');
      if (e.status !== 'active') throw conflict('NOT_ACTIVE', 'همکاری این کارمند پایان یافته است');
      const type = (await typesOf(tx, ctx.tenantId, e.company_id)).find((t) => t.id === input.typeId && !t.archived);
      if (!type) throw invalid('TYPE', 'نوع مرخصی معتبر نیست');
      const overlap = await one(tx, sql`SELECT 1 FROM hr_leave_requests WHERE employee_id = ${e.id} AND status IN ('pending', 'approved') AND starts_on <= ${input.endsOn}::date AND ends_on >= ${input.startsOn}::date`);
      if (overlap) throw conflict('LEAVE_OVERLAP', 'در این بازه درخواست مرخصی دیگری ثبت شده است');
      const year = jalaliYear(input.startsOn);
      if (type.annual_days !== null) {
        const b = (await balances(tx, ctx.tenantId, e.company_id, e.id, year)).find((x) => x.typeId === type.id)!;
        if (days > b.remaining!) throw conflict('BALANCE', `مانده مرخصی ${type.name} ${b.remaining!.toLocaleString('fa-IR')} روز است و این درخواست ${days.toLocaleString('fa-IR')} روز کاری است`);
      }
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO hr_leave_requests (id, tenant_id, company_id, employee_id, type_id, starts_on, ends_on, days, jalali_year, reason, requested_by)
        VALUES (${id}, ${ctx.tenantId}, ${e.company_id}, ${e.id}, ${type.id}, ${input.startsOn}, ${input.endsOn}, ${days}, ${year}, ${input.reason}, ${ctx.userId})`);
      const wf = await ctx.startWorkflow({ key: 'hr.leave', entityType: 'leave', entityId: id, title: `مرخصی ${type.name} ${e.full_name} (${days.toLocaleString('fa-IR')} روز)` }, tx);
      await tx.execute(sql`UPDATE hr_leave_requests SET workflow_instance_id = ${wf.instanceId} WHERE id = ${id}`);
      return { id, days, state: wf.state };
    });
    // A workflow without steps approves at once; its completion event updates the request.
    return r;
  },

  list: (ctx: ModuleRequestContext, f: z.infer<typeof leaveQuery>) =>
    ctx.db.transaction((tx) => {
      const all = ctx.can('hr.leave.manage', 'company');
      return rows(tx, sql`SELECT l.id, l.employee_id, e.full_name, e.personnel_no, e.department, l.type_id, t.name AS type_name, t.paid, l.starts_on::text, l.ends_on::text, l.days::float, l.reason,
          l.status, l.requested_by, l.created_at, l.decided_at
        FROM hr_leave_requests l JOIN hr_employees e ON e.id = l.employee_id JOIN hr_leave_types t ON t.id = l.type_id
        WHERE ${all && !f.mine ? sql`TRUE` : sql`(e.user_id = ${ctx.userId} OR l.requested_by = ${ctx.userId})`}
          ${f.status ? sql`AND l.status = ${f.status}` : sql``} ${f.employeeId ? sql`AND l.employee_id = ${f.employeeId}` : sql``}
        ORDER BY l.starts_on DESC LIMIT 500`);
    }),

  /** The requester withdraws a pending request (its approval is cancelled); HR can cancel an approved one. */
  async cancel(ctx: ModuleRequestContext, id: string) {
    const r = await ctx.db.transaction(async (tx) => {
      const l = await one<{ status: string; requested_by: string; user_id: string | null; workflow_instance_id: string | null }>(
        tx,
        sql`SELECT l.status, l.requested_by, e.user_id, l.workflow_instance_id FROM hr_leave_requests l JOIN hr_employees e ON e.id = l.employee_id WHERE l.id = ${id} FOR UPDATE OF l`,
      );
      const hr = ctx.can('hr.leave.manage', 'company');
      if (!l || (!hr && l.requested_by !== ctx.userId && l.user_id !== ctx.userId)) throw notFound('درخواست مرخصی');
      if (l.status === 'approved' && !hr) throw forbidden('مرخصی تأییدشده را فقط منابع انسانی لغو می‌کند');
      if (l.status !== 'pending' && l.status !== 'approved') throw conflict('FINISHED', 'این درخواست قابل لغو نیست');
      if (l.status === 'pending' && l.workflow_instance_id) await ctx.cancelWorkflow(l.workflow_instance_id, tx);
      await tx.execute(sql`UPDATE hr_leave_requests SET status = 'cancelled', decided_at = now() WHERE id = ${id}`);
      await ctx.audit({ action: 'hr.leave.cancelled', entityType: 'leave', entityId: id, after: { was: l.status } }, tx);
      return l;
    });
    return { ok: true, was: r.status };
  },
};

export async function onWorkflowCompleted(ctx: ModuleEventContext, p: { moduleId: string; entityType: string; entityId: string; state: 'approved' | 'rejected' }) {
  if (p.moduleId !== 'hr' || p.entityType !== 'leave') return;
  const done = await ctx.db.transaction(async (tx) => {
    const l = await one<{ id: string; employee_id: string; requested_by: string; user_id: string | null; type_name: string; starts_on: string; ends_on: string; days: number }>(
      tx,
      sql`UPDATE hr_leave_requests l SET status = ${p.state}, decided_at = now() FROM hr_employees e, hr_leave_types t
        WHERE l.id = ${p.entityId} AND l.status = 'pending' AND e.id = l.employee_id AND t.id = l.type_id
        RETURNING l.id, l.employee_id, l.requested_by, e.user_id, t.name AS type_name, l.starts_on::text, l.ends_on::text, l.days::float`,
    );
    if (!l) return null; // already applied, or withdrawn
    await ctx.publish('hr.leave.decided', { leaveId: l.id, employeeId: l.employee_id, state: p.state, startsOn: l.starts_on, endsOn: l.ends_on, days: l.days }, tx);
    return l;
  });
  if (done) {
    const to = [...new Set([done.requested_by, done.user_id].filter(Boolean) as string[])];
    await ctx.notify({ userIds: to, type: 'hr.leave.decided', title: `مرخصی ${done.type_name} ${p.state === 'approved' ? 'تأیید شد' : 'رد شد'}`, link: '/app/hr/leave' });
  }
}

// ---------------------------------------------------------------- reviews

export const Reviews = {
  list: (ctx: ModuleRequestContext) =>
    ctx.db.transaction((tx) => {
      const all = ctx.can('hr.review.view', 'company');
      return rows(tx, sql`SELECT r.id, r.employee_id, e.full_name, e.department, e.position, r.period, r.reviewer_id, r.score::float, r.status, r.finalized_at, r.updated_at
        FROM hr_reviews r JOIN hr_employees e ON e.id = r.employee_id
        WHERE ${all ? sql`TRUE` : sql`e.user_id = ${ctx.userId} AND r.status = 'final'`} ORDER BY r.updated_at DESC LIMIT 500`);
    }),

  async save(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof reviewInput>, finalize: boolean) {
    const total = input.criteria.reduce((s, c) => s + c.weight, 0);
    const score = Math.round((input.criteria.reduce((s, c) => s + c.weight * c.score, 0) / total / 5) * 1000) / 10;
    const r = await uniqueGuard(() =>
      ctx.db.transaction(async (tx) => {
        const e = await one<{ company_id: string; user_id: string | null; full_name: string }>(tx, sql`SELECT company_id, user_id, full_name FROM hr_employees WHERE id = ${input.employeeId}`);
        if (!e) throw notFound('پرونده کارمند');
        if (e.user_id === ctx.userId) throw forbidden('ارزیابی عملکرد خودتان را نمی‌توانید ثبت کنید');
        const status = finalize ? 'final' : 'draft';
        if (id) {
          const cur = await one<{ status: string }>(tx, sql`SELECT status FROM hr_reviews WHERE id = ${id} AND employee_id = ${input.employeeId} FOR UPDATE`);
          if (!cur) throw notFound('ارزیابی');
          if (cur.status === 'final') throw conflict('FINAL', 'ارزیابی نهایی‌شده قابل تغییر نیست');
          await tx.execute(sql`UPDATE hr_reviews SET period = ${input.period}, criteria = ${JSON.stringify(input.criteria)}::jsonb, score = ${score}, strengths = ${input.strengths}, improvements = ${input.improvements},
            status = ${status}, finalized_at = ${finalize ? sql`now()` : sql`NULL`}, reviewer_id = ${ctx.userId}, updated_at = now() WHERE id = ${id}`);
        } else {
          id = randomUUID();
          await tx.execute(sql`INSERT INTO hr_reviews (id, tenant_id, company_id, employee_id, period, reviewer_id, criteria, score, strengths, improvements, status, finalized_at, created_by)
            VALUES (${id}, ${ctx.tenantId}, ${e.company_id}, ${input.employeeId}, ${input.period}, ${ctx.userId}, ${JSON.stringify(input.criteria)}::jsonb, ${score}, ${input.strengths}, ${input.improvements},
                    ${status}, ${finalize ? sql`now()` : sql`NULL`}, ${ctx.userId})`);
        }
        if (finalize) await ctx.audit({ action: 'hr.review.finalized', entityType: 'employee', entityId: input.employeeId, after: { period: input.period, score } }, tx);
        return { id, score, userId: e.user_id };
      }),
    );
    if (finalize && r.userId) await ctx.notify({ userIds: [r.userId], type: 'hr.review.final', title: `ارزیابی عملکرد دوره «${input.period}» ثبت شد`, link: `/app/hr/me` });
    return { id: r.id, score: r.score };
  },
};

// ---------------------------------------------------------------- widgets, jobs, providers, service

export async function overviewWidget(ctx: ModuleRequestContext, today: string, alertDays: number) {
  return ctx.db.transaction((tx) =>
    one(tx, sql`SELECT (SELECT count(*)::int FROM hr_employees WHERE status = 'active') AS headcount,
        (SELECT count(DISTINCT employee_id)::int FROM hr_leave_requests WHERE status = 'approved' AND ${today}::date BETWEEN starts_on AND ends_on) AS on_leave,
        (SELECT count(*)::int FROM hr_leave_requests WHERE status = 'pending') AS pending,
        (SELECT count(*)::int FROM hr_contracts c JOIN hr_employees e ON e.id = c.employee_id WHERE e.status = 'active' AND c.ends_on BETWEEN ${today}::date AND ${today}::date + ${alertDays}::int) AS contracts_ending`),
  );
}

export async function myLeaveWidget(ctx: ModuleRequestContext, today: string) {
  return ctx.db.transaction(async (tx) => {
    const e = await one<{ id: string; company_id: string }>(tx, sql`SELECT id, company_id FROM hr_employees WHERE user_id = ${ctx.userId} AND status = 'active'`);
    if (!e) return { linked: false, balances: [], upcoming: [] };
    const upcoming = await rows(tx, sql`SELECT l.id, t.name AS type_name, l.starts_on::text, l.ends_on::text, l.days::float, l.status FROM hr_leave_requests l JOIN hr_leave_types t ON t.id = l.type_id
      WHERE l.employee_id = ${e.id} AND l.status IN ('pending', 'approved') AND l.ends_on >= ${today}::date ORDER BY l.starts_on LIMIT 5`);
    return { linked: true, balances: await balances(tx, ctx.tenantId, e.company_id, e.id, jalaliYear(today)), upcoming };
  });
}

/** Daily: tells the person who recorded a fixed-term contract, once, that it ends soon. */
export async function contractAlerts(ctx: ModuleEventContext, today: string) {
  const s = await ctx.settings<{ contractAlertDays: number }>();
  const due = await ctx.db.transaction(async (tx) => {
    const list = await rows<{ id: string; company_id: string; ends_on: string; created_by: string; full_name: string; employee_id: string }>(
      tx,
      sql`SELECT c.id, c.company_id, c.ends_on::text, c.created_by, e.full_name, e.id AS employee_id FROM hr_contracts c JOIN hr_employees e ON e.id = c.employee_id
        WHERE e.status = 'active' AND c.ends_on BETWEEN ${today}::date AND ${today}::date + ${s.contractAlertDays}::int
          AND NOT EXISTS (SELECT 1 FROM hr_contracts n WHERE n.employee_id = c.employee_id AND n.starts_on > c.ends_on)`,
    );
    const fresh = [];
    for (const c of list) {
      const ins = await tx.execute(sql`INSERT INTO hr_alerts (id, tenant_id, company_id, alert_key) VALUES (${randomUUID()}, ${ctx.tenantId}, ${c.company_id}, ${`contract:${c.id}:${c.ends_on}`}) ON CONFLICT DO NOTHING RETURNING id`);
      if (ins.rows.length) fresh.push(c);
    }
    return fresh;
  });
  for (const c of due) {
    await ctx.notify({ userIds: [c.created_by], type: 'hr.contract.ending', title: `قرارداد کاری ${c.full_name} رو به پایان است`, link: `/app/hr/employees/${c.employee_id}` });
  }
  return due.length;
}

export async function search(ctx: ModuleRequestContext, q: string, limit: number) {
  const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const r = await ctx.db.transaction((tx) =>
    rows<{ id: string; full_name: string; position: string }>(tx, sql`SELECT e.id, e.full_name, e.position FROM hr_employees e WHERE ${scope(ctx, 'hr.employee.view')}
      AND (e.full_name ILIKE ${like} OR e.personnel_no ILIKE ${like}) ORDER BY e.status, e.full_name LIMIT ${limit}`),
  );
  return r.map((x) => ({ entityType: 'employee', entityId: x.id, title: x.full_name, snippet: x.position, link: `/app/hr/employees/${x.id}` }));
}

export const kpi = {
  headcount: (ctx: ModuleEventContext, p: { companyId: string; to: string }) =>
    ctx.db.transaction(async (tx) => (await one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM hr_employees WHERE company_id = ${p.companyId} AND hired_on <= ${p.to}::date AND (ended_on IS NULL OR ended_on > ${p.to}::date)`))!.n),
  trainingHours: (ctx: ModuleEventContext, p: { companyId: string; from: string; to: string }) =>
    ctx.db.transaction(async (tx) => (await one<{ n: number }>(tx, sql`SELECT coalesce(sum(hours), 0)::float AS n FROM hr_trainings WHERE company_id = ${p.companyId} AND completed_on BETWEEN ${p.from}::date AND ${p.to}::date`))!.n),
  leaveDays: (ctx: ModuleEventContext, p: { companyId: string; from: string; to: string }) =>
    ctx.db.transaction(async (tx) => (await one<{ n: number }>(tx, sql`SELECT coalesce(sum(days), 0)::float AS n FROM hr_leave_requests WHERE company_id = ${p.companyId} AND status = 'approved' AND starts_on BETWEEN ${p.from}::date AND ${p.to}::date`))!.n),
};

/** Public service hr.employees@1 (used by kpi for person scorecards): active employees, no personal data. */
export function publicService(ctx: ModuleEventContext) {
  return {
    list: () => ctx.db.transaction((tx) => rows(tx, sql`SELECT id, full_name, user_id, department, position, manager_user_id FROM hr_employees WHERE status = 'active' ORDER BY full_name`)),
    byUser: (userId: string) => ctx.db.transaction((tx) => one(tx, sql`SELECT id, full_name, user_id, department, position, manager_user_id FROM hr_employees WHERE user_id = ${userId} AND status = 'active'`)),
  };
}
