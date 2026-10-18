import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, ConfirmDialog, DateInput, DayText, Dialog, EmptyState, ExportMenu, Field, Input, MoneyInput, PageHeader, PageState, Select, Stat, Table, Tabs, Td, Th, toast } from '@mohandesyar/ui';
import { todayIso } from '@mohandesyar/persian';
import { Landmark } from 'lucide-react';
import { AccountSelect, CHEQUE_STATUS, DetailSelect, ErrorBanner, METHOD, Nav, TreasurySelect, fieldErrors, onFail, rial, useApi, useCanDo, useRange, useRefresh, useTreasuries } from './common.js';

export function TreasuryPage() {
  const [tab, setTab] = useState('accounts');
  return (
    <>
      <PageHeader title="خزانه‌داری و چک" />
      <Nav />
      <Tabs label="بخش‌های خزانه" value={tab} onChange={setTab} items={[
        { key: 'accounts', label: 'صندوق و بانک' },
        { key: 'docs', label: 'دریافت و پرداخت' },
        { key: 'received', label: 'چک‌های دریافتی' },
        { key: 'issued', label: 'چک‌های پرداختی' },
      ]} />
      <div className="mt-4">
        {tab === 'accounts' && <Accounts />}
        {tab === 'docs' && <Docs />}
        {tab === 'received' && <Cheques direction="received" />}
        {tab === 'issued' && <Cheques direction="issued" />}
      </div>
    </>
  );
}

function Accounts() {
  const q = useTreasuries();
  const can = useCanDo();
  const [creating, setCreating] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const total = (k: string) => (q.data ?? []).filter((x) => x.kind === k).reduce((s, x) => s + BigInt(x.balance), 0n);
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {can.setup && <Button onClick={() => setCreating(true)}>صندوق / حساب بانکی جدید</Button>}
        {can.treasury && <Button variant="secondary" onClick={() => setTransfer(true)}>انتقال وجه بین حساب‌ها</Button>}
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Stat label="موجودی بانک‌ها">{rial(total('bank'))}</Stat>
        <Stat label="موجودی صندوق‌ها">{rial(total('cash'))}</Stat>
      </div>
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<Landmark className="size-8" />} title="هنوز صندوق یا حساب بانکی تعریف نشده است" />}>
        <Table>
          <thead><tr><Th>نام</Th><Th>نوع</Th><Th>بانک / شماره حساب</Th><Th>شبا</Th><Th>مانده (ریال)</Th></tr></thead>
          <tbody>
            {(q.data ?? []).map((x) => (
              <tr key={x.id}><Td className="font-medium">{x.name}</Td><Td>{x.kind === 'bank' ? 'بانک' : 'صندوق'}</Td><Td>{[x.bank_name, x.account_no].filter(Boolean).join(' — ') || '—'}</Td><Td dir="ltr">{x.iban || '—'}</Td><Td className="tabular-nums">{rial(x.balance)}</Td></tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {creating && <TreasuryForm onClose={() => setCreating(false)} />}
      {transfer && <TransferForm onClose={() => setTransfer(false)} />}
    </>
  );
}

function TreasuryForm({ onClose }: { onClose: () => void }) {
  const a = useApi();
  const refresh = useRefresh();
  const [v, setV] = useState({ kind: 'bank', name: '', bankName: '', accountNo: '', iban: '' });
  const m = useMutation({ mutationFn: () => a.post('/treasury/accounts', v), onSuccess: () => (toast('ذخیره شد'), refresh(), onClose()) });
  const f = fieldErrors(m.error);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="صندوق یا حساب بانکی" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={m.isPending} onClick={() => m.mutate()}>ذخیره</Button></>}>
      <ErrorBanner error={m.error} />
      <div className="grid gap-4">
        <Field label="نوع"><Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}><option value="bank">حساب بانکی</option><option value="cash">صندوق</option></Select></Field>
        <Field label="نام" required error={f.name}><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        {v.kind === 'bank' && <>
          <Field label="نام بانک و شعبه"><Input value={v.bankName} onChange={(e) => setV({ ...v, bankName: e.target.value })} /></Field>
          <Field label="شماره حساب"><Input dir="ltr" value={v.accountNo} onChange={(e) => setV({ ...v, accountNo: e.target.value })} /></Field>
          <Field label="شبا" error={f.iban}><Input dir="ltr" placeholder="IR..." value={v.iban} onChange={(e) => setV({ ...v, iban: e.target.value })} /></Field>
        </>}
      </div>
    </Dialog>
  );
}

