import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, DateInput, Dialog, Field, Input, Money, MoneyInput, Select, Textarea, toast } from '@mohandesyar/ui';
import { AMENDMENT_KIND, GUARANTEE_KIND, useApi, useServerErrors } from './common.js';

/** Shared dialog shell: posts `body()` to `path` and refreshes the contract on success. */
function FormDialog({ title, path, method = 'post', body, onClose, children, disabled, done }: { title: string; path: string; method?: 'post' | 'put'; body: () => unknown; onClose: () => void; children: (fields: Record<string, string>) => ReactNode; disabled?: boolean; done: string }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const m = useMutation({
    mutationFn: () => (method === 'put' ? a.put(path, body()) : a.post(path, body())),
    onSuccess: () => {
      toast(done);
      void qc.invalidateQueries({ queryKey: ['contracts'] });
      void qc.invalidateQueries({ queryKey: ['widget'] });
      onClose();
    },
    onError: err.set,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>انصراف</Button>
          <Button loading={m.isPending} disabled={disabled} onClick={() => (err.clear(), m.mutate())}>ذخیره</Button>
        </>
      }
    >
      {err.banner}
      <div className="grid gap-4">{children(err.fields)}</div>
    </Dialog>
  );
}

/** Jalali date field with its own "not a real date" message. */
function DateField({ label, value, onChange, error, required, onValidity }: { label: string; value: string; onChange: (iso: string) => void; error?: string; required?: boolean; onValidity: (ok: boolean) => void }) {
  const [bad, setBad] = useState(false);
  return (
    <Field label={label} required={required} error={bad ? 'تاریخ معتبر نیست' : error}>
      <DateInput
        value={value}
        onChange={(iso) => {
          setBad(iso === null);
          onValidity(iso !== null);
          if (iso !== null) onChange(iso);
        }}
      />
    </Field>
  );
}

function useValidity() {
  const [bad, setBad] = useState<Record<string, boolean>>({});
  return { ok: !Object.values(bad).some(Boolean), track: (k: string) => (ok: boolean) => setBad((b) => ({ ...b, [k]: !ok })) };
}

