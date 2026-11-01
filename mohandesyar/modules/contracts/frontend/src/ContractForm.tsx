import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, DateInput, Dialog, Field, Input, MoneyInput, Select, Textarea, toast } from '@mohandesyar/ui';
import { useDirectory, useMe } from '@mohandesyar/module-sdk/web';
import { KIND, LinkPicker, useApi, useServerErrors } from './common.js';

export interface ContractData {
  id: string;
  code: string;
  title: string;
  kind: string;
  direction: 'income' | 'expense';
  counterparty_name: string;
  crm_account_id: string | null;
  projects_project_id: string | null;
  owner_id: string | null;
  initial_amount: string;
  prepayment_amount: string;
  signed_on: string | null;
  start_on: string | null;
  end_on: string | null;
  status: 'draft' | 'active' | 'completed' | 'terminated';
  good_performance_pct: string;
  insurance_pct: string;
  tax_pct: string;
  vat_pct: string;
  prepayment_recovery_pct: string;
  description: string;
  created_by: string;
  version: number;
  current_amount: string;
  approved_gross: string;
}

const pct = (v: string | undefined): string => (v === undefined ? '' : String(Number(v)));

/** Create a contract, or edit one (a signed contract only allows descriptive fields). */
export function ContractForm({ open, onClose, contract }: { open: boolean; onClose: () => void; contract?: ContractData }) {
  const a = useApi();
  const qc = useQueryClient();
  const me = useMe();
  const dir = useDirectory();
  const err = useServerErrors();
  const locked = !!contract && contract.status !== 'draft';
  const [v, setV] = useState(() => ({
    code: contract?.code ?? '',
    title: contract?.title ?? '',
    kind: contract?.kind ?? 'employer',
    direction: contract?.direction ?? 'income',
    counterpartyName: contract?.counterparty_name ?? '',
    crmAccountId: contract?.crm_account_id ?? null,
    projectId: contract?.projects_project_id ?? null,
    ownerId: (contract ? contract.owner_id : me.user.id) as string | null,
    initialAmount: contract?.initial_amount ?? '',
    prepaymentAmount: contract?.prepayment_amount ?? '0',
    startOn: contract?.start_on ?? '',
    endOn: contract?.end_on ?? '',
    goodPerformancePct: pct(contract?.good_performance_pct),
    insurancePct: pct(contract?.insurance_pct),
    taxPct: pct(contract?.tax_pct),
    vatPct: pct(contract?.vat_pct),
    prepaymentRecoveryPct: pct(contract?.prepayment_recovery_pct ?? '0'),
    description: contract?.description ?? '',
  }));
  const [badDate, setBadDate] = useState<Record<string, boolean>>({});
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const date = (k: 'startOn' | 'endOn') => (iso: string | null) => {
    setBadDate((b) => ({ ...b, [k]: iso === null }));
    if (iso !== null) set(k, iso);
  };
  const optional = (s: string) => (s.trim() === '' ? undefined : s.trim());

  const save = useMutation({
    mutationFn: () => {
      const body = locked
        ? { version: contract!.version, status: contract!.status, title: v.title, counterpartyName: v.counterpartyName, crmAccountId: v.crmAccountId, projectId: v.projectId, ownerId: v.ownerId, description: v.description }
        : {
            ...v,
            startOn: v.startOn || null,
            endOn: v.endOn || null,
            initialAmount: v.initialAmount || '',
            goodPerformancePct: optional(v.goodPerformancePct),
            insurancePct: optional(v.insurancePct),
            taxPct: optional(v.taxPct),
            vatPct: optional(v.vatPct),
            prepaymentRecoveryPct: optional(v.prepaymentRecoveryPct) ?? '0',
            ...(contract ? { version: contract.version, status: contract.status } : {}),
          };
      return contract ? a.put(`/contracts/${contract.id}`, body) : a.post<{ id: string }>('/contracts', body);
    },
    onSuccess: () => {
      toast(contract ? 'قرارداد ذخیره شد' : 'قرارداد ثبت شد');
      void qc.invalidateQueries({ queryKey: ['contracts'] });
      void qc.invalidateQueries({ queryKey: ['widget'] });
      onClose();
    },
    onError: err.set,
  });
  const f = err.fields;
  const hasBadDate = Object.values(badDate).some(Boolean);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={contract ? `ویرایش قرارداد ${contract.code}` : 'قرارداد جدید'}
      description={locked ? 'قرارداد امضا شده است؛ مبلغ، مدت و نرخ کسورات فقط با الحاقیه تغییر می‌کند.' : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            انصراف
          </Button>
          <Button loading={save.isPending} disabled={hasBadDate} onClick={() => (err.clear(), save.mutate())}>
            ذخیره
          </Button>
        </>
      }
    >
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        {!locked && (
          <Field label="شماره قرارداد" required error={f.code}>
            <Input value={v.code} onChange={(e) => set('code', e.target.value)} dir="auto" />
          </Field>
        )}
        <Field label="عنوان" required error={f.title} className={locked ? 'sm:col-span-2' : ''}>
          <Input value={v.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        {!locked && (
          <>
            <Field label="نوع قرارداد" required error={f.kind}>
              <Select value={v.kind} onChange={(e) => {
                const k = e.target.value;
                setV((s) => ({ ...s, kind: k, direction: k === 'employer' ? 'income' : k === 'contractor' || k === 'purchase' ? 'expense' : s.direction }));
              }}>
                {Object.entries(KIND).map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </Select>
            </Field>
            <Field label="جهت مالی" required error={f.direction} hint="درآمدی: ما مبلغ را دریافت می‌کنیم">
              <Select value={v.direction} onChange={(e) => set('direction', e.target.value as 'income' | 'expense')}>
                <option value="income">درآمدی</option>
                <option value="expense">هزینه‌ای</option>
              </Select>
            </Field>
          </>
        )}
        <Field label="طرف قرارداد" required error={f.counterpartyName}>
          <Input value={v.counterpartyName} onChange={(e) => set('counterpartyName', e.target.value)} />
        </Field>
        <Field label="مسئول قرارداد" error={f.ownerId} hint="هشدارهای سررسید برای این فرد ارسال می‌شود">
          <Select value={v.ownerId ?? ''} onChange={(e) => set('ownerId', e.target.value || null)}>
            {dir.users.map((u) => (
              <option key={u.id} value={u.id}>{u.fullName}</option>
            ))}
          </Select>
        </Field>
        <LinkPicker kind="projects" label="پروژه مرتبط" value={v.projectId} onChange={(id) => set('projectId', id)} />
        <LinkPicker kind="accounts" label="مشتری/طرف حساب در CRM" value={v.crmAccountId} onChange={(id) => set('crmAccountId', id)} />
        {!locked && (
          <>
            <Field label="مبلغ اولیه قرارداد" required error={f.initialAmount}>
              <MoneyInput value={v.initialAmount} onChange={(d) => set('initialAmount', d)} />
            </Field>
            <Field label="پیش‌پرداخت" error={f.prepaymentAmount}>
              <MoneyInput value={v.prepaymentAmount} onChange={(d) => set('prepaymentAmount', d || '0')} />
            </Field>
            <Field label="تاریخ شروع" error={badDate.startOn ? 'تاریخ معتبر نیست' : f.startOn} hint="مثلاً ۱۴۰۴/۰۱/۱۵">
              <DateInput value={v.startOn} onChange={date('startOn')} />
            </Field>
            <Field label="تاریخ پایان" error={badDate.endOn ? 'تاریخ معتبر نیست' : f.endOn}>
              <DateInput value={v.endOn} onChange={date('endOn')} />
            </Field>
            <fieldset className="grid gap-4 rounded-md border border-border p-4 sm:col-span-2 sm:grid-cols-3">
              <legend className="px-1 text-sm font-medium">نرخ کسورات و اضافات صورت‌وضعیت (درصد) — خالی: مقدار پیش‌فرض تنظیمات</legend>
              {(
                [
                  ['goodPerformancePct', 'حسن انجام کار'],
                  ['insurancePct', 'بیمه'],
                  ['taxPct', 'مالیات علی‌الحساب'],
                  ['vatPct', 'ارزش افزوده (اضافه می‌شود)'],
                  ['prepaymentRecoveryPct', 'استهلاک پیش‌پرداخت'],
                ] as const
              ).map(([k, l]) => (
                <Field key={k} label={l} error={f[k]}>
                  <Input dir="ltr" inputMode="decimal" value={v[k]} onChange={(e) => set(k, e.target.value)} />
                </Field>
              ))}
            </fieldset>
          </>
        )}
        <Field label="شرح و توضیحات" className="sm:col-span-2" error={f.description}>
          <Textarea value={v.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
