import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningKey } from '@mohandesyar/module-package';
import { addDays, todayIso } from '@mohandesyar/persian';
import { TestApp } from '../helpers/app.js';
import { buildModule } from '../helpers/packages.js';

/**
 * finance (with projects): accounts and balances, transfers never income/expense, immutable transactions with
 * reversals, payment request → workflow approval → execution by a third person, receivables/payables,
 * cheques, versioned budgets with commitments and EAC from project progress, cash-flow forecast, bank
 * reconciliation, procurement events, project scope and tenant isolation.
 */
let t: TestApp;
let a: { token: string; tenantId: string };
let b: { token: string; tenantId: string };
let fm: { token: string; userId: string };
let tr: { token: string; userId: string };
let req: { token: string; userId: string };
const api = (p: string) => `/api/m/finance/v1${p}`;
const papi = (p: string) => `/api/m/projects/v1/projects${p}`;
const today = todayIso();
let bank = '';
let petty = '';
let income = '';
let materials = '';
let payee = '';
let projectId = '';
let otherProject = '';
let prId = '';
let txId = '';

/** Message of a database error (drizzle wraps the driver error in `cause`). */
let companyIds: string[] = [];
const asCompany = <T,>(fn: (x: { execute: (q: ReturnType<typeof sql>) => Promise<T> }) => Promise<T>) => t.services.db.tx({ tenantId: a.tenantId, companyIds }, fn as never) as Promise<T>;
const errText = (e: unknown) => String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message);
const balance = async (id: string) => ((await t.req('GET', api('/accounts'), { token: a.token })).body as { id: string; balance: string }[]).find((x) => x.id === id)!.balance;
const drain = async () => {
  while ((await t.services.events.dispatchOnce()) > 0);
};

beforeAll(async () => {
  t = await TestApp.start();
  const admin = await t.consoleAdmin();
  const key = generateSigningKey();
  a = await t.signup('fin-a');
  b = await t.signup('fin-b');
  await t.installModules(admin, key.publicKeyPem, [await buildModule('projects', key), await buildModule('finance', key)], [a.tenantId, b.tenantId]);
  fm = await t.member(a.token, 'finance_manager', 'fm');
  tr = await t.member(a.token, 'treasurer', 'tr');
  req = await t.member(a.token, 'payment_requester', 'req');
  companyIds = (await t.req('GET', '/api/core/me', { token: a.token })).body.company.ids;
  projectId = (await t.req('POST', papi(''), { token: a.token, body: { code: 'P-1', title: 'سوله صنعتی', plannedStart: addDays(today, -30), plannedFinish: addDays(today, 60), status: 'active' } })).body.id;
  otherProject = (await t.req('POST', papi(''), { token: a.token, body: { code: 'P-2', title: 'پروژه دیگر', status: 'active' } })).body.id;
  await t.req('POST', papi(`/${projectId}/members`), { token: a.token, body: { userId: req.userId, role: 'engineer' } });
}, 240_000);
afterAll(async () => t?.stop());

