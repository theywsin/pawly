import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackageCheck, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, ConfirmDialog, DateInput, DayText, Dialog, EmptyState, ExportMenu, Field, Input, MoneyInput, PageHeader, PageState, ProgressBar, Select, Table, Tabs, Td, Textarea, Th, toast } from '@mohandesyar/ui';
import { useCan, useDirectory } from '@mohandesyar/module-sdk/web';
import { addDays, todayIso } from '@mohandesyar/persian';
import { BASE, INVOICE_STATUS, Nav, num, ProjectSelect, rial, status, SupplierSelect, useApi, useProjects, useServerErrors } from './common.js';

interface Order { id: string; number: number; supplier_id: string; supplier_name: string; projects_project_id: string | null; ordered_on: string; expected_on: string; status: string; total: string; received_pct: number; late: boolean }
interface Line { id: string; line_no: number; description: string; unit: string; quantity: string; unit_price: string; amount: string; accepted: string; rejected: string; invoiced: string }
interface Detail {
  order: Order & { delivery_address: string; terms: string; supplier_iban: string | null; created_by: string; receivedPct: number; request_id: string | null };
  lines: Line[];
  receipts: { id: string; received_on: string; document_no: string; notes: string; created_by: string; lines: { order_line_id: string; accepted: string; rejected: string; note: string }[] }[];
  invoices: { id: string; number: string; issued_on: string; amount: string; status: string; match: { ok: boolean; issues: { message: string }[] }; created_by: string }[];
  rating: { quality: number; delivery: number; price: number; comment: string } | null;
}

