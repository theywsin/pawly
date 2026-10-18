import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningKey } from '@mohandesyar/module-package';
import { addDays, todayIso } from '@mohandesyar/persian';
import { TestApp } from '../helpers/app.js';
import { buildModule } from '../helpers/packages.js';

/** contracts module on a real database: lifecycle of a contract, money arithmetic, approvals, alerts, isolation. */
let t: TestApp;
let a: { token: string; tenantId: string };
let b: { token: string; tenantId: string };
let approver: { token: string; userId: string };
const api = (path: string) => `/api/m/contracts/v1${path}`;
const today = todayIso();
let contractId = '';
let version = 0;

beforeAll(async () => {
  t = await TestApp.start();
  const admin = await t.consoleAdmin();
  const key = generateSigningKey();
  a = await t.signup('contracts-a');
  b = await t.signup('contracts-b');
  await t.installModules(admin, key.publicKeyPem, [await buildModule('contracts', key)], [a.tenantId, b.tenantId]);
  approver = await t.member(a.token, 'company_admin', 'approver');
}, 180_000);
afterAll(async () => t?.stop());

const base = {
  code: 'Q-1403-01',
  title: 'اجرای ابنیه ساختمان اداری',
  kind: 'employer',
  direction: 'income',
  counterpartyName: 'شرکت عمران نمونه',
  initialAmount: '10000000000',
  prepaymentAmount: '1000000000',
  startOn: '2025-03-21',
  endOn: '2026-03-20',
  goodPerformancePct: '10',
  insurancePct: '5',
  taxPct: '3',
  vatPct: '10',
  prepaymentRecoveryPct: '25',
};