describe('finance', () => {
  it('sets up accounts with opening balances and a default chart of categories', async () => {
    expect((await t.req('POST', api('/accounts'), { token: fm.token, body: { kind: 'bank', name: 'جاری', iban: 'IR062960000000100324200002', openingOn: today } })).body.details[0].message).toBe('شماره شبا معتبر نیست');
    bank = (await t.req('POST', api('/accounts'), { token: fm.token, body: { kind: 'bank', name: 'جاری ملت', iban: 'IR062960000000100324200001', openingBalance: '1000000000', openingOn: addDays(today, -60) } })).body.id;
    petty = (await t.req('POST', api('/accounts'), { token: fm.token, body: { kind: 'petty_cash', name: 'تنخواه کارگاه', openingOn: addDays(today, -60) } })).body.id;
    expect(await balance(bank)).toBe('1000000000');
    const cats = (await t.req('GET', api('/categories'), { token: fm.token })).body as { id: string; kind: string; name: string }[];
    income = cats.find((c) => c.kind === 'income')!.id;
    materials = cats.find((c) => c.name === 'مصالح و تجهیزات')!.id;
    payee = (await t.req('POST', api('/counterparties'), { token: fm.token, body: { name: 'فولاد البرز', iban: '062960000000100324200001' } })).body.id;
    expect((await t.req('GET', api('/accounts'), { token: req.token })).status).toBe(403);
  });

  it('keeps transfers out of income and expense, and never overdraws', async () => {
    expect((await t.req('POST', api('/receipts'), { token: fm.token, body: { accountId: bank, amount: '500000000', occurredOn: today, categoryId: income, description: 'پیش‌دریافت' } })).status).toBe(201);
    expect((await t.req('POST', api('/receipts'), { token: fm.token, body: { accountId: bank, amount: '1', occurredOn: today, categoryId: materials } })).body.code).toBe('CATEGORY');
    expect((await t.req('POST', api('/transfers'), { token: fm.token, body: { fromAccountId: petty, toAccountId: bank, amount: '1', occurredOn: today } })).body.code).toBe('INSUFFICIENT_FUNDS');
    expect((await t.req('POST', api('/transfers'), { token: fm.token, body: { fromAccountId: bank, toAccountId: petty, amount: '200000000', occurredOn: today } })).status).toBe(201);
    expect([await balance(bank), await balance(petty)]).toEqual(['1300000000', '200000000']);
    const r = (await t.req('GET', api(`/reports/income-expense?from=${addDays(today, -1)}&to=${today}`), { token: fm.token })).body;
    expect(r).toMatchObject({ income: '500000000', expense: '0', net: '500000000' });
    expect(r.transfers).toMatchObject({ n: 1, amount: '200000000' });
  });

  it('routes payments: request (project scope) → approval → execution by a third person', async () => {
    const body = { counterpartyId: payee, amount: '300000000', dueOn: addDays(today, 5), description: 'خرید میلگرد', categoryId: materials };
    expect((await t.req('POST', api('/payment-requests'), { token: req.token, body })).status).toBe(403); // project required in project scope
    expect((await t.req('POST', api('/payment-requests'), { token: req.token, body: { ...body, projectId: otherProject } })).status).toBe(403);
    const r = await t.req('POST', api('/payment-requests'), { token: req.token, body: { ...body, projectId } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ number: 1, state: 'pending' });
    prId = r.body.id;
    // The finance manager approves in the core inbox; the requester cannot.
    expect((await t.req('GET', '/api/core/approvals', { token: req.token })).body).toEqual([]);
    const item = (await t.req('GET', '/api/core/approvals', { token: fm.token })).body.find((x: { entity_id: string }) => x.entity_id === prId);
    expect((await t.req('POST', `/api/core/approvals/${item.id}/decide`, { token: fm.token, body: { decision: 'approve' } })).body.state).toBe('approved');
    await drain();
    const mine = (await t.req('GET', api('/payment-requests'), { token: req.token })).body;
    expect(mine[0]).toMatchObject({ status: 'approved', approvers: [fm.userId] });
    expect((await t.req('GET', '/api/core/notifications', { token: req.token })).body.items.some((n: { type: string }) => n.type === 'finance.payment.decided')).toBe(true);
    // Neither requester nor approver executes; the treasurer does.
    const exec = { method: 'transfer', accountId: bank, occurredOn: today, bankReference: 'PAY-778' };
    expect((await t.req('POST', api(`/payment-requests/${prId}/execute`), { token: req.token, body: exec })).status).toBe(403);
    expect((await t.req('POST', api(`/payment-requests/${prId}/execute`), { token: fm.token, body: exec })).status).toBe(403);
    expect((await t.req('POST', api(`/payment-requests/${prId}/execute`), { token: tr.token, body: { ...exec, bankReference: '' } })).status).toBe(400);
    expect((await t.req('POST', api(`/payment-requests/${prId}/execute`), { token: tr.token, body: exec })).status).toBe(200);
    expect(await balance(bank)).toBe('1000000000');
    expect((await t.req('POST', api(`/payment-requests/${prId}/execute`), { token: tr.token, body: exec })).body.code).toBe('NOT_APPROVED');
    const txs = (await t.req('GET', api(`/transactions?projectId=${projectId}`), { token: tr.token })).body;
    txId = txs[0].id;
    expect(txs[0]).toMatchObject({ type: 'payment', amount: '300000000', reference: 'PAY-778' });
    const db = await t.services.db.tx({ tenantId: a.tenantId }, (x) => x.execute(sql`SELECT payload FROM core_outbox WHERE event_type = 'finance.payment.executed'`));
    expect(db.rows).toHaveLength(1);
  });

  it('an approver of the same request can never execute it, even with execution rights', async () => {
    // Route approvals to the company manager, who also holds every finance permission.
    await t.req('PUT', '/api/core/workflows/finance.payment', { token: a.token, body: { moduleId: 'finance', definition: { title: 'تأیید پرداخت', steps: [{ key: 'm', label: 'مدیر شرکت', approverRole: 'company_admin' }] } } });
    const r = await t.req('POST', api('/payment-requests'), { token: fm.token, body: { counterpartyId: payee, amount: '1000', dueOn: today, description: 'هزینه جزئی', categoryId: materials } });
    const item = (await t.req('GET', '/api/core/approvals', { token: a.token })).body.find((x: { entity_id: string }) => x.entity_id === r.body.id);
    await t.req('POST', `/api/core/approvals/${item.id}/decide`, { token: a.token, body: { decision: 'approve' } });
    await drain();
    expect((await t.req('POST', api(`/payment-requests/${r.body.id}/execute`), { token: a.token, body: { method: 'cash', accountId: petty, occurredOn: today } })).status).toBe(403);
    expect((await t.req('POST', api(`/payment-requests/${r.body.id}/execute`), { token: tr.token, body: { method: 'cash', accountId: petty, occurredOn: today } })).status).toBe(200);
    // The database refuses it too.
    const err = await asCompany((x) => x.execute(sql`UPDATE finance_payment_requests SET executed_by = requested_by WHERE id = ${r.body.id}`)).catch((e: Error) => e);
    expect(errText(err)).toMatch(/check constraint/i);
  });

  it('never deletes or edits an executed transaction; voiding adds a reversal', async () => {
    const upd = await asCompany((x) => x.execute(sql`UPDATE finance_transactions SET amount = 1 WHERE id = ${txId}`)).catch((e: Error) => e);
    expect(errText(upd)).toContain('immutable');
    const del = await asCompany((x) => x.execute(sql`DELETE FROM finance_transactions WHERE id = ${txId}`)).catch((e: Error) => e);
    expect(errText(del)).toContain('cannot be deleted');
    expect((await t.req('POST', api(`/transactions/${txId}/void`), { token: tr.token, body: { reason: 'برگشت وجه', occurredOn: today } })).status).toBe(403);
    expect((await t.req('POST', api(`/transactions/${txId}/void`), { token: fm.token, body: { reason: 'برگشت وجه از فروشنده', occurredOn: today } })).status).toBe(200);
    expect(await balance(bank)).toBe('1300000000');
    expect((await t.req('POST', api(`/transactions/${txId}/void`), { token: fm.token, body: { reason: 'دوباره', occurredOn: today } })).body.code).toBe('ALREADY_VOIDED');
    const all = (await t.req('GET', api(`/transactions?projectId=${projectId}`), { token: fm.token })).body;
    expect(all.map((x: { direction: string; voided_at: string | null; reverses_id: string | null }) => [x.direction, !!x.voided_at, !!x.reverses_id]).sort()).toEqual([['in', false, true], ['out', true, false]]);
  });

  it('tracks receivables and payables, partial settlement and overdue state', async () => {
    const rec = await t.req('POST', api('/obligations'), { token: fm.token, body: { kind: 'receivable', counterpartyId: payee, amount: '100000000', issuedOn: addDays(today, -40), dueOn: addDays(today, -10), description: 'صورت‌وضعیت ۲' } });
    expect((await t.req('POST', api('/receipts'), { token: fm.token, body: { accountId: bank, amount: '150000000', occurredOn: today, categoryId: income, obligationId: rec.body.id } })).body.code).toBe('OVER_SETTLE');
    await t.req('POST', api('/receipts'), { token: fm.token, body: { accountId: bank, amount: '40000000', occurredOn: today, categoryId: income, obligationId: rec.body.id } });
    let list = (await t.req('GET', api('/obligations?kind=receivable'), { token: fm.token })).body;
    expect(list[0]).toMatchObject({ paid: '40000000', remaining: '60000000', state: 'overdue' });
    expect((await t.req('POST', api(`/obligations/${rec.body.id}/cancel`), { token: fm.token })).body.code).toBe('HAS_PAYMENTS');
    await t.req('POST', api('/receipts'), { token: fm.token, body: { accountId: bank, amount: '60000000', occurredOn: today, categoryId: income, obligationId: rec.body.id } });
    list = (await t.req('GET', api('/obligations?kind=receivable'), { token: fm.token })).body;
    expect(list[0].state).toBe('settled');
  });

  it('clears received and issued cheques into transactions', async () => {
    const c = await t.req('POST', api('/cheques'), { token: fm.token, body: { number: '778899', bankName: 'ملت', amount: '20000000', dueOn: today, counterpartyId: payee, categoryId: income } });
    expect((await t.req('POST', api('/cheques'), { token: fm.token, body: { number: '778899', bankName: 'ملت', amount: '1', dueOn: today, counterpartyId: payee, categoryId: income } })).body.code).toBe('DUPLICATE');
    const before = BigInt(await balance(bank));
    expect((await t.req('POST', api(`/cheques/${c.body.id}/action`), { token: fm.token, body: { action: 'clear', occurredOn: today } })).status).toBe(400);
    expect((await t.req('POST', api(`/cheques/${c.body.id}/action`), { token: fm.token, body: { action: 'clear', accountId: bank, occurredOn: today } })).status).toBe(200);
    expect(BigInt(await balance(bank)) - before).toBe(20_000_000n);
    expect((await t.req('POST', api(`/cheques/${c.body.id}/action`), { token: fm.token, body: { action: 'bounce', occurredOn: today } })).body.code).toBe('FINISHED');
  });

  it('versions budgets, needs a second person to approve, and estimates at completion from progress', async () => {
    const draft = await t.req('PUT', api(`/budgets/${projectId}/draft`), { token: fm.token, body: { lines: [{ categoryId: materials, amount: '1000000000' }] } });
    expect(draft.status, JSON.stringify(draft.body)).toBe(200);
    expect((await t.req('POST', api(`/budget-versions/${draft.body.id}/approve`), { token: fm.token })).status).toBe(403);
    expect((await t.req('POST', api(`/budget-versions/${draft.body.id}/approve`), { token: a.token })).status).toBe(200);
    // Physical progress 50% (one activity), actual cost 600m → CPI 0.833, EAC 1.2bn.
    const act = await t.req('POST', papi(`/${projectId}/activities`), { token: a.token, body: { name: 'اجرای سوله', durationDays: 60 } });
    await t.req('POST', papi(`/${projectId}/activities/${act.body.id}/progress`), { token: a.token, body: { date: today, percent: 50 } });
    const r2 = await t.req('POST', api('/payment-requests'), { token: fm.token, body: { counterpartyId: payee, amount: '600000000', dueOn: today, description: 'مصالح', categoryId: materials, projectId } });
    const item = (await t.req('GET', '/api/core/approvals', { token: a.token })).body.find((x: { entity_id: string }) => x.entity_id === r2.body.id);
    await t.req('POST', `/api/core/approvals/${item.id}/decide`, { token: a.token, body: { decision: 'approve' } });
    await drain();
    expect((await t.req('POST', api(`/payment-requests/${r2.body.id}/execute`), { token: tr.token, body: { method: 'transfer', accountId: bank, occurredOn: today, bankReference: 'X1' } })).status).toBe(200);
    await t.req('POST', api('/commitments'), { token: fm.token, body: { projectId, categoryId: materials, amount: '250000000', description: 'قرارداد نصب' } });
    const d = (await t.req('GET', api(`/budgets/${projectId}`), { token: req.token })).body;
    expect(d.summary).toEqual({ bac: '1000000000', actual: '600000000', committed: '250000000', available: '150000000' });
    expect(d.eac).toMatchObject({ method: 'cpi', ev: '500000000', eac: '1200000000', vac: '-200000000' });
    expect(d.byCategory[0]).toMatchObject({ budget: '1000000000', actual: '600000000', committed: '250000000', remaining: '150000000' });
    expect((await t.req('GET', api(`/budgets/${otherProject}`), { token: req.token })).status).toBe(403);
    // A new method version: manual ETC.
    await t.req('POST', api('/eac-methods'), { token: fm.token, body: { method: 'manual_etc' } });
    await t.req('POST', api(`/budgets/${projectId}/etc`), { token: fm.token, body: { amount: '450000000' } });
    expect((await t.req('GET', api(`/budgets/${projectId}`), { token: fm.token })).body.eac).toMatchObject({ method: 'manual_etc', methodVersion: 1, eac: '1050000000' });
  });

  it('forecasts cash flow with firm and estimated items kept apart', async () => {
    await t.req('POST', api('/obligations'), { token: fm.token, body: { kind: 'payable', counterpartyId: payee, amount: '70000000', issuedOn: today, dueOn: addDays(today, 3), description: 'اجاره تجهیزات' } });
    await t.req('POST', api('/forecasts'), { token: fm.token, body: { direction: 'in', amount: '90000000', expectedOn: addDays(today, 5), description: 'صورت‌وضعیت ۳ (تخمینی)' } });
    const f = (await t.req('GET', api(`/cashflow?from=${today}&months=3`), { token: fm.token })).body;
    const opening = BigInt(f.opening);
    const firstOrSecond = f.months.slice(0, 2);
    const firmOut = firstOrSecond.reduce((s: bigint, m: { firmOut: string }) => s + BigInt(m.firmOut), 0n);
    const estIn = firstOrSecond.reduce((s: bigint, m: { estimateIn: string }) => s + BigInt(m.estimateIn), 0n);
    expect(firmOut).toBe(70_000_000n);
    expect(estIn).toBe(90_000_000n);
    expect(BigInt(f.months[2].firmBalance)).toBe(opening - 70_000_000n);
    expect(BigInt(f.months[2].balance)).toBe(opening - 70_000_000n + 90_000_000n);
  });

  it('imports a bank statement and matches it to transactions', async () => {
    const [y, m, d] = [today.slice(0, 4), today.slice(5, 7), today.slice(8, 10)];
    const csv = `date,amount,ref,desc\n${y}-${m}-${d},500000000,,پیش‌دریافت\n${y}-${m}-${d},-600000000,X1,مصالح\n${y}-${m}-${d},12345,,ناشناخته\nbad,1,,`;
    const r = await t.req('POST', api('/reconciliation/statements'), { token: tr.token, body: { accountId: bank, csv } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ imported: 3, matched: 2 });
    expect(r.body.errors).toHaveLength(1);
    const v = (await t.req('GET', api(`/reconciliation/${bank}`), { token: tr.token })).body;
    expect(v.unmatchedLines).toBe(1);
    const unmatched = v.lines.find((l: { transaction_id: string | null }) => !l.transaction_id);
    const someTx = v.transactions.find((x: { matched: boolean }) => !x.matched);
    expect((await t.req('PUT', api(`/reconciliation/lines/${unmatched.id}`), { token: tr.token, body: { transactionId: someTx.id } })).body.code).toBe('AMOUNT');
    expect((await t.req('POST', api('/reconciliation/statements'), { token: tr.token, body: { accountId: petty, csv } })).body.code).toBe('NOT_BANK');
  });

  it('turns procurement events into commitments and payables, once', async () => {
    const companyId = (await t.req('GET', '/api/core/me', { token: a.token })).body.company.id;
    const publish = (type: string, payload: unknown) => t.services.db.tx({ tenantId: a.tenantId }, (x) => t.services.events.publish(x as never, { tenantId: a.tenantId, companyId, moduleId: 'procurement', type, payload }));
    const supplier = { id: '0190a7d4-6c1e-7a00-8000-0000000000aa', name: 'بتن آماده تهران' };
    for (let i = 0; i < 2; i++) {
      await publish('procurement.order.approved', { orderId: 'o-1', number: 'PO-1', companyId, supplier, amount: '80000000', projectId });
      await publish('procurement.invoice.approved', { invoiceId: 'i-1', number: 'INV-9', companyId, supplier, amount: '80000000', issuedOn: today, dueOn: addDays(today, 30), projectId, orderNumber: 'PO-1' });
    }
    await drain();
    const payables = (await t.req('GET', api('/obligations?kind=payable'), { token: fm.token })).body.filter((o: { source: string }) => o.source === 'procurement');
    expect(payables).toHaveLength(1);
    expect(payables[0]).toMatchObject({ counterparty_name: 'بتن آماده تهران', amount: '80000000' });
    const d = (await t.req('GET', api(`/budgets/${projectId}`), { token: fm.token })).body;
    expect(d.commitments.filter((c: { source: string }) => c.source === 'procurement')).toHaveLength(1);
  });

  it('stays tenant-isolated and shows dashboard figures', async () => {
    expect((await t.req('GET', api('/accounts'), { token: b.token })).body).toEqual([]);
    expect((await t.req('POST', api(`/transactions/${txId}/void`), { token: b.token, body: { reason: 'xxx', occurredOn: today } })).status).toBe(404);
    const w = (await t.req('GET', '/api/core/widgets/finance/finance.cash', { token: fm.token })).body.data;
    expect(BigInt(w.total)).toBe(BigInt(await balance(bank)) + BigInt(await balance(petty)));
  });
});
