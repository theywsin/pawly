import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { DateInput, Field, Input, MoneyInput, Select, Textarea } from '@mohandesyar/ui';
import { useModule } from '@mohandesyar/module-sdk/web';
import { FormDialog, SOURCE, useApi, useDate, UserSelect } from './common.js';

export interface LeadData {
  id: string;
  title: string;
  organization_name: string;
  contact_name: string;
  mobile: string | null;
  email: string;
  source: string;
  need: string;
  estimated_budget: string | null;
  score: number;
  owner_id: string | null;
  next_contact_on: string | null;
  status: string;
  account_id: string | null;
}

export function LeadForm({ lead, onClose }: { lead?: LeadData; onClose: () => void }) {
  const nav = useNavigate();
  const [v, setV] = useState({
    title: lead?.title ?? '', organizationName: lead?.organization_name ?? '', contactName: lead?.contact_name ?? '', mobile: lead?.mobile ?? '', email: lead?.email ?? '',
    source: lead?.source ?? 'referral', need: lead?.need ?? '', estimatedBudget: lead?.estimated_budget ?? '', score: String(lead?.score ?? 0), ownerId: lead?.owner_id ?? '',
    status: lead && lead.status !== 'converted' && lead.status !== 'lost' ? lead.status : 'new',
  });
  const next = useDate(lead?.next_contact_on ?? '');
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <FormDialog<{ id: string }> size="lg" title={lead ? 'ویرایش سرنخ' : 'سرنخ جدید'} done="سرنخ ذخیره شد" method={lead ? 'put' : 'post'} path={lead ? `/leads/${lead.id}` : '/leads'} onClose={onClose} disabled={next.bad}
      onDone={(r) => !lead && nav(`/app/crm/leads/${r.id}`)}
      body={() => ({ ...v, accountId: lead?.account_id ?? null, estimatedBudget: v.estimatedBudget || null, ownerId: v.ownerId || null, nextContactOn: next.value || null })}>
      {(f) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="عنوان (موضوع درخواست)" required error={f.title} className="sm:col-span-2"><Input value={v.title} onChange={(e) => set('title')(e.target.value)} /></Field>
          <Field label="سازمان" error={f.organizationName}><Input value={v.organizationName} onChange={(e) => set('organizationName')(e.target.value)} /></Field>
          <Field label="نام مخاطب" error={f.contactName}><Input value={v.contactName} onChange={(e) => set('contactName')(e.target.value)} /></Field>
          <Field label="موبایل" error={f.mobile}><Input dir="ltr" inputMode="tel" value={v.mobile} onChange={(e) => set('mobile')(e.target.value)} /></Field>
          <Field label="ایمیل" error={f.email}><Input dir="ltr" value={v.email} onChange={(e) => set('email')(e.target.value)} /></Field>
          <Field label="منبع" required error={f.source}>
            <Select value={v.source} onChange={(e) => set('source')(e.target.value)}>
              {Object.entries(SOURCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <Field label="بودجه تخمینی" error={f.estimatedBudget}><MoneyInput value={v.estimatedBudget} onChange={set('estimatedBudget')} /></Field>
          <Field label="امتیاز (۰ تا ۱۰۰)" error={f.score} hint="میزان جدی بودن و تناسب"><Input dir="ltr" inputMode="numeric" value={v.score} onChange={(e) => set('score')(e.target.value)} /></Field>
          <Field label="وضعیت">
            <Select value={v.status} onChange={(e) => set('status')(e.target.value)}>
              <option value="new">جدید</option><option value="contacted">تماس گرفته شد</option><option value="qualified">واجد شرایط</option>
            </Select>
          </Field>
          <Field label="مسئول پیگیری"><UserSelect value={v.ownerId} onChange={set('ownerId')} /></Field>
          <Field label="تاریخ تماس بعدی" error={next.bad ? 'تاریخ معتبر نیست' : f.nextContactOn}><DateInput value={next.value} onChange={next.onChange} /></Field>
          <Field label="نیاز مشتری" error={f.need} className="sm:col-span-2"><Textarea value={v.need} onChange={(e) => set('need')(e.target.value)} /></Field>
        </div>
      )}
    </FormDialog>
  );
}

