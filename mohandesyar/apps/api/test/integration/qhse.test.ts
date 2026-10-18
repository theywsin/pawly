import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningKey } from '@mohandesyar/module-package';
import { addDays, todayIso } from '@mohandesyar/persian';
import { TestApp } from '../helpers/app.js';
import { buildModule } from '../helpers/packages.js';

/**
 * qhse (with projects): incident reporting in project scope with urgent notification, investigation and
 * closing rules, man-hours and frequency rates, risk ratings, checklist inspections raising a
 * non-conformance, corrective actions done by the owner and verified by someone else (also a DB
 * constraint), status report, widget, tenant isolation.
 */
let t: TestApp;
let a: { token: string; tenantId: string };
let b: { token: string; tenantId: string };
let hse: { token: string; userId: string };
let officer: { token: string; userId: string };
let worker: { token: string; userId: string };
const api = (p: string) => `/api/m/qhse/v1${p}`;
const papi = (p: string) => `/api/m/projects/v1/projects${p}`;
const today = todayIso();
let p1 = '';
let p2 = '';
let incidentId = '';
let ncrId = '';
let actionId = '';
let companyIds: string[] = [];

beforeAll(async () => {
  t = await TestApp.start();
  const admin = await t.consoleAdmin();
  const key = generateSigningKey();
  a = await t.signup('qhse-a');
  b = await t.signup('qhse-b');
  await t.installModules(admin, key.publicKeyPem, [await buildModule('projects', key), await buildModule('qhse', key)], [a.tenantId, b.tenantId]);
  hse = await t.member(a.token, 'hse_manager', 'hse');
  officer = await t.member(a.token, 'site_hse_officer', 'officer');
  worker = await t.member(a.token, 'incident_reporter', 'worker');
  companyIds = (await t.req('GET', '/api/core/me', { token: a.token })).body.company.ids;
  p1 = (await t.req('POST', papi(''), { token: a.token, body: { code: 'P-1', title: 'تونل', status: 'active' } })).body.id;
  p2 = (await t.req('POST', papi(''), { token: a.token, body: { code: 'P-2', title: 'سد', status: 'active' } })).body.id;
  for (const u of [officer, worker]) await t.req('POST', papi(`/${p1}/members`), { token: a.token, body: { userId: u.userId, role: 'engineer' } });
  await t.req('PUT', api('/settings'), { token: hse.token, body: { urgentRecipients: [hse.userId] } });
}, 240_000);
afterAll(async () => t?.stop());

