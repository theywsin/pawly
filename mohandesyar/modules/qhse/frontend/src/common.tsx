import { useState } from 'react';
import { NavLink } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Alert, Field, Select, type Tone } from '@mohandesyar/ui';
import { ApiError, useCan, useModule, useModuleApi } from '@mohandesyar/module-sdk/web';

export const useApi = () => useModuleApi('qhse');
export const BASE = '/app/qhse';

export const KIND: Record<string, string> = { injury: 'حادثه با آسیب', near_miss: 'شبه‌حادثه', unsafe_condition: 'شرایط ناایمن', property_damage: 'خسارت به اموال', environmental: 'رویداد زیست‌محیطی' };
export const SEVERITY: Record<string, { label: string; tone: Tone }> = {
  low: { label: 'کم', tone: 'neutral' },
  medium: { label: 'متوسط', tone: 'info' },
  high: { label: 'زیاد', tone: 'warning' },
  critical: { label: 'بحرانی', tone: 'danger' },
};
export const INCIDENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: 'باز', tone: 'warning' },
  investigating: { label: 'در حال بررسی', tone: 'info' },
  closed: { label: 'بسته', tone: 'success' },
};
export const ACTION_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: 'باز', tone: 'warning' },
  done: { label: 'انجام‌شده، منتظر تأیید اثربخشی', tone: 'info' },
  verified: { label: 'اثربخشی تأیید شد', tone: 'success' },
};
export const AREA: Record<string, string> = { safety: 'ایمنی', quality: 'کیفیت', environment: 'محیط‌زیست', health: 'بهداشت' };
export const BAND: Record<string, { label: string; tone: Tone }> = { low: { label: 'کم', tone: 'success' }, medium: { label: 'متوسط', tone: 'warning' }, high: { label: 'زیاد', tone: 'danger' } };

export const num = (v: number | string | null | undefined) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('fa-IR'));

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

export const useProjects = () => {
  const a = useApi();
  const on = useModule('projects');
  return useQuery({ queryKey: ['qhse', 'projects'], queryFn: () => a.get<{ id: string; code: string; title: string }[]>('/projects'), enabled: on });
};
export function useProjectName() {
  const q = useProjects();
  return (id: string | null | undefined) => (id ? (q.data?.find((p) => p.id === id)?.title ?? '—') : '—');
}

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

export function Nav() {
  const view = useCan('qhse.view');
  const admin = useCan('qhse.admin');
  const link = ({ isActive }: { isActive: boolean }) => `-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${isActive ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-text'}`;
  return (
    <nav aria-label="بخش‌های QHSE" className="mb-6 flex gap-1 overflow-x-auto border-b border-border print:hidden">
      <NavLink to={`${BASE}/incidents`} className={link}>حوادث</NavLink>
      <NavLink to={`${BASE}/actions`} className={link}>اقدامات</NavLink>
      {view && <NavLink to={`${BASE}/ncrs`} className={link}>عدم انطباق</NavLink>}
      {view && <NavLink to={`${BASE}/inspections`} className={link}>بازرسی</NavLink>}
      {view && <NavLink to={`${BASE}/risks`} className={link}>ریسک‌ها</NavLink>}
      {view && <NavLink to={`${BASE}/training`} className={link}>آموزش و PPE</NavLink>}
      {view && <NavLink to={`${BASE}/report`} className={link}>گزارش وضعیت</NavLink>}
      {admin && <NavLink to={`${BASE}/settings`} className={link}>تنظیمات</NavLink>}
    </nav>
  );
}
