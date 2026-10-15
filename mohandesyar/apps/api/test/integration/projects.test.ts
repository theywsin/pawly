import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningKey } from '@mohandesyar/module-package';
import { addDays, todayIso, workingDayAt, workingDaysBetween } from '@mohandesyar/persian';
import { TestApp } from '../helpers/app.js';
import { buildModule } from '../helpers/packages.js';

/** projects (with contracts installed): CPM schedule, progress, project-scoped access, change requests, isolation. */
let t: TestApp;
let a: { token: string; tenantId: string };
let b: { token: string; tenantId: string };
let teamMember: { token: string; userId: string };
let outsider: { token: string; userId: string };
let approver: { token: string; userId: string };
const api = (p: string) => `/api/m/projects/v1/projects${p}`;
const today = todayIso();
const start = addDays(today, -10);
const cal = { weeklyOff: [5], holidays: new Set<string>() };
/** n-th working day of the project (Fridays and fixed official holidays off). */
const wd = (n: number) => workingDayAt(start, n, cal);
let projectId = '';
const act: Record<string, string> = {};

beforeAll(async () => {
  t = await TestApp.start();
  const admin = await t.consoleAdmin();
  const key = generateSigningKey();
  a = await t.signup('projects-a');
  b = await t.signup('projects-b');
  await t.installModules(admin, key.publicKeyPem, [await buildModule('contracts', key), await buildModule('projects', key)], [a.tenantId, b.tenantId]);
  teamMember = await t.member(a.token, 'project_team', 'team');
  outsider = await t.member(a.token, 'project_team', 'outsider');
  approver = await t.member(a.token, 'company_admin', 'approver');
}, 240_000);
afterAll(async () => t?.stop());

