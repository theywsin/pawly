import { useState } from 'react';
import { NavLink } from 'react-router';
import { Alert, Field, Select, type Tone } from '@mohandesyar/ui';
import { ApiError, useCan, useModuleApi } from '@mohandesyar/module-sdk/web';
import { isoToJalali, todayIso } from '@mohandesyar/persian';

export const useApi = () => useModuleApi('kpi');
export const BASE = '/app/kpi';

export const LEVEL: Record<string, string> = { org: 'سازمان', unit: 'واحد', project: 'پروژه', role: 'نقش', person: 'فرد' };
export const FREQ: Record<string, string> = { monthly: 'ماهانه', quarterly: 'فصلی', yearly: 'سالانه' };
export const SOURCE: Record<string, string> = { manual: 'ورود دستی', provider: 'ماژول (Provider)', formula: 'فرمول' };
export const STATUS: Record<string, { label: string; tone: Tone }> = { good: { label: 'مطلوب', tone: 'success' }, warning: { label: 'هشدار', tone: 'warning' }, critical: { label: 'بحرانی', tone: 'danger' }, missing: { label: 'بدون داده', tone: 'neutral' } };
export const VALUE_STATUS: Record<string, { label: string; tone: Tone }> = { submitted: { label: 'در انتظار تأیید', tone: 'warning' }, approved: { label: 'تأییدشده', tone: 'success' }, rejected: { label: 'ردشده', tone: 'danger' } };
export const CARD_STATUS: Record<string, { label: string; tone: Tone }> = { draft: { label: 'پیش‌نویس', tone: 'neutral' }, reviewed: { label: 'بازبینی‌شده', tone: 'info' }, approved: { label: 'تأییدشده', tone: 'success' }, superseded: { label: 'نسخه قبلی', tone: 'neutral' } };
export const UNITS: Record<string, string> = { count: 'تعداد', percent: 'درصد', rial: 'ریال', day: 'روز', hour: 'ساعت', score: 'امتیاز' };

export const fa = (n: number | null | undefined, digits = 2) => (n === null || n === undefined ? '—' : n.toLocaleString('fa-IR', { maximumFractionDigits: digits }));
export const unitLabel = (u: string) => UNITS[u] ?? u;

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

const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const QUARTERS = ['بهار', 'تابستان', 'پاییز', 'زمستان'];

/** Current Jalali year and month (Latin digits). */
export function nowJalali(): { year: number; month: number } {
  const [y, m] = (isoToJalali(todayIso()) ?? '1405/01/01').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).split('/').map(Number) as [number, number];
  return { year: y, month: m };
}
export function currentPeriod(freq: string): string {
  const n = nowJalali();
  if (freq === 'yearly') return String(n.year);
  if (freq === 'quarterly') return `${n.year}-Q${Math.ceil(n.month / 3)}`;
  return `${n.year}-${String(n.month).padStart(2, '0')}`;
}
export function freqOf(period: string): string {
  return /-Q/.test(period) ? 'quarterly' : /-\d\d$/.test(period) ? 'monthly' : 'yearly';
}

/** Jalali period picker producing "1405", "1405-Q3" or "1405-07". */
export function PeriodPicker({ value, onChange, fixedFrequency }: { value: string; onChange: (p: string) => void; fixedFrequency?: string }) {
  const freq = fixedFrequency ?? freqOf(value);
  const year = Number(value.slice(0, 4));
  const part = value.slice(5);
  const years = Array.from({ length: 6 }, (_, i) => nowJalali().year - 3 + i);
  const build = (f: string, y: number, p: string) => (f === 'yearly' ? String(y) : f === 'quarterly' ? `${y}-${/^Q[1-4]$/.test(p) ? p : 'Q1'}` : `${y}-${/^\d\d$/.test(p) ? p : '01'}`);
  return (
    <div className="flex flex-wrap items-end gap-2">
      {!fixedFrequency && (
        <Field label="نوع دوره"><Select value={freq} onChange={(e) => onChange(e.target.value === freq ? value : currentPeriod(e.target.value))}>{Object.entries(FREQ).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      )}
      <Field label="سال"><Select value={year} onChange={(e) => onChange(build(freq, Number(e.target.value), part))}>{years.map((y) => <option key={y} value={y}>{y.toLocaleString('fa-IR', { useGrouping: false })}</option>)}</Select></Field>
      {freq === 'quarterly' && <Field label="فصل"><Select value={part} onChange={(e) => onChange(build(freq, year, e.target.value))}>{QUARTERS.map((q, i) => <option key={q} value={`Q${i + 1}`}>{q}</option>)}</Select></Field>}
      {freq === 'monthly' && <Field label="ماه"><Select value={part} onChange={(e) => onChange(build(freq, year, e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}</Select></Field>}
    </div>
  );
}

export function Nav() {
  const rewards = useCan('kpi.reward.manage');
  const link = ({ isActive }: { isActive: boolean }) => `-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${isActive ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-text'}`;
  return (
    <nav aria-label="بخش‌های شاخص‌های عملکرد" className="mb-6 flex gap-1 overflow-x-auto border-b border-border print:hidden">
      <NavLink to={`${BASE}/definitions`} className={link}>شاخص‌ها</NavLink>
      <NavLink to={`${BASE}/values`} className={link}>ثبت و تأیید مقادیر</NavLink>
      <NavLink to={`${BASE}/scorecards`} className={link}>کارت امتیاز</NavLink>
      {rewards && <NavLink to={`${BASE}/rewards`} className={link}>ضرایب پاداش</NavLink>}
    </nav>
  );
}
