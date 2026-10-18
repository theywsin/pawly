import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Truck } from 'lucide-react';
import { Badge, Button, Checkbox, Dialog, EmptyState, ExportMenu, Field, Input, Ltr, PageHeader, PageState, Select, Table, Td, Textarea, Th, toast, DayText } from '@mohandesyar/ui';
import { useCan } from '@mohandesyar/module-sdk/web';
import { Nav, num, rial, status, useApi, useCategories, useServerErrors, useSuppliers, type Supplier } from './common.js';

export function SuppliersPage() {
  const canManage = useCan('procurement.supplier.manage');
  const q = useSuppliers();
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [statement, setStatement] = useState<Supplier | null>(null);
  const [cat, setCat] = useState(false);
  return (
    <>
      <PageHeader
        title="تأمین‌کنندگان"
        description="تأمین‌کننده مسدودشده در استعلام و سفارش جدید قابل انتخاب نیست. امتیاز میانگین کیفیت، تحویل و قیمت از امتیازهای ثبت‌شده روی سفارش‌هاست."
        actions={
          <>
            <ExportMenu filename="suppliers" title="تأمین‌کنندگان" rows={q.data} columns={[
              { header: 'نام', value: (s) => s.name }, { header: 'شناسه ملی', value: (s) => s.national_id }, { header: 'کد اقتصادی', value: (s) => s.economic_code },
              { header: 'تلفن', value: (s) => s.phone }, { header: 'شبا', value: (s) => s.iban }, { header: 'دسته‌ها', value: (s) => s.categories.join('، ') },
              { header: 'امتیاز', value: (s) => s.rating, kind: 'number' }, { header: 'وضعیت', value: (s) => (s.status === 'active' ? 'فعال' : 'مسدود') },
            ]} />
            {canManage && <Button variant="secondary" onClick={() => setCat(true)}>دسته جدید</Button>}
            {canManage && <Button onClick={() => setEditing('new')}><Plus className="size-4" /> تأمین‌کننده</Button>}
          </>
        }
      />
      <Nav />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<Truck className="size-8" />} title="تأمین‌کننده‌ای ثبت نشده است" />}>
        <Table>
          <thead><tr><Th>نام</Th><Th>تماس</Th><Th>دسته‌ها</Th><Th>امتیاز</Th><Th>سفارش</Th><Th>وضعیت</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
          <tbody>
            {q.data?.map((s) => (
              <tr key={s.id}>
                <Td>{s.name}{s.national_id && <div className="text-xs text-muted">شناسه ملی: <Ltr>{s.national_id}</Ltr></div>}</Td>
                <Td><Ltr>{s.phone}</Ltr>{s.email && <div className="text-xs text-muted"><Ltr>{s.email}</Ltr></div>}</Td>
                <Td>{s.categories.join('، ') || '—'}</Td>
                <Td className="tabular-nums">{s.rating === null ? '—' : `${num(s.rating)} از ۵ (${num(s.ratings)})`}</Td>
                <Td className="tabular-nums">{num(s.orders)}</Td>
                <Td>{s.status === 'active' ? <Badge tone="success">فعال</Badge> : <><Badge tone="danger">مسدود</Badge><div className="text-xs text-muted">{s.block_reason}</div></>}</Td>
                <Td className="whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setStatement(s)}>صورت‌حساب</Button>
                  {canManage && <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>ویرایش</Button>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {editing && <SupplierDialog supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {statement && <StatementDialog supplier={statement} onClose={() => setStatement(null)} />}
      {cat && <CategoryDialog onClose={() => setCat(false)} />}
    </>
  );
}

function SupplierDialog({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const cats = useCategories();
  const [v, setV] = useState({
    name: supplier?.name ?? '', nationalId: supplier?.national_id ?? '', economicCode: supplier?.economic_code ?? '', phone: supplier?.phone ?? '', email: supplier?.email ?? '',
    address: supplier?.address ?? '', iban: supplier?.iban ?? '', status: supplier?.status ?? 'active', blockReason: supplier?.block_reason ?? '', notes: supplier?.notes ?? '',
  });
  const [catIds, setCatIds] = useState<string[]>(supplier?.category_ids ?? []);
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const save = useMutation({
    mutationFn: () => (supplier ? a.put(`/suppliers/${supplier.id}`, { ...v, categoryIds: catIds }) : a.post('/suppliers', { ...v, categoryIds: catIds })),
    onSuccess: () => (toast('تأمین‌کننده ذخیره شد'), void qc.invalidateQueries({ queryKey: ['procurement'] }), onClose()),
    onError: err.set,
  });
  const f = err.fields;
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={supplier ? 'ویرایش تأمین‌کننده' : 'تأمین‌کننده جدید'} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ذخیره</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نام" required error={f.name}><Input value={v.name} onChange={(e) => set('name')(e.target.value)} /></Field>
        <Field label="شناسه ملی / کد ملی"><Input dir="ltr" value={v.nationalId} onChange={(e) => set('nationalId')(e.target.value)} /></Field>
        <Field label="کد اقتصادی"><Input dir="ltr" value={v.economicCode} onChange={(e) => set('economicCode')(e.target.value)} /></Field>
        <Field label="تلفن"><Input dir="ltr" value={v.phone} onChange={(e) => set('phone')(e.target.value)} /></Field>
        <Field label="ایمیل" error={f.email}><Input dir="ltr" value={v.email} onChange={(e) => set('email')(e.target.value)} /></Field>
        <Field label="شماره شبا" error={f.iban}><Input dir="ltr" value={v.iban} onChange={(e) => set('iban')(e.target.value)} placeholder="IR..." /></Field>
        <Field label="نشانی" className="sm:col-span-2"><Input value={v.address} onChange={(e) => set('address')(e.target.value)} /></Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium">دسته‌های کالا/خدمت</legend>
          {(cats.data ?? []).length === 0 ? <p className="text-sm text-muted">دسته‌ای تعریف نشده است.</p> : (
            <div className="flex flex-wrap gap-4">
              {cats.data!.map((c) => <Checkbox key={c.id} label={c.name} checked={catIds.includes(c.id)} onChange={(e) => setCatIds((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} />)}
            </div>
          )}
        </fieldset>
        <Field label="وضعیت"><Select value={v.status} onChange={(e) => set('status')(e.target.value)}><option value="active">فعال</option><option value="blocked">مسدود</option></Select></Field>
        {v.status === 'blocked' && <Field label="دلیل مسدودسازی" required error={f.blockReason}><Input value={v.blockReason} onChange={(e) => set('blockReason')(e.target.value)} /></Field>}
        <Field label="یادداشت" className="sm:col-span-2"><Textarea value={v.notes} onChange={(e) => set('notes')(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function CategoryDialog({ onClose }: { onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [name, setName] = useState('');
  const save = useMutation({ mutationFn: () => a.post('/categories', { name }), onSuccess: () => (toast('دسته ثبت شد'), void qc.invalidateQueries({ queryKey: ['procurement', 'categories'] }), onClose()), onError: err.set });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="دسته کالا/خدمت" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <Field label="نام دسته" required error={err.fields.name}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
    </Dialog>
  );
}

function StatementDialog({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const a = useApi();
  const q = useQuery({
    queryKey: ['procurement', 'statement', supplier.id],
    queryFn: () => a.get<{ orders: { id: string; number: number; ordered_on: string; status: string; ordered: string; accepted: string; invoiced: string }[] }>(`/suppliers/${supplier.id}/statement`),
  });
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={`صورت‌حساب ${supplier.name}`} description="مبلغ پذیرفته‌شده به قیمت سفارش و مبلغ فاکتورهای تأییدشده." footer={<Button variant="ghost" onClick={onClose}>بستن</Button>}>
      <PageState query={q} isEmpty={q.data?.orders.length === 0} empty={<EmptyState title="سفارشی برای این تأمین‌کننده ثبت نشده است" />}>
        <Table>
          <thead><tr><Th>سفارش</Th><Th>تاریخ</Th><Th>وضعیت</Th><Th>سفارش (ریال)</Th><Th>پذیرفته (ریال)</Th><Th>فاکتورشده (ریال)</Th></tr></thead>
          <tbody>
            {q.data?.orders.map((o) => (
              <tr key={o.id}>
                <Td className="tabular-nums">PO-{num(o.number)}</Td><Td><DayText value={o.ordered_on} /></Td><Td>{status(o.status).label}</Td>
                <Td className="tabular-nums">{rial(o.ordered)}</Td><Td className="tabular-nums">{rial(o.accepted)}</Td><Td className="tabular-nums">{rial(o.invoiced)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
    </Dialog>
  );
}