function TransferForm({ onClose }: { onClose: () => void }) {
  const a = useApi();
  const refresh = useRefresh();
  const [v, setV] = useState({ fromId: '', toId: '', amount: '', description: '', reference: '' });
  const [date, setDate] = useState<string | null>(todayIso());
  const m = useMutation({ mutationFn: () => a.post('/treasury/transfers', { ...v, date }), onSuccess: () => (toast('انتقال ثبت و سند صادر شد'), refresh(), onClose()) });
  const f = fieldErrors(m.error);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="انتقال وجه" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={m.isPending} disabled={!date} onClick={() => m.mutate()}>ثبت</Button></>}>
      <ErrorBanner error={m.error} />
      <div className="grid gap-4">
        <Field label="تاریخ" required><DateInput value={date ?? undefined} onChange={setDate} /></Field>
        <TreasurySelect label="از" required value={v.fromId} onChange={(x) => setV({ ...v, fromId: x })} error={f.fromId} />
        <TreasurySelect label="به" required value={v.toId} onChange={(x) => setV({ ...v, toId: x })} error={f.toId} />
        <Field label="مبلغ (ریال)" required error={f.amount}><MoneyInput value={v.amount} onChange={(x) => setV({ ...v, amount: x })} /></Field>
        <Field label="شماره پیگیری"><Input value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} /></Field>
        <Field label="شرح"><Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

interface Doc { id: string; number: number; kind: string; date: string; method: string; amount: string; description: string; reference: string; status: string; party: string | null; treasury: string | null; to_treasury: string | null; voucher_number: number | null }
const DOC_KIND: Record<string, string> = { receipt: 'دریافت', payment: 'پرداخت', transfer: 'انتقال' };

