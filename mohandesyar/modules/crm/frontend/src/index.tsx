import type { RouteObject } from 'react-router';
import { Link } from 'react-router';
import { DayText, Money } from '@mohandesyar/ui';
import { useWidgetData, type WidgetProps } from '@mohandesyar/module-sdk/web';
import { AccountPage, AccountsPage, BoardPage, LeadPage, LeadsPage, OpportunityPage, ReportsPage, SettingsPage } from './pages.js';

export const routes: RouteObject[] = [
  { index: true, element: <BoardPage /> },
  { path: 'leads', element: <LeadsPage /> },
  { path: 'leads/:id', element: <LeadPage /> },
  { path: 'accounts', element: <AccountsPage /> },
  { path: 'accounts/:id', element: <AccountPage /> },
  { path: 'opportunities/:id', element: <OpportunityPage /> },
  { path: 'reports', element: <ReportsPage /> },
  { path: 'settings', element: <SettingsPage /> },
];

function Loading({ q, children }: { q: { isPending: boolean; isError: boolean }; children: () => React.ReactNode }) {
  if (q.isPending) return <div className="h-20 animate-pulse rounded bg-surface-2" />;
  if (q.isError) return <p className="text-sm text-danger">بارگذاری ممکن نشد</p>;
  return <>{children()}</>;
}

export function PipelineWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ stages: { name: string; count: number; value: string; weighted: string }[] }>(moduleId, widgetKey);
  return (
    <Loading q={q}>
      {() => {
        const s = q.data!.data.stages;
        if (!s.some((x) => x.count)) return <p className="text-sm text-muted">داده کافی وجود ندارد — فرصت باز فروشی ثبت نشده است.</p>;
        const weighted = s.reduce((n, x) => n + Number(x.weighted), 0);
        return (
          <div className="space-y-2 text-sm">
            <ul className="space-y-1">{s.map((x) => <li key={x.name} className="flex justify-between gap-2"><span>{x.name} ({x.count.toLocaleString('fa-IR')})</span><Money value={x.value} /></li>)}</ul>
            <p className="border-t border-border pt-2 font-semibold">ارزش وزنی قیف: <Money value={String(weighted)} /></p>
            <Link to="/app/crm" className="text-primary underline">قیف فروش</Link>
          </div>
        );
      }}
    </Loading>
  );
}

export function FollowupsWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ items: { id: string; title: string; due: string; type: 'lead' | 'opportunity' }[] }>(moduleId, widgetKey);
  return (
    <Loading q={q}>
      {() => {
        const items = q.data!.data.items;
        if (!items.length) return <p className="text-sm text-muted">پیگیری معوق یا امروزی ندارید.</p>;
        return (
          <ul className="space-y-1 text-sm">
            {items.map((i) => (
              <li key={`${i.type}-${i.id}`} className="flex justify-between gap-2">
                <Link to={`/app/crm/${i.type === 'lead' ? 'leads' : 'opportunities'}/${i.id}`} className="text-primary underline-offset-4 hover:underline">{i.title}</Link>
                <DayText value={i.due} />
              </li>
            ))}
          </ul>
        );
      }}
    </Loading>
  );
}
