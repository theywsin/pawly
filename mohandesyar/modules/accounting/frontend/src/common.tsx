import { useState } from 'react';
import { NavLink } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, DateInput, Field, Select, toast, type Tone } from '@mohandesyar/ui';
import { ApiError, useCan, useModuleApi } from '@mohandesyar/module-sdk/web';
import { todayIso } from '@mohandesyar/persian';

export const useApi = () => useModuleApi('accounting');
export const BASE = '/app/accounting';

export const rial = (v: string | number | bigint | null | undefined) => (v === null || v === undefined || v === '' ? '—' : BigInt(v).toLocaleString('fa-IR'));
/** Signed balance as «۱۲۳ بد» / «۱۲۳ بس». */
export const side = (v: string | bigint) => {
  const n = BigInt(v);
  return n === 0n ? '۰' : `${(n < 0n ? -n : n).toLocaleString('fa-IR')} ${n > 0n ? 'بد' : 'بس'}`;
};
export const qtyFa = (q: string) => Number(q).toLocaleString('fa-IR', { maximumFractionDigits: 3 });

export const VOUCHER_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'پیش‌نویس', tone: 'warning' },
  posted: { label: 'قطعی', tone: 'success' },
  reversed: { label: 'برگشت‌خورده', tone: 'neutral' },
};
export const VOUCHER_KIND: Record<string, string> = { normal: 'عادی', opening: 'افتتاحیه', closing: 'اختتامیه', income_closing: 'بستن حساب‌های موقت', reversal: 'برگشتی' };
export const SOURCE: Record<string, string> = { manual: 'دستی', invoice: 'فاکتور', treasury: 'خزانه', cheque: 'چک', inventory: 'انبار', asset: 'دارایی ثابت', depreciation: 'استهلاک', closing: 'بستن حساب‌ها', reversal: 'برگشت', procurement: 'تدارکات', finance: 'ماژول مالی' };
export const INVOICE_KIND: Record<string, string> = { sale: 'فروش', purchase: 'خرید', sale_return: 'برگشت از فروش', purchase_return: 'برگشت از خرید' };
export const INVOICE_STATUS: Record<string, { label: string; tone: Tone }> = { draft: { label: 'پیش‌نویس', tone: 'warning' }, approved: { label: 'تأییدشده', tone: 'success' }, cancelled: { label: 'ابطال‌شده', tone: 'neutral' } };
export const CHEQUE_STATUS: Record<string, { label: string; tone: Tone }> = {
  in_hand: { label: 'نزد صندوق', tone: 'info' },
  deposited: { label: 'در جریان وصول', tone: 'warning' },
  issued: { label: 'صادرشده', tone: 'info' },
  cleared: { label: 'وصول/پاس‌شده', tone: 'success' },
  bounced: { label: 'برگشتی', tone: 'danger' },
  returned: { label: 'عودت/ابطال', tone: 'neutral' },
};
export const DETAIL_KIND: Record<string, string> = { person: 'شخص', company: 'شرکت', project: 'پروژه', cost_center: 'مرکز هزینه', bank: 'بانک', cash: 'صندوق', employee: 'کارمند', other: 'سایر' };
export const METHOD: Record<string, string> = { cash: 'نقد', transfer: 'انتقال بانکی / کارت', cheque: 'چک' };

export function errorText(e: unknown) {
  if (e instanceof ApiError) {
    const d = Array.isArray(e.details) ? (e.details as { path: string; message: string }[]) : [];
    return d.length ? `${e.message}: ${d[0]!.message}` : e.message;
  }
  return 'عملیات انجام نشد؛ دوباره تلاش کنید';
}
export const fieldErrors = (e: unknown): Record<string, string> =>
  e instanceof ApiError && Array.isArray(e.details) ? Object.fromEntries((e.details as { path: string; message: string }[]).map((x) => [x.path, x.message])) : {};
export const ErrorBanner = ({ error }: { error: unknown }) => (error ? <Alert tone="danger" className="mb-4">{errorText(error)}</Alert> : null);

export function useRefresh() {
  const qc = useQueryClient();
  return () => (void qc.invalidateQueries({ queryKey: ['accounting'] }), void qc.invalidateQueries({ queryKey: ['widget'] }));
}
export const onFail = (e: unknown) => toast(errorText(e), 'danger');

export function Nav() {
  const link = ({ isActive }: { isActive: boolean }) => `-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${isActive ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-text'}`;
  return (
    <nav aria-label="بخش‌های حسابداری" className="mb-6 flex gap-1 overflow-x-auto border-b border-border print:hidden">
      <NavLink to={`${BASE}`} end className={link}>اسناد</NavLink>
      <NavLink to={`${BASE}/reports`} className={link}>دفاتر و گزارش‌ها</NavLink>
      <NavLink to={`${BASE}/treasury`} className={link}>خزانه و چک</NavLink>
      <NavLink to={`${BASE}/invoices`} className={link}>فاکتورها</NavLink>
      <NavLink to={`${BASE}/inventory`} className={link}>کالا و انبار</NavLink>
      <NavLink to={`${BASE}/assets`} className={link}>دارایی ثابت</NavLink>
      <NavLink to={`${BASE}/setup`} className={link}>حساب‌ها و تنظیمات</NavLink>
    </nav>
  );
}

