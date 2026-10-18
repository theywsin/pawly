import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningKey } from '@mohandesyar/module-package';
import { TestApp } from '../helpers/app.js';
import { buildModule } from '../helpers/packages.js';

/**
 * kpi: provider registry (values from hr through the core), manual values with separation of duties,
 * safe formulas (inputs, cycles), targets and approved values only, gate KPIs, versioned scorecards with
 * review → approval by different people, versioned reward rules with suggested coefficients only.
 */
let t: TestApp;
let a: { token: string; tenantId: string };
let b: { token: string; tenantId: string };
let kadmin: { token: string; userId: string };
let approver: { token: string; userId: string };
let approver2: { token: string; userId: string };
let owner: { token: string; userId: string };
const api = (p: string) => `/api/m/kpi/v1${p}`;
const P = '1405-Q3';
const defs: Record<string, string> = {};

const define = (token: string, body: Record<string, unknown>) => t.req('POST', api('/definitions'), { token, body: { direction: 'higher', frequency: 'quarterly', source: 'manual', ...body } });
const sheet = async (token: string, level?: string) => (await t.req('GET', api(`/values?period=${P}${level ? `&level=${level}` : ''}`), { token })).body.rows as { definition: { id: string; code: string }; subjectId: string; value: { id: string; value: number; status: string } | null; canEnter: boolean }[];
const valueId = async (code: string, subjectId: string) => (await sheet(kadmin.token)).find((r) => r.definition.code === code && r.subjectId === subjectId)!.value!.id;
const person = (u: { userId: string }, name: string) => ({ subjectType: 'person', subjectId: u.userId, subjectName: name });

beforeAll(async () => {
  t = await TestApp.start();
  const admin = await t.consoleAdmin();
  const key = generateSigningKey();
  a = await t.signup('kpi-a');
  b = await t.signup('kpi-b');
  await t.installModules(admin, key.publicKeyPem, [await buildModule('hr', key), await buildModule('kpi', key)], [a.tenantId, b.tenantId]);
  kadmin = await t.member(a.token, 'kpi_admin', 'kadmin');
  approver = await t.member(a.token, 'kpi_approver', 'appr');
  approver2 = await t.member(a.token, 'kpi_approver', 'appr2');
  owner = await t.member(a.token, 'kpi_owner', 'owner');
  for (const [no, name] of [['1', 'الف'], ['2', 'ب'], ['3', 'ج']]) {
    await t.req('POST', '/api/m/hr/v1/employees', { token: a.token, body: { personnelNo: no, fullName: `کارمند ${name}`, hiredOn: '2025-01-01' } });
  }
}, 240_000);
afterAll(async () => t?.stop());

