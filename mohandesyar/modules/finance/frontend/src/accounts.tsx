import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Plus, Wallet } from 'lucide-react';
import { Alert, Badge, Button, DateInput, DayText, Dialog, EmptyState, ExportMenu, Field, Input, Ltr, MoneyInput, PageHeader, PageState, Select, Stat, Table, Td, Th, toast } from '@mohandesyar/ui';
import { useCan, useDirectory } from '@mohandesyar/module-sdk/web';
import { todayIso } from '@mohandesyar/persian';
import { ACCOUNT_KIND, AccountSelect, CategorySelect, Nav, ProjectSelect, TX_TYPE, rial, useAccounts, useApi, useServerErrors, type Account } from './common.js';

interface Tx { id: string; type: string; direction: 'in' | 'out'; account_id: string; account_name: string; amount: string; occurred_on: string; counterparty_name: string | null; category_name: string | null; description: string; reference: string; transfer_group_id: string | null; reverses_id: string | null; voided_at: string | null; void_reason: string | null; payment_request_id: string | null }

export function AccountsPage() {
  const a = useApi();
  const canSetup = useCan('finance.account.manage');
  const canRecord = useCan('finance.transaction.record');
  const canVoid = useCan('finance.transaction.void');
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState('');
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [dialog, setDialog] = useState<'receipt' | 'transfer' | null>(null);
  const [voiding, setVoiding] = useState<Tx | null>(null);
  const txs = useQuery({ queryKey: ['finance', 'transactions', accountId], queryFn: () => a.get<Tx[]>(`/transactions${accountId ? `?accountId=${accountId}` : ''}`) });
  const live = (accounts.data ?? []).filter((x) => !x.archived);
  const total = live.reduce((s, x) => s + BigInt(x.balance), 0n);
  return (
    <>
      <PageHeader
        title="مالی و کنترل بودجه"
        description="سیستم مدیریتی-کنترلی؛ جایگزین نرم‌افزار حسابداری رسمی یا سامانه مودیان نیست. خروجی Excel/CSV برای انتقال به حسابداری."
        actions={
          <>
            {canRecord && <Button variant="secondary" onClick={() => setDialog('transfer')}><ArrowLeftRight className="size-4" /> انتقال بین حساب‌ها</Button>}
            {canRecord && <Button variant="secondary" onClick={() => setDialog('receipt')}><Plus className="size-4" /> ثبت دریافت</Button>}
            {canSetup && <Button onClick={() => setEditing('new')}><Plus className="size-4" /> حساب جدید</Button>}
          </>
        }
      />
      <Nav />
      <PageState query={accounts} isEmpty={accounts.data?.length === 0} empty={<EmptyState icon={<Wallet className="size-8" />} title="هنوز حسابی تعریف نشده است" description="حساب‌های بانکی، تنخواه و صندوق را با مانده افتتاحیه تعریف کنید." action={canSetup ? <Button onClick={() => setEditing('new')}>تعریف حساب</Button> : undefined} />}>
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="موجودی کل">{rial(total)} <span className="text-sm text-muted">ریال</span></Stat>
          {live.map((x) => (
            <div key={x.id} className={`rounded-lg border bg-surface p-4 ${accountId === x.id ? 'border-primary' : 'border-border'}`}>
              <button type="button" onClick={() => setAccountId(accountId === x.id ? '' : x.id)} className="w-full text-start" aria-pressed={accountId === x.id}>
                <div className="text-sm text-muted">{x.name} · {ACCOUNT_KIND[x.kind]}</div>
                <div className="mt-1 text-lg font-bold tabular-nums">{rial(x.balance)}</div>
              </button>
              {canSetup && <button type="button" className="text-xs text-primary underline" onClick={() => setEditing(x)}>ویرایش {x.name}</button>}
            </div>
          ))}
        </div>
      </PageState>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">تراکنش‌ها{accountId && ` — ${live.find((x) => x.id === accountId)?.name ?? ''}`}</h2>
        <ExportMenu filename="transactions" title="تراکنش‌ها" rows={txs.data} columns={[
          { header: 'تاریخ', value: (r) => r.occurred_on }, { header: 'نوع', value: (r) => TX_TYPE[r.type] }, { header: 'حساب', value: (r) => r.account_name },
          { header: 'ورود (ریال)', value: (r) => (r.direction === 'in' ? r.amount : null), kind: 'number' }, { header: 'خروج (ریال)', value: (r) => (r.direction === 'out' ? r.amount : null), kind: 'number' },
          { header: 'طرف‌حساب', value: (r) => r.counterparty_name }, { header: 'سرفصل', value: (r) => r.category_name }, { header: 'شرح', value: (r) => r.description }, { header: 'مرجع', value: (r) => r.reference },
          { header: 'وضعیت', value: (r) => (r.voided_at ? 'ابطال‌شده' : r.reverses_id ? 'سند معکوس' : '') },
        ]} />
      </div>
      <PageState query={txs} isEmpty={txs.data?.length === 0} empty={<p className="text-sm text-muted">تراکنشی ثبت نشده است.</p>}>
        <Table>
          <thead><tr><Th>تاریخ</Th><Th>نوع</Th><Th>حساب</Th><Th>مبلغ (ریال)</Th><Th>طرف‌حساب / سرفصل</Th><Th>شرح</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
          <tbody>
            {txs.data?.map((t) => (
              <tr key={t.id} className={t.voided_at ? 'text-muted line-through' : undefined}>
                <Td className="whitespace-nowrap"><DayText value={t.occurred_on} /></Td>
                <Td>{TX_TYPE[t.type]}{t.reverses_id && <Badge className="ms-1">معکوس</Badge>}</Td>
                <Td>{t.account_name}</Td>
                <Td className={`whitespace-nowrap tabular-nums ${t.direction === 'in' ? 'text-success' : 'text-danger'}`}>{t.direction === 'in' ? '+' : '−'}{rial(t.amount)}</Td>
                <Td>{t.counterparty_name ?? '—'}{t.category_name && <div className="text-xs text-muted">{t.category_name}</div>}</Td>
                <Td className="max-w-64">{t.description}{t.reference && <div className="text-xs text-muted">مرجع: <Ltr>{t.reference}</Ltr></div>}{t.voided_at && <div className="text-xs">ابطال: {t.void_reason}</div>}</Td>
                <Td>{canVoid && !t.voided_at && !t.reverses_id && (t.type !== 'transfer' || t.direction === 'out') && <Button size="sm" variant="ghost" onClick={() => setVoiding(t)}>ابطال</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {editing && <AccountForm account={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {dialog === 'receipt' && <ReceiptDialog onClose={() => setDialog(null)} />}
      {dialog === 'transfer' && <TransferDialog onClose={() => setDialog(null)} />}
      {voiding && <VoidDialog tx={voiding} onClose={() => setVoiding(null)} />}
    </>
  );
}

function AccountForm({ account, onClose }: { account?: Account; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const dir = useDirectory();
  const err = useServerErrors();
  const [v, setV] = useState({ kind: account?.kind ?? 'bank', name: account?.name ?? '', bankName: account?.bank_name ?? '', number: account?.number ?? '', iban: account?.iban ?? '', custodianId: account?.custodian_id ?? '', openingBalance: account?.opening_balance ?? '0' });
  const [on, setOn] = useState<string | null>(account?.opening_on ?? todayIso());
  const [archived, setArchived] = useState(account?.archived ?? false);
  const save = useMutation({
    mutationFn: () => (account ? a.put(`/accounts/${account.id}`, { ...v, openingOn: on, archived, custodianId: v.custodianId || null }) : a.post('/accounts', { ...v, openingOn: on, custodianId: v.custodianId || null })),
    onSuccess: () => (toast('حساب ذخیره شد'), void qc.invalidateQueries({ queryKey: ['finance'] }), onClose()),
    onError: err.set,
  });
  const f = err.fields;
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={account ? 'ویرایش حساب' : 'حساب جدید'} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!on} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ذخیره</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نوع"><Select value={v.kind} onChange={(e) => set('kind')(e.target.value)}>{Object.entries(ACCOUNT_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="نام حساب" required error={f.name}><Input value={v.name} onChange={(e) => set('name')(e.target.value)} placeholder="مثلاً: جاری ملت شعبه مرکزی" /></Field>
        {v.kind === 'bank' && <Field label="بانک"><Input value={v.bankName} onChange={(e) => set('bankName')(e.target.value)} /></Field>}
        {v.kind === 'bank' && <Field label="شماره حساب"><Input dir="ltr" value={v.number} onChange={(e) => set('number')(e.target.value)} /></Field>}
        {v.kind === 'bank' && <Field label="شماره شبا" error={f.iban} className="sm:col-span-2"><Input dir="ltr" value={v.iban} onChange={(e) => set('iban')(e.target.value)} placeholder="IR..." /></Field>}
        {v.kind !== 'bank' && <Field label="متصدی"><Select value={v.custodianId} onChange={(e) => set('custodianId')(e.target.value)}><option value="">—</option>{dir.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</Select></Field>}
        <Field label="مانده افتتاحیه (ریال)" error={f.openingBalance}><MoneyInput value={v.openingBalance} onChange={set('openingBalance')} /></Field>
        <Field label="تاریخ مانده افتتاحیه" required error={f.openingOn}><DateInput value={on} onChange={setOn} /></Field>
        {account && <Field label="وضعیت"><Select value={archived ? '1' : ''} onChange={(e) => setArchived(!!e.target.value)}><option value="">فعال</option><option value="1">بایگانی</option></Select></Field>}
      </div>
    </Dialog>
  );
}

function ReceiptDialog({ onClose }: { onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [v, setV] = useState({ accountId: '', amount: '', counterpartyId: '', categoryId: '', projectId: '', description: '', reference: '' });
  const [on, setOn] = useState<string | null>(todayIso());
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const save = useMutation({
    mutationFn: () => a.post('/receipts', { ...v, occurredOn: on, counterpartyId: v.counterpartyId || null, projectId: v.projectId || null }),
    onSuccess: () => (toast('دریافت ثبت شد'), void qc.invalidateQueries({ queryKey: ['finance'] }), onClose()),
    onError: err.set,
  });
  const f = err.fields;
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="ثبت دریافت" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!on} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <AccountSelect value={v.accountId} onChange={set('accountId')} label="واریز به حساب" error={f.accountId} />
        <Field label="مبلغ (ریال)" required error={f.amount}><MoneyInput value={v.amount} onChange={set('amount')} /></Field>
        <Field label="تاریخ" required><DateInput value={on} onChange={setOn} /></Field>
        <CategorySelect kind="income" value={v.categoryId} onChange={set('categoryId')} error={f.categoryId} />
        <Field label="پرداخت‌کننده (اختیاری)"><CounterpartyInline value={v.counterpartyId} onChange={set('counterpartyId')} /></Field>
        <ProjectSelect value={v.projectId} onChange={set('projectId')} />
        <Field label="شرح" className="sm:col-span-2"><Input value={v.description} onChange={(e) => set('description')(e.target.value)} /></Field>
        <Field label="شماره پیگیری"><Input dir="ltr" value={v.reference} onChange={(e) => set('reference')(e.target.value)} /></Field>
      </div>
      <Alert tone="info" className="mt-4">دریافت مربوط به یک مطالبه را از صفحه «مطالبات و بدهی‌ها» ثبت کنید تا مانده آن به‌روز شود.</Alert>
    </Dialog>
  );
}

function CounterpartyInline({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const a = useApi();
  const q = useQuery({ queryKey: ['finance', 'counterparties'], queryFn: () => a.get<{ id: string; name: string; archived: boolean }[]>('/counterparties') });
  return <Select aria-label="طرف‌حساب" value={value} onChange={(e) => onChange(e.target.value)}><option value="">—</option>{(q.data ?? []).filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>;
}

function TransferDialog({ onClose }: { onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [v, setV] = useState({ fromAccountId: '', toAccountId: '', amount: '', description: '', reference: '' });
  const [on, setOn] = useState<string | null>(todayIso());
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const save = useMutation({ mutationFn: () => a.post('/transfers', { ...v, occurredOn: on }), onSuccess: () => (toast('انتقال ثبت شد'), void qc.invalidateQueries({ queryKey: ['finance'] }), onClose()), onError: err.set });
  const f = err.fields;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="انتقال بین حساب‌ها" description="انتقال بین حساب‌های خود سازمان است و هرگز درآمد یا هزینه شمرده نمی‌شود."
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!on} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4">
        <AccountSelect value={v.fromAccountId} onChange={set('fromAccountId')} label="از حساب" error={f.fromAccountId} />
        <AccountSelect value={v.toAccountId} onChange={set('toAccountId')} label="به حساب" error={f.toAccountId} />
        <Field label="مبلغ (ریال)" required error={f.amount}><MoneyInput value={v.amount} onChange={set('amount')} /></Field>
        <Field label="تاریخ" required><DateInput value={on} onChange={setOn} /></Field>
        <Field label="شرح"><Input value={v.description} onChange={(e) => set('description')(e.target.value)} /></Field>
        <Field label="شماره پیگیری"><Input dir="ltr" value={v.reference} onChange={(e) => set('reference')(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function VoidDialog({ tx, onClose }: { tx: Tx; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [reason, setReason] = useState('');
  const [on, setOn] = useState<string | null>(todayIso());
  const save = useMutation({ mutationFn: () => a.post(`/transactions/${tx.id}/void`, { reason, occurredOn: on }), onSuccess: () => (toast('سند معکوس ثبت شد'), void qc.invalidateQueries({ queryKey: ['finance'] }), onClose()), onError: err.set });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="ابطال تراکنش" description="تراکنش حذف یا ویرایش نمی‌شود؛ یک سند معکوس با همین مبلغ ثبت و تراکنش اصلی «ابطال‌شده» علامت می‌خورد."
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button variant="danger" disabled={!on} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت سند معکوس</Button></>}>
      {err.banner}
      <p className="mb-3 text-sm">{TX_TYPE[tx.type]} {rial(tx.amount)} ریال — <DayText value={tx.occurred_on} />{tx.type === 'transfer' && ' (هر دو طرف انتقال ابطال می‌شود)'}</p>
      <div className="grid gap-4">
        <Field label="دلیل ابطال" required error={err.fields.reason}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Field label="تاریخ سند معکوس" required><DateInput value={on} onChange={setOn} /></Field>
      </div>
    </Dialog>
  );
}