function Docs() {
  const a = useApi();
  const can = useCanDo();
  const refresh = useRefresh();
  const r = useRange();
  const [form, setForm] = useState<'receipt' | 'payment' | null>(null);
  const [cancelling, setCancelling] = useState<Doc | null>(null);
  const q = useQuery({ queryKey: ['accounting', 'docs', r.from, r.to], enabled: r.ok, queryFn: () => a.get<Doc[]>(`/treasury/docs?from=${r.from}&to=${r.to}`) });
  const cancel = useMutation({ mutationFn: (d: Doc) => a.post(`/treasury/docs/${d.id}/cancel`, {}), onSuccess: () => (toast('سند ابطال و سند برگشت صادر شد'), refresh(), setCancelling(null)), onError: onFail });
  return (
    <>
      {can.treasury && <div className="mb-4 flex gap-2"><Button onClick={() => setForm('receipt')}>دریافت وجه</Button><Button variant="secondary" onClick={() => setForm('payment')}>پرداخت وجه</Button></div>}
      {r.picker}
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<p className="text-sm text-muted">در این بازه دریافت یا پرداختی ثبت نشده است.</p>}>
        <ExportMenu filename="treasury" title="دریافت و پرداخت" rows={q.data} columns={[
          { header: 'نوع', value: (d) => DOC_KIND[d.kind] }, { header: 'شماره', value: (d) => d.number, kind: 'number' }, { header: 'تاریخ', value: (d) => d.date },
          { header: 'طرف حساب', value: (d) => d.party ?? d.to_treasury ?? '' }, { header: 'روش', value: (d) => METHOD[d.method] }, { header: 'مبلغ', value: (d) => d.amount, kind: 'number' }, { header: 'سند', value: (d) => d.voucher_number ?? '', kind: 'number' },
        ]} />
        <Table>
          <thead><tr><Th>نوع و شماره</Th><Th>تاریخ</Th><Th>طرف حساب</Th><Th>روش</Th><Th>صندوق/بانک</Th><Th>مبلغ</Th><Th>سند</Th><Th>وضعیت</Th></tr></thead>
          <tbody>
            {(q.data ?? []).map((d) => (
              <tr key={d.id}>
                <Td>{DOC_KIND[d.kind]} {d.number.toLocaleString('fa-IR')}</Td><Td className="whitespace-nowrap"><DayText value={d.date} /></Td>
                <Td>{d.kind === 'transfer' ? `به ${d.to_treasury}` : d.party}</Td><Td>{METHOD[d.method]}</Td><Td>{d.treasury ?? '—'}</Td>
                <Td className="tabular-nums">{rial(d.amount)}</Td><Td>{d.voucher_number?.toLocaleString('fa-IR') ?? '—'}</Td>
                <Td>{d.status === 'cancelled' ? <Badge tone="neutral">ابطال‌شده</Badge> : can.treasury && d.kind !== 'transfer' ? <Button size="sm" variant="ghost" onClick={() => setCancelling(d)}>ابطال</Button> : <Badge tone="success">ثبت‌شده</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {form && <DocForm kind={form} onClose={() => setForm(null)} />}
      <ConfirmDialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(null)} title="ابطال سند خزانه" description="برای این سند، سند حسابداری برگشت با تاریخ امروز صادر می‌شود." confirmLabel="ابطال" loading={cancel.isPending} onConfirm={() => cancelling && cancel.mutate(cancelling)} />
    </>
  );
}

function DocForm({ kind, onClose }: { kind: 'receipt' | 'payment'; onClose: () => void }) {
  const a = useApi();
  const refresh = useRefresh();
  const [v, setV] = useState({ detailId: '', counterAccountId: '', method: 'transfer', treasuryId: '', amount: '', description: '', reference: '' });
  const [date, setDate] = useState<string | null>(todayIso());
  const [cheque, setCheque] = useState({ number: '', sayadId: '', bankName: '' });
  const [dueOn, setDueOn] = useState<string | null>(todayIso());
  const m = useMutation({
    mutationFn: () => a.post<{ number: number; voucherNumber: number }>('/treasury/docs', {
      kind, date, ...v, counterAccountId: v.counterAccountId || null, treasuryId: v.treasuryId || null, cheque: v.method === 'cheque' ? { ...cheque, dueOn } : null,
    }),
    onSuccess: (r) => (toast(`ثبت شد؛ سند حسابداری ${r.voucherNumber.toLocaleString('fa-IR')}`), refresh(), onClose()),
  });
  const f = fieldErrors(m.error);
  const needsTreasury = v.method !== 'cheque' || kind === 'payment';
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={kind === 'receipt' ? 'دریافت وجه' : 'پرداخت وجه'} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={m.isPending} disabled={!date} onClick={() => m.mutate()}>ثبت و صدور سند</Button></>}>
      <ErrorBanner error={m.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="تاریخ" required><DateInput value={date ?? undefined} onChange={setDate} /></Field>
        <DetailSelect label={kind === 'receipt' ? 'دریافت از' : 'پرداخت به'} required value={v.detailId} onChange={(x) => setV({ ...v, detailId: x })} error={f.detailId} />
        <AccountSelect label="حساب طرف مقابل" allowEmpty={kind === 'receipt' ? 'حساب‌های دریافتنی (پیش‌فرض)' : 'حساب‌های پرداختنی (پیش‌فرض)'} value={v.counterAccountId} onChange={(x) => setV({ ...v, counterAccountId: x })} />
        <Field label="روش"><Select value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>{Object.entries(METHOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        {needsTreasury && <TreasurySelect label={v.method === 'cheque' ? 'حساب بانکی صادرکننده چک' : 'صندوق / حساب بانکی'} kind={v.method === 'cheque' ? 'bank' : undefined} required value={v.treasuryId} onChange={(x) => setV({ ...v, treasuryId: x })} error={f.treasuryId} />}
        <Field label="مبلغ (ریال)" required error={f.amount}><MoneyInput value={v.amount} onChange={(x) => setV({ ...v, amount: x })} /></Field>
        {v.method === 'cheque' && <>
          <Field label="شماره چک" required error={f['cheque.number']}><Input value={cheque.number} onChange={(e) => setCheque({ ...cheque, number: e.target.value })} /></Field>
          <Field label="شناسه صیادی (۱۶ رقم)" error={f['cheque.sayadId']}><Input dir="ltr" value={cheque.sayadId} onChange={(e) => setCheque({ ...cheque, sayadId: e.target.value })} /></Field>
          <Field label="سررسید" required><DateInput value={dueOn ?? undefined} onChange={setDueOn} /></Field>
          {kind === 'receipt' && <Field label="بانک صادرکننده"><Input value={cheque.bankName} onChange={(e) => setCheque({ ...cheque, bankName: e.target.value })} /></Field>}
        </>}
        <Field label="شماره پیگیری / مرجع"><Input value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} /></Field>
        <Field label="شرح"><Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

interface Cheque { id: string; direction: string; number: string; sayad_id: string; bank_name: string; due_on: string; amount: string; status: string; party: string; treasury: string | null }

function Cheques({ direction }: { direction: 'received' | 'issued' }) {
  const a = useApi();
  const can = useCanDo();
  const [open, setOpen] = useState(true);
  const [acting, setActing] = useState<{ c: Cheque; action: string } | null>(null);
  const [history, setHistory] = useState<Cheque | null>(null);
  const q = useQuery({ queryKey: ['accounting', 'cheques', direction, open], queryFn: () => a.get<Cheque[]>(`/cheques?direction=${direction}${open ? '&open=1' : ''}`) });
  const actions = (c: Cheque): [string, string][] =>
    direction === 'received'
      ? c.status === 'in_hand' ? [['deposit', 'واگذاری به بانک'], ['clear', 'وصول'], ['bounce', 'برگشت'], ['return', 'عودت']] : c.status === 'deposited' ? [['clear', 'وصول'], ['bounce', 'برگشت']] : []
      : c.status === 'issued' ? [['clear', 'پاس شد'], ['bounce', 'برگشت'], ['return', 'عودت/ابطال']] : [];
  const today = todayIso();
  return (
    <>
      <div className="mb-4"><Field label="نمایش"><Select value={open ? '1' : '0'} onChange={(e) => setOpen(e.target.value === '1')}><option value="1">چک‌های جاری</option><option value="0">همه چک‌ها</option></Select></Field></div>
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<p className="text-sm text-muted">چکی نیست.</p>}>
        <ExportMenu filename={`cheques-${direction}`} title={direction === 'received' ? 'چک‌های دریافتی' : 'چک‌های پرداختی'} rows={q.data} columns={[
          { header: 'شماره', value: (c) => c.number }, { header: 'صیادی', value: (c) => c.sayad_id }, { header: 'سررسید', value: (c) => c.due_on }, { header: 'طرف حساب', value: (c) => c.party },
          { header: 'بانک', value: (c) => c.bank_name || c.treasury || '' }, { header: 'مبلغ', value: (c) => c.amount, kind: 'number' }, { header: 'وضعیت', value: (c) => CHEQUE_STATUS[c.status]!.label },
        ]} />
        <Table>
          <thead><tr><Th>شماره</Th><Th>سررسید</Th><Th>طرف حساب</Th><Th>بانک</Th><Th>مبلغ</Th><Th>وضعیت</Th><Th>عملیات</Th></tr></thead>
          <tbody>
            {(q.data ?? []).map((c) => (
              <tr key={c.id}>
                <Td><button type="button" className="text-primary underline" onClick={() => setHistory(c)}>{c.number}</button></Td>
                <Td className={`whitespace-nowrap ${actions(c).length && c.due_on <= today ? 'text-danger' : ''}`}><DayText value={c.due_on} /></Td>
                <Td>{c.party}</Td><Td>{c.bank_name || c.treasury || '—'}</Td><Td className="tabular-nums">{rial(c.amount)}</Td>
                <Td><Badge tone={CHEQUE_STATUS[c.status]!.tone}>{CHEQUE_STATUS[c.status]!.label}</Badge></Td>
                <Td className="whitespace-nowrap">{can.treasury && actions(c).map(([k, l]) => <Button key={k} size="sm" variant={k === 'clear' ? 'primary' : 'ghost'} onClick={() => setActing({ c, action: k })}>{l}</Button>)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {acting && <ChequeActionDialog cheque={acting.c} action={acting.action} onClose={() => setActing(null)} />}
      {history && <ChequeHistory cheque={history} onClose={() => setHistory(null)} />}
    </>
  );
}

function ChequeActionDialog({ cheque, action, onClose }: { cheque: Cheque; action: string; onClose: () => void }) {
  const a = useApi();
  const refresh = useRefresh();
  const [date, setDate] = useState<string | null>(todayIso());
  const [treasuryId, setTreasuryId] = useState('');
  const [note, setNote] = useState('');
  const needsTreasury = cheque.direction === 'received' && (action === 'deposit' || (action === 'clear' && cheque.status === 'in_hand'));
  const m = useMutation({ mutationFn: () => a.post<{ voucherNumber: number | null }>(`/cheques/${cheque.id}/action`, { action, date, treasuryId: treasuryId || null, note }), onSuccess: () => (toast('ثبت شد و سند صادر شد'), refresh(), onClose()) });
  const title: Record<string, string> = { deposit: 'واگذاری چک به بانک', clear: 'وصول چک', bounce: 'برگشت چک', return: 'عودت چک' };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${title[action]} ${cheque.number}`} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={m.isPending} disabled={!date} onClick={() => m.mutate()}>ثبت</Button></>}>
      <ErrorBanner error={m.error} />
      <p className="mb-3 text-sm">{cheque.party} — {rial(cheque.amount)} ریال — سررسید <DayText value={cheque.due_on} /></p>
      <div className="grid gap-4">
        <Field label="تاریخ" required><DateInput value={date ?? undefined} onChange={setDate} /></Field>
        {needsTreasury && <TreasurySelect label={action === 'deposit' ? 'حساب بانکی' : 'وصول به'} kind={action === 'deposit' ? 'bank' : undefined} required value={treasuryId} onChange={setTreasuryId} />}
        <Field label="توضیح"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function ChequeHistory({ cheque, onClose }: { cheque: Cheque; onClose: () => void }) {
  const a = useApi();
  const q = useQuery({ queryKey: ['accounting', 'cheque-history', cheque.id], queryFn: () => a.get<{ id: string; date: string; from_status: string | null; to_status: string; note: string; voucher_number: number | null }[]>(`/cheques/${cheque.id}/history`) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`گردش چک ${cheque.number}`}>
      <PageState query={q}>
        <Card>
          <ul className="space-y-2 text-sm">
            {(q.data ?? []).map((e) => <li key={e.id}><DayText value={e.date} /> — {CHEQUE_STATUS[e.to_status]?.label}{e.voucher_number ? ` (سند ${e.voucher_number.toLocaleString('fa-IR')})` : ''}{e.note ? ` — ${e.note}` : ''}</li>)}
          </ul>
        </Card>
      </PageState>
    </Dialog>
  );
}
