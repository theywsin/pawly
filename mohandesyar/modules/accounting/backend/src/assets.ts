import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { ModuleEventContext, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { addDays, todayIso } from '@mohandesyar/persian';
import { bookVoucher, detailFor, ensureBooks, one, rows, systemAccount, type Books, type LineSpec } from './books.js';
import { jalaliYearOf, monthlyDepreciation, monthRange } from './calc.js';
import { conflict, invalid, notFound } from './errors.js';
import { guardDb, withBooks } from './gl.js';
import type { assetInput, depreciationInput, disposalInput } from './inputs.js';

const subsidiary = async (tx: Parameters<Parameters<typeof withBooks>[1]>[0], b: Books, id: string, what: string) => {
  if (!(await one(tx, sql`SELECT 1 FROM accounting_accounts WHERE id = ${id} AND company_id = ${b.companyId} AND level = 'subsidiary' AND active`))) throw invalid('ACCOUNT', `${what} باید حساب معین فعال باشد`);
  return id;
};

// ---------------------------------------------------------------- fixed assets

export const Assets = {
  list(ctx: ModuleRequestContext) {
    return withBooks(ctx, (tx, b) =>
      rows(tx, sql`SELECT a.id, a.code, a.name, a.category, a.acquired_on::text, a.cost::text, a.salvage::text, a.method, a.useful_life_months, a.rate_percent::float8 AS rate_percent, a.status, a.disposed_on::text,
          (a.opening_depreciation + coalesce((SELECT sum(d.amount) FROM accounting_depreciation d WHERE d.asset_id = a.id), 0))::text AS accumulated,
          (SELECT max(d.period) FROM accounting_depreciation d WHERE d.asset_id = a.id) AS last_period
        FROM accounting_assets a WHERE a.company_id = ${b.companyId} ORDER BY a.code`),
    );
  },

  create(ctx: ModuleRequestContext, input: z.infer<typeof assetInput>) {
    return guardDb(withBooks(ctx, async (tx, b) => {
      const assetAcc = await subsidiary(tx, b, input.assetAccountId ?? (await systemAccount(tx, b, 'fixed_assets')), 'حساب دارایی');
      const depAcc = await subsidiary(tx, b, input.depreciationAccountId ?? (await systemAccount(tx, b, 'accumulated_depreciation')), 'حساب استهلاک انباشته');
      const expAcc = await subsidiary(tx, b, input.expenseAccountId ?? (await systemAccount(tx, b, 'depreciation_expense')), 'حساب هزینه استهلاک');
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO accounting_assets (id, tenant_id, company_id, code, name, category, acquired_on, cost, salvage, method, useful_life_months, rate_percent, opening_depreciation,
          asset_account_id, depreciation_account_id, expense_account_id)
        VALUES (${id}, ${b.tenantId}, ${b.companyId}, ${input.code}, ${input.name}, ${input.category}, ${input.acquiredOn}, ${input.cost}, ${input.salvage}, ${input.method},
          ${input.method === 'straight_line' ? input.usefulLifeMonths : null}, ${input.method === 'declining' ? input.ratePercent : null}, ${input.openingDepreciation}, ${assetAcc}, ${depAcc}, ${expAcc})`);
      let voucherNumber: number | null = null;
      if (input.paidFromAccountId) {
        const v = await bookVoucher(tx, b, {
          date: input.acquiredOn, description: `خرید دارایی ثابت ${input.code} — ${input.name}`, source: 'asset', sourceRef: `${id}:acquire`, post: true, userId: ctx.userId,
          lines: [{ accountId: assetAcc, debit: BigInt(input.cost) }, { accountId: input.paidFromAccountId, detailId: input.paidFromDetailId, credit: BigInt(input.cost) }],
        });
        voucherNumber = v!.number;
      }
      await ctx.audit({ action: 'accounting.asset.created', entityType: 'accounting_asset', entityId: id, after: { code: input.code, cost: input.cost } }, tx);
      return { id, voucherNumber };
    }));
  },

  /** Books the month's depreciation of every active asset in one voucher (idempotent per asset and month). */
  depreciate(ctx: ModuleRequestContext, input: z.infer<typeof depreciationInput>) {
    const range = monthRange(input.period);
    return guardDb(withBooks(ctx, async (tx, b) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`accounting-dep:${b.companyId}`}))`);
      const assets = await rows<{ id: string; code: string; acquired_on: string; cost: string; salvage: string; method: 'straight_line' | 'declining'; useful_life_months: number | null; rate_percent: number | null; accumulated: string; depreciation_account_id: string; expense_account_id: string; done: boolean }>(tx,
        sql`SELECT a.id, a.code, a.acquired_on::text, a.cost::text, a.salvage::text, a.method, a.useful_life_months, a.rate_percent::float8 AS rate_percent, a.depreciation_account_id, a.expense_account_id,
            (a.opening_depreciation + coalesce((SELECT sum(d.amount) FROM accounting_depreciation d WHERE d.asset_id = a.id AND d.period < ${input.period}), 0))::text AS accumulated,
            EXISTS (SELECT 1 FROM accounting_depreciation d WHERE d.asset_id = a.id AND d.period = ${input.period}) AS done
          FROM accounting_assets a WHERE a.company_id = ${b.companyId} AND a.status = 'active' AND a.acquired_on <= ${range.end}::date`);
      const items: { id: string; amount: bigint; exp: string; dep: string; code: string }[] = [];
      for (const a of assets) {
        if (a.done) continue;
        const amount = monthlyDepreciation({ ...a, cost: BigInt(a.cost), salvage: BigInt(a.salvage) }, input.period, BigInt(a.accumulated));
        if (amount > 0n) items.push({ id: a.id, amount, exp: a.expense_account_id, dep: a.depreciation_account_id, code: a.code });
      }
      if (!items.length) return { assets: 0, total: '0', voucherNumber: null };
      const lines: LineSpec[] = [];
      for (const i of items) lines.push({ accountId: i.exp, debit: i.amount, description: `استهلاک ${i.code}` }, { accountId: i.dep, credit: i.amount, description: `استهلاک ${i.code}` });
      const total = items.reduce((t, i) => t + i.amount, 0n);
      const v = await bookVoucher(tx, b, { date: range.end, description: `استهلاک دارایی‌های ثابت ماه ${input.period}`, source: 'depreciation', sourceRef: `${input.period}:${randomUUID()}`, lines, post: true, userId: ctx.userId });
      for (const i of items) {
        await tx.execute(sql`INSERT INTO accounting_depreciation (id, tenant_id, company_id, asset_id, period, amount, voucher_id) VALUES (${randomUUID()}, ${b.tenantId}, ${b.companyId}, ${i.id}, ${input.period}, ${i.amount.toString()}, ${v!.id})`);
      }
      await ctx.audit({ action: 'accounting.depreciation.booked', entityType: 'accounting_depreciation', entityId: v!.id, after: { period: input.period, total: total.toString() } }, tx);
      return { assets: items.length, total: total.toString(), voucherNumber: v!.number };
    }));
  },

  /** Sale or scrapping: removes cost and accumulated depreciation, books proceeds and gain/loss. */
  dispose(ctx: ModuleRequestContext, id: string, input: z.infer<typeof disposalInput>) {
    return guardDb(withBooks(ctx, async (tx, b) => {
      const a = await one<{ code: string; name: string; status: string; cost: string; accumulated: string; asset_account_id: string; depreciation_account_id: string; acquired_on: string }>(tx,
        sql`SELECT a.code, a.name, a.status, a.cost::text, a.acquired_on::text, a.asset_account_id, a.depreciation_account_id,
            (a.opening_depreciation + coalesce((SELECT sum(d.amount) FROM accounting_depreciation d WHERE d.asset_id = a.id), 0))::text AS accumulated
          FROM accounting_assets a WHERE a.id = ${id} AND a.company_id = ${b.companyId} FOR UPDATE OF a`);
      if (!a) throw notFound('دارایی');
      if (a.status !== 'active') throw conflict('ASSET_STATE', 'این دارایی قبلاً واگذار شده است');
      if (input.date < a.acquired_on) throw invalid('DATE', 'تاریخ واگذاری پیش از تاریخ خرید است');
      const proceeds = BigInt(input.proceeds);
      if (proceeds > 0n && !input.accountId) throw invalid('ACCOUNT', 'حساب دریافت مبلغ فروش را انتخاب کنید');
      const cost = BigInt(a.cost);
      const acc = BigInt(a.accumulated);
      const result = proceeds - (cost - acc);
      const lines: LineSpec[] = [
        { accountId: a.depreciation_account_id, debit: acc },
        ...(proceeds > 0n ? [{ accountId: input.accountId!, detailId: input.detailId, debit: proceeds }] : []),
        { accountId: a.asset_account_id, credit: cost },
        result > 0n ? { key: 'asset_gain' as const, credit: result } : { key: 'asset_loss' as const, debit: -result },
      ];
      const v = await bookVoucher(tx, b, { date: input.date, description: `واگذاری دارایی ${a.code} — ${a.name}${input.note ? ` — ${input.note}` : ''}`, source: 'asset', sourceRef: `${id}:dispose`, lines, post: true, userId: ctx.userId });
      await tx.execute(sql`UPDATE accounting_assets SET status = 'disposed', disposed_on = ${input.date}, disposal_voucher_id = ${v!.id} WHERE id = ${id}`);
      await ctx.audit({ action: 'accounting.asset.disposed', entityType: 'accounting_asset', entityId: id, after: { proceeds: input.proceeds, result: result.toString() } }, tx);
      return { voucherNumber: v!.number, result: result.toString() };
    }));
  },
};