describe('contracts', () => {
  it('validates input with Persian messages', async () => {
    const r = await t.req('POST', api('/contracts'), { token: a.token, body: { ...base, title: 'x', initialAmount: '12.5', endOn: '2024-01-01' } });
    expect(r.status).toBe(400);
    const paths = Object.fromEntries(r.body.details.map((d: { path: string; message: string }) => [d.path, d.message]));
    expect(paths.title).toBe('عنوان قرارداد الزامی است');
    expect(paths.initialAmount).toBe('مبلغ باید عدد صحیح ریالی باشد');
  });

  it('creates a draft contract with defaults; duplicate numbers are refused', async () => {
    const r = await t.req('POST', api('/contracts'), { token: a.token, body: base });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    contractId = r.body.id;
    expect((await t.req('POST', api('/contracts'), { token: a.token, body: base })).status).toBe(409);
    const d = await t.req('GET', api(`/contracts/${contractId}`), { token: a.token });
    expect(d.body.contract).toMatchObject({ status: 'draft', current_amount: '10000000000', approved_gross: '0', start_on: '2025-03-21' });
    expect(d.body.history[0].action).toBe('contract.created');
    version = d.body.contract.version;
  });

  it('is invisible to another organisation and to members without the permission', async () => {
    expect((await t.req('GET', api(`/contracts/${contractId}`), { token: b.token })).status).toBe(404);
    expect((await t.req('GET', api('/contracts'), { token: b.token })).body).toEqual([]);
    const employee = await t.member(a.token, 'employee', 'emp');
    expect((await t.req('GET', api('/contracts'), { token: employee.token })).status).toBe(403);
    const viewer = await t.member(a.token, 'contracts_viewer', 'viewer');
    expect((await t.req('GET', api('/contracts'), { token: viewer.token })).body).toHaveLength(1);
    expect((await t.req('POST', api('/contracts'), { token: viewer.token, body: { ...base, code: 'X-2' } })).status).toBe(403);
  });

  it('edits a draft with optimistic locking and records the change', async () => {
    const stale = await t.req('PUT', api(`/contracts/${contractId}`), { token: a.token, body: { ...base, version: version - 1, status: 'draft' } });
    expect(stale.status).toBe(409);
    const ok = await t.req('PUT', api(`/contracts/${contractId}`), { token: a.token, body: { ...base, initialAmount: '12000000000', version, status: 'draft' } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const d = await t.req('GET', api(`/contracts/${contractId}`), { token: a.token });
    expect(d.body.contract.initial_amount).toBe('12000000000');
    expect(d.body.history[0].changes.initialAmount).toEqual({ from: '10000000000', to: '12000000000' });
    version = d.body.contract.version;
  });

  it('after signing, amount and dates change only through amendments', async () => {
    expect((await t.req('POST', api(`/contracts/${contractId}/amendments`), { token: a.token, body: { kind: 'amount', title: 'افزایش', amountDelta: '1', signedOn: today } })).status).toBe(409);
    expect((await t.req('POST', api(`/contracts/${contractId}/activate`), { token: a.token, body: { signedOn: '2025-03-15' } })).status).toBe(200);
    const d0 = await t.req('GET', api(`/contracts/${contractId}`), { token: a.token });
    // A PUT on an active contract only accepts descriptive fields; the amount is ignored.
    const put = await t.req('PUT', api(`/contracts/${contractId}`), { token: a.token, body: { ...base, initialAmount: '1', title: 'اجرای ابنیه و تأسیسات', version: d0.body.contract.version, status: 'active', ownerId: null, crmAccountId: null, projectId: null, description: '' } });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const am = await t.req('POST', api(`/contracts/${contractId}/amendments`), { token: a.token, body: { kind: 'renewal', title: 'تمدید و افزایش ۲۵ درصد', amountDelta: '3000000000', newEndOn: '2026-09-22', signedOn: today } });
    expect(am.status, JSON.stringify(am.body)).toBe(201);
    expect((await t.req('POST', api(`/contracts/${contractId}/amendments`), { token: a.token, body: { kind: 'amount', title: 'کاهش بیش از حد', amountDelta: '-99000000000', signedOn: today } })).status).toBe(400);
    const d = await t.req('GET', api(`/contracts/${contractId}`), { token: a.token });
    expect(d.body.contract).toMatchObject({ status: 'active', title: 'اجرای ابنیه و تأسیسات', initial_amount: '12000000000', current_amount: '15000000000', end_on: '2026-09-22' });
    expect((await t.req('DELETE', api(`/contracts/${contractId}`), { token: a.token })).status).toBe(409);
  });

  let statementId = '';
  it('computes a progress statement exactly and allows one open statement at a time', async () => {
    const body = { periodTo: '2025-06-21', cumulativeGross: '4000000000', otherDeductions: '20000000' };
    const preview = await t.req('POST', api(`/contracts/${contractId}/statements/preview`), { token: a.token, body });
    expect(preview.body).toEqual({
      periodGross: '4000000000', goodPerformance: '400000000', insurance: '200000000', tax: '120000000',
      prepaymentRecovery: '1000000000', otherDeductions: '20000000', vat: '400000000', netPayable: '2660000000',
    });
    const r = await t.req('POST', api(`/contracts/${contractId}/statements`), { token: a.token, body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    statementId = r.body.id;
    expect((await t.req('POST', api(`/contracts/${contractId}/statements`), { token: a.token, body: { ...body, cumulativeGross: '5000000000' } })).status).toBe(409);
  });

  it('submits for approval; the submitter cannot approve; another manager approves; amounts reach the contract', async () => {
    const s = await t.req('POST', api(`/contracts/${contractId}/statements/${statementId}/submit`), { token: a.token });
    expect(s.body.state).toBe('pending');
    const inbox = await t.req('GET', '/api/core/approvals', { token: approver.token });
    const item = inbox.body.find((x: { entity_id: string }) => x.entity_id === statementId);
    expect(item).toBeTruthy();
    expect((await t.req('POST', `/api/core/approvals/${item.id}/decide`, { token: a.token, body: { decision: 'approve' } })).status).toBe(403);
    expect((await t.req('PUT', api(`/contracts/${contractId}/statements/${statementId}`), { token: a.token, body: { periodTo: '2025-06-21', cumulativeGross: '1' } })).status).toBe(409);
    expect((await t.req('POST', `/api/core/approvals/${item.id}/decide`, { token: approver.token, body: { decision: 'approve' } })).body.state).toBe('approved');
    while ((await t.services.events.dispatchOnce()) > 0);
    const d = await t.req('GET', api(`/contracts/${contractId}`), { token: a.token });
    expect(d.body.statements[0]).toMatchObject({ status: 'approved', net_payable: '2660000000' });
    expect(d.body.contract.approved_gross).toBe('4000000000');
    expect(d.body.history[0].action).toBe('statement.approved');
  });

  it('the next statement deducts only what remains of the prepayment', async () => {
    const p = await t.req('POST', api(`/contracts/${contractId}/statements/preview`), { token: a.token, body: { periodTo: '2025-09-22', cumulativeGross: '3000000000' } });
    expect(p.body.message).toContain('کارکرد تجمعی نباید');
    const r = await t.req('POST', api(`/contracts/${contractId}/statements/preview`), { token: a.token, body: { periodTo: '2025-09-22', cumulativeGross: '6000000000' } });
    expect(r.body).toMatchObject({ periodGross: '2000000000', prepaymentRecovery: '0' });
  });

  it('alerts the responsible person once when a guarantee nears expiry', async () => {
    const g = await t.req('POST', api(`/contracts/${contractId}/guarantees`), { token: a.token, body: { kind: 'performance', number: 'BG-778', issuer: 'بانک نمونه', amount: '600000000', expiresOn: addDays(today, 10) } });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    const now = Date.now();
    expect(await t.services.scheduler.tick(now)).toBeGreaterThanOrEqual(1);
    expect(await t.services.scheduler.tick(now + 400 * 60_000)).toBeGreaterThanOrEqual(1); // next period: job runs again…
    const n = await t.req('GET', '/api/core/notifications', { token: a.token });
    const alerts = n.body.items.filter((x: { type: string }) => x.type === 'contracts.expiry').map((x: { title: string }) => x.title);
    // …but each alert is sent once: the guarantee, and the contract whose (amended) end date has passed.
    expect(alerts.filter((x: string) => x.includes('BG-778'))).toHaveLength(1);
    expect(alerts.filter((x: string) => x.includes('Q-1403-01') && !x.includes('BG-778'))).toEqual(today > '2026-09-22' ? ['مدت قرارداد Q-1403-01 به پایان رسیده ولی قرارداد هنوز باز است'] : []);
    const w = await t.req('GET', '/api/core/widgets/contracts/contracts.expiring', { token: a.token });
    expect(w.body.data.items.map((x: { title: string }) => x.title)).toContain('BG-778');
  });

  it('is found by global search and summarised for the dashboard', async () => {
    const s = await t.req('GET', '/api/core/search?q=Q-1403', { token: a.token });
    expect(s.body.groups?.[0]?.hits?.[0]?.link ?? s.body[0]?.hits?.[0]?.link).toBe(`/app/contracts/${contractId}`);
    const w = await t.req('GET', '/api/core/widgets/contracts/contracts.summary', { token: a.token });
    expect(w.body.data).toMatchObject({ active: 1, income: '15000000000', expense: '0' });
    expect((await t.req('GET', '/api/core/search?q=Q-1403', { token: b.token })).body.groups ?? []).toEqual([]);
  });

  it('records each view of a contract in the audit log', async () => {
    const r = await t.services.db.migratorPool.query(`SELECT count(*)::int AS n FROM core_audit_log WHERE action = 'contracts.contract.viewed' AND entity_id = $1`, [contractId]);
    expect(r.rows[0].n).toBeGreaterThan(3);
  });
});
