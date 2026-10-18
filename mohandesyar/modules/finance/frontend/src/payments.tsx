import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Receipt } from 'lucide-react';
import { Alert, Badge, Button, DateInput, DayText, Dialog, EmptyState, ExportMenu, Field, Input, Ltr, MoneyInput, PageHeader, PageState, Select, Table, Tabs, Td, Th, toast } from '@mohandesyar/ui';
import { useCan, useDirectory, useMe } from '@mohandesyar/module-sdk/web';
import { todayIso } from '@mohandesyar/persian';
import { AccountSelect, CategorySelect, CHEQUE_STATUS, CounterpartySelect, METHOD, Nav, OB_STATE, PR_STATUS, ProjectSelect, rial, useApi, useServerErrors } from './common.js';

interface PR { id: string; number: number; counterparty_name: string; counterparty_iban: string | null; amount: string; due_on: string; description: string; category_name: string; projects_project_id: string | null; obligation_id: string | null; status: string; requested_by: string; requested_at: string; approvers: string[]; method: string | null; executed_by: string | null; executed_at: string | null; bank_reference: string }

export function PaymentsPage() {
  const a = useApi();
  const qc = useQueryClient();
  const me = useMe();
  const dir = useDirectory();
  const canRequest = useCan('finance.payment.request');
  const canExecute = useCan('finance.payment.execute');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [executing, setExecuting] = useState<PR | null>(null);
  const q = useQuery({
    queryKey: ['finance', 'prs', status, canRequest],
    queryFn: () => (canRequest ? a.get<PR[]>(`/payment-requests${status ? `?status=${status}` : ''}`) : a.get<PR[]>('/payment-requests/approved')),
  });
  const cancel = useMutation({ mutationFn: (id: string) => a.post(`/payment-requests/${id}/cancel`), onSuccess: () => (toast('درخواست لغو شد'), void qc.invalidateQueries({ queryKey: ['finance'] })) });
  return (
    <>
      <PageHeader
        title="درخواست‌های پرداخت"
        description="درخواست، تأیید و اجرای پرداخت سه مرحله جدا با افراد جدا هستند؛ درخواست‌دهنده و تأییدکنندگان نمی‌توانند پرداخت را اجرا کنند."
        actions={
          <>
            <ExportMenu filename="payment-requests" title="درخواست‌های پرداخت" rows={q.data} columns={[
              { header: 'شماره', value: (r) => r.number, kind: 'number' }, { header: 'ذی‌نفع', value: (r) => r.counterparty_name }, { header: 'شبا', value: (r) => r.counterparty_iban },
              { header: 'مبلغ (ریال)', value: (r) => r.amount, kind: 'number' }, { header: 'سررسید', value: (r) => r.due_on }, { header: 'شرح', value: (r) => r.description }, { header: 'سرفصل', value: (r) => r.category_name },
              { header: 'وضعیت', value: (r) => PR_STATUS[r.status]?.label }, { header: 'درخواست‌دهنده', value: (r) => dir.name(r.requested_by) }, { header: 'مرجع بانکی', value: (r) => r.bank_reference },
            ]} />
            {canRequest && <Button onClick={() => setCreating(true)}><Plus className="size-4" /> درخواست پرداخت</Button>}
          </>
        }
      />
      <Nav />
      {canRequest && (
        <Tabs label="وضعیت" value={status} onChange={setStatus} items={[{ key: '', label: 'همه' }, ...Object.entries(PR_STATUS).map(([k, s]) => ({ key: k, label: s.label }))]} />
      )}
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<Receipt className="size-8" />} title="درخواستی وجود ندارد" />}>
        <Table>
          <thead><tr><Th>شماره</Th><Th>ذی‌نفع</Th><Th>مبلغ (ریال)</Th><Th>سررسید</Th><Th>شرح</Th><Th>وضعیت</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
          <tbody>
            {q.data?.map((p) => (
              <tr key={p.id}>
                <Td className="tabular-nums">{p.number.toLocaleString('fa-IR')}</Td>
                <Td>{p.counterparty_name}{p.counterparty_iban && <div className="text-xs text-muted"><Ltr>{p.counterparty_iban}</Ltr></div>}</Td>
                <Td className="tabular-nums">{rial(p.amount)}</Td>
                <Td><DayText value={p.due_on} /></Td>
                <Td className="max-w-64">{p.description}<div className="text-xs text-muted">{p.category_name} · درخواست: {dir.name(p.requested_by)}{p.approvers.length > 0 && ` · تأیید: ${p.approvers.map(dir.name).join('، ')}`}</div></Td>
                <Td>
                  <Badge tone={PR_STATUS[p.status]!.tone}>{PR_STATUS[p.status]!.label}</Badge>
                  {p.status === 'executed' && <div className="text-xs text-muted">{METHOD[p.method!]} · {dir.name(p.executed_by)}</div>}
                  {p.status === 'requested' && <div className="text-xs"><Link className="text-primary underline" to="/app/approvals">کارتابل تأیید</Link></div>}
                </Td>
                <Td className="whitespace-nowrap">
                  {canExecute && p.status === 'approved' && p.requested_by !== me.user.id && !p.approvers.includes(me.user.id) && <Button size="sm" onClick={() => setExecuting(p)}>اجرای پرداخت</Button>}
                  {(p.status === 'requested' || p.status === 'approved') && p.requested_by === me.user.id && <Button size="sm" variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate(p.id)}>لغو</Button>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {creating && <RequestDialog onClose={() => setCreating(false)} />}
      {executing && <ExecuteDialog pr={executing} onClose={() => setExecuting(null)} />}
    </>
  );
}

function RequestDialog({ onClose }: { onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const companyScope = useCan('finance.transaction.view');
  const [v, setV] = useState({ counterpartyId: '', amount: '', description: '', categoryId: '', projectId: '', obligationId: '' });
  const [due, setDue] = useState<string | null>(todayIso());
  const [newPayee, setNewPayee] = useState(false);
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const payables = useQuery({ queryKey: ['finance', 'payables', v.counterpartyId], queryFn: () => a.get<{ id: string; description: string; remaining: string; due_on: string }[]>(`/lookups/payables?counterpartyId=${v.counterpartyId}`), enabled: !!v.counterpartyId && companyScope });
  const save = useMutation({
    mutationFn: () => a.post<{ number: number }>('/payment-requests', { ...v, dueOn: due, projectId: v.projectId || null, obligationId: v.obligationId || null }),
    onSuccess: (r) => (toast(`درخواست ${r.number.toLocaleString('fa-IR')} ثبت و برای تأیید ارسال شد`), void qc.invalidateQueries({ queryKey: ['finance'] }), onClose()),
    onError: err.set,
  });
  const f = err.fields;
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="درخواست پرداخت" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!due} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ارسال برای تأیید</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <CounterpartySelect value={v.counterpartyId} onChange={(x) => setV((s) => ({ ...s, counterpartyId: x, obligationId: '' }))} label="ذی‌نفع" error={f.counterpartyId} />
          <button type="button" className="mt-1 text-xs text-primary underline" onClick={() => setNewPayee(true)}>ذی‌نفع جدید</button>
        </div>
        <Field label="مبلغ (ریال)" required error={f.amount}><MoneyInput value={v.amount} onChange={set('amount')} /></Field>
        <Field label="تاریخ پرداخت مورد نیاز" required error={f.dueOn}><DateInput value={due} onChange={setDue} /></Field>
        <CategorySelect kind="expense" value={v.categoryId} onChange={set('categoryId')} error={f.categoryId} />
        <ProjectSelect value={v.projectId} onChange={set('projectId')} required={!companyScope} error={f.projectId} />
        {(payables.data ?? []).length > 0 && (
          <Field label="بابت بدهی (اختیاری)">
            <Select value={v.obligationId} onChange={(e) => set('obligationId')(e.target.value)}><option value="">—</option>{payables.data!.map((o) => <option key={o.id} value={o.id}>{o.description} — مانده {rial(o.remaining)}</option>)}</Select>
          </Field>
        )}
        <Field label="شرح" required error={f.description} className="sm:col-span-2"><Input value={v.description} onChange={(e) => set('description')(e.target.value)} /></Field>
      </div>
      {newPayee && <PayeeDialog onClose={(id) => (setNewPayee(false), id && set('counterpartyId')(id))} />}
    </Dialog>
  );
}

