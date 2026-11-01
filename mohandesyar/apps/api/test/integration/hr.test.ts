import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningKey } from '@mohandesyar/module-package';
import { addDays, todayIso } from '@mohandesyar/persian';
import { TestApp } from '../helpers/app.js';
import { buildModule } from '../helpers/packages.js';

/**
 * hr: employee files (unique personnel no / national ID), confidential contracts, own-scope self service,
 * leave on working days with balance and approval workflow (approve, withdraw), reviews visible to the
 * employee only when final, field-by-field transfer from recruitment, contract alerts, isolation.
 */
let t: TestApp;
let a: { token: string; tenantId: string };
let b: { token: string; tenantId: string };
let hrm: { token: string; userId: string };
let emp: { token: string; userId: string };
let other: { token: string; userId: string };
const api = (p: string) => `/api/m/hr/v1${p}`;
const today = todayIso();
let empId = '';
let otherId = '';
let annualType = '';
let leaveId = '';

const drain = async () => {
  while ((await t.services.events.dispatchOnce()) > 0);
};

beforeAll(async () => {
  t = await TestApp.start();
  const admin = await t.consoleAdmin();
  const key = generateSigningKey();
  a = await t.signup('hr-a');
  b = await t.signup('hr-b');
  await t.installModules(admin, key.publicKeyPem, [await buildModule('recruitment', key), await buildModule('hr', key)], [a.tenantId, b.tenantId]);
  hrm = await t.member(a.token, 'hr_manager', 'hrm');
  emp = await t.member(a.token, 'hr_self_service', 'emp');
  other = await t.member(a.token, 'hr_self_service', 'other');
}, 240_000);
afterAll(async () => t?.stop());