export function OrdersPage() {
  const a = useApi();
  const canManage = useCan('procurement.order.manage');
  const projects = useProjects();
  const [st, setSt] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['procurement', 'orders', st], queryFn: () => a.get<Order[]>(`/orders${st === 'late' ? '?late=1' : st ? `?status=${st}` : ''}`) });
  const pname = (id: string | null) => (id ? (projects.data?.find((p) => p.id === id)?.title ?? '—') : '—');
  return (
    <>
      <PageHeader
        title="سفارش‌های خرید و تحویل"
        description="سفارش پس از تأیید (بر اساس مبلغ، در «گردش‌های تأیید») قابل تحویل است؛ با تأیید، تعهد آن در بودجه پروژه و بدهی تأمین‌کننده در «مالی» ثبت می‌شود."
        actions={
          <>
            <ExportMenu filename="purchase-orders" title="سفارش‌های خرید" rows={q.data} columns={[
              { header: 'شماره', value: (o) => `PO-${o.number}` }, { header: 'تأمین‌کننده', value: (o) => o.supplier_name }, { header: 'پروژه', value: (o) => pname(o.projects_project_id) },
              { header: 'مبلغ (ریال)', value: (o) => o.total, kind: 'number' }, { header: 'تاریخ سفارش', value: (o) => o.ordered_on }, { header: 'تحویل مورد انتظار', value: (o) => o.expected_on },
              { header: 'درصد تحویل', value: (o) => o.received_pct, kind: 'number' }, { header: 'وضعیت', value: (o) => (o.late ? 'دارای تأخیر' : status(o.status).label) },
            ]} />
            {canManage && <Button onClick={() => setCreating(true)}><Plus className="size-4" /> سفارش مستقیم</Button>}
          </>
        }
      />
      <Nav />
      <Tabs label="وضعیت" value={st} onChange={setSt} items={[{ key: '', label: 'همه' }, { key: 'pending', label: 'در انتظار تأیید' }, { key: 'approved', label: 'باز' }, { key: 'late', label: 'دارای تأخیر' }, { key: 'closed', label: 'بسته‌شده' }]} />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<PackageCheck className="size-8" />} title="سفارشی وجود ندارد" />}>
        <Table>
          <thead><tr><Th>شماره</Th><Th>تأمین‌کننده</Th><Th>پروژه</Th><Th>مبلغ (ریال)</Th><Th>تحویل مورد انتظار</Th><Th>تحویل‌شده</Th><Th>وضعیت</Th></tr></thead>
          <tbody>
            {q.data?.map((o) => (
              <tr key={o.id}>
                <Td className="tabular-nums"><Link className="text-primary underline" to={`${BASE}/orders/${o.id}`}>PO-{num(o.number)}</Link></Td>
                <Td>{o.supplier_name}</Td><Td>{pname(o.projects_project_id)}</Td><Td className="tabular-nums">{rial(o.total)}</Td>
                <Td><DayText value={o.expected_on} /></Td>
                <Td className="min-w-28"><ProgressBar value={o.received_pct} label={`${num(o.received_pct)}٪`} /></Td>
                <Td><Badge tone={status(o.status).tone}>{status(o.status).label}</Badge>{o.late && <Badge tone="danger" className="ms-1">تأخیر</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {creating && <OrderDialog onClose={() => setCreating(false)} />}
    </>
  );
}

const emptyLine = () => ({ description: '', unit: 'عدد', quantity: '', unitPrice: '' });

function OrderDialog({ onClose }: { onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [v, setV] = useState({ supplierId: '', projectId: '', deliveryAddress: '', terms: '' });
  const [ordered, setOrdered] = useState<string | null>(todayIso());
  const [expected, setExpected] = useState<string | null>(addDays(todayIso(), 14));
  const [lines, setLines] = useState([emptyLine()]);
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const setLine = (i: number, k: keyof ReturnType<typeof emptyLine>, x: string) => setLines((s) => s.map((l, j) => (j === i ? { ...l, [k]: x } : l)));
  const save = useMutation({
    mutationFn: () => a.post<{ number: number }>('/orders', { ...v, projectId: v.projectId || null, orderedOn: ordered, expectedOn: expected, lines }),
    onSuccess: (r) => (toast(`سفارش PO-${num(r.number)} ثبت و برای تأیید ارسال شد`), void qc.invalidateQueries({ queryKey: ['procurement'] }), onClose()),
    onError: err.set,
  });
  const f = err.fields;
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="سفارش مستقیم (بدون استعلام)" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!ordered || !expected} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ارسال برای تأیید</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <SupplierSelect value={v.supplierId} onChange={set('supplierId')} error={f.supplierId} />
        <ProjectSelect value={v.projectId} onChange={set('projectId')} />
        <Field label="تاریخ سفارش" required><DateInput value={ordered} onChange={setOrdered} /></Field>
        <Field label="تاریخ تحویل مورد انتظار" required error={f.expectedOn}><DateInput value={expected} onChange={setExpected} /></Field>
        <Field label="محل تحویل"><Input value={v.deliveryAddress} onChange={(e) => set('deliveryAddress')(e.target.value)} /></Field>
        <Field label="شرایط"><Input value={v.terms} onChange={(e) => set('terms')(e.target.value)} /></Field>
      </div>
      <h3 className="mb-2 mt-6 font-semibold">ردیف‌ها</h3>
      <div className="space-y-3">
        {lines.map((l, i) => (
          <fieldset key={i} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-5">
            <legend className="px-1 text-xs text-muted">ردیف {num(i + 1)}</legend>
            <Field label="شرح" required error={f[`lines.${i}.description`]} className="sm:col-span-2"><Input value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} /></Field>
            <Field label="مقدار" required error={f[`lines.${i}.quantity`]}><Input inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} /></Field>
            <Field label="واحد" required><Input value={l.unit} onChange={(e) => setLine(i, 'unit', e.target.value)} /></Field>
            <div className="flex items-end gap-2">
              <Field label="قیمت واحد (ریال)" required error={f[`lines.${i}.unitPrice`]} className="flex-1"><MoneyInput value={l.unitPrice} onChange={(x) => setLine(i, 'unitPrice', x)} /></Field>
              {lines.length > 1 && <Button size="sm" variant="ghost" aria-label={`حذف ردیف ${num(i + 1)}`} onClick={() => setLines((s) => s.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>}
            </div>
          </fieldset>
        ))}
      </div>
      <Button className="mt-3" size="sm" variant="secondary" onClick={() => setLines((s) => [...s, emptyLine()])}><Plus className="size-4" /> ردیف</Button>
    </Dialog>
  );
}

export function OrderPage() {
  const { id = '' } = useParams();
  const a = useApi();
  const qc = useQueryClient();
  const dir = useDirectory();
  const canManage = useCan('procurement.order.manage');
  const canReceive = useCan('procurement.receipt.record');
  const canInvoice = useCan('procurement.invoice.manage');
  const canRate = useCan('procurement.supplier.manage');
  const [dialog, setDialog] = useState<'receive' | 'invoice' | 'rate' | 'cancel' | 'close' | null>(null);
  const q = useQuery({ queryKey: ['procurement', 'order', id], queryFn: () => a.get<Detail>(`/orders/${id}`) });
  const done = (msg: string) => (toast(msg), setDialog(null), void qc.invalidateQueries({ queryKey: ['procurement'] }));
  const cancel = useMutation({ mutationFn: () => a.post(`/orders/${id}/cancel`), onSuccess: () => done('سفارش لغو شد'), onError: (e) => toast(e instanceof Error ? e.message : 'انجام نشد') });
  const close = useMutation({ mutationFn: () => a.post(`/orders/${id}/close`), onSuccess: () => done('سفارش بسته شد'), onError: (e) => toast(e instanceof Error ? e.message : 'انجام نشد') });
  const d = q.data;
  const o = d?.order;
  return (
    <>
      <PageHeader
        title={o ? `سفارش PO-${num(o.number)} — ${o.supplier_name}` : 'سفارش خرید'}
        description={o ? <>سفارش <DayText value={o.ordered_on} /> · تحویل مورد انتظار <DayText value={o.expected_on} /> · مبلغ {rial(o.total)} ریال</> : undefined}
        actions={o && (
          <>
            {canReceive && o.status === 'approved' && <Button onClick={() => setDialog('receive')}>ثبت تحویل</Button>}
            {canInvoice && (o.status === 'approved' || o.status === 'closed') && <Button variant="secondary" onClick={() => setDialog('invoice')}>ثبت فاکتور</Button>}
            {canRate && d.receipts.length > 0 && <Button variant="secondary" onClick={() => setDialog('rate')}>{d.rating ? 'ویرایش امتیاز' : 'امتیاز تأمین‌کننده'}</Button>}
            {canManage && o.status === 'approved' && <Button variant="ghost" onClick={() => setDialog('close')}>بستن سفارش</Button>}
            {canManage && (o.status === 'pending' || o.status === 'approved') && d.receipts.length === 0 && <Button variant="ghost" onClick={() => setDialog('cancel')}>لغو</Button>}
          </>
        )}
      />
      <Nav />
      <PageState query={q}>
        {d && o && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={status(o.status).tone}>{status(o.status).label}</Badge>
              {o.late && <Badge tone="danger">تأخیر در تحویل</Badge>}
              {o.status === 'pending' && <Link className="text-primary underline" to="/app/approvals">کارتابل تأیید</Link>}
              {o.delivery_address && <span>محل تحویل: {o.delivery_address}</span>}
              {o.terms && <span>شرایط: {o.terms}</span>}
            </div>
            <ProgressBar value={o.receivedPct} label={`تحویل پذیرفته‌شده: ${num(o.receivedPct)}٪`} />
            <Table>
              <thead><tr><Th>ردیف</Th><Th>شرح</Th><Th>مقدار</Th><Th>قیمت واحد</Th><Th>مبلغ (ریال)</Th><Th>پذیرفته</Th><Th>مرجوع</Th><Th>فاکتورشده</Th></tr></thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.id}>
                    <Td className="tabular-nums">{num(l.line_no)}</Td><Td>{l.description}</Td><Td className="tabular-nums">{num(l.quantity)} {l.unit}</Td><Td className="tabular-nums">{rial(l.unit_price)}</Td>
                    <Td className="tabular-nums">{rial(l.amount)}</Td><Td className="tabular-nums">{num(l.accepted)}</Td><Td className="tabular-nums">{num(l.rejected)}</Td><Td className="tabular-nums">{num(l.invoiced)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <section>
              <h2 className="mb-2 font-semibold">تحویل‌ها</h2>
              {d.receipts.length === 0 ? <p className="text-sm text-muted">تحویلی ثبت نشده است.</p> : (
                <ul className="space-y-2 text-sm">
                  {d.receipts.map((r) => (
                    <li key={r.id} className="rounded border border-border p-3">
                      <DayText value={r.received_on} /> · {dir.name(r.created_by)}{r.document_no && ` · سند ${r.document_no}`}
                      <ul className="mt-1 text-muted">
                        {r.lines.map((x) => {
                          const l = d.lines.find((y) => y.id === x.order_line_id);
                          return <li key={x.order_line_id}>{l?.description}: پذیرفته {num(x.accepted)}{Number(x.rejected) > 0 && `، مرجوع ${num(x.rejected)}`}{x.note && ` (${x.note})`}</li>;
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h2 className="mb-2 font-semibold">فاکتورها</h2>
              {d.invoices.length === 0 ? <p className="text-sm text-muted">فاکتوری ثبت نشده است.</p> : (
                <ul className="space-y-2 text-sm">
                  {d.invoices.map((i) => (
                    <li key={i.id} className="rounded border border-border p-3">
                      فاکتور {i.number} · <DayText value={i.issued_on} /> · {rial(i.amount)} ریال · <Badge tone={INVOICE_STATUS[i.status]!.tone}>{INVOICE_STATUS[i.status]!.label}</Badge>{' '}
                      {i.match.ok ? <Badge tone="success">تطبیق سه‌طرفه برقرار</Badge> : <Badge tone="danger">مغایرت</Badge>}
                      {!i.match.ok && <ul className="mt-1 list-disc ps-5 text-danger">{i.match.issues.map((x, k) => <li key={k}>{x.message}</li>)}</ul>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {d.rating && <p className="text-sm">امتیاز: کیفیت {num(d.rating.quality)} · تحویل {num(d.rating.delivery)} · قیمت {num(d.rating.price)} از ۵{d.rating.comment && ` — ${d.rating.comment}`}</p>}
          </div>
        )}
      </PageState>
      {dialog === 'receive' && d && <ReceiveDialog d={d} onDone={() => done('تحویل ثبت شد')} onClose={() => setDialog(null)} />}
      {dialog === 'invoice' && d && <InvoiceDialog d={d} onDone={(ok) => done(ok ? 'فاکتور ثبت شد؛ تطبیق سه‌طرفه برقرار است' : 'فاکتور ثبت شد اما با سفارش/تحویل مغایرت دارد')} onClose={() => setDialog(null)} />}
      {dialog === 'rate' && d && <RateDialog d={d} onDone={() => done('امتیاز ثبت شد')} onClose={() => setDialog(null)} />}
      <ConfirmDialog open={dialog === 'cancel'} onOpenChange={(x) => !x && setDialog(null)} title="لغو سفارش" description="سفارش لغو و گردش تأیید آن (در صورت باز بودن) بسته می‌شود." confirmLabel="لغو سفارش" loading={cancel.isPending} onConfirm={() => cancel.mutate()} />
      <ConfirmDialog open={dialog === 'close'} onOpenChange={(x) => !x && setDialog(null)} title="بستن سفارش" tone="primary" description="پس از بستن، تحویل جدید ثبت نمی‌شود (باقی‌مانده دریافت نخواهد شد). ثبت فاکتور برای اقلام تحویل‌شده همچنان ممکن است." confirmLabel="بستن" loading={close.isPending} onConfirm={() => close.mutate()} />
    </>
  );
}

function ReceiveDialog({ d, onDone, onClose }: { d: Detail; onDone: () => void; onClose: () => void }) {
  const a = useApi();
  const err = useServerErrors();
  const [on, setOn] = useState<string | null>(todayIso());
  const [doc, setDoc] = useState('');
  const [notes, setNotes] = useState('');
  const [v, setV] = useState<Record<string, { accepted: string; rejected: string; note: string }>>({});
  const get = (id: string) => v[id] ?? { accepted: '', rejected: '', note: '' };
  const set = (id: string, k: 'accepted' | 'rejected' | 'note', x: string) => setV((s) => ({ ...s, [id]: { ...get(id), [k]: x } }));
  const save = useMutation({
    mutationFn: () => a.post(`/orders/${d.order.id}/receipts`, { receivedOn: on, documentNo: doc, notes, lines: d.lines.map((l) => ({ orderLineId: l.id, accepted: get(l.id).accepted || '0', rejected: get(l.id).rejected || '0', note: get(l.id).note })) }),
    onSuccess: onDone,
    onError: err.set,
  });
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="ثبت تحویل کالا" description="مقدار پذیرفته و مقدار مرجوعی (کسری کیفی) هر ردیف را وارد کنید؛ ردیف خالی ثبت نمی‌شود." footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!on} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="تاریخ تحویل" required><DateInput value={on} onChange={setOn} /></Field>
        <Field label="شماره رسید / بارنامه"><Input value={doc} onChange={(e) => setDoc(e.target.value)} /></Field>
      </div>
      <div className="mt-4 space-y-3">
        {d.lines.map((l) => (
          <fieldset key={l.id} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-3">
            <legend className="px-1 text-xs text-muted">{l.description} — سفارش {num(l.quantity)}، پذیرفته‌شده تاکنون {num(l.accepted)} {l.unit}</legend>
            <Field label="پذیرفته"><Input inputMode="decimal" value={get(l.id).accepted} onChange={(e) => set(l.id, 'accepted', e.target.value)} /></Field>
            <Field label="مرجوعی"><Input inputMode="decimal" value={get(l.id).rejected} onChange={(e) => set(l.id, 'rejected', e.target.value)} /></Field>
            <Field label="توضیح"><Input value={get(l.id).note} onChange={(e) => set(l.id, 'note', e.target.value)} /></Field>
          </fieldset>
        ))}
      </div>
      <Field label="یادداشت" className="mt-4"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
    </Dialog>
  );
}

function InvoiceDialog({ d, onDone, onClose }: { d: Detail; onDone: (ok: boolean) => void; onClose: () => void }) {
  const a = useApi();
  const err = useServerErrors();
  const [number, setNumber] = useState('');
  const [issued, setIssued] = useState<string | null>(todayIso());
  const [due, setDue] = useState<string | null>(addDays(todayIso(), 30));
  const [amount, setAmount] = useState('');
  const [v, setV] = useState<Record<string, { quantity: string; unitPrice: string }>>(() =>
    Object.fromEntries(d.lines.map((l) => [l.id, { quantity: String(Math.max(0, Number(l.accepted) - Number(l.invoiced)) || ''), unitPrice: l.unit_price }])),
  );
  const set = (id: string, k: 'quantity' | 'unitPrice', x: string) => setV((s) => ({ ...s, [id]: { ...s[id]!, [k]: x } }));
  const save = useMutation({
    mutationFn: () =>
      a.post<{ match: { ok: boolean } }>('/invoices', {
        orderId: d.order.id, number, issuedOn: issued, dueOn: due, amount,
        lines: Object.entries(v).filter(([, x]) => x.quantity && Number(x.quantity) > 0).map(([orderLineId, x]) => ({ orderLineId, quantity: x.quantity, unitPrice: x.unitPrice })),
      }),
    onSuccess: (r) => onDone(r.match.ok),
    onError: err.set,
  });
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="ثبت فاکتور تأمین‌کننده" description="فاکتور با سفارش و تحویل پذیرفته‌شده مقایسه می‌شود (کنترل سه‌طرفه) و برای تأیید فرد دیگری ارسال می‌شود." footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!issued || !due} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="شماره فاکتور" required error={err.fields.number}><Input value={number} onChange={(e) => setNumber(e.target.value)} /></Field>
        <Field label="مبلغ کل فاکتور (ریال)" required error={err.fields.amount}><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="تاریخ فاکتور" required><DateInput value={issued} onChange={setIssued} /></Field>
        <Field label="سررسید پرداخت" required error={err.fields.dueOn}><DateInput value={due} onChange={setDue} /></Field>
      </div>
      <div className="mt-4 space-y-3">
        {d.lines.map((l) => (
          <fieldset key={l.id} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
            <legend className="px-1 text-xs text-muted">{l.description} — پذیرفته {num(l.accepted)}، فاکتورشده {num(l.invoiced)} {l.unit}</legend>
            <Field label="مقدار"><Input inputMode="decimal" value={v[l.id]!.quantity} onChange={(e) => set(l.id, 'quantity', e.target.value)} /></Field>
            <Field label="قیمت واحد (ریال)"><MoneyInput value={v[l.id]!.unitPrice} onChange={(x) => set(l.id, 'unitPrice', x)} /></Field>
          </fieldset>
        ))}
      </div>
    </Dialog>
  );
}

function RateDialog({ d, onDone, onClose }: { d: Detail; onDone: () => void; onClose: () => void }) {
  const a = useApi();
  const err = useServerErrors();
  const [v, setV] = useState({ quality: d.rating?.quality ?? 3, delivery: d.rating?.delivery ?? 3, price: d.rating?.price ?? 3 });
  const [comment, setComment] = useState(d.rating?.comment ?? '');
  const save = useMutation({ mutationFn: () => a.post(`/orders/${d.order.id}/rating`, { ...v, comment }), onSuccess: onDone, onError: err.set });
  const pick = (k: keyof typeof v, label: string) => (
    <Field label={label}><Select value={String(v[k])} onChange={(e) => setV((s) => ({ ...s, [k]: Number(e.target.value) }))}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{num(n)}</option>)}</Select></Field>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`امتیاز ${d.order.supplier_name}`} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-3">{pick('quality', 'کیفیت')}{pick('delivery', 'تحویل به‌موقع')}{pick('price', 'قیمت')}</div>
      <Field label="توضیح" className="mt-4"><Textarea value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
    </Dialog>
  );
}

