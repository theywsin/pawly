import type { RouteObject } from 'react-router';
import { Link, Navigate } from 'react-router';
import { Stat } from '@mohandesyar/ui';
import { useCan, useWidgetData, type WidgetProps } from '@mohandesyar/module-sdk/web';
import { BASE, num } from './common.js';
import { InvoicesPage } from './invoices.js';
import { OrderPage, OrdersPage } from './orders.js';
import { ReportsPage } from './reports.js';
import { RequestsPage } from './requests.js';
import { RfqPage, RfqsPage } from './rfqs.js';
import { SuppliersPage } from './suppliers.js';

function Home() {
  const req = useCan('procurement.request.view');
  const rec = useCan('procurement.receipt.record');
  return <Navigate to={req ? 'requests' : rec ? 'orders' : 'invoices'} replace />;
}

export const routes: RouteObject[] = [
  { index: true, element: <Home /> },
  { path: 'requests', element: <RequestsPage /> },
  { path: 'rfqs', element: <RfqsPage /> },
  { path: 'rfqs/:id', element: <RfqPage /> },
  { path: 'orders', element: <OrdersPage /> },
  { path: 'orders/:id', element: <OrderPage /> },
  { path: 'invoices', element: <InvoicesPage /> },
  { path: 'suppliers', element: <SuppliersPage /> },
  { path: 'suppliers/:id', element: <SuppliersPage /> },
  { path: 'reports', element: <ReportsPage /> },
];

export function StatusWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ pending_requests: number; to_order: number; pending_orders: number; pending_invoices: number; late: number }>(moduleId, widgetKey);
  if (q.isPending) return <div className="h-16 animate-pulse rounded bg-surface-2" />;
  if (q.isError) return <p className="text-sm text-danger">بارگذاری ممکن نشد</p>;
  const d = q.data.data;
  return (
    <div className="space-y-2 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="درخواست در انتظار تأیید">{num(d.pending_requests)}</Stat>
        <Stat label="درخواست تأییدشده بدون سفارش">{num(d.to_order)}</Stat>
        <Stat label="سفارش دارای تأخیر">{num(d.late)}</Stat>
        <Stat label="فاکتور در انتظار تأیید">{num(d.pending_invoices)}</Stat>
      </div>
      <Link to={`${BASE}/orders`} className="text-primary underline">سفارش‌ها</Link>
    </div>
  );
}
