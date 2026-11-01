import { useState } from 'react';
import { Alert } from '@mohandesyar/ui';
import { ApiError, useModuleApi } from '@mohandesyar/module-sdk/web';

export const useApi = () => useModuleApi('projects');

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
export const STATUS: Record<string, { label: string; tone: Tone }> = {
  planning: { label: 'برنامه‌ریزی', tone: 'neutral' },
  active: { label: 'در حال اجرا', tone: 'success' },
  on_hold: { label: 'متوقف', tone: 'warning' },
  completed: { label: 'تکمیل‌شده', tone: 'info' },
  cancelled: { label: 'لغوشده', tone: 'danger' },
};
export const TYPE: Record<string, string> = {
  building: 'ساختمانی', infrastructure: 'زیربنایی', industrial: 'صنعتی', road: 'راه و ابنیه', water: 'آب و فاضلاب', energy: 'انرژی', consulting: 'مشاوره و طراحی', other: 'سایر',
};
export const MEMBER_ROLE: Record<string, string> = { manager: 'مدیر پروژه', engineer: 'مهندس', supervisor: 'ناظر', site: 'کارگاه', member: 'عضو' };
export const ISSUE_KIND: Record<string, string> = { delay: 'تأخیر', obstacle: 'مانع', issue: 'مسئله' };
export const PHASE_KIND: Record<string, string> = { phase: 'مرحله', temporary_handover: 'تحویل موقت', final_handover: 'تحویل قطعی' };
export const CHANGE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'پیش‌نویس', tone: 'neutral' },
  submitted: { label: 'در انتظار تأیید', tone: 'warning' },
  approved: { label: 'تأییدشده', tone: 'success' },
  rejected: { label: 'ردشده', tone: 'danger' },
};
export const DEP_TYPE: Record<string, string> = { FS: 'پایان به شروع', SS: 'شروع به شروع', FF: 'پایان به پایان', SF: 'شروع به پایان' };

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v).toLocaleString('fa-IR')}٪`);

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
        setGeneral(e.message);
      } else setGeneral('عملیات انجام نشد؛ دوباره تلاش کنید');
    },
    banner: general ? <Alert tone="danger" className="mb-4">{general}</Alert> : null,
  };
}

export interface Progress {
  planned: number | null;
  actual: number | null;
  time: number | null;
  financial: number | null;
}

export interface ProjectData {
  id: string;
  code: string;
  title: string;
  project_type: string;
  employer_name: string;
  crm_account_id: string | null;
  contracts_contract_id: string | null;
  manager_id: string | null;
  province: string;
  city: string;
  location: string;
  specs: string;
  description: string;
  planned_start: string | null;
  planned_finish: string | null;
  actual_start: string | null;
  actual_finish: string | null;
  budget_amount: string | null;
  status: string;
  version: number;
}