export function AmendmentDialog({ contractId, onClose }: { contractId: string; onClose: () => void }) {
  const [v, setV] = useState({ kind: 'amount', title: '', amountDelta: '', newEndOn: '', signedOn: '', description: '' });
  const val = useValidity();
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <FormDialog title="ثبت الحاقیه" done="الحاقیه ثبت شد" path={`/contracts/${contractId}/amendments`} onClose={onClose} disabled={!val.ok}
      body={() => ({ ...v, amountDelta: v.amountDelta || '0', newEndOn: v.newEndOn || null })}>
      {(f) => (
        <>
          <Field label="نوع الحاقیه" required>
            <Select value={v.kind} onChange={(e) => set('kind')(e.target.value)}>
              {Object.entries(AMENDMENT_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <Field label="عنوان" required error={f.title}><Input value={v.title} onChange={(e) => set('title')(e.target.value)} /></Field>
          <Field label="تغییر مبلغ (کاهش با علامت منفی)" error={f.amountDelta}>
            <MoneyInput allowNegative value={v.amountDelta} onChange={set('amountDelta')} />
          </Field>
          <DateField label="تاریخ پایان جدید" value={v.newEndOn} onChange={set('newEndOn')} error={f.newEndOn} onValidity={val.track('end')} />
          <DateField label="تاریخ امضای الحاقیه" required value={v.signedOn} onChange={set('signedOn')} error={f.signedOn} onValidity={val.track('signed')} />
          <Field label="شرح" error={f.description}><Textarea value={v.description} onChange={(e) => set('description')(e.target.value)} /></Field>
        </>
      )}
    </FormDialog>
  );
}

export function GuaranteeDialog({ contractId, onClose }: { contractId: string; onClose: () => void }) {
  const [v, setV] = useState({ kind: 'performance', number: '', issuer: '', amount: '', issuedOn: '', expiresOn: '' });
  const val = useValidity();
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <FormDialog title="ثبت ضمانت‌نامه" done="ضمانت‌نامه ثبت شد" path={`/contracts/${contractId}/guarantees`} onClose={onClose} disabled={!val.ok}
      body={() => ({ ...v, issuedOn: v.issuedOn || null, expiresOn: v.expiresOn || null })}>
      {(f) => (
        <>
          <Field label="نوع" required>
            <Select value={v.kind} onChange={(e) => set('kind')(e.target.value)}>
              {Object.entries(GUARANTEE_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <Field label="شماره ضمانت‌نامه" error={f.number}><Input dir="auto" value={v.number} onChange={(e) => set('number')(e.target.value)} /></Field>
          <Field label="صادرکننده (بانک/بیمه)" error={f.issuer}><Input value={v.issuer} onChange={(e) => set('issuer')(e.target.value)} /></Field>
          <Field label="مبلغ" required error={f.amount}><MoneyInput value={v.amount} onChange={set('amount')} /></Field>
          <DateField label="تاریخ صدور" value={v.issuedOn} onChange={set('issuedOn')} error={f.issuedOn} onValidity={val.track('issued')} />
          <DateField label="تاریخ سررسید" value={v.expiresOn} onChange={set('expiresOn')} error={f.expiresOn} onValidity={val.track('expires')} />
        </>
      )}
    </FormDialog>
  );
}

export function PaymentTermDialog({ contractId, onClose }: { contractId: string; onClose: () => void }) {
  const [v, setV] = useState({ title: '', amount: '', percent: '', dueOn: '', condition: '' });
  const val = useValidity();
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <FormDialog title="افزودن شرط پرداخت" done="شرط پرداخت افزوده شد" path={`/contracts/${contractId}/payment-terms`} onClose={onClose} disabled={!val.ok}
      body={() => ({ title: v.title, amount: v.amount || null, percent: v.percent.trim() || null, dueOn: v.dueOn || null, condition: v.condition })}>
      {(f) => (
        <>
          <Field label="عنوان (مثلاً پیش‌پرداخت، مرحله اول)" required error={f.title}><Input value={v.title} onChange={(e) => set('title')(e.target.value)} /></Field>
          <Field label="مبلغ" error={f.amount}><MoneyInput value={v.amount} onChange={set('amount')} /></Field>
          <Field label="یا درصد از مبلغ قرارداد" error={f.percent}><Input dir="ltr" inputMode="decimal" value={v.percent} onChange={(e) => set('percent')(e.target.value)} /></Field>
          <DateField label="سررسید" value={v.dueOn} onChange={set('dueOn')} error={f.dueOn} onValidity={val.track('due')} />
          <Field label="شرط تحقق" error={f.condition}><Textarea value={v.condition} onChange={(e) => set('condition')(e.target.value)} /></Field>
        </>
      )}
    </FormDialog>
  );
}

export function ObligationDialog({ contractId, onClose }: { contractId: string; onClose: () => void }) {
  const [v, setV] = useState({ party: 'us', description: '', dueOn: '' });
  const val = useValidity();
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <FormDialog title="افزودن تعهد" done="تعهد افزوده شد" path={`/contracts/${contractId}/obligations`} onClose={onClose} disabled={!val.ok} body={() => ({ ...v, dueOn: v.dueOn || null })}>
      {(f) => (
        <>
          <Field label="متعهد" required>
            <Select value={v.party} onChange={(e) => set('party')(e.target.value)}>
              <option value="us">ما</option>
              <option value="counterparty">طرف قرارداد</option>
            </Select>
          </Field>
          <Field label="شرح تعهد" required error={f.description}><Textarea value={v.description} onChange={(e) => set('description')(e.target.value)} /></Field>
          <DateField label="مهلت" value={v.dueOn} onChange={set('dueOn')} error={f.dueOn} onValidity={val.track('due')} />
        </>
      )}
    </FormDialog>
  );
}

interface Preview {
  periodGross: string;
  goodPerformance: string;
  insurance: string;
  tax: string;
  prepaymentRecovery: string;
  otherDeductions: string;
  vat: string;
  netPayable: string;
}

export interface StatementData {
  id: string;
  number: number;
  period_from: string | null;
  period_to: string;
  cumulative_gross: string;
  other_deductions: string;
  note: string;
}

