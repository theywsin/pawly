import type { RouteObject } from 'react-router';
import { Link } from 'react-router';
import { DayText } from '@mohandesyar/ui';
import { useWidgetData, type WidgetProps } from '@mohandesyar/module-sdk/web';
import { AssetsPage } from './assets.js';
import { BASE, rial } from './common.js';
import { ReportsPage } from './reports.js';
import { SetupPage } from './setup.js';
import { InventoryPage, InvoicePage, InvoicesPage } from './trade.js';
import { TreasuryPage } from './treasury.js';
import { VoucherPage, VouchersPage } from './vouchers.js';

export const routes: RouteObject[] = [
  { index: true, element: <VouchersPage /> },
  { path: 'vouchers/:id', element: <VoucherPage /> },
  { path: 'reports', element: <ReportsPage /> },
  { path: 'treasury', element: <TreasuryPage /> },
  { path: 'invoices', element: <InvoicesPage /> },
  { path: 'invoices/new/:kind', element: <InvoicePage /> },
  { path: 'invoices/:id', element: <InvoicePage /> },
  { path: 'inventory', element: <InventoryPage /> },
  { path: 'assets', element: <AssetsPage /> },
  { path: 'setup', element: <SetupPage /> },
];

function Loading({ q, children }: { q: { isPending: boolean; isError: boolean }; children: () => React.ReactNode }) {
  if (q.isPending) return <div className="h-16 animate-pulse rounded bg-surface-2" />;
  if (q.isError) return <p className="text-sm text-danger">بارگذاری ممکن نشد</p>;
  return <>{children()}</>;
}

export function OverviewWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ cash: string; receivables: string; payables: string; revenue: string; profit: string; drafts: number }>(moduleId, widgetKey);
  return (
    <Loading q={q}>
      {() => {
        const d = q.data!.data;
        return (
          <div className="space-y-2 text-sm">
            <ul className="grid grid-cols-2 gap-2">
              <li>نقد و بانک: <b className="tabular-nums">{rial(d.cash)}</b></li>
              <li>دریافتنی‌ها: <b className="tabular-nums">{rial(d.receivables)}</b></li>
              <li>پرداختنی‌ها: <b className="tabular-nums">{rial(d.payables)}</b></li>
              <li>درآمد این ماه: <b className="tabular-nums">{rial(d.revenue)}</b></li>
              <li className="col-span-2">{BigInt(d.profit) >= 0n ? 'سود' : 'زیان'} این ماه: <b className="tabular-nums">{rial(BigInt(d.profit) < 0n ? -BigInt(d.profit) : d.profit)}</b> ریال</li>
            </ul>
            {d.drafts > 0 && <p className="text-warning">{d.drafts.toLocaleString('fa-IR')} سند پیش‌نویس منتظر بازبینی</p>}
            <Link to={BASE} className="text-primary underline">رفتن به حسابداری</Link>
          </div>
        );
      }}
    </Loading>
  );
}

export function ChequesWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ items: { id: string; direction: string; number: string; due_on: string; amount: string; party: string }[] }>(moduleId, widgetKey);
  return (
    <Loading q={q}>
      {() => {
        const items = q.data!.data.items;
        if (!items.length) return <p className="text-sm text-muted">چک سررسیدی در هفت روز آینده نیست.</p>;
        return (
          <ul className="space-y-1 text-sm">
            {items.map((c) => <li key={c.id} className="flex justify-between gap-2"><span>{c.direction === 'received' ? 'دریافتی' : 'پرداختی'} {c.number} — {c.party}</span><span className="whitespace-nowrap text-muted"><DayText value={c.due_on} /> · {rial(c.amount)}</span></li>)}
            <li><Link to={`${BASE}/treasury`} className="text-primary underline">خزانه و چک</Link></li>
          </ul>
        );
      }}
    </Loading>
  );
}