export interface AccountData {
  id: string;
  kind: string;
  name: string;
  national_id: string;
  economic_code: string;
  industry: string;
  phone: string;
  email: string;
  city: string;
  address: string;
  source: string;
  notes: string;
  owner_id: string | null;
}

export function AccountForm({ account, onClose }: { account?: AccountData; onClose: () => void }) {
  const nav = useNavigate();
  const [v, setV] = useState({
    kind: account?.kind ?? 'company', name: account?.name ?? '', nationalId: account?.national_id ?? '', economicCode: account?.economic_code ?? '', industry: account?.industry ?? '',
    phone: account?.phone ?? '', email: account?.email ?? '', city: account?.city ?? '', address: account?.address ?? '', source: account?.source ?? '', notes: account?.notes ?? '', ownerId: account?.owner_id ?? '',
  });
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <FormDialog<{ id: string }> size="lg" title={account ? `ویرایش ${account.name}` : 'مشتری جدید'} done="مشتری ذخیره شد" method={account ? 'put' : 'post'} path={account ? `/accounts/${account.id}` : '/accounts'} onClose={onClose}
      onDone={(r) => !account && nav(`/app/crm/accounts/${r.id}`)} body={() => ({ ...v, ownerId: v.ownerId || null })}>
      {(f) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نوع">
            <Select value={v.kind} onChange={(e) => set('kind')(e.target.value)}><option value="company">شرکت/سازمان</option><option value="person">شخص</option></Select>
          </Field>
          <Field label="نام" required error={f.name}><Input value={v.name} onChange={(e) => set('name')(e.target.value)} /></Field>
          <Field label={v.kind === 'company' ? 'شناسه ملی' : 'کد ملی'}><Input dir="ltr" value={v.nationalId} onChange={(e) => set('nationalId')(e.target.value)} /></Field>
          <Field label="کد اقتصادی"><Input dir="ltr" value={v.economicCode} onChange={(e) => set('economicCode')(e.target.value)} /></Field>
          <Field label="حوزه فعالیت"><Input value={v.industry} onChange={(e) => set('industry')(e.target.value)} /></Field>
          <Field label="تلفن"><Input dir="ltr" value={v.phone} onChange={(e) => set('phone')(e.target.value)} /></Field>
          <Field label="ایمیل" error={f.email}><Input dir="ltr" value={v.email} onChange={(e) => set('email')(e.target.value)} /></Field>
          <Field label="شهر"><Input value={v.city} onChange={(e) => set('city')(e.target.value)} /></Field>
          <Field label="نشانی" className="sm:col-span-2"><Input value={v.address} onChange={(e) => set('address')(e.target.value)} /></Field>
          <Field label="مسئول مشتری"><UserSelect value={v.ownerId} onChange={set('ownerId')} /></Field>
          <Field label="نحوه آشنایی"><Input value={v.source} onChange={(e) => set('source')(e.target.value)} /></Field>
          <Field label="یادداشت" className="sm:col-span-2"><Textarea value={v.notes} onChange={(e) => set('notes')(e.target.value)} /></Field>
        </div>
      )}
    </FormDialog>
  );
}

export interface OpportunityData {
  id: string;
  title: string;
  account_id: string;
  contact_id: string | null;
  amount: string;
  probability: number | null;
  expected_close_on: string | null;
  owner_id: string | null;
  next_contact_on: string | null;
  source: string;
  projects_project_id: string | null;
  contracts_contract_id: string | null;
}