export interface Account { id: string; code: string; name: string; level: 'group' | 'ledger' | 'subsidiary'; parent_id: string | null; type: string; nature: string; needs_detail: boolean; system_key: string | null; active: boolean }
export interface Detail { id: string; code: string; name: string; kind: string; national_id: string; economic_code: string; postal_code: string; address: string; phone: string; active: boolean }
export interface TreasuryAccount { id: string; kind: 'cash' | 'bank'; name: string; bank_name: string; account_no: string; iban: string; active: boolean; account_id: string; detail_id: string; balance: string }
export interface Item { id: string; code: string; name: string; kind: 'goods' | 'service'; unit: string; sale_price: string; vat_exempt: boolean; expense_account_id: string | null; active: boolean; on_hand: string; stock_value: string }

export const useAccounts = () => {
  const a = useApi();
  return useQuery({ queryKey: ['accounting', 'accounts'], queryFn: () => a.get<Account[]>('/accounts') });
};
export const useDetails = () => {
  const a = useApi();
  return useQuery({ queryKey: ['accounting', 'details'], queryFn: () => a.get<Detail[]>('/details') });
};
export const useTreasuries = () => {
  const a = useApi();
  return useQuery({ queryKey: ['accounting', 'treasuries'], queryFn: () => a.get<TreasuryAccount[]>('/treasury/accounts') });
};
export const useItems = () => {
  const a = useApi();
  return useQuery({ queryKey: ['accounting', 'items'], queryFn: () => a.get<Item[]>('/items') });
};
export const useWarehouses = () => {
  const a = useApi();
  return useQuery({ queryKey: ['accounting', 'warehouses'], queryFn: () => a.get<{ id: string; name: string; active: boolean }[]>('/warehouses') });
};
export const useYears = () => {
  const a = useApi();
  return useQuery({ queryKey: ['accounting', 'years'], queryFn: () => a.get<{ id: string; title: string; start_on: string; end_on: string; status: string; drafts: number; posted: number }[]>('/years') });
};

/** Postable (subsidiary) accounts, shown with their code; optional filter by level for reports. */
export function AccountSelect({ value, onChange, label = 'حساب', error, levels = ['subsidiary'], required, allowEmpty, className }: { value: string; onChange: (v: string) => void; label?: string; error?: string; levels?: Account['level'][]; required?: boolean; allowEmpty?: string; className?: string }) {
  const q = useAccounts();
  return (
    <Field label={label} required={required} error={error} className={className}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allowEmpty ?? 'انتخاب کنید'}</option>
        {(q.data ?? []).filter((x) => levels.includes(x.level) && (x.active || x.id === value)).map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}
      </Select>
    </Field>
  );
}

export function DetailSelect({ value, onChange, label = 'طرف حساب (تفصیلی)', error, required, allowEmpty, kinds, className }: { value: string; onChange: (v: string) => void; label?: string; error?: string; required?: boolean; allowEmpty?: string; kinds?: string[]; className?: string }) {
  const q = useDetails();
  return (
    <Field label={label} required={required} error={error} className={className}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allowEmpty ?? 'انتخاب کنید'}</option>
        {(q.data ?? []).filter((x) => (x.active || x.id === value) && (!kinds || kinds.includes(x.kind))).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}
      </Select>
    </Field>
  );
}

export function TreasurySelect({ value, onChange, label = 'صندوق / حساب بانکی', kind, error, required }: { value: string; onChange: (v: string) => void; label?: string; kind?: 'cash' | 'bank'; error?: string; required?: boolean }) {
  const q = useTreasuries();
  return (
    <Field label={label} required={required} error={error}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">انتخاب کنید</option>
        {(q.data ?? []).filter((x) => x.active && (!kind || x.kind === kind)).map((x) => <option key={x.id} value={x.id}>{x.name} — مانده {rial(x.balance)}</option>)}
      </Select>
    </Field>
  );
}

/** From–to date range defaulting to the current fiscal year start … today. */
export function useRange() {
  const years = useYears();
  const today = todayIso();
  const current = years.data?.find((y) => y.start_on <= today && today <= y.end_on);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(today);
  const f = from ?? current?.start_on ?? today;
  const ok = !!to && f <= to;
  const picker = (
    <div className="mb-4 flex flex-wrap items-end gap-3 print:hidden">
      <Field label="از تاریخ"><DateInput value={f} onChange={setFrom} /></Field>
      <Field label="تا تاریخ" error={to && f > to ? 'پایان پیش از شروع است' : undefined}><DateInput value={to ?? undefined} onChange={setTo} /></Field>
    </div>
  );
  return { from: f, to: to ?? today, ok: ok && !years.isPending, picker };
}

export const useCanDo = () => ({
  setup: useCan('accounting.setup'),
  party: useCan('accounting.party'),
  voucher: useCan('accounting.voucher'),
  post: useCan('accounting.post'),
  treasury: useCan('accounting.treasury'),
  invoice: useCan('accounting.invoice'),
  approve: useCan('accounting.invoice.approve'),
  inventory: useCan('accounting.inventory'),
  assets: useCan('accounting.assets'),
});
