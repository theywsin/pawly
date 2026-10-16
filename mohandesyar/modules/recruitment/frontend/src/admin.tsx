import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, DateInput, DateText, Dialog, EmptyState, ExportMenu, Field, Input, Ltr, PageHeader, PageState, Select, Stat, Table, Td, Th, toast } from '@mohandesyar/ui';
import { addDays, todayIso } from '@mohandesyar/persian';
import { BASE, DUP_RULE, JOB_STATUS, Nav, SOURCE, STAGE_KIND, fa, useApi, useServerErrors } from './common.js';

// ---------------------------------------------------------------- duplicates

interface Side { id: string; full_name: string; mobile: string | null; email: string | null; desired_position: string; created_at: string; status: string }
interface Pair { id: string; rules: string[]; created_at: string; a: Side; b: Side }

export function DuplicatesPage() {
  const a = useApi();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['recruitment', 'duplicates'], queryFn: () => a.get<Pair[]>('/duplicates') });
  const [merging, setMerging] = useState<{ pair: Pair; keep: Side; drop: Side } | null>(null);
  const done = (msg: string) => (toast(msg), setMerging(null), void qc.invalidateQueries({ queryKey: ['recruitment'] }));
  const merge = useMutation({ mutationFn: () => a.post(`/duplicates/${merging!.pair.id}/merge`, { keepId: merging!.keep.id }), onSuccess: () => done('رزومه‌ها ادغام شدند') });
  const dismiss = useMutation({ mutationFn: (id: string) => a.post(`/duplicates/${id}/dismiss`), onSuccess: () => done('به‌عنوان «تکراری نیست» ثبت شد') });
  const side = (s: Side) => (
    <div className="text-sm">
      <Link to={`${BASE}/candidates/${s.id}`} className="font-medium text-primary underline-offset-4 hover:underline">{s.full_name}</Link>
      <div className="text-muted">{s.desired_position || '—'}</div>
      <div>{s.mobile ? <Ltr>{s.mobile}</Ltr> : '—'} · {s.email ? <Ltr>{s.email}</Ltr> : '—'}</div>
      <div className="text-xs text-muted">ثبت: <DateText value={s.created_at} /></div>
    </div>
  );
  return (
    <>
      <PageHeader title="رزومه‌های تکراری" description="رزومه‌هایی که شماره همراه، ایمیل یا نام یکسان دارند. پس از بررسی، ادغام کنید یا «تکراری نیست» را بزنید." />
      <Nav />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<Copy className="size-8" />} title="مورد تکراری در انتظار بررسی نیست" />}>
        <ul className="space-y-3">
          {q.data?.map((p) => (
            <li key={p.id} className="rounded-lg border border-border p-4">
              <div className="mb-3 flex flex-wrap gap-2">{p.rules.map((r) => <Badge key={r} tone="warning">{DUP_RULE[r]}</Badge>)}</div>
              <div className="grid gap-4 sm:grid-cols-2">{side(p.a)}{side(p.b)}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setMerging({ pair: p, keep: p.a, drop: p.b })}>ادغام در «{p.a.full_name}»</Button>
                <Button size="sm" variant="secondary" onClick={() => setMerging({ pair: p, keep: p.b, drop: p.a })}>ادغام در «{p.b.full_name}» (ثبت {p.b.created_at > p.a.created_at ? 'جدیدتر' : 'قدیمی‌تر'})</Button>
                <Button size="sm" variant="ghost" loading={dismiss.isPending} onClick={() => dismiss.mutate(p.id)}>تکراری نیست</Button>
              </div>
            </li>
          ))}
        </ul>
      </PageState>
      <ConfirmDialog
        open={!!merging}
        onOpenChange={(o) => !o && setMerging(null)}
        tone="primary"
        title="ادغام رزومه‌ها"
        description={merging && `سوابق، تحصیلات، مهارت‌ها، فایل‌ها و درخواست‌های «${merging.drop.full_name}» به «${merging.keep.full_name}» منتقل و فیلدهای خالی تکمیل می‌شوند. رزومه دوم فقط به‌عنوان «ادغام‌شده» باقی می‌ماند.`}
        confirmLabel="ادغام"
        loading={merge.isPending}
        onConfirm={() => merge.mutate()}
      />
    </>
  );
}

