import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningKey } from '@mohandesyar/module-package';
import { addDays, todayIso } from '@mohandesyar/persian';
import { TestApp } from '../helpers/app.js';
import { buildModule } from '../helpers/packages.js';

/**
 * taskboard: recurring duties generated per day (idempotent), assigned tasks with due time, check-off by the
 * assignee, manager review with score, attendance with lateness, daily report with score, scorecard and KPI
 * providers through the kpi module, permission and tenant isolation.
 */
let t: TestApp;
let a: { token: string; tenantId: string };
let b: { token: string; tenantId: string };
let emp: { token: string; userId: string };
let emp2: { token: string; userId: string };
const api = (p: string) => `/api/m/taskboard/v1${p}`;
const today = todayIso();
let taskId = '';
let dutyId = '';

beforeAll(async () => {
  t = await TestApp.start();
  const admin = await t.consoleAdmin();
  const key = generateSigningKey();
  a = await t.signup('tb-a');
  b = await t.signup('tb-b');
  await t.installModules(admin, key.publicKeyPem, [await buildModule('taskboard', key), await buildModule('kpi', key)], [a.tenantId, b.tenantId]);
  emp = await t.member(a.token, 'employee', 'emp');
  emp2 = await t.member(a.token, 'employee', 'emp2');
}, 240_000);
afterAll(async () => t?.stop());

