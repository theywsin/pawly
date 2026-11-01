import type { RouteObject } from 'react-router';
import { Link } from 'react-router';
import { Badge, ProgressBar } from '@mohandesyar/ui';
import { useWidgetData, type WidgetProps } from '@mohandesyar/module-sdk/web';
import { pct } from './common.js';
import { ProjectDetail } from './ProjectDetail.js';
import { ProjectsPage } from './ProjectsPage.js';

export const routes: RouteObject[] = [
  { index: true, element: <ProjectsPage /> },
  { path: ':id', element: <ProjectDetail /> },
];

function Loading({ q, children }: { q: { isPending: boolean; isError: boolean }; children: () => React.ReactNode }) {
  if (q.isPending) return <div className="h-20 animate-pulse rounded bg-surface-2" />;
  if (q.isError) return <p className="text-sm text-danger">بارگذاری ممکن نشد</p>;
  return <>{children()}</>;
}

export function OverviewWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ total: number; active: number; delayed: number; items: { id: string; code: string; title: string; planned: number | null; actual: number | null; delayed: boolean }[] }>(moduleId, widgetKey);
  return (
    <Loading q={q}>
      {() => {
        const d = q.data!.data;
        if (!d.total) return <p className="text-sm text-muted">داده کافی وجود ندارد — هنوز پروژه‌ای تعریف نشده است.</p>;
        return (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="text-2xl font-bold">{d.active.toLocaleString('fa-IR')}</span> پروژه در حال اجرا
              {d.delayed > 0 && <Badge tone="danger" className="ms-2">{`${d.delayed.toLocaleString('fa-IR')} دارای تأخیر`}</Badge>}
            </p>
            <ul className="space-y-2">
              {d.items.map((p) => (
                <li key={p.id} className="text-sm">
                  <Link to={`/app/projects/${p.id}`} className="text-primary underline-offset-4 hover:underline"><bdi>{p.code}</bdi> — {p.title}</Link>
                  {p.actual === null ? <p className="text-xs text-muted">بدون برنامه زمان‌بندی</p> : (
                    <>
                      <ProgressBar value={p.actual} planned={p.planned} label={`پیشرفت ${p.code}`} tone={p.delayed ? 'danger' : 'success'} />
                      <p className="text-xs text-muted">واقعی {pct(p.actual)} · برنامه‌ای {pct(p.planned)}</p>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      }}
    </Loading>
  );
}

export function IssuesWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ issues: number; risks: number; issues_list: { id: string; kind: string; title: string; due_on: string | null; project_id: string; code: string }[] }>(moduleId, widgetKey);
  return (
    <Loading q={q}>
      {() => {
        const d = q.data!.data;
        if (!d.issues && !d.risks) return <p className="text-sm text-muted">مانع باز یا ریسک بالایی ثبت نشده است.</p>;
        return (
          <div className="space-y-2 text-sm">
            <p>{d.issues.toLocaleString('fa-IR')} مورد باز · {d.risks.toLocaleString('fa-IR')} ریسک بالا (امتیاز ۱۵ به بالا)</p>
            <ul className="space-y-1">
              {d.issues_list.map((i) => (
                <li key={i.id}><Link className="text-primary underline-offset-4 hover:underline" to={`/app/projects/${i.project_id}?tab=issues`}><bdi>{i.code}</bdi>: {i.title}</Link></li>
              ))}
            </ul>
          </div>
        );
      }}
    </Loading>
  );
}