// ---------------------------------------------------------------- reports

interface Report {
  totals: { new_candidates: number; hired: number; interviews: number; days_to_hire: number | null; open_jobs: number };
  jobs: { id: string; title: string; status: string; applications: number; hired: number; rejected: number; in_progress: number; days_to_hire: number | null }[];
  sources: { source: string; candidates: number; hired: number }[];
  rejections: { reason: string; n: number }[];
}

export function ReportsPage() {
  const a = useApi();
  const [from, setFrom] = useState<string | null>(addDays(todayIso(), -90));
  const [to, setTo] = useState<string | null>(todayIso());
  const q = useQuery({ queryKey: ['recruitment', 'report', from, to], queryFn: () => a.get<Report>(`/reports?from=${from}&to=${to}`), enabled: !!from && !!to });
  const d = q.data;
  return (
    <>
      <PageHeader title="گزارش‌های استخدام" actions={<Button variant="secondary" onClick={() => window.print()}>چاپ / PDF</Button>} />
      <Nav />
      <div className="mb-6 flex flex-wrap items-end gap-3 print:hidden">
        <Field label="از تاریخ"><DateInput value={from} onChange={setFrom} /></Field>
        <Field label="تا تاریخ"><DateInput value={to} onChange={setTo} /></Field>
      </div>
      <PageState query={q}>
        {d && (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Stat label="رزومه جدید">{fa(d.totals.new_candidates)}</Stat>
              <Stat label="استخدام">{fa(d.totals.hired)}</Stat>
              <Stat label="مصاحبه ارزیابی‌شده">{fa(d.totals.interviews)}</Stat>
              <Stat label="میانگین زمان استخدام" hint="از ورود به قیف تا استخدام">{d.totals.days_to_hire === null ? 'داده کافی وجود ندارد' : `${fa(d.totals.days_to_hire)} روز`}</Stat>
              <Stat label="موقعیت باز (اکنون)">{fa(d.totals.open_jobs)}</Stat>
            </div>
            <Card>
              <CardHeader title="به تفکیک موقعیت شغلی" actions={<ExportMenu filename="recruitment-jobs" title="گزارش استخدام به تفکیک موقعیت" rows={d.jobs} columns={[
                { header: 'موقعیت', value: (r) => r.title }, { header: 'وضعیت', value: (r) => JOB_STATUS[r.status]?.label }, { header: 'درخواست در بازه', value: (r) => r.applications, kind: 'number' },
                { header: 'در جریان', value: (r) => r.in_progress, kind: 'number' }, { header: 'رد در بازه', value: (r) => r.rejected, kind: 'number' }, { header: 'استخدام در بازه', value: (r) => r.hired, kind: 'number' },
                { header: 'میانگین روز تا استخدام', value: (r) => r.days_to_hire, kind: 'number' },
              ]} />} />
              {d.jobs.length === 0 ? <p className="p-5 text-sm text-muted">موقعیتی تعریف نشده است.</p> : (
                <Table>
                  <thead><tr><Th>موقعیت</Th><Th>درخواست در بازه</Th><Th>در جریان (اکنون)</Th><Th>رد در بازه</Th><Th>استخدام در بازه</Th><Th>میانگین روز تا استخدام</Th></tr></thead>
                  <tbody>{d.jobs.map((j) => <tr key={j.id}><Td><Link className="text-primary underline-offset-4 hover:underline" to={`${BASE}/jobs/${j.id}`}>{j.title}</Link></Td><Td>{fa(j.applications)}</Td><Td>{fa(j.in_progress)}</Td><Td>{fa(j.rejected)}</Td><Td>{fa(j.hired)}</Td><Td>{fa(j.days_to_hire)}</Td></tr>)}</tbody>
                </Table>
              )}
            </Card>
            <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
              <Card>
                <CardHeader title="منابع جذب" description="رزومه‌های ثبت‌شده در بازه و استخدام‌های بازه به تفکیک منبع" />
                {d.sources.length === 0 ? <p className="p-5 text-sm text-muted">داده کافی وجود ندارد.</p> : (
                  <Table><thead><tr><Th>منبع</Th><Th>رزومه</Th><Th>استخدام</Th></tr></thead><tbody>{d.sources.map((s) => <tr key={s.source}><Td>{SOURCE[s.source]}</Td><Td>{fa(s.candidates)}</Td><Td>{fa(s.hired)}</Td></tr>)}</tbody></Table>
                )}
              </Card>
              <Card>
                <CardHeader title="دلایل پرتکرار رد" />
                {d.rejections.length === 0 ? <p className="p-5 text-sm text-muted">داده کافی وجود ندارد.</p> : (
                  <Table><thead><tr><Th>دلیل</Th><Th>تعداد</Th></tr></thead><tbody>{d.rejections.map((r) => <tr key={r.reason}><Td>{r.reason}</Td><Td>{fa(r.n)}</Td></tr>)}</tbody></Table>
                )}
              </Card>
            </div>
          </div>
        )}
      </PageState>
    </>
  );
}

