import type { ReactNode } from 'react';
import { Lock, RefreshCw, WifiOff } from 'lucide-react';
import { Alert, EmptyState, Skeleton } from './feedback.js';
import { Button } from './button.js';

export interface QueryLike {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

function errorInfo(err: unknown): { status?: number; message: string; ref?: string } {
  const e = err as { status?: number; message?: string; details?: { ref?: string } };
  return { status: e?.status, message: e?.message || 'خطایی رخ داد', ref: e?.details?.ref };
}

/**
 * Renders every mandatory page state (docs/07 §7): loading, error (with retry), forbidden, offline
 * and empty. Pages must route their main query through this component so no state is forgotten.
 */
export function PageState({ query, isEmpty, empty, children }: { query: QueryLike; isEmpty?: boolean; empty?: ReactNode; children: ReactNode }) {
  if (query.isPending) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="در حال بارگذاری">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-2/3" />
      </div>
    );
  }
  if (query.isError) {
    const info = errorInfo(query.error);
    if (info.status === 403) return <EmptyState icon={<Lock className="size-8" />} title="دسترسی ندارید" description={info.message} />;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return <EmptyState icon={<WifiOff className="size-8" />} title="اتصال اینترنت برقرار نیست" description="پس از برقراری اتصال دوباره تلاش کنید." action={<Button variant="secondary" onClick={() => query.refetch()}>تلاش دوباره</Button>} />;
    }
    return (
      <Alert
        tone="danger"
        title="بارگذاری اطلاعات ممکن نشد"
        action={
          <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
            <RefreshCw className="size-4" /> تلاش دوباره
          </Button>
        }
      >
        {info.message}
        {info.ref && <span className="block text-xs text-muted">کد پیگیری: {info.ref}</span>}
      </Alert>
    );
  }
  if (isEmpty) return <>{empty ?? <EmptyState title="داده‌ای وجود ندارد" />}</>;
  return <>{children}</>;
}
