import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, DateInput, Dialog, Field, Select, Textarea, toast } from '@mohandesyar/ui';
import { ApiError, useCan, useDirectory, useModuleApi } from '@mohandesyar/module-sdk/web';
import { todayIso } from '@mohandesyar/persian';

export const useApi = () => useModuleApi('crm');

export const SOURCE: Record<string, string> = {
  website: 'وب‌سایت', referral: 'معرفی', tender: 'مناقصه/فراخوان', exhibition: 'نمایشگاه', call: 'تماس ورودی', social: 'شبکه‌های اجتماعی', existing_customer: 'مشتری فعلی', other: 'سایر',
};
export const LEAD_STATUS: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  new: { label: 'جدید', tone: 'info' },
  contacted: { label: 'تماس گرفته شد', tone: 'neutral' },
  qualified: { label: 'واجد شرایط', tone: 'warning' },
  converted: { label: 'تبدیل‌شده', tone: 'success' },
  lost: { label: 'از دست رفته', tone: 'danger' },
};
export const INTERACTION: Record<string, string> = { call: 'تماس تلفنی', meeting: 'جلسه', visit: 'بازدید', email: 'ایمیل', message: 'پیام', note: 'یادداشت' };
export const PROPOSAL_KIND: Record<string, string> = { technical: 'فنی', financial: 'مالی', technical_financial: 'فنی و مالی' };
export const PROPOSAL_STATUS: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  draft: { label: 'پیش‌نویس', tone: 'neutral' },
  sent: { label: 'ارسال‌شده', tone: 'info' },
  accepted: { label: 'پذیرفته‌شده', tone: 'success' },
  rejected: { label: 'ردشده', tone: 'danger' },
};

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

/** Dialog that posts/puts `body()` and refreshes CRM queries. */
export function FormDialog<T = unknown>({ title, path, method = 'post', body, onClose, children, disabled, done, size, onDone }: { title: string; path: string; method?: 'post' | 'put'; body: () => unknown; onClose: () => void; children: (f: Record<string, string>) => ReactNode; disabled?: boolean; done: string; size?: 'md' | 'lg'; onDone?: (r: T) => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const m = useMutation({
    mutationFn: () => (method === 'put' ? a.put<T>(path, body()) : a.post<T>(path, body())),
    onSuccess: (r) => {
      toast(done);
      void qc.invalidateQueries({ queryKey: ['crm'] });
      void qc.invalidateQueries({ queryKey: ['widget'] });
      onDone?.(r);
      onClose();
    },
    onError: err.set,
  });
  return (
    <Dialog open size={size} onOpenChange={(o) => !o && onClose()} title={title}
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={m.isPending} disabled={disabled} onClick={() => (err.clear(), m.mutate())}>ذخیره</Button></>}>
      {err.banner}
      <div className="grid gap-4">{children(err.fields)}</div>
    </Dialog>
  );
}

export function useDate(initial = '') {
  const [value, setValue] = useState(initial);
  const [bad, setBad] = useState(false);
  return { value, bad, onChange: (iso: string | null) => (setBad(iso === null), iso !== null && setValue(iso)) };
}

export function UserSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const dir = useDirectory();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— خودم —</option>
      {dir.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
    </Select>
  );
}

/** Section navigation inside the CRM module. */
export function CrmNav() {
  const reports = useCan('crm.report.view');
  const settings = useCan('crm.settings.manage');
  const accounts = useCan('crm.account.view');
  const link = ({ isActive }: { isActive: boolean }) => `-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${isActive ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-text'}`;
  return (
    <nav aria-label="بخش‌های فروش" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      <NavLink to="/app/crm" end className={link}>قیف فروش</NavLink>
      <NavLink to="/app/crm/leads" className={link}>سرنخ‌ها</NavLink>
      {accounts && <NavLink to="/app/crm/accounts" className={link}>مشتریان</NavLink>}
      {reports && <NavLink to="/app/crm/reports" className={link}>گزارش فروش</NavLink>}
      {settings && <NavLink to="/app/crm/settings" className={link}>مراحل قیف</NavLink>}
    </nav>
  );
}

/** Log a call, meeting… for an account, lead or opportunity; optionally set the next follow-up date. */
export function InteractionDialog({ target, onClose }: { target: { accountId?: string; leadId?: string; opportunityId?: string }; onClose: () => void }) {
  const [kind, setKind] = useState('call');
  const [summary, setSummary] = useState('');
  const date = useDate(todayIso());
  const next = useDate('');
  return (
    <FormDialog title="ثبت ارتباط" done="ارتباط ثبت شد" path="/interactions" onClose={onClose} disabled={date.bad || next.bad}
      body={() => ({ accountId: target.accountId ?? null, leadId: target.leadId ?? null, opportunityId: target.opportunityId ?? null, kind, occurredOn: date.value, summary, nextContactOn: next.value || null })}>
      {(f) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نوع">
              <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                {Object.entries(INTERACTION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            </Field>
            <Field label="تاریخ" required error={date.bad ? 'تاریخ معتبر نیست' : f.occurredOn}><DateInput value={date.value} onChange={date.onChange} /></Field>
          </div>
          <Field label="خلاصه" required error={f.summary}><Textarea value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
          {!target.accountId && <Field label="پیگیری بعدی" error={next.bad ? 'تاریخ معتبر نیست' : f.nextContactOn}><DateInput value={next.value} onChange={next.onChange} /></Field>}
        </>
      )}
    </FormDialog>
  );
}
