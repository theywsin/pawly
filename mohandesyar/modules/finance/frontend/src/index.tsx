import type { RouteObject } from 'react-router';
import { Link, Navigate } from 'react-router';
import { Stat } from '@mohandesyar/ui';
import { useCan, useWidgetData, type WidgetProps } from '@mohandesyar/module-sdk/web';
import { AccountsPage } from './accounts.js';
import { BudgetsPage, ProjectBudgetPage } from './budgets.js';
import { CashflowPage, ReconciliationPage, ReportsPage, SettingsPage } from './cash.js';
import { BASE, rial } from './common.js';
import { ChequesPage, ObligationsPage, PaymentsPage } from './payments.js';

function Home() {
  return <Navigate to={useCan('finance.transaction.view') ? 'accounts' : 'payments'} replace />;
}

export const routes: RouteObject[] = [
  { index: true, element: <Home /> },
  { path: 'accounts', element: <AccountsPage /> },
  { path: 'payments', element: <PaymentsPage /> },
  { path: 'obligations', element: <ObligationsPage /> },
  { path: 'cheques', element: <ChequesPage /> },
  { path: 'budgets', element: <BudgetsPage /> },
  { path: 'budgets/:projectId', element: <ProjectBudgetPage /> },
  { path: 'cashflow', element: <CashflowPage /> },
  { path: 'reconciliation', element: <ReconciliationPage /> },
  { path: 'reports', element: <ReportsPage /> },
  { path: 'settings', element: <SettingsPage /> },
];

function Loading({ q, children }: { q: { isPending: boolean; isError: boolean }; children: () => React.ReactNode }) {
  if (q.isPending) return <div className="h-16 animate-pulse rounded bg-surface-2" />;
  if (q.isError) return <p className="text-sm text-danger">بارگذاری ممکن نشد</p>;
  return <>{children()}</>;
}

export function CashWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ total: string; accounts: { id: string; name: string; balance: string }[] }>(moduleId, widgetKey);
  return (
    <Loading q={q}>
      {() => {
        const d = q.data!.data;
        if (!d.accounts.length) return <p className="text-sm text-muted">داده کافی وجود ندارد — حسابی تعریف نشده است.</p>;
        return (
          <div className="space-y-2 text-sm">
            <Stat label="موجودی کل (ریال)">{rial(d.total)}</Stat>
            <ul>{d.accounts.slice(0, 5).map((a) => <li key={a.id} className="flex justify-between"><span>{a.name}</span><span className="tabular-nums">{rial(a.balance)}</span></li>)}</ul>
            <Link to={`${BASE}/accounts`} className="text-primary underline">حساب‌ها</Link>
          </div>
        );
      }}
    </Loading>
  );
}

export function DueWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ receivable: { overdue: string; week: string }; payable: { overdue: string; week: string }; chequesWeek: number }>(moduleId, widgetKey);
  return (
    <Loading q={q}>
      {() => {
        const d = q.data!.data;
        return (
          <div className="space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="مطالبات سررسیدگذشته">{rial(d.receivable.overdue)}</Stat>
              <Stat label="بدهی سررسیدگذشته">{rial(d.payable.overdue)}</Stat>
              <Stat label="مطالبات ۷ روز آینده">{rial(d.receivable.week)}</Stat>
              <Stat label="بدهی ۷ روز آینده">{rial(d.payable.week)}</Stat>
            </div>
            {d.chequesWeek > 0 && <p>{d.chequesWeek.toLocaleString('fa-IR')} چک تا ۷ روز آینده سررسید می‌شود.</p>}
            <Link to={`${BASE}/obligations`} className="text-primary underline">مطالبات و بدهی‌ها</Link>
          </div>
        );
      }}
    </Loading>
  );
}

export function PaymentsWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ requested: { n: number; amount: string }; approved: { n: number; amount: string } }>(moduleId, widgetKey);
  return (
    <Loading q={q}>
      {() => {
        const d = q.data!.data;
        return (
          <div className="space-y-2 text-sm">
            <p>در انتظار تأیید: <span className="font-bold">{d.requested.n.toLocaleString('fa-IR')}</span> ({rial(d.requested.amount)} ریال)</p>
            <p>تأییدشده، منتظر اجرا: <span className="font-bold">{d.approved.n.toLocaleString('fa-IR')}</span> ({rial(d.approved.amount)} ریال)</p>
            <Link to={`${BASE}/payments`} className="text-primary underline">درخواست‌های پرداخت</Link>
          </div>
        );
      }}
    </Loading>
  );
}
