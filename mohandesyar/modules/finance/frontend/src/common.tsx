import { useState } from 'react';
import { NavLink } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Alert, Field, Select, type Tone } from '@mohandesyar/ui';
import { ApiError, useCan, useModule, useModuleApi } from '@mohandesyar/module-sdk/web';

export const useApi = () => useModuleApi('finance');
export const BASE = '/app/finance';

export const ACCOUNT_KIND: Record<string, string> = { bank: 'بانکی', petty_cash: 'تنخواه', cash: 'صندوق' };
export const TX_TYPE: Record<string, string> = { receipt: 'دریافت', payment: 'پرداخت', transfer: 'انتقال بین حساب‌ها' };
export const PR_STATUS: Record<string, { label: string; tone: Tone }> = {
  requested: { label: 'در انتظار تأیید', tone: 'warning' },
  approved: { label: 'تأییدشده، آماده اجرا', tone: 'info' },
  rejected: { label: 'ردشده', tone: 'danger' },
  cancelled: { label: 'لغوشده', tone: 'neutral' },
  executed: { label: 'اجراشده', tone: 'success' },
};
export const OB_STATE: Record<string, { label: string; tone: Tone }> = {
  open: { label: 'باز', tone: 'info' },
  overdue: { label: 'سررسیدگذشته', tone: 'danger' },
  settled: { label: 'تسویه‌شده', tone: 'success' },
  cancelled: { label: 'لغوشده', tone: 'neutral' },
};
export const CHEQUE_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'در جریان', tone: 'warning' },
  cleared: { label: 'وصول‌شده', tone: 'success' },
  bounced: { label: 'برگشتی', tone: 'danger' },
  cancelled: { label: 'باطل', tone: 'neutral' },
};
export const METHOD: Record<string, string> = { transfer: 'انتقال بانکی', cash: 'نقد / تنخواه', cheque: 'چک' };

export const rial = (v: string | number | bigint | null | undefined) => (v === null || v === undefined ? '—' : BigInt(v).toLocaleString('fa-IR'));

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

export interface Account { id: string; kind: string; name: string; bank_name: string; number: string; iban: string | null; custodian_id: string | null; archived: boolean; opening_balance: string; opening_on: string; balance: string }
export interface Category { id: string; kind: 'income' | 'expense'; name: string; parent_id: string | null; archived: boolean }
export interface Counterparty { id: string; kind: string; name: string; national_id: string; phone: string; iban: string | null; notes: string; archived: boolean; receivable: string; payable: string }

export const useAccounts = (enabled = true) => {
  const a = useApi();
  return useQuery({ queryKey: ['finance', 'accounts'], queryFn: () => a.get<Account[]>('/accounts'), enabled });
};
export const useCategories = () => {
  const a = useApi();
  return useQuery({ queryKey: ['finance', 'categories'], queryFn: () => a.get<Category[]>('/categories') });
};
export const useCounterparties = () => {
  const a = useApi();
  return useQuery({ queryKey: ['finance', 'counterparties'], queryFn: () => a.get<Counterparty[]>('/counterparties') });
};
export const useProjects = () => {
  const a = useApi();
  const on = useModule('projects');
  return useQuery({ queryKey: ['finance', 'projects'], queryFn: () => a.get<{ id: string; code: string; title: string }[]>('/lookups/projects'), enabled: on });
};

export function CategorySelect({ kind, value, onChange, error }: { kind: 'income' | 'expense'; value: string; onChange: (v: string) => void; error?: string }) {
  const q = useCategories();
  return (
    <Field label={kind === 'income' ? 'سرفصل درآمد' : 'سرفصل هزینه'} required error={error}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">انتخاب کنید</option>
        {(q.data ?? []).filter((c) => c.kind === kind && !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
    </Field>
  );
}

export function CounterpartySelect({ value, onChange, label = 'طرف‌حساب', error }: { value: string; onChange: (v: string) => void; label?: string; error?: string }) {
  const q = useCounterparties();
  return (
    <Field label={label} required error={error}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">انتخاب کنید</option>
        {(q.data ?? []).filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
    </Field>
  );
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

export function AccountSelect({ value, onChange, label = 'حساب', error, kind }: { value: string; onChange: (v: string) => void; label?: string; error?: string; kind?: string }) {
  const q = useAccounts();
  return (
    <Field label={label} required error={error}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">انتخاب کنید</option>
        {(q.data ?? []).filter((x) => !x.archived && (!kind || x.kind === kind)).map((x) => <option key={x.id} value={x.id}>{x.name} ({rial(x.balance)} ریال)</option>)}
      </Select>
    </Field>
  );
}

export function Nav() {
  const view = useCan('finance.transaction.view');
  const ob = useCan('finance.obligation.manage');
  const budget = useCan('finance.budget.view');
  const report = useCan('finance.report.view');
  const rec = useCan('finance.reconcile');
  const setup = useCan('finance.account.manage');
  const link = ({ isActive }: { isActive: boolean }) => `-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${isActive ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-text'}`;
  return (
    <nav aria-label="بخش‌های مالی" className="mb-6 flex gap-1 overflow-x-auto border-b border-border print:hidden">
      {view && <NavLink to={`${BASE}/accounts`} className={link}>حساب‌ها و تراکنش‌ها</NavLink>}
      <NavLink to={`${BASE}/payments`} className={link}>درخواست‌های پرداخت</NavLink>
      {ob && <NavLink to={`${BASE}/obligations`} className={link}>مطالبات و بدهی‌ها</NavLink>}
      {ob && <NavLink to={`${BASE}/cheques`} className={link}>چک‌ها</NavLink>}
      {budget && <NavLink to={`${BASE}/budgets`} className={link}>بودجه پروژه‌ها</NavLink>}
      {report && <NavLink to={`${BASE}/cashflow`} className={link}>جریان نقدی</NavLink>}
      {rec && <NavLink to={`${BASE}/reconciliation`} className={link}>مغایرت‌گیری</NavLink>}
      {report && <NavLink to={`${BASE}/reports`} className={link}>گزارش‌ها</NavLink>}
      {setup && <NavLink to={`${BASE}/settings`} className={link}>تنظیمات</NavLink>}
    </nav>
  );
}
