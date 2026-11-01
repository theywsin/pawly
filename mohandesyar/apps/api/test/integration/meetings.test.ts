import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningKey } from '@mohandesyar/module-package';
import { addDays, todayIso } from '@mohandesyar/persian';
import { TestApp } from '../helpers/app.js';
import { buildModule } from '../helpers/packages.js';

/** meetings: scheduling in Tehran time, invitations, minutes, resolutions, owners' follow-up, overdue report, own scope. */
let t: TestApp;
let a: { token: string; tenantId: string };
let b: { token: string; tenantId: string };
let engineer: { token: string; userId: string };
let other: { token: string; userId: string };
const api = (p: string) => `/api/m/meetings/v1${p}`;
const today = todayIso();
let meetingId = '';
let resolutionId = '';

beforeAll(async () => {
  t = await TestApp.start();
  const admin = await t.consoleAdmin();
  const key = generateSigningKey();
  a = await t.signup('meet-a');
  b = await t.signup('meet-b');
  await t.installModules(admin, key.publicKeyPem, [await buildModule('meetings', key)], [a.tenantId, b.tenantId]);
  engineer = await t.member(a.token, 'meeting_participant', 'eng');
  other = await t.member(a.token, 'meeting_participant', 'other');
}, 240_000);
afterAll(async () => t?.stop());

describe('meetings', () => {
  it('schedules a meeting in Tehran time and notifies invitees', async () => {
    const bad = await t.req('POST', api('/meetings'), { token: a.token, body: { title: 'جلسه', date: today, startTime: '11:00', endTime: '10:00' } });
    expect(bad.body.details?.[0]?.message).toBe('پایان جلسه باید بعد از شروع آن باشد');
    const r = await t.req('POST', api('/meetings'), {
      token: a.token,
      body: { title: 'جلسه هماهنگی کارگاه', kind: 'site', date: addDays(today, 1), startTime: '09:30', endTime: '11:00', location: 'دفتر کارگاه', attendeeIds: [engineer.userId],
        externalAttendees: [{ name: 'مهندس رضایی', org: 'دستگاه نظارت' }], agenda: ['گزارش پیشرفت', 'مشکلات تأمین مصالح'] },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    meetingId = r.body.id;
    const d = await t.req('GET', api(`/meetings/${meetingId}`), { token: a.token });
    expect(new Date(d.body.meeting.starts_at).toISOString()).toBe(new Date(`${addDays(today, 1)}T06:00:00Z`).toISOString()); // 09:30 Tehran = 06:00 UTC
    expect(d.body.attendees).toHaveLength(3); // organiser, engineer, external
    expect(d.body.agenda.map((x: { title: string }) => x.title)).toEqual(['گزارش پیشرفت', 'مشکلات تأمین مصالح']);
    const n = await t.req('GET', '/api/core/notifications', { token: engineer.token });
    expect(n.body.items[0].title).toBe('دعوت به جلسه «جلسه هماهنگی کارگاه»');
  });

  it('own scope: invitees see the meeting; others do not and cannot manage it', async () => {
    expect((await t.req('GET', api(`/meetings/${meetingId}`), { token: engineer.token })).body.canManage).toBe(false);
    expect((await t.req('GET', api(`/meetings/${meetingId}`), { token: other.token })).status).toBe(404);
    expect((await t.req('GET', api('/meetings'), { token: other.token })).body).toEqual([]);
    expect((await t.req('PUT', api(`/meetings/${meetingId}/minutes`), { token: engineer.token, body: { minutes: 'x' } })).status).toBe(403);
  });

  it('records minutes and attendance, resolutions with owners; finalised minutes are locked', async () => {
    const d = await t.req('GET', api(`/meetings/${meetingId}`), { token: a.token });
    const att = Object.fromEntries(d.body.attendees.map((x: { id: string; user_id: string | null }) => [x.id, x.user_id === engineer.userId ? 'present' : 'absent']));
    expect((await t.req('PUT', api(`/meetings/${meetingId}/minutes`), { token: a.token, body: { minutes: 'پیشرفت فونداسیون ۶۰ درصد گزارش شد.', attendance: att } })).status).toBe(200);
    const r1 = await t.req('POST', api(`/meetings/${meetingId}/resolutions`), { token: a.token, body: { body: 'سفارش میلگرد تا پایان هفته', ownerId: engineer.userId, dueOn: addDays(today, -1) } });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    resolutionId = r1.body.id;
    await t.req('POST', api(`/meetings/${meetingId}/resolutions`), { token: a.token, body: { body: 'ارسال گزارش هفتگی به کارفرما', ownerId: engineer.userId, dueOn: addDays(today, 5) } });
    expect((await t.req('PUT', api(`/meetings/${meetingId}/minutes?finalize=1`), { token: a.token, body: { minutes: 'پیشرفت فونداسیون ۶۰ درصد گزارش شد.' } })).status).toBe(200);
    expect((await t.req('PUT', api(`/meetings/${meetingId}/minutes`), { token: a.token, body: { minutes: 'تغییر' } })).body.code).toBe('FINALIZED');
    expect((await t.req('POST', api(`/meetings/${meetingId}/resolutions`), { token: a.token, body: { body: 'دیرهنگام', ownerId: engineer.userId } })).body.code).toBe('FINALIZED');
    const m = await t.req('GET', api(`/meetings/${meetingId}`), { token: a.token });
    expect(m.body.meeting.status).toBe('held');
    expect(m.body.attendees.find((x: { user_id: string }) => x.user_id === engineer.userId).attendance).toBe('present');
    const n = await t.req('GET', '/api/core/notifications', { token: engineer.token });
    expect(n.body.items.filter((x: { type: string }) => x.type === 'meetings.resolution.assigned')).toHaveLength(2);
  });

  it('overdue report and reminders; the owner records completion', async () => {
    const overdue = await t.req('GET', api('/resolutions?status=overdue'), { token: a.token });
    expect(overdue.body.map((x: { id: string }) => x.id)).toEqual([resolutionId]);
    const w = await t.req('GET', '/api/core/widgets/meetings/meetings.overdue', { token: engineer.token });
    expect(w.body.data.total).toBe(1);
    const now = Date.now();
    await t.services.scheduler.tick(now);
    await t.services.scheduler.tick(now + 400 * 60_000);
    const n = await t.req('GET', '/api/core/notifications', { token: engineer.token });
    expect(n.body.items.filter((x: { type: string }) => x.type === 'meetings.resolution.reminder').map((x: { title: string }) => x.title)).toEqual(['مهلت مصوبه گذشته است: سفارش میلگرد تا پایان هفته']);
    expect((await t.req('PUT', api(`/resolutions/${resolutionId}`), { token: other.token, body: { status: 'done', doneOn: today } })).status).toBe(404);
    expect((await t.req('PUT', api(`/resolutions/${resolutionId}`), { token: engineer.token, body: { status: 'done' } })).status).toBe(400);
    expect((await t.req('PUT', api(`/resolutions/${resolutionId}`), { token: engineer.token, body: { status: 'done', doneOn: today, followUp: 'سفارش ثبت شد' } })).status).toBe(200);
    expect((await t.req('GET', api('/resolutions?status=overdue'), { token: a.token })).body).toEqual([]);
    const mine = await t.req('GET', api('/resolutions?mine=1'), { token: engineer.token });
    expect(mine.body).toHaveLength(2);
  });

  it('is isolated between organisations', async () => {
    expect((await t.req('GET', api(`/meetings/${meetingId}`), { token: b.token })).status).toBe(404);
    expect((await t.req('GET', api('/resolutions'), { token: b.token })).body).toEqual([]);
  });
});