export function OpportunityForm({ opportunity, accountId, onClose }: { opportunity?: OpportunityData; accountId?: string; onClose: () => void }) {
  const a = useApi();
  const nav = useNavigate();
  const projectsOn = useModule('projects');
  const contractsOn = useModule('contracts');
  const accounts = useQuery({ queryKey: ['crm', 'accounts', ''], queryFn: () => a.get<{ id: string; name: string }[]>('/accounts') });
  const projects = useQuery({ queryKey: ['crm', 'lookup', 'projects'], queryFn: () => a.get<{ id: string; code: string; title: string }[]>('/lookups/projects?q='), enabled: projectsOn });
  const contracts = useQuery({ queryKey: ['crm', 'lookup', 'contracts'], queryFn: () => a.get<{ id: string; code: string; title: string }[]>('/lookups/contracts?q='), enabled: contractsOn });
  const [v, setV] = useState({
    title: opportunity?.title ?? '', accountId: opportunity?.account_id ?? accountId ?? '', amount: opportunity?.amount ?? '', probability: opportunity?.probability === null || opportunity?.probability === undefined ? '' : String(opportunity.probability),
    ownerId: opportunity?.owner_id ?? '', source: opportunity?.source ?? '', projectId: opportunity?.projects_project_id ?? '', contractId: opportunity?.contracts_contract_id ?? '',
  });
  const close = useDate(opportunity?.expected_close_on ?? '');
  const next = useDate(opportunity?.next_contact_on ?? '');
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <FormDialog<{ id: string }> size="lg" title={opportunity ? 'ویرایش فرصت' : 'فرصت فروش جدید'} done="فرصت ذخیره شد" method={opportunity ? 'put' : 'post'} path={opportunity ? `/opportunities/${opportunity.id}` : '/opportunities'} onClose={onClose}
      disabled={close.bad || next.bad} onDone={(r) => !opportunity && nav(`/app/crm/opportunities/${r.id}`)}
      body={() => ({ title: v.title, accountId: v.accountId, contactId: opportunity?.contact_id ?? null, amount: v.amount || '0', probability: v.probability.trim() === '' ? null : v.probability, ownerId: v.ownerId || null,
        expectedCloseOn: close.value || null, nextContactOn: next.value || null, source: v.source, projectId: v.projectId || null, contractId: v.contractId || null })}>
      {(f) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="عنوان" required error={f.title} className="sm:col-span-2"><Input value={v.title} onChange={(e) => set('title')(e.target.value)} /></Field>
          <Field label="مشتری" required error={f.accountId}>
            <Select value={v.accountId} onChange={(e) => set('accountId')(e.target.value)}>
              <option value="">— انتخاب کنید —</option>
              {accounts.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
          <Field label="ارزش فرصت" error={f.amount}><MoneyInput value={v.amount} onChange={set('amount')} /></Field>
          <Field label="احتمال موفقیت (درصد)" error={f.probability} hint="خالی = احتمال مرحله"><Input dir="ltr" inputMode="numeric" value={v.probability} onChange={(e) => set('probability')(e.target.value)} /></Field>
          <Field label="تاریخ پیش‌بینی بستن" error={close.bad ? 'تاریخ معتبر نیست' : f.expectedCloseOn}><DateInput value={close.value} onChange={close.onChange} /></Field>
          <Field label="مسئول"><UserSelect value={v.ownerId} onChange={set('ownerId')} /></Field>
          <Field label="پیگیری بعدی" error={next.bad ? 'تاریخ معتبر نیست' : f.nextContactOn}><DateInput value={next.value} onChange={next.onChange} /></Field>
          {projectsOn && (
            <Field label="پروژه مرتبط">
              <Select value={v.projectId} onChange={(e) => set('projectId')(e.target.value)}>
                <option value="">— بدون اتصال —</option>
                {projects.data?.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.title}</option>)}
              </Select>
            </Field>
          )}
          {contractsOn && (
            <Field label="قرارداد مرتبط">
              <Select value={v.contractId} onChange={(e) => set('contractId')(e.target.value)}>
                <option value="">— بدون اتصال —</option>
                {contracts.data?.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.title}</option>)}
              </Select>
            </Field>
          )}
        </div>
      )}
    </FormDialog>
  );
}
