import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningKey } from '@mohandesyar/module-package';
import { addDays, todayIso } from '@mohandesyar/persian';
import { TestApp } from '../helpers/app.js';
import { buildModule } from '../helpers/packages.js';

/**
 * procurement (with projects and finance): suppliers, purchase request in project scope with a budget check,
 * request and order approval through the core workflow, RFQ comparison and award, partial receipts, the
 * three-way match on invoices with separation of duties, the events into finance (commitment, payable),
 * reports and tenant isolation.
 */
let t: TestApp;
let a: { token: string; tenantId: string };
let b: { token: string; tenantId: string };
let pm: { token: string; userId: string };
let pm2: { token: string; userId: string };
let ap: { token: string; userId: string };
let sk: { token: string; userId: string };
let fm: { token: string; userId: string };
const api = (p: string) => `/api/m/procurement/v1${p}`;
const fapi = (p: string) => `/api/m/finance/v1${p}`;
const papi = (p: string) => `/api/m/projects/v1/projects${p}`;
const today = todayIso();
let projectId = '';
let otherProject = '';
let s1 = '';
let s2 = '';
let blocked = '';
let reqId = '';
let rfqId = '';
let orderId = '';
const drain = async () => {
  while ((await t.services.events.dispatchOnce()) > 0);
};
const approve = async (who: { token: string }, entityId: string) => {
  const item = (await t.req('GET', '/api/core/approvals', { token: who.token })).body.find((x: { entity_id: string }) => x.entity_id === entityId);
  expect(item, 'approval item').toBeTruthy();
  expect((await t.req('POST', `/api/core/approvals/${item.id}/decide`, { token: who.token, body: { decision: 'approve' } })).status).toBe(200);
  await drain();
};

beforeAll(async () => {
  t = await TestApp.start();
  const admin = await t.consoleAdmin();
  const key = generateSigningKey();
  a = await t.signup('pro-a');
  b = await t.signup('pro-b');
  await t.installModules(admin, key.publicKeyPem, [await buildModule('projects', key), await buildModule('finance', key), await buildModule('procurement', key)], [a.tenantId, b.tenantId]);
  pm = await t.member(a.token, 'procurement_manager', 'pm');
  pm2 = await t.member(a.token, 'procurement_manager', 'pm2');
  ap = await t.member(a.token, 'invoice_approver', 'ap');
  sk = await t.member(a.token, 'site_storekeeper', 'sk');
  fm = await t.member(a.token, 'finance_manager', 'fm');
  projectId = (await t.req('POST', papi(''), { token: a.token, body: { code: 'P-1', title: 'ساختمان اداری', status: 'active' } })).body.id;
  otherProject = (await t.req('POST', papi(''), { token: a.token, body: { code: 'P-2', title: 'پروژه دیگر', status: 'active' } })).body.id;
  await t.req('POST', papi(`/${projectId}/members`), { token: a.token, body: { userId: sk.userId, role: 'engineer' } });
  // Approved project budget of 100m rial in finance.
  const materials = ((await t.req('GET', fapi('/categories'), { token: fm.token })).body as { id: string; name: string }[]).find((c) => c.name === 'مصالح و تجهیزات')!.id;
  const draft = await t.req('PUT', fapi(`/budgets/${projectId}/draft`), { token: fm.token, body: { lines: [{ categoryId: materials, amount: '100000000' }] } });
  expect((await t.req('POST', fapi(`/budget-versions/${draft.body.id}/approve`), { token: a.token })).status).toBe(200);
}, 240_000);
afterAll(async () => t?.stop());

