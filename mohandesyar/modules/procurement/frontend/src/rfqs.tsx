import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSearch, Plus } from 'lucide-react';
import { Alert, Badge, Button, DateInput, DayText, Dialog, EmptyState, Field, Input, MoneyInput, PageHeader, PageState, Table, Td, Textarea, Th, toast } from '@mohandesyar/ui';
import { addDays, todayIso } from '@mohandesyar/persian';
import { BASE, Nav, num, rial, status, SupplierSelect, useApi, useServerErrors } from './common.js';

interface Rfq { id: string; number: number; title: string; due_on: string; status: string; request_id: string; request_number: number; quotes: number }
interface Detail {
  rfq: { id: string; number: number; title: string; due_on: string; status: string; request_id: string };
  lines: { id: string; description: string; unit: string; quantity: string }[];
  quotes: { id: string; supplier_id: string; supplier_name: string; delivery_days: number | null; valid_until: string | null; payment_terms: string; notes: string; received_on: string; prices: Record<string, string | null> }[];
  comparison: { totals: { supplierId: string; supplierName: string; deliveryDays: number | null; total: string; complete: boolean; missing: number }[]; lowest: string | null; lowestPerLine: Record<string, string[]> };
}

export function RfqsPage() {
  const a = useApi();
  const q = useQuery({ queryKey: ['procurement', 'rfqs'], queryFn: () => a.get<Rfq[]>('/rfqs') });
  return (
    <>
      <PageHeader title="استعلام قیمت" description="استعلام از روی درخواست خرید تأییدشده (در صفحه جزئیات درخواست) ساخته می‌شود؛ پیشنهادها ثبت و کنار هم مقایسه می‌شوند." />
      <Nav />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<FileSearch className="size-8" />} title="استعلامی وجود ندارد" description="از «درخواست‌های خرید» یک درخواست تأییدشده را باز کنید و استعلام بسازید." />}>
        <Table>
          <thead><tr><Th>شماره</Th><Th>عنوان</Th><Th>درخواست</Th><Th>مهلت</Th><Th>پیشنهادها</Th><Th>وضعیت</Th></tr></thead>
          <tbody>
            {q.data?.map((r) => (
              <tr key={r.id}>
                <Td className="tabular-nums"><Link className="text-primary underline" to={`${BASE}/rfqs/${r.id}`}>RFQ-{num(r.number)}</Link></Td>
                <Td>{r.title}</Td><Td className="tabular-nums">PR-{num(r.request_number)}</Td><Td><DayText value={r.due_on} /></Td><Td className="tabular-nums">{num(r.quotes)}</Td>
                <Td><Badge tone={status(r.status).tone}>{status(r.status).label}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
    </>
  );
}

export function RfqPage() {
  const { id = '' } = useParams();
  const a = useApi();
  const q = useQuery({ queryKey: ['procurement', 'rfq', id], queryFn: () => a.get<Detail>(`/rfqs/${id}`) });
  const [adding, setAdding] = useState(false);
  const [awarding, setAwarding] = useState<Detail['quotes'][number] | null>(null);
  const d = q.data;
  const open = d?.rfq.status === 'open';
  return (
    <>
      <PageHeader
        title={d ? `استعلام RFQ-${num(d.rfq.number)}` : 'استعلام'}
        description={d ? <>{d.rfq.title} · مهلت <DayText value={d.rfq.due_on} /> · <Badge tone={status(d.rfq.status).tone}>{status(d.rfq.status).label}</Badge></> : undefined}
        actions={open && <Button onClick={() => setAdding(true)}><Plus className="size-4" /> ثبت پیشنهاد</Button>}
      />
      <Nav />
      <PageState query={q}>
        {d && (
          <>
            {d.quotes.length === 0 ? <EmptyState title="هنوز پیشنهادی ثبت نشده است" /> : (
              <>
                <h2 className="mb-2 font-semibold">مقایسه پیشنهادها</h2>
                <p className="mb-2 text-sm text-muted">فقط پیشنهادهای کامل (قیمت همه ردیف‌ها) رتبه‌بندی می‌شوند. کمترین قیمت هر ردیف پررنگ است.</p>
                <Table>
                  <thead>
                    <tr><Th>ردیف</Th><Th>مقدار</Th>{d.quotes.map((x) => <Th key={x.id}>{x.supplier_name}</Th>)}</tr>
                  </thead>
                  <tbody>
                    {d.lines.map((l) => (
                      <tr key={l.id}>
                        <Td>{l.description}</Td><Td className="tabular-nums">{num(l.quantity)} {l.unit}</Td>
                        {d.quotes.map((x) => <Td key={x.id} className={`tabular-nums ${d.comparison.lowestPerLine[l.id]?.includes(x.supplier_id) ? 'font-bold' : ''}`}>{x.prices[l.id] ? rial(x.prices[l.id]) : 'بدون قیمت'}</Td>)}
                      </tr>
                    ))}
                    <tr>
                      <Td className="font-semibold">جمع (ریال)</Td><Td />
                      {d.quotes.map((x) => {
                        const t = d.comparison.totals.find((c) => c.supplierId === x.supplier_id)!;
                        return <Td key={x.id} className="tabular-nums font-semibold">{rial(t.total)}{!t.complete && <div className="text-xs font-normal text-muted">ناقص: {num(t.missing)} ردیف</div>}{d.comparison.lowest === x.supplier_id && <Badge tone="success">کمترین</Badge>}</Td>;
                      })}
                    </tr>
                    <tr>
                      <Td>تحویل / شرایط</Td><Td />
                      {d.quotes.map((x) => <Td key={x.id} className="text-xs">{x.delivery_days === null ? '—' : `${num(x.delivery_days)} روز`}{x.payment_terms && <div>{x.payment_terms}</div>}{x.valid_until && <div>اعتبار تا <DayText value={x.valid_until} /></div>}</Td>)}
                    </tr>
                    {open && (
                      <tr><Td /><Td />{d.quotes.map((x) => <Td key={x.id}><Button size="sm" onClick={() => setAwarding(x)}>انتخاب و سفارش</Button></Td>)}</tr>
                    )}
                  </tbody>
                </Table>
              </>
            )}
          </>
        )}
      </PageState>
      {adding && d && <QuoteDialog d={d} onClose={() => setAdding(false)} />}
      {awarding && d && <AwardDialog d={d} quote={awarding} onClose={() => setAwarding(null)} />}
    </>
  );
}

function QuoteDialog({ d, onClose }: { d: Detail; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [supplierId, setSupplierId] = useState('');
  const [received, setReceived] = useState<string | null>(todayIso());
  const [validUntil, setValidUntil] = useState<string | null>(null);
  const [days, setDays] = useState('');
  const [terms, setTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => a.post(`/rfqs/${d.rfq.id}/quotes`, {
      supplierId, receivedOn: received, validUntil, deliveryDays: days ? Number(days) : null, paymentTerms: terms, notes,
      prices: Object.entries(prices).filter(([, p]) => p).map(([requestLineId, unitPrice]) => ({ requestLineId, unitPrice })),
    }),
    onSuccess: () => (toast('پیشنهاد ثبت شد'), void qc.invalidateQueries({ queryKey: ['procurement'] }), onClose()),
    onError: err.set,
  });
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="ثبت پیشنهاد قیمت" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!received} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <SupplierSelect value={supplierId} onChange={setSupplierId} error={err.fields.supplierId} />
        <Field label="تاریخ دریافت" required><DateInput value={received} onChange={setReceived} /></Field>
        <Field label="اعتبار تا"><DateInput value={validUntil} onChange={setValidUntil} /></Field>
        <Field label="مدت تحویل (روز)"><Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label="شرایط پرداخت"><Input value={terms} onChange={(e) => setTerms(e.target.value)} /></Field>
        <Field label="یادداشت"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <h3 className="mb-2 mt-6 font-semibold">قیمت واحد (ریال)</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {d.lines.map((l) => <Field key={l.id} label={`${l.description} (${num(l.quantity)} ${l.unit})`}><MoneyInput value={prices[l.id] ?? ''} onChange={(x) => setPrices((s) => ({ ...s, [l.id]: x }))} /></Field>)}
      </div>
    </Dialog>
  );
}

