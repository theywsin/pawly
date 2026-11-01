import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, FileWarning, Plus } from 'lucide-react';
import { Badge, Button, Checkbox, DateInput, DayText, DescriptionList, Dialog, EmptyState, ExportMenu, Field, Input, PageHeader, PageState, Select, Table, Td, Textarea, Th, toast } from '@mohandesyar/ui';
import { useCan, useDirectory } from '@mohandesyar/module-sdk/web';
import { todayIso } from '@mohandesyar/persian';
import { ActionDialog, ActionsTable, type Action } from './actions.js';
import { AREA, BASE, Nav, num, ProjectSelect, useApi, useProjectName, useServerErrors } from './common.js';

const NCR_SEVERITY: Record<string, string> = { minor: 'جزئی', major: 'عمده', critical: 'بحرانی' };
const SOURCE: Record<string, string> = { inspection: 'بازرسی', incident: 'حادثه', audit: 'ممیزی', customer: 'کارفرما/مشتری', other: 'سایر' };
interface Ncr { id: string; number: number; source: string; projects_project_id: string | null; area: string; title: string; severity: string; status: string; raised_by: string; raised_on: string; actions: number; verified: number }

export function NcrsPage() {
  const a = useApi();
  const project = useProjectName();
  const canManage = useCan('qhse.manage');
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['qhse', 'ncrs'], queryFn: () => a.get<Ncr[]>('/ncrs') });
  return (
    <>
      <PageHeader
        title="عدم انطباق‌ها"
        description="هر عدم انطباق فقط وقتی بسته می‌شود که دست‌کم یک اقدام اصلاحی داشته باشد و اثربخشی همه اقدامات آن تأیید شده باشد."
        actions={
          <>
            <ExportMenu filename="ncrs" title="عدم انطباق‌ها" rows={q.data} columns={[
              { header: 'شماره', value: (n) => n.number, kind: 'number' }, { header: 'عنوان', value: (n) => n.title }, { header: 'حوزه', value: (n) => AREA[n.area] }, { header: 'منبع', value: (n) => SOURCE[n.source] },
              { header: 'شدت', value: (n) => NCR_SEVERITY[n.severity] }, { header: 'پروژه', value: (n) => project(n.projects_project_id) }, { header: 'تاریخ', value: (n) => n.raised_on }, { header: 'وضعیت', value: (n) => (n.status === 'open' ? 'باز' : 'بسته') },
            ]} />
            {canManage && <Button onClick={() => setCreating(true)}><Plus className="size-4" /> عدم انطباق</Button>}
          </>
        }
      />
      <Nav />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<FileWarning className="size-8" />} title="عدم انطباقی ثبت نشده است" />}>
        <Table>
          <thead><tr><Th>شماره</Th><Th>عنوان</Th><Th>حوزه / منبع</Th><Th>شدت</Th><Th>پروژه</Th><Th>اقدامات</Th><Th>وضعیت</Th></tr></thead>
          <tbody>
            {q.data?.map((n) => (
              <tr key={n.id}>
                <Td className="whitespace-nowrap"><Link className="text-primary underline" to={`${BASE}/ncrs/${n.id}`}>NCR-{num(n.number)}</Link></Td>
                <Td>{n.title}<div className="text-xs text-muted"><DayText value={n.raised_on} /></div></Td>
                <Td>{AREA[n.area]}<div className="text-xs text-muted">{SOURCE[n.source]}</div></Td>
                <Td>{NCR_SEVERITY[n.severity]}</Td>
                <Td>{project(n.projects_project_id)}</Td>
                <Td className="tabular-nums">{num(n.verified)} از {num(n.actions)} تأییدشده</Td>
                <Td><Badge tone={n.status === 'open' ? 'warning' : 'success'}>{n.status === 'open' ? 'باز' : 'بسته'}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {creating && <NcrDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function NcrDialog({ onClose }: { onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const nav = useNavigate();
  const err = useServerErrors();
  const companyScope = useCan('qhse.admin');
  const [v, setV] = useState({ source: 'audit', projectId: '', area: 'quality', title: '', description: '', severity: 'minor' });
  const [on, setOn] = useState<string | null>(todayIso());
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const save = useMutation({
    mutationFn: () => a.post<{ id: string }>('/ncrs', { ...v, projectId: v.projectId || null, raisedOn: on }),
    onSuccess: (r) => (toast('عدم انطباق ثبت شد'), void qc.invalidateQueries({ queryKey: ['qhse'] }), nav(`${BASE}/ncrs/${r.id}`)),
    onError: err.set,
  });
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="عدم انطباق جدید" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!on} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="عنوان" required error={err.fields.title} className="sm:col-span-2"><Input value={v.title} onChange={(e) => set('title')(e.target.value)} /></Field>
        <Field label="منبع"><Select value={v.source} onChange={(e) => set('source')(e.target.value)}>{['audit', 'customer', 'other'].map((k) => <option key={k} value={k}>{SOURCE[k]}</option>)}</Select></Field>
        <Field label="حوزه"><Select value={v.area} onChange={(e) => set('area')(e.target.value)}>{Object.entries(AREA).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="شدت"><Select value={v.severity} onChange={(e) => set('severity')(e.target.value)}>{Object.entries(NCR_SEVERITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="تاریخ" required><DateInput value={on} onChange={setOn} /></Field>
        <ProjectSelect value={v.projectId} onChange={set('projectId')} required={!companyScope} error={err.fields.projectId} />
        <Field label="شرح" className="sm:col-span-2"><Textarea value={v.description} onChange={(e) => set('description')(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

export function NcrPage() {
  const { id = '' } = useParams();
  const a = useApi();
  const qc = useQueryClient();
  const dir = useDirectory();
  const project = useProjectName();
  const canManage = useCan('qhse.manage');
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['qhse', 'ncr', id], queryFn: () => a.get<{ ncr: Ncr & { description: string }; actions: Action[] }>(`/ncrs/${id}`) });
  const close = useMutation({ mutationFn: () => a.post(`/ncrs/${id}/close`), onSuccess: () => (toast('عدم انطباق بسته شد'), void qc.invalidateQueries({ queryKey: ['qhse'] })), onError: (e) => toast(e instanceof Error ? e.message : 'انجام نشد', 'danger') });
  const n = q.data?.ncr;
  return (
    <>
      <PageHeader
        title={n ? `NCR-${num(n.number)} — ${n.title}` : 'عدم انطباق'}
        description={n && <Badge tone={n.status === 'open' ? 'warning' : 'success'}>{n.status === 'open' ? 'باز' : 'بسته'}</Badge>}
        actions={canManage && n?.status === 'open' && (
          <>
            <Button onClick={() => setAdding(true)}>اقدام اصلاحی</Button>
            <Button variant="secondary" loading={close.isPending} onClick={() => close.mutate()}>بستن</Button>
          </>
        )}
      />
      <Nav />
      <PageState query={q}>
        {q.data && n && (
          <div className="space-y-6">
            <DescriptionList items={[
              { label: 'منبع', value: SOURCE[n.source] }, { label: 'حوزه', value: AREA[n.area] }, { label: 'شدت', value: NCR_SEVERITY[n.severity] },
              { label: 'پروژه', value: project(n.projects_project_id) }, { label: 'ثبت', value: <>{dir.name(n.raised_by)} — <DayText value={n.raised_on} /></> },
            ]} />
            {n.description && <p className="whitespace-pre-line text-sm">{n.description}</p>}
            <section>
              <h2 className="mb-2 font-semibold">اقدامات</h2>
              {q.data.actions.length === 0 ? <p className="text-sm text-muted">اقدامی تعریف نشده است.</p> : <ActionsTable actions={q.data.actions} />}
            </section>
          </div>
        )}
      </PageState>
      {adding && <ActionDialog ncrId={id} onClose={() => setAdding(false)} />}
    </>
  );
}

// ---------------------------------------------------------------- inspections

interface Checklist { id: string; name: string; area: string; items: { text: string }[]; archived: boolean }
interface Inspection { id: string; checklist_name: string; projects_project_id: string | null; inspected_on: string; location: string; inspector_id: string; ok_count: number; nok_count: number; score: number | null; ncr_id: string | null }

export function InspectionsPage() {
  const a = useApi();
  const dir = useDirectory();
  const project = useProjectName();
  const canManage = useCan('qhse.manage');
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['qhse', 'inspections'], queryFn: () => a.get<Inspection[]>('/inspections') });
  return (
    <>
      <PageHeader
        title="بازرسی‌ها"
        description="بازرسی با چک‌لیست؛ امتیاز = درصد بندهای منطبق از بندهای قابل اعمال. برای بندهای نامنطبق می‌توان یک عدم انطباق ثبت کرد."
        actions={
          <>
            <ExportMenu filename="inspections" title="بازرسی‌ها" rows={q.data} columns={[
              { header: 'چک‌لیست', value: (x) => x.checklist_name }, { header: 'تاریخ', value: (x) => x.inspected_on }, { header: 'پروژه', value: (x) => project(x.projects_project_id) },
              { header: 'محل', value: (x) => x.location }, { header: 'بازرس', value: (x) => dir.name(x.inspector_id) }, { header: 'امتیاز', value: (x) => x.score, kind: 'number' },
            ]} />
            {canManage && <Button onClick={() => setCreating(true)}><Plus className="size-4" /> بازرسی جدید</Button>}
          </>
        }
      />
      <Nav />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<ClipboardCheck className="size-8" />} title="بازرسی ثبت نشده است" />}>
        <Table>
          <thead><tr><Th>چک‌لیست</Th><Th>تاریخ</Th><Th>پروژه / محل</Th><Th>بازرس</Th><Th>نتیجه</Th><Th>امتیاز</Th></tr></thead>
          <tbody>
            {q.data?.map((x) => (
              <tr key={x.id}>
                <Td>{x.checklist_name}</Td><Td><DayText value={x.inspected_on} /></Td><Td>{project(x.projects_project_id)}<div className="text-xs text-muted">{x.location}</div></Td>
                <Td>{dir.name(x.inspector_id)}</Td>
                <Td className="text-xs">{num(x.ok_count)} منطبق، {num(x.nok_count)} نامنطبق{x.ncr_id && <div><Link className="text-primary underline" to={`${BASE}/ncrs/${x.ncr_id}`}>عدم انطباق</Link></div>}</Td>
                <Td className="tabular-nums">{x.score === null ? '—' : `${num(x.score)}٪`}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {creating && <InspectionDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function InspectionDialog({ onClose }: { onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const companyScope = useCan('qhse.admin');
  const lists = useQuery({ queryKey: ['qhse', 'checklists'], queryFn: () => a.get<Checklist[]>('/checklists') });
  const [checklistId, setChecklistId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [location, setLocation] = useState('');
  const [on, setOn] = useState<string | null>(todayIso());
  const [results, setResults] = useState<Record<number, { result: string; note: string }>>({});
  const [raiseNcr, setRaiseNcr] = useState(true);
  const c = lists.data?.find((x) => x.id === checklistId);
  const anyNok = Object.values(results).some((r) => r.result === 'nok');
  const save = useMutation({
    mutationFn: () => a.post<{ score: number | null; ncrId: string | null }>('/inspections', {
      checklistId, projectId: projectId || null, location, inspectedOn: on, raiseNcr: raiseNcr && anyNok,
      results: (c?.items ?? []).map((_it, i) => ({ result: results[i]?.result ?? 'ok', note: results[i]?.note ?? '' })),
    }),
    onSuccess: (r) => (toast(`بازرسی ثبت شد${r.score === null ? '' : ` — امتیاز ${num(r.score)}٪`}${r.ncrId ? ' و عدم انطباق ایجاد شد' : ''}`), void qc.invalidateQueries({ queryKey: ['qhse'] }), onClose()),
    onError: err.set,
  });
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="بازرسی جدید" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!c || !on} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="چک‌لیست" required><Select value={checklistId} onChange={(e) => (setChecklistId(e.target.value), setResults({}))}><option value="">انتخاب کنید</option>{(lists.data ?? []).filter((x) => !x.archived).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
        <Field label="تاریخ" required><DateInput value={on} onChange={setOn} /></Field>
        <ProjectSelect value={projectId} onChange={setProjectId} required={!companyScope} error={err.fields.projectId} />
        <Field label="محل"><Input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
      </div>
      {c && (
        <ol className="mt-4 space-y-3">
          {c.items.map((it, i) => (
            <li key={i} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_9rem_1fr] sm:items-end">
              <span className="text-sm">{num(i + 1)}. {it.text}</span>
              <Field label="نتیجه"><Select value={results[i]?.result ?? 'ok'} onChange={(e) => setResults((s) => ({ ...s, [i]: { result: e.target.value, note: s[i]?.note ?? '' } }))}><option value="ok">منطبق</option><option value="nok">نامنطبق</option><option value="na">غیرقابل اعمال</option></Select></Field>
              <Field label="توضیح"><Input value={results[i]?.note ?? ''} onChange={(e) => setResults((s) => ({ ...s, [i]: { result: s[i]?.result ?? 'ok', note: e.target.value } }))} /></Field>
            </li>
          ))}
        </ol>
      )}
      {anyNok && <div className="mt-3"><Checkbox label="برای بندهای نامنطبق یک عدم انطباق ثبت شود" checked={raiseNcr} onChange={(e) => setRaiseNcr(e.target.checked)} /></div>}
      {lists.data?.length === 0 && <p className="mt-3 text-sm text-muted">چک‌لیستی تعریف نشده است؛ مدیر HSE آن را در «تنظیمات» می‌سازد.</p>}
    </Dialog>
  );
}
