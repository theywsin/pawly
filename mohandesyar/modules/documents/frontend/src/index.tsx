import type { RouteObject } from 'react-router';
import { Link, Navigate } from 'react-router';
import { Badge, DayText } from '@mohandesyar/ui';
import { useWidgetData, type WidgetProps } from '@mohandesyar/module-sdk/web';
import { BASE, num } from './common.js';
import { DocumentPage } from './detail.js';
import { DocumentsPage } from './list.js';
import { SettingsPage } from './settings.js';

export const routes: RouteObject[] = [
  { index: true, element: <Navigate to="list" replace /> },
  { path: 'list', element: <DocumentsPage /> },
  { path: 'd/:id', element: <DocumentPage /> },
  { path: 'settings', element: <SettingsPage /> },
];

export function ExpiringWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ list: { id: string; code: string; title: string; expires_on: string; expired: boolean }[]; pending: number }>(moduleId, widgetKey);
  if (q.isPending) return <div className="h-16 animate-pulse rounded bg-surface-2" />;
  if (q.isError) return <p className="text-sm text-danger">بارگذاری ممکن نشد</p>;
  const d = q.data.data;
  return (
    <div className="space-y-2 text-sm">
      {d.list.length === 0 ? <p className="text-muted">سندی در ۳۰ روز آینده منقضی نمی‌شود.</p> : (
        <ul className="space-y-1">
          {d.list.map((x) => (
            <li key={x.id} className="flex justify-between gap-2">
              <Link className="truncate text-primary underline" to={`${BASE}/d/${x.id}`}>{x.code} — {x.title}</Link>
              <span className="whitespace-nowrap">{x.expired ? <Badge tone="danger">منقضی</Badge> : <DayText value={x.expires_on} />}</span>
            </li>
          ))}
        </ul>
      )}
      {d.pending > 0 && <p className="text-muted">{num(d.pending)} نسخه در انتظار تأیید</p>}
    </div>
  );
}
