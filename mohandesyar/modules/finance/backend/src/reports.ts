import type { ModuleRequestContext, ReportResult } from '@mohandesyar/module-sdk/server';
import { forbidden } from './errors.js';
import { Transactions } from './money.js';

const TYPE: Record<string, string> = { receipt: 'دریافت', payment: 'پرداخت', transfer: 'انتقال بین حساب‌ها' };

/** Transactions of the period (company scope only, like the transactions page). Voided ones are flagged, not hidden. */
export async function transactionsReport(ctx: ModuleRequestContext, p: { from: string; to: string; filters: Record<string, string> }): Promise<ReportResult> {
  if (!ctx.can('finance.transaction.view', 'company')) throw forbidden('دسترسی به تراکنش‌ها ندارید');
  const type = p.filters.type as 'receipt' | 'payment' | 'transfer' | undefined;
  const list = (await Transactions.list(ctx, { from: p.from, to: p.to, type })) as Record<string, string | null>[];
  const v = (t: Record<string, string | null>, k: string) => t[k] ?? null;
  return {
    columns: [
      { key: 'date', header: 'تاریخ', kind: 'date' }, { key: 'type', header: 'نوع' }, { key: 'account', header: 'حساب' }, { key: 'amount', header: 'مبلغ (ریال، ورودی مثبت)', kind: 'number' },
      { key: 'category', header: 'سرفصل' }, { key: 'counterparty', header: 'طرف‌حساب' }, { key: 'description', header: 'شرح' }, { key: 'reference', header: 'شماره پیگیری' }, { key: 'voided', header: 'ابطال' },
    ],
    rows: list.map((t) => ({
      date: v(t, 'occurred_on'), type: TYPE[String(t.type)] ?? v(t, 'type'), account: v(t, 'account_name'), amount: t.direction === 'out' ? `-${t.amount}` : v(t, 'amount'),
      category: v(t, 'category_name'), counterparty: v(t, 'counterparty_name'), description: v(t, 'description'), reference: v(t, 'reference'), voided: t.voided_at ? 'ابطال‌شده' : '',
    })),
  };
}
