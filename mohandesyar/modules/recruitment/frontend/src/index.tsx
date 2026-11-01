import type { RouteObject } from 'react-router';
import { Link, Navigate } from 'react-router';
import { DayText, Stat } from '@mohandesyar/ui';
import { useCan, useWidgetData, type WidgetProps } from '@mohandesyar/module-sdk/web';
import { utcToZoned } from '@mohandesyar/persian';
import { DuplicatesPage, ReportsPage, SettingsPage } from './admin.js';
import { CandidatePage, CandidatesPage } from './candidates.js';
import { BASE, fa, toFaDigits } from './common.js';
import { InterviewPage, MyInterviewsPage } from './interviews.js';
import { JobPage, JobsPage } from './jobs.js';

/** Recruiters land on the resume bank; interviewers (own scope) on their interviews. */
function Home() {
  return <Navigate to={useCan('recruitment.candidate.view') ? 'candidates' : 'interviews'} replace />;
}

export const routes: RouteObject[] = [
  { index: true, element: <Home /> },
  { path: 'candidates', element: <CandidatesPage /> },
  { path: 'candidates/:id', element: <CandidatePage /> },
  { path: 'jobs', element: <JobsPage /> },
  { path: 'jobs/:id', element: <JobPage /> },
  { path: 'interviews', element: <MyInterviewsPage /> },
  { path: 'interviews/:id', element: <InterviewPage /> },
  { path: 'duplicates', element: <DuplicatesPage /> },
  { path: 'reports', element: <ReportsPage /> },
  { path: 'settings', element: <SettingsPage /> },
];

function Loading({ q, children }: { q: { isPending: boolean; isError: boolean }; children: () => React.ReactNode }) {
  if (q.isPending) return <div className="h-16 animate-pulse rounded bg-surface-2" />;
  if (q.isError) return <p className="text-sm text-danger">بارگذاری ممکن نشد</p>;
  return <>{children()}</>;
}

export function PipelineWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ open_jobs: number; active: number; interviews_week: number; hired_30: number; duplicates: number }>(moduleId, widgetKey);
  return (
    <Loading q={q}>
      {() => {
        const d = q.data!.data;
        return (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="موقعیت باز">{fa(d.open_jobs)}</Stat>
              <Stat label="متقاضی در جریان">{fa(d.active)}</Stat>
              <Stat label="مصاحبه ۷ روز آینده">{fa(d.interviews_week)}</Stat>
              <Stat label="استخدام ۳۰ روز اخیر">{fa(d.hired_30)}</Stat>
            </div>
            {d.duplicates > 0 && <Link to={`${BASE}/duplicates`} className="text-warning underline">{fa(d.duplicates)} مورد رزومه تکراری در انتظار بررسی</Link>}
            <Link to={`${BASE}/jobs`} className="block text-primary underline">موقعیت‌ها و قیف استخدام</Link>
          </div>
        );
      }}
    </Loading>
  );
}

export function MyInterviewsWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ items: { id: string; scheduled_at: string; full_name: string; job_title: string }[] }>(moduleId, widgetKey);
  return (
    <Loading q={q}>
      {() => {
        const items = q.data!.data.items;
        if (!items.length) return <p className="text-sm text-muted">مصاحبه در انتظار ارزیابی ندارید.</p>;
        return (
          <ul className="space-y-2 text-sm">
            {items.map((i) => {
              const z = utcToZoned(i.scheduled_at);
              return (
                <li key={i.id} className="flex justify-between gap-2">
                  <Link to={`${BASE}/interviews/${i.id}`} className="text-primary underline-offset-4 hover:underline">{i.full_name} <span className="text-muted">· {i.job_title}</span></Link>
                  <span className="whitespace-nowrap text-muted"><DayText value={z.date} /> <bdi>{toFaDigits(z.time)}</bdi></span>
                </li>
              );
            })}
          </ul>
        );
      }}
    </Loading>
  );
}
