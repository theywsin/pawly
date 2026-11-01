import type { RouteObject } from 'react-router';
import { Link } from 'react-router';
import { DayText } from '@mohandesyar/ui';
import { useWidgetData, type WidgetProps } from '@mohandesyar/module-sdk/web';
import { utcToZoned } from '@mohandesyar/persian';
import { HistoryPage, MyDayPage, TeamPage } from './pages.js';

export const routes: RouteObject[] = [
  { index: true, element: <MyDayPage /> },
  { path: 'history', element: <HistoryPage /> },
  { path: 'team', element: <TeamPage /> },
];

function Loading({ q, children }: { q: { isPending: boolean; isError: boolean }; children: () => React.ReactNode }) {
  if (q.isPending) return <div className="h-16 animate-pulse rounded bg-surface-2" />;
  if (q.isError) return <p className="text-sm text-danger">بارگذاری ممکن نشد</p>;
  return <>{children()}</>;
}
const fa = (n: number) => n.toLocaleString('fa-IR');

export function TodayWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ items: { id: string; title: string; due_at: string }[]; attendance: { check_in: string; late_minutes: number } | null }>(moduleId, widgetKey);
  return (
    <Loading q={q}>
      {() => {
        const d = q.data!.data;
        return (
          <div className="space-y-2 text-sm">
            <p>{d.attendance ? <>ورود امروز ثبت شده{d.attendance.late_minutes > 0 ? ` (${fa(d.attendance.late_minutes)} دقیقه تأخیر)` : ''}</> : <span className="text-warning">ورود امروز هنوز ثبت نشده است</span>}</p>
            {d.items.length === 0 ? <p className="text-muted">کار باز امروزی ندارید.</p> : (
              <ul className="space-y-1">
                {d.items.map((t) => {
                  const z = utcToZoned(t.due_at);
                  return <li key={t.id} className="flex justify-between gap-2"><span className={Date.parse(t.due_at) < Date.now() ? 'text-danger' : ''}>{t.title}</span><span className="whitespace-nowrap text-muted"><DayText value={z.date} /> <bdi>{z.time}</bdi></span></li>;
                })}
              </ul>
            )}
            <Link to="/app/taskboard" className="text-primary underline">رفتن به روز من</Link>
          </div>
        );
      }}
    </Loading>
  );
}

export function TeamWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ open: number; overdue: number; review: number; present: number; late: number }>(moduleId, widgetKey);
  return (
    <Loading q={q}>
      {() => {
        const d = q.data!.data;
        return (
          <div className="space-y-2 text-sm">
            <ul className="grid grid-cols-2 gap-2">
              <li>حاضر امروز: <b>{fa(d.present)}</b></li>
              <li>با تأخیر: <b className={d.late ? 'text-danger' : ''}>{fa(d.late)}</b></li>
              <li>کار باز امروز: <b>{fa(d.open)}</b></li>
              <li>عقب‌افتاده: <b className={d.overdue ? 'text-danger' : ''}>{fa(d.overdue)}</b></li>
              <li className="col-span-2">منتظر بازبینی شما: <b>{fa(d.review)}</b></li>
            </ul>
            <Link to="/app/taskboard/team" className="text-primary underline">مدیریت کار کارکنان</Link>
          </div>
        );
      }}
    </Loading>
  );
}
