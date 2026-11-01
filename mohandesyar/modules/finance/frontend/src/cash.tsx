import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, DateInput, DayText, Dialog, ExportMenu, Field, Input, Ltr, MoneyInput, PageHeader, PageState, Select, Stat, Table, Tabs, Td, Textarea, Th, toast } from '@mohandesyar/ui';
import { useCan } from '@mohandesyar/module-sdk/web';
import { addDays, todayIso } from '@mohandesyar/persian';
import { EacMethodField } from './budgets.js';
import { Nav, rial, useAccounts, useApi, useCategories, useServerErrors, type Category } from './common.js';
import { PayeeDialog } from './payments.js';

// ---------------------------------------------------------------- cash flow

interface Flow {
  opening: string;
  months: { key: string; label: string; firmIn: string; firmOut: string; estimateIn: string; estimateOut: string; firmBalance: string; balance: string }[];
  items: { date: string; direction: 'in' | 'out'; amount: string; certainty: 'firm' | 'estimate'; source: string; description: string; overdue: boolean }[];
}

export function CashflowPage() {
  const a = useApi();
  const qc = useQueryClient();
  const canEdit = useCan('finance.budget.manage');
  const [months, setMonths] = useState(6);
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['finance', 'cashflow', months], queryFn: () => a.get<Flow>(`/cashflow?from=${todayIso()}&months=${months}`) });
  const fc = useQuery({ queryKey: ['finance', 'forecasts'], queryFn: () => a.get<{ id: string; direction: string; amount: string; expected_on: string; description: string }[]>('/forecasts') });
  const del = useMutation({ mutationFn: (id: string) => a.del(`/forecasts/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['finance'] }) });
  const d = q.data;
  return (
    <>
      <PageHeader title="پیش‌بینی جریان نقدی" description="اقلام قطعی (مطالبات، بدهی‌ها، پرداخت‌های تأییدشده، چک‌ها) و تخمینی (پیش‌بینی دستی) جدا نمایش داده می‌شوند." actions={canEdit && <Button onClick={() => setAdding(true)}><Plus className="size-4" /> پیش‌بینی تخمینی</Button>} />
      <Nav />
      <Field label="افق" className="mb-4 w-40"><Select value={months} onChange={(e) => setMonths(Number(e.target.value))}>{[3, 6, 12].map((m) => <option key={m} value={m}>{m.toLocaleString('fa-IR')} ماه</option>)}</Select></Field>
      <PageState query={q}>
        {d && (
          <>
            <p className="mb-3 text-sm">موجودی امروز: <span className="font-bold tabular-nums">{rial(d.opening)}</span> ریال</p>
            <Table>
              <thead><tr><Th>ماه</Th><Th>ورود قطعی</Th><Th>خروج قطعی</Th><Th>مانده با اقلام قطعی</Th><Th>ورود تخمینی</Th><Th>خروج تخمینی</Th><Th>مانده با تخمین‌ها</Th></tr></thead>
              <tbody>
                {d.months.map((m) => (
                  <tr key={m.key}>
                    <Td>{m.label}</Td><Td className="tabular-nums text-success">{rial(m.firmIn)}</Td><Td className="tabular-nums text-danger">{rial(m.firmOut)}</Td>
                    <Td className={`tabular-nums font-medium ${BigInt(m.firmBalance) < 0n ? 'text-danger' : ''}`}>{rial(m.firmBalance)}</Td>
                    <Td className="tabular-nums">{rial(m.estimateIn)}</Td><Td className="tabular-nums">{rial(m.estimateOut)}</Td>
                    <Td className={`tabular-nums ${BigInt(m.balance) < 0n ? 'text-danger' : ''}`}>{rial(m.balance)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="mt-6 mb-2 flex items-center justify-between"><h2 className="font-semibold">اقلام</h2>
              <ExportMenu filename="cashflow" title="اقلام جریان نقدی" rows={d.items} columns={[
                { header: 'تاریخ', value: (r) => r.date }, { header: 'جهت', value: (r) => (r.direction === 'in' ? 'ورود' : 'خروج') }, { header: 'مبلغ', value: (r) => r.amount, kind: 'number' },
                { header: 'نوع', value: (r) => (r.certainty === 'firm' ? 'قطعی' : 'تخمینی') }, { header: 'منبع', value: (r) => r.source }, { header: 'شرح', value: (r) => r.description },
              ]} />
            </div>
            {d.items.length === 0 ? <p className="text-sm text-muted">در این افق قلمی وجود ندارد.</p> : (
              <Table>
                <thead><tr><Th>تاریخ</Th><Th>جهت</Th><Th>مبلغ</Th><Th>نوع</Th><Th>شرح</Th></tr></thead>
                <tbody>{d.items.map((x, i) => <tr key={i}><Td><DayText value={x.date} />{x.overdue && <Badge tone="danger" className="ms-1">سررسیدگذشته</Badge>}</Td><Td>{x.direction === 'in' ? 'ورود' : 'خروج'}</Td><Td className="tabular-nums">{rial(x.amount)}</Td><Td>{x.certainty === 'firm' ? <Badge tone="info">قطعی · {x.source}</Badge> : <Badge>تخمینی</Badge>}</Td><Td>{x.description}</Td></tr>)}</tbody>
              </Table>
            )}
          </>
        )}
      </PageState>
      {canEdit && (fc.data ?? []).length > 0 && (
        <Card className="mt-6">
          <CardHeader title="پیش‌بینی‌های تخمینی" />
          <ul className="space-y-1 p-5 text-sm">{fc.data!.map((f) => <li key={f.id}><DayText value={f.expected_on} /> · {f.direction === 'in' ? 'ورود' : 'خروج'} {rial(f.amount)} — {f.description} <Button size="sm" variant="ghost" aria-label={`حذف ${f.description}`} onClick={() => del.mutate(f.id)}><Trash2 className="size-4" /></Button></li>)}</ul>
        </Card>
      )}
      {adding && <ForecastDialog onClose={() => setAdding(false)} />}
    </>
  );
}

function ForecastDialog({ onClose }: { onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [v, setV] = useState({ direction: 'in', amount: '', description: '' });
  const [on, setOn] = useState<string | null>(addDays(todayIso(), 30));
  const save = useMutation({ mutationFn: () => a.post('/forecasts', { ...v, expectedOn: on }), onSuccess: () => (toast('ثبت شد'), void qc.invalidateQueries({ queryKey: ['finance'] }), onClose()), onError: err.set });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="پیش‌بینی تخمینی" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!on} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4">
        <Field label="جهت"><Select value={v.direction} onChange={(e) => setV({ ...v, direction: e.target.value })}><option value="in">ورود</option><option value="out">خروج</option></Select></Field>
        <Field label="مبلغ (ریال)" required error={err.fields.amount}><MoneyInput value={v.amount} onChange={(x) => setV({ ...v, amount: x })} /></Field>
        <Field label="تاریخ پیش‌بینی" required><DateInput value={on} onChange={setOn} /></Field>
        <Field label="شرح" required error={err.fields.description}><Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- reconciliation

interface Rec {
  account: { name: string; balance: string };
  lines: { id: string; occurred_on: string; amount: string; reference: string; description: string; transaction_id: string | null }[];
  transactions: { id: string; occurred_on: string; signed: string; description: string; reference: string; matched: boolean }[];
  unmatchedLines: number;
  unmatchedTransactions: number;
  statementTotal: string;
  bookTotal: string;
}

export function ReconciliationPage() {
  const a = useApi();
  const qc = useQueryClient();
  const accounts = useAccounts();
  const err = useServerErrors();
  const banks = (accounts.data ?? []).filter((x) => x.kind === 'bank' && !x.archived);
  const [accountId, setAccountId] = useState('');
  const [csv, setCsv] = useState('');
  const id = accountId || banks[0]?.id || '';
  const q = useQuery({ queryKey: ['finance', 'rec', id], queryFn: () => a.get<Rec>(`/reconciliation/${id}`), enabled: !!id });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['finance', 'rec'] });
  const imp = useMutation({
    mutationFn: () => a.post<{ imported: number; matched: number; errors: { line: number; message: string }[] }>('/reconciliation/statements', { accountId: id, csv }),
    onSuccess: (r) => (toast(`${r.imported.toLocaleString('fa-IR')} سطر وارد و ${r.matched.toLocaleString('fa-IR')} سطر خودکار تطبیق شد${r.errors.length ? `؛ ${r.errors.length.toLocaleString('fa-IR')} سطر خطا داشت` : ''}`), setCsv(''), err.clear(), refresh()),
    onError: err.set,
  });
  const match = useMutation({ mutationFn: (p: { line: string; tx: string | null }) => a.put(`/reconciliation/lines/${p.line}`, { transactionId: p.tx }), onSuccess: refresh, onError: (e) => toast(e instanceof Error ? e.message : 'انجام نشد', 'danger') });
  const read = (f: File) => void f.text().then(setCsv);
  const d = q.data;
  return (
    <>
      <PageHeader title="مغایرت‌گیری بانکی" />
      <Nav />
      {banks.length === 0 ? <Alert tone="info">حساب بانکی تعریف نشده است.</Alert> : (
        <>
          <Field label="حساب بانکی" className="mb-4 w-72"><Select value={id} onChange={(e) => setAccountId(e.target.value)}>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
          <Card className="mb-6">
            <CardHeader title="ورود صورت‌حساب بانک" description="فایل CSV یا متن با ستون‌های: تاریخ (شمسی یا میلادی)، مبلغ (واریز مثبت، برداشت منفی)، شماره پیگیری، شرح." />
            <div className="space-y-3 p-5">
              {err.banner}
              <input type="file" accept=".csv,.txt,text/csv" aria-label="فایل صورت‌حساب" onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); }} />
              <Textarea aria-label="متن صورت‌حساب" rows={4} dir="ltr" value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'1405/07/01,12000000,A1,واریز\n1405/07/02,-3500000,B2,کارمزد'} />
              <Button disabled={!csv.trim()} loading={imp.isPending} onClick={() => imp.mutate()}>ورود و تطبیق خودکار</Button>
            </div>
          </Card>
          <PageState query={q}>
            {d && (
              <>
                <div className="mb-4 grid gap-3 sm:grid-cols-4">
                  <Stat label="سطرهای تطبیق‌نشده صورت‌حساب">{d.unmatchedLines.toLocaleString('fa-IR')}</Stat>
                  <Stat label="تراکنش‌های تطبیق‌نشده">{d.unmatchedTransactions.toLocaleString('fa-IR')}</Stat>
                  <Stat label="جمع گردش صورت‌حساب">{rial(d.statementTotal)}</Stat>
                  <Stat label="جمع گردش دفاتر (همان بازه)">{rial(d.bookTotal)}</Stat>
                </div>
                {d.lines.length === 0 ? <p className="text-sm text-muted">صورت‌حسابی وارد نشده است.</p> : (
                  <Table>
                    <thead><tr><Th>تاریخ</Th><Th>مبلغ</Th><Th>مرجع / شرح</Th><Th>تراکنش تطبیق‌داده‌شده</Th></tr></thead>
                    <tbody>
                      {d.lines.map((l) => {
                        const cands = d.transactions.filter((t) => t.signed === l.amount && (!t.matched || t.id === l.transaction_id));
                        return (
                          <tr key={l.id}>
                            <Td><DayText value={l.occurred_on} /></Td>
                            <Td className={`tabular-nums ${l.amount.startsWith('-') ? 'text-danger' : 'text-success'}`}>{rial(l.amount)}</Td>
                            <Td><Ltr>{l.reference}</Ltr> {l.description}</Td>
                            <Td>
                              <Select aria-label="تراکنش متناظر" value={l.transaction_id ?? ''} onChange={(e) => match.mutate({ line: l.id, tx: e.target.value || null })}>
                                <option value="">— تطبیق‌نشده —</option>
                                {cands.map((t) => <option key={t.id} value={t.id}>{t.occurred_on} · {t.description || t.reference}</option>)}
                              </Select>
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                )}
              </>
            )}
          </PageState>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- reports

export function ReportsPage() {
  const a = useApi();
  const [from, setFrom] = useState<string | null>(addDays(todayIso(), -90));
  const [to, setTo] = useState<string | null>(todayIso());
  const q = useQuery({
    queryKey: ['finance', 'report', from, to],
    queryFn: () => a.get<{ byCategory: { kind: string; name: string; amount: string }[]; income: string; expense: string; net: string; transfers: { n: number; amount: string } }>(`/reports/income-expense?from=${from}&to=${to}`),
    enabled: !!from && !!to,
  });
  const d = q.data;
  return (
    <>
      <PageHeader title="گزارش درآمد و هزینه" actions={<Button variant="secondary" onClick={() => window.print()}>چاپ / PDF</Button>} />
      <Nav />
      <div className="mb-4 flex flex-wrap gap-3 print:hidden">
        <Field label="از"><DateInput value={from} onChange={setFrom} /></Field>
        <Field label="تا"><DateInput value={to} onChange={setTo} /></Field>
      </div>
      <PageState query={q}>
        {d && (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <Stat label="درآمد">{rial(d.income)}</Stat>
              <Stat label="هزینه">{rial(d.expense)}</Stat>
              <Stat label="خالص">{<span className={BigInt(d.net) < 0n ? 'text-danger' : ''}>{rial(d.net)}</span>}</Stat>
            </div>
            <Alert tone="info" className="mb-4">{d.transfers.n.toLocaleString('fa-IR')} انتقال بین حساب‌ها به مبلغ {rial(d.transfers.amount)} ریال در این بازه درآمد یا هزینه شمرده نشده است.</Alert>
            <ExportMenu filename="income-expense" title="درآمد و هزینه" rows={d.byCategory} columns={[{ header: 'نوع', value: (r) => (r.kind === 'income' ? 'درآمد' : 'هزینه') }, { header: 'سرفصل', value: (r) => r.name }, { header: 'مبلغ (ریال)', value: (r) => r.amount, kind: 'number' }]} />
            <Table className="mt-3">
              <thead><tr><Th>نوع</Th><Th>سرفصل</Th><Th>مبلغ (ریال)</Th></tr></thead>
              <tbody>{d.byCategory.map((c, i) => <tr key={i}><Td>{c.kind === 'income' ? 'درآمد' : 'هزینه'}</Td><Td>{c.name}</Td><Td className="tabular-nums">{rial(c.amount)}</Td></tr>)}</tbody>
            </Table>
          </>
        )}
      </PageState>
    </>
  );
}

// ---------------------------------------------------------------- settings

export function SettingsPage() {
  const [tab, setTab] = useState('categories');
  return (
    <>
      <PageHeader title="تنظیمات مالی" />
      <Nav />
      <Tabs label="بخش‌ها" value={tab} onChange={setTab} items={[{ key: 'categories', label: 'سرفصل‌ها' }, { key: 'centers', label: 'مراکز هزینه' }, { key: 'counterparties', label: 'طرف‌حساب‌ها' }, { key: 'eac', label: 'روش EAC' }]} />
      {tab === 'categories' && <Categories />}
      {tab === 'centers' && <CostCenters />}
      {tab === 'counterparties' && <Counterparties />}
      {tab === 'eac' && <EacMethodField />}
    </>
  );
}

function Categories() {
  const a = useApi();
  const qc = useQueryClient();
  const q = useCategories();
  const [edit, setEdit] = useState<Partial<Category> | null>(null);
  const save = useMutation({
    mutationFn: () => (edit!.id ? a.put(`/categories/${edit!.id}`, edit) : a.post('/categories', edit)),
    onSuccess: () => (toast('ذخیره شد'), setEdit(null), void qc.invalidateQueries({ queryKey: ['finance', 'categories'] })),
    onError: (e) => toast(e instanceof Error ? e.message : 'انجام نشد', 'danger'),
  });
  return (
    <>
      <Button className="mb-3" variant="secondary" onClick={() => setEdit({ kind: 'expense', name: '', archived: false })}><Plus className="size-4" /> سرفصل جدید</Button>
      <PageState query={q}>
        <Table>
          <thead><tr><Th>نوع</Th><Th>نام</Th><Th>وضعیت</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
          <tbody>{q.data?.map((c) => <tr key={c.id}><Td>{c.kind === 'income' ? 'درآمد' : 'هزینه'}</Td><Td>{c.name}</Td><Td>{c.archived ? <Badge>بایگانی</Badge> : <Badge tone="success">فعال</Badge>}</Td><Td><Button size="sm" variant="ghost" onClick={() => setEdit(c)}>ویرایش</Button></Td></tr>)}</tbody>
        </Table>
      </PageState>
      {edit && (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)} title="سرفصل" footer={<><Button variant="ghost" onClick={() => setEdit(null)}>انصراف</Button><Button loading={save.isPending} onClick={() => save.mutate()}>ذخیره</Button></>}>
          <div className="grid gap-4">
            <Field label="نوع"><Select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as 'income' | 'expense' })}><option value="income">درآمد</option><option value="expense">هزینه</option></Select></Field>
            <Field label="نام" required><Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="وضعیت"><Select value={edit.archived ? '1' : ''} onChange={(e) => setEdit({ ...edit, archived: !!e.target.value })}><option value="">فعال</option><option value="1">بایگانی</option></Select></Field>
          </div>
        </Dialog>
      )}
    </>
  );
}

function CostCenters() {
  const a = useApi();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['finance', 'centers'], queryFn: () => a.get<{ id: string; code: string; name: string; archived: boolean }[]>('/cost-centers') });
  const [edit, setEdit] = useState<{ id?: string; code: string; name: string; archived: boolean } | null>(null);
  const save = useMutation({
    mutationFn: () => (edit!.id ? a.put(`/cost-centers/${edit!.id}`, edit) : a.post('/cost-centers', edit)),
    onSuccess: () => (toast('ذخیره شد'), setEdit(null), void qc.invalidateQueries({ queryKey: ['finance', 'centers'] })),
    onError: (e) => toast(e instanceof Error ? e.message : 'انجام نشد', 'danger'),
  });
  return (
    <>
      <Button className="mb-3" variant="secondary" onClick={() => setEdit({ code: '', name: '', archived: false })}><Plus className="size-4" /> مرکز هزینه</Button>
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<p className="text-sm text-muted">مرکز هزینه‌ای تعریف نشده است.</p>}>
        <Table>
          <thead><tr><Th>کد</Th><Th>نام</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
          <tbody>{q.data?.map((c) => <tr key={c.id}><Td><Ltr>{c.code}</Ltr></Td><Td>{c.name}{c.archived && <Badge className="ms-1">بایگانی</Badge>}</Td><Td><Button size="sm" variant="ghost" onClick={() => setEdit(c)}>ویرایش</Button></Td></tr>)}</tbody>
        </Table>
      </PageState>
      {edit && (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)} title="مرکز هزینه" footer={<><Button variant="ghost" onClick={() => setEdit(null)}>انصراف</Button><Button loading={save.isPending} onClick={() => save.mutate()}>ذخیره</Button></>}>
          <div className="grid gap-4">
            <Field label="کد" required><Input dir="ltr" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field>
            <Field label="نام" required><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          </div>
        </Dialog>
      )}
    </>
  );
}

function Counterparties() {
  const a = useApi();
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['finance', 'counterparties'], queryFn: () => a.get<{ id: string; name: string; iban: string | null; phone: string; receivable: string; payable: string }[]>('/counterparties') });
  return (
    <>
      <Button className="mb-3" variant="secondary" onClick={() => setAdding(true)}><Plus className="size-4" /> طرف‌حساب جدید</Button>
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<p className="text-sm text-muted">طرف‌حسابی ثبت نشده است.</p>}>
        <Table>
          <thead><tr><Th>نام</Th><Th>شبا</Th><Th>تلفن</Th><Th>مطالبات باز</Th><Th>بدهی باز</Th></tr></thead>
          <tbody>{q.data?.map((c) => <tr key={c.id}><Td>{c.name}</Td><Td>{c.iban ? <Ltr>{c.iban}</Ltr> : '—'}</Td><Td>{c.phone ? <Ltr>{c.phone}</Ltr> : '—'}</Td><Td className="tabular-nums">{rial(c.receivable)}</Td><Td className="tabular-nums">{rial(c.payable)}</Td></tr>)}</tbody>
        </Table>
      </PageState>
      {adding && <PayeeDialog onClose={() => setAdding(false)} />}
    </>
  );
}

