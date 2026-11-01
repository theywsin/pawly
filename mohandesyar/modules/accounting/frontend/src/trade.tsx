import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Package, Plus, Receipt, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, DateInput, DayText, Dialog, EmptyState, ExportMenu, Field, Input, MoneyInput, PageHeader, PageState, Select, Table, Tabs, Td, Th, toast } from '@mohandesyar/ui';
import { useDirectory } from '@mohandesyar/module-sdk/web';
import { todayIso } from '@mohandesyar/persian';
import { AccountSelect, BASE, DetailSelect, ErrorBanner, INVOICE_KIND, INVOICE_STATUS, Nav, fieldErrors, onFail, qtyFa, rial, useApi, useCanDo, useItems, useRange, useRefresh, useWarehouses, type Item } from './common.js';

interface InvoiceRow { id: string; kind: string; number: number; date: string; status: string; reference: string; subtotal: string; discount: string; vat: string; total: string; party: string; voucher_number: number | null }

export function InvoicesPage() {
  const a = useApi();
  const can = useCanDo();
  const nav = useNavigate();
  const r = useRange();
  const [kind, setKind] = useState('');
  const q = useQuery({ queryKey: ['accounting', 'invoices', kind, r.from, r.to], enabled: r.ok, queryFn: () => a.get<InvoiceRow[]>(`/invoices?from=${r.from}&to=${r.to}${kind ? `&kind=${kind}` : ''}`) });
  return (
    <>
      <PageHeader title="فاکتورهای خرید و فروش" actions={can.invoice && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => nav(`${BASE}/invoices/new/sale`)}><Plus className="size-4" /> فاکتور فروش</Button>
          <Button variant="secondary" onClick={() => nav(`${BASE}/invoices/new/purchase`)}>فاکتور خرید</Button>
          <Button variant="ghost" onClick={() => nav(`${BASE}/invoices/new/sale_return`)}>برگشت از فروش</Button>
          <Button variant="ghost" onClick={() => nav(`${BASE}/invoices/new/purchase_return`)}>برگشت از خرید</Button>
        </div>
      )} />
      <Nav />
      <div className="flex flex-wrap items-end gap-3">
        {r.picker}
        <div className="mb-4"><Field label="نوع"><Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">همه</option>{Object.entries(INVOICE_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field></div>
      </div>
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<Receipt className="size-8" />} title="فاکتوری در این بازه نیست" />}>
        <ExportMenu filename="invoices" title="فاکتورها" rows={q.data} columns={[
          { header: 'نوع', value: (i) => INVOICE_KIND[i.kind] }, { header: 'شماره', value: (i) => i.number, kind: 'number' }, { header: 'تاریخ', value: (i) => i.date }, { header: 'طرف حساب', value: (i) => i.party },
          { header: 'مبلغ پس از تخفیف', value: (i) => (BigInt(i.subtotal) - BigInt(i.discount)).toString(), kind: 'number' }, { header: 'ارزش افزوده', value: (i) => i.vat, kind: 'number' }, { header: 'جمع', value: (i) => i.total, kind: 'number' },
          { header: 'وضعیت', value: (i) => INVOICE_STATUS[i.status]!.label },
        ]} />
        <Table>
          <thead><tr><Th>نوع و شماره</Th><Th>تاریخ</Th><Th>طرف حساب</Th><Th>جمع کل</Th><Th>ارزش افزوده</Th><Th>سند</Th><Th>وضعیت</Th></tr></thead>
          <tbody>
            {(q.data ?? []).map((i) => (
              <tr key={i.id}>
                <Td><Link to={`${BASE}/invoices/${i.id}`} className="font-medium text-primary underline-offset-4 hover:underline">{INVOICE_KIND[i.kind]} {i.number.toLocaleString('fa-IR')}</Link></Td>
                <Td className="whitespace-nowrap"><DayText value={i.date} /></Td><Td>{i.party}</Td><Td className="tabular-nums">{rial(i.total)}</Td><Td className="tabular-nums">{rial(i.vat)}</Td>
                <Td>{i.voucher_number?.toLocaleString('fa-IR') ?? '—'}</Td><Td><Badge tone={INVOICE_STATUS[i.status]!.tone}>{INVOICE_STATUS[i.status]!.label}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
    </>
  );
}

interface InvoiceDetail {
  invoice: { id: string; kind: string; number: number; date: string; detail_id: string; warehouse_id: string | null; reference: string; description: string; status: string; subtotal: string; discount: string; vat: string; total: string; party: string; economic_code: string; national_id: string; address: string; postal_code: string; voucher_id: string | null; voucher_number: number | null; created_by: string; approved_by: string | null };
  lines: { id: string; item_id: string; item_code: string; item_name: string; unit: string; description: string; qty: string; unit_price: string; discount: string; vat_rate: number; amount: string; vat: string }[];
}

export function InvoicePage() {
  const { id = 'new', kind } = useParams();
  const a = useApi();
  const q = useQuery({ queryKey: ['accounting', 'invoice', id], enabled: id !== 'new', queryFn: () => a.get<InvoiceDetail>(`/invoices/${id}`) });
  if (id === 'new') return <InvoiceEditor kind={kind && INVOICE_KIND[kind] ? kind : 'sale'} />;
  return <PageState query={q}>{q.data && (q.data.invoice.status === 'draft' ? <InvoiceEditor kind={q.data.invoice.kind} existing={q.data} key={q.data.invoice.id} /> : <InvoiceView data={q.data} />)}</PageState>;
}

interface Line { key: string; itemId: string; description: string; qty: string; unitPrice: string; discount: string; vatRate: string }
let seq = 0;
const blank = (): Line => ({ key: `n${++seq}`, itemId: '', description: '', qty: '1', unitPrice: '', discount: '', vatRate: '' });

function InvoiceEditor({ kind, existing }: { kind: string; existing?: InvoiceDetail }) {
  const a = useApi();
  const nav = useNavigate();
  const refresh = useRefresh();
  const can = useCanDo();
  const items = useItems();
  const warehouses = useWarehouses();
  const inv = existing?.invoice;
  const [date, setDate] = useState<string | null>(inv?.date ?? todayIso());
  const [detailId, setDetailId] = useState(inv?.detail_id ?? '');
  const [warehouseId, setWarehouseId] = useState(inv?.warehouse_id ?? '');
  const [reference, setReference] = useState(inv?.reference ?? '');
  const [description, setDescription] = useState(inv?.description ?? '');
  const [lines, setLines] = useState<Line[]>(existing ? existing.lines.map((l) => ({ key: l.id, itemId: l.item_id, description: l.description, qty: l.qty.replace(/\.?0+$/, ''), unitPrice: l.unit_price, discount: l.discount === '0' ? '' : l.discount, vatRate: String(l.vat_rate) })) : [blank()]);
  const [confirm, setConfirm] = useState<'approve' | 'cancel' | null>(null);
  const set = (k: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));
  const pick = (k: string, itemId: string) => {
    const it = items.data?.find((x) => x.id === itemId);
    set(k, { itemId, unitPrice: kind.startsWith('sale') && it && it.sale_price !== '0' ? it.sale_price : '' });
  };
  const body = () => ({ kind, date, detailId, warehouseId: warehouseId || null, reference, description, lines: lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, description: l.description, qty: l.qty, unitPrice: l.unitPrice || '0', discount: l.discount || '0', vatRate: l.vatRate === '' ? null : Number(l.vatRate) })) });
  const save = useMutation({
    mutationFn: () => (existing ? a.put<{ id: string }>(`/invoices/${existing.invoice.id}`, body()) : a.post<{ id: string }>('/invoices', body())),
    onSuccess: (r) => (toast('فاکتور پیش‌نویس ذخیره شد'), refresh(), existing || nav(`${BASE}/invoices/${r.id}`, { replace: true })),
  });
  const approve = useMutation({ mutationFn: () => a.post<{ voucherNumber: number }>(`/invoices/${existing!.invoice.id}/approve`), onSuccess: (r) => (toast(`فاکتور تأیید شد؛ سند ${r.voucherNumber.toLocaleString('fa-IR')}`), refresh()), onError: onFail });
  const cancel = useMutation({ mutationFn: () => a.post(`/invoices/${existing!.invoice.id}/cancel`, {}), onSuccess: () => (toast('فاکتور ابطال شد'), refresh(), nav(`${BASE}/invoices`)), onError: onFail });
  const f = fieldErrors(save.error);
  const lineCalc = (l: Line) => {
    const gross = Math.round(Number(l.qty || 0) * Number(l.unitPrice || 0));
    return gross - Number(l.discount || 0);
  };
  const net = lines.reduce((s, l) => s + lineCalc(l), 0);
  const hasGoods = lines.some((l) => items.data?.find((x) => x.id === l.itemId)?.kind === 'goods');
  return (
    <>
      <PageHeader title={`${existing ? 'پیش‌نویس ' : ''}فاکتور ${INVOICE_KIND[kind]}${inv ? ` شماره ${inv.number.toLocaleString('fa-IR')}` : ''}`} actions={<Link to={`${BASE}/invoices`} className="text-sm text-primary underline">بازگشت به فاکتورها</Link>} />
      <ErrorBanner error={save.error} />
      <Card>
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <Field label="تاریخ" required><DateInput value={date ?? undefined} onChange={setDate} /></Field>
          <DetailSelect label={kind.startsWith('sale') ? 'خریدار' : 'فروشنده'} required value={detailId} onChange={setDetailId} error={f.detailId} />
          {hasGoods && <Field label="انبار"><Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}><option value="">انبار پیش‌فرض</option>{(warehouses.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>}
          <Field label="شماره مرجع (فاکتور طرف مقابل)"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
          <Field label="شرح" className="sm:col-span-2"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
        <div className="space-y-3">
          {lines.map((l, i) => (
            <div key={l.key} className="grid items-end gap-2 rounded-md border border-border p-2 md:grid-cols-12">
              <Field label={`کالا/خدمت ردیف ${(i + 1).toLocaleString('fa-IR')}`} className="md:col-span-3" error={f[`lines.${i}.itemId`]}>
                <Select value={l.itemId} onChange={(e) => pick(l.key, e.target.value)}>
                  <option value="">انتخاب کنید</option>
                  {(items.data ?? []).filter((x) => x.active || x.id === l.itemId).map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}{x.kind === 'goods' ? ` (موجودی ${qtyFa(x.on_hand)})` : ''}</option>)}
                </Select>
              </Field>
              <Field label="مقدار" className="md:col-span-1" error={f[`lines.${i}.qty`]}><Input dir="ltr" inputMode="decimal" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} /></Field>
              <Field label="فی (ریال)" className="md:col-span-2"><MoneyInput value={l.unitPrice} onChange={(v) => set(l.key, { unitPrice: v })} /></Field>
              <Field label="تخفیف" className="md:col-span-2"><MoneyInput value={l.discount} onChange={(v) => set(l.key, { discount: v })} /></Field>
              <Field label="ارزش افزوده ٪" hint="خالی = پیش‌فرض" className="md:col-span-1"><Input dir="ltr" inputMode="decimal" value={l.vatRate} onChange={(e) => set(l.key, { vatRate: e.target.value })} /></Field>
              <div className="md:col-span-2 text-sm">مبلغ: <b className="tabular-nums">{rial(lineCalc(l))}</b></div>
              <Button variant="ghost" size="sm" aria-label="حذف ردیف" disabled={lines.length <= 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <Button variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, blank()])}><Plus className="size-4" /> ردیف</Button>
          <span className="text-sm">جمع پس از تخفیف (بدون ارزش افزوده): <b className="tabular-nums">{rial(net)}</b></span>
          {existing && <span className="text-sm">جمع کل ذخیره‌شده با ارزش افزوده: <b className="tabular-nums">{rial(existing.invoice.total)}</b></span>}
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          {can.invoice && <Button loading={save.isPending} disabled={!date} onClick={() => save.mutate()}>ذخیره پیش‌نویس</Button>}
          {existing && can.approve && <Button variant="secondary" loading={approve.isPending} onClick={() => setConfirm('approve')}>تأیید و صدور سند</Button>}
          {existing && can.invoice && <Button variant="danger" onClick={() => setConfirm('cancel')}>ابطال پیش‌نویس</Button>}
        </div>
      </Card>
      <ConfirmDialog open={confirm === 'approve'} onOpenChange={(o) => !o && setConfirm(null)} tone="primary" title="تأیید فاکتور" description="با تأیید، سند حسابداری و گردش انبار ثبت می‌شود و فاکتور دیگر قابل ویرایش نیست." confirmLabel="تأیید" onConfirm={() => approve.mutate()} />
      <ConfirmDialog open={confirm === 'cancel'} onOpenChange={(o) => !o && setConfirm(null)} title="ابطال فاکتور" description="فاکتور پیش‌نویس ابطال می‌شود." confirmLabel="ابطال" onConfirm={() => cancel.mutate()} />
    </>
  );
}