describe('taskboard', () => {
  it('a recurring duty shows up today for the employee, once', async () => {
    const bad = await t.req('POST', api('/duties'), { token: a.token, body: { title: 'حضور', assigneeId: emp.userId, recurrence: 'weekly', dueTime: '08:00' } });
    expect(bad.body.details?.[0]?.message).toBe('روزهای هفته را انتخاب کنید');
    const r = await t.req('POST', api('/duties'), { token: a.token, body: { title: 'بازدید روزانه کارگاه', assigneeId: emp.userId, recurrence: 'daily', dueTime: '09:00', skipDaysOff: false } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    dutyId = r.body.id;
    await t.services.scheduler.tick(Date.now());
    const d = await t.req('GET', api('/me/today'), { token: emp.token });
    const duty = d.body.tasks.filter((x: { duty_id: string }) => x.duty_id === dutyId);
    expect(duty).toHaveLength(1);
    expect(new Date(duty[0].due_at).toISOString()).toBe(new Date(`${today}T05:30:00Z`).toISOString()); // 09:00 Tehran
    expect((await t.req('GET', api('/me/today'), { token: emp2.token })).body.tasks).toEqual([]);
  });

  it('only managers assign tasks; one task per assignee with a notification', async () => {
    const body = { title: 'تهیه صورت‌وضعیت', assigneeIds: [emp.userId, emp2.userId], dueDate: today, dueTime: '23:59', priority: 'high' };
    expect((await t.req('POST', api('/tasks'), { token: emp.token, body })).status).toBe(403);
    expect((await t.req('GET', api('/tasks?scope=team'), { token: emp.token })).status).toBe(403);
    const r = await t.req('POST', api('/tasks'), { token: a.token, body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.ids).toHaveLength(2);
    const mine = (await t.req('GET', api('/tasks'), { token: emp.token })).body as { id: string; title: string; assignee_id: string }[];
    taskId = mine.find((x) => x.title === 'تهیه صورت‌وضعیت')!.id;
    expect(mine.every((x) => x.assignee_id === emp.userId)).toBe(true);
    const n = await t.req('GET', '/api/core/notifications', { token: emp.token });
    expect(n.body.items.some((x: { title: string }) => x.title === 'کار جدید: تهیه صورت‌وضعیت')).toBe(true);
  });

  it('the assignee ticks the task; the manager reviews and scores it', async () => {
    expect((await t.req('POST', api(`/tasks/${taskId}/done`), { token: emp2.token, body: {} })).status).toBe(403);
    expect((await t.req('POST', api(`/tasks/${taskId}/done`), { token: emp.token, body: { note: 'ارسال شد' } })).status).toBe(200);
    expect((await t.req('POST', api(`/tasks/${taskId}/done`), { token: emp.token, body: {} })).body.code).toBe('TASK_STATE');
    expect((await t.req('POST', api(`/tasks/${taskId}/review`), { token: emp.token, body: { decision: 'approve', score: 5 } })).status).toBe(403);
    expect((await t.req('POST', api(`/tasks/${taskId}/review`), { token: a.token, body: { decision: 'approve' } })).body.code).toBe('VALIDATION_FAILED');
    expect((await t.req('POST', api(`/tasks/${taskId}/review`), { token: a.token, body: { decision: 'return', note: 'جدول پیوست ناقص است' } })).status).toBe(200);
    expect((await t.req('POST', api(`/tasks/${taskId}/done`), { token: emp.token, body: {} })).status).toBe(200);
    const rv = await t.req('POST', api(`/tasks/${taskId}/review`), { token: a.token, body: { decision: 'approve', score: 4, note: 'خوب' } });
    expect(rv.status, JSON.stringify(rv.body)).toBe(200);
    expect((await t.req('POST', api(`/tasks/${taskId}/undo`), { token: emp.token })).body.code).toBe('TASK_STATE');
    const review = (await t.req('GET', api('/tasks?scope=team&status=closed'), { token: a.token })).body as { id: string; status: string; score: number }[];
    expect(review.find((x) => x.id === taskId)).toMatchObject({ status: 'approved', score: 4 });
  });

  it('records attendance once per day with check-out after check-in', async () => {
    expect((await t.req('POST', api('/attendance/check-out'), { token: emp.token })).body.code).toBe('NOT_CHECKED_IN');
    const c = await t.req('POST', api('/attendance/check-in'), { token: emp.token, body: {} });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.lateMinutes).toBeGreaterThanOrEqual(0);
    expect((await t.req('POST', api('/attendance/check-in'), { token: emp.token, body: {} })).body.code).toBe('ALREADY_CHECKED_IN');
    await new Promise((r) => setTimeout(r, 20));
    expect((await t.req('POST', api('/attendance/check-out'), { token: emp.token })).status).toBe(200);
    expect((await t.req('POST', api('/attendance/check-out'), { token: emp.token })).body.code).toBe('ALREADY_CHECKED_OUT');
    const own = await t.req('GET', api(`/attendance?from=${today}&to=${today}&userId=${emp2.userId}`), { token: emp.token });
    expect(own.body.map((x: { user_id: string }) => x.user_id)).toEqual([emp.userId]); // own scope ignores userId
    expect((await t.req('GET', api(`/attendance?from=${today}&to=${today}`), { token: a.token })).body).toHaveLength(1);
  });

  it('daily report: editable until scored; nobody scores their own', async () => {
    expect((await t.req('PUT', api('/reports/today'), { token: emp.token, body: { body: 'کم' } })).body.code).toBe('VALIDATION_FAILED');
    const r = await t.req('PUT', api('/reports/today'), { token: emp.token, body: { body: 'بازدید کارگاه و تهیه صورت‌وضعیت', hours: 7.5 } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await t.req('PUT', api('/reports/today'), { token: emp.token, body: { body: 'بازدید کارگاه، صورت‌وضعیت و جلسه', hours: 8 } })).body.id).toBe(r.body.id);
    expect((await t.req('POST', api(`/reports/${r.body.id}/score`), { token: emp2.token, body: { score: 5 } })).status).toBe(403);
    expect((await t.req('POST', api(`/reports/${r.body.id}/score`), { token: a.token, body: { score: 3 } })).status).toBe(200);
    expect((await t.req('PUT', api('/reports/today'), { token: emp.token, body: { body: 'تغییر بعد از نمره' } })).body.code).toBe('REPORT_SCORED');
    const own = await t.req('PUT', api('/reports/today'), { token: a.token, body: { body: 'گزارش مدیر امروز' } });
    expect((await t.req('POST', api(`/reports/${own.body.id}/score`), { token: a.token, body: { score: 5 } })).status).toBe(403);
  });

  it('notifies overdue tasks once and does not duplicate duty tasks on the next run', async () => {
    await t.req('POST', api('/tasks'), { token: a.token, body: { title: 'ارسال نامه پیمانکار', assigneeIds: [emp2.userId], dueDate: addDays(today, -1), dueTime: '10:00' } });
    const now = Date.now();
    await t.services.scheduler.tick(now + 31 * 60_000);
    await t.services.scheduler.tick(now + 62 * 60_000);
    const n = (await t.req('GET', '/api/core/notifications', { token: emp2.token })).body.items as { title: string }[];
    expect(n.filter((x) => x.title === 'مهلت کار گذشت: ارسال نامه پیمانکار')).toHaveLength(1);
    const d = await t.req('GET', api('/me/today'), { token: emp.token });
    expect(d.body.tasks.filter((x: { duty_id: string }) => x.duty_id === dutyId)).toHaveLength(1);
  });

  it('scorecard and KPI providers give per-person figures', async () => {
    const own = (await t.req('GET', api(`/scorecard?from=${today}&to=${today}`), { token: emp.token })).body;
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ userId: emp.userId, tasks: 1, onTime: 1, onTimeRate: 100, averageScore: 70, reports: 1 }); // task 4/5 + report 3/5 → 3.5 → 70
    const team = (await t.req('GET', api(`/scorecard?from=${addDays(today, -1)}&to=${today}`), { token: a.token })).body as { userId: string; missed: number }[];
    expect(team.find((x) => x.userId === emp2.userId)!.missed).toBe(1);

    const kpi = (p: string) => `/api/m/kpi/v1${p}`;
    const providers = (await t.req('GET', kpi('/providers'), { token: a.token })).body as { key: string }[];
    expect(providers.map((p) => p.key).filter((k) => k.startsWith('taskboard.')).sort()).toEqual(['taskboard.attendance_rate', 'taskboard.average_score', 'taskboard.on_time_rate', 'taskboard.performance']);
    const def = await t.req('POST', kpi('/definitions'), { token: a.token, body: { code: 'ontime', name: 'انجام در مهلت', level: 'person', direction: 'higher', frequency: 'monthly', source: 'provider', providerKey: 'taskboard.on_time_rate', unit: 'percent' } });
    expect(def.status, JSON.stringify(def.body)).toBe(201);
    const c = await t.req('POST', kpi(`/definitions/${def.body.id}/compute`), { token: a.token, body: { period: '1405-07', subjectType: 'person', subjectId: emp.userId, subjectName: 'emp' } });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body.value).toBe(100);
  });

  it('keeps tenants apart', async () => {
    expect((await t.req('GET', api('/tasks?scope=team'), { token: b.token })).body).toEqual([]);
    expect((await t.req('POST', api(`/tasks/${taskId}/cancel`), { token: b.token })).status).toBe(404);
    expect((await t.req('GET', api('/duties'), { token: b.token })).body).toEqual([]);
  });
});
