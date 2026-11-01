import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningKey } from '@mohandesyar/module-package';
import { addDays, todayIso, toJalali } from '@mohandesyar/persian';
import { TestApp } from '../helpers/app.js';
import { buildModule } from '../helpers/packages.js';

/**
 * accounting: default chart and fiscal year, vouchers (draft → posted with separation of duties, immutable,
 * reversal), treasury and cheque life cycle, items with moving-average inventory, purchase/sale invoices with
 * VAT and COGS, seasonal VAT report, fixed assets (depreciation, disposal), statements that balance, draft
 * vouchers from procurement/finance events, year-end closing with opening voucher, tenant isolation.
 */
let t: TestApp;
let a: { token: string; tenantId: string };
let b: { token: string; tenantId: string };
let acc: { token: string; userId: string };
let chief: { token: string; userId: string };
const api = (p: string) => `/api/m/accounting/v1${p}`;
const today = todayIso();
const ids: Record<string, string> = {};
const drain = async () => {
  while ((await t.services.events.dispatchOnce()) > 0);
};
type Acc = { id: string; code: string; system_key: string | null };
let accounts: Acc[] = [];
const byCode = (c: string) => accounts.find((x) => x.code === c)!.id;
const get = async (token: string, p: string) => (await t.req('GET', api(p), { token })).body;
const ok = (r: { status: number; body: unknown }, code = 200) => expect(r.status, JSON.stringify(r.body)).toBe(code);
const yearRange = async () => (await get(chief.token, '/years'))[0] as { id: string; start_on: string; end_on: string };

beforeAll(async () => {
  t = await TestApp.start();
  const admin = await t.consoleAdmin();
  const key = generateSigningKey();
  a = await t.signup('acc-a');
  b = await t.signup('acc-b');
  await t.installModules(admin, key.publicKeyPem, [await buildModule('accounting', key)], [a.tenantId, b.tenantId]);
  acc = await t.member(a.token, 'accountant', 'acc');
  chief = await t.member(a.token, 'chief_accountant', 'chief');
}, 240_000);
afterAll(async () => t?.stop());

