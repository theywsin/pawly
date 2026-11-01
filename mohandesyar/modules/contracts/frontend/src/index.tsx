import type { RouteObject } from 'react-router';
import { Link } from 'react-router';
import { DayText, Money } from '@mohandesyar/ui';
import { useWidgetData, type WidgetProps } from '@mohandesyar/module-sdk/web';
import { ContractDetail } from './ContractDetail.js';
import { ContractsPage } from './ContractsPage.js';

export const routes: RouteObject[] = [
  { index: true, element: <ContractsPage /> },
  { path: ':id', element: <ContractDetail /> },
];

function WidgetState({ q, children }: { q: { isPending: boolean; isError: boolean }; children: () => React.ReactNode }) {
  if (q.isPending) return <div className="h-16 animate-pulse rounded bg-surface-2" />;
  if (q.isError) return <p className="text-sm text-danger">بارگذاری ممکن نشد</p>;
  return <>{children()}</>;
}

export function SummaryWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ active: number; draft: number; income: string; expense: string }>(moduleId, widgetKey);
  return (
    <WidgetState q={q}>
      {() => {
        const d = q.data!.data;
        if (!d.active && !d.draft) return <p className="text-sm text-muted">داده کافی وجود ندارد — هنوز قراردادی ثبت نشده است.</p>;
        return (
          <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-3">
            <div><dt className="text-muted">جاری</dt><dd className="text-2xl font-bold">{d.active.toLocaleString('fa-IR')}</dd></div>
            <div><dt className="text-muted">پیش‌نویس</dt><dd className="text-2xl font-bold">{d.draft.toLocaleString('fa-IR')}</dd></div>
            <div><dt className="text-muted">درآمدی</dt><dd><Money value={d.income} /></dd></div>
            <div><dt className="text-muted">هزینه‌ای</dt><dd><Money value={d.expense} /></dd></div>
          </dl>
          <Link to="/app/contracts" className="text-primary underline">همه قراردادها</Link>
          </div>
        );
      }}
    </WidgetState>
  );
}

export function ExpiringWidget({ moduleId, widgetKey }: WidgetProps) {
  const q = useWidgetData<{ alertDays: number; items: { id: string; code: string; title: string; date: string; type: 'contract' | 'guarantee' }[] }>(moduleId, widgetKey);
  return (
    <WidgetState q={q}>
      {() => {
        const d = q.data!.data;
        if (!d.items.length) return <p className="text-sm text-muted">در {d.alertDays.toLocaleString('fa-IR')} روز آینده قرارداد یا ضمانت‌نامه‌ای سررسید نمی‌شود.</p>;
        return (
          <ul className="space-y-2 text-sm">
            {d.items.map((x) => (
              <li key={`${x.type}-${x.id}-${x.title}`} className="flex justify-between gap-2">
                <Link to={`/app/contracts/${x.id}${x.type === 'guarantee' ? '?tab=guarantees' : ''}`} className="text-primary underline-offset-4 hover:underline">
                  {x.type === 'guarantee' ? `ضمانت‌نامه ${x.title} — ` : ''}<bdi>{x.code}</bdi>
                </Link>
                <DayText value={x.date} />
              </li>
            ))}
          </ul>
        );
      }}
    </WidgetState>
  );
}