describe('qhse', () => {
  it('lets a site worker report incidents in their own projects and alerts the HSE manager at once for serious ones', async () => {
    const body = { kind: 'injury', severity: 'high', occurredOn: addDays(today, -3), occurredTime: '10:30', location: 'دهانه تونل', title: 'سقوط از داربست', injuredCount: 1, lostDays: 4, immediateAction: 'انتقال به درمانگاه' };
    expect((await t.req('POST', api('/incidents'), { token: worker.token, body: { ...body, projectId: p2 } })).status).toBe(403);
    expect((await t.req('POST', api('/incidents'), { token: worker.token, body: { ...body, occurredTime: '25:00', projectId: p1 } })).status).toBe(400);
    const r = await t.req('POST', api('/incidents'), { token: worker.token, body: { ...body, projectId: p1 } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ number: 1, notified: 1 });
    incidentId = r.body.id;
    const notes = (await t.req('GET', '/api/core/notifications', { token: hse.token })).body.items;
    expect(notes.find((n: { type: string }) => n.type === 'qhse.incident.urgent').title).toContain('فوری');
    // A near miss is reported but does not alert.
    expect((await t.req('POST', api('/incidents'), { token: worker.token, body: { kind: 'near_miss', severity: 'low', occurredOn: today, title: 'افتادن ابزار از ارتفاع', projectId: p1 } })).body.notified).toBe(0);
    // The worker sees only what they reported; the officer sees the project; another project is hidden.
    expect((await t.req('GET', api('/incidents'), { token: worker.token })).body).toHaveLength(2);
    expect((await t.req('GET', api('/risks'), { token: worker.token })).status).toBe(403);
    await t.req('POST', api('/incidents'), { token: hse.token, body: { kind: 'property_damage', severity: 'medium', occurredOn: today, title: 'آسیب به بیل مکانیکی', projectId: p2 } });
    expect((await t.req('GET', api('/incidents'), { token: officer.token })).body).toHaveLength(2);
    expect((await t.req('GET', api('/incidents'), { token: hse.token })).body).toHaveLength(3);
  });

  it('records man-hours and computes frequency rates in the status report', async () => {
    expect((await t.req('PUT', api('/manhours'), { token: officer.token, body: { projectId: p2, month: today.slice(0, 7), hours: 1 } })).status).toBe(403);
    expect((await t.req('PUT', api('/manhours'), { token: officer.token, body: { projectId: p1, month: today.slice(0, 7), hours: 300000, headcount: 120 } })).status).toBe(200);
    await t.req('PUT', api('/manhours'), { token: officer.token, body: { projectId: p1, month: today.slice(0, 7), hours: 400000, headcount: 150 } }); // upsert
    const from = `${addDays(today, -40).slice(0, 7)}-01`;
    const r = (await t.req('GET', api(`/report?from=${from}&to=${today}&projectId=${p1}`), { token: hse.token })).body;
    expect(r).toMatchObject({ manhours: 400000, lti: 1, lostDays: 4, injured: 1, rates: { ltifr: 2.5, trifr: 2.5, severityRate: 10 } });
    expect(r.byKind.find((x: { kind: string }) => x.kind === 'near_miss').n).toBe(1);
  });

  it('rates risks inherently and residually', async () => {
    expect((await t.req('POST', api('/risks'), { token: officer.token, body: { projectId: p1, activity: 'حفاری', hazard: 'ریزش دیواره', likelihood: 4, severity: 5, residualLikelihood: 2 } })).status).toBe(400);
    const r = await t.req('POST', api('/risks'), { token: officer.token, body: { projectId: p1, activity: 'حفاری', hazard: 'ریزش دیواره', likelihood: 4, severity: 5, controls: 'شمع‌بندی', residualLikelihood: 2, residualSeverity: 5 } });
    expect(r.status).toBe(201);
    const list = (await t.req('GET', api('/risks'), { token: officer.token })).body;
    expect(list[0]).toMatchObject({ rating: { score: 20, band: 'high' }, residual: { score: 10, band: 'medium' } });
  });

  it('inspects with a checklist and raises a non-conformance for the failed items', async () => {
    expect((await t.req('POST', api('/checklists'), { token: officer.token, body: { name: 'داربست', items: ['x'] } })).status).toBe(403);
    const c = (await t.req('POST', api('/checklists'), { token: hse.token, body: { name: 'بازرسی داربست', items: ['پایه‌ها روی صفحه زیرسری', 'نرده محافظ نصب است', 'برچسب بازرسی معتبر است'] } })).body.id;
    expect((await t.req('POST', api('/inspections'), { token: officer.token, body: { checklistId: c, projectId: p1, inspectedOn: today, results: [{ result: 'ok' }] } })).body.code).toBe('RESULTS');
    const i = await t.req('POST', api('/inspections'), { token: officer.token, body: { checklistId: c, projectId: p1, inspectedOn: today, raiseNcr: true,
      results: [{ result: 'ok' }, { result: 'nok', note: 'ضلع شمالی' }, { result: 'na' }] } });
    expect(i.status, JSON.stringify(i.body)).toBe(201);
    expect(i.body.score).toBe(50);
    ncrId = i.body.ncrId;
    const n = (await t.req('GET', api(`/ncrs/${ncrId}`), { token: officer.token })).body.ncr;
    expect(n).toMatchObject({ source: 'inspection', status: 'open', description: '- نرده محافظ نصب است: ضلع شمالی' });
  });

  it('separates doing a corrective action from verifying it', async () => {
    expect((await t.req('POST', api(`/ncrs/${ncrId}/close`), { token: hse.token })).body.code).toBe('NO_ACTIONS');
    const r = await t.req('POST', api('/actions'), { token: hse.token, body: { kind: 'corrective', ncrId, title: 'نصب نرده محافظ ضلع شمالی', ownerId: officer.userId, dueOn: addDays(today, -1) } });
    expect(r.status).toBe(201);
    actionId = r.body.id;
    expect((await t.req('GET', api('/actions?status=overdue'), { token: officer.token })).body.map((x: { id: string }) => x.id)).toEqual([actionId]);
    expect(await t.services.scheduler.tick(Date.now())).toBeGreaterThanOrEqual(1);
    expect((await t.req('GET', '/api/core/notifications', { token: officer.token })).body.items.some((n: { type: string }) => n.type === 'qhse.action.overdue')).toBe(true);
    expect((await t.req('POST', api(`/actions/${actionId}/done`), { token: hse.token, body: { note: 'انجام شد' } })).status).toBe(403);
    expect((await t.req('POST', api(`/actions/${actionId}/done`), { token: officer.token, body: { note: 'نرده نصب و عکس پیوست شد' } })).status).toBe(200);
    expect((await t.req('POST', api(`/actions/${actionId}/verify`), { token: officer.token, body: { accept: true } })).status).toBe(403);
    expect((await t.req('POST', api(`/ncrs/${ncrId}/close`), { token: hse.token })).body.code).toBe('UNVERIFIED');
    // The database refuses an owner-verifier even if the application check were bypassed.
    await expect(t.services.db.tx({ tenantId: a.tenantId, companyIds }, (x) => x.execute(sql`UPDATE qhse_actions SET verified_by = owner_id WHERE id = ${actionId}`))).rejects.toThrow();
    expect((await t.req('POST', api(`/actions/${actionId}/verify`), { token: hse.token, body: { accept: true } })).status).toBe(200);
    expect((await t.req('POST', api(`/ncrs/${ncrId}/close`), { token: hse.token })).status).toBe(200);
  });

  it('closes an incident only with a root cause and no open actions', async () => {
    await t.req('POST', api('/actions'), { token: hse.token, body: { kind: 'preventive', incidentId, title: 'آموزش کار در ارتفاع', ownerId: officer.userId, dueOn: addDays(today, 7) } });
    expect((await t.req('POST', api(`/incidents/${incidentId}/investigation`), { token: hse.token, body: { status: 'closed', rootCause: 'کوتاه' } })).status).toBe(400);
    expect((await t.req('POST', api(`/incidents/${incidentId}/investigation`), { token: hse.token, body: { status: 'closed', rootCause: 'نبود نرده محافظ و کمربند ایمنی' } })).body.code).toBe('OPEN_ACTIONS');
    expect((await t.req('POST', api(`/incidents/${incidentId}/investigation`), { token: worker.token, body: { status: 'investigating' } })).status).toBe(403);
    expect((await t.req('POST', api(`/incidents/${incidentId}/investigation`), { token: hse.token, body: { status: 'investigating', rootCause: 'در حال بررسی' } })).status).toBe(200);
  });

  it('records training attendance and PPE issues', async () => {
    expect((await t.req('POST', api('/trainings'), { token: officer.token, body: { title: 'کار در ارتفاع', heldOn: today, hours: 4, projectId: p1, attendees: [] } })).status).toBe(400);
    expect((await t.req('POST', api('/trainings'), { token: officer.token, body: { title: 'کار در ارتفاع', heldOn: today, hours: 4, projectId: p1, attendees: [{ userId: worker.userId, name: 'کارگر' }, { name: 'حسن پیمانکار' }] } })).status).toBe(201);
    expect((await t.req('GET', api('/trainings'), { token: officer.token })).body[0].attendees).toHaveLength(2);
    expect((await t.req('POST', api('/ppe'), { token: officer.token, body: { personName: 'حسن پیمانکار', item: 'کلاه ایمنی', issuedOn: today, replaceOn: addDays(today, -1), projectId: p1 } })).status).toBe(400);
    expect((await t.req('POST', api('/ppe'), { token: officer.token, body: { personName: 'حسن پیمانکار', item: 'کلاه ایمنی', issuedOn: addDays(today, -400), replaceOn: today, projectId: p1 } })).status).toBe(201);
    expect((await t.req('GET', api('/ppe'), { token: officer.token })).body[0].replace_due).toBe(true);
  });

  it('feeds the status widget and isolates tenants', async () => {
    const w = (await t.req('GET', '/api/core/widgets/qhse/qhse.status', { token: hse.token })).body.data;
    expect(w).toMatchObject({ daysSinceLti: 3, open_ncrs: 0 });
    expect((await t.req('GET', api('/incidents'), { token: b.token })).body).toEqual([]);
    expect((await t.req('GET', api(`/incidents/${incidentId}`), { token: b.token })).status).toBe(404);
  });
});
