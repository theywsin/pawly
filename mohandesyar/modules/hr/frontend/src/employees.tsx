import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus, Search, Trash2, UserPlus, Users } from 'lucide-react';
import {
  Alert, Badge, Button, Card, CardHeader, Checkbox, DateInput, DayText, DescriptionList, Dialog, EmptyState, ExportMenu, Field, Input, Ltr, Money, MoneyInput, PageHeader, PageState, Select, Table, Tabs,
  Td, Textarea, Th, toast,
} from '@mohandesyar/ui';
import { useCan, useDirectory, useModule } from '@mohandesyar/module-sdk/web';
import { todayIso } from '@mohandesyar/persian';
import { BASE, CONTRACT_KIND, DEGREE, LEVEL, Nav, RECORD_KIND, SKILL_KIND, fa, useApi, useServerErrors } from './common.js';
import { LeaveList, LeaveRequestDialog, type Balance } from './leave.js';
import { ReviewView, type Review } from './reviews.js';

interface EmployeeRow { id: string; personnel_no: string; full_name: string; department: string; position: string; mobile: string | null; email: string | null; user_id: string | null; manager_user_id: string | null; hired_on: string; ended_on: string | null; status: string; on_leave: boolean }

export function EmployeesPage() {
  const a = useApi();
  const dir = useDirectory();
  const canManage = useCan('hr.employee.manage');
  const recruitmentOn = useModule('recruitment');
  const [status, setStatus] = useState('active');
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState<Prefill | null>(null);
  const [transfer, setTransfer] = useState(false);
  const qs = new URLSearchParams({ status, ...(q ? { q } : {}) }).toString();
  const list = useQuery({ queryKey: ['hr', 'employees', qs], queryFn: () => a.get<EmployeeRow[]>(`/employees?${qs}`) });
  return (
    <>
      <PageHeader
        title="پرونده کارکنان"
        actions={
          <>
            <ExportMenu filename="employees" title="کارکنان" rows={list.data} columns={[
              { header: 'شماره پرسنلی', value: (r) => r.personnel_no }, { header: 'نام', value: (r) => r.full_name }, { header: 'واحد', value: (r) => r.department },
              { header: 'سمت', value: (r) => r.position }, { header: 'مدیر مستقیم', value: (r) => (r.manager_user_id ? dir.name(r.manager_user_id) : '') }, { header: 'همراه', value: (r) => r.mobile },
              { header: 'ایمیل', value: (r) => r.email }, { header: 'وضعیت', value: (r) => (r.status === 'active' ? 'فعال' : 'پایان همکاری') },
            ]} />
            {canManage && recruitmentOn && <Button variant="secondary" onClick={() => setTransfer(true)}><UserPlus className="size-4" /> انتقال از بانک رزومه</Button>}
            {canManage && <Button onClick={() => setCreating({})}><Plus className="size-4" /> کارمند جدید</Button>}
          </>
        }
      />
      <Nav />
      <form className="mb-4 flex flex-wrap items-end gap-3 print:hidden" role="search" onSubmit={(e) => (e.preventDefault(), setQ(term))}>
        <Field label="جست‌وجو"><Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="نام، شماره پرسنلی یا سمت" /></Field>
        <Field label="وضعیت"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="active">فعال</option><option value="left">پایان همکاری</option><option value="all">همه</option></Select></Field>
        <Button type="submit" variant="secondary"><Search className="size-4" /> جست‌وجو</Button>
      </form>
      <PageState query={list} isEmpty={list.data?.length === 0} empty={<EmptyState icon={<Users className="size-8" />} title={q ? 'کارمندی یافت نشد' : 'هنوز پرونده‌ای ثبت نشده است'} action={canManage && !q ? <Button onClick={() => setCreating({})}>ثبت اولین کارمند</Button> : undefined} />}>
        <Table>
          <thead><tr><Th>شماره پرسنلی</Th><Th>نام</Th><Th>واحد</Th><Th>سمت</Th><Th>مدیر مستقیم</Th><Th>تاریخ استخدام</Th><Th>وضعیت</Th></tr></thead>
          <tbody>
            {list.data?.map((e) => (
              <tr key={e.id}>
                <Td><Ltr>{e.personnel_no}</Ltr></Td>
                <Td><Link to={`${BASE}/employees/${e.id}`} className="font-medium text-primary underline-offset-4 hover:underline">{e.full_name}</Link></Td>
                <Td>{e.department || '—'}</Td><Td>{e.position || '—'}</Td><Td>{e.manager_user_id ? dir.name(e.manager_user_id) : '—'}</Td>
                <Td><DayText value={e.hired_on} /></Td>
                <Td>{e.status === 'left' ? <Badge>پایان همکاری</Badge> : e.on_leave ? <Badge tone="warning">در مرخصی</Badge> : <Badge tone="success">فعال</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {creating && <EmployeeForm prefill={creating} onClose={() => setCreating(null)} />}
      {transfer && <TransferDialog onClose={() => setTransfer(false)} onPicked={(p) => (setTransfer(false), setCreating(p))} />}
    </>
  );
}

// ---------------------------------------------------------------- transfer from recruitment

interface Candidate {
  id: string; full_name: string; mobile: string | null; email: string | null; city: string; desired_position: string; expected_salary: string | null; available_from: string | null;
  educations: { degree: string; field: string; institution: string; end_year: number | null }[];
  experiences: { employer: string; title: string; started_on: string; ended_on: string | null; description: string }[];
  skills: { kind: string; name: string; level: number }[];
}
interface Prefill {
  fullName?: string; mobile?: string; email?: string; position?: string; hiredOn?: string; recruitmentCandidateId?: string;
  skills?: { kind: string; name: string; level: number }[];
  records?: { kind: string; occurredOn: string | null; title: string; notes: string }[];
}

/** Nothing moves automatically: the user ticks each field and item to copy (docs/05 hr). */
function TransferDialog({ onClose, onPicked }: { onClose: () => void; onPicked: (p: Prefill) => void }) {
  const a = useApi();
  const hired = useQuery({ queryKey: ['hr', 'transfer', 'hired'], queryFn: () => a.get<{ id: string; full_name: string; job_title: string; hired_on: string }[]>('/transfer/hired') });
  const [cid, setCid] = useState('');
  const c = useQuery({ queryKey: ['hr', 'transfer', cid], queryFn: () => a.get<Candidate>(`/transfer/candidates/${cid}`), enabled: !!cid });
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const on = (k: string) => pick[k] ?? false;
  const toggle = (k: string) => setPick((p) => ({ ...p, [k]: !on(k) }));
  const job = hired.data?.find((h) => h.id === cid);
  const go = () => {
    const d = c.data!;
    onPicked({
      recruitmentCandidateId: d.id,
      fullName: d.full_name,
      mobile: on('mobile') ? (d.mobile ?? '') : '',
      email: on('email') ? (d.email ?? '') : '',
      position: on('position') ? (job?.job_title ?? d.desired_position) : '',
      hiredOn: job?.hired_on,
      skills: d.skills.filter((_, i) => on(`s${i}`)),
      records: [
        ...d.educations.filter((_, i) => on(`ed${i}`)).map((e) => ({ kind: 'education', occurredOn: null, title: `${DEGREE[e.degree]} ${e.field}`, notes: [e.institution, e.end_year ? String(e.end_year) : ''].filter(Boolean).join(' — ') })),
        ...d.experiences.filter((_, i) => on(`ex${i}`)).map((e) => ({ kind: 'prior_experience', occurredOn: e.started_on, title: `${e.title} — ${e.employer}`, notes: e.description })),
      ],
    });
  };
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="انتقال از بانک رزومه"
      description="فقط موارد علامت‌خورده به پرونده کارمند منتقل می‌شوند. حقوق مورد انتظار و سایر اطلاعات حساس منتقل نمی‌شوند."
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!c.data} onClick={go}>ادامه و تکمیل پرونده</Button></>}>
      <PageState query={hired} isEmpty={hired.data?.length === 0} empty={<p className="text-sm text-muted">متقاضی استخدام‌شده‌ای که هنوز پرونده نداشته باشد وجود ندارد.</p>}>
        <Field label="متقاضی استخدام‌شده">
          <Select value={cid} onChange={(e) => (setCid(e.target.value), setPick({}))}>
            <option value="">انتخاب کنید</option>
            {hired.data?.map((h) => <option key={h.id} value={h.id}>{h.full_name} — {h.job_title}</option>)}
          </Select>
        </Field>
        {cid && c.isPending && <p className="mt-3 text-sm text-muted">در حال بارگذاری…</p>}
        {c.data && (
          <div className="mt-4 space-y-4 text-sm">
            <fieldset><legend className="mb-1 font-semibold">اطلاعات تماس و سمت</legend>
              {c.data.mobile && <Checkbox label={<>همراه: <Ltr>{c.data.mobile}</Ltr></>} checked={on('mobile')} onChange={() => toggle('mobile')} />}
              {c.data.email && <Checkbox label={<>ایمیل: <Ltr>{c.data.email}</Ltr></>} checked={on('email')} onChange={() => toggle('email')} />}
              <Checkbox label={`سمت: ${job?.job_title ?? c.data.desired_position}`} checked={on('position')} onChange={() => toggle('position')} />
            </fieldset>
            {c.data.educations.length > 0 && <fieldset><legend className="mb-1 font-semibold">تحصیلات</legend>{c.data.educations.map((e, i) => <Checkbox key={i} label={`${DEGREE[e.degree]} ${e.field}${e.institution ? ` — ${e.institution}` : ''}`} checked={on(`ed${i}`)} onChange={() => toggle(`ed${i}`)} />)}</fieldset>}
            {c.data.experiences.length > 0 && <fieldset><legend className="mb-1 font-semibold">سوابق کاری</legend>{c.data.experiences.map((e, i) => <Checkbox key={i} label={`${e.title} — ${e.employer}`} checked={on(`ex${i}`)} onChange={() => toggle(`ex${i}`)} />)}</fieldset>}
            {c.data.skills.length > 0 && <fieldset><legend className="mb-1 font-semibold">مهارت‌ها</legend>{c.data.skills.map((s, i) => <Checkbox key={i} label={`${SKILL_KIND[s.kind]}: ${s.name} (${LEVEL[s.level]})`} checked={on(`s${i}`)} onChange={() => toggle(`s${i}`)} />)}</fieldset>}
          </div>
        )}
      </PageState>
    </Dialog>
  );
}

// ---------------------------------------------------------------- form

interface EmployeeDetail {
  employee: { id: string; personnel_no: string; full_name: string; national_id: string | null; mobile: string | null; email: string | null; user_id: string | null; recruitment_candidate_id: string | null; department: string; position: string; manager_user_id: string | null; hired_on: string; ended_on: string | null; end_reason: string; status: string; notes: string };
  records: { id: string; kind: string; occurred_on: string | null; title: string; notes: string }[];
  skills: { id: string; kind: string; name: string; level: number }[];
  trainings: { id: string; title: string; provider: string; completed_on: string; hours: number; certificate: string }[];
  leave: { id: string; type_name: string; starts_on: string; ends_on: string; days: number; reason: string; status: string }[];
  reviews: Review[];
  contracts: { id: string; kind: string; starts_on: string; ends_on: string | null; monthly_salary: string | null; weekly_hours: number | null; notes: string }[] | null;
  balances: { year: number; items: Balance[] };
  self: boolean;
}

function EmployeeForm({ employee, prefill, onClose }: { employee?: EmployeeDetail['employee']; prefill?: Prefill; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const nav = useNavigate();
  const dir = useDirectory();
  const err = useServerErrors();
  const e = employee;
  const [v, setV] = useState({
    personnelNo: e?.personnel_no ?? '', fullName: e?.full_name ?? prefill?.fullName ?? '', nationalId: e?.national_id ?? '', mobile: e?.mobile ?? prefill?.mobile ?? '', email: e?.email ?? prefill?.email ?? '',
    userId: e?.user_id ?? '', managerUserId: e?.manager_user_id ?? '', department: e?.department ?? '', position: e?.position ?? prefill?.position ?? '', notes: e?.notes ?? '',
  });
  const [hiredOn, setHiredOn] = useState<string | null>(e?.hired_on ?? prefill?.hiredOn ?? todayIso());
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...v, hiredOn, userId: v.userId || null, managerUserId: v.managerUserId || null, recruitmentCandidateId: prefill?.recruitmentCandidateId ?? null, skills: prefill?.skills ?? [], records: prefill?.records ?? [] };
      return e ? a.put<{ id: string }>(`/employees/${e.id}`, body) : a.post<{ id: string }>('/employees', body);
    },
    onSuccess: (r) => (toast('پرونده ذخیره شد'), void qc.invalidateQueries({ queryKey: ['hr'] }), onClose(), !e && nav(`${BASE}/employees/${r.id}`)),
    onError: err.set,
  });
  const f = err.fields;
  const carried = (prefill?.skills?.length ?? 0) + (prefill?.records?.length ?? 0);
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={e ? 'ویرایش پرونده' : 'کارمند جدید'}
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!hiredOn} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ذخیره</Button></>}>
      {err.banner}
      {prefill?.recruitmentCandidateId && <Alert tone="info" className="mb-4">انتقال از بانک رزومه{carried ? `؛ ${fa(carried)} مورد سوابق و مهارت انتخاب‌شده همراه پرونده ثبت می‌شود.` : '.'}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نام و نام خانوادگی" required error={f.fullName}><Input value={v.fullName} onChange={(x) => set('fullName')(x.target.value)} /></Field>
        <Field label="شماره پرسنلی" required error={f.personnelNo}><Input dir="ltr" value={v.personnelNo} onChange={(x) => set('personnelNo')(x.target.value)} /></Field>
        <Field label="کد ملی" error={f.nationalId} hint="فقط با مجوز پرونده کارکنان دیده می‌شود"><Input dir="ltr" inputMode="numeric" value={v.nationalId} onChange={(x) => set('nationalId')(x.target.value)} /></Field>
        <Field label="تاریخ استخدام" required error={f.hiredOn}><DateInput value={hiredOn} onChange={setHiredOn} /></Field>
        <Field label="واحد"><Input value={v.department} onChange={(x) => set('department')(x.target.value)} /></Field>
        <Field label="سمت"><Input value={v.position} onChange={(x) => set('position')(x.target.value)} /></Field>
        <Field label="همراه" error={f.mobile}><Input dir="ltr" inputMode="tel" value={v.mobile} onChange={(x) => set('mobile')(x.target.value)} /></Field>
        <Field label="ایمیل" error={f.email}><Input dir="ltr" type="email" value={v.email} onChange={(x) => set('email')(x.target.value)} /></Field>
        <Field label="حساب کاربری در سامانه" hint="برای دیدن پرونده خود و درخواست مرخصی" error={f.userId}>
          <Select value={v.userId} onChange={(x) => set('userId')(x.target.value)}><option value="">—</option>{dir.users.map((u) => <option key={u.id} value={u.id}>{u.fullName} ({u.email})</option>)}</Select>
        </Field>
        <Field label="مدیر مستقیم" error={f.managerUserId}>
          <Select value={v.managerUserId} onChange={(x) => set('managerUserId')(x.target.value)}><option value="">—</option>{dir.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</Select>
        </Field>
        <Field label="یادداشت" className="sm:col-span-2"><Textarea rows={2} value={v.notes} onChange={(x) => set('notes')(x.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- detail

export function MyFilePage() {
  const a = useApi();
  const q = useQuery({ queryKey: ['hr', 'me'], queryFn: () => a.get<{ id: string | null }>('/employees/me') });
  if (q.data?.id) return <Navigate to={`${BASE}/employees/${q.data.id}`} replace />;
  return (
    <>
      <PageHeader title="پرونده من" />
      <Nav />
      <PageState query={q}>
        <EmptyState title="پرونده کارمندی به حساب شما متصل نیست" description="از مسئول منابع انسانی بخواهید حساب کاربری شما را در پرونده‌تان ثبت کند." />
      </PageState>
    </>
  );
}

export function EmployeePage() {
  const { id } = useParams();
  const a = useApi();
  const qc = useQueryClient();
  const dir = useDirectory();
  const canManage = useCan('hr.employee.manage');
  const canContract = useCan('hr.contract.manage');
  const [tab, setTab] = useState('profile');
  const [editing, setEditing] = useState(false);
  const [ending, setEnding] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const q = useQuery({ queryKey: ['hr', 'employee', id], queryFn: () => a.get<EmployeeDetail>(`/employees/${id}`) });
  const d = q.data;
  const e = d?.employee;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['hr'] });
  return (
    <>
      {canManage && <Link to={`${BASE}/employees`} className="mb-3 inline-flex items-center gap-1 text-sm text-primary print:hidden"><ArrowRight className="size-4" /> کارکنان</Link>}
      <PageState query={q}>
        {d && e && (
          <>
            <PageHeader
              title={e.full_name}
              description={[e.position, e.department].filter(Boolean).join(' — ') || undefined}
              actions={
                <>
                  {(d.self || canManage) && e.status === 'active' && <Button variant="secondary" onClick={() => setLeaving(true)}>درخواست مرخصی</Button>}
                  {canManage && <Button variant="secondary" onClick={() => setEditing(true)}>ویرایش پرونده</Button>}
                  {canManage && e.status === 'active' && <Button variant="ghost" onClick={() => setEnding(true)}>ثبت پایان همکاری</Button>}
                </>
              }
            />
            {!canManage && <Nav />}
            {e.status === 'left' && <Alert tone="info" className="mb-4">پایان همکاری: <DayText value={e.ended_on} />{e.end_reason && ` — ${e.end_reason}`}</Alert>}
            <Tabs label="بخش‌های پرونده" value={tab} onChange={setTab} items={[
              { key: 'profile', label: 'مشخصات و سوابق', count: d.records.length },
              ...(d.contracts ? [{ key: 'contracts', label: 'قرارداد کاری', count: d.contracts.length }] : []),
              { key: 'skills', label: 'مهارت‌ها و آموزش‌ها', count: d.skills.length + d.trainings.length },
              { key: 'leave', label: 'مرخصی', count: d.leave.length },
              { key: 'reviews', label: 'ارزیابی عملکرد', count: d.reviews.length },
            ]} />
            {tab === 'profile' && (
              <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
                <Card>
                  <CardHeader title="مشخصات" />
                  <div className="p-5">
                    <DescriptionList items={[
                      { label: 'شماره پرسنلی', value: <Ltr>{e.personnel_no}</Ltr> },
                      { label: 'کد ملی', value: e.national_id ? <Ltr>{e.national_id}</Ltr> : '—' },
                      { label: 'تاریخ استخدام', value: <DayText value={e.hired_on} /> },
                      { label: 'مدیر مستقیم', value: e.manager_user_id ? dir.name(e.manager_user_id) : '—' },
                      { label: 'همراه', value: e.mobile ? <Ltr>{e.mobile}</Ltr> : '—' },
                      { label: 'ایمیل', value: e.email ? <Ltr>{e.email}</Ltr> : '—' },
                      { label: 'حساب کاربری', value: e.user_id ? dir.name(e.user_id) : 'متصل نیست' },
                      { label: 'منبع', value: e.recruitment_candidate_id ? 'انتقال از بانک رزومه' : 'ثبت مستقیم' },
                    ]} />
                    {e.notes && <p className="mt-4 whitespace-pre-line text-sm text-muted">{e.notes}</p>}
                  </div>
                </Card>
                <Records id={e.id} records={d.records} canManage={canManage} onChange={refresh} />
              </div>
            )}
            {tab === 'contracts' && d.contracts && <Contracts id={e.id} contracts={d.contracts} canManage={canContract} onChange={refresh} />}
            {tab === 'skills' && <SkillsTrainings d={d} canManage={canManage} onChange={refresh} />}
            {tab === 'leave' && (
              <div className="space-y-4">
                <BalanceCards year={d.balances.year} items={d.balances.items} />
                <LeaveList items={d.leave.map((l) => ({ ...l, full_name: e.full_name }))} showName={false} />
              </div>
            )}
            {tab === 'reviews' && (d.reviews.length ? <div className="space-y-4">{d.reviews.map((r) => <ReviewView key={r.id} review={r} />)}</div> : <p className="text-sm text-muted">ارزیابی عملکردی ثبت نشده است.</p>)}
            {editing && <EmployeeForm employee={e} onClose={() => setEditing(false)} />}
            {ending && <EndDialog id={e.id} onClose={() => (setEnding(false), refresh())} />}
            {leaving && <LeaveRequestDialog employeeId={d.self ? null : e.id} onClose={() => (setLeaving(false), refresh())} />}
          </>
        )}
      </PageState>
    </>
  );
}

export function BalanceCards({ year, items }: { year: number; items: Balance[] }) {
  return (
    <div>
      <h2 className="mb-2 font-semibold">مانده مرخصی سال {fa(year, 0).replace(/٬/g, '')}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {items.map((b) => (
          <div key={b.typeId} className="rounded-lg border border-border bg-surface p-4 text-sm">
            <div className="font-medium">{b.name}{!b.paid && <span className="text-muted"> (بدون حقوق)</span>}</div>
            {b.allowance === null ? <div className="mt-1 text-muted">بدون سقف سالانه · استفاده‌شده {fa(b.approved)} روز</div> : (
              <div className="mt-1"><span className="text-2xl font-bold tabular-nums">{fa(b.remaining)}</span> روز مانده <span className="text-muted">از {fa(b.allowance)} · استفاده {fa(b.approved)}{b.pending ? ` · در انتظار ${fa(b.pending)}` : ''}</span></div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Records({ id, records, canManage, onChange }: { id: string; records: EmployeeDetail['records']; canManage: boolean; onChange: () => void }) {
  const a = useApi();
  const err = useServerErrors();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ kind: 'promotion', title: '', notes: '' });
  const [on, setOn] = useState<string | null>(todayIso());
  const add = useMutation({ mutationFn: () => a.post(`/employees/${id}/records`, { ...v, occurredOn: on }), onSuccess: () => (toast('سابقه ثبت شد'), setOpen(false), setV({ kind: 'promotion', title: '', notes: '' }), onChange()), onError: err.set });
  return (
    <Card>
      <CardHeader title="سوابق" actions={canManage && <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><Plus className="size-4" /> ثبت سابقه</Button>} />
      <div className="p-5">
        {records.length === 0 ? <p className="text-sm text-muted">سابقه‌ای ثبت نشده است.</p> : (
          <ol className="space-y-3 text-sm">
            {records.map((r) => (
              <li key={r.id}>
                <Badge>{RECORD_KIND[r.kind]}</Badge> <span className="font-medium">{r.title}</span>{r.occurred_on && <span className="text-muted"> · <DayText value={r.occurred_on} /></span>}
                {r.notes && <p className="mt-1 whitespace-pre-line text-muted">{r.notes}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
      {open && (
        <Dialog open onOpenChange={setOpen} title="ثبت سابقه" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>انصراف</Button><Button loading={add.isPending} onClick={() => (err.clear(), add.mutate())}>ثبت</Button></>}>
          {err.banner}
          <div className="grid gap-4">
            <Field label="نوع"><Select value={v.kind} onChange={(x) => setV({ ...v, kind: x.target.value })}>{Object.entries(RECORD_KIND).filter(([k]) => k !== 'hire').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="عنوان" required error={err.fields.title}><Input value={v.title} onChange={(x) => setV({ ...v, title: x.target.value })} /></Field>
            <Field label="تاریخ"><DateInput value={on} onChange={setOn} /></Field>
            <Field label="شرح"><Textarea rows={3} value={v.notes} onChange={(x) => setV({ ...v, notes: x.target.value })} /></Field>
          </div>
        </Dialog>
      )}
    </Card>
  );
}

function Contracts({ id, contracts, canManage, onChange }: { id: string; contracts: NonNullable<EmployeeDetail['contracts']>; canManage: boolean; onChange: () => void }) {
  const a = useApi();
  const err = useServerErrors();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ kind: 'fixed_term', monthlySalary: '', weeklyHours: '44', notes: '' });
  const [starts, setStarts] = useState<string | null>(todayIso());
  const [ends, setEnds] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => a.post(`/employees/${id}/contracts`, { kind: v.kind, startsOn: starts, endsOn: ends, monthlySalary: v.monthlySalary ? Number(v.monthlySalary) : null, weeklyHours: v.weeklyHours ? Number(v.weeklyHours) : null, notes: v.notes }),
    onSuccess: () => (toast('قرارداد ثبت شد'), setOpen(false), onChange()),
    onError: err.set,
  });
  const today = todayIso();
  return (
    <>
      <Alert tone="warning" className="mb-4">اطلاعات قرارداد و حقوق محرمانه است و هر مشاهده ثبت می‌شود.</Alert>
      {canManage && <Button className="mb-4" variant="secondary" onClick={() => setOpen(true)}><Plus className="size-4" /> قرارداد جدید</Button>}
      {contracts.length === 0 ? <p className="text-sm text-muted">قراردادی ثبت نشده است.</p> : (
        <Table>
          <thead><tr><Th>نوع</Th><Th>از</Th><Th>تا</Th><Th>حقوق ماهانه</Th><Th>ساعت در هفته</Th><Th>وضعیت</Th></tr></thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.id}>
                <Td>{CONTRACT_KIND[c.kind]}</Td><Td><DayText value={c.starts_on} /></Td><Td>{c.ends_on ? <DayText value={c.ends_on} /> : '—'}</Td>
                <Td>{c.monthly_salary ? <Money value={c.monthly_salary} /> : '—'}</Td><Td>{fa(c.weekly_hours)}</Td>
                <Td>{c.starts_on > today ? <Badge tone="info">آینده</Badge> : c.ends_on && c.ends_on < today ? <Badge>پایان‌یافته</Badge> : <Badge tone="success">جاری</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {open && (
        <Dialog open onOpenChange={setOpen} title="قرارداد کاری جدید" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>انصراف</Button><Button disabled={!starts} loading={add.isPending} onClick={() => (err.clear(), add.mutate())}>ثبت</Button></>}>
          {err.banner}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نوع قرارداد" className="sm:col-span-2"><Select value={v.kind} onChange={(x) => setV({ ...v, kind: x.target.value })}>{Object.entries(CONTRACT_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="شروع" required error={err.fields.startsOn}><DateInput value={starts} onChange={setStarts} /></Field>
            <Field label="پایان" error={err.fields.endsOn}><DateInput value={ends} onChange={setEnds} /></Field>
            <Field label="حقوق ماهانه (ریال)"><MoneyInput value={v.monthlySalary} onChange={(x) => setV({ ...v, monthlySalary: x })} /></Field>
            <Field label="ساعت کار در هفته"><Input inputMode="decimal" value={v.weeklyHours} onChange={(x) => setV({ ...v, weeklyHours: x.target.value.replace(/[^\d.]/g, '') })} /></Field>
            <Field label="توضیحات" className="sm:col-span-2"><Textarea rows={2} value={v.notes} onChange={(x) => setV({ ...v, notes: x.target.value })} /></Field>
          </div>
        </Dialog>
      )}
    </>
  );
}

function SkillsTrainings({ d, canManage, onChange }: { d: EmployeeDetail; canManage: boolean; onChange: () => void }) {
  const a = useApi();
  const err = useServerErrors();
  const [skills, setSkills] = useState<{ kind: string; name: string; level: number }[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [t, setT] = useState({ title: '', provider: '', hours: '', certificate: '' });
  const [on, setOn] = useState<string | null>(todayIso());
  const list = skills ?? d.skills;
  const saveSkills = useMutation({ mutationFn: () => a.put(`/employees/${d.employee.id}/skills`, { skills: list }), onSuccess: () => (toast('مهارت‌ها ذخیره شد'), setSkills(null), onChange()), onError: err.set });
  const addT = useMutation({
    mutationFn: () => a.post(`/employees/${d.employee.id}/trainings`, { ...t, hours: Number(t.hours), completedOn: on }),
    onSuccess: () => (toast('آموزش ثبت شد'), setAdding(false), setT({ title: '', provider: '', hours: '', certificate: '' }), onChange()),
    onError: err.set,
  });
  const removeT = useMutation({ mutationFn: (tid: string) => a.del(`/employees/${d.employee.id}/trainings/${tid}`), onSuccess: () => (toast('حذف شد'), onChange()) });
  const total = d.trainings.reduce((s, x) => s + x.hours, 0);
  return (
    <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
      <Card>
        <CardHeader title="مهارت‌ها" />
        <div className="space-y-2 p-5">
          {err.banner}
          {list.length === 0 && <p className="text-sm text-muted">مهارتی ثبت نشده است.</p>}
          {list.map((s, i) => canManage ? (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <Select aria-label="نوع" value={s.kind} onChange={(x) => setSkills(list.map((y, j) => (j === i ? { ...y, kind: x.target.value } : y)))} className="w-32">{Object.entries(SKILL_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
              <Input aria-label="نام مهارت" value={s.name} onChange={(x) => setSkills(list.map((y, j) => (j === i ? { ...y, name: x.target.value } : y)))} className="w-40" />
              <Select aria-label="سطح" value={s.level} onChange={(x) => setSkills(list.map((y, j) => (j === i ? { ...y, level: Number(x.target.value) } : y)))} className="w-28">{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{LEVEL[n]}</option>)}</Select>
              <Button size="sm" variant="ghost" aria-label={`حذف ${s.name}`} onClick={() => setSkills(list.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
            </div>
          ) : <div key={i} className="text-sm">{SKILL_KIND[s.kind]}: {s.name} <span className="text-muted">· {LEVEL[s.level]}</span></div>)}
          {canManage && (
            <div className="flex gap-2 pt-2">
              <Button size="sm" variant="secondary" onClick={() => setSkills([...list, { kind: 'software', name: '', level: 3 }])}><Plus className="size-4" /> افزودن</Button>
              <Button size="sm" disabled={!skills} loading={saveSkills.isPending} onClick={() => (err.clear(), saveSkills.mutate())}>ذخیره مهارت‌ها</Button>
            </div>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader title="آموزش‌ها" description={`مجموع ${fa(total)} ساعت`} actions={canManage && <Button size="sm" variant="secondary" onClick={() => setAdding(true)}><Plus className="size-4" /> ثبت آموزش</Button>} />
        {d.trainings.length === 0 ? <p className="p-5 text-sm text-muted">آموزشی ثبت نشده است.</p> : (
          <Table>
            <thead><tr><Th>دوره</Th><Th>برگزارکننده</Th><Th>تاریخ</Th><Th>ساعت</Th>{canManage && <Th><span className="sr-only">عملیات</span></Th>}</tr></thead>
            <tbody>{d.trainings.map((x) => <tr key={x.id}><Td>{x.title}{x.certificate && <div className="text-xs text-muted">گواهی: {x.certificate}</div>}</Td><Td>{x.provider || '—'}</Td><Td><DayText value={x.completed_on} /></Td><Td>{fa(x.hours)}</Td>{canManage && <Td><Button size="sm" variant="ghost" aria-label={`حذف ${x.title}`} onClick={() => removeT.mutate(x.id)}><Trash2 className="size-4" /></Button></Td>}</tr>)}</tbody>
          </Table>
        )}
      </Card>
      {adding && (
        <Dialog open onOpenChange={setAdding} title="ثبت آموزش" footer={<><Button variant="ghost" onClick={() => setAdding(false)}>انصراف</Button><Button disabled={!on} loading={addT.isPending} onClick={() => (err.clear(), addT.mutate())}>ثبت</Button></>}>
          {err.banner}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="عنوان دوره" required error={err.fields.title} className="sm:col-span-2"><Input value={t.title} onChange={(x) => setT({ ...t, title: x.target.value })} /></Field>
            <Field label="برگزارکننده"><Input value={t.provider} onChange={(x) => setT({ ...t, provider: x.target.value })} /></Field>
            <Field label="تاریخ پایان دوره" required><DateInput value={on} onChange={setOn} /></Field>
            <Field label="مدت (ساعت)" required error={err.fields.hours}><Input inputMode="decimal" value={t.hours} onChange={(x) => setT({ ...t, hours: x.target.value.replace(/[^\d.]/g, '') })} /></Field>
            <Field label="شماره / مرجع گواهی"><Input value={t.certificate} onChange={(x) => setT({ ...t, certificate: x.target.value })} /></Field>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function EndDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const a = useApi();
  const err = useServerErrors();
  const [on, setOn] = useState<string | null>(todayIso());
  const [reason, setReason] = useState('');
  const save = useMutation({ mutationFn: () => a.post(`/employees/${id}/end`, { endedOn: on, reason }), onSuccess: () => (toast('پایان همکاری ثبت شد'), onClose()), onError: err.set });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="ثبت پایان همکاری" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button variant="danger" disabled={!on} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4">
        <Field label="آخرین روز همکاری" required><DateInput value={on} onChange={setOn} /></Field>
        <Field label="علت"><Input value={reason} onChange={(x) => setReason(x.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