/** New or draft statement, with the server's calculation shown live before saving. */
export function StatementDialog({ contractId, statement, onClose }: { contractId: string; statement?: StatementData; onClose: () => void }) {
  const a = useApi();
  const [v, setV] = useState({
    periodFrom: statement?.period_from ?? '',
    periodTo: statement?.period_to ?? '',
    cumulativeGross: statement?.cumulative_gross ?? '',
    otherDeductions: statement?.other_deductions ?? '',
    note: statement?.note ?? '',
  });
  const val = useValidity();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const body = () => ({ periodFrom: v.periodFrom || null, periodTo: v.periodTo, cumulativeGross: v.cumulativeGross, otherDeductions: v.otherDeductions || '0', note: v.note });
  useEffect(() => {
    if (!v.cumulativeGross || !v.periodTo) return setPreview(null);
    const t = setTimeout(() => {
      a.post<Preview>(`/contracts/${contractId}/statements/preview${statement ? `?exclude=${statement.id}` : ''}`, body())
        .then((p) => (setPreview(p), setPreviewError(null)))
        .catch((e: Error) => (setPreview(null), setPreviewError(e.message)));
    }, 300);
    return () => clearTimeout(t);
  }, [v.cumulativeGross, v.otherDeductions, v.periodTo, v.periodFrom]);
  const rows: [keyof Preview, string, boolean?][] = [
    ['periodGross', 'کارکرد این دوره'],
    ['goodPerformance', 'کسر حسن انجام کار', true],
    ['insurance', 'کسر بیمه', true],
    ['tax', 'کسر مالیات', true],
    ['prepaymentRecovery', 'استهلاک پیش‌پرداخت', true],
    ['otherDeductions', 'سایر کسورات', true],
    ['vat', 'ارزش افزوده'],
  ];
  return (
    <FormDialog
      title={statement ? `ویرایش صورت‌وضعیت شماره ${statement.number}` : 'صورت‌وضعیت جدید'}
      done="صورت‌وضعیت ذخیره شد"
      method={statement ? 'put' : 'post'}
      path={statement ? `/contracts/${contractId}/statements/${statement.id}` : `/contracts/${contractId}/statements`}
      onClose={onClose}
      disabled={!val.ok}
      body={body}
    >
      {(f) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <DateField label="از تاریخ" value={v.periodFrom} onChange={set('periodFrom')} error={f.periodFrom} onValidity={val.track('from')} />
            <DateField label="تا تاریخ" required value={v.periodTo} onChange={set('periodTo')} error={f.periodTo} onValidity={val.track('to')} />
          </div>
          <Field label="کارکرد تجمعی تا پایان این دوره" required error={f.cumulativeGross} hint="جمع کارکرد از ابتدای قرارداد؛ کارکرد این دوره خودکار محاسبه می‌شود">
            <MoneyInput value={v.cumulativeGross} onChange={set('cumulativeGross')} />
          </Field>
          <Field label="سایر کسورات" error={f.otherDeductions}><MoneyInput value={v.otherDeductions} onChange={set('otherDeductions')} /></Field>
          <Field label="توضیحات" error={f.note}><Textarea value={v.note} onChange={(e) => set('note')(e.target.value)} /></Field>
          <div aria-live="polite" className="rounded-md bg-surface-2 p-4 text-sm">
            {previewError ? (
              <p className="text-danger">{previewError}</p>
            ) : preview ? (
              <dl className="grid grid-cols-[1fr_auto] gap-y-1.5">
                {rows.map(([k, l, minus]) => (
                  <div key={k} className="contents">
                    <dt>{l}</dt>
                    <dd className={minus ? 'text-danger' : ''}>{minus && preview[k] !== '0' ? '− ' : ''}<Money value={preview[k]} /></dd>
                  </div>
                ))}
                <dt className="mt-2 border-t border-border pt-2 font-bold">خالص قابل پرداخت</dt>
                <dd className="mt-2 border-t border-border pt-2 font-bold"><Money value={preview.netPayable} /></dd>
              </dl>
            ) : (
              <p className="text-muted">برای دیدن محاسبه، تاریخ پایان دوره و کارکرد تجمعی را وارد کنید.</p>
            )}
          </div>
        </>
      )}
    </FormDialog>
  );
}
