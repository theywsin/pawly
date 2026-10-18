import { sql } from 'drizzle-orm';
import type { Db, ModuleEventContext, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { one, type Books } from './books.js';
import { monthRange, periodOf } from './calc.js';
import { withBooks } from './gl.js';

const posted = sql`v.status <> 'draft' AND NOT (v.kind IN ('closing', 'income_closing'))`;

async function figures(tx: Db, b: Books, from: string, to: string) {
  const r = await one<{ cash: string; receivables: string; payables: string; revenue: string; profit: string }>(tx, sql`SELECT
      coalesce(sum(l.debit - l.credit) FILTER (WHERE a.system_key IN ('cash', 'bank', 'petty_cash')), 0)::text AS cash,
      coalesce(sum(l.debit - l.credit) FILTER (WHERE a.system_key IN ('receivable', 'cheques_receivable', 'cheques_in_collection')), 0)::text AS receivables,
      coalesce(sum(l.credit - l.debit) FILTER (WHERE a.system_key IN ('payable', 'cheques_payable')), 0)::text AS payables,
      coalesce(sum(l.credit - l.debit) FILTER (WHERE a.system_key IN ('sales', 'service_income', 'sales_returns') AND v.date >= ${from}::date), 0)::text AS revenue,
      coalesce(sum(l.credit - l.debit) FILTER (WHERE a.type IN ('income', 'expense') AND v.date >= ${from}::date), 0)::text AS profit
    FROM accounting_voucher_lines l JOIN accounting_vouchers v ON v.id = l.voucher_id JOIN accounting_accounts a ON a.id = l.account_id
    WHERE v.company_id = ${b.companyId} AND v.date <= ${to}::date AND ${posted}`);
  return r!;
}

/** Cash and bank, receivables, payables, this month's revenue and result, and drafts awaiting review. */
export function overviewWidget(ctx: ModuleRequestContext, today: string) {
  const m = monthRange(periodOf(today));
  return withBooks(ctx, async (tx, b) => {
    const f = await figures(tx, b, m.start, today);
    const d = await one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM accounting_vouchers WHERE company_id = ${b.companyId} AND status = 'draft'`);
    return { ...f, drafts: d!.n };
  });
}

type K = 'revenue' | 'profit' | 'cash' | 'receivables';
/** KPI providers: revenue and net result over the period; cash and receivables at its end (rial). */
export async function kpi(ctx: ModuleEventContext, p: { companyId: string; from: string; to: string }, key: K): Promise<number | null> {
  const f = await ctx.db.transaction((tx) => figures(tx, { tenantId: ctx.tenantId, companyId: p.companyId }, p.from, p.to));
  return Number(f[key]);
}