describe('accounting', () => {
  it('creates the default chart and the current fiscal year on first use', async () => {
    accounts = await get(acc.token, '/accounts');
    expect(accounts.length).toBeGreaterThan(80);
    expect(accounts.find((x) => x.code === '1201')!.system_key).toBe('receivable');
    const y = await yearRange();
    const [gy, gm, gd] = y.start_on.split('-').map(Number) as [number, number, number];
    expect(toJalali(gy, gm, gd)).toMatchObject({ jm: 1, jd: 1 });
    expect(y.start_on <= today && today <= y.end_on).toBe(true);
    expect((await t.req('POST', api('/accounts'), { token: acc.token, body: { parentId: byCode('81'), code: '8110', name: 'هزینه آموزش' } })).status).toBe(403);
    expect((await t.req('POST', api('/accounts'), { token: chief.token, body: { parentId: byCode('81'), code: '9110', name: 'هزینه آموزش' } })).body.code).toBe('ACCOUNT_CODE');
    ok(await t.req('POST', api('/accounts'), { token: chief.token, body: { parentId: byCode('81'), code: '8110', name: 'هزینه آموزش' } }), 201);
    expect((await t.req('PUT', api(`/accounts/${byCode('1101')}`), { token: chief.token, body: { name: 'صندوق', needsDetail: true, active: false } })).body.code).toBe('SYSTEM_ACCOUNT');
  });

  it('sets up parties, treasury accounts and a posted opening voucher with separation of duties', async () => {
    const d = (body: Record<string, unknown>) => t.req('POST', api('/details'), { token: acc.token, body });
    expect((await d({ name: 'شرکت الف', kind: 'company', economicCode: '123' })).body.code).toBe('VALIDATION_FAILED');
    const cust = await d({ name: 'شرکت ساختمانی البرز', kind: 'company', nationalId: '10101234567', economicCode: '411111111111' });
    ok(cust, 201);
    ids.customer = cust.body.id;
    ids.supplier = (await d({ name: 'فروشگاه مصالح پارس', kind: 'company' })).body.id;
    ids.partner = (await d({ name: 'رضا محمدی (شریک)', kind: 'person' })).body.id;
    expect((await t.req('POST', api('/treasury/accounts'), { token: acc.token, body: { kind: 'bank', name: 'بانک ملت جاری' } })).status).toBe(403);
    const bank = await t.req('POST', api('/treasury/accounts'), { token: chief.token, body: { kind: 'bank', name: 'بانک ملت جاری', bankName: 'ملت', iban: 'IR062960000000100324200001' } });
    ok(bank, 201);
    ids.bank = bank.body.id;
    ids.cash = (await t.req('POST', api('/treasury/accounts'), { token: chief.token, body: { kind: 'cash', name: 'صندوق دفتر مرکزی' } })).body.id;
    const tr = (await get(acc.token, '/treasury/accounts')) as { id: string; detail_id: string }[];
    ids.bankDetail = tr.find((x) => x.id === ids.bank)!.detail_id;

    const lines = [
      { accountId: byCode('1102'), detailId: ids.bankDetail, debit: '1000000000', credit: '0' },
      { accountId: byCode('5101'), detailId: ids.partner, debit: '0', credit: '1000000000' },
    ];
    expect((await t.req('POST', api('/vouchers'), { token: acc.token, body: { date: today, lines: [{ ...lines[0], credit: '5' }, lines[1]] } })).body.code).toBe('VALIDATION_FAILED');
    expect((await t.req('POST', api('/vouchers'), { token: acc.token, body: { date: today, lines: [{ ...lines[0], accountId: byCode('11') }, lines[1]] } })).body.code).toBe('ACCOUNT_LEVEL');
    const unbalanced = await t.req('POST', api('/vouchers'), { token: acc.token, body: { date: today, description: 'نامتوازن', lines: [lines[0], { ...lines[1], credit: '999' }] } });
    ok(unbalanced, 201);
    expect((await t.req('POST', api(`/vouchers/${unbalanced.body.id}/post`), { token: chief.token })).body.code).toBe('UNBALANCED');
    ok(await t.req('POST', api(`/vouchers/${unbalanced.body.id}/delete`), { token: acc.token }));
    const noDetail = await t.req('POST', api('/vouchers'), { token: acc.token, body: { date: today, lines: [{ ...lines[0], detailId: null }, lines[1]] } });
    expect((await t.req('POST', api(`/vouchers/${noDetail.body.id}/post`), { token: chief.token })).body.code).toBe('DETAIL_REQUIRED');
    await t.req('POST', api(`/vouchers/${noDetail.body.id}/delete`), { token: acc.token });

    const v = await t.req('POST', api('/vouchers'), { token: acc.token, body: { date: today, description: 'آورده نقدی شریک', lines } });
    ok(v, 201);
    ids.capital = v.body.id;
    expect((await t.req('POST', api(`/vouchers/${v.body.id}/post`), { token: acc.token })).status).toBe(403); // accountant lacks accounting.post
    const self = await t.req('POST', api('/vouchers'), { token: chief.token, body: { date: today, lines } });
    expect((await t.req('POST', api(`/vouchers/${self.body.id}/post`), { token: chief.token })).body.code).toBe('FORBIDDEN'); // SoD
    await t.req('POST', api(`/vouchers/${self.body.id}/delete`), { token: chief.token });
    const p = await t.req('POST', api(`/vouchers/${v.body.id}/post`), { token: chief.token });
    ok(p);
    expect(p.body.number).toBe(1);
    expect((await t.req('PUT', api(`/vouchers/${v.body.id}`), { token: acc.token, body: { date: today, lines } })).body.code).toBe('VOUCHER_STATE');
    expect((await t.req('POST', api(`/vouchers/${v.body.id}/delete`), { token: acc.token })).body.code).toBe('VOUCHER_STATE');
  });

  it('keeps moving-average inventory through opening stock, purchase and sale invoices with VAT', async () => {
    const item = (body: Record<string, unknown>) => t.req('POST', api('/items'), { token: acc.token, body });
    ids.cement = (await item({ code: 'C1', name: 'سیمان پاکتی', kind: 'goods', unit: 'کیسه', salePrice: '100000' })).body.id;
    ids.service = (await item({ code: 'S1', name: 'خدمات نصب', kind: 'service', unit: 'سرویس' })).body.id;
    const wh = (await get(acc.token, '/warehouses'))[0].id;
    const open = await t.req('POST', api('/stock/adjustments'), { token: acc.token, body: { date: today, warehouseId: wh, kind: 'opening', lines: [{ itemId: ids.cement, qty: '100', unitCost: '50000' }] } });
    ok(open, 201);
    expect(open.body.total).toBe('5000000');

    const purchase = await t.req('POST', api('/invoices'), { token: acc.token, body: { kind: 'purchase', date: today, detailId: ids.supplier, lines: [{ itemId: ids.cement, qty: '50', unitPrice: '60000' }] } });
    ok(purchase, 201);
    expect(purchase.body.total).toBe('3300000'); // 3,000,000 + 10% VAT
    expect((await t.req('POST', api(`/invoices/${purchase.body.id}/approve`), { token: acc.token })).status).toBe(403);
    ok(await t.req('POST', api(`/invoices/${purchase.body.id}/approve`), { token: chief.token }));
    ids.purchase = purchase.body.id;

    const tooMuch = await t.req('POST', api('/invoices'), { token: acc.token, body: { kind: 'sale', date: today, detailId: ids.customer, lines: [{ itemId: ids.cement, qty: '151', unitPrice: '100000' }] } });
    expect((await t.req('POST', api(`/invoices/${tooMuch.body.id}/approve`), { token: chief.token })).body.code).toBe('NEGATIVE_STOCK');
    ok(await t.req('POST', api(`/invoices/${tooMuch.body.id}/cancel`), { token: acc.token, body: {} }));

    const sale = await t.req('POST', api('/invoices'), { token: acc.token, body: { kind: 'sale', date: today, detailId: ids.customer, lines: [
      { itemId: ids.cement, qty: '30', unitPrice: '100000' },
      { itemId: ids.service, qty: '1', unitPrice: '2500000', discount: '500000' },
    ] } });
    ok(sale, 201);
    expect(sale.body.total).toBe('5500000'); // (3,000,000 + 2,000,000) × 1.1
    ok(await t.req('POST', api(`/invoices/${sale.body.id}/approve`), { token: chief.token }));
    ids.sale = sale.body.id;
    const inv = await get(acc.token, `/invoices/${sale.body.id}`);
    const v = await get(acc.token, `/vouchers/${inv.invoice.voucher_id}`);
    const line = (code: string) => v.lines.find((l: { account_code: string }) => l.account_code === code);
    expect(line('7101').debit).toBe('1600000'); // 8,000,000 × 30 / 150
    expect(line('1201')).toMatchObject({ debit: '5500000', detail_id: ids.customer });
    expect(line('3201').credit).toBe('500000');
    const items = (await get(acc.token, '/items')) as { id: string; on_hand: string; stock_value: string }[];
    expect(items.find((x) => x.id === ids.cement)).toMatchObject({ on_hand: '120.000', stock_value: '6400000' });
  });

  it('runs receipts, payments and the cheque life cycle through the books', async () => {
    const due = addDays(today, 10);
    const receipt = await t.req('POST', api('/treasury/docs'), { token: acc.token, body: { kind: 'receipt', date: today, detailId: ids.customer, method: 'cheque', amount: '5500000', cheque: { number: '123456', sayadId: '1234567890123456', bankName: 'صادرات', dueOn: due } } });
    ok(receipt, 201);
    const cheques = (await get(acc.token, '/cheques?direction=received&open=1')) as { id: string; status: string }[];
    expect(cheques).toHaveLength(1);
    ids.cheque = cheques[0]!.id;
    const act = (id: string, body: Record<string, unknown>) => t.req('POST', api(`/cheques/${id}/action`), { token: acc.token, body: { date: today, ...body } });
    expect((await act(ids.cheque, { action: 'deposit', treasuryId: ids.cash })).body.code).toBe('TREASURY_KIND');
    ok(await act(ids.cheque, { action: 'deposit', treasuryId: ids.bank }));
    expect((await act(ids.cheque, { action: 'deposit', treasuryId: ids.bank })).body.code).toBe('CHEQUE_STATE');
    ok(await act(ids.cheque, { action: 'clear' }));
    expect((await t.req('POST', api(`/treasury/docs/${receipt.body.id}/cancel`), { token: acc.token, body: {} })).body.code).toBe('CHEQUE_MOVED');

    const bounced = await t.req('POST', api('/treasury/docs'), { token: acc.token, body: { kind: 'receipt', date: today, detailId: ids.customer, method: 'cheque', amount: '1000000', cheque: { number: '777', dueOn: today } } });
    const bid = ((await get(acc.token, '/cheques?direction=received&open=1')) as { id: string }[])[0]!.id;
    ok(await act(bid, { action: 'bounce', note: 'کسر موجودی' }));
    expect((await get(acc.token, `/cheques/${bid}/history`)).map((e: { to_status: string }) => e.to_status)).toEqual(['in_hand', 'bounced']);
    expect(bounced.status).toBe(201);

    ok(await t.req('POST', api('/treasury/docs'), { token: acc.token, body: { kind: 'payment', date: today, detailId: ids.supplier, method: 'transfer', treasuryId: ids.bank, amount: '3300000', reference: 'پایا ۹۸۷' } }), 201);
    const transfer = await t.req('POST', api('/treasury/transfers'), { token: acc.token, body: { date: today, fromId: ids.bank, toId: ids.cash, amount: '20000000' } });
    ok(transfer, 201);
    const issued = await t.req('POST', api('/treasury/docs'), { token: acc.token, body: { kind: 'payment', date: today, detailId: ids.supplier, method: 'cheque', treasuryId: ids.bank, amount: '700000', cheque: { number: 'P-1', dueOn: due } } });
    ok(issued, 201);
    ok(await t.req('POST', api(`/treasury/docs/${issued.body.id}/cancel`), { token: acc.token, body: {} }));

    const tr = (await get(acc.token, '/treasury/accounts')) as { id: string; balance: string }[];
    expect(tr.find((x) => x.id === ids.bank)!.balance).toBe(String(1_000_000_000 + 5_500_000 - 3_300_000 - 20_000_000));
    expect(tr.find((x) => x.id === ids.cash)!.balance).toBe('20000000');
    const parties = (await get(acc.token, `/reports/parties?to=${today}`)) as { id: string; receivable: string; payable: string }[];
    // customer: invoice settled by the cleared cheque; the bounced cheque put the extra payment back
    expect(parties.find((p) => p.id === ids.customer)).toBeUndefined();
    expect(parties.find((p) => p.id === ids.supplier)).toBeUndefined(); // settled (cancelled cheque reversed)
  });

  it('books fixed asset depreciation once per month and the disposal gain', async () => {
    const m = toJalali(...(today.split('-').map(Number) as [number, number, number]));
    const period = `${m.jy}-${String(m.jm).padStart(2, '0')}`;
    const acquired = addDays(today, -(m.jd)); // last day of the previous Jalali month
    const asset = await t.req('POST', api('/assets'), { token: acc.token, body: { code: 'M-01', name: 'بالابر کارگاهی', acquiredOn: acquired, cost: '120000000', method: 'straight_line', usefulLifeMonths: 60 } });
    ok(asset, 201);
    const d1 = await t.req('POST', api('/assets/depreciation'), { token: acc.token, body: { period } });
    ok(d1);
    expect(d1.body).toMatchObject({ assets: 1, total: '2000000' });
    expect((await t.req('POST', api('/assets/depreciation'), { token: acc.token, body: { period } })).body.assets).toBe(0);
    const disp = await t.req('POST', api(`/assets/${asset.body.id}/dispose`), { token: acc.token, body: { date: today, proceeds: '130000000', accountId: byCode('1102'), detailId: ids.bankDetail } });
    ok(disp);
    expect(disp.body.result).toBe('12000000');
  });

  it('produces balanced statements, ledgers and the seasonal VAT report', async () => {
    const y = await yearRange();
    for (const level of ['group', 'ledger', 'subsidiary', 'detail']) {
      const tb = await get(acc.token, `/reports/trial-balance?from=${y.start_on}&to=${today}&level=${level}`);
      expect(tb.totals.debit, level).toBe(tb.totals.credit);
      expect(tb.totals.balance).toBe('0');
    }
    const bs = await get(acc.token, `/reports/balance-sheet?to=${today}`);
    expect(BigInt(bs.totals.assets)).toBe(BigInt(bs.totals.liabilities) + BigInt(bs.totals.equity));
    const is = await get(acc.token, `/reports/income-statement?from=${y.start_on}&to=${y.end_on}`);
    // sales 3,000,000 + service 2,000,000 + asset gain 12,000,000 − COGS 1,600,000 − depreciation 2,000,000
    expect(is.totals.result).toBe(String(5_000_000 + 12_000_000 - 1_600_000 - 2_000_000));
    const led = await get(acc.token, `/reports/ledger?from=${y.start_on}&to=${today}&accountId=${byCode('12')}&detailId=${ids.customer}`);
    expect(led.closing).toBe('0');
    expect(led.lines.length).toBeGreaterThanOrEqual(8);
    const [gy, gm, gd] = today.split('-').map(Number) as [number, number, number];
    const j = toJalali(gy, gm, gd);
    const vat = await get(acc.token, `/reports/vat?year=${j.jy}&season=${Math.ceil(j.jm / 3)}`);
    expect(vat.sales).toEqual({ amount: '5000000', vat: '500000' });
    expect(vat.purchases).toEqual({ amount: '3000000', vat: '300000' });
    expect(vat.payable).toBe('200000');
    expect(vat.parties.find((p: { detail_id: string }) => p.detail_id === ids.customer)).toMatchObject({ economic_code: '411111111111', national_id: '10101234567' });
  });

  it('cancels an approved invoice with a reversal voucher and restores stock', async () => {
    const before = ((await get(acc.token, '/items')) as { id: string; on_hand: string; stock_value: string }[]).find((x) => x.id === ids.cement)!;
    const s = await t.req('POST', api('/invoices'), { token: acc.token, body: { kind: 'sale', date: today, detailId: ids.customer, lines: [{ itemId: ids.cement, qty: '10', unitPrice: '100000' }] } });
    ok(await t.req('POST', api(`/invoices/${s.body.id}/approve`), { token: chief.token }));
    expect((await t.req('POST', api(`/invoices/${s.body.id}/cancel`), { token: acc.token, body: {} })).status).toBe(403); // approved: needs approve permission
    ok(await t.req('POST', api(`/invoices/${s.body.id}/cancel`), { token: chief.token, body: {} }));
    const after = ((await get(acc.token, '/items')) as { id: string; on_hand: string; stock_value: string }[]).find((x) => x.id === ids.cement)!;
    expect(after).toMatchObject({ on_hand: before.on_hand, stock_value: before.stock_value });
    const inv = await get(acc.token, `/invoices/${s.body.id}`);
    expect((await get(acc.token, `/vouchers/${inv.invoice.voucher_id}`)).voucher.status).toBe('reversed');
    // the automatic voucher cannot be reversed from the voucher screen
    expect((await t.req('POST', api(`/vouchers/${(await get(acc.token, `/invoices/${ids.sale}`)).invoice.voucher_id}/reverse`), { token: chief.token, body: {} })).body.code).toBe('VOUCHER_SOURCE');
  });

  it('turns procurement and finance events into draft vouchers, once', async () => {
    const companyId = (await t.req('GET', '/api/core/me', { token: a.token })).body.company.id;
    const publish = (moduleId: string, type: string, payload: unknown) => t.services.db.tx({ tenantId: a.tenantId }, (x) => t.services.events.publish(x as never, { tenantId: a.tenantId, companyId, moduleId, type, payload }));
    const supplier = { id: '0190a7d4-6c1e-7a00-8000-0000000000ab', name: 'بتن آماده تهران' };
    for (let i = 0; i < 2; i++) {
      await publish('procurement', 'procurement.invoice.approved', { invoiceId: 'i-1', number: 'INV-9', companyId, supplier, amount: '80000000', issuedOn: today, dueOn: today, projectId: null, orderNumber: 'PO-1' });
      await publish('finance', 'finance.payment.executed', { paymentRequestId: 'p-1', number: 7, amount: '25000000', method: 'transfer', projectId: null });
    }
    await drain();
    const drafts = (await get(acc.token, '/vouchers?status=draft')) as { id: string; source: string; debit: string }[];
    expect(drafts.map((d) => d.source).sort()).toEqual(['finance', 'procurement']);
    const proc = await get(acc.token, `/vouchers/${drafts.find((d) => d.source === 'procurement')!.id}`);
    expect(proc.lines.find((l: { account_code: string }) => l.account_code === '3101').detail_name).toBe('بتن آماده تهران');
    // the accountant completes the finance draft (party + bank detail) and the chief posts it
    const fin = drafts.find((d) => d.source === 'finance')!;
    ok(await t.req('PUT', api(`/vouchers/${fin.id}`), { token: acc.token, body: { date: today, description: 'پرداخت به تأمین‌کننده', lines: [
      { accountId: byCode('3101'), detailId: ids.supplier, debit: '25000000', credit: '0' },
      { accountId: byCode('1102'), detailId: ids.bankDetail, debit: '0', credit: '25000000' },
    ] } }));
    ok(await t.req('POST', api(`/vouchers/${fin.id}/post`), { token: chief.token }));
    ids.procDraft = drafts.find((d) => d.source === 'procurement')!.id;
  });

  it('closes the year: temporary accounts to retained earnings, closing and opening vouchers', async () => {
    const y = await yearRange();
    const bsBefore = await get(acc.token, `/reports/balance-sheet?to=${y.end_on}`); // depreciation is dated at month end
    expect((await t.req('POST', api(`/years/${y.id}/close`), { token: acc.token })).status).toBe(403);
    expect((await t.req('POST', api(`/years/${y.id}/close`), { token: chief.token })).body.code).toBe('DRAFTS_LEFT');
    await t.req('POST', api(`/vouchers/${ids.procDraft}/delete`), { token: acc.token });
    const c = await t.req('POST', api(`/years/${y.id}/close`), { token: chief.token });
    ok(c);
    expect(c.body.incomeVoucher).not.toBeNull();
    expect(c.body.opening).toBe(1);
    const years = (await get(acc.token, '/years')) as { id: string; status: string; start_on: string }[];
    expect(years.find((x) => x.id === y.id)!.status).toBe('closed');
    const next = years.find((x) => x.start_on === addDays(y.end_on, 1))!;
    expect(next.status).toBe('open');
    // posting into the closed year is refused
    const late = await t.req('POST', api('/vouchers'), { token: acc.token, body: { date: today, lines: [
      { accountId: byCode('1101'), detailId: ids.bankDetail, debit: '1', credit: '0' }, { accountId: byCode('5301'), debit: '0', credit: '1' }] } });
    expect(late.body.code).toBe('YEAR_CLOSED');
    // the closed year's statements are unchanged; the new year opens with the same balances
    const bsAfter = await get(acc.token, `/reports/balance-sheet?to=${y.end_on}`);
    expect(bsAfter.totals).toEqual(bsBefore.totals);
    const tbNext = await get(acc.token, `/reports/trial-balance?from=${next.start_on}&to=${next.start_on}&level=group`);
    const assets = tbNext.rows.filter((r: { type: string }) => r.type === 'asset').reduce((s: bigint, r: { balance: string }) => s + BigInt(r.balance), 0n);
    expect(assets).toBe(BigInt(bsBefore.totals.assets));
    expect(tbNext.rows.some((r: { type: string }) => r.type === 'income' || r.type === 'expense')).toBe(false);
  });

  it('keeps companies of other tenants apart', async () => {
    expect(await get(b.token, '/vouchers')).toEqual([]);
    expect((await t.req('GET', api(`/vouchers/${ids.capital}`), { token: b.token })).status).toBe(404);
    expect((await t.req('POST', api(`/invoices/${ids.sale}/approve`), { token: b.token })).status).toBe(404);
    const w = (await t.req('GET', '/api/core/widgets/accounting/accounting.overview', { token: chief.token })).body.data;
    expect(BigInt(w.cash)).toBeGreaterThan(0n);
  });
});