describe('kpi', () => {
  it('lists providers of active modules and computes a provider value with a traceable snapshot', async () => {
    const providers = (await t.req('GET', api('/providers'), { token: kadmin.token })).body as { key: string; moduleId: string }[];
    expect(providers.map((p) => p.key).sort()).toEqual(['hr.headcount', 'hr.leave_days', 'hr.training_hours']);
    expect((await define(kadmin.token, { code: 'x', name: 'نامعتبر', level: 'org', source: 'provider', providerKey: 'finance.cash' })).body.code).toBe('VALIDATION_FAILED');
    expect((await define(kadmin.token, { code: 'staff', name: 'منبع ناموجود', level: 'org', source: 'provider', providerKey: 'finance.cash' })).body.code).toBe('PROVIDER');
    const d = await define(kadmin.token, { code: 'headcount', name: 'تعداد کارکنان', level: 'org', source: 'provider', providerKey: 'hr.headcount', unit: 'count' });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    defs.headcount = d.body.id;
    expect((await t.req('POST', api(`/definitions/${defs.headcount}/values`), { token: kadmin.token, body: { period: P, subjectType: 'org', subjectId: 'org', subjectName: 'سازمان', value: 9 } })).body.code).toBe('NOT_MANUAL');
    expect((await t.req('POST', api(`/definitions/${defs.headcount}/compute`), { token: kadmin.token, body: { period: '1405-07', subjectType: 'org', subjectId: 'org', subjectName: 'سازمان' } })).body.code).toBe('PERIOD_FREQUENCY');
    const c = await t.req('POST', api(`/definitions/${defs.headcount}/compute`), { token: kadmin.token, body: { period: P, subjectType: 'org', subjectId: 'org', subjectName: 'سازمان' } });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body.value).toBe(3);
    expect(c.body.snapshot).toMatchObject({ provider: 'hr.headcount', module: 'hr', from: '2026-09-23', to: '2026-12-21' });
    // Another tenant: same provider, its own data (none).
    const db = await define(b.token, { code: 'headcount', name: 'تعداد کارکنان', level: 'org', source: 'provider', providerKey: 'hr.headcount' });
    expect((await t.req('POST', api(`/definitions/${db.body.id}/compute`), { token: b.token, body: { period: P, subjectType: 'org', subjectId: 'org', subjectName: 'سازمان' } })).body.value).toBe(0);
  });

  it('separates entering and approving values; owners enter only their own KPIs', async () => {
    defs.quality = (await define(kadmin.token, { code: 'quality', name: 'کیفیت مدارک فنی', level: 'person', weight: 3, ownerUserId: owner.userId, unit: 'percent' })).body.id;
    defs.delivery = (await define(kadmin.token, { code: 'delivery', name: 'تحویل به‌موقع', level: 'person', weight: 1, unit: 'percent' })).body.id;
    defs.incidents = (await define(kadmin.token, { code: 'incidents', name: 'حوادث ایمنی', level: 'person', direction: 'lower', isGate: true, weight: 1 })).body.id;
    for (const [id, tg] of [[defs.quality, 90], [defs.delivery, 100], [defs.incidents, 0]] as const) {
      const r = await t.req('PUT', api(`/definitions/${id}/targets`), { token: kadmin.token, body: { period: P, targets: [{ ...person(owner, 'مسئول شاخص'), target: tg }, { ...person(approver2, 'تأییدکننده دوم'), target: tg }] } });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    expect((await t.req('PUT', api(`/definitions/${defs.quality}/targets`), { token: kadmin.token, body: { period: P, targets: [{ subjectType: 'org', subjectId: 'org', subjectName: 'سازمان', target: 1 }] } })).body.code).toBe('LEVEL');
    // The owner sees and enters only the KPI they own.
    const own = await sheet(owner.token, 'person');
    expect([...new Set(own.map((r) => r.definition.code))]).toEqual(['quality']);
    expect(own.every((r) => r.canEnter)).toBe(true);
    expect((await t.req('POST', api(`/definitions/${defs.quality}/values`), { token: owner.token, body: { period: P, ...person(owner, 'مسئول شاخص'), value: 81, note: 'گزارش کنترل مدارک' } })).status).toBe(201);
    expect((await t.req('POST', api(`/definitions/${defs.delivery}/values`), { token: owner.token, body: { period: P, ...person(owner, 'مسئول شاخص'), value: 100 } })).status).toBe(404);
    // Whoever entered a value cannot approve it.
    await t.req('POST', api(`/definitions/${defs.delivery}/values`), { token: a.token, body: { period: P, ...person(owner, 'مسئول شاخص'), value: 100 } });
    const dv = await valueId('delivery', owner.userId);
    expect((await t.req('POST', api(`/values/${dv}/decision`), { token: a.token, body: { decision: 'approve' } })).status).toBe(403);
    expect((await t.req('POST', api(`/values/${dv}/decision`), { token: owner.token, body: { decision: 'approve' } })).status).toBe(403);
    expect((await t.req('POST', api(`/values/${dv}/decision`), { token: approver.token, body: { decision: 'reject' } })).status).toBe(400); // reason required
    for (const code of ['quality', 'delivery']) expect((await t.req('POST', api(`/values/${await valueId(code, owner.userId)}/decision`), { token: approver.token, body: { decision: 'approve' } })).status).toBe(200);
    expect((await t.req('POST', api(`/definitions/${defs.quality}/values`), { token: owner.token, body: { period: P, ...person(owner, 'مسئول شاخص'), value: 85 } })).body.code).toBe('APPROVED');
    const hist = (await t.req('GET', api(`/values/${await valueId('quality', owner.userId)}/history`), { token: owner.token })).body;
    expect(hist.map((h: { action: string }) => h.action)).toEqual(['entered', 'approve']);
  });

  it('evaluates formulas only from approved inputs and rejects unknown codes and cycles', async () => {
    defs.done = (await define(kadmin.token, { code: 'done', name: 'فعالیت‌های انجام‌شده', level: 'org' })).body.id;
    defs.planned = (await define(kadmin.token, { code: 'planned', name: 'فعالیت‌های برنامه‌ای', level: 'org' })).body.id;
    expect((await define(kadmin.token, { code: 'bad', name: 'نامعتبر', level: 'org', source: 'formula', formula: 'done / nothing' })).body.code).toBe('FORMULA_VARS');
    expect((await define(kadmin.token, { code: 'bad', name: 'نامعتبر', level: 'person', source: 'formula', formula: 'done / planned' })).body.code).toBe('FORMULA_VARS'); // other level
    const rate = await define(kadmin.token, { code: 'rate', name: 'نرخ تحقق برنامه', level: 'org', source: 'formula', formula: 'done / planned * 100', unit: 'percent' });
    defs.rate = rate.body.id;
    const org = { period: P, subjectType: 'org', subjectId: 'org', subjectName: 'سازمان' };
    await t.req('POST', api(`/definitions/${defs.done}/values`), { token: kadmin.token, body: { ...org, value: 45 } });
    await t.req('POST', api(`/definitions/${defs.planned}/values`), { token: kadmin.token, body: { ...org, value: 60 } });
    expect((await t.req('POST', api(`/definitions/${defs.rate}/compute`), { token: kadmin.token, body: org })).body.code).toBe('FORMULA_INPUTS');
    for (const code of ['done', 'planned']) await t.req('POST', api(`/values/${await valueId(code, 'org')}/decision`), { token: approver.token, body: { decision: 'approve' } });
    const c = await t.req('POST', api(`/definitions/${defs.rate}/compute`), { token: kadmin.token, body: org });
    expect(c.body).toMatchObject({ value: 75, snapshot: { formula: 'done / planned * 100', inputs: { done: 45, planned: 60 } } });
    // Cycle: xx = rate + 1, then rate = xx * 2.
    expect((await define(kadmin.token, { code: 'xx', name: 'شاخص وابسته', level: 'org', source: 'formula', formula: 'rate + 1' })).status).toBe(201);
    const upd = await t.req('PUT', api(`/definitions/${defs.rate}`), { token: kadmin.token, body: { code: 'rate', name: 'نرخ', direction: 'higher', level: 'org', frequency: 'quarterly', source: 'formula', formula: 'xx * 2' } });
    expect(upd.body.code).toBe('FORMULA_CYCLE');
    expect((await t.req('PUT', api(`/definitions/${defs.done}`), { token: kadmin.token, body: { code: 'done2', name: 'انجام‌شده', direction: 'higher', level: 'org', frequency: 'quarterly', source: 'manual' } })).body.code).toBe('CODE_IN_FORMULA');
    const ok = await t.req('PUT', api(`/definitions/${defs.done}`), { token: kadmin.token, body: { code: 'done', name: 'فعالیت‌های انجام‌شده (اصلاح)', direction: 'higher', level: 'org', frequency: 'quarterly', source: 'manual', weight: 2 } });
    expect(ok.body.version).toBe(2);
    expect((await t.req('PUT', api(`/definitions/${defs.done}`), { token: kadmin.token, body: { code: 'done', name: 'انجام‌شده', direction: 'higher', level: 'org', frequency: 'monthly', source: 'manual' } })).body.code).toBe('IN_USE');
    const d = (await t.req('GET', api(`/definitions/${defs.done}`), { token: kadmin.token })).body;
    expect(d.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
  });

  it('computes scorecards from approved values only, with gates, and needs a reviewer and a different approver', async () => {
    expect((await t.req('POST', api('/reward-rules'), { token: kadmin.token, body: { name: 'ضریب ۱۴۰۵', bands: [{ minScore: 80, coefficient: 1 }] } })).body.version).toBe(1);
    expect((await t.req('POST', api('/reward-rules'), { token: kadmin.token, body: { name: 'ضریب ۱۴۰۵', bands: [{ minScore: 95, coefficient: 1.2 }, { minScore: 80, coefficient: 1 }, { minScore: 60, coefficient: 0.5 }], gateCoefficient: 0 } })).body.version).toBe(2);
    const cards = (await t.req('POST', api('/scorecards/compute'), { token: kadmin.token, body: { period: P, subjectType: 'person' } })).body as { id: string; subjectName: string }[];
    expect(cards.map((c) => c.subjectName).sort()).toEqual(['تأییدکننده دوم', 'مسئول شاخص']);
    const mine = cards.find((c) => c.subjectName === 'مسئول شاخص')!.id;
    const other = cards.find((c) => c.subjectName === 'تأییدکننده دوم')!.id;
    let d = (await t.req('GET', api(`/scorecards/${mine}`), { token: kadmin.token })).body.scorecard;
    // quality 81/90 = 90% (w3), delivery 100% (w1); incidents has no value yet → incomplete, gate not met.
    expect(d).toMatchObject({ score: 92.5, complete: false, gate_failed: true, status: 'draft' });
    expect((await t.req('POST', api(`/scorecards/${mine}/approve`), { token: approver.token, body: {} })).body.code).toBe('NOT_REVIEWED');
    await t.req('POST', api(`/scorecards/${mine}/review`), { token: kadmin.token, body: {} });
    expect((await t.req('POST', api(`/scorecards/${mine}/approve`), { token: approver.token, body: {} })).body.code).toBe('INCOMPLETE');
    // The safety value arrives: one incident against a target of zero → gate fails.
    await t.req('POST', api(`/definitions/${defs.incidents}/values`), { token: kadmin.token, body: { period: P, ...person(owner, 'مسئول شاخص'), value: 1 } });
    await t.req('POST', api(`/values/${await valueId('incidents', owner.userId)}/decision`), { token: approver.token, body: { decision: 'approve' } });
    await t.req('POST', api('/scorecards/compute'), { token: kadmin.token, body: { period: P, subjectType: 'person', subjectId: owner.userId } });
    d = (await t.req('GET', api(`/scorecards/${mine}`), { token: kadmin.token })).body.scorecard;
    expect(d).toMatchObject({ complete: true, gate_failed: true, status: 'draft', version: 1 }); // recompute resets to draft
    expect(d.breakdown.gateReasons[0]).toContain('حوادث ایمنی');
    await t.req('POST', api(`/scorecards/${mine}/review`), { token: a.token, body: { comment: 'بررسی شد' } });
    expect((await t.req('POST', api(`/scorecards/${mine}/approve`), { token: a.token, body: {} })).status).toBe(403); // reviewer ≠ approver
    expect((await t.req('POST', api(`/scorecards/${mine}/approve`), { token: owner.token, body: {} })).status).toBe(403);
    expect((await t.req('POST', api(`/scorecards/${mine}/approve`), { token: approver.token, body: {} })).status).toBe(200);
    const g = (await t.req('GET', api(`/scorecards/${mine}`), { token: owner.token })).body;
    expect(g.reward).toMatchObject({ coefficient: 0, rule_version: 2 });
    expect(g.reward.reason).toContain('شرط لازم');
    const n = (await t.req('GET', '/api/core/notifications', { token: owner.token })).body.items;
    expect(n.some((x: { type: string }) => x.type === 'kpi.scorecard.approved')).toBe(true);
    // Nobody approves their own card.
    await t.req('POST', api(`/scorecards/${other}/review`), { token: kadmin.token, body: {} });
    expect((await t.req('POST', api(`/scorecards/${other}/approve`), { token: approver2.token, body: {} })).status).toBe(403);
  });

  it('versions approved scorecards instead of changing them; own scope sees only own cards', async () => {
    const qv = await valueId('quality', owner.userId);
    await t.req('POST', api(`/values/${qv}/reopen`), { token: approver.token, body: { comment: 'اصلاح گزارش' } });
    await t.req('POST', api(`/definitions/${defs.quality}/values`), { token: owner.token, body: { period: P, ...person(owner, 'مسئول شاخص'), value: 90 } });
    await t.req('POST', api(`/values/${qv}/decision`), { token: approver.token, body: { decision: 'approve' } });
    const r = (await t.req('POST', api('/scorecards/compute'), { token: kadmin.token, body: { period: P, subjectType: 'person', subjectId: owner.userId } })).body;
    expect(r[0].version).toBe(2);
    const v2 = r[0].id;
    await t.req('POST', api(`/scorecards/${v2}/review`), { token: kadmin.token, body: {} });
    await t.req('POST', api(`/scorecards/${v2}/approve`), { token: approver.token, body: {} });
    const g = (await t.req('GET', api(`/scorecards/${v2}`), { token: owner.token })).body;
    expect(g.versions.map((v: { version: number; status: string }) => `${v.version}:${v.status}`)).toEqual(['2:approved', '1:superseded']);
    const list = (await t.req('GET', api(`/scorecards?period=${P}`), { token: owner.token })).body;
    expect(list.map((c: { subject_id: string; version: number }) => [c.subject_id, c.version])).toEqual([[owner.userId, 2]]);
    expect((await t.req('GET', api(`/scorecards?period=${P}`), { token: b.token })).body).toEqual([]);
    const hist = (await t.req('GET', api(`/values/${qv}/history`), { token: owner.token })).body.map((h: { action: string }) => h.action);
    expect(hist).toEqual(['entered', 'approve', 'reopened', 'entered', 'approve']);
    // No payment anywhere: results are coefficients with a reason, stored as suggestions only.
    const cols = await t.services.db.tx({ tenantId: a.tenantId }, (tx) => tx.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'kpi_reward_results'`));
    expect((cols.rows as { column_name: string }[]).map((c) => c.column_name).sort()).toEqual(['coefficient', 'company_id', 'created_at', 'id', 'reason', 'rule_id', 'scorecard_id', 'tenant_id']);
  });

  it('shows the dashboard status of approved KPIs', async () => {
    const w = (await t.req('GET', '/api/core/widgets/kpi/kpi.status', { token: approver.token })).body.data;
    expect(w.good + w.warning + w.critical).toBeGreaterThan(0);
    expect(w.attention.some((x: { name: string }) => x.name === 'حوادث ایمنی')).toBe(true);
  });
});