// ---------------------------------------------------------------- year-end closing

/**
 * Closes a fiscal year: (1) income-closing voucher moves every income and expense balance to retained
 * earnings, (2) closing voucher (اختتامیه) zeroes the permanent accounts, (3) opening voucher (افتتاحیه)
 * restores them on the first day of the next year (created when missing). Drafts must be posted or deleted first.
 */
export function closeYear(ctx: ModuleRequestContext, yearId: string) {
  return guardDb(withBooks(ctx, async (tx, b) => {
    const y = await one<{ id: string; status: string; start_on: string; end_on: string; title: string }>(tx, sql`SELECT id, status, start_on::text, end_on::text, title FROM accounting_fiscal_years WHERE id = ${yearId} AND company_id = ${b.companyId} FOR UPDATE`);
    if (!y) throw notFound('سال مالی');
    if (y.status !== 'open') throw conflict('YEAR_CLOSED', 'این سال مالی قبلاً بسته شده است');
    const drafts = await one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM accounting_vouchers WHERE fiscal_year_id = ${yearId} AND status = 'draft'`);
    if (drafts!.n) throw conflict('DRAFTS_LEFT', `${drafts!.n.toLocaleString('fa-IR')} سند پیش‌نویس در این سال مانده است؛ آن‌ها را قطعی یا حذف کنید`);
    if (await one(tx, sql`SELECT 1 FROM accounting_fiscal_years WHERE company_id = ${b.companyId} AND end_on < ${y.start_on}::date AND status = 'open'`)) throw conflict('EARLIER_OPEN', 'ابتدا سال مالی قبلی را ببندید');
    const nextStart = addDays(y.end_on, 1);
    if (!(await one(tx, sql`SELECT 1 FROM accounting_fiscal_years WHERE company_id = ${b.companyId} AND start_on = ${nextStart}::date`))) {
      if (await one(tx, sql`SELECT 1 FROM accounting_fiscal_years WHERE company_id = ${b.companyId} AND ${nextStart}::date BETWEEN start_on AND end_on`)) throw conflict('NEXT_YEAR', 'سال مالی بعدی از روز پس از پایان این سال شروع نمی‌شود');
      const ny = jalaliYearOf(nextStart);
      const nid = randomUUID();
      await tx.execute(sql`INSERT INTO accounting_fiscal_years (id, tenant_id, company_id, title, start_on, end_on) VALUES (${nid}, ${b.tenantId}, ${b.companyId}, ${ny.title}, ${nextStart}, ${ny.end > nextStart ? ny.end : addDays(nextStart, 364)})`);
    }
    const balancesOf = (types: string) =>
      rows<{ account_id: string; detail_id: string | null; s: string }>(tx, sql`SELECT l.account_id, l.detail_id, sum(l.debit - l.credit)::text AS s
        FROM accounting_voucher_lines l JOIN accounting_vouchers v ON v.id = l.voucher_id JOIN accounting_accounts a ON a.id = l.account_id
        WHERE v.company_id = ${b.companyId} AND v.status <> 'draft' AND v.date <= ${y.end_on}::date AND a.type IN (${sql.raw(types)})
        GROUP BY l.account_id, l.detail_id HAVING sum(l.debit - l.credit) <> 0`);
    const mirror = (bal: { account_id: string; detail_id: string | null; s: string }[]): LineSpec[] =>
      bal.map((x) => (BigInt(x.s) > 0n ? { accountId: x.account_id, detailId: x.detail_id, credit: BigInt(x.s) } : { accountId: x.account_id, detailId: x.detail_id, debit: -BigInt(x.s) }));
    const temp = await balancesOf(`'income', 'expense'`);
    let incomeVoucher: number | null = null;
    if (temp.length) {
      const net = temp.reduce((t, x) => t + BigInt(x.s), 0n); // debit-positive: > 0 is a loss
      const lines = mirror(temp);
      if (net !== 0n) lines.push(net > 0n ? { key: 'retained_earnings', debit: net, description: 'زیان سال' } : { key: 'retained_earnings', credit: -net, description: 'سود سال' });
      incomeVoucher = (await bookVoucher(tx, b, { date: y.end_on, description: `بستن حساب‌های موقت ${y.title}`, kind: 'income_closing', source: 'closing', sourceRef: `${yearId}:income`, lines, post: true, userId: ctx.userId, system: true }))!.number;
    }
    const perm = await balancesOf(`'asset', 'liability', 'equity'`);
    let closing: number | null = null;
    let opening: number | null = null;
    if (perm.length) {
      closing = (await bookVoucher(tx, b, { date: y.end_on, description: `سند اختتامیه ${y.title}`, kind: 'closing', source: 'closing', sourceRef: `${yearId}:closing`, lines: mirror(perm), post: true, userId: ctx.userId, system: true }))!.number;
      const restore = perm.map((x) => (BigInt(x.s) > 0n ? { accountId: x.account_id, detailId: x.detail_id, debit: BigInt(x.s) } : { accountId: x.account_id, detailId: x.detail_id, credit: -BigInt(x.s) }));
      opening = (await bookVoucher(tx, b, { date: nextStart, description: `سند افتتاحیه (انتقال از ${y.title})`, kind: 'opening', source: 'closing', sourceRef: `${yearId}:opening`, lines: restore, post: true, userId: ctx.userId, system: true }))!.number;
    }
    await tx.execute(sql`UPDATE accounting_fiscal_years SET status = 'closed', closed_at = now(), closed_by = ${ctx.userId} WHERE id = ${yearId}`);
    await ctx.audit({ action: 'accounting.year.closed', entityType: 'accounting_fiscal_year', entityId: yearId, after: { incomeVoucher, closing, opening } }, tx);
    return { incomeVoucher, closing, opening };
  }));
}

// ---------------------------------------------------------------- integration with finance and procurement

type Ev = { tenantId: string; companyId: string | null; occurredAt: string };

/** Draft date: the document's date when it falls in an open year, else today; null when neither is open. */
async function draftDate(tx: Parameters<Parameters<typeof withBooks>[1]>[0], b: Books, day: string): Promise<string | null> {
  for (const d of [day, todayIso()]) {
    if (await one(tx, sql`SELECT 1 FROM accounting_fiscal_years WHERE company_id = ${b.companyId} AND status = 'open' AND ${d}::date BETWEEN start_on AND end_on`)) return d;
  }
  return null;
}

/** procurement.invoice.approved → draft voucher: Dr purchases/expenses, Cr supplier payable (idempotent per invoice). */
export async function onProcurementInvoice(ctx: ModuleEventContext, p: { invoiceId: string; number: string; companyId: string; supplier: { id: string; name: string }; amount: string; issuedOn: string; orderNumber: string }) {
  const b = { tenantId: ctx.tenantId, companyId: p.companyId };
  await ctx.db.transaction(async (tx) => {
    await ensureBooks(tx, b, todayIso());
    const date = await draftDate(tx, b, p.issuedOn);
    if (!date) return;
    const supplier = await detailFor(tx, b, `procurement-supplier:${p.supplier.id}`, p.supplier.name, 'company');
    const amount = BigInt(p.amount);
    await bookVoucher(tx, b, {
      date, description: `فاکتور خرید ${p.number} (سفارش ${p.orderNumber}) — ${p.supplier.name} — از ماژول تدارکات؛ پیش از قطعی کردن، حساب بدهکار (کالا/هزینه/مالیات) را بازبینی کنید`,
      source: 'procurement', sourceRef: `invoice:${p.invoiceId}`, post: false, userId: null,
      lines: [{ key: 'purchase_expense', debit: amount }, { key: 'payable', detailId: supplier, credit: amount }],
    });
  });
}

/** finance.payment.executed → draft voucher: Dr payables, Cr bank (the accountant picks the party and bank detail). */
export async function onFinancePayment(ctx: ModuleEventContext, e: Ev, p: { paymentRequestId: string; number: string | number; amount: string; method: string }) {
  if (!e.companyId) return;
  const b = { tenantId: ctx.tenantId, companyId: e.companyId };
  await ctx.db.transaction(async (tx) => {
    await ensureBooks(tx, b, todayIso());
    const date = await draftDate(tx, b, todayIso('Asia/Tehran', new Date(e.occurredAt)));
    if (!date) return;
    const amount = BigInt(p.amount);
    await bookVoucher(tx, b, {
      date, description: `پرداخت شماره ${p.number} از ماژول مالی (${p.method === 'cheque' ? 'چک' : p.method === 'cash' ? 'نقد' : 'انتقال بانکی'})؛ طرف حساب و حساب بانکی را تکمیل کنید`,
      source: 'finance', sourceRef: `payment:${p.paymentRequestId}`, post: false, userId: null,
      lines: [{ key: 'payable', debit: amount }, { key: p.method === 'cash' ? 'cash' : p.method === 'cheque' ? 'cheques_payable' : 'bank', credit: amount }],
    });
  });
}