describe('hr', () => {
  it('creates employee files with unique personnel numbers and valid national IDs', async () => {
    const body = { personnelNo: '۱۰۰۱', fullName: 'مریم احمدی', nationalId: '0013542419', mobile: '09121234567', department: 'فنی', position: 'کارشناس سازه', hiredOn: '2024-03-20', userId: emp.userId, managerUserId: hrm.userId };
    const r = await t.req('POST', api('/employees'), { token: hrm.token, body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    empId = r.body.id;
    expect((await t.req('POST', api('/employees'), { token: hrm.token, body: { ...body, nationalId: '', userId: null } })).body.code).toBe('PERSONNEL_NO_TAKEN');
    expect((await t.req('POST', api('/employees'), { token: hrm.token, body: { ...body, personnelNo: '1002', userId: null } })).body.code).toBe('NATIONAL_ID_TAKEN');
    expect((await t.req('POST', api('/employees'), { token: hrm.token, body: { ...body, personnelNo: '1002', nationalId: '0013542418', userId: null } })).status).toBe(400);
    expect((await t.req('POST', api('/employees'), { token: hrm.token, body: { ...body, personnelNo: '1002', nationalId: '', userId: emp.userId } })).body.code).toBe('USER_LINKED');
    otherId = (await t.req('POST', api('/employees'), { token: hrm.token, body: { personnelNo: '1002', fullName: 'رضا کریمی', hiredOn: '2023-01-01', userId: other.userId } })).body.id;
    const d = (await t.req('GET', api(`/employees/${empId}`), { token: hrm.token })).body;
    expect(d.employee).toMatchObject({ personnel_no: '1001', national_id: '0013542419' });
    expect(d.records[0]).toMatchObject({ kind: 'hire', title: 'شروع همکاری — کارشناس سازه' });
  });

  it('keeps contracts confidential and audited; employees see only their own file', async () => {
    const c = await t.req('POST', api(`/employees/${empId}/contracts`), { token: hrm.token, body: { kind: 'fixed_term', startsOn: '2024-03-20', endsOn: addDays(today, 10), monthlySalary: 350_000_000, weeklyHours: 44 } });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect((await t.req('POST', api(`/employees/${empId}/contracts`), { token: hrm.token, body: { kind: 'permanent', startsOn: today } })).body.code).toBe('CONTRACT_OVERLAP');
    expect((await t.req('GET', api(`/employees/${empId}`), { token: hrm.token })).body.contracts[0].monthly_salary).toBe('350000000');
    const audit = JSON.stringify((await t.req('GET', '/api/core/audit', { token: a.token })).body);
    expect(audit).toContain('hr.contract.viewed');
    // Self service: own file without contracts; nobody else's.
    expect((await t.req('GET', api('/employees/me'), { token: emp.token })).body.id).toBe(empId);
    const own = (await t.req('GET', api(`/employees/${empId}`), { token: emp.token })).body;
    expect(own.contracts).toBeNull();
    expect(JSON.stringify(own)).not.toContain('350000000');
    expect(own.self).toBe(true);
    expect((await t.req('GET', api(`/employees/${otherId}`), { token: emp.token })).status).toBe(404);
    expect(((await t.req('GET', api('/employees'), { token: emp.token })).body as { id: string }[]).map((x) => x.id)).toEqual([empId]);
    expect((await t.req('POST', api(`/employees/${empId}/contracts`), { token: emp.token, body: { kind: 'permanent', startsOn: today } })).status).toBe(403);
    expect((await t.req('PUT', api(`/employees/${empId}/skills`), { token: emp.token, body: { skills: [] } })).status).toBe(403);
  });

  it('counts leave in working days and enforces balance and overlap', async () => {
    const types = (await t.req('GET', api('/leave/types'), { token: emp.token })).body as { id: string; name: string; annual_days: number | null }[];
    expect(types.map((x) => [x.name, x.annual_days])).toEqual([['استحقاقی', 26], ['استعلاجی', null], ['بدون حقوق', null]]);
    annualType = types[0]!.id;
    // Sat 7 Nov … Fri 13 Nov 2026 (16–22 Aban 1405, no official holiday): Friday is the weekly day off.
    const r = await t.req('POST', api('/leave'), { token: emp.token, body: { typeId: annualType, startsOn: '2026-11-07', endsOn: '2026-11-13', reason: 'سفر خانوادگی' } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ days: 6, state: 'pending' });
    leaveId = r.body.id;
    expect((await t.req('POST', api('/leave'), { token: emp.token, body: { typeId: annualType, startsOn: '2026-11-10', endsOn: '2026-11-11' } })).body.code).toBe('LEAVE_OVERLAP');
    expect((await t.req('POST', api('/leave'), { token: emp.token, body: { typeId: annualType, startsOn: '2026-11-12', endsOn: '2026-11-12' } })).body.code).toBe('LEAVE_OVERLAP');
    expect((await t.req('POST', api('/leave'), { token: emp.token, body: { typeId: annualType, startsOn: '2026-11-20', endsOn: '2026-11-20' } })).body.code).toBe('NO_WORKING_DAYS'); // a Friday
    const big = await t.req('POST', api('/leave'), { token: emp.token, body: { typeId: annualType, startsOn: '2026-12-01', endsOn: '2027-01-10' } });
    expect(big.body.code).toBe('BALANCE'); // 26 − 6 pending = 20 left
    expect((await t.req('POST', api('/leave'), { token: emp.token, body: { typeId: annualType, startsOn: '2027-03-15', endsOn: '2027-03-25' } })).body.code).toBe('YEAR_SPAN');
    // Only for oneself in own scope.
    expect((await t.req('POST', api('/leave'), { token: emp.token, body: { employeeId: otherId, typeId: annualType, startsOn: '2026-11-07', endsOn: '2026-11-07' } })).status).toBe(403);
    const bal = (await t.req('GET', api(`/employees/${empId}`), { token: emp.token })).body.balances.items[0];
    expect(bal).toMatchObject({ allowance: 26, approved: 0, pending: 6, remaining: 20 });
  });

  it('approves leave through the HR manager workflow and notifies the employee', async () => {
    expect((await t.req('GET', '/api/core/approvals', { token: emp.token })).body.find((x: { entity_id: string }) => x.entity_id === leaveId)).toBeUndefined();
    const inbox = (await t.req('GET', '/api/core/approvals', { token: hrm.token })).body;
    const item = inbox.find((x: { entity_id: string }) => x.entity_id === leaveId);
    expect(item.title).toContain('مریم احمدی');
    expect((await t.req('POST', `/api/core/approvals/${item.id}/decide`, { token: hrm.token, body: { decision: 'approve' } })).body.state).toBe('approved');
    await drain();
    const mine = (await t.req('GET', api('/leave?mine=1'), { token: emp.token })).body;
    expect(mine[0]).toMatchObject({ id: leaveId, status: 'approved', days: 6 });
    const n = (await t.req('GET', '/api/core/notifications', { token: emp.token })).body.items;
    expect(n.some((x: { type: string; title: string }) => x.type === 'hr.leave.decided' && x.title.includes('تأیید شد'))).toBe(true);
    expect((await t.req('POST', api(`/leave/${leaveId}/cancel`), { token: emp.token })).status).toBe(403); // approved: only HR
    const w = (await t.req('GET', '/api/core/widgets/hr/hr.my_leave', { token: emp.token })).body.data;
    expect(w.balances[0]).toMatchObject({ approved: 6, remaining: 20 });
  });

  it('withdraws a pending request and removes it from the approval inbox', async () => {
    const r = await t.req('POST', api('/leave'), { token: emp.token, body: { typeId: annualType, startsOn: '2026-12-05', endsOn: '2026-12-06' } });
    expect(r.body.days).toBe(2);
    expect((await t.req('GET', '/api/core/approvals', { token: hrm.token })).body.some((x: { entity_id: string }) => x.entity_id === r.body.id)).toBe(true);
    expect((await t.req('POST', api(`/leave/${r.body.id}/cancel`), { token: other.token })).status).toBe(404);
    expect((await t.req('POST', api(`/leave/${r.body.id}/cancel`), { token: emp.token })).body.was).toBe('pending');
    expect((await t.req('GET', '/api/core/approvals', { token: hrm.token })).body.some((x: { entity_id: string }) => x.entity_id === r.body.id)).toBe(false);
    expect((await t.req('GET', api(`/employees/${empId}`), { token: emp.token })).body.balances.items[0]).toMatchObject({ pending: 0, remaining: 20 });
  });

  it('shows performance reviews to the employee only when final', async () => {
    const body = { employeeId: empId, period: 'نیمه اول ۱۴۰۵', criteria: [{ label: 'کیفیت کار', weight: 3, score: 5 }, { label: 'همکاری', weight: 1, score: 3 }], strengths: 'دقت در محاسبات' };
    const draft = await t.req('POST', api('/reviews'), { token: hrm.token, body });
    expect(draft.body.score).toBe(90); // (3·5 + 1·3) / 4 / 5
    expect((await t.req('GET', api('/reviews'), { token: emp.token })).body).toEqual([]);
    expect((await t.req('GET', api(`/employees/${empId}`), { token: emp.token })).body.reviews).toEqual([]);
    expect((await t.req('PUT', api(`/reviews/${draft.body.id}?finalize=1`), { token: hrm.token, body })).status).toBe(200);
    expect((await t.req('GET', api('/reviews'), { token: emp.token })).body[0]).toMatchObject({ period: 'نیمه اول ۱۴۰۵', score: 90, status: 'final' });
    expect((await t.req('PUT', api(`/reviews/${draft.body.id}`), { token: hrm.token, body })).body.code).toBe('FINAL');
    expect((await t.req('POST', api('/reviews'), { token: hrm.token, body })).body.code).toBe('REVIEW_EXISTS');
    expect((await t.req('POST', api('/reviews'), { token: emp.token, body })).status).toBe(403);
  });

  it('transfers a hired candidate field by field (nothing automatic)', async () => {
    const rapi = (p: string) => `/api/m/recruitment/v1${p}`;
    const cand = await t.req('POST', rapi('/candidates'), {
      token: a.token,
      body: { fullName: 'نیما صادقی', mobile: '09351112233', expectedSalary: 500_000_000, consentOn: today, educations: [{ degree: 'bachelor', field: 'عمران' }], skills: [{ kind: 'software', name: 'ETABS', level: 4 }, { kind: 'software', name: 'SAP2000', level: 2 }] },
    });
    const job = await t.req('POST', rapi('/jobs'), { token: a.token, body: { title: 'کارشناس اجرا' } });
    await t.req('POST', rapi(`/jobs/${job.body.id}/applications`), { token: a.token, body: { candidateIds: [cand.body.id] } });
    const j = (await t.req('GET', rapi(`/jobs/${job.body.id}`), { token: a.token })).body;
    const hiredStage = j.stages.find((s: { kind: string }) => s.kind === 'hired').id;
    await t.req('POST', rapi(`/applications/${j.applications[0].id}/move`), { token: a.token, body: { stageId: hiredStage } });
    const hired = (await t.req('GET', api('/transfer/hired'), { token: hrm.token })).body;
    expect(hired.map((h: { full_name: string; job_title: string }) => `${h.full_name}|${h.job_title}`)).toEqual(['نیما صادقی|کارشناس اجرا']);
    expect((await t.req('GET', api(`/transfer/candidates/${cand.body.id}`), { token: emp.token })).status).toBe(403);
    const c = (await t.req('GET', api(`/transfer/candidates/${cand.body.id}`), { token: hrm.token })).body;
    expect(c.skills).toHaveLength(2);
    // The user picked one skill and the education; mobile and salary were left out.
    const e = await t.req('POST', api('/employees'), {
      token: hrm.token,
      body: { personnelNo: '1003', fullName: c.full_name, hiredOn: today, position: 'کارشناس اجرا', recruitmentCandidateId: c.id, skills: [c.skills[0]], records: [{ kind: 'education', title: 'کارشناسی عمران' }] },
    });
    const d = (await t.req('GET', api(`/employees/${e.body.id}`), { token: hrm.token })).body;
    expect(d.employee).toMatchObject({ recruitment_candidate_id: c.id, mobile: null });
    expect(d.skills.map((s: { name: string }) => s.name)).toEqual(['ETABS']);
    expect(d.records.map((r: { kind: string }) => r.kind).sort()).toEqual(['education', 'hire']);
    expect(JSON.stringify(d)).not.toContain('500000000');
    expect((await t.req('GET', api('/transfer/hired'), { token: hrm.token })).body).toEqual([]);
  });

  it('alerts once before a contract ends, reports KPIs and stays tenant-isolated', async () => {
    const now = Date.now();
    await t.services.scheduler.tick(now);
    await t.services.scheduler.tick(now + 800 * 60_000);
    const n = (await t.req('GET', '/api/core/notifications', { token: hrm.token })).body.items.filter((x: { type: string }) => x.type === 'hr.contract.ending');
    expect(n).toHaveLength(1);
    expect(n[0].title).toContain('مریم احمدی');
    const w = (await t.req('GET', '/api/core/widgets/hr/hr.overview', { token: hrm.token })).body.data;
    expect(w).toMatchObject({ headcount: 3, contracts_ending: 1, pending: 0 });
    expect((await t.req('GET', api(`/employees/${empId}`), { token: b.token })).status).toBe(404);
    expect((await t.req('GET', api('/employees'), { token: b.token })).body).toEqual([]);
    expect((await t.req('POST', api('/employees/' + empId + '/end'), { token: hrm.token, body: { endedOn: '2020-01-01' } })).body.code).toBe('END_DATE');
    expect((await t.req('POST', api('/employees/' + otherId + '/end'), { token: hrm.token, body: { endedOn: today, reason: 'استعفا' } })).status).toBe(200);
    expect((await t.req('POST', api('/leave'), { token: other.token, body: { typeId: annualType, startsOn: '2026-11-07', endsOn: '2026-11-07' } })).status).toBe(404);
  });
});