function InvoiceView({ data }: { data: InvoiceDetail }) {
  const a = useApi();
  const refresh = useRefresh();
  const can = useCanDo();
  const dir = useDirectory();
  const i = data.invoice;
  const [confirm, setConfirm] = useState(false);
  const cancel = useMutation({ mutationFn: () => a.post(`/invoices/${i.id}/cancel`, {}), onSuccess: () => (toast('فاکتور ابطال و سند برگشت صادر شد'), refresh()), onError: onFail });
  return (
    <>
      <PageHeader title={`فاکتور ${INVOICE_KIND[i.kind]} شماره ${i.number.toLocaleString('fa-IR')}`} actions={<div className="flex gap-2 print:hidden"><Button variant="secondary" onClick={() => window.print()}>چاپ</Button><Link to={`${BASE}/invoices`} className="self-center text-sm text-primary underline">بازگشت</Link></div>} />
      <Card>
        <div className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
          <p>تاریخ: <DayText value={i.date} /></p>
          <p>وضعیت: <Badge tone={INVOICE_STATUS[i.status]!.tone}>{INVOICE_STATUS[i.status]!.label}</Badge></p>
          <p>{i.kind.startsWith('sale') ? 'خریدار' : 'فروشنده'}: <b>{i.party}</b></p>
          <p>کد اقتصادی / شناسه ملی: {i.economic_code || '—'} / {i.national_id || '—'}</p>
          {i.address && <p className="sm:col-span-2">نشانی: {i.address} {i.postal_code && `— کد پستی ${i.postal_code}`}</p>}
          {i.reference && <p>مرجع: {i.reference}</p>}
          {i.voucher_id && <p className="print:hidden">سند حسابداری: <Link to={`${BASE}/vouchers/${i.voucher_id}`} className="text-primary underline">{i.voucher_number?.toLocaleString('fa-IR')}</Link></p>}
          <p className="text-muted print:hidden">ثبت: {dir.name(i.created_by)}{i.approved_by ? ` · تأیید: ${dir.name(i.approved_by)}` : ''}</p>
        </div>
        <Table>
          <thead><tr><Th>ردیف</Th><Th>کالا / خدمت</Th><Th>مقدار</Th><Th>فی</Th><Th>تخفیف</Th><Th>مبلغ</Th><Th>ارزش افزوده</Th></tr></thead>
          <tbody>
            {data.lines.map((l, n) => (
              <tr key={l.id}><Td>{(n + 1).toLocaleString('fa-IR')}</Td><Td>{l.item_code} — {l.item_name}{l.description && ` (${l.description})`}</Td><Td>{qtyFa(l.qty)} {l.unit}</Td>
                <Td className="tabular-nums">{rial(l.unit_price)}</Td><Td className="tabular-nums">{rial(l.discount)}</Td><Td className="tabular-nums">{rial(l.amount)}</Td><Td className="tabular-nums">{rial(l.vat)} ({l.vat_rate.toLocaleString('fa-IR')}٪)</Td></tr>
            ))}
            <tr><Td colSpan={5}>جمع پس از تخفیف</Td><Td className="tabular-nums" colSpan={2}>{rial(BigInt(i.subtotal) - BigInt(i.discount))}</Td></tr>
            <tr><Td colSpan={5}>مالیات و عوارض ارزش افزوده</Td><Td className="tabular-nums" colSpan={2}>{rial(i.vat)}</Td></tr>
            <tr className="font-bold"><Td colSpan={5}>جمع کل</Td><Td className="tabular-nums" colSpan={2}>{rial(i.total)}</Td></tr>
          </tbody>
        </Table>
        {i.status === 'approved' && can.approve && <div className="mt-4 print:hidden"><Button variant="danger" onClick={() => setConfirm(true)}>ابطال فاکتور</Button></div>}
      </Card>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="ابطال فاکتور تأییدشده" description="سند برگشت با تاریخ امروز صادر و گردش انبار برگردانده می‌شود." confirmLabel="ابطال" loading={cancel.isPending} onConfirm={() => cancel.mutate()} />
    </>
  );
}