export function PayeeDialog({ onClose }: { onClose: (id?: string) => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [v, setV] = useState({ kind: 'company', name: '', nationalId: '', phone: '', iban: '' });
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const save = useMutation({ mutationFn: () => a.post<{ id: string }>('/counterparties', v), onSuccess: (r) => (toast('طرف‌حساب ثبت شد'), void qc.invalidateQueries({ queryKey: ['finance', 'counterparties'] }), onClose(r.id)), onError: err.set });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="طرف‌حساب جدید" footer={<><Button variant="ghost" onClick={() => onClose()}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4">
        <Field label="نوع"><Select value={v.kind} onChange={(e) => set('kind')(e.target.value)}><option value="company">شرکت</option><option value="person">شخص</option></Select></Field>
        <Field label="نام" required error={err.fields.name}><Input value={v.name} onChange={(e) => set('name')(e.target.value)} /></Field>
        <Field label="شناسه ملی / کد ملی"><Input dir="ltr" value={v.nationalId} onChange={(e) => set('nationalId')(e.target.value)} /></Field>
        <Field label="تلفن"><Input dir="ltr" value={v.phone} onChange={(e) => set('phone')(e.target.value)} /></Field>
        <Field label="شماره شبا" error={err.fields.iban}><Input dir="ltr" value={v.iban} onChange={(e) => set('iban')(e.target.value)} placeholder="IR..." /></Field>
      </div>
    </Dialog>
  );
}

function ExecuteDialog({ pr, onClose }: { pr: PR; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [v, setV] = useState({ method: 'transfer', accountId: '', bankReference: '', chequeNumber: '' });
  const [on, setOn] = useState<string | null>(todayIso());
  const [chequeDue, setChequeDue] = useState<string | null>(pr.due_on);
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const save = useMutation({
    mutationFn: () => a.post(`/payment-requests/${pr.id}/execute`, { ...v, occurredOn: on, chequeDueOn: v.method === 'cheque' ? chequeDue : null }),
    onSuccess: () => (toast('پرداخت اجرا شد'), void qc.invalidateQueries({ queryKey: ['finance'] }), onClose()),
    onError: err.set,
  });
  const f = err.fields;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`اجرای درخواست ${pr.number.toLocaleString('fa-IR')}`} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!on} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت اجرا</Button></>}>
      {err.banner}
      <p className="mb-4 text-sm">{pr.counterparty_name} — {rial(pr.amount)} ریال{pr.counterparty_iban && <> — شبا <Ltr>{pr.counterparty_iban}</Ltr></>}</p>
      <div className="grid gap-4">
        <Field label="روش پرداخت"><Select value={v.method} onChange={(e) => set('method')(e.target.value)}>{Object.entries(METHOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <AccountSelect value={v.accountId} onChange={set('accountId')} label="از حساب" error={f.accountId} />
        <Field label="تاریخ" required><DateInput value={on} onChange={setOn} /></Field>
        {v.method === 'transfer' && <Field label="شماره پیگیری بانکی" required error={f.bankReference}><Input dir="ltr" value={v.bankReference} onChange={(e) => set('bankReference')(e.target.value)} /></Field>}
        {v.method === 'cheque' && <Field label="شماره چک" required error={f.chequeNumber}><Input dir="ltr" value={v.chequeNumber} onChange={(e) => set('chequeNumber')(e.target.value)} /></Field>}
        {v.method === 'cheque' && <Field label="تاریخ چک" required><DateInput value={chequeDue} onChange={setChequeDue} /></Field>}
        {v.method === 'cheque' && <Alert tone="info">با صدور چک، درخواست اجراشده ثبت می‌شود و مبلغ هنگام وصول چک از حساب کسر می‌شود.</Alert>}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- receivables & payables

interface Obligation { id: string; kind: string; counterparty_id: string; counterparty_name: string; amount: string; paid: string; remaining: string; issued_on: string; due_on: string; description: string; reference: string; source: string; state: string }

export function ObligationsPage() {
  const a = useApi();
  const qc = useQueryClient();
  const [kind, setKind] = useState('receivable');
  const [creating, setCreating] = useState(false);
  const [settling, setSettling] = useState<Obligation | null>(null);
  const q = useQuery({ queryKey: ['finance', 'obligations', kind], queryFn: () => a.get<Obligation[]>(`/obligations?kind=${kind}`) });
  const cancel = useMutation({ mutationFn: (id: string) => a.post(`/obligations/${id}/cancel`), onSuccess: () => (toast('لغو شد'), void qc.invalidateQueries({ queryKey: ['finance'] })), onError: (e) => toast(e instanceof Error ? e.message : 'انجام نشد', 'danger') });
  const open = (q.data ?? []).filter((o) => o.state === 'open' || o.state === 'overdue');
  const sum = (l: Obligation[]) => l.reduce((s, o) => s + BigInt(o.remaining), 0n);
  return (
    <>
      <PageHeader title="مطالبات و بدهی‌ها" actions={
        <>
          <ExportMenu filename={kind} title={kind === 'receivable' ? 'مطالبات' : 'بدهی‌ها'} rows={q.data} columns={[
            { header: 'طرف‌حساب', value: (r) => r.counterparty_name }, { header: 'شرح', value: (r) => r.description }, { header: 'مبلغ', value: (r) => r.amount, kind: 'number' },
            { header: 'تسویه‌شده', value: (r) => r.paid, kind: 'number' }, { header: 'مانده', value: (r) => r.remaining, kind: 'number' }, { header: 'سررسید', value: (r) => r.due_on }, { header: 'وضعیت', value: (r) => OB_STATE[r.state]?.label },
          ]} />
          <Button onClick={() => setCreating(true)}><Plus className="size-4" /> ثبت {kind === 'receivable' ? 'مطالبه' : 'بدهی'}</Button>
        </>
      } />
      <Nav />
      <Tabs label="نوع" value={kind} onChange={setKind} items={[{ key: 'receivable', label: 'مطالبات (دریافتنی)' }, { key: 'payable', label: 'بدهی‌ها (پرداختنی)' }]} />
      <p className="mb-4 text-sm">مانده باز: <span className="font-bold tabular-nums">{rial(sum(open))}</span> ریال · سررسیدگذشته: <span className="font-bold tabular-nums text-danger">{rial(sum(open.filter((o) => o.state === 'overdue')))}</span> ریال</p>
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<p className="text-sm text-muted">موردی ثبت نشده است.</p>}>
        <Table>
          <thead><tr><Th>طرف‌حساب</Th><Th>شرح</Th><Th>مبلغ</Th><Th>مانده</Th><Th>سررسید</Th><Th>وضعیت</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
          <tbody>
            {q.data?.map((o) => (
              <tr key={o.id}>
                <Td>{o.counterparty_name}</Td><Td>{o.description}{o.source === 'procurement' && <Badge className="ms-1">تدارکات</Badge>}</Td>
                <Td className="tabular-nums">{rial(o.amount)}</Td><Td className="tabular-nums">{rial(o.remaining)}</Td><Td><DayText value={o.due_on} /></Td>
                <Td><Badge tone={OB_STATE[o.state]!.tone}>{OB_STATE[o.state]!.label}</Badge></Td>
                <Td className="whitespace-nowrap">
                  {o.kind === 'receivable' && (o.state === 'open' || o.state === 'overdue') && <Button size="sm" variant="secondary" onClick={() => setSettling(o)}>ثبت دریافت</Button>}
                  {o.kind === 'payable' && (o.state === 'open' || o.state === 'overdue') && <Link className="text-sm text-primary underline" to="/app/finance/payments">درخواست پرداخت</Link>}
                  {o.paid === '0' && o.state !== 'cancelled' && <Button size="sm" variant="ghost" onClick={() => cancel.mutate(o.id)}>لغو</Button>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {creating && <ObligationDialog kind={kind} onClose={() => setCreating(false)} />}
      {settling && <SettleDialog ob={settling} onClose={() => setSettling(null)} />}
    </>
  );
}

function ObligationDialog({ kind, onClose }: { kind: string; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [v, setV] = useState({ counterpartyId: '', amount: '', description: '', reference: '', projectId: '' });
  const [issued, setIssued] = useState<string | null>(todayIso());
  const [due, setDue] = useState<string | null>(todayIso());
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const save = useMutation({
    mutationFn: () => a.post('/obligations', { ...v, kind, issuedOn: issued, dueOn: due, projectId: v.projectId || null }),
    onSuccess: () => (toast('ثبت شد'), void qc.invalidateQueries({ queryKey: ['finance'] }), onClose()),
    onError: err.set,
  });
  const f = err.fields;
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={kind === 'receivable' ? 'ثبت مطالبه' : 'ثبت بدهی'} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!issued || !due} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <CounterpartySelect value={v.counterpartyId} onChange={set('counterpartyId')} error={f.counterpartyId} />
        <Field label="مبلغ (ریال)" required error={f.amount}><MoneyInput value={v.amount} onChange={set('amount')} /></Field>
        <Field label="تاریخ صدور" required><DateInput value={issued} onChange={setIssued} /></Field>
        <Field label="سررسید" required error={f.dueOn}><DateInput value={due} onChange={setDue} /></Field>
        <Field label="شرح" required error={f.description} className="sm:col-span-2"><Input value={v.description} onChange={(e) => set('description')(e.target.value)} /></Field>
        <Field label="شماره سند / فاکتور"><Input value={v.reference} onChange={(e) => set('reference')(e.target.value)} /></Field>
        <ProjectSelect value={v.projectId} onChange={set('projectId')} />
      </div>
    </Dialog>
  );
}

function SettleDialog({ ob, onClose }: { ob: Obligation; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [v, setV] = useState({ accountId: '', amount: ob.remaining, categoryId: '', reference: '' });
  const [on, setOn] = useState<string | null>(todayIso());
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const save = useMutation({
    mutationFn: () => a.post('/receipts', { ...v, occurredOn: on, obligationId: ob.id, counterpartyId: ob.counterparty_id, description: ob.description }),
    onSuccess: () => (toast('دریافت ثبت شد'), void qc.invalidateQueries({ queryKey: ['finance'] }), onClose()),
    onError: err.set,
  });
  const f = err.fields;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`دریافت از ${ob.counterparty_name}`} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!on} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4">
        <AccountSelect value={v.accountId} onChange={set('accountId')} label="واریز به حساب" error={f.accountId} />
        <Field label={`مبلغ (مانده ${rial(ob.remaining)})`} required error={f.amount}><MoneyInput value={v.amount} onChange={set('amount')} /></Field>
        <Field label="تاریخ" required><DateInput value={on} onChange={setOn} /></Field>
        <CategorySelect kind="income" value={v.categoryId} onChange={set('categoryId')} error={f.categoryId} />
        <Field label="شماره پیگیری"><Input dir="ltr" value={v.reference} onChange={(e) => set('reference')(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- cheques

interface Cheque { id: string; direction: string; number: string; bank_name: string; amount: string; due_on: string; counterparty_name: string; account_id: string | null; status: string; status_note: string; payment_request_id: string | null }

export function ChequesPage() {
  const a = useApi();
  const [receiving, setReceiving] = useState(false);
  const [acting, setActing] = useState<{ c: Cheque; action: 'clear' | 'bounce' | 'cancel' } | null>(null);
  const q = useQuery({ queryKey: ['finance', 'cheques'], queryFn: () => a.get<Cheque[]>('/cheques') });
  return (
    <>
      <PageHeader title="چک‌ها" description="چک‌های صادره از اجرای درخواست پرداخت و چک‌های دریافتی؛ با وصول، تراکنش ثبت می‌شود." actions={<Button onClick={() => setReceiving(true)}><Plus className="size-4" /> چک دریافتی</Button>} />
      <Nav />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<p className="text-sm text-muted">چکی ثبت نشده است.</p>}>
        <Table>
          <thead><tr><Th>نوع</Th><Th>شماره</Th><Th>طرف‌حساب</Th><Th>مبلغ</Th><Th>سررسید</Th><Th>وضعیت</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
          <tbody>
            {q.data?.map((c) => (
              <tr key={c.id}>
                <Td>{c.direction === 'received' ? 'دریافتی' : 'صادره'}</Td><Td><Ltr>{c.number}</Ltr>{c.bank_name && <div className="text-xs text-muted">{c.bank_name}</div>}</Td>
                <Td>{c.counterparty_name}</Td><Td className="tabular-nums">{rial(c.amount)}</Td><Td><DayText value={c.due_on} /></Td>
                <Td><Badge tone={CHEQUE_STATUS[c.status]!.tone}>{CHEQUE_STATUS[c.status]!.label}</Badge>{c.status_note && <div className="text-xs text-muted">{c.status_note}</div>}</Td>
                <Td className="whitespace-nowrap">
                  {c.status === 'pending' && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setActing({ c, action: 'clear' })}>وصول</Button>
                      <Button size="sm" variant="ghost" onClick={() => setActing({ c, action: 'bounce' })}>برگشت</Button>
                      <Button size="sm" variant="ghost" onClick={() => setActing({ c, action: 'cancel' })}>ابطال</Button>
                    </>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {receiving && <ReceiveChequeDialog onClose={() => setReceiving(false)} />}
      {acting && <ChequeActionDialog {...acting} onClose={() => setActing(null)} />}
    </>
  );
}

function ReceiveChequeDialog({ onClose }: { onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [v, setV] = useState({ number: '', bankName: '', amount: '', counterpartyId: '', categoryId: '', projectId: '' });
  const [due, setDue] = useState<string | null>(todayIso());
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const save = useMutation({ mutationFn: () => a.post('/cheques', { ...v, dueOn: due, projectId: v.projectId || null }), onSuccess: () => (toast('چک ثبت شد'), void qc.invalidateQueries({ queryKey: ['finance'] }), onClose()), onError: err.set });
  const f = err.fields;
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="چک دریافتی" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!due} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="شماره چک" required error={f.number}><Input dir="ltr" value={v.number} onChange={(e) => set('number')(e.target.value)} /></Field>
        <Field label="بانک"><Input value={v.bankName} onChange={(e) => set('bankName')(e.target.value)} /></Field>
        <Field label="مبلغ (ریال)" required error={f.amount}><MoneyInput value={v.amount} onChange={set('amount')} /></Field>
        <Field label="تاریخ چک" required><DateInput value={due} onChange={setDue} /></Field>
        <CounterpartySelect value={v.counterpartyId} onChange={set('counterpartyId')} label="صادرکننده" error={f.counterpartyId} />
        <CategorySelect kind="income" value={v.categoryId} onChange={set('categoryId')} error={f.categoryId} />
        <ProjectSelect value={v.projectId} onChange={set('projectId')} />
      </div>
    </Dialog>
  );
}

function ChequeActionDialog({ c, action, onClose }: { c: Cheque; action: 'clear' | 'bounce' | 'cancel'; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [accountId, setAccountId] = useState('');
  const [on, setOn] = useState<string | null>(todayIso());
  const [note, setNote] = useState('');
  const title = { clear: 'وصول چک', bounce: 'ثبت برگشت چک', cancel: 'ابطال چک' }[action];
  const save = useMutation({ mutationFn: () => a.post(`/cheques/${c.id}/action`, { action, accountId: accountId || null, occurredOn: on, note }), onSuccess: () => (toast('ثبت شد'), void qc.invalidateQueries({ queryKey: ['finance'] }), onClose()), onError: err.set });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${title} ${c.number}`} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!on} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4">
        {action === 'clear' && c.direction === 'received' && <AccountSelect value={accountId} onChange={setAccountId} label="واریز به حساب" error={err.fields.accountId} />}
        <Field label="تاریخ" required><DateInput value={on} onChange={setOn} /></Field>
        <Field label="توضیح"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
