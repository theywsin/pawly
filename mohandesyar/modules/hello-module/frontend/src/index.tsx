import type { RouteObject } from 'react-router';
import { Num } from '@mohandesyar/ui';
import { useWidgetData, type WidgetProps } from '@mohandesyar/module-sdk/web';
import { NotesPage } from './NotesPage.js';

/**
 * Frontend entry of hello-module. The host loads this ESM file from the module store and reads the
 * exports named in module.manifest.json (`routes`, `NotesCountWidget`). Shared libraries (React,
 * router, query, UI kit, SDK) come from the host's import map, never from this bundle.
 */
export const routes: RouteObject[] = [{ index: true, element: <NotesPage /> }];

export function NotesCountWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ count: number }>(moduleId, widgetKey);
  if (q.isPending) return <div className="h-10 w-16 animate-pulse rounded bg-surface-2" />;
  if (q.isError) return <p className="text-sm text-danger">بارگذاری ممکن نشد</p>;
  return (
    <p className="text-3xl font-bold">
      <Num value={q.data.data.count} />
      <span className="ms-2 text-sm font-normal text-muted">یادداشت</span>
    </p>
  );
}
