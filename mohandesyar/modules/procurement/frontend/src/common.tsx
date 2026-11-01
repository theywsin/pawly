import { useState } from 'react';
import { NavLink } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Alert, Field, Select, type Tone } from '@mohandesyar/ui';
import { ApiError, useCan, useModule, useModuleApi } from '@mohandesyar/module-sdk/web';

export const useApi = () => useModuleApi('procurement');
export const BASE = '/app/procurement';

export const STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'در انتظار تأیید', tone: 'warning' },
  approved: { label: 'تأییدشده', tone: 'info' },
  rejected: { label: 'ردشده', tone: 'danger' },
  cancelled: { label: 'لغوشده', tone: 'neutral' },
  closed: { label: 'بسته‌شده', tone: 'success' },
  open: { label: 'باز', tone: 'info' },
  awarded: { label: 'برنده انتخاب شد', tone: 'success' },
};
export const INVOICE_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'در انتظار تأیید', tone: 'warning' },
  approved: { label: 'تأییدشده', tone: 'success' },
  rejected: { label: 'ردشده', tone: 'danger' },
};
export const status = (s: string) => STATUS[s] ?? { label: s, tone: 'neutral' as Tone };

export const rial = (v: string | number | bigint | null | undefined) => (v === null || v === undefined ? '—' : BigInt(v).toLocaleString('fa-IR'));
export const num = (v: string | number | null | undefined) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('fa-IR'));

export function useServerErrors() {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  return {
    fields,
    clear: () => (setFields({}), setGeneral(null)),
    set: (e: unknown) => {
      if (e instanceof ApiError) {
        const d = Array.isArray(e.details) ? (e.details as { path: string; message: string }[]) : [];
        setFields(Object.fromEntries(d.map((x) => [x.path, x.message])));
        setGeneral(d.length ? `${e.message}: ${d[0]!.message}` : e.message);
      } else setGeneral('عملیات انجام نشد؛ دوباره تلاش کنید');
    },
    banner: general ? <Alert tone="danger" className="mb-4">{general}</Alert> : null,
  };
}

export interface Supplier { id: string; name: string; national_id: string; economic_code: string; phone: string; email: string; address: string; iban: string | null; status: 'active' | 'blocked'; block_reason: string; notes: string; categories: string[]; category_ids: string[]; rating: number | null; ratings: number; orders: number }

export const useSuppliers = (enabled = true) => {
  const a = useApi();
  return useQuery({ queryKey: ['procurement', 'suppliers'], queryFn: () => a.get<Supplier[]>('/suppliers'), enabled });
};
export const useCategories = () => {
  const a = useApi();
  return useQuery({ queryKey: ['procurement', 'categories'], queryFn: () => a.get<{ id: string; name: string }[]>('/categories') });
};
export const useProjects = () => {
  const a = useApi();
  const on = useModule('projects');
  return useQuery({ queryKey: ['procurement', 'projects'], queryFn: () => a.get<{ id: string; code: string; title: string }[]>('/projects'), enabled: on });
};

export function ProjectSelect({ value, onChange, required, error }: { value: string; onChange: (v: string) => void; required?: boolean; error?: string }) {
  const on = useModule('projects');
  const q = useProjects();
  if (!on) return null;
  return (
    <Field label="پروژه" required={required} error={error}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{required ? 'انتخاب کنید' : '—'}</option>
        {(q.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} — {p.title}</option>)}
      </Select>
    </Field>
  );
}

export function SupplierSelect({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  const q = useSuppliers();
  return (
    <Field label="تأمین‌کننده" required error={error}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">انتخاب کنید</option>
        {(q.data ?? []).filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
    </Field>
  );
}

export function Nav() {
  const sup = useCan('procurement.supplier.view');
  const req = useCan('procurement.request.view');
  const ord = useCan('procurement.order.manage');
  const rec = useCan('procurement.receipt.record');
  const report = useCan('procurement.report.view');
  const link = ({ isActive }: { isActive: boolean }) => `-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${isActive ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-text'}`;
  return (
    <nav aria-label="بخش‌های تدارکات" className="mb-6 flex gap-1 overflow-x-auto border-b border-border print:hidden">
      {req && <NavLink to={`${BASE}/requests`} className={link}>درخواست‌های خرید</NavLink>}
      {ord && <NavLink to={`${BASE}/rfqs`} className={link}>استعلام قیمت</NavLink>}
      {(ord || rec) && <NavLink to={`${BASE}/orders`} className={link}>سفارش‌ها و تحویل</NavLink>}
      {sup && <NavLink to={`${BASE}/invoices`} className={link}>فاکتورها</NavLink>}
      {sup && <NavLink to={`${BASE}/suppliers`} className={link}>تأمین‌کنندگان</NavLink>}
      {report && <NavLink to={`${BASE}/reports`} className={link}>گزارش‌ها</NavLink>}
    </nav>
  );
}