describe('procurement', () => {
  it('keeps a supplier register; blocked suppliers need a reason', async () => {
    expect((await t.req('POST', api('/suppliers'), { token: pm.token, body: { name: 'آهن‌آلات', iban: '123' } })).body.details[0].message).toBe('شماره شبا معتبر نیست');
    expect((await t.req('POST', api('/suppliers'), { token: pm.token, body: { name: 'مسدود', status: 'blocked' } })).body.details[0].message).toBe('دلیل مسدودسازی را بنویسید');
    const cat = (await t.req('POST', api('/categories'), { token: pm.token, body: { name: 'فولاد' } })).body.id;
    s1 = (await t.req('POST', api('/suppliers'), { token: pm.token, body: { name: 'فولاد البرز', iban: '062960000000100324200001', categoryIds: [cat] } })).body.id;
    s2 = (await t.req('POST', api('/suppliers'), { token: pm.token, body: { name: 'آهن پارس' } })).body.id;
    blocked = (await t.req('POST', api('/suppliers'), { token: pm.token, body: { name: 'تأمین بدقول', status: 'blocked', blockReason: 'تأخیر مکرر در تحویل' } })).body.id;
    const list = (await t.req('GET', api('/suppliers'), { token: pm.token })).body;
    expect(list.find((s: { id: string }) => s.id === s1)).toMatchObject({ iban: 'IR062960000000100324200001', categories: ['فولاد'] });
    expect((await t.req('GET', api('/suppliers'), { token: sk.token })).status).toBe(403);
  });

  it('raises a request in the user\'s own project, checks the budget and routes it for approval', async () => {
    const body = { title: 'میلگرد فونداسیون', lines: [{ description: 'میلگرد ۱۶', unit: 'کیلوگرم', quantity: '10000', estimatedUnitPrice: '15000' }] };
    expect((await t.req('POST', api('/requests'), { token: sk.token, body })).status).toBe(403);
    expect((await t.req('POST', api('/requests'), { token: sk.token, body: { ...body, projectId: otherProject } })).status).toBe(403);
    const r = await t.req('POST', api('/requests'), { token: sk.token, body: { ...body, projectId } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    reqId = r.body.id;
    // 150m estimate against a 100m budget: a warning, not a block.
    expect(r.body.budget).toMatchObject({ bac: '100000000', available: '100000000', exceeds: true });
    expect((await t.req('GET', api('/requests'), { token: sk.token })).body.map((x: { id: string }) => x.id)).toEqual([reqId]);
    expect((await t.req('POST', '/api/core/approvals/none/decide', { token: sk.token, body: { decision: 'approve' } })).status).toBeGreaterThanOrEqual(400);
    await approve(pm, reqId);
    expect((await t.req('GET', api(`/requests/${reqId}`), { token: sk.token })).body.request.status).toBe('approved');
  });

  it('compares quotes and requires a reason to award other than the lowest', async () => {
    const rfq = await t.req('POST', api('/rfqs'), { token: pm.token, body: { requestId: reqId, dueOn: addDays(today, 3) } });
    expect(rfq.status, JSON.stringify(rfq.body)).toBe(201);
    rfqId = rfq.body.id;
    const lineId = (await t.req('GET', api(`/rfqs/${rfqId}`), { token: pm.token })).body.lines[0].id;
    expect((await t.req('POST', api(`/rfqs/${rfqId}/quotes`), { token: pm.token, body: { supplierId: blocked, receivedOn: today, prices: [{ requestLineId: lineId, unitPrice: '1' }] } })).body.code).toBe('BLOCKED');
    expect((await t.req('POST', api(`/rfqs/${rfqId}/quotes`), { token: pm.token, body: { supplierId: s1, receivedOn: today, deliveryDays: 5, prices: [{ requestLineId: lineId, unitPrice: '9000' }] } })).status).toBe(201);
    const q2 = await t.req('POST', api(`/rfqs/${rfqId}/quotes`), { token: pm.token, body: { supplierId: s2, receivedOn: today, prices: [{ requestLineId: lineId, unitPrice: '8000' }] } });
    const d = (await t.req('GET', api(`/rfqs/${rfqId}`), { token: pm.token })).body;
    expect(d.comparison.lowest).toBe(s2);
    expect(d.comparison.totals.find((x: { supplierId: string }) => x.supplierId === s1).total).toBe('90000000');
    const q1 = d.quotes.find((x: { supplier_id: string }) => x.supplier_id === s1).id;
    expect((await t.req('POST', api(`/rfqs/${rfqId}/award`), { token: pm.token, body: { quoteId: q1, expectedOn: addDays(today, 5) } })).body.code).toBe('REASON');
    const o = await t.req('POST', api(`/rfqs/${rfqId}/award`), { token: pm.token, body: { quoteId: q1, reason: 'تحویل سریع‌تر', expectedOn: addDays(today, 5) } });
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    expect(o.body.total).toBe('90000000');
    orderId = o.body.id;
    expect((await t.req('POST', api(`/rfqs/${rfqId}/award`), { token: pm.token, body: { quoteId: q2.body.id, reason: 'دوباره', expectedOn: addDays(today, 5) } })).body.code).toBe('CLOSED');
  });

  it('approves the order by someone else and commits it in the project budget', async () => {
    const own = (await t.req('GET', '/api/core/approvals', { token: pm.token })).body.find((x: { entity_id: string }) => x.entity_id === orderId);
    expect(own).toBeUndefined(); // the creator is not offered his own order
    await approve(pm2, orderId);
    expect((await t.req('GET', api(`/orders/${orderId}`), { token: pm.token })).body.order.status).toBe('approved');
    const budget = (await t.req('GET', fapi(`/budgets/${projectId}`), { token: fm.token })).body;
    expect(budget.commitments.filter((c: { source: string }) => c.source === 'procurement')).toHaveLength(1);
    // The request now sees the commitment: 90m of 100m committed.
    expect((await t.req('GET', api(`/requests/${reqId}`), { token: pm.token })).body.budget).toMatchObject({ committed: '90000000', available: '10000000' });
  });

  it('records partial receipts from the site, never above the ordered quantity', async () => {
    const lines = (await t.req('GET', api(`/orders/${orderId}`), { token: sk.token })).body.lines;
    const l = lines[0].id;
    expect((await t.req('GET', api('/orders'), { token: sk.token })).body).toHaveLength(1);
    expect((await t.req('POST', api(`/orders/${orderId}/receipts`), { token: sk.token, body: { receivedOn: today, lines: [{ orderLineId: l, accepted: '10001' }] } })).body.code).toBe('OVER_RECEIPT');
    expect((await t.req('POST', api(`/orders/${orderId}/receipts`), { token: sk.token, body: { receivedOn: today, documentNo: 'B-12', lines: [{ orderLineId: l, accepted: '6000', rejected: '200', note: 'زنگ‌زده' }] } })).status).toBe(201);
    const d = (await t.req('GET', api(`/orders/${orderId}`), { token: pm.token })).body;
    expect(d.lines[0]).toMatchObject({ accepted: '6000.000', rejected: '200.000' });
    expect(d.order.receivedPct).toBe(60);
  });

  it('three-way matches invoices; the recorder never approves; a mismatch needs a written reason', async () => {
    const l = (await t.req('GET', api(`/orders/${orderId}`), { token: pm.token })).body.lines[0].id;
    // 8000 kg invoiced, only 6000 accepted.
    const bad = await t.req('POST', api('/invoices'), { token: pm.token, body: { orderId, number: 'F-100', issuedOn: today, dueOn: addDays(today, 30), amount: '72000000', lines: [{ orderLineId: l, quantity: '8000', unitPrice: '9000' }] } });
    expect(bad.status, JSON.stringify(bad.body)).toBe(201);
    expect(bad.body.match.ok).toBe(false);
    expect(bad.body.match.issues[0].kind).toBe('not_received');
    expect((await t.req('POST', api(`/invoices/${bad.body.id}/decision`), { token: pm.token, body: { decision: 'approve' } })).status).toBe(403);
    expect((await t.req('POST', api(`/invoices/${bad.body.id}/decision`), { token: ap.token, body: { decision: 'approve' } })).body.code).toBe('MATCH_FAILED');
    expect((await t.req('POST', api(`/invoices/${bad.body.id}/decision`), { token: ap.token, body: { decision: 'reject' } })).status).toBe(400);
    expect((await t.req('POST', api(`/invoices/${bad.body.id}/decision`), { token: ap.token, body: { decision: 'reject', note: 'مقدار بیش از تحویل' } })).body.status).toBe('rejected');
    expect((await t.req('POST', api('/invoices'), { token: pm.token, body: { orderId, number: 'F-100', issuedOn: today, dueOn: today, amount: '1', lines: [{ orderLineId: l, quantity: '1', unitPrice: '1' }] } })).body.code).toBe('DUPLICATE');
    const good = await t.req('POST', api('/invoices'), { token: pm.token, body: { orderId, number: 'F-101', issuedOn: today, dueOn: addDays(today, 30), amount: '54000000', lines: [{ orderLineId: l, quantity: '6000', unitPrice: '9000' }] } });
    expect(good.body.match.ok).toBe(true);
    expect((await t.req('POST', api(`/invoices/${good.body.id}/decision`), { token: ap.token, body: { decision: 'approve' } })).body.status).toBe('approved');
    await drain();
    const payables = (await t.req('GET', fapi('/obligations?kind=payable'), { token: fm.token })).body.filter((o: { source: string }) => o.source === 'procurement');
    expect(payables).toHaveLength(1);
    expect(payables[0]).toMatchObject({ amount: '54000000' });
    // Invoicing the remaining 4000 kg before it is received is again a mismatch.
    const early = await t.req('POST', api('/invoices'), { token: pm.token, body: { orderId, number: 'F-102', issuedOn: today, dueOn: addDays(today, 30), amount: '36000000', lines: [{ orderLineId: l, quantity: '4000', unitPrice: '9000' }] } });
    expect(early.body.match.ok).toBe(false);
    expect((await t.req('POST', api(`/invoices/${early.body.id}/decision`), { token: ap.token, body: { decision: 'approve', overrideReason: 'تحویل مستقیم به کارفرما؛ صورت‌جلسه پیوست' } })).body.status).toBe('approved');
    const companyIds = (await t.req('GET', '/api/core/me', { token: a.token })).body.company.ids;
    const db = await t.services.db.tx({ tenantId: a.tenantId, companyIds }, (x) => x.execute(sql`SELECT override_reason FROM procurement_invoices WHERE id = ${early.body.id}`));
    expect((db.rows[0] as { override_reason: string }).override_reason).toContain('صورت‌جلسه');
  });

  it('rates suppliers and reports spend and lateness', async () => {
    expect((await t.req('POST', api(`/orders/${orderId}/rating`), { token: pm.token, body: { quality: 4, delivery: 5, price: 3 } })).status).toBe(200);
    expect((await t.req('GET', api('/suppliers'), { token: pm.token })).body.find((s: { id: string }) => s.id === s1).rating).toBe(4);
    const r = (await t.req('GET', api(`/reports?from=${addDays(today, -1)}&to=${today}`), { token: pm.token })).body;
    expect(r.bySupplier).toMatchObject([{ id: s1, orders: 1, amount: '90000000' }]);
    expect(r.byCategory[0]).toMatchObject({ name: 'بدون دسته', amount: '90000000' });
    expect(r.late).toEqual([]);
    expect((await t.req('GET', api(`/reports?from=${today}&to=${addDays(today, -1)}`), { token: pm.token })).body.code).toBe('RANGE');
    expect((await t.req('GET', api('/reports?from=2020-01-01&to=2020-01-02'), { token: sk.token })).status).toBe(403);
  });

  it('closes the order and the request; tenants never see each other', async () => {
    expect((await t.req('POST', api(`/orders/${orderId}/cancel`), { token: pm.token })).body.code).toBe('HAS_RECEIPTS');
    expect((await t.req('POST', api(`/orders/${orderId}/close`), { token: pm.token })).status).toBe(200);
    expect((await t.req('GET', api(`/requests/${reqId}`), { token: pm.token })).body.request.status).toBe('closed');
    expect((await t.req('POST', api(`/orders/${orderId}/receipts`), { token: sk.token, body: { receivedOn: today, lines: [] } })).status).toBe(400);
    expect((await t.req('GET', api('/suppliers'), { token: b.token })).body).toEqual([]);
    expect((await t.req('GET', api(`/orders/${orderId}`), { token: b.token })).status).toBe(404);
  });
});
