import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, ModuleEventContext, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { addDays, zonedToUtc } from '@mohandesyar/persian';
import { conflict, forbidden, invalid, notFound } from './errors.js';
import type { listQuery, meetingInput, minutesInput, resolutionInput, resolutionQuery, resolutionUpdateInput } from './inputs.js';

type Row = Record<string, unknown>;
const rows = async <T = Row>(tx: Db, q: SQL) => (await tx.execute(q)).rows as T[];
const one = async <T = Row>(tx: Db, q: SQL) => (await rows<T>(tx, q))[0];
const TZ = 'Asia/Tehran';

/** own scope: meetings the user organised or is invited to. */
function visible(ctx: ModuleRequestContext, permission: string): SQL {
  if (ctx.can(permission, 'company')) return sql`TRUE`;
  if (!ctx.can(permission, 'own')) return sql`FALSE`;
  return sql`(m.organizer_id = ${ctx.userId} OR m.created_by = ${ctx.userId} OR EXISTS (SELECT 1 FROM meetings_attendees x WHERE x.meeting_id = m.id AND x.user_id = ${ctx.userId}))`;
}
/** Managing an existing meeting with own scope: only its organiser (or creator). */
function manageable(ctx: ModuleRequestContext): SQL {
  if (ctx.can('meetings.meeting.manage', 'company')) return sql`TRUE`;
  return sql`(m.organizer_id = ${ctx.userId} OR m.created_by = ${ctx.userId})`;
}

interface MeetingRow {
  id: string;
  company_id: string;
  title: string;
  status: string;
  organizer_id: string;
  minutes_finalized_at: string | null;
  starts_at: string;
}

async function load(tx: Db, ctx: ModuleRequestContext, id: string, manage = false): Promise<MeetingRow> {
  const m = await one<MeetingRow>(tx, sql`SELECT m.id, m.company_id, m.title, m.status, m.organizer_id, m.minutes_finalized_at, m.starts_at FROM meetings_meetings m
    WHERE m.id = ${id} AND m.deleted_at IS NULL AND ${visible(ctx, 'meetings.meeting.view')} ${manage ? sql`FOR UPDATE OF m` : sql``}`);
  if (!m) throw notFound();
  if (manage && !(await one(tx, sql`SELECT 1 FROM meetings_meetings m WHERE m.id = ${id} AND ${manageable(ctx)}`))) throw forbidden('فقط برگزارکننده جلسه یا دبیر جلسات این کار را انجام می‌دهد');
  return m;
}

async function validateUsers(ctx: ModuleRequestContext, ids: string[]) {
  const wanted = [...new Set(ids)];
  if (wanted.length && (await ctx.directory(wanted)).length !== wanted.length) throw invalid('UNKNOWN_USER', 'یکی از افراد انتخاب‌شده عضو فعال سازمان نیست');
}

