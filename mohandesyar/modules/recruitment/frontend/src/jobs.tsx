import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BriefcaseBusiness, Plus, Search, Trash2 } from 'lucide-react';
import {
  Alert, Badge, Button, Checkbox, DateInput, DateText, DayText, Dialog, EmptyState, ExportMenu, Field, Input, MoneyInput, PageHeader, PageState, Select, Table, Tabs, Td, Textarea, Th, toast,
} from '@mohandesyar/ui';
import { useCan, useDirectory } from '@mohandesyar/module-sdk/web';
import { todayIso, utcToZoned } from '@mohandesyar/persian';
import { BASE, DEGREE, EMPLOYMENT, JOB_STATUS, MODE, Nav, RECOMMENDATION, SKILL_KIND, STAGE_KIND, Score, fa, toFaDigits, useApi, useServerErrors } from './common.js';

interface JobRow { id: string; title: string; department: string; location: string; employment: string; openings: number; status: string; opened_on: string; closed_on: string | null; criteria: number; active: number; hired: number; total: number }

export function JobsPage() {
  const a = useApi();
  const canJobs = useCan('recruitment.job.manage');
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['recruitment', 'jobs'], queryFn: () => a.get<JobRow[]>('/jobs') });
  return (
    <>
      <PageHeader
        title="موقعیت‌های شغلی"
        actions={
          <>
            <ExportMenu filename="jobs" title="موقعیت‌های شغلی" rows={q.data} columns={[
              { header: 'عنوان', value: (r) => r.title }, { header: 'واحد', value: (r) => r.department }, { header: 'وضعیت', value: (r) => JOB_STATUS[r.status]?.label },
              { header: 'ظرفیت', value: (r) => r.openings, kind: 'number' }, { header: 'متقاضیان', value: (r) => r.total, kind: 'number' }, { header: 'در جریان', value: (r) => r.active, kind: 'number' },
              { header: 'استخدام‌شده', value: (r) => r.hired, kind: 'number' },
            ]} />
            {canJobs && <Button onClick={() => setCreating(true)}><Plus className="size-4" /> موقعیت جدید</Button>}
          </>
        }
      />
      <Nav />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<BriefcaseBusiness className="size-8" />} title="هنوز موقعیت شغلی تعریف نشده است" action={canJobs ? <Button onClick={() => setCreating(true)}>تعریف موقعیت</Button> : undefined} />}>
        <Table>
          <thead><tr><Th>عنوان</Th><Th>واحد / محل</Th><Th>نوع همکاری</Th><Th>ظرفیت</Th><Th>متقاضیان</Th><Th>در جریان</Th><Th>استخدام‌شده</Th><Th>معیار امتیاز</Th><Th>وضعیت</Th></tr></thead>
          <tbody>
            {q.data?.map((j) => (
              <tr key={j.id}>
                <Td><Link to={`${BASE}/jobs/${j.id}`} className="font-medium text-primary underline-offset-4 hover:underline">{j.title}</Link><div className="text-xs text-muted">از <DayText value={j.opened_on} /></div></Td>
                <Td>{[j.department, j.location].filter(Boolean).join(' / ') || '—'}</Td>
                <Td>{EMPLOYMENT[j.employment]}</Td>
                <Td>{fa(j.openings)}</Td><Td>{fa(j.total)}</Td><Td>{fa(j.active)}</Td><Td>{fa(j.hired)}</Td>
                <Td>{j.criteria ? fa(j.criteria) : <span className="text-muted">تعریف نشده</span>}</Td>
                <Td><Badge tone={JOB_STATUS[j.status]!.tone}>{JOB_STATUS[j.status]!.label}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {creating && <JobForm onClose={() => setCreating(false)} />}
    </>
  );
}

interface Criterion { type: string; weight: number; [k: string]: unknown }
interface Breakdown { label: string; weight: number; fraction: number; points: number; reason: string }
interface AppRow { id: string; candidate_id: string; full_name: string; desired_position: string; stage_id: string; score: number | null; score_breakdown: Breakdown[]; scoring_version: number | null; created_at: string; hired_on: string | null; rejection_reason: string; interviews: number; interview_score: number | null }
interface JobDetail {
  job: { id: string; title: string; department: string; location: string; employment: string; openings: number; description: string; status: string; scoring: Criterion[]; scoring_version: number; interview_form_id: string | null; opened_on: string; closed_on: string | null };
  stages: { id: string; name: string; kind: string; archived: boolean }[];
  applications: AppRow[];
}

function JobForm({ job, onClose }: { job?: JobDetail['job']; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const nav = useNavigate();
  const err = useServerErrors();
  const forms = useQuery({ queryKey: ['recruitment', 'forms'], queryFn: () => a.get<{ id: string; name: string; archived: boolean }[]>('/forms') });
  const [v, setV] = useState({
    title: job?.title ?? '', department: job?.department ?? '', location: job?.location ?? '', employment: job?.employment ?? 'full_time', openings: String(job?.openings ?? 1),
    description: job?.description ?? '', status: job?.status ?? 'open', interviewFormId: job?.interview_form_id ?? '',
  });
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...v, openings: Number(v.openings) || 1, interviewFormId: v.interviewFormId || null };
      return job ? a.put<{ id: string }>(`/jobs/${job.id}`, body) : a.post<{ id: string }>('/jobs', body);
    },
    onSuccess: (r) => (toast('موقعیت شغلی ذخیره شد'), void qc.invalidateQueries({ queryKey: ['recruitment'] }), onClose(), !job && nav(`${BASE}/jobs/${r.id}`)),
    onError: err.set,
  });
  const f = err.fields;
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={job ? 'ویرایش موقعیت شغلی' : 'موقعیت شغلی جدید'}
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ذخیره</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="عنوان موقعیت" required error={f.title} className="sm:col-span-2"><Input value={v.title} onChange={(e) => set('title')(e.target.value)} placeholder="مثلاً: کارشناس طراحی سازه" /></Field>
        <Field label="واحد"><Input value={v.department} onChange={(e) => set('department')(e.target.value)} /></Field>
        <Field label="محل کار"><Input value={v.location} onChange={(e) => set('location')(e.target.value)} /></Field>
        <Field label="نوع همکاری"><Select value={v.employment} onChange={(e) => set('employment')(e.target.value)}>{Object.entries(EMPLOYMENT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="ظرفیت (نفر)" error={f.openings}><Input inputMode="numeric" value={v.openings} onChange={(e) => set('openings')(e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label="وضعیت"><Select value={v.status} onChange={(e) => set('status')(e.target.value)}>{Object.entries(JOB_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</Select></Field>
        <Field label="فرم ارزیابی پیش‌فرض مصاحبه">
          <Select value={v.interviewFormId} onChange={(e) => set('interviewFormId')(e.target.value)}>
            <option value="">—</option>
            {(forms.data ?? []).filter((x) => !x.archived).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </Field>
        <Field label="شرح شغل و شرایط احراز" className="sm:col-span-2"><Textarea rows={4} value={v.description} onChange={(e) => set('description')(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

export function JobPage() {
  const { id } = useParams();
  const a = useApi();
  const canJobs = useCan('recruitment.job.manage');
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('pipeline');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['recruitment', 'job', id], queryFn: () => a.get<JobDetail>(`/jobs/${id}`) });
  const appId = params.get('app');
  const open = (aid: string | null) => setParams(aid ? { app: aid } : {}, { replace: true });
  const d = q.data;
  return (
    <>
      <Link to={`${BASE}/jobs`} className="mb-3 inline-flex items-center gap-1 text-sm text-primary print:hidden"><ArrowRight className="size-4" /> موقعیت‌های شغلی</Link>
      <PageState query={q}>
        {d && (
          <>
            <PageHeader
              title={d.job.title}
              description={<span><Badge tone={JOB_STATUS[d.job.status]!.tone}>{JOB_STATUS[d.job.status]!.label}</Badge> · {EMPLOYMENT[d.job.employment]} · ظرفیت {fa(d.job.openings)} نفر{d.job.department && ` · ${d.job.department}`}</span>}
              actions={
                <>
                  {d.job.status !== 'closed' && <Button onClick={() => setAdding(true)}><Plus className="size-4" /> افزودن متقاضی از بانک رزومه</Button>}
                  {canJobs && <Button variant="secondary" onClick={() => setEditing(true)}>ویرایش موقعیت</Button>}
                </>
              }
            />
            <Tabs label="بخش‌های موقعیت شغلی" value={tab} onChange={setTab} items={[
              { key: 'pipeline', label: 'قیف استخدام', count: d.applications.length },
              { key: 'ranking', label: 'رتبه‌بندی و دلیل امتیاز' },
              { key: 'scoring', label: 'معیارهای امتیازدهی', count: d.job.scoring.length },
              { key: 'info', label: 'شرح شغل' },
            ]} />
            {tab === 'pipeline' && <Pipeline d={d} onOpen={open} />}
            {tab === 'ranking' && <Ranking d={d} onOpen={open} />}
            {tab === 'scoring' && <ScoringEditor job={d.job} canEdit={canJobs} />}
            {tab === 'info' && <p className="whitespace-pre-line text-sm">{d.job.description || 'شرحی ثبت نشده است.'}</p>}
            {editing && <JobForm job={d.job} onClose={() => setEditing(false)} />}
            {adding && <AddCandidates jobId={d.job.id} onClose={() => setAdding(false)} />}
            {appId && <ApplicationDialog id={appId} job={d} onClose={() => open(null)} />}
          </>
        )}
      </PageState>
    </>
  );
}

function Pipeline({ d, onOpen }: { d: JobDetail; onOpen: (id: string) => void }) {
  const stages = d.stages.filter((s) => !s.archived || d.applications.some((x) => x.stage_id === s.id));
  if (!d.applications.length) return <EmptyState title="هنوز متقاضی برای این موقعیت ثبت نشده است" description="از دکمه «افزودن متقاضی از بانک رزومه» استفاده کنید." />;
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {stages.map((s) => {
        const list = d.applications.filter((x) => x.stage_id === s.id);
        return (
          <section key={s.id} aria-label={s.name} className="w-64 shrink-0 rounded-lg border border-border bg-surface-2 p-3">
            <h3 className="mb-2 flex items-center justify-between text-sm font-semibold">
              <span>{s.name}</span>
              <Badge tone={STAGE_KIND[s.kind]!.tone}>{fa(list.length)}</Badge>
            </h3>
            <ul className="space-y-2">
              {list.map((x) => (
                <li key={x.id}>
                  <button type="button" onClick={() => onOpen(x.id)} className="w-full rounded-md border border-border bg-surface p-2 text-start text-sm hover:border-primary">
                    <span className="flex items-center justify-between gap-2"><span className="font-medium">{x.full_name}</span><Score value={x.score} /></span>
                    {x.interviews > 0 && <span className="text-xs text-muted">{fa(x.interviews)} مصاحبه{x.interview_score !== null && ` · ارزیابی ${fa(x.interview_score)}`}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Ranking({ d, onOpen }: { d: JobDetail; onOpen: (id: string) => void }) {
  const stage = new Map(d.stages.map((s) => [s.id, s]));
  return (
    <>
      <Alert tone="info" className="mb-4">امتیاز فقط کمکی است و جای قضاوت ارزیاب را نمی‌گیرد. فقط معیارهای مجاز و مرتبط با شغل به کار می‌روند و دلیل هر امتیاز نمایش داده می‌شود.</Alert>
      {!d.job.scoring.length && <Alert tone="warning" className="mb-4">برای این موقعیت معیار امتیازدهی تعریف نشده است.</Alert>}
      <ExportMenu filename="ranking" title={`رتبه‌بندی ${d.job.title}`} rows={d.applications} columns={[
        { header: 'نام', value: (r) => r.full_name }, { header: 'مرحله', value: (r) => stage.get(r.stage_id)?.name }, { header: 'امتیاز کمکی', value: (r) => r.score, kind: 'number' },
        { header: 'میانگین ارزیابی مصاحبه', value: (r) => r.interview_score, kind: 'number' },
        { header: 'جزئیات امتیاز', value: (r) => r.score_breakdown.map((b) => `${b.label}: ${b.points} (${b.reason})`).join(' | ') },
      ]} />
      <ol className="mt-3 space-y-3">
        {d.applications.map((x, i) => (
          <li key={x.id} className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="text-muted tabular-nums">{fa(i + 1)}.</span>
                <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => onOpen(x.id)}>{x.full_name}</button>
                <Badge tone={STAGE_KIND[stage.get(x.stage_id)?.kind ?? 'open']!.tone}>{stage.get(x.stage_id)?.name}</Badge>
              </div>
              <div className="flex items-center gap-2 text-sm">امتیاز کمکی <Score value={x.score} />{x.scoring_version !== null && x.scoring_version !== d.job.scoring_version && <Badge tone="warning">نسخه قدیمی معیارها</Badge>}</div>
            </div>
            {x.score_breakdown.length > 0 && <BreakdownTable items={x.score_breakdown} />}
          </li>
        ))}
      </ol>
    </>
  );
}

function BreakdownTable({ items }: { items: Breakdown[] }) {
  return (
    <table className="mt-3 w-full text-sm">
      <caption className="sr-only">دلیل امتیاز</caption>
      <thead className="text-muted"><tr><th className="py-1 text-start font-normal">معیار</th><th className="py-1 text-start font-normal">وزن</th><th className="py-1 text-start font-normal">امتیاز</th><th className="py-1 text-start font-normal">دلیل</th></tr></thead>
      <tbody>
        {items.map((b, i) => (
          <tr key={i} className="border-t border-border">
            <td className="py-1">{b.label}</td>
            <td className="py-1 tabular-nums">{fa(b.weight)}</td>
            <td className={`py-1 tabular-nums ${b.fraction === 1 ? 'text-success' : b.fraction === 0 ? 'text-danger' : 'text-warning'}`}>{fa(b.points)}</td>
            <td className="py-1 text-muted">{b.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const CRITERIA: Record<string, { label: string; blank: Criterion }> = {
  item: { label: 'مهارت / نرم‌افزار / گواهینامه / زبان', blank: { type: 'item', kind: 'software', name: '', minLevel: 3, weight: 3 } },
  experience_years: { label: 'سال‌های سابقه', blank: { type: 'experience_years', min: 3, weight: 3 } },
  education: { label: 'مدرک تحصیلی', blank: { type: 'education', minDegree: 'bachelor', field: '', weight: 2 } },
  keyword: { label: 'تجربه مرتبط (کلیدواژه در پروژه‌ها و سوابق)', blank: { type: 'keyword', keyword: '', weight: 2 } },
  salary_fit: { label: 'تناسب حقوق مورد انتظار', blank: { type: 'salary_fit', max: 0, weight: 1 } },
  availability: { label: 'آمادگی شروع', blank: { type: 'availability', withinDays: 30, weight: 1 } },
  city: { label: 'محل سکونت', blank: { type: 'city', city: '', weight: 1 } },
};

function ScoringEditor({ job, canEdit }: { job: JobDetail['job']; canEdit: boolean }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [list, setList] = useState<Criterion[]>(job.scoring);
  const [add, setAdd] = useState('item');
  const save = useMutation({
    mutationFn: () => a.put<{ version: number }>(`/jobs/${job.id}/scoring`, { criteria: list }),
    onSuccess: (r) => (toast(`نسخه ${fa(r.version)} معیارها ذخیره و همه متقاضیان دوباره امتیازدهی شدند`), void qc.invalidateQueries({ queryKey: ['recruitment', 'job', job.id] })),
    onError: err.set,
  });
  const set = (i: number, p: Partial<Criterion>) => setList((l) => l.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const num = (s: string) => (s === '' ? 0 : Number(s.replace(/[^\d.]/g, '')));
  const total = list.reduce((s, c) => s + (c.weight || 0), 0);
  return (
    <div className="space-y-4">
      <Alert tone="info">
        فقط معیارهای مرتبط با شغل قابل تعریف‌اند. سن، جنسیت، وضعیت تأهل، قومیت، مذهب و سلامت در سامانه ثبت نمی‌شوند و هیچ معیاری بر پایه آن‌ها ساخته نمی‌شود. نسخه فعلی: {fa(job.scoring_version)}
      </Alert>
      {err.banner}
      {list.length === 0 && <p className="text-sm text-muted">هنوز معیاری تعریف نشده است.</p>}
      <ol className="space-y-3">
        {list.map((c, i) => (
          <li key={i} className="grid items-end gap-3 rounded-lg border border-border p-3 sm:grid-cols-6">
            <div className="text-sm font-medium sm:col-span-6">{CRITERIA[c.type]?.label}</div>
            {c.type === 'item' && (
              <>
                <Field label="نوع"><Select disabled={!canEdit} value={c.kind as string} onChange={(e) => set(i, { kind: e.target.value })}>{Object.entries(SKILL_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
                <Field label="نام" className="sm:col-span-2"><Input disabled={!canEdit} value={c.name as string} onChange={(e) => set(i, { name: e.target.value })} placeholder="مثلاً ETABS" /></Field>
                <Field label="حداقل سطح"><Select disabled={!canEdit} value={c.minLevel as number} onChange={(e) => set(i, { minLevel: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{fa(n)}</option>)}</Select></Field>
              </>
            )}
            {c.type === 'experience_years' && <Field label="حداقل سال سابقه" className="sm:col-span-4"><Input disabled={!canEdit} inputMode="decimal" value={String(c.min)} onChange={(e) => set(i, { min: num(e.target.value) })} /></Field>}
            {c.type === 'education' && (
              <>
                <Field label="حداقل مقطع" className="sm:col-span-2"><Select disabled={!canEdit} value={c.minDegree as string} onChange={(e) => set(i, { minDegree: e.target.value })}>{['diploma', 'associate', 'bachelor', 'master', 'phd'].map((k) => <option key={k} value={k}>{DEGREE[k]}</option>)}</Select></Field>
                <Field label="رشته (اختیاری)" hint="رشته متفاوت نیمی از امتیاز را می‌گیرد" className="sm:col-span-2"><Input disabled={!canEdit} value={c.field as string} onChange={(e) => set(i, { field: e.target.value })} /></Field>
              </>
            )}
            {c.type === 'keyword' && <Field label="کلیدواژه" className="sm:col-span-4"><Input disabled={!canEdit} value={c.keyword as string} onChange={(e) => set(i, { keyword: e.target.value })} placeholder="مثلاً: تحلیل لرزه‌ای" /></Field>}
            {c.type === 'salary_fit' && <Field label="سقف حقوق ماهانه (ریال)" className="sm:col-span-4"><MoneyInput disabled={!canEdit} value={c.max ? String(c.max) : ''} onChange={(x) => set(i, { max: Number(x) || 0 })} /></Field>}
            {c.type === 'availability' && <Field label="حداکثر روز تا شروع" className="sm:col-span-4"><Input disabled={!canEdit} inputMode="numeric" value={String(c.withinDays)} onChange={(e) => set(i, { withinDays: num(e.target.value) })} /></Field>}
            {c.type === 'city' && <Field label="شهر" className="sm:col-span-4"><Input disabled={!canEdit} value={c.city as string} onChange={(e) => set(i, { city: e.target.value })} /></Field>}
            <Field label={`وزن (سهم ${total ? fa(((c.weight || 0) / total) * 100, 0) : '۰'}٪)`}><Select disabled={!canEdit} value={c.weight} onChange={(e) => set(i, { weight: Number(e.target.value) })}>{Array.from({ length: 10 }, (_, n) => <option key={n + 1} value={n + 1}>{fa(n + 1)}</option>)}</Select></Field>
            {canEdit && <Button variant="ghost" aria-label={`حذف معیار ${i + 1}`} onClick={() => setList((l) => l.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>}
          </li>
        ))}
      </ol>
      {canEdit && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="معیار جدید"><Select value={add} onChange={(e) => setAdd(e.target.value)}>{Object.entries(CRITERIA).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}</Select></Field>
          <Button variant="secondary" onClick={() => setList((l) => [...l, { ...CRITERIA[add]!.blank }])}><Plus className="size-4" /> افزودن معیار</Button>
          <Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ذخیره و امتیازدهی دوباره</Button>
        </div>
      )}
    </div>
  );
}

function AddCandidates({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const list = useQuery({
    queryKey: ['recruitment', 'candidates', 'pick', jobId, q],
    queryFn: () => a.get<{ id: string; full_name: string; desired_position: string; years: number }[]>(`/candidates?${new URLSearchParams({ jobId, ...(q ? { q } : {}) })}`),
  });
  const add = useMutation({
    mutationFn: () => a.post<{ added: number }>(`/jobs/${jobId}/applications`, { candidateIds: picked }),
    onSuccess: (r) => (toast(`${fa(r.added)} متقاضی به قیف اضافه و امتیازدهی شد`), void qc.invalidateQueries({ queryKey: ['recruitment'] }), onClose()),
    onError: err.set,
  });
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="افزودن متقاضی از بانک رزومه"
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!picked.length} loading={add.isPending} onClick={() => (err.clear(), add.mutate())}>افزودن {picked.length ? fa(picked.length) : ''} نفر</Button></>}>
      {err.banner}
      <form className="mb-4 flex gap-2" onSubmit={(e) => (e.preventDefault(), setQ(term))} role="search">
        <Input aria-label="جست‌وجوی رزومه" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="نام، مهارت، سابقه…" />
        <Button type="submit" variant="secondary"><Search className="size-4" /> جست‌وجو</Button>
      </form>
      {list.isPending ? <p className="text-sm text-muted">در حال بارگذاری…</p> : list.data?.length === 0 ? <p className="text-sm text-muted">رزومه دیگری برای افزودن یافت نشد.</p> : (
        <ul className="max-h-96 space-y-1 overflow-y-auto">
          {list.data?.map((c) => (
            <li key={c.id}>
              <Checkbox
                label={<span>{c.full_name} <span className="text-muted">— {c.desired_position || 'بدون موقعیت'}{c.years ? ` · ${fa(c.years)} سال سابقه` : ''}</span></span>}
                checked={picked.includes(c.id)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))}
              />
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

interface AppDetail {
  application: { id: string; job_id: string; candidate_id: string; full_name: string; stage_id: string; score: number | null; score_breakdown: Breakdown[]; rejection_reason: string; hired_on: string | null; created_at: string; interview_form_id: string | null };
  events: { id: string; from_stage_id: string | null; to_stage_id: string; note: string; changed_by: string; changed_at: string }[];
  interviews: { id: string; form_name: string; interviewer_id: string; scheduled_at: string; mode: string; status: string; score: number | null; recommendation: string | null; notes: string }[];
}

function ApplicationDialog({ id, job, onClose }: { id: string; job: JobDetail; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const dir = useDirectory();
  const err = useServerErrors();
  const q = useQuery({ queryKey: ['recruitment', 'application', id], queryFn: () => a.get<AppDetail>(`/applications/${id}`) });
  const [stageId, setStageId] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const stage = new Map(job.stages.map((s) => [s.id, s]));
  const refresh = () => (void qc.invalidateQueries({ queryKey: ['recruitment', 'application', id] }), void qc.invalidateQueries({ queryKey: ['recruitment', 'job', job.job.id] }));
  const move = useMutation({
    mutationFn: () => a.post(`/applications/${id}/move`, { stageId, note, rejectionReason: reason }),
    onSuccess: () => (toast(stage.get(stageId)?.kind === 'hired' ? 'استخدام ثبت شد' : 'مرحله تغییر کرد'), setStageId(''), setNote(''), setReason(''), refresh()),
    onError: err.set,
  });
  const rescore = useMutation({ mutationFn: () => a.post(`/applications/${id}/rescore`), onSuccess: () => (toast('امتیاز به‌روز شد'), refresh()) });
  const cancel = useMutation({ mutationFn: (iid: string) => a.post(`/interviews/${iid}/cancel`), onSuccess: () => (toast('مصاحبه لغو شد'), refresh()), onError: err.set });
  const d = q.data;
  const target = stage.get(stageId);
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={d ? `${d.application.full_name} — ${job.job.title}` : 'درخواست'}>
      <PageState query={q}>
        {d && (
          <div className="space-y-6">
            {err.banner}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>مرحله فعلی: <Badge tone={STAGE_KIND[stage.get(d.application.stage_id)?.kind ?? 'open']!.tone}>{stage.get(d.application.stage_id)?.name}</Badge></span>
              {d.application.hired_on && <span>تاریخ استخدام: <DayText value={d.application.hired_on} /></span>}
              <Link className="text-primary underline" to={`${BASE}/candidates/${d.application.candidate_id}`}>مشاهده رزومه کامل</Link>
            </div>
            {d.application.rejection_reason && <p className="text-sm">دلیل رد: {d.application.rejection_reason}</p>}
            <section>
              <h3 className="mb-2 flex items-center justify-between font-semibold">
                <span>امتیاز کمکی: <Score value={d.application.score} /></span>
                <Button size="sm" variant="ghost" loading={rescore.isPending} onClick={() => rescore.mutate()}>محاسبه دوباره</Button>
              </h3>
              {d.application.score_breakdown.length ? <BreakdownTable items={d.application.score_breakdown} /> : <p className="text-sm text-muted">معیاری برای این موقعیت تعریف نشده است.</p>}
            </section>
            <section className="rounded-lg border border-border p-4">
              <h3 className="mb-3 font-semibold">تغییر مرحله</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="مرحله مقصد"><Select value={stageId} onChange={(e) => setStageId(e.target.value)}><option value="">انتخاب کنید</option>{job.stages.filter((s) => !s.archived && s.id !== d.application.stage_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
                <Field label="یادداشت"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                {target?.kind === 'rejected' && <Field label="دلیل رد" required error={err.fields.rejectionReason} className="sm:col-span-2" hint="برای گزارش و پاسخ به متقاضی؛ فقط دلایل مرتبط با شغل"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
              </div>
              {target?.kind === 'hired' && <Alert tone="info" className="mt-3">با ثبت استخدام، وضعیت متقاضی «استخدام‌شده» می‌شود و در صورت فعال بودن ماژول پرونده کارکنان، انتقال اطلاعات از آن‌جا (با انتخاب فیلدها) ممکن است.</Alert>}
              <Button className="mt-3" disabled={!stageId} loading={move.isPending} onClick={() => (err.clear(), move.mutate())}>ثبت</Button>
            </section>
            <section>
              <h3 className="mb-2 flex items-center justify-between font-semibold"><span>مصاحبه‌ها</span><Button size="sm" variant="secondary" onClick={() => setScheduling(true)}><Plus className="size-4" /> تعیین مصاحبه</Button></h3>
              {d.interviews.length === 0 ? <p className="text-sm text-muted">مصاحبه‌ای تعیین نشده است.</p> : (
                <ul className="space-y-2 text-sm">
                  {d.interviews.map((i) => {
                    const z = utcToZoned(i.scheduled_at);
                    return (
                      <li key={i.id} className="rounded-md border border-border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span><DayText value={z.date} /> <bdi>{toFaDigits(z.time)}</bdi> · {MODE[i.mode]} · {dir.name(i.interviewer_id)} · {i.form_name}</span>
                          <span className="flex items-center gap-2">
                            {i.status === 'done' ? <><Score value={i.score} />{i.recommendation && <Badge tone={RECOMMENDATION[i.recommendation]!.tone}>{RECOMMENDATION[i.recommendation]!.label}</Badge>}</>
                              : i.status === 'cancelled' ? <Badge>لغوشده</Badge>
                              : <><Badge tone="info">برگزارنشده</Badge><Button size="sm" variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate(i.id)}>لغو</Button></>}
                          </span>
                        </div>
                        {i.notes && <p className="mt-1 whitespace-pre-line text-muted">{i.notes}</p>}
                        {i.status !== 'cancelled' && <Link className="text-xs text-primary underline" to={`${BASE}/interviews/${i.id}`}>فرم ارزیابی</Link>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <section>
              <h3 className="mb-2 font-semibold">تاریخچه</h3>
              <ol className="space-y-1 text-sm">
                {d.events.map((e) => <li key={e.id}><DateText value={e.changed_at} /> — {e.from_stage_id ? `${stage.get(e.from_stage_id)?.name} ← ` : 'ثبت در '}{stage.get(e.to_stage_id)?.name} · {dir.name(e.changed_by)}{e.note && ` · ${e.note}`}</li>)}
              </ol>
            </section>
            {scheduling && <ScheduleInterview appId={id} defaultForm={d.application.interview_form_id} onClose={() => (setScheduling(false), refresh())} />}
          </div>
        )}
      </PageState>
    </Dialog>
  );
}

function ScheduleInterview({ appId, defaultForm, onClose }: { appId: string; defaultForm: string | null; onClose: () => void }) {
  const a = useApi();
  const dir = useDirectory();
  const err = useServerErrors();
  const forms = useQuery({ queryKey: ['recruitment', 'forms'], queryFn: () => a.get<{ id: string; name: string; archived: boolean }[]>('/forms') });
  const [v, setV] = useState({ formId: defaultForm ?? '', interviewerId: '', time: '10:00', mode: 'in_person' });
  const [date, setDate] = useState<string | null>(todayIso());
  const save = useMutation({ mutationFn: () => a.post(`/applications/${appId}/interviews`, { ...v, formId: v.formId || (forms.data ?? []).find((f) => !f.archived)?.id, date }), onSuccess: () => (toast('مصاحبه تعیین و به مصاحبه‌گر اطلاع داده شد'), onClose()), onError: err.set });
  const f = err.fields;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="تعیین مصاحبه"
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!date || !v.interviewerId} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="مصاحبه‌گر" required error={f.interviewerId} className="sm:col-span-2"><Select value={v.interviewerId} onChange={(e) => setV({ ...v, interviewerId: e.target.value })}><option value="">انتخاب کنید</option>{dir.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</Select></Field>
        <Field label="فرم ارزیابی" error={f.formId} className="sm:col-span-2"><Select value={v.formId} onChange={(e) => setV({ ...v, formId: e.target.value })}>{(forms.data ?? []).filter((x) => !x.archived).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
        <Field label="تاریخ" required error={f.date}><DateInput value={date} onChange={setDate} /></Field>
        <Field label="ساعت" required error={f.time}><Input dir="ltr" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} placeholder="10:00" /></Field>
        <Field label="نحوه برگزاری"><Select value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value })}>{Object.entries(MODE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      </div>
    </Dialog>
  );
}
