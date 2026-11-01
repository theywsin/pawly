import type { ModuleRequestContext, ReportResult } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import { Orders } from './logic.js';

const STATUS: Record<string, string> = { pending: 'در انتظار تأیید', approved: 'تأییدشده', rejected: 'ردشده', cancelled: 'لغوشده', closed: 'بسته‌شده' };

/** Purchase orders dated in the period with delivery progress and lateness, in the reader's scope. */
export async function ordersReport(ctx: ModuleRequestContext, p: { from: string; to: string; filters: Record<string, string> }): Promise<ReportResult> {
  const status = p.filters.status as 'pending' | 'approved' | 'rejected' | 'cancelled' | 'closed' | undefined;
  const list = (await Orders.list(ctx, { status }, todayIso(), true)) as Record<string, string | number | boolean | null>[];
  const rows = list.filter((o) => String(o.ordered_on) >= p.from && String(o.ordered_on) <= p.to && (!p.filters.late || o.late === true));
  return {
    columns: [
      { key: 'number', header: 'شماره سفارش' }, { key: 'supplier', header: 'تأمین‌کننده' }, { key: 'orderedOn', header: 'تاریخ سفارش', kind: 'date' }, { key: 'expectedOn', header: 'تحویل مورد انتظار', kind: 'date' },
      { key: 'total', header: 'مبلغ (ریال)', kind: 'number' }, { key: 'received', header: 'درصد تحویل', kind: 'number' }, { key: 'status', header: 'وضعیت' }, { key: 'late', header: 'تأخیر' },
    ],
    rows: rows.map((o) => ({
      number: `PO-${o.number}`, supplier: String(o.supplier_name), orderedOn: String(o.ordered_on), expectedOn: String(o.expected_on), total: String(o.total), received: Number(o.received_pct),
      status: STATUS[String(o.status)] ?? String(o.status), late: o.late ? 'دارد' : '',
    })),
  };
}