describe('projects', () => {
  it('creates a project; the manager joins the team; codes are unique', async () => {
    const r = await t.req('POST', api(''), { token: a.token, body: { code: 'PRJ-01', title: 'مجتمع مسکونی ۱۲۰ واحدی', employerName: 'تعاونی مسکن', plannedStart: start, plannedFinish: addDays(start, 59), status: 'active', budgetAmount: '50000000000' } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    projectId = r.body.id;
    expect((await t.req('POST', api(''), { token: a.token, body: { code: 'PRJ-01', title: 'تکراری' } })).status).toBe(409);
    const d = await t.req('GET', api(`/${projectId}`), { token: a.token });
    expect(d.body.members).toHaveLength(1);
    expect(d.body.members[0].role).toBe('manager');
  });

  it('builds a WBS and computes the critical path and planned dates', async () => {
    const add = async (name: string, durationDays: number, extra: object = {}) => {
      const r = await t.req('POST', api(`/${projectId}/activities`), { token: a.token, body: { name, durationDays, ...extra } });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.id as string;
    };
    act.civil = await add('عملیات ساختمانی', 0, { weight: 0 });
    act.excavation = await add('خاک‌برداری', 10, { parentId: act.civil, weight: 2 });
    act.foundation = await add('فونداسیون', 20, { parentId: act.civil, weight: 3 });
    act.structure = await add('اسکلت', 30, { parentId: act.civil, weight: 5 });
    act.permits = await add('اخذ مجوزها', 5, { weight: 0 });
    act.handover = await add('تحویل موقت', 0, { weight: 0 });
    const dep = (p: string, s: string, extra: object = {}) => t.req('POST', api(`/${projectId}/dependencies`), { token: a.token, body: { predecessorId: act[p], successorId: act[s], ...extra } });
    expect((await dep('excavation', 'foundation')).status).toBe(201);
    expect((await dep('foundation', 'structure', { type: 'SS', lagDays: 10 })).status).toBe(201);
    expect((await dep('structure', 'handover')).status).toBe(201);
    // Summary activities cannot carry dependencies; cycles are refused and nothing is saved.
    expect((await dep('civil', 'handover')).body.code).toBe('SUMMARY_DEPENDENCY');
    const cyc = await dep('structure', 'excavation');
    expect(cyc.status).toBe(400);
    expect(cyc.body.message).toContain('حلقه');

    const d = await t.req('GET', api(`/${projectId}`), { token: a.token });
    const byId = Object.fromEntries(d.body.activities.map((x: { id: string }) => [x.id, x]));
    expect(byId[act.excavation]).toMatchObject({ es: 0, ef: 10, critical: true, planned_start: wd(0), planned_finish: wd(9) });
    // Structure starts 10 days after the foundation starts (SS+10), so delaying the foundation delays everything: critical.
    expect(byId[act.foundation]).toMatchObject({ es: 10, ef: 30, critical: true, total_float: 0 });
    expect(byId[act.structure]).toMatchObject({ es: 20, ef: 50, critical: true });
    expect(byId[act.handover]).toMatchObject({ es: 50, ef: 50, planned_start: wd(50) });
    expect(byId[act.structure].planned_finish).toBe(wd(49));
    expect(byId[act.permits]).toMatchObject({ es: 0, total_float: 45, critical: false });
    expect(byId[act.civil]).toMatchObject({ es: 0, ef: 50, critical: true, leaf: false });
    expect(d.body.computedFinish).toBe(wd(49));
    expect(d.body.dependencies).toHaveLength(3);
  });

  it('a holiday added to the organisation calendar moves the schedule', async () => {
    const holiday = wd(3);
    expect((await t.req('POST', '/api/core/calendar/holidays', { token: a.token, body: { date: holiday, title: 'تعطیلی آزمایشی' } })).status).toBe(201);
    const d = await t.req('GET', api(`/${projectId}`), { token: a.token });
    const withHoliday = { ...cal, holidays: new Set([holiday]) };
    expect(d.body.activities.find((x: { id: string }) => x.id === act.excavation).planned_finish).toBe(workingDayAt(start, 9, withHoliday));
    expect(workingDayAt(start, 9, withHoliday) > wd(9)).toBe(true);
    const h = await t.req('GET', '/api/core/calendar', { token: a.token });
    await t.req('DELETE', `/api/core/calendar/holidays/${h.body.holidays[0].id}`, { token: a.token });
    const back = await t.req('GET', api(`/${projectId}`), { token: a.token });
    expect(back.body.activities.find((x: { id: string }) => x.id === act.excavation).planned_finish).toBe(wd(9));
    expect(h.body.weeklyOff).toEqual([5]);
    expect(h.body.fixed).toHaveLength(10);
  });

  it('records dated progress; weighted actual vs planned progress and the S-curve follow', async () => {
    const rec = (k: string, date: string, percent: number) => t.req('POST', api(`/${projectId}/activities/${act[k]}/progress`), { token: a.token, body: { date, percent } });
    expect((await rec('excavation', addDays(start, 5), 40)).status).toBe(200);
    expect((await rec('excavation', addDays(start, 9), 100)).status).toBe(200);
    expect((await rec('civil', today, 10)).body.code).toBe('SUMMARY_PROGRESS');
    const d = await t.req('GET', api(`/${projectId}`), { token: a.token });
    // Weights 2/3/5 (others 0): actual = 2·100 / 10 = 20%. Planned: linear over each activity's working days.
    expect(d.body.progress.actual).toBeCloseTo(20);
    const day = workingDaysBetween(start, today, cal) - 1;
    const frac = (es: number, dur: number) => Math.min(1, Math.max(0, (day - es + 1) / dur));
    expect(d.body.progress.planned).toBeCloseTo(((2 * frac(0, 10) + 3 * frac(10, 20) + 5 * frac(20, 30)) / 10) * 100);
    const ex = d.body.activities.find((x: { id: string }) => x.id === act.excavation);
    expect(ex).toMatchObject({ progress: '100.0000', actual_start: addDays(start, 5), actual_finish: addDays(start, 9) });
    expect(d.body.project.actual_start).toBe(addDays(start, 5));
    const c = await t.req('GET', api(`/${projectId}/curve`), { token: a.token });
    expect(c.body.points.at(0)).toMatchObject({ date: wd(0), actual: 0 });
    expect(c.body.points.at(-1).planned).toBeCloseTo(100);
    expect(c.body.points.at(-1).actual).toBeNull(); // future dates have no actual value
  });

  it('project scope: team members see only their projects and may record progress but not edit the schedule', async () => {
    expect((await t.req('GET', api(''), { token: teamMember.token })).body).toEqual([]);
    expect((await t.req('GET', api(`/${projectId}`), { token: teamMember.token })).status).toBe(404);
    expect((await t.req('POST', api(`/${projectId}/members`), { token: a.token, body: { userId: teamMember.userId, role: 'engineer' } })).status).toBe(200);
    const list = await t.req('GET', api(''), { token: teamMember.token });
    expect(list.body.map((p: { id: string }) => p.id)).toEqual([projectId]);
    const d = await t.req('GET', api(`/${projectId}`), { token: teamMember.token });
    expect(d.body.can).toEqual({ update: false, schedule: false, progress: true, change: true });
    expect((await t.req('POST', api(`/${projectId}/activities/${act.foundation}/progress`), { token: teamMember.token, body: { date: today, percent: 10 } })).status).toBe(200);
    expect((await t.req('POST', api(`/${projectId}/activities`), { token: teamMember.token, body: { name: 'x', durationDays: 1 } })).status).toBe(403);
    expect((await t.req('POST', api(''), { token: teamMember.token, body: { code: 'X', title: 'پروژه دیگر' } })).status).toBe(403);
    expect((await t.req('GET', api(''), { token: outsider.token })).body).toEqual([]);
    expect((await t.req('POST', api(`/${projectId}/issues`), { token: outsider.token, body: { kind: 'issue', title: 'نفوذ' } })).status).toBe(404);
  });

  it('issues notify their owner; risks and daily reports are recorded', async () => {
    const i = await t.req('POST', api(`/${projectId}/issues`), { token: a.token, body: { kind: 'obstacle', title: 'تأخیر در تحویل میلگرد', impactDays: 7, ownerId: teamMember.userId, dueOn: addDays(today, 3) } });
    expect(i.status, JSON.stringify(i.body)).toBe(201);
    const n = await t.req('GET', '/api/core/notifications', { token: teamMember.token });
    expect(n.body.items[0].title).toContain('تأخیر در تحویل میلگرد');
    expect((await t.req('POST', api(`/${projectId}/risks`), { token: a.token, body: { title: 'افزایش قیمت مصالح', probability: 4, impact: 5 } })).status).toBe(201);
    expect((await t.req('POST', api(`/${projectId}/daily-reports`), { token: teamMember.token, body: { reportDate: today, workforce: 23, workDone: 'بتن‌ریزی فونداسیون بلوک الف' } })).status).toBe(201);
    expect((await t.req('POST', api(`/${projectId}/daily-reports`), { token: teamMember.token, body: { reportDate: today, workDone: 'تکراری' } })).status).toBe(409);
    const w = await t.req('GET', '/api/core/widgets/projects/projects.issues', { token: a.token });
    expect(w.body.data).toMatchObject({ issues: 1, risks: 1 });
  });

  it('change requests go through approval', async () => {
    const c = await t.req('POST', api(`/${projectId}/change-requests`), { token: teamMember.token, body: { title: 'افزودن یک طبقه پارکینگ', costImpact: '3000000000', timeImpactDays: 45 } });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect((await t.req('POST', api(`/${projectId}/change-requests/${c.body.id}/submit`), { token: teamMember.token })).body.state).toBe('pending');
    const inbox = await t.req('GET', '/api/core/approvals', { token: approver.token });
    const item = inbox.body.find((x: { entity_id: string }) => x.entity_id === c.body.id);
    await t.req('POST', `/api/core/approvals/${item.id}/decide`, { token: approver.token, body: { decision: 'approve' } });
    while ((await t.services.events.dispatchOnce()) > 0);
    const d = await t.req('GET', api(`/${projectId}`), { token: a.token });
    expect(d.body.changes[0]).toMatchObject({ number: 1, status: 'approved' });
  });

  it('links to contracts through the public API: financial progress', async () => {
    const k = await t.req('POST', '/api/m/contracts/v1/contracts', { token: a.token, body: { code: 'K-1', title: 'قرارداد اجرا', kind: 'employer', direction: 'income', counterpartyName: 'تعاونی مسکن', initialAmount: '10000000000', projectId } });
    expect(k.status, JSON.stringify(k.body)).toBe(201);
    await t.req('POST', `/api/m/contracts/v1/contracts/${k.body.id}/activate`, { token: a.token, body: { signedOn: start } });
    const s = await t.req('POST', `/api/m/contracts/v1/contracts/${k.body.id}/statements`, { token: a.token, body: { periodTo: today, cumulativeGross: '2500000000' } });
    await t.req('POST', `/api/m/contracts/v1/contracts/${k.body.id}/statements/${s.body.id}/submit`, { token: a.token });
    const inbox = await t.req('GET', '/api/core/approvals', { token: approver.token });
    await t.req('POST', `/api/core/approvals/${inbox.body.find((x: { entity_id: string }) => x.entity_id === s.body.id).id}/decide`, { token: approver.token, body: { decision: 'approve' } });
    while ((await t.services.events.dispatchOnce()) > 0);
    const d = await t.req('GET', api(`/${projectId}`), { token: a.token });
    expect(d.body.progress.financial).toBeCloseTo(25);
    expect(d.body.linked.contracts.map((c: { code: string }) => c.code)).toEqual(['K-1']);
    const lookup = await t.req('GET', '/api/m/contracts/v1/lookups/projects?q=PRJ', { token: a.token });
    expect(lookup.body.map((x: { id: string }) => x.id)).toEqual([projectId]);
  });

  it('is isolated from another organisation and summarised for the dashboard', async () => {
    expect((await t.req('GET', api(`/${projectId}`), { token: b.token })).status).toBe(404);
    expect((await t.req('GET', '/api/m/contracts/v1/lookups/projects?q=', { token: b.token })).body).toEqual([]);
    const w = await t.req('GET', '/api/core/widgets/projects/projects.overview', { token: a.token });
    expect(w.body.data).toMatchObject({ total: 1, active: 1 });
    expect(w.body.data.items[0].code).toBe('PRJ-01');
  });

  it('refuses deleting a project with recorded progress', async () => {
    expect((await t.req('DELETE', api(`/${projectId}`), { token: a.token })).body.code).toBe('HAS_PROGRESS');
  });
});
