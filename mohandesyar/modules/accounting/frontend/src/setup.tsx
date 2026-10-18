import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, Badge, Button, Checkbox, ConfirmDialog, DateInput, DayText, Dialog, ExportMenu, Field, Input, PageHeader, PageState, Select, Table, Tabs, Td, Th, toast } from '@mohandesyar/ui';
import { DETAIL_KIND, ErrorBanner, Nav, fieldErrors, onFail, useAccounts, useApi, useCanDo, useDetails, useRefresh, useYears, type Account, type Detail } from './common.js';

const TYPE: Record<string, string> = { asset: 'دارایی', liability: 'بدهی', equity: 'حقوق مالکانه', income: 'درآمد', expense: 'هزینه', memo: 'انتظامی' };

export function SetupPage() {
  const [tab, setTab] = useState('chart');
  return (
    <>
      <PageHeader title="حساب‌ها و تنظیمات حسابداری" />
      <Nav />
      <Tabs label="بخش‌های تنظیمات" value={tab} onChange={setTab} items={[{ key: 'chart', label: 'سرفصل حساب‌ها' }, { key: 'details', label: 'تفصیلی‌ها (طرف حساب‌ها)' }, { key: 'years', label: 'سال‌های مالی' }]} />
      <div className="mt-4">
        {tab === 'chart' && <Chart />}
        {tab === 'details' && <Details />}
        {tab === 'years' && <Years />}
      </div>
      <p className="mt-6 text-sm text-muted">نرخ مالیات بر ارزش افزوده، تفکیک وظایف و اجازه موجودی منفی در «تنظیمات ← ماژول‌ها ← حسابداری» تعیین می‌شوند.</p>
    </>
  );
}

function Chart() {
  const q = useAccounts();
  const can = useCanDo();
  const [adding, setAdding] = useState<Account | null>(null);
  const [editing, setEditing] = useState<Account | null>(null);
  const indent: Record<string, string> = { group: 'font-bold', ledger: 'ps-6 font-medium', subsidiary: 'ps-12' };
  return (
    <PageState query={q}>
      <ExportMenu filename="chart-of-accounts" title="سرفصل حساب‌ها" rows={q.data} columns={[
        { header: 'کد', value: (x) => x.code }, { header: 'نام', value: (x) => x.name }, { header: 'سطح', value: (x) => ({ group: 'گروه', ledger: 'کل', subsidiary: 'معین' })[x.level] }, { header: 'ماهیت', value: (x) => TYPE[x.type] },
      ]} />
      <Table>
        <thead><tr><Th>کد</Th><Th>نام حساب</Th><Th>نوع</Th><Th>تفصیلی</Th><Th>عملیات</Th></tr></thead>
        <tbody>
          {(q.data ?? []).map((x) => (
            <tr key={x.id} className={x.active ? '' : 'opacity-60'}>
              <Td className="tabular-nums">{x.code}</Td>
              <Td className={indent[x.level]}>{x.name}{x.system_key && <Badge tone="info">سیستمی</Badge>}{!x.active && <Badge tone="neutral">غیرفعال</Badge>}</Td>
              <Td>{TYPE[x.type]}</Td><Td>{x.level === 'subsidiary' ? (x.needs_detail ? 'الزامی' : 'اختیاری') : ''}</Td>
              <Td className="whitespace-nowrap">
                {can.setup && x.level !== 'subsidiary' && <Button size="sm" variant="ghost" onClick={() => setAdding(x)}>+ زیرحساب</Button>}
                {can.setup && x.level !== 'group' && <Button size="sm" variant="ghost" onClick={() => setEditing(x)}>ویرایش</Button>}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {adding && <AddAccount parent={adding} onClose={() => setAdding(null)} />}
      {editing && <EditAccount account={editing} onClose={() => setEditing(null)} />}
    </PageState>
  );
}

function AddAccount({ parent, onClose }: { parent: Account; onClose: () => void }) {
  const a = useApi();
  const refresh = useRefresh();
  const [v, setV] = useState({ code: parent.code, name: '', needsDetail: false });
  const m = useMutation({ mutationFn: () => a.post('/accounts', { parentId: parent.id, ...v }), onSuccess: () => (toast('حساب اضافه شد'), refresh(), onClose()) });
  const f = fieldErrors(m.error);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`حساب ${parent.level === 'group' ? 'کل' : 'معین'} جدید زیر «${parent.name}»`} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={m.isPending} onClick={() => m.mutate()}>ذخیره</Button></>}>
      <ErrorBanner error={m.error} />
      <div className="grid gap-4">
        <Field label="کد" hint={`با ${parent.code} شروع شود`} required error={f.code}><Input dir="ltr" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></Field>
        <Field label="نام" required error={f.name}><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        {parent.level === 'ledger' && <Checkbox label="ردیف‌های این حساب تفصیلی لازم دارند" checked={v.needsDetail} onChange={(e) => setV({ ...v, needsDetail: e.target.checked })} />}
      </div>
    </Dialog>
  );
}