// ---------------------------------------------------------------- settings: stages & forms

interface StageRow { id: string | null; name: string; kind: string; archived: boolean }
interface Form { id: string; name: string; criteria: { key: string; label: string; weight: number }[]; archived: boolean }

export function SettingsPage() {
  return (
    <>
      <PageHeader title="تنظیمات قیف استخدام و فرم‌های مصاحبه" />
      <Nav />
      <div className="space-y-6">
        <StagesEditor />
        <FormsEditor />
      </div>
    </>
  );
}

function StagesEditor() {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const q = useQuery({ queryKey: ['recruitment', 'stages'], queryFn: () => a.get<StageRow[]>('/stages') });
  const [list, setList] = useState<StageRow[] | null>(null);
  const rows = list ?? q.data ?? [];
  const save = useMutation({ mutationFn: () => a.put('/stages', { stages: rows }), onSuccess: () => (toast('مراحل قیف ذخیره شد'), setList(null), void qc.invalidateQueries({ queryKey: ['recruitment'] })), onError: err.set });
  const set = (i: number, p: Partial<StageRow>) => setList(rows.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const swap = (i: number, j: number) => { const n = [...rows]; [n[i], n[j]] = [n[j]!, n[i]!]; setList(n); };
  return (
    <Card>
      <CardHeader title="مراحل قیف استخدام" description="ترتیب، نام و نوع مراحل. مرحله استفاده‌شده حذف نمی‌شود؛ بایگانی کنید." />
      <div className="p-5">
        {err.banner}
        <PageState query={q}>
          <ol className="space-y-2">
            {rows.map((s, i) => (
              <li key={s.id ?? `new-${i}`} className="flex flex-wrap items-end gap-2">
                <Field label={`مرحله ${fa(i + 1)}`}><Input value={s.name} onChange={(e) => set(i, { name: e.target.value })} /></Field>
                <Field label="نوع"><Select value={s.kind} onChange={(e) => set(i, { kind: e.target.value })}>{Object.entries(STAGE_KIND).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}</Select></Field>
                <Checkbox label="بایگانی" checked={s.archived} onChange={(e) => set(i, { archived: e.target.checked })} />
                <Button size="sm" variant="ghost" disabled={i === 0} aria-label={`انتقال «${s.name}» به بالا`} onClick={() => swap(i, i - 1)}><ArrowUp className="size-4" /></Button>
                <Button size="sm" variant="ghost" disabled={i === rows.length - 1} aria-label={`انتقال «${s.name}» به پایین`} onClick={() => swap(i, i + 1)}><ArrowDown className="size-4" /></Button>
                {!s.id && <Button size="sm" variant="ghost" aria-label="حذف مرحله جدید" onClick={() => setList(rows.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>}
              </li>
            ))}
          </ol>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={() => setList([...rows, { id: null, name: '', kind: 'open', archived: false }])}><Plus className="size-4" /> مرحله جدید</Button>
            <Button disabled={!list} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ذخیره مراحل</Button>
          </div>
        </PageState>
      </div>
    </Card>
  );
}

function FormsEditor() {
  const a = useApi();
  const q = useQuery({ queryKey: ['recruitment', 'forms'], queryFn: () => a.get<Form[]>('/forms') });
  const [editing, setEditing] = useState<Form | 'new' | null>(null);
  return (
    <Card>
      <CardHeader title="فرم‌های ارزیابی مصاحبه" description="معیارهای مرتبط با شغل و وزن هر کدام" actions={<Button size="sm" onClick={() => setEditing('new')}><Plus className="size-4" /> فرم جدید</Button>} />
      <PageState query={q}>
        <Table>
          <thead><tr><Th>نام فرم</Th><Th>معیارها</Th><Th>وضعیت</Th></tr></thead>
          <tbody>
            {q.data?.map((f) => (
              <tr key={f.id}>
                <Td><button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => setEditing(f)}>{f.name}</button></Td>
                <Td>{f.criteria.map((c) => c.label).join('، ')}</Td>
                <Td>{f.archived ? <Badge>بایگانی</Badge> : <Badge tone="success">فعال</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {editing && <FormDialog form={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function FormDialog({ form, onClose }: { form?: Form; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [name, setName] = useState(form?.name ?? '');
  const [archived, setArchived] = useState(form?.archived ?? false);
  const [criteria, setCriteria] = useState(form?.criteria ?? [{ key: 'c1', label: '', weight: 1 }]);
  const save = useMutation({
    mutationFn: () => (form ? a.put(`/forms/${form.id}`, { name, criteria, archived }) : a.post('/forms', { name, criteria, archived })),
    onSuccess: () => (toast('فرم ذخیره شد'), void qc.invalidateQueries({ queryKey: ['recruitment', 'forms'] }), onClose()),
    onError: err.set,
  });
  const nextKey = () => { let n = criteria.length + 1; while (criteria.some((c) => c.key === `c${n}`)) n++; return `c${n}`; };
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={form ? 'ویرایش فرم ارزیابی' : 'فرم ارزیابی جدید'}
      description={form ? 'تغییر فرم روی ارزیابی‌های ثبت‌شده قبلی اثری ندارد.' : undefined}
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ذخیره</Button></>}>
      {err.banner}
      <div className="space-y-4">
        <Field label="نام فرم" required error={err.fields.name}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <ol className="space-y-2">
          {criteria.map((c, i) => (
            <li key={c.key} className="flex flex-wrap items-end gap-2">
              <Field label={`معیار ${fa(i + 1)}`} className="grow" error={err.fields[`criteria.${i}.label`]}><Input value={c.label} onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></Field>
              <Field label="وزن"><Select value={c.weight} onChange={(e) => setCriteria(criteria.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))}>{Array.from({ length: 10 }, (_, n) => <option key={n} value={n + 1}>{fa(n + 1)}</option>)}</Select></Field>
              <Button variant="ghost" disabled={criteria.length === 1} aria-label={`حذف معیار ${i + 1}`} onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
            </li>
          ))}
        </ol>
        <Button variant="secondary" size="sm" onClick={() => setCriteria([...criteria, { key: nextKey(), label: '', weight: 1 }])}><Plus className="size-4" /> معیار جدید</Button>
        {form && <Checkbox label="بایگانی (برای مصاحبه‌های جدید انتخاب نمی‌شود)" checked={archived} onChange={(e) => setArchived(e.target.checked)} />}
        <Alert tone="info">معیارهای ارزیابی باید به شایستگی‌های شغلی مربوط باشند.</Alert>
      </div>
    </Dialog>
  );
}
