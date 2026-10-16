import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, HardHat, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { Badge, Button, Card, CardHeader, DateInput, DayText, Dialog, EmptyState, ExportMenu, Field, Input, PageHeader, PageState, Select, Stat, Table, Td, Textarea, Th, toast } from '@mohandesyar/ui';
import { useCan, useDirectory } from '@mohandesyar/module-sdk/web';
import { addDays, todayIso } from '@mohandesyar/persian';
import { AREA, BAND, KIND, Nav, num, ProjectSelect, SEVERITY, useApi, useProjectName, useServerErrors } from './common.js';

// ---------------------------------------------------------------- risks

interface Risk { id: string; projects_project_id: string | null; activity: string; hazard: string; consequence: string; likelihood: number; severity: number; controls: string; residual_likelihood: number | null; residual_severity: number | null; owner_id: string | null; review_on: string | null; status: string; rating: { score: number; band: string }; residual: { score: number; band: string } | null }
const RISK_STATUS: Record<string, string> = { open: 'باز', controlled: 'کنترل‌شده', closed: 'بسته' };

export function RisksPage() {
  const a = useApi();
  const dir = useDirectory();
  const project = useProjectName();
  const canManage = useCan('qhse.manage');
  const [editing, setEditing] = useState<Risk | 'new' | null>(null);
  const q = useQuery({ queryKey: ['qhse', 'risks'], queryFn: () => a.get<Risk[]>('/risks') });
  return (
    <>
      <PageHeader
        title="ریسک‌های ایمنی"
        description="امتیاز ریسک = احتمال × شدت (۱ تا ۲۵): ۱۵ و بالاتر زیاد، ۸ تا ۱۴ متوسط. ریسک باقی‌مانده پس از اعمال کنترل‌ها ثبت می‌شود."
        actions={
          <>
            <ExportMenu filename="risks" title="ریسک‌ها" rows={q.data} columns={[
              { header: 'پروژه', value: (r) => project(r.projects_project_id) }, { header: 'فعالیت', value: (r) => r.activity }, { header: 'خطر', value: (r) => r.hazard },
              { header: 'امتیاز', value: (r) => r.rating.score, kind: 'number' }, { header: 'کنترل‌ها', value: (r) => r.controls }, { header: 'امتیاز باقی‌مانده', value: (r) => r.residual?.score, kind: 'number' },
              { header: 'مسئول', value: (r) => dir.name(r.owner_id) }, { header: 'وضعیت', value: (r) => RISK_STATUS[r.status] },
            ]} />
            {canManage && <Button onClick={() => setEditing('new')}><Plus className="size-4" /> ریسک</Button>}
          </>
        }
      />
      <Nav />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<TriangleAlert className="size-8" />} title="ریسکی ثبت نشده است" />}>
        <Table>
          <thead><tr><Th>فعالیت / خطر</Th><Th>پروژه</Th><Th>ریسک ذاتی</Th><Th>کنترل‌ها</Th><Th>باقی‌مانده</Th><Th>وضعیت</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
          <tbody>
            {q.data?.map((r) => (
              <tr key={r.id}>
                <Td>{r.activity}<div className="text-xs text-muted">{r.hazard}</div></Td>
                <Td>{project(r.projects_project_id)}</Td>
                <Td><Badge tone={BAND[r.rating.band]!.tone}>{num(r.rating.score)} — {BAND[r.rating.band]!.label}</Badge></Td>
                <Td className="max-w-64 text-xs">{r.controls || '—'}</Td>
                <Td>{r.residual ? <Badge tone={BAND[r.residual.band]!.tone}>{num(r.residual.score)} — {BAND[r.residual.band]!.label}</Badge> : '—'}</Td>
                <Td>{RISK_STATUS[r.status]}{r.review_on && <div className="text-xs text-muted">بازنگری <DayText value={r.review_on} /></div>}</Td>
                <Td>{canManage && <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>ویرایش</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {editing && <RiskDialog risk={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RiskDialog({ risk, onClose }: { risk: Risk | null; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const dir = useDirectory();
  const err = useServerErrors();
  const companyScope = useCan('qhse.admin');
  const [v, setV] = useState({
    projectId: risk?.projects_project_id ?? '', activity: risk?.activity ?? '', hazard: risk?.hazard ?? '', consequence: risk?.consequence ?? '', likelihood: String(risk?.likelihood ?? 3), severity: String(risk?.severity ?? 3),
    controls: risk?.controls ?? '', residualLikelihood: String(risk?.residual_likelihood ?? ''), residualSeverity: String(risk?.residual_severity ?? ''), ownerId: risk?.owner_id ?? '', status: risk?.status ?? 'open',
  });
  const [review, setReview] = useState<string | null>(risk?.review_on ?? null);
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const body = () => ({
    ...v, projectId: v.projectId || null, likelihood: Number(v.likelihood), severity: Number(v.severity), ownerId: v.ownerId || null, reviewOn: review,
    residualLikelihood: v.residualLikelihood ? Number(v.residualLikelihood) : null, residualSeverity: v.residualSeverity ? Number(v.residualSeverity) : null,
  });
  const save = useMutation({
    mutationFn: () => (risk ? a.put(`/risks/${risk.id}`, body()) : a.post('/risks', body())),
    onSuccess: () => (toast('ریسک ذخیره شد'), void qc.invalidateQueries({ queryKey: ['qhse'] }), onClose()),
    onError: err.set,
  });
  const lv = (k: 'likelihood' | 'severity' | 'residualLikelihood' | 'residualSeverity', label: string, optional = false) => (
    <Field label={label} error={err.fields[k]}><Select value={v[k]} onChange={(e) => set(k)(e.target.value)}>{optional && <option value="">—</option>}{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{num(n)}</option>)}</Select></Field>
  );
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={risk ? 'ویرایش ریسک' : 'ریسک جدید'} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ذخیره</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <ProjectSelect value={v.projectId} onChange={set('projectId')} required={!companyScope} error={err.fields.projectId} />
        <Field label="فعالیت" required error={err.fields.activity}><Input value={v.activity} onChange={(e) => set('activity')(e.target.value)} /></Field>
        <Field label="خطر" required error={err.fields.hazard}><Input value={v.hazard} onChange={(e) => set('hazard')(e.target.value)} /></Field>
        <Field label="پیامد"><Input value={v.consequence} onChange={(e) => set('consequence')(e.target.value)} /></Field>
        {lv('likelihood', 'احتمال (۱ تا ۵)')}{lv('severity', 'شدت (۱ تا ۵)')}
        <Field label="کنترل‌ها" className="sm:col-span-2"><Textarea value={v.controls} onChange={(e) => set('controls')(e.target.value)} /></Field>
        {lv('residualLikelihood', 'احتمال باقی‌مانده', true)}{lv('residualSeverity', 'شدت باقی‌مانده', true)}
        <Field label="مسئول"><Select value={v.ownerId} onChange={(e) => set('ownerId')(e.target.value)}><option value="">—</option>{dir.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</Select></Field>
        <Field label="تاریخ بازنگری"><DateInput value={review} onChange={setReview} /></Field>
        <Field label="وضعیت"><Select value={v.status} onChange={(e) => set('status')(e.target.value)}>{Object.entries(RISK_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- training and PPE

interface TrainingRow { id: string; title: string; topic: string; held_on: string; hours: number; trainer: string; projects_project_id: string | null; attendees: { userId: string | null; name: string }[] }
interface PpeRow { id: string; person_name: string; item: string; quantity: number; issued_on: string; replace_on: string | null; replace_due: boolean; projects_project_id: string | null }
const TOPIC: Record<string, string> = { ...AREA, induction: 'آموزش بدو ورود' };

export function TrainingPage() {
  const a = useApi();
  const project = useProjectName();
  const canManage = useCan('qhse.manage');
  const [dialog, setDialog] = useState<'training' | 'ppe' | null>(null);
  const trainings = useQuery({ queryKey: ['qhse', 'trainings'], queryFn: () => a.get<TrainingRow[]>('/trainings') });
  const ppe = useQuery({ queryKey: ['qhse', 'ppe'], queryFn: () => a.get<PpeRow[]>('/ppe') });
  return (
    <>
      <PageHeader title="آموزش ایمنی و تجهیزات حفاظت فردی" actions={canManage && <><Button onClick={() => setDialog('training')}><Plus className="size-4" /> آموزش</Button><Button variant="secondary" onClick={() => setDialog('ppe')}><Plus className="size-4" /> تحویل PPE</Button></>} />
      <Nav />
      <div className="space-y-6">
        <Card>
          <CardHeader title="آموزش‌ها" actions={<ExportMenu filename="safety-training" title="آموزش‌ها" rows={trainings.data} columns={[
            { header: 'عنوان', value: (t) => t.title }, { header: 'موضوع', value: (t) => TOPIC[t.topic] }, { header: 'تاریخ', value: (t) => t.held_on }, { header: 'ساعت', value: (t) => t.hours, kind: 'number' },
            { header: 'مدرس', value: (t) => t.trainer }, { header: 'شرکت‌کنندگان', value: (t) => t.attendees.map((x) => x.name).join('، ') },
          ]} />} />
          <PageState query={trainings} isEmpty={trainings.data?.length === 0} empty={<EmptyState icon={<GraduationCap className="size-8" />} title="آموزشی ثبت نشده است" />}>
            <Table>
              <thead><tr><Th>عنوان</Th><Th>تاریخ</Th><Th>ساعت</Th><Th>پروژه</Th><Th>شرکت‌کنندگان</Th></tr></thead>
              <tbody>{trainings.data?.map((t) => <tr key={t.id}><Td>{t.title}<div className="text-xs text-muted">{TOPIC[t.topic]}{t.trainer && ` · ${t.trainer}`}</div></Td><Td><DayText value={t.held_on} /></Td><Td className="tabular-nums">{num(t.hours)}</Td><Td>{project(t.projects_project_id)}</Td><Td className="text-xs">{num(t.attendees.length)} نفر: {t.attendees.map((x) => x.name).join('، ')}</Td></tr>)}</tbody>
            </Table>
          </PageState>
        </Card>
        <Card>
          <CardHeader title="تحویل تجهیزات حفاظت فردی" actions={<ExportMenu filename="ppe" title="تحویل PPE" rows={ppe.data} columns={[
            { header: 'تحویل‌گیرنده', value: (p) => p.person_name }, { header: 'تجهیز', value: (p) => p.item }, { header: 'تعداد', value: (p) => p.quantity, kind: 'number' },
            { header: 'تحویل', value: (p) => p.issued_on }, { header: 'تعویض', value: (p) => p.replace_on },
          ]} />} />
          <PageState query={ppe} isEmpty={ppe.data?.length === 0} empty={<EmptyState icon={<HardHat className="size-8" />} title="تحویلی ثبت نشده است" />}>
            <Table>
              <thead><tr><Th>تحویل‌گیرنده</Th><Th>تجهیز</Th><Th>تعداد</Th><Th>تحویل</Th><Th>تعویض</Th></tr></thead>
              <tbody>{ppe.data?.map((p) => <tr key={p.id}><Td>{p.person_name}</Td><Td>{p.item}</Td><Td className="tabular-nums">{num(p.quantity)}</Td><Td><DayText value={p.issued_on} /></Td><Td>{p.replace_on ? <><DayText value={p.replace_on} />{p.replace_due && <Badge tone="warning" className="ms-1">موعد تعویض</Badge>}</> : '—'}</Td></tr>)}</tbody>
            </Table>
          </PageState>
        </Card>
      </div>
      {dialog === 'training' && <TrainingDialog onClose={() => setDialog(null)} />}
      {dialog === 'ppe' && <PpeDialog onClose={() => setDialog(null)} />}
    </>
  );
}

function TrainingDialog({ onClose }: { onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const dir = useDirectory();
  const err = useServerErrors();
  const companyScope = useCan('qhse.admin');
  const [v, setV] = useState({ title: '', topic: 'safety', hours: '2', trainer: '', projectId: '' });
  const [on, setOn] = useState<string | null>(todayIso());
  const [people, setPeople] = useState<{ userId: string | null; name: string }[]>([]);
  const [pick, setPick] = useState('');
  const [other, setOther] = useState('');
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const save = useMutation({
    mutationFn: () => a.post('/trainings', { ...v, hours: Number(v.hours) || 0, heldOn: on, projectId: v.projectId || null, attendees: people }),
    onSuccess: () => (toast('آموزش ثبت شد'), void qc.invalidateQueries({ queryKey: ['qhse'] }), onClose()),
    onError: err.set,
  });
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="ثبت آموزش" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!on} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="عنوان" required error={err.fields.title}><Input value={v.title} onChange={(e) => set('title')(e.target.value)} /></Field>
        <Field label="موضوع"><Select value={v.topic} onChange={(e) => set('topic')(e.target.value)}>{Object.entries(TOPIC).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="تاریخ" required><DateInput value={on} onChange={setOn} /></Field>
        <Field label="مدت (ساعت)" required error={err.fields.hours}><Input inputMode="decimal" value={v.hours} onChange={(e) => set('hours')(e.target.value)} /></Field>
        <Field label="مدرس"><Input value={v.trainer} onChange={(e) => set('trainer')(e.target.value)} /></Field>
        <ProjectSelect value={v.projectId} onChange={set('projectId')} required={!companyScope} error={err.fields.projectId} />
      </div>
      <h3 className="mb-2 mt-6 font-semibold">شرکت‌کنندگان {err.fields.attendees && <span className="text-sm font-normal text-danger">— {err.fields.attendees}</span>}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-end gap-2">
          <Field label="از کاربران" className="flex-1"><Select value={pick} onChange={(e) => setPick(e.target.value)}><option value="">انتخاب کنید</option>{dir.users.filter((u) => !people.some((p) => p.userId === u.id)).map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</Select></Field>
          <Button variant="secondary" disabled={!pick} onClick={() => (setPeople((s) => [...s, { userId: pick, name: dir.name(pick) }]), setPick(''))}>افزودن</Button>
        </div>
        <div className="flex items-end gap-2">
          <Field label="نیروی پیمانکار / بدون حساب" className="flex-1"><Input value={other} onChange={(e) => setOther(e.target.value)} /></Field>
          <Button variant="secondary" disabled={other.trim().length < 2} onClick={() => (setPeople((s) => [...s, { userId: null, name: other.trim() }]), setOther(''))}>افزودن</Button>
        </div>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2 text-sm">
        {people.map((p, i) => (
          <li key={i} className="flex items-center gap-1 rounded-full border border-border px-3 py-1">{p.name}<button type="button" aria-label={`حذف ${p.name}`} onClick={() => setPeople((s) => s.filter((_, j) => j !== i))}><Trash2 className="size-3" /></button></li>
        ))}
      </ul>
    </Dialog>
  );
}

function PpeDialog({ onClose }: { onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const dir = useDirectory();
  const err = useServerErrors();
  const companyScope = useCan('qhse.admin');
  const [v, setV] = useState({ userId: '', personName: '', item: '', quantity: '1', projectId: '' });
  const [on, setOn] = useState<string | null>(todayIso());
  const [replace, setReplace] = useState<string | null>(addDays(todayIso(), 365));
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const save = useMutation({
    mutationFn: () => a.post('/ppe', { ...v, userId: v.userId || null, quantity: Number(v.quantity) || 1, issuedOn: on, replaceOn: replace, projectId: v.projectId || null }),
    onSuccess: () => (toast('تحویل ثبت شد'), void qc.invalidateQueries({ queryKey: ['qhse'] }), onClose()),
    onError: err.set,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="تحویل تجهیز حفاظت فردی" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!on} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4">
        <Field label="کاربر (اختیاری)"><Select value={v.userId} onChange={(e) => setV((s) => ({ ...s, userId: e.target.value, personName: e.target.value ? dir.name(e.target.value) : s.personName }))}><option value="">—</option>{dir.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</Select></Field>
        <Field label="نام تحویل‌گیرنده" required error={err.fields.personName}><Input value={v.personName} onChange={(e) => set('personName')(e.target.value)} /></Field>
        <Field label="تجهیز" required error={err.fields.item}><Input value={v.item} onChange={(e) => set('item')(e.target.value)} placeholder="کلاه ایمنی، کفش ایمنی، کمربند…" /></Field>
        <Field label="تعداد"><Input inputMode="numeric" value={v.quantity} onChange={(e) => set('quantity')(e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label="تاریخ تحویل" required><DateInput value={on} onChange={setOn} /></Field>
        <Field label="موعد تعویض" error={err.fields.replaceOn}><DateInput value={replace} onChange={setReplace} /></Field>
        <ProjectSelect value={v.projectId} onChange={set('projectId')} required={!companyScope} error={err.fields.projectId} />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- status report and man-hours

interface Report {
  byKind: { kind: string; n: number }[]; bySeverity: { severity: string; n: number }[]; injured: number; lostDays: number; lti: number; fatalities: number; manhours: number;
  rates: { ltifr: number | null; trifr: number | null; severityRate: number | null }; inspections: { n: number; avg: number | null }; actions: { open: number; overdue: number; verified: number }; openNcrs: number; highRisks: number;
}

export function ReportPage() {
  const a = useApi();
  const canManage = useCan('qhse.manage');
  const [from, setFrom] = useState<string | null>(`${todayIso().slice(0, 7)}-01`);
  const [to, setTo] = useState<string | null>(todayIso());
  const [projectId, setProjectId] = useState('');
  const [hours, setHours] = useState(false);
  const q = useQuery({ queryKey: ['qhse', 'report', from, to, projectId], queryFn: () => a.get<Report>(`/report?from=${from}&to=${to}${projectId ? `&projectId=${projectId}` : ''}`), enabled: !!from && !!to });
  const d = q.data;
  const rate = (v: number | null) => (v === null ? 'نیاز به نفر-ساعت' : num(v));
  return (
    <>
      <PageHeader title="گزارش وضعیت ایمنی" description="نرخ‌ها در یک میلیون نفر-ساعت؛ LTIFR حوادث با روز کاری از دست رفته یا فوت، TRIFR همه حوادث با آسیب. نفر-ساعت ماهانه را ثبت کنید." actions={canManage && <Button variant="secondary" onClick={() => setHours(true)}>ثبت نفر-ساعت</Button>} />
      <Nav />
      <div className="mb-6 flex flex-wrap gap-4">
        <Field label="از تاریخ"><DateInput value={from} onChange={setFrom} /></Field>
        <Field label="تا تاریخ"><DateInput value={to} onChange={setTo} /></Field>
        <ProjectSelect value={projectId} onChange={setProjectId} />
      </div>
      <PageState query={q}>
        {d && (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="LTIFR">{rate(d.rates.ltifr)}</Stat>
              <Stat label="TRIFR">{rate(d.rates.trifr)}</Stat>
              <Stat label="نرخ شدت (روز در میلیون ساعت)">{rate(d.rates.severityRate)}</Stat>
              <Stat label="نفر-ساعت">{num(d.manhours)}</Stat>
              <Stat label="مصدوم / روز از دست رفته">{num(d.injured)} / {num(d.lostDays)}</Stat>
              <Stat label="فوت">{num(d.fatalities)}</Stat>
              <Stat label="میانگین امتیاز بازرسی">{d.inspections.avg === null ? '—' : `${num(d.inspections.avg)}٪`} <span className="text-sm text-muted">({num(d.inspections.n)} بازرسی)</span></Stat>
              <Stat label="ریسک زیاد باز">{num(d.highRisks)}</Stat>
              <Stat label="اقدامات باز / معوق">{num(d.actions.open)} / {num(d.actions.overdue)}</Stat>
              <Stat label="عدم انطباق باز">{num(d.openNcrs)}</Stat>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card><CardHeader title="به تفکیک نوع" /><Table><tbody>{d.byKind.map((k) => <tr key={k.kind}><Td>{KIND[k.kind]}</Td><Td className="tabular-nums">{num(k.n)}</Td></tr>)}</tbody></Table></Card>
              <Card><CardHeader title="به تفکیک شدت" /><Table><tbody>{d.bySeverity.map((k) => <tr key={k.severity}><Td>{SEVERITY[k.severity]!.label}</Td><Td className="tabular-nums">{num(k.n)}</Td></tr>)}</tbody></Table></Card>
            </div>
          </div>
        )}
      </PageState>
      {hours && <ManhoursDialog onClose={() => setHours(false)} />}
    </>
  );
}

function ManhoursDialog({ onClose }: { onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const project = useProjectName();
  const companyScope = useCan('qhse.admin');
  const list = useQuery({ queryKey: ['qhse', 'manhours'], queryFn: () => a.get<{ id: string; projects_project_id: string | null; month: string; hours: number; headcount: number }[]>('/manhours') });
  const [v, setV] = useState({ projectId: '', month: todayIso().slice(0, 7), hours: '', headcount: '' });
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const save = useMutation({
    mutationFn: () => a.put('/manhours', { projectId: v.projectId || null, month: v.month, hours: Number(v.hours) || 0, headcount: Number(v.headcount) || 0 }),
    onSuccess: () => (toast('نفر-ساعت ذخیره شد'), void qc.invalidateQueries({ queryKey: ['qhse'] })),
    onError: err.set,
  });
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="نفر-ساعت ماهانه" description="ماه به‌صورت میلادی (سال-ماه) ثبت می‌شود؛ ثبت دوباره همان ماه و پروژه مقدار قبلی را جایگزین می‌کند." footer={<Button variant="ghost" onClick={onClose}>بستن</Button>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-4 sm:items-end">
        <ProjectSelect value={v.projectId} onChange={set('projectId')} required={!companyScope} error={err.fields.projectId} />
        <Field label="ماه (مثل 2026-10)" error={err.fields.month}><Input dir="ltr" value={v.month} onChange={(e) => set('month')(e.target.value)} /></Field>
        <Field label="نفر-ساعت" error={err.fields.hours}><Input inputMode="numeric" value={v.hours} onChange={(e) => set('hours')(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
        <Field label="تعداد نفرات"><Input inputMode="numeric" value={v.headcount} onChange={(e) => set('headcount')(e.target.value.replace(/\D/g, ''))} /></Field>
      </div>
      <Button className="mt-3" loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ذخیره</Button>
      <Table>
        <thead><tr><Th>ماه</Th><Th>پروژه</Th><Th>نفر-ساعت</Th><Th>نفرات</Th></tr></thead>
        <tbody>{list.data?.map((m) => <tr key={m.id}><Td dir="ltr">{m.month}</Td><Td>{project(m.projects_project_id)}</Td><Td className="tabular-nums">{num(m.hours)}</Td><Td className="tabular-nums">{num(m.headcount)}</Td></tr>)}</tbody>
      </Table>
    </Dialog>
  );
}

// ---------------------------------------------------------------- settings

export function SettingsPage() {
  const a = useApi();
  const qc = useQueryClient();
  const dir = useDirectory();
  const settings = useQuery({ queryKey: ['qhse', 'settings'], queryFn: () => a.get<{ urgent_recipients: string[] }>('/settings') });
  const lists = useQuery({ queryKey: ['qhse', 'checklists'], queryFn: () => a.get<{ id: string; name: string; area: string; items: { text: string }[]; archived: boolean }[]>('/checklists') });
  const [recipients, setRecipients] = useState<string[] | null>(null);
  const [pick, setPick] = useState('');
  const [editing, setEditing] = useState<{ id: string | null; name: string; area: string; items: string; archived: boolean } | null>(null);
  const current = recipients ?? settings.data?.urgent_recipients ?? [];
  const save = useMutation({ mutationFn: () => a.put('/settings', { urgentRecipients: current }), onSuccess: () => (toast('گیرندگان ذخیره شد'), void qc.invalidateQueries({ queryKey: ['qhse', 'settings'] })) });
  return (
    <>
      <PageHeader title="تنظیمات QHSE" />
      <Nav />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="گیرندگان اعلان فوری" />
          <p className="mb-3 text-sm text-muted">حادثه با شدت زیاد یا بحرانی (و هر فوت) بلافاصله برای این افراد اعلان و ایمیل می‌شود.</p>
          <PageState query={settings}>
            <div className="flex items-end gap-2">
              <Field label="افزودن" className="flex-1"><Select value={pick} onChange={(e) => setPick(e.target.value)}><option value="">انتخاب کنید</option>{dir.users.filter((u) => !current.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</Select></Field>
              <Button variant="secondary" disabled={!pick} onClick={() => (setRecipients([...current, pick]), setPick(''))}>افزودن</Button>
            </div>
            <ul className="my-3 space-y-1 text-sm">
              {current.length === 0 && <li className="text-muted">گیرنده‌ای تعیین نشده است؛ اعلان فوری فرستاده نمی‌شود.</li>}
              {current.map((id) => <li key={id} className="flex items-center justify-between">{dir.name(id)}<Button size="sm" variant="ghost" aria-label={`حذف ${dir.name(id)}`} onClick={() => setRecipients(current.filter((x) => x !== id))}><Trash2 className="size-4" /></Button></li>)}
            </ul>
            <Button loading={save.isPending} onClick={() => save.mutate()}>ذخیره</Button>
          </PageState>
        </Card>
        <Card>
          <CardHeader title="چک‌لیست‌های بازرسی" actions={<Button size="sm" onClick={() => setEditing({ id: null, name: '', area: 'safety', items: '', archived: false })}>چک‌لیست جدید</Button>} />
          <PageState query={lists} isEmpty={lists.data?.length === 0} empty={<EmptyState title="چک‌لیستی تعریف نشده است" />}>
            <ul className="space-y-1 text-sm">
              {lists.data?.map((c) => (
                <li key={c.id} className="flex items-center justify-between">
                  <span>{c.name} <span className="text-xs text-muted">({AREA[c.area]}، {num(c.items.length)} بند{c.archived ? '، بایگانی' : ''})</span></span>
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ id: c.id, name: c.name, area: c.area, items: c.items.map((i) => i.text).join('\n'), archived: c.archived })}>ویرایش</Button>
                </li>
              ))}
            </ul>
          </PageState>
        </Card>
      </div>
      {editing && <ChecklistDialog init={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ChecklistDialog({ init, onClose }: { init: { id: string | null; name: string; area: string; items: string; archived: boolean }; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [v, setV] = useState(init);
  const body = () => ({ name: v.name, area: v.area, archived: v.archived, items: v.items.split('\n').map((x) => x.trim()).filter(Boolean) });
  const save = useMutation({
    mutationFn: () => (init.id ? a.put(`/checklists/${init.id}`, body()) : a.post('/checklists', body())),
    onSuccess: () => (toast('چک‌لیست ذخیره شد'), void qc.invalidateQueries({ queryKey: ['qhse', 'checklists'] }), onClose()),
    onError: err.set,
  });
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={init.id ? 'ویرایش چک‌لیست' : 'چک‌لیست جدید'} description="تغییر چک‌لیست روی بازرسی‌های ثبت‌شده اثر ندارد؛ هر بازرسی متن بندها را نگه می‌دارد." footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ذخیره</Button></>}>
      {err.banner}
      <div className="grid gap-4">
        <Field label="نام" required error={err.fields.name}><Input value={v.name} onChange={(e) => setV((s) => ({ ...s, name: e.target.value }))} /></Field>
        <Field label="حوزه"><Select value={v.area} onChange={(e) => setV((s) => ({ ...s, area: e.target.value }))}>{Object.entries(AREA).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="بندها (هر خط یک بند)" required error={err.fields.items}><Textarea rows={8} value={v.items} onChange={(e) => setV((s) => ({ ...s, items: e.target.value }))} /></Field>
        {init.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={v.archived} onChange={(e) => setV((s) => ({ ...s, archived: e.target.checked }))} /> بایگانی</label>}
      </div>
    </Dialog>
  );
}