function EditAccount({ account, onClose }: { account: Account; onClose: () => void }) {
  const a = useApi();
  const refresh = useRefresh();
  const [v, setV] = useState({ name: account.name, needsDetail: account.needs_detail, active: account.active });
  const m = useMutation({ mutationFn: () => a.put(`/accounts/${account.id}`, v), onSuccess: () => (toast('ذخیره شد'), refresh(), onClose()) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`ویرایش حساب ${account.code}`} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={m.isPending} onClick={() => m.mutate()}>ذخیره</Button></>}>
      <ErrorBanner error={m.error} />
      <div className="grid gap-4">
        <Field label="نام" required><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        {account.level === 'subsidiary' && <Checkbox label="تفصیلی الزامی" checked={v.needsDetail} onChange={(e) => setV({ ...v, needsDetail: e.target.checked })} />}
        <Checkbox label="فعال" checked={v.active} disabled={!!account.system_key} onChange={(e) => setV({ ...v, active: e.target.checked })} />
        {account.system_key && <p className="text-sm text-muted">این حساب در اسناد خودکار استفاده می‌شود و غیرفعال نمی‌شود.</p>}
      </div>
    </Dialog>
  );
}

function Details() {
  const q = useDetails();
  const can = useCanDo();
  const [editing, setEditing] = useState<Detail | 'new' | null>(null);
  const [filter, setFilter] = useState('');
  const rows = (q.data ?? []).filter((d) => !filter || d.name.includes(filter) || d.code.includes(filter));
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        {can.party && <Button onClick={() => setEditing('new')}>تفصیلی جدید</Button>}
        <Field label="جست‌وجو"><Input value={filter} onChange={(e) => setFilter(e.target.value)} /></Field>
      </div>
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<p className="text-sm text-muted">هنوز طرف حسابی تعریف نشده است.</p>}>
        <ExportMenu filename="details" title="حساب‌های تفصیلی" rows={rows} columns={[
          { header: 'کد', value: (d) => d.code }, { header: 'نام', value: (d) => d.name }, { header: 'نوع', value: (d) => DETAIL_KIND[d.kind] }, { header: 'شناسه/کد ملی', value: (d) => d.national_id },
          { header: 'کد اقتصادی', value: (d) => d.economic_code }, { header: 'کد پستی', value: (d) => d.postal_code }, { header: 'نشانی', value: (d) => d.address }, { header: 'تلفن', value: (d) => d.phone },
        ]} />
        <Table>
          <thead><tr><Th>کد</Th><Th>نام</Th><Th>نوع</Th><Th>شناسه ملی</Th><Th>کد اقتصادی</Th><Th>عملیات</Th></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className={d.active ? '' : 'opacity-60'}>
                <Td className="tabular-nums">{d.code}</Td><Td className="font-medium">{d.name}</Td><Td>{DETAIL_KIND[d.kind]}</Td><Td dir="ltr">{d.national_id || '—'}</Td><Td dir="ltr">{d.economic_code || '—'}</Td>
                <Td>{can.party && <Button size="sm" variant="ghost" onClick={() => setEditing(d)}>ویرایش</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {editing && <DetailForm detail={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function DetailForm({ detail, onClose }: { detail: Detail | null; onClose: () => void }) {
  const a = useApi();
  const refresh = useRefresh();
  const [v, setV] = useState({ code: detail?.code ?? '', name: detail?.name ?? '', kind: detail?.kind ?? 'company', nationalId: detail?.national_id ?? '', economicCode: detail?.economic_code ?? '', postalCode: detail?.postal_code ?? '', address: detail?.address ?? '', phone: detail?.phone ?? '', active: detail?.active ?? true });
  const m = useMutation({ mutationFn: () => { const body = { ...v, code: v.code || undefined }; return detail ? a.put(`/details/${detail.id}`, body) : a.post('/details', body); }, onSuccess: () => (toast('ذخیره شد'), refresh(), onClose()) });
  const f = fieldErrors(m.error);
  const s = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={detail ? 'ویرایش تفصیلی' : 'تفصیلی (طرف حساب) جدید'} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={m.isPending} onClick={() => m.mutate()}>ذخیره</Button></>}>
      <ErrorBanner error={m.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نام" required error={f.name}><Input value={v.name} onChange={s('name')} /></Field>
        <Field label="نوع"><Select value={v.kind} onChange={s('kind')}>{Object.entries(DETAIL_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="کد تفصیلی" hint="خالی = خودکار" error={f.code}><Input dir="ltr" value={v.code} onChange={s('code')} /></Field>
        <Field label="شناسه ملی / کد ملی" error={f.nationalId}><Input dir="ltr" value={v.nationalId} onChange={s('nationalId')} /></Field>
        <Field label="کد اقتصادی" error={f.economicCode}><Input dir="ltr" value={v.economicCode} onChange={s('economicCode')} /></Field>
        <Field label="کد پستی" error={f.postalCode}><Input dir="ltr" value={v.postalCode} onChange={s('postalCode')} /></Field>
        <Field label="تلفن"><Input dir="ltr" value={v.phone} onChange={s('phone')} /></Field>
        <Field label="نشانی" className="sm:col-span-2"><Input value={v.address} onChange={s('address')} /></Field>
        <Checkbox label="فعال" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
      </div>
    </Dialog>
  );
}

function Years() {
  const a = useApi();
  const refresh = useRefresh();
  const can = useCanDo();
  const q = useYears();
  const [closing, setClosing] = useState<{ id: string; title: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [v, setV] = useState({ title: '' });
  const [startOn, setStartOn] = useState<string | null>(null);
  const [endOn, setEndOn] = useState<string | null>(null);
  const close = useMutation({ mutationFn: (id: string) => a.post<{ closing: number | null; opening: number | null }>(`/years/${id}/close`), onSuccess: () => (toast('سال مالی بسته و سند افتتاحیه سال بعد صادر شد'), refresh(), setClosing(null)), onError: onFail });
  const create = useMutation({ mutationFn: () => a.post('/years', { ...v, startOn, endOn }), onSuccess: () => (toast('سال مالی تعریف شد'), refresh(), setCreating(false)) });
  return (
    <>
      {can.setup && <div className="mb-4"><Button variant="secondary" onClick={() => setCreating(true)}>تعریف سال مالی</Button></div>}
      <PageState query={q}>
        <Table>
          <thead><tr><Th>عنوان</Th><Th>شروع</Th><Th>پایان</Th><Th>اسناد قطعی</Th><Th>پیش‌نویس</Th><Th>وضعیت</Th></tr></thead>
          <tbody>
            {(q.data ?? []).map((y) => (
              <tr key={y.id}>
                <Td className="font-medium">{y.title}</Td><Td><DayText value={y.start_on} /></Td><Td><DayText value={y.end_on} /></Td><Td>{y.posted.toLocaleString('fa-IR')}</Td><Td>{y.drafts.toLocaleString('fa-IR')}</Td>
                <Td>{y.status === 'closed' ? <Badge tone="neutral">بسته</Badge> : can.post ? <Button size="sm" variant="ghost" onClick={() => setClosing(y)}>بستن سال</Button> : <Badge tone="success">باز</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      <ConfirmDialog open={!!closing} onOpenChange={(o) => !o && setClosing(null)} title={`بستن ${closing?.title ?? ''}`}
        description="حساب‌های درآمد و هزینه به سود و زیان انباشته بسته می‌شوند، سند اختتامیه صادر و سند افتتاحیه در اولین روز سال بعد ثبت می‌شود. پس از بستن، ثبت سند در این سال ممکن نیست."
        confirmLabel="بستن سال" loading={close.isPending} onConfirm={() => closing && close.mutate(closing.id)} />
      {creating && (
        <Dialog open onOpenChange={(o) => !o && setCreating(false)} title="سال مالی جدید" footer={<><Button variant="ghost" onClick={() => setCreating(false)}>انصراف</Button><Button loading={create.isPending} disabled={!startOn || !endOn} onClick={() => create.mutate()}>ذخیره</Button></>}>
          <ErrorBanner error={create.error} />
          <Alert tone="info" className="mb-3">سال مالی جاری خودکار ساخته شده است؛ سال بعد هم هنگام بستن سال ساخته می‌شود. این فرم برای سال مالی غیرشمسی یا سال‌های گذشته است.</Alert>
          <div className="grid gap-4">
            <Field label="عنوان" required error={fieldErrors(create.error).title}><Input value={v.title} onChange={(e) => setV({ title: e.target.value })} /></Field>
            <Field label="شروع" required><DateInput value={startOn ?? undefined} onChange={setStartOn} /></Field>
            <Field label="پایان" required error={fieldErrors(create.error).endOn}><DateInput value={endOn ?? undefined} onChange={setEndOn} /></Field>
          </div>
        </Dialog>
      )}
    </>
  );
}
