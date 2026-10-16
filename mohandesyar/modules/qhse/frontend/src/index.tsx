import type { RouteObject } from 'react-router';
import { Link, Navigate } from 'react-router';
import { Stat } from '@mohandesyar/ui';
import { useWidgetData, type WidgetProps } from '@mohandesyar/module-sdk/web';
import { ActionsPage } from './actions.js';
import { BASE, num } from './common.js';
import { IncidentPage, IncidentsPage } from './incidents.js';
import { InspectionsPage, NcrPage, NcrsPage } from './quality.js';
import { ReportPage, RisksPage, SettingsPage, TrainingPage } from './safety.js';

export const routes: RouteObject[] = [
  { index: true, element: <Navigate to="incidents" replace /> },
  { path: 'incidents', element: <IncidentsPage /> },
  { path: 'incidents/:id', element: <IncidentPage /> },
  { path: 'actions', element: <ActionsPage /> },
  { path: 'ncrs', element: <NcrsPage /> },
  { path: 'ncrs/:id', element: <NcrPage /> },
  { path: 'inspections', element: <InspectionsPage /> },
  { path: 'risks', element: <RisksPage /> },
  { path: 'training', element: <TrainingPage /> },
  { path: 'report', element: <ReportPage /> },
  { path: 'settings', element: <SettingsPage /> },
];

export function StatusWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ open_incidents: number; open_ncrs: number; overdue_actions: number; month_incidents: number; lastLti: string | null; daysSinceLti: number | null }>(moduleId, widgetKey);
  if (q.isPending) return <div className="h-16 animate-pulse rounded bg-surface-2" />;
  if (q.isError) return <p className="text-sm text-danger">بارگذاری ممکن نشد</p>;
  const d = q.data.data;
  return (
    <div className="space-y-2 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="روز بدون حادثه منجر به روز از دست رفته">{d.daysSinceLti === null ? 'ثبت نشده' : num(d.daysSinceLti)}</Stat>
        <Stat label="گزارش‌های این ماه">{num(d.month_incidents)}</Stat>
        <Stat label="اقدامات معوق">{num(d.overdue_actions)}</Stat>
        <Stat label="عدم انطباق باز">{num(d.open_ncrs)}</Stat>
      </div>
      <Link to={`${BASE}/report`} className="text-primary underline">گزارش وضعیت ایمنی</Link>
    </div>
  );
}
