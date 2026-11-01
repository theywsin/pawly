import type { RouteObject } from 'react-router';
import { Link, Navigate } from 'react-router';
import { Badge, Stat } from '@mohandesyar/ui';
import { useWidgetData, type WidgetProps } from '@mohandesyar/module-sdk/web';
import { BASE, STATUS, fa } from './common.js';
import { DefinitionPage, DefinitionsPage } from './definitions.js';
import { RewardsPage, ScorecardPage, ScorecardsPage } from './scorecards.js';
import { ValuesPage } from './values.js';

export const routes: RouteObject[] = [
  { index: true, element: <Navigate to="definitions" replace /> },
  { path: 'definitions', element: <DefinitionsPage /> },
  { path: 'definitions/:id', element: <DefinitionPage /> },
  { path: 'values', element: <ValuesPage /> },
  { path: 'scorecards', element: <ScorecardsPage /> },
  { path: 'scorecards/:id', element: <ScorecardPage /> },
  { path: 'rewards', element: <RewardsPage /> },
];

export function StatusWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ good: number; warning: number; critical: number; pending: number | null; attention: { name: string; subject: string; period: string; status: string }[] }>(moduleId, widgetKey);
  if (q.isPending) return <div className="h-16 animate-pulse rounded bg-surface-2" />;
  if (q.isError) return <p className="text-sm text-danger">بارگذاری ممکن نشد</p>;
  const d = q.data.data;
  if (!d.good && !d.warning && !d.critical) return <p className="text-sm text-muted">داده کافی وجود ندارد.</p>;
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="مطلوب">{fa(d.good)}</Stat>
        <Stat label="هشدار">{fa(d.warning)}</Stat>
        <Stat label="بحرانی">{fa(d.critical)}</Stat>
      </div>
      {d.attention.length > 0 && <ul className="space-y-1">{d.attention.map((x, i) => <li key={i}><Badge tone={STATUS[x.status]!.tone}>{STATUS[x.status]!.label}</Badge> {x.name} <span className="text-muted">· {x.subject} · {x.period}</span></li>)}</ul>}
      {d.pending ? <Link to={`${BASE}/values`} className="text-warning underline">{fa(d.pending)} مقدار در انتظار تأیید</Link> : null}
      <Link to={`${BASE}/definitions`} className="block text-primary underline">شاخص‌های عملکرد</Link>
    </div>
  );
}
