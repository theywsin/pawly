import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldAlert } from 'lucide-react';
import { Badge, Button, Checkbox, DateInput, DayText, DescriptionList, Dialog, EmptyState, ExportMenu, Field, Input, PageHeader, PageState, Select, Table, Tabs, Td, Textarea, Th, toast } from '@mohandesyar/ui';
import { useCan, useDirectory } from '@mohandesyar/module-sdk/web';
import { todayIso } from '@mohandesyar/persian';
import { ActionDialog, ActionsTable, type Action } from './actions.js';
import { BASE, INCIDENT_STATUS, KIND, Nav, num, ProjectSelect, SEVERITY, useApi, useProjectName, useServerErrors } from './common.js';

interface Incident { id: string; number: number; kind: string; severity: string; occurred_on: string; occurred_time: string; projects_project_id: string | null; location: string; title: string; injured_count: number; lost_days: number; fatality: boolean; status: string; reported_by: string; open_actions: number }

export function IncidentsPage() {
  const a = useApi();
  const dir = useDirectory();
  const project = useProjectName();
  const [status, setStatus] = useState('');
  const [reporting, setReporting] = useState(false);
  const q = useQuery({ queryKey: ['qhse', 'incidents', status], queryFn: () => a.get<Incident[]>(`/incidents${status ? `?status=${status}` : ''}`) });
  return (
    <>
      <PageHeader
        title="حوادث و شبه‌حوادث"
        description="هر کس در کارگاه می‌تواند حادثه، شبه‌حادثه یا شرایط ناایمن را گزارش کند. موارد با شدت زیاد یا بحرانی فوراً برای گیرندگان تعیین‌شده اعلان و ایمیل می‌شوند."
        actions={
          <>
            <ExportMenu filename="incidents" title="حوادث" rows={q.data} columns={[
              { header: 'شماره', value: (i) => i.number, kind: 'number' }, { header: 'نوع', value: (i) => KIND[i.kind] }, { header: 'شدت', value: (i) => SEVERITY[i.severity]?.label },
              { header: 'تاریخ', value: (i) => i.occurred_on }, { header: 'پروژه', value: (i) => project(i.projects_project_id) }, { header: 'محل', value: (i) => i.location }, { header: 'عنوان', value: (i) => i.title },
              { header: 'مصدوم', value: (i) => i.injured_count, kind: 'number' }, { header: 'روز از دست رفته', value: (i) => i.lost_days, kind: 'number' }, { header: 'وضعیت', value: (i) => INCIDENT_STATUS[i.status]?.label },
            ]} />
            <Button onClick={() => setReporting(true)}><Plus className="size-4" /> گزارش حادثه</Button>
          </>
        }
      />
      <Nav />
      <Tabs label="وضعیت" value={status} onChange={setStatus} items={[{ key: '', label: 'همه' }, ...Object.entries(INCIDENT_STATUS).map(([k, s]) => ({ key: k, label: s.label }))]} />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<ShieldAlert className="size-8" />} title="حادثه‌ای گزارش نشده است" />}>
        <Table>
          <thead><tr><Th>شماره</Th><Th>عنوان</Th><Th>نوع / شدت</Th><Th>تاریخ</Th><Th>پروژه</Th><Th>پیامد</Th><Th>وضعیت</Th></tr></thead>
          <tbody>
            {q.data?.map((i) => (
              <tr key={i.id}>
                <Td className="tabular-nums"><Link className="text-primary underline" to={`${BASE}/incidents/${i.id}`}>{num(i.number)}</Link></Td>
                <Td>{i.title}<div className="text-xs text-muted">{i.location} · گزارش: {dir.name(i.reported_by)}</div></Td>
                <Td>{KIND[i.kind]}<div><Badge tone={SEVERITY[i.severity]!.tone}>{SEVERITY[i.severity]!.label}</Badge></div></Td>
                <Td><DayText value={i.occurred_on} />{i.occurred_time && <div className="text-xs text-muted">{i.occurred_time}</div>}</Td>
                <Td>{project(i.projects_project_id)}</Td>
                <Td className="text-xs">{i.fatality ? <Badge tone="danger">فوت</Badge> : i.injured_count ? `${num(i.injured_count)} مصدوم، ${num(i.lost_days)} روز` : '—'}</Td>
                <Td><Badge tone={INCIDENT_STATUS[i.status]!.tone}>{INCIDENT_STATUS[i.status]!.label}</Badge>{i.open_actions > 0 && <div className="text-xs text-muted">{num(i.open_actions)} اقدام باز</div>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {reporting && <ReportDialog onClose={() => setReporting(false)} />}
    </>
  );
}

function ReportDialog({ onClose }: { onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const nav = useNavigate();
  const err = useServerErrors();
  const companyScope = useCan('qhse.admin');
  const [v, setV] = useState({ kind: 'near_miss', severity: 'low', occurredTime: '', projectId: '', location: '', title: '', description: '', injuredCount: '0', lostDays: '0', immediateAction: '' });
  const [on, setOn] = useState<string | null>(todayIso());
  const [fatality, setFatality] = useState(false);
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const save = useMutation({
    mutationFn: () => a.post<{ id: string; number: number; notified: number }>('/incidents', {
      ...v, occurredOn: on, projectId: v.projectId || null, injuredCount: Number(v.injuredCount) || 0, lostDays: Number(v.lostDays) || 0, fatality,
    }),
    onSuccess: (r) => {
      toast(`گزارش ${num(r.number)} ثبت شد${r.notified ? ` و برای ${num(r.notified)} نفر اعلان فوری فرستاده شد` : ''}`);
      void qc.invalidateQueries({ queryKey: ['qhse'] });
      nav(`${BASE}/incidents/${r.id}`);
    },
    onError: err.set,
  });
  const f = err.fields;
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="گزارش حادثه" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!on} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت گزارش</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نوع"><Select value={v.kind} onChange={(e) => set('kind')(e.target.value)}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="شدت"><Select value={v.severity} onChange={(e) => set('severity')(e.target.value)}>{Object.entries(SEVERITY).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</Select></Field>
        <Field label="عنوان" required error={f.title} className="sm:col-span-2"><Input value={v.title} onChange={(e) => set('title')(e.target.value)} /></Field>
        <Field label="تاریخ وقوع" required><DateInput value={on} onChange={setOn} /></Field>
        <Field label="ساعت (مثل ۱۴:۳۰)" error={f.occurredTime}><Input dir="ltr" value={v.occurredTime} onChange={(e) => set('occurredTime')(e.target.value)} /></Field>
        <ProjectSelect value={v.projectId} onChange={set('projectId')} required={!companyScope} error={f.projectId} />
        <Field label="محل دقیق"><Input value={v.location} onChange={(e) => set('location')(e.target.value)} /></Field>
        {v.kind === 'injury' && (
          <>
            <Field label="تعداد مصدوم"><Input inputMode="numeric" value={v.injuredCount} onChange={(e) => set('injuredCount')(e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label="روز کاری از دست رفته"><Input inputMode="numeric" value={v.lostDays} onChange={(e) => set('lostDays')(e.target.value.replace(/\D/g, ''))} /></Field>
            <Checkbox label="فوت (شدت بحرانی ثبت می‌شود)" checked={fatality} onChange={(e) => setFatality(e.target.checked)} />
          </>
        )}
        <Field label="شرح" className="sm:col-span-2"><Textarea value={v.description} onChange={(e) => set('description')(e.target.value)} /></Field>
        <Field label="اقدام فوری انجام‌شده" className="sm:col-span-2"><Textarea value={v.immediateAction} onChange={(e) => set('immediateAction')(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

interface IncidentDetail {
  incident: Incident & { description: string; immediate_action: string; root_cause: string; reported_at: string; closed_by: string | null };
  actions: Action[];
  ncrs: { id: string; number: number; title: string; status: string }[];
  canManage: boolean;
}

export function IncidentPage() {
  const { id = '' } = useParams();
  const a = useApi();
  const dir = useDirectory();
  const project = useProjectName();
  const [dialog, setDialog] = useState<'investigate' | 'action' | null>(null);
  const q = useQuery({ queryKey: ['qhse', 'incident', id], queryFn: () => a.get<IncidentDetail>(`/incidents/${id}`) });
  const d = q.data;
  const i = d?.incident;
  return (
    <>
      <PageHeader
        title={i ? `حادثه ${num(i.number)} — ${i.title}` : 'حادثه'}
        description={i && <span className="flex flex-wrap gap-2"><Badge tone={SEVERITY[i.severity]!.tone}>شدت {SEVERITY[i.severity]!.label}</Badge><Badge tone={INCIDENT_STATUS[i.status]!.tone}>{INCIDENT_STATUS[i.status]!.label}</Badge></span>}
        actions={d?.canManage && i?.status !== 'closed' && (
          <>
            <Button onClick={() => setDialog('investigate')}>بررسی و بستن</Button>
            <Button variant="secondary" onClick={() => setDialog('action')}>اقدام اصلاحی</Button>
          </>
        )}
      />
      <Nav />
      <PageState query={q}>
        {d && i && (
          <div className="space-y-6">
            <DescriptionList items={[
              { label: 'نوع', value: KIND[i.kind] },
              { label: 'زمان وقوع', value: <><DayText value={i.occurred_on} /> {i.occurred_time}</> },
              { label: 'پروژه', value: project(i.projects_project_id) },
              { label: 'محل', value: i.location || '—' },
              { label: 'مصدوم / روز از دست رفته', value: `${num(i.injured_count)} / ${num(i.lost_days)}${i.fatality ? ' — فوت' : ''}` },
              { label: 'گزارش‌دهنده', value: dir.name(i.reported_by) },
            ]} />
            {i.description && <section><h2 className="mb-1 font-semibold">شرح</h2><p className="whitespace-pre-line text-sm">{i.description}</p></section>}
            {i.immediate_action && <section><h2 className="mb-1 font-semibold">اقدام فوری</h2><p className="whitespace-pre-line text-sm">{i.immediate_action}</p></section>}
            {i.root_cause && <section><h2 className="mb-1 font-semibold">علت ریشه‌ای</h2><p className="whitespace-pre-line text-sm">{i.root_cause}</p></section>}
            <section>
              <h2 className="mb-2 font-semibold">اقدامات</h2>
              {d.actions.length === 0 ? <p className="text-sm text-muted">اقدامی تعریف نشده است.</p> : <ActionsTable actions={d.actions} />}
            </section>
            {d.ncrs.length > 0 && (
              <section>
                <h2 className="mb-2 font-semibold">عدم انطباق‌ها</h2>
                <ul className="text-sm">{d.ncrs.map((n) => <li key={n.id}><Link className="text-primary underline" to={`${BASE}/ncrs/${n.id}`}>NCR-{num(n.number)} {n.title}</Link></li>)}</ul>
              </section>
            )}
          </div>
        )}
      </PageState>
      {dialog === 'investigate' && i && <InvestigateDialog id={id} rootCause={i.root_cause} lostDays={i.lost_days} onClose={() => setDialog(null)} />}
      {dialog === 'action' && <ActionDialog incidentId={id} onClose={() => setDialog(null)} />}
    </>
  );
}

function InvestigateDialog({ id, rootCause, lostDays, onClose }: { id: string; rootCause: string; lostDays: number; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [status, setStatus] = useState('investigating');
  const [cause, setCause] = useState(rootCause);
  const [days, setDays] = useState(String(lostDays));
  const save = useMutation({
    mutationFn: () => a.post(`/incidents/${id}/investigation`, { status, rootCause: cause, lostDays: Number(days) || 0 }),
    onSuccess: () => (toast(status === 'closed' ? 'حادثه بسته شد' : 'بررسی ثبت شد'), void qc.invalidateQueries({ queryKey: ['qhse'] }), onClose()),
    onError: err.set,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="بررسی حادثه" description="حادثه فقط با علت ریشه‌ای و پس از انجام همه اقدامات آن بسته می‌شود." footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ذخیره</Button></>}>
      {err.banner}
      <div className="grid gap-4">
        <Field label="وضعیت"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="investigating">در حال بررسی</option><option value="closed">بستن</option></Select></Field>
        <Field label="علت ریشه‌ای" error={err.fields.rootCause}><Textarea value={cause} onChange={(e) => setCause(e.target.value)} /></Field>
        <Field label="روز کاری از دست رفته (نهایی)"><Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} /></Field>
      </div>
    </Dialog>
  );
}
