import type { RouteObject } from 'react-router';
import { Link } from 'react-router';
import { DayText } from '@mohandesyar/ui';
import { useDirectory, useWidgetData, type WidgetProps } from '@mohandesyar/module-sdk/web';
import { utcToZoned } from '@mohandesyar/persian';
import { MeetingPage, MeetingsPage, ResolutionsPage } from './pages.js';

export const routes: RouteObject[] = [
  { index: true, element: <MeetingsPage /> },
  { path: 'resolutions', element: <ResolutionsPage /> },
  { path: ':id', element: <MeetingPage /> },
];

function Loading({ q, children }: { q: { isPending: boolean; isError: boolean }; children: () => React.ReactNode }) {
  if (q.isPending) return <div className="h-16 animate-pulse rounded bg-surface-2" />;
  if (q.isError) return <p className="text-sm text-danger">بارگذاری ممکن نشد</p>;
  return <>{children()}</>;
}

export function UpcomingWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ items: { id: string; title: string; starts_at: string; location: string }[] }>(moduleId, widgetKey);
  return (
    <Loading q={q}>
      {() => {
        const items = q.data!.data.items;
        if (!items.length) return <p className="text-sm text-muted">در ۷ روز آینده جلسه‌ای ندارید.</p>;
        return (
          <ul className="space-y-2 text-sm">
            {items.map((m) => {
              const z = utcToZoned(m.starts_at);
              return (
                <li key={m.id} className="flex justify-between gap-2">
                  <Link to={`/app/meetings/${m.id}`} className="text-primary underline-offset-4 hover:underline">{m.title}</Link>
                  <span className="whitespace-nowrap text-muted"><DayText value={z.date} /> <bdi>{z.time}</bdi></span>
                </li>
              );
            })}
          </ul>
        );
      }}
    </Loading>
  );
}

export function OverdueWidget({ moduleId, widgetKey }: WidgetProps) {
  const dir = useDirectory();
  const q = useWidgetData<{ total: number; items: { id: string; body: string; owner_id: string; due_on: string; meeting_id: string }[] }>(moduleId, widgetKey);
  return (
    <Loading q={q}>
      {() => {
        const d = q.data!.data;
        if (!d.total) return <p className="text-sm text-muted">مصوبه معوقی وجود ندارد.</p>;
        return (
          <div className="space-y-2 text-sm">
            <p><span className="text-2xl font-bold text-danger">{d.total.toLocaleString('fa-IR')}</span> مصوبه معوق</p>
            <ul className="space-y-1">
              {d.items.map((r) => <li key={r.id}><Link to={`/app/meetings/${r.meeting_id}`} className="text-primary underline-offset-4 hover:underline">{r.body.slice(0, 60)}</Link> <span className="text-muted">· {dir.name(r.owner_id)} · <DayText value={r.due_on} /></span></li>)}
            </ul>
            <Link to="/app/meetings/resolutions" className="text-primary underline">پیگیری مصوبات</Link>
          </div>
        );
      }}
    </Loading>
  );
}
