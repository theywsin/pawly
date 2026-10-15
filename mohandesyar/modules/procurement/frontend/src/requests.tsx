import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, DateInput, DayText, Dialog, EmptyState, ExportMenu, Field, Input, MoneyInput, PageHeader, PageState, Select, Table, Tabs, Td, Textarea, Th, toast } from '@mohandesyar/ui';
import { useCan, useDirectory, useMe } from '@mohandesyar/module-sdk/web';
import { todayIso, addDays } from '@mohandesyar/persian';
import { BASE, Nav, num, ProjectSelect, rial, status, STATUS, useApi, useCategories, useProjects, useServerErrors } from './common.js';

interface Req { id: string; number: number; title: string; projects_project_id: string | null; cost_center: string; needed_by: string | null; status: string; requested_by: string; lines: number; estimate: string; order_number: number | null }
interface Budget { bac: string | null; actual: string; committed: string; available: string | null; exceeds: boolean; message: string | null }
interface ReqDetail {
  request: { id: string; number: number; title: string; status: string; requested_by: string; justification: string; needed_by: string | null; projects_project_id: string | null; cost_center: string };
  lines: { id: string; line_no: number; description: string; unit: string; quantity: string; estimated_unit_price: string | null; category_id: string | null; estimate: string }[];
  rfqs: { id: string; number: number; status: string }[];
  orders: { id: string; number: number; status: string }[];
  budget: Budget | null;
}