// ---------------------------------------------------------------- items and stock

export function InventoryPage() {
  const [tab, setTab] = useState('items');
  return (
    <>
      <PageHeader title="کالا، خدمات و انبار" />
      <Nav />
      <Tabs label="بخش‌های انبار" value={tab} onChange={setTab} items={[{ key: 'items', label: 'کالا و خدمات' }, { key: 'adjust', label: 'موجودی اول دوره، کسری و اضافات' }, { key: 'warehouses', label: 'انبارها' }]} />
      <div className="mt-4">
        {tab === 'items' && <ItemsTab />}
        {tab === 'adjust' && <AdjustTab />}
        {tab === 'warehouses' && <WarehousesTab />}
      </div>
    </>
  );
}

function ItemsTab() {
  const q = useItems();
  const can = useCanDo();
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [card, setCard] = useState<Item | null>(null);
  return (
    <>
      {can.party && <div className="mb-4"><Button onClick={() => setEditing('new')}>کالا یا خدمت جدید</Button></div>}
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<Package className="size-8" />} title="هنوز کالا یا خدمتی تعریف نشده است" />}>
        <ExportMenu filename="items" title="کالا و خدمات" rows={q.data} columns={[
          { header: 'کد', value: (x) => x.code }, { header: 'نام', value: (x) => x.name }, { header: 'نوع', value: (x) => (x.kind === 'goods' ? 'کالا' : 'خدمت') }, { header: 'واحد', value: (x) => x.unit },
          { header: 'موجودی', value: (x) => x.on_hand, kind: 'number' }, { header: 'ارزش موجودی', value: (x) => x.stock_value, kind: 'number' }, { header: 'قیمت فروش', value: (x) => x.sale_price, kind: 'number' },
        ]} />
        <Table>
          <thead><tr><Th>کد</Th><Th>نام</Th><Th>نوع</Th><Th>موجودی</Th><Th>ارزش موجودی</Th><Th>بهای میانگین</Th><Th>قیمت فروش</Th><Th>عملیات</Th></tr></thead>
          <tbody>
            {(q.data ?? []).map((x) => (
              <tr key={x.id} className={x.active ? '' : 'opacity-60'}>
                <Td className="tabular-nums">{x.code}</Td><Td className="font-medium">{x.name}{x.vat_exempt && <Badge tone="neutral">معاف</Badge>}</Td><Td>{x.kind === 'goods' ? 'کالا' : 'خدمت'}</Td>
                <Td>{x.kind === 'goods' ? `${qtyFa(x.on_hand)} ${x.unit}` : '—'}</Td><Td className="tabular-nums">{x.kind === 'goods' ? rial(x.stock_value) : '—'}</Td>
                <Td className="tabular-nums">{x.kind === 'goods' && Number(x.on_hand) > 0 ? rial(Math.round(Number(x.stock_value) / Number(x.on_hand))) : '—'}</Td>
                <Td className="tabular-nums">{rial(x.sale_price)}</Td>
                <Td className="whitespace-nowrap">{can.party && <Button size="sm" variant="secondary" onClick={() => setEditing(x)}>ویرایش</Button>} {x.kind === 'goods' && <Button size="sm" variant="ghost" onClick={() => setCard(x)}>کاردکس</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {editing && <ItemForm item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {card && <StockCard item={card} onClose={() => setCard(null)} />}
    </>
  );
}

function ItemForm({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const a = useApi();
  const refresh = useRefresh();
  const [v, setV] = useState({ code: item?.code ?? '', name: item?.name ?? '', kind: item?.kind ?? 'goods', unit: item?.unit ?? 'عدد', salePrice: item?.sale_price ?? '', vatExempt: item?.vat_exempt ?? false, expenseAccountId: item?.expense_account_id ?? '', active: item?.active ?? true });
  const m = useMutation({ mutationFn: () => { const body = { ...v, salePrice: v.salePrice || '0', expenseAccountId: v.expenseAccountId || null }; return item ? a.put(`/items/${item.id}`, body) : a.post('/items', body); }, onSuccess: () => (toast('ذخیره شد'), refresh(), onClose()) });
  const f = fieldErrors(m.error);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={item ? 'ویرایش کالا/خدمت' : 'کالا یا خدمت جدید'} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={m.isPending} onClick={() => m.mutate()}>ذخیره</Button></>}>
      <ErrorBanner error={m.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="کد" required error={f.code}><Input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></Field>
        <Field label="نام" required error={f.name}><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="نوع"><Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as 'goods' | 'service' })}><option value="goods">کالا (موجودی دارد)</option><option value="service">خدمت</option></Select></Field>
        <Field label="واحد"><Input value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value })} /></Field>
        <Field label="قیمت فروش (ریال)"><MoneyInput value={v.salePrice} onChange={(x) => setV({ ...v, salePrice: x })} /></Field>
        {v.kind === 'service' && <AccountSelect label="حساب هزینه هنگام خرید" allowEmpty="خرید خدمات و متفرقه (پیش‌فرض)" value={v.expenseAccountId} onChange={(x) => setV({ ...v, expenseAccountId: x })} />}
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Checkbox label="معاف از مالیات بر ارزش افزوده" checked={v.vatExempt} onChange={(e) => setV({ ...v, vatExempt: e.target.checked })} />
          <Checkbox label="فعال" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
        </div>
      </div>
    </Dialog>
  );
}

