import { Component, Suspense, use, useMemo, type ErrorInfo, type ReactNode } from 'react';
import { useLocation, useRoutes, type RouteObject } from 'react-router';
import { Alert, EmptyState, Spinner } from '@mohandesyar/ui';
import type { MeModule } from '@mohandesyar/module-sdk/web';
import { useAppSession } from '../lib/session.js';
import { loadModuleBundle } from './loader.js';

/** Isolates a failing module UI: the rest of the SPA keeps working (docs/03 §6). */
export class ModuleErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('module UI failed', this.props.label, error, info.componentStack);
  }
  override render() {
    if (this.state.error) {
      return (
        <Alert tone="danger" title={`نمایش «${this.props.label}» با خطا مواجه شد`}>
          {this.state.error.message}
        </Alert>
      );
    }
    return this.props.children;
  }
}

function ModuleRoutes({ module, base }: { module: MeModule; base: string }) {
  const bundle = use(useMemo(() => loadModuleBundle(module), [module]));
  const exportName = module.routes.find((r) => r.path.startsWith(`/app/${base}`))?.export ?? 'routes';
  const routes = (bundle[exportName] ?? []) as RouteObject[];
  return useRoutes([{ path: `${base}/*`, children: routes }]);
}

/** Catch-all under /app: finds the active module owning the path and renders its lazily loaded routes. */
export function ModuleOutlet() {
  const { me } = useAppSession();
  const { pathname } = useLocation();
  const match = me.modules
    .flatMap((m) => m.routes.map((r) => ({ m, prefix: r.path.replace(/\/\*$/, '') })))
    .find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (!match) {
    return <EmptyState title="صفحه یافت نشد" description="این بخش وجود ندارد یا ماژول آن برای سازمان شما فعال نیست." />;
  }
  return (
    <ModuleErrorBoundary label={match.m.name.fa} key={match.m.id}>
      <Suspense fallback={<div className="flex justify-center py-16"><Spinner className="size-6 text-primary" /></div>}>
        <ModuleRoutes module={match.m} base={match.prefix.replace(/^\/app\//, '')} />
      </Suspense>
    </ModuleErrorBoundary>
  );
}

/** Renders one module widget export inside a frame with title and failure isolation. */
export function ModuleWidget({ module, widget }: { module: MeModule; widget: MeModule['widgets'][number] }) {
  return (
    <ModuleErrorBoundary label={widget.title.fa}>
      <Suspense fallback={<div className="h-24 animate-pulse rounded-lg bg-surface-2" />}>
        <WidgetBody module={module} widget={widget} />
      </Suspense>
    </ModuleErrorBoundary>
  );
}

function WidgetBody({ module, widget }: { module: MeModule; widget: MeModule['widgets'][number] }) {
  const bundle = use(useMemo(() => loadModuleBundle(module), [module]));
  const W = bundle[widget.export] as ((p: { moduleId: string; widgetKey: string; size: 'sm' | 'md' | 'lg' }) => ReactNode) | undefined;
  if (!W) return <Alert tone="warning">ویجت در بسته ماژول یافت نشد.</Alert>;
  return <W moduleId={module.id} widgetKey={widget.key} size={(widget.sizes[0] as 'sm' | 'md' | 'lg') ?? 'md'} />;
}