export function RequestsPage() {
  const a = useApi();
  const dir = useDirectory();
  const canCreate = useCan('procurement.request.create');
  const projects = useProjects();
  const [st, setSt] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['procurement', 'requests', st], queryFn: () => a.get<Req[]>(`/requests${st ? `?status=${st}` : ''}`) });
  const pname = (id: string | null) => (id ? (projects.data?.find((p) => p.id === id)?.title ?? '—') : '—');
  return (
    <>
      <PageHeader
        title="درخواست‌های خرید"
        description="هر درخواست پس از ثبت به کارتابل تأیید می‌رود؛ اگر برای پروژه بودجه مصوب در «مالی» ثبت شده باشد، مانده بودجه با برآورد درخواست مقایسه می‌شود."
        actions={
          <>
            <ExportMenu filename="purchase-requests" title="درخواست‌های خرید" rows={q.data} columns={[
              { header: 'شماره', value: (r) => r.number, kind: 'number' }, { header: 'عنوان', value: (r) => r.title }, { header: 'پروژه', value: (r) => pname(r.projects_project_id) },
              { header: 'برآورد (ریال)', value: (r) => r.estimate, kind: 'number' }, { header: 'نیاز تا', value: (r) => r.needed_by }, { header: 'وضعیت', value: (r) => status(r.status).label },
              { header: 'درخواست‌دهنده', value: (r) => dir.name(r.requested_by) },
            ]} />
            {canCreate && <Button onClick={() => setCreating(true)}><Plus className="size-4" /> درخواست خرید</Button>}
          </>
        }
      />
      <Nav />
      <Tabs label="وضعیت" value={st} onChange={setSt} items={[{ key: '', label: 'همه' }, ...['pending', 'approved', 'rejected', 'cancelled', 'closed'].map((k) => ({ key: k, label: STATUS[k]!.label }))]} />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<ClipboardList className="size-8" />} title="درخواست خریدی وجود ندارد" />}>
        <Table>
          <thead><tr><Th>شماره</Th><Th>عنوان</Th><Th>پروژه</Th><Th>برآورد (ریال)</Th><Th>نیاز تا</Th><Th>وضعیت</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
          <tbody>
            {q.data?.map((r) => (
              <tr key={r.id}>
                <Td className="tabular-nums">PR-{num(r.number)}</Td>
                <Td>{r.title}<div className="text-xs text-muted">{num(r.lines)} ردیف · {dir.name(r.requested_by)}</div></Td>
                <Td>{pname(r.projects_project_id)}</Td>
                <Td className="tabular-nums">{rial(r.estimate)}</Td>
                <Td>{r.needed_by ? <DayText value={r.needed_by} /> : '—'}</Td>
                <Td><Badge tone={status(r.status).tone}>{status(r.status).label}</Badge>{r.order_number && <div className="text-xs text-muted">سفارش PO-{num(r.order_number)}</div>}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => setOpen(r.id)}>جزئیات</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {creating && <RequestDialog onClose={(id) => (setCreating(false), id && setOpen(id))} />}
      {open && <RequestDetail id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

const emptyLine = () => ({ description: '', unit: 'عدد', quantity: '', estimatedUnitPrice: '', categoryId: '' });

function RequestDialog({ onClose }: { onClose: (id?: string) => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const cats = useCategories();
  const companyScope = useCan('procurement.order.manage');
  const [v, setV] = useState({ title: '', projectId: '', costCenter: '', justification: '' });
  const [needed, setNeeded] = useState<string | null>(null);
  const [lines, setLines] = useState([emptyLine()]);
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const setLine = (i: number, k: keyof ReturnType<typeof emptyLine>, x: string) => setLines((s) => s.map((l, j) => (j === i ? { ...l, [k]: x } : l)));
  const save = useMutation({
    mutationFn: () =>
      a.post<{ id: string; number: number; budget: Budget | null }>('/requests', {
        ...v, projectId: v.projectId || null, neededBy: needed,
        lines: lines.map((l) => ({ ...l, estimatedUnitPrice: l.estimatedUnitPrice || null, categoryId: l.categoryId || null })),
      }),
    onSuccess: (r) => {
      toast(`درخواست PR-${num(r.number)} ثبت و برای تأیید ارسال شد`);
      if (r.budget?.message) toast(r.budget.message);
      void qc.invalidateQueries({ queryKey: ['procurement'] });
      onClose(r.id);
    },
    onError: err.set,
  });
  const f = err.fields;
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="درخواست خرید" footer={<><Button variant="ghost" onClick={() => onClose()}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ارسال برای تأیید</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="عنوان" required error={f.title} className="sm:col-span-2"><Input value={v.title} onChange={(e) => set('title')(e.target.value)} /></Field>
        <ProjectSelect value={v.projectId} onChange={set('projectId')} required={!companyScope} error={f.projectId} />
        <Field label="مرکز هزینه"><Input value={v.costCenter} onChange={(e) => set('costCenter')(e.target.value)} /></Field>
        <Field label="تاریخ نیاز" error={f.neededBy}><DateInput value={needed} onChange={setNeeded} /></Field>
        <Field label="توجیه نیاز" className="sm:col-span-2"><Textarea value={v.justification} onChange={(e) => set('justification')(e.target.value)} /></Field>
      </div>
      <h3 className="mb-2 mt-6 font-semibold">ردیف‌ها</h3>
      <div className="space-y-3">
        {lines.map((l, i) => (
          <fieldset key={i} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-6">
            <legend className="px-1 text-xs text-muted">ردیف {num(i + 1)}</legend>
            <Field label="شرح کالا/خدمت" required error={f[`lines.${i}.description`]} className="sm:col-span-2"><Input value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} /></Field>
            <Field label="مقدار" required error={f[`lines.${i}.quantity`]}><Input inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} /></Field>
            <Field label="واحد" required><Input value={l.unit} onChange={(e) => setLine(i, 'unit', e.target.value)} /></Field>
            <Field label="قیمت واحد برآوردی (ریال)"><MoneyInput value={l.estimatedUnitPrice} onChange={(x) => setLine(i, 'estimatedUnitPrice', x)} /></Field>
            <div className="flex items-end gap-2">
              <Field label="دسته" className="flex-1">
                <Select value={l.categoryId} onChange={(e) => setLine(i, 'categoryId', e.target.value)}><option value="">—</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
              </Field>
              {lines.length > 1 && <Button size="sm" variant="ghost" aria-label={`حذف ردیف ${num(i + 1)}`} onClick={() => setLines((s) => s.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>}
            </div>
          </fieldset>
        ))}
      </div>
      <Button className="mt-3" size="sm" variant="secondary" onClick={() => setLines((s) => [...s, emptyLine()])}><Plus className="size-4" /> ردیف</Button>
    </Dialog>
  );
}

function RequestDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const me = useMe();
  const nav = useNavigate();
  const canOrder = useCan('procurement.order.manage');
  const err = useServerErrors();
  const [due, setDue] = useState<string | null>(addDays(todayIso(), 7));
  const q = useQuery({ queryKey: ['procurement', 'request', id], queryFn: () => a.get<ReqDetail>(`/requests/${id}`) });
  const done = (msg: string) => (toast(msg), void qc.invalidateQueries({ queryKey: ['procurement'] }));
  const cancel = useMutation({ mutationFn: () => a.post(`/requests/${id}/cancel`), onSuccess: () => (done('درخواست لغو شد'), onClose()), onError: err.set });
  const rfq = useMutation({ mutationFn: () => a.post<{ id: string }>('/rfqs', { requestId: id, dueOn: due }), onSuccess: (r) => (done('استعلام ایجاد شد'), nav(`${BASE}/rfqs/${r.id}`)), onError: err.set });
  const d = q.data;
  const r = d?.request;
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={r ? `درخواست PR-${num(r.number)}: ${r.title}` : 'درخواست خرید'} footer={<Button variant="ghost" onClick={onClose}>بستن</Button>}>
      {err.banner}
      <PageState query={q}>
        {d && r && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={status(r.status).tone}>{status(r.status).label}</Badge>
              {r.status === 'pending' && <Link className="text-primary underline" to="/app/approvals">کارتابل تأیید</Link>}
              {r.needed_by && <span>نیاز تا <DayText value={r.needed_by} /></span>}
              {r.cost_center && <span>مرکز هزینه: {r.cost_center}</span>}
            </div>
            {r.justification && <p className="text-sm">{r.justification}</p>}
            {d.budget && (
              <Alert tone={d.budget.exceeds ? 'warning' : 'info'}>
                {d.budget.bac === null ? d.budget.message : (
                  <>بودجه مصوب {rial(d.budget.bac)} · هزینه واقعی {rial(d.budget.actual)} · تعهد باز {rial(d.budget.committed)} · مانده {rial(d.budget.available)} ریال{d.budget.message && <div className="mt-1 font-medium">{d.budget.message}</div>}</>
                )}
              </Alert>
            )}
            <Table>
              <thead><tr><Th>ردیف</Th><Th>شرح</Th><Th>مقدار</Th><Th>قیمت برآوردی</Th><Th>برآورد (ریال)</Th></tr></thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.id}><Td className="tabular-nums">{num(l.line_no)}</Td><Td>{l.description}</Td><Td className="tabular-nums">{num(l.quantity)} {l.unit}</Td><Td className="tabular-nums">{rial(l.estimated_unit_price)}</Td><Td className="tabular-nums">{rial(l.estimate)}</Td></tr>
                ))}
              </tbody>
            </Table>
            {(d.rfqs.length > 0 || d.orders.length > 0) && (
              <p className="text-sm">
                {d.rfqs.map((x) => <Link key={x.id} className="me-3 text-primary underline" to={`${BASE}/rfqs/${x.id}`}>استعلام RFQ-{num(x.number)} ({status(x.status).label})</Link>)}
                {d.orders.map((x) => <Link key={x.id} className="me-3 text-primary underline" to={`${BASE}/orders/${x.id}`}>سفارش PO-{num(x.number)} ({status(x.status).label})</Link>)}
              </p>
            )}
            <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
              {canOrder && r.status === 'approved' && (
                <>
                  <Field label="مهلت دریافت پیشنهاد"><DateInput value={due} onChange={setDue} /></Field>
                  <Button disabled={!due} loading={rfq.isPending} onClick={() => (err.clear(), rfq.mutate())}>ایجاد استعلام قیمت</Button>
                </>
              )}
              {(r.status === 'pending' || r.status === 'approved') && (r.requested_by === me.user.id || canOrder) && <Button variant="ghost" loading={cancel.isPending} onClick={() => (err.clear(), cancel.mutate())}>لغو درخواست</Button>}
            </div>
          </div>
        )}
      </PageState>
    </Dialog>
  );
}