function StockCard({ item, onClose }: { item: Item; onClose: () => void }) {
  const a = useApi();
  const q = useQuery({ queryKey: ['accounting', 'card', item.id], queryFn: () => a.get<{ id: string; date: string; qty: string; cost: string; source: string; description: string; warehouse: string; onHand: string; value: string }[]>(`/items/${item.id}/card`) });
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={`کاردکس ${item.name}`}>
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<p className="text-sm text-muted">گردشی ندارد.</p>}>
        <Table>
          <thead><tr><Th>تاریخ</Th><Th>شرح</Th><Th>انبار</Th><Th>وارده/صادره</Th><Th>بها</Th><Th>مانده</Th><Th>ارزش مانده</Th></tr></thead>
          <tbody>{(q.data ?? []).map((m) => <tr key={m.id}><Td className="whitespace-nowrap"><DayText value={m.date} /></Td><Td>{m.description}</Td><Td>{m.warehouse}</Td><Td className={Number(m.qty) < 0 ? 'text-danger' : ''}>{qtyFa(m.qty)}</Td><Td className="tabular-nums">{rial(m.cost)}</Td><Td>{qtyFa(m.onHand)}</Td><Td className="tabular-nums">{rial(m.value)}</Td></tr>)}</tbody>
        </Table>
      </PageState>
    </Dialog>
  );
}

