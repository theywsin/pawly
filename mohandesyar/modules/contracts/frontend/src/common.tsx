import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Field, Input, Select } from '@mohandesyar/ui';
import { ApiError, useModule, useModuleApi } from '@mohandesyar/module-sdk/web';

export const useApi = () => useModuleApi('contracts');

export const KIND: Record<string, string> = {
  employer: 'کارفرمایی (ما پیمانکاریم)',
  contractor: 'پیمانکاری (ما کارفرماییم)',
  consulting: 'مشاوره',
  purchase: 'خرید',
  service: 'خدمات',
  other: 'سایر',
};
export const STATUS: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  draft: { label: 'پیش‌نویس', tone: 'neutral' },
  active: { label: 'جاری', tone: 'success' },
  completed: { label: 'پایان‌یافته', tone: 'info' },
  terminated: { label: 'فسخ‌شده', tone: 'danger' },
};
export const DIRECTION: Record<string, string> = { income: 'درآمدی', expense: 'هزینه‌ای' };
export const GUARANTEE_KIND: Record<string, string> = { bid: 'شرکت در مناقصه', performance: 'انجام تعهدات', prepayment: 'پیش‌پرداخت', good_performance: 'حسن انجام کار', other: 'سایر' };
export const GUARANTEE_STATUS: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  active: { label: 'معتبر', tone: 'success' },
  released: { label: 'آزادشده', tone: 'info' },
  seized: { label: 'ضبط‌شده', tone: 'danger' },
  expired: { label: 'منقضی', tone: 'warning' },
};
export const AMENDMENT_KIND: Record<string, string> = { amount: 'تغییر مبلغ', time: 'تغییر مدت', renewal: 'تمدید', scope: 'تغییر شرح کار', other: 'سایر' };
export const STATEMENT_STATUS: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  draft: { label: 'پیش‌نویس', tone: 'neutral' },
  submitted: { label: 'در انتظار تأیید', tone: 'warning' },
  approved: { label: 'تأییدشده', tone: 'success' },
  rejected: { label: 'ردشده', tone: 'danger' },
};

/** Server validation errors → { field: message } plus a general message. */
export function useServerErrors() {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  return {
    fields,
    general,
    clear: () => {
      setFields({});
      setGeneral(null);
    },
    set: (e: unknown) => {
      if (e instanceof ApiError) {
        const d = Array.isArray(e.details) ? (e.details as { path: string; message: string }[]) : [];
        setFields(Object.fromEntries(d.map((x) => [x.path, x.message])));
        setGeneral(e.message);
      } else setGeneral('عملیات انجام نشد؛ دوباره تلاش کنید');
    },
    banner: general ? <Alert tone="danger" className="mb-4">{general}</Alert> : null,
  };
}

/** Picks a record of another module (project, CRM account) through this module's lookup endpoint. */
export function LinkPicker({ kind, label, value, onChange }: { kind: 'projects' | 'accounts'; label: string; value: string | null; onChange: (id: string | null) => void }) {
  const active = useModule(kind === 'projects' ? 'projects' : 'crm');
  const a = useApi();
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['contracts', 'lookup', kind, q], queryFn: () => a.get<{ id: string; title: string; code?: string }[]>(`/lookups/${kind}?q=${encodeURIComponent(q)}`), enabled: active });
  if (!active) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <Field label={label}>
        <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">— بدون اتصال —</option>
          {value && !list.data?.some((x) => x.id === value) && <option value={value}>(انتخاب فعلی)</option>}
          {list.data?.map((x) => (
            <option key={x.id} value={x.id}>
              {x.code ? `${x.code} — ` : ''}
              {x.title}
            </option>
          ))}
        </Select>
      </Field>
      <Input aria-label={`جست‌وجو در ${label}`} placeholder="جست‌وجو…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 text-sm" />
    </div>
  );
}
