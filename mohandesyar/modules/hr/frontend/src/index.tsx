import type { RouteObject } from 'react-router';
import { Link, Navigate } from 'react-router';
import { DayText, Stat } from '@mohandesyar/ui';
import { useCan, useWidgetData, type WidgetProps } from '@mohandesyar/module-sdk/web';
import { BASE, LEAVE_STATUS, fa } from './common.js';
import { EmployeePage, EmployeesPage, MyFilePage } from './employees.js';
import { LeavePage, LeaveTypesPage, type Balance } from './leave.js';
import { ReviewsPage } from './reviews.js';

/** HR staff land on the employee list; everyone else on their own file. */
function Home() {
  return <Navigate to={useCan('hr.employee.manage') ? 'employees' : 'me'} replace />;
}

export const routes: RouteObject[] = [
  { index: true, element: <Home /> },
  { path: 'employees', element: <EmployeesPage /> },
  { path: 'employees/:id', element: <EmployeePage /> },
  { path: 'me', element: <MyFilePage /> },
  { path: 'leave', element: <LeavePage /> },
  { path: 'reviews', element: <ReviewsPage /> },
  { path: 'settings', element: <LeaveTypesPage /> },
];

function Loading({ q, children }: { q: { isPending: boolean; isError: boolean }; children: () => React.ReactNode }) {
  if (q.isPending) return <div className="h-16 animate-pulse rounded bg-surface-2" />;
  if (q.isError) return <p className="text-sm text-danger">بارگذاری ممکن نشد</p>;
  return <>{children()}</>;
}

export function OverviewWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ headcount: number; on_leave: number; pending: number; contracts_ending: number }>(moduleId, widgetKey);
  return (
    <Loading q={q}>
      {() => {
        const d = q.data!.data;
        return (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="کارکنان فعال">{fa(d.headcount)}</Stat>
              <Stat label="در مرخصی امروز">{fa(d.on_leave)}</Stat>
              <Stat label="مرخصی در انتظار تأیید">{fa(d.pending)}</Stat>
              <Stat label="قرارداد رو به پایان">{fa(d.contracts_ending)}</Stat>
            </div>
            <Link to={`${BASE}/employees`} className="text-primary underline">پرونده کارکنان</Link>
          </div>
        );
      }}
    </Loading>
  );
}

export function MyLeaveWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ linked: boolean; balances: Balance[]; upcoming: { id: string; type_name: string; starts_on: string; ends_on: string; days: number; status: string }[] }>(moduleId, widgetKey);
  return (
    <Loading q={q}>
      {() => {
        const d = q.data!.data;
        if (!d.linked) return <p className="text-sm text-muted">پرونده کارمندی به حساب شما متصل نیست.</p>;
        return (
          <div className="space-y-2 text-sm">
            <ul>{d.balances.filter((b) => b.allowance !== null).map((b) => <li key={b.typeId}>{b.name}: <span className="font-bold tabular-nums">{fa(b.remaining)}</span> روز مانده</li>)}</ul>
            {d.upcoming.length > 0 && <ul className="text-muted">{d.upcoming.map((l) => <li key={l.id}>{l.type_name} <DayText value={l.starts_on} /> ({fa(l.days)} روز) · {LEAVE_STATUS[l.status]?.label}</li>)}</ul>}
            <Link to={`${BASE}/leave`} className="text-primary underline">درخواست مرخصی</Link>
          </div>
        );
      }}
    </Loading>
  );
}