export const Meetings = {
  async list(ctx: ModuleRequestContext, f: z.infer<typeof listQuery>) {
    return ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT m.id, m.title, m.kind, m.starts_at, m.ends_at, m.location, m.status, m.organizer_id, m.projects_project_id, m.minutes_finalized_at,
          (SELECT count(*)::int FROM meetings_attendees a WHERE a.meeting_id = m.id) AS attendees,
          (SELECT count(*)::int FROM meetings_resolutions r WHERE r.meeting_id = m.id AND r.status = 'open') AS open_resolutions
        FROM meetings_meetings m WHERE m.deleted_at IS NULL AND ${visible(ctx, 'meetings.meeting.view')}
          ${f.from ? sql`AND m.starts_at >= ${zonedToUtc(f.from, '00:00', TZ)}` : sql``} ${f.to ? sql`AND m.starts_at < ${zonedToUtc(addDays(f.to, 1), '00:00', TZ)}` : sql``}
          ${f.projectId ? sql`AND m.projects_project_id = ${f.projectId}` : sql``}
        ORDER BY m.starts_at DESC LIMIT 300`),
    );
  },

  async get(ctx: ModuleRequestContext, id: string) {
    return ctx.db.transaction(async (tx) => {
      await load(tx, ctx, id);
      const meeting = await one(tx, sql`SELECT m.* FROM meetings_meetings m WHERE m.id = ${id}`);
      const [attendees, agenda, resolutions] = await Promise.all([
        rows(tx, sql`SELECT id, user_id, external_name, external_org, attendance FROM meetings_attendees WHERE meeting_id = ${id} ORDER BY external_name, id`),
        rows(tx, sql`SELECT id, sort, title, presenter_id FROM meetings_agenda_items WHERE meeting_id = ${id} ORDER BY sort`),
        rows(tx, sql`SELECT id, number, body, owner_id, due_on::text, status, done_on::text, follow_up FROM meetings_resolutions WHERE meeting_id = ${id} ORDER BY number`),
      ]);
      const canManage = !!(await one(tx, sql`SELECT 1 FROM meetings_meetings m WHERE m.id = ${id} AND ${manageable(ctx)}`)) && ctx.can('meetings.meeting.manage', 'own');
      const projects = ctx.services.get<{ get(id: string): Promise<{ id: string; code: string; title: string } | null> }>('projects.projects', '^1');
      const pid = (meeting as { projects_project_id: string | null }).projects_project_id;
      return { meeting, attendees, agenda, resolutions, canManage, project: pid && projects ? await projects.get(pid) : null };
    });
  },

  async save(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof meetingInput>) {
    await validateUsers(ctx, input.attendeeIds);
    const startsAt = zonedToUtc(input.date, input.startTime, TZ);
    const endsAt = zonedToUtc(input.date, input.endTime, TZ);
    const result = await ctx.db.transaction(async (tx) => {
      let invited: string[] = input.attendeeIds;
      let companyId = ctx.companyId;
      if (id) {
        const m = await load(tx, ctx, id, true);
        if (m.status !== 'scheduled') throw conflict('NOT_SCHEDULED', 'فقط جلسه برگزارنشده قابل ویرایش است');
        companyId = m.company_id;
        await tx.execute(sql`UPDATE meetings_meetings SET title = ${input.title}, kind = ${input.kind}, starts_at = ${startsAt}, ends_at = ${endsAt}, location = ${input.location},
          online_link = ${input.onlineLink}, projects_project_id = ${input.projectId}, updated_at = now() WHERE id = ${id}`);
        const before = (await rows<{ user_id: string }>(tx, sql`SELECT user_id FROM meetings_attendees WHERE meeting_id = ${id} AND user_id IS NOT NULL`)).map((r) => r.user_id);
        invited = input.attendeeIds.filter((u) => !before.includes(u));
        await tx.execute(sql`DELETE FROM meetings_attendees WHERE meeting_id = ${id}`);
        await tx.execute(sql`DELETE FROM meetings_agenda_items WHERE meeting_id = ${id}`);
      } else {
        id = randomUUID();
        await tx.execute(sql`INSERT INTO meetings_meetings (id, tenant_id, company_id, title, kind, starts_at, ends_at, location, online_link, projects_project_id, organizer_id, created_by)
          VALUES (${id}, ${ctx.tenantId}, ${companyId}, ${input.title}, ${input.kind}, ${startsAt}, ${endsAt}, ${input.location}, ${input.onlineLink}, ${input.projectId}, ${ctx.userId}, ${ctx.userId})`);
      }
      for (const u of new Set([ctx.userId, ...input.attendeeIds])) {
        await tx.execute(sql`INSERT INTO meetings_attendees (id, tenant_id, company_id, meeting_id, user_id) VALUES (${randomUUID()}, ${ctx.tenantId}, ${companyId}, ${id}, ${u}) ON CONFLICT DO NOTHING`);
      }
      for (const e of input.externalAttendees) {
        await tx.execute(sql`INSERT INTO meetings_attendees (id, tenant_id, company_id, meeting_id, external_name, external_org) VALUES (${randomUUID()}, ${ctx.tenantId}, ${companyId}, ${id}, ${e.name}, ${e.org})`);
      }
      let i = 0;
      for (const title of input.agenda) {
        await tx.execute(sql`INSERT INTO meetings_agenda_items (id, tenant_id, company_id, meeting_id, sort, title) VALUES (${randomUUID()}, ${ctx.tenantId}, ${companyId}, ${id}, ${++i}, ${title})`);
      }
      await ctx.audit({ action: 'meetings.meeting.saved', entityType: 'meeting', entityId: id, after: { title: input.title, startsAt } }, tx);
      return { id, invited: invited.filter((u) => u !== ctx.userId) };
    });
    if (result.invited.length) {
      await ctx.notify({ userIds: result.invited, type: 'meetings.invited', title: `دعوت به جلسه «${input.title}»`, body: `${input.date} ساعت ${input.startTime}`, link: `/app/meetings/${result.id}` });
    }
    return { id: result.id };
  },

  async cancel(ctx: ModuleRequestContext, id: string) {
    await ctx.db.transaction(async (tx) => {
      const m = await load(tx, ctx, id, true);
      if (m.status !== 'scheduled') throw conflict('NOT_SCHEDULED', 'جلسه برگزارشده قابل لغو نیست');
      await tx.execute(sql`UPDATE meetings_meetings SET status = 'cancelled', updated_at = now() WHERE id = ${id}`);
    });
  },

  /** Minutes and attendance; the meeting becomes "held". Finalised minutes are read-only. */
  async saveMinutes(ctx: ModuleRequestContext, id: string, input: z.infer<typeof minutesInput>, finalize: boolean) {
    await ctx.db.transaction(async (tx) => {
      const m = await load(tx, ctx, id, true);
      if (m.status === 'cancelled') throw conflict('CANCELLED', 'جلسه لغو شده است');
      if (m.minutes_finalized_at) throw conflict('FINALIZED', 'صورت‌جلسه نهایی شده و قابل تغییر نیست');
      await tx.execute(sql`UPDATE meetings_meetings SET minutes = ${input.minutes}, status = 'held', updated_at = now(),
        minutes_finalized_at = ${finalize ? sql`now()` : sql`NULL`}, minutes_finalized_by = ${finalize ? ctx.userId : null} WHERE id = ${id}`);
      for (const [attendeeId, attendance] of Object.entries(input.attendance)) {
        await tx.execute(sql`UPDATE meetings_attendees SET attendance = ${attendance} WHERE id = ${attendeeId} AND meeting_id = ${id}`);
      }
      if (finalize) await ctx.audit({ action: 'meetings.minutes.finalized', entityType: 'meeting', entityId: id }, tx);
    });
  },

  async addResolution(ctx: ModuleRequestContext, id: string, input: z.infer<typeof resolutionInput>) {
    await validateUsers(ctx, [input.ownerId]);
    const r = await ctx.db.transaction(async (tx) => {
      const m = await load(tx, ctx, id, true);
      if (m.status === 'cancelled') throw conflict('CANCELLED', 'جلسه لغو شده است');
      if (m.minutes_finalized_at) throw conflict('FINALIZED', 'صورت‌جلسه نهایی شده است؛ مصوبه جدید در جلسه بعد ثبت می‌شود');
      const n = await one<{ n: number }>(tx, sql`SELECT coalesce(max(number), 0)::int + 1 AS n FROM meetings_resolutions WHERE meeting_id = ${id}`);
      const rid = randomUUID();
      await tx.execute(sql`INSERT INTO meetings_resolutions (id, tenant_id, company_id, meeting_id, number, body, owner_id, due_on, created_by)
        VALUES (${rid}, ${ctx.tenantId}, ${m.company_id}, ${id}, ${n!.n}, ${input.body}, ${input.ownerId}, ${input.dueOn}, ${ctx.userId})`);
      await ctx.publish('meetings.resolution.created', { meetingId: id, resolutionId: rid, ownerId: input.ownerId, dueOn: input.dueOn }, tx);
      return { id: rid, number: n!.n, title: m.title };
    });
    await ctx.notify({ userIds: [input.ownerId], type: 'meetings.resolution.assigned', title: `مصوبه جدید جلسه «${r.title}» به شما سپرده شد`, body: input.body.slice(0, 200), link: `/app/meetings/${id}` });
    return { id: r.id, number: r.number };
  },

  /** Owner (own scope) or secretary (company scope) records follow-up, completion or cancellation. */
  async updateResolution(ctx: ModuleRequestContext, rid: string, input: z.infer<typeof resolutionUpdateInput>) {
    await ctx.db.transaction(async (tx) => {
      const own = ctx.can('meetings.resolution.update', 'company') ? sql`TRUE` : sql`r.owner_id = ${ctx.userId}`;
      const r = await rows(tx, sql`UPDATE meetings_resolutions r SET status = ${input.status}, done_on = ${input.status === 'done' ? input.doneOn : null}, follow_up = ${input.followUp}, updated_at = now()
        WHERE r.id = ${rid} AND ${own} RETURNING r.id`);
      if (!r.length) throw notFound('مصوبه');
      await ctx.audit({ action: 'meetings.resolution.updated', entityType: 'resolution', entityId: rid, after: input }, tx);
    });
  },

  async resolutions(ctx: ModuleRequestContext, f: z.infer<typeof resolutionQuery>, today: string) {
    return ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT r.id, r.number, r.body, r.owner_id, r.due_on::text, r.status, r.done_on::text, r.follow_up, m.id AS meeting_id, m.title AS meeting_title, m.starts_at
        FROM meetings_resolutions r JOIN meetings_meetings m ON m.id = r.meeting_id
        WHERE m.deleted_at IS NULL AND (${visible(ctx, 'meetings.meeting.view')} OR r.owner_id = ${ctx.userId})
          ${f.mine ? sql`AND r.owner_id = ${ctx.userId}` : sql``}
          ${f.status === 'overdue' ? sql`AND r.status = 'open' AND r.due_on < ${today}::date` : f.status ? sql`AND r.status = ${f.status}` : sql``}
        ORDER BY (r.status = 'open') DESC, r.due_on NULLS LAST, m.starts_at DESC LIMIT 500`),
    );
  },
};