function AdjustTab() {
  const a = useApi();
  const refresh = useRefresh();
  const can = useCanDo();
  const items = useItems();
  const warehouses = useWarehouses();
  const [kind, setKind] = useState('opening');
  const [date, setDate] = useState<string | null>(todayIso());
  const [warehouseId, setWarehouseId] = useState('');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState([{ key: 'a', itemId: '', qty: '', unitCost: '' }]);
  const m = useMutation({
    mutationFn: () => a.post<{ total: string; voucherNumber: number | null }>('/stock/adjustments', { kind, date, warehouseId: warehouseId || warehouses.data?.[0]?.id, description, lines: lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, qty: l.qty, unitCost: l.unitCost || '0' })) }),
    onSuccess: (r) => (toast(`ثبت شد؛ ارزش ${rial(r.total)} ریال${r.voucherNumber ? ` — سند ${r.voucherNumber.toLocaleString('fa-IR')}` : ''}`), refresh(), setLines([{ key: `a${Date.now()}`, itemId: '', qty: '', unitCost: '' }])),
  });
  if (!can.inventory) return <Alert tone="warning">برای این بخش مجوز «انبار» لازم است.</Alert>;
  const goods = (items.data ?? []).filter((x) => x.kind === 'goods' && x.active);
  return (
    <Card>
      <ErrorBanner error={m.error} />
      <div className="mb-4 grid gap-4 sm:grid-cols-4">
        <Field label="نوع"><Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="opening">موجودی اول دوره</option><option value="gain">اضافات انبار</option><option value="loss">کسری انبار</option></Select></Field>
        <Field label="تاریخ" required><DateInput value={date ?? undefined} onChange={setDate} /></Field>
        <Field label="انبار"><Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>{(warehouses.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
        <Field label="شرح"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={l.key} className="grid items-end gap-2 sm:grid-cols-4">
            <Field label={`کالا ${(i + 1).toLocaleString('fa-IR')}`}><Select value={l.itemId} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, itemId: e.target.value } : x)))}><option value="">انتخاب کنید</option>{goods.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}</Select></Field>
            <Field label="مقدار"><Input dir="ltr" inputMode="decimal" value={l.qty} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))} /></Field>
            {kind !== 'loss' ? <Field label="بهای واحد (ریال)"><MoneyInput value={l.unitCost} onChange={(v) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, unitCost: v } : x)))} /></Field> : <p className="text-sm text-muted">بها به میانگین موزون متحرک</p>}
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, { key: `a${Date.now()}`, itemId: '', qty: '', unitCost: '' }])}><Plus className="size-4" /> ردیف</Button>
        <Button loading={m.isPending} disabled={!date} onClick={() => m.mutate()}>ثبت و صدور سند</Button>
      </div>
    </Card>
  );
}

function WarehousesTab() {
  const a = useApi();
  const refresh = useRefresh();
  const can = useCanDo();
  const q = useWarehouses();
  const [name, setName] = useState('');
  const m = useMutation({ mutationFn: () => a.post('/warehouses', { name }), onSuccess: () => (toast('انبار اضافه شد'), refresh(), setName('')), onError: onFail });
  return (
    <>
      {can.inventory && <div className="mb-4 flex items-end gap-2"><Field label="نام انبار جدید"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field><Button loading={m.isPending} onClick={() => m.mutate()}>افزودن</Button></div>}
      <PageState query={q}><ul className="list-inside list-disc space-y-1">{(q.data ?? []).map((w) => <li key={w.id}>{w.name}</li>)}</ul></PageState>
    </>
  );
}