function AwardDialog({ d, quote, onClose }: { d: Detail; quote: Detail['quotes'][number]; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const nav = useNavigate();
  const err = useServerErrors();
  const notLowest = d.comparison.lowest !== null && d.comparison.lowest !== quote.supplier_id;
  const [reason, setReason] = useState('');
  const [address, setAddress] = useState('');
  const [expected, setExpected] = useState<string | null>(addDays(todayIso(), quote.delivery_days ?? 14));
  const save = useMutation({
    mutationFn: () => a.post<{ id: string; number: number }>(`/rfqs/${d.rfq.id}/award`, { quoteId: quote.id, reason, expectedOn: expected, deliveryAddress: address }),
    onSuccess: (r) => (toast(`سفارش PO-${num(r.number)} ساخته و برای تأیید ارسال شد`), void qc.invalidateQueries({ queryKey: ['procurement'] }), nav(`${BASE}/orders/${r.id}`)),
    onError: err.set,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`انتخاب ${quote.supplier_name}`} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!expected} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ساخت سفارش</Button></>}>
      {err.banner}
      {notLowest && <Alert tone="warning" className="mb-4">این پیشنهاد کمترین قیمت کامل نیست؛ دلیل انتخاب را بنویسید.</Alert>}
      <div className="grid gap-4">
        <Field label="تاریخ تحویل مورد انتظار" required><DateInput value={expected} onChange={setExpected} /></Field>
        <Field label="محل تحویل"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <Field label="دلیل انتخاب" required={notLowest} error={err.fields.reason}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