// ---------------------------------------------------------------- tenant-wide: widgets, jobs, providers

export async function upcoming(ctx: ModuleRequestContext) {
  return ctx.db.transaction(async (tx) => ({
    items: await rows(tx, sql`SELECT m.id, m.title, m.starts_at, m.location FROM meetings_meetings m WHERE m.deleted_at IS NULL AND m.status = 'scheduled'
      AND m.starts_at >= now() AND m.starts_at < now() + interval '7 days'
      AND (m.organizer_id = ${ctx.userId} OR EXISTS (SELECT 1 FROM meetings_attendees x WHERE x.meeting_id = m.id AND x.user_id = ${ctx.userId})) ORDER BY m.starts_at LIMIT 8`),
  }));
}

export async function overdue(ctx: ModuleRequestContext, today: string) {
  return ctx.db.transaction(async (tx) => {
    const scope = ctx.can('meetings.meeting.view', 'company') ? sql`TRUE` : sql`r.owner_id = ${ctx.userId}`;
    const items = await rows(tx, sql`SELECT r.id, r.body, r.owner_id, r.due_on::text, m.id AS meeting_id FROM meetings_resolutions r JOIN meetings_meetings m ON m.id = r.meeting_id
      WHERE m.deleted_at IS NULL AND r.status = 'open' AND r.due_on < ${today}::date AND ${scope} ORDER BY r.due_on LIMIT 10`);
    const total = await one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM meetings_resolutions r JOIN meetings_meetings m ON m.id = r.meeting_id
      WHERE m.deleted_at IS NULL AND r.status = 'open' AND r.due_on < ${today}::date AND ${scope}`);
    return { total: total!.n, items };
  });
}

/** Reminds owners before a resolution's deadline and once when it becomes overdue. */
export async function resolutionReminders(ctx: ModuleEventContext, today: string) {
  const s = await ctx.settings<{ reminderDays: number }>();
  const due = await ctx.db.transaction(async (tx) => {
    const items = await rows<{ id: string; company_id: string; body: string; owner_id: string; due_on: string; meeting_id: string }>(tx, sql`SELECT r.id, r.company_id, r.body, r.owner_id, r.due_on::text, r.meeting_id
      FROM meetings_resolutions r JOIN meetings_meetings m ON m.id = r.meeting_id WHERE m.deleted_at IS NULL AND r.status = 'open' AND r.due_on IS NOT NULL AND r.due_on <= ${today}::date + ${s.reminderDays}::int`);
    const fresh = [];
    for (const r of items) {
      const kind = r.due_on < today ? 'overdue' : 'soon';
      const ins = await tx.execute(sql`INSERT INTO meetings_alerts (id, tenant_id, company_id, alert_key) VALUES (${randomUUID()}, ${ctx.tenantId}, ${r.company_id}, ${`resolution:${r.id}:${r.due_on}:${kind}`}) ON CONFLICT DO NOTHING RETURNING id`);
      if (ins.rows.length) fresh.push({ ...r, kind });
    }
    return fresh;
  });
  for (const r of due) {
    await ctx.notify({ userIds: [r.owner_id], type: 'meetings.resolution.reminder', title: r.kind === 'overdue' ? `مهلت مصوبه گذشته است: ${r.body.slice(0, 80)}` : `مهلت مصوبه نزدیک است: ${r.body.slice(0, 80)}`, link: `/app/meetings/${r.meeting_id}` });
  }
  return due.length;
}

export async function search(ctx: ModuleRequestContext, q: string, limit: number) {
  const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const r = await ctx.db.transaction((tx) => rows<{ id: string; title: string; starts_at: string }>(tx, sql`SELECT m.id, m.title, m.starts_at FROM meetings_meetings m
    WHERE m.deleted_at IS NULL AND ${visible(ctx, 'meetings.meeting.view')} AND m.title ILIKE ${like} ORDER BY m.starts_at DESC LIMIT ${limit}`));
  return r.map((x) => ({ entityType: 'meeting', entityId: x.id, title: x.title, link: `/app/meetings/${x.id}` }));
}

export function publicService(ctx: ModuleEventContext) {
  return {
    byProject: (projectId: string) =>
      ctx.db.transaction((tx) => rows(tx, sql`SELECT id, title, starts_at, status FROM meetings_meetings WHERE deleted_at IS NULL AND projects_project_id = ${projectId} ORDER BY starts_at DESC LIMIT 50`)),
  };
}

export async function overdueCount(ctx: ModuleEventContext, p: { companyId: string }, today: string) {
  const r = await ctx.db.transaction((tx) => one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM meetings_resolutions WHERE company_id = ${p.companyId} AND status = 'open' AND due_on < ${today}::date`));
  return r!.n;
}
