import { useState } from 'react';
import { NavLink } from 'react-router';
import { Alert, type Tone } from '@mohandesyar/ui';
import { ApiError, useCan, useModuleApi } from '@mohandesyar/module-sdk/web';

export const useApi = () => useModuleApi('hr');
export const BASE = '/app/hr';

export const CONTRACT_KIND: Record<string, string> = { permanent: 'دائم', fixed_term: 'موقت (مدت معین)', project: 'پروژه‌ای', hourly: 'ساعتی', internship: 'کارآموزی' };
export const RECORD_KIND: Record<string, string> = {
  hire: 'استخدام', promotion: 'ارتقا', transfer: 'جابه‌جایی', commendation: 'تشویق', warning: 'تذکر', education: 'تحصیلات', prior_experience: 'سابقه کار پیشین', other: 'سایر',
};
export const SKILL_KIND: Record<string, string> = { skill: 'مهارت', software: 'نرم‌افزار', certificate: 'گواهینامه', language: 'زبان' };
export const LEVEL = ['', 'مقدماتی', 'پایه', 'متوسط', 'خوب', 'عالی'];
export const LEAVE_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'در انتظار تأیید', tone: 'warning' },
  approved: { label: 'تأییدشده', tone: 'success' },
  rejected: { label: 'ردشده', tone: 'danger' },
  cancelled: { label: 'لغوشده', tone: 'neutral' },
};
export const DEGREE: Record<string, string> = { diploma: 'دیپلم', associate: 'کاردانی', bachelor: 'کارشناسی', master: 'کارشناسی ارشد', phd: 'دکتری', other: 'سایر' };

export const fa = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? '—' : n.toLocaleString('fa-IR', { maximumFractionDigits: digits }));

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
  const all = useCan('hr.employee.manage');
  const reviews = useCan('hr.review.view');
  const leaveTypes = useCan('hr.leave.manage');
  const link = ({ isActive }: { isActive: boolean }) => `-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${isActive ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-text'}`;
  return (
    <nav aria-label="بخش‌های پرونده کارکنان" className="mb-6 flex gap-1 overflow-x-auto border-b border-border print:hidden">
      {all && <NavLink to={`${BASE}/employees`} className={link}>کارکنان</NavLink>}
      <NavLink to={`${BASE}/me`} className={link}>پرونده من</NavLink>
      <NavLink to={`${BASE}/leave`} className={link}>مرخصی</NavLink>
      {reviews && <NavLink to={`${BASE}/reviews`} className={link}>ارزیابی عملکرد</NavLink>}
      {leaveTypes && <NavLink to={`${BASE}/settings`} className={link}>انواع مرخصی</NavLink>}
    </nav>
  );
}
