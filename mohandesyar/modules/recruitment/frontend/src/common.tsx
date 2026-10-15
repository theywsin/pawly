import { useState } from 'react';
import { NavLink } from 'react-router';
import { Alert, Badge, type Tone } from '@mohandesyar/ui';
import { ApiError, useCan, useModuleApi } from '@mohandesyar/module-sdk/web';

export const useApi = () => useModuleApi('recruitment');
export const BASE = '/app/recruitment';

export const DEGREE: Record<string, string> = { diploma: 'دیپلم', associate: 'کاردانی', bachelor: 'کارشناسی', master: 'کارشناسی ارشد', phd: 'دکتری', other: 'سایر' };
export const SKILL_KIND: Record<string, string> = { skill: 'مهارت', software: 'نرم‌افزار', certificate: 'گواهینامه', language: 'زبان' };
export const SOURCE: Record<string, string> = { manual: 'ثبت مستقیم', referral: 'معرفی', website: 'وب‌سایت شرکت', job_board: 'سایت کاریابی', university: 'دانشگاه', other: 'سایر' };
export const EMPLOYMENT: Record<string, string> = { full_time: 'تمام‌وقت', part_time: 'پاره‌وقت', contract: 'قراردادی', internship: 'کارآموزی', project: 'پروژه‌ای' };
export const JOB_STATUS: Record<string, { label: string; tone: Tone }> = { open: { label: 'باز', tone: 'success' }, on_hold: { label: 'متوقف', tone: 'warning' }, closed: { label: 'بسته', tone: 'neutral' } };
export const CANDIDATE_STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: 'فعال', tone: 'info' },
  hired: { label: 'استخدام‌شده', tone: 'success' },
  archived: { label: 'بایگانی', tone: 'neutral' },
  merged: { label: 'ادغام‌شده', tone: 'neutral' },
};
export const STAGE_KIND: Record<string, { label: string; tone: Tone }> = { open: { label: 'در جریان', tone: 'info' }, hired: { label: 'استخدام', tone: 'success' }, rejected: { label: 'رد', tone: 'danger' } };
export const MODE: Record<string, string> = { in_person: 'حضوری', online: 'آنلاین', phone: 'تلفنی' };
export const RECOMMENDATION: Record<string, { label: string; tone: Tone }> = {
  strong_yes: { label: 'کاملاً مناسب', tone: 'success' },
  yes: { label: 'مناسب', tone: 'success' },
  no: { label: 'نامناسب', tone: 'danger' },
  strong_no: { label: 'کاملاً نامناسب', tone: 'danger' },
};
export const DUP_RULE: Record<string, string> = { mobile: 'شماره همراه یکسان', email: 'ایمیل یکسان', name: 'نام یکسان' };
export const LEVEL = ['', 'مقدماتی', 'پایه', 'متوسط', 'خوب', 'عالی'];

export const fa = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? '—' : n.toLocaleString('fa-IR', { maximumFractionDigits: digits }));
export const toFaDigits = (s: string) => s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!);

export function Score({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  const tone: Tone = value >= 70 ? 'success' : value >= 40 ? 'warning' : 'neutral';
  return <Badge tone={tone}><span className="tabular-nums">{fa(value)}</span></Badge>;
}

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

export function Nav() {
  const canView = useCan('recruitment.candidate.view');
  const canApps = useCan('recruitment.application.manage');
  const canManage = useCan('recruitment.candidate.manage');
  const canJobs = useCan('recruitment.job.manage');
  const canReport = useCan('recruitment.report.view');
  const link = ({ isActive }: { isActive: boolean }) => `-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${isActive ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-text'}`;
  return (
    <nav aria-label="بخش‌های استخدام" className="mb-6 flex gap-1 overflow-x-auto border-b border-border print:hidden">
      {canView && <NavLink to={`${BASE}/candidates`} className={link}>بانک رزومه</NavLink>}
      {canApps && <NavLink to={`${BASE}/jobs`} className={link}>موقعیت‌ها و قیف</NavLink>}
      <NavLink to={`${BASE}/interviews`} className={link}>مصاحبه‌های من</NavLink>
      {canManage && <NavLink to={`${BASE}/duplicates`} className={link}>رزومه‌های تکراری</NavLink>}
      {canReport && <NavLink to={`${BASE}/reports`} className={link}>گزارش‌ها</NavLink>}
      {canJobs && <NavLink to={`${BASE}/settings`} className={link}>تنظیمات قیف و فرم‌ها</NavLink>}
    </nav>
  );
}
