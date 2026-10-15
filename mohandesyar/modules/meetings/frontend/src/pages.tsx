import { useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, Plus } from 'lucide-react';
import { Alert, Badge, Button, Card, Checkbox, DateInput, DateText, DayText, Dialog, EmptyState, Field, Input, Ltr, PageHeader, PageState, Select, Table, Td, Textarea, Th, toast } from '@mohandesyar/ui';
import { ApiError, useCan, useDirectory, useMe, useModule, useModuleApi } from '@mohandesyar/module-sdk/web';
import { todayIso, utcToZoned } from '@mohandesyar/persian';

const useApi = () => useModuleApi('meetings');
type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const KIND: Record<string, string> = { internal: 'داخلی', client: 'با کارفرما/مشتری', site: 'کارگاهی', board: 'هیئت‌مدیره', coordination: 'هماهنگی', other: 'سایر' };
const STATUS: Record<string, { label: string; tone: Tone }> = { scheduled: { label: 'برنامه‌ریزی‌شده', tone: 'info' }, held: { label: 'برگزارشده', tone: 'success' }, cancelled: { label: 'لغوشده', tone: 'danger' } };
const RES_STATUS: Record<string, { label: string; tone: Tone }> = { open: { label: 'در حال پیگیری', tone: 'warning' }, done: { label: 'انجام‌شده', tone: 'success' }, cancelled: { label: 'لغوشده', tone: 'neutral' } };

function useServerErrors() {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  return {
    fields,
    clear: () => (setFields({}), setGeneral(null)),
    set: (e: unknown) => {
      if (e instanceof ApiError) {
        const d = Array.isArray(e.details) ? (e.details as { path: string; message: string }[]) : [];
        setFields(Object.fromEntries(d.map((x) => [x.path, x.message])));
        setGeneral(e.message);
      } else setGeneral('عملیات انجام نشد؛ دوباره تلاش کنید');
    },
    banner: general ? <Alert tone="danger" className="mb-4">{general}</Alert> : null,
  };
}

function Nav() {
  const link = ({ isActive }: { isActive: boolean }) => `-mb-px border-b-2 px-3 py-2 text-sm ${isActive ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-text'}`;
  return (
    <nav aria-label="بخش‌های جلسات" className="mb-6 flex gap-1 border-b border-border">
      <NavLink to="/app/meetings" end className={link}>جلسات</NavLink>
      <NavLink to="/app/meetings/resolutions" className={link}>پیگیری مصوبات</NavLink>
    </nav>
  );
}

const when = (iso: string) => {
  const s = utcToZoned(iso);
  return <><DayText value={s.date} /> <bdi className="tabular-nums">{s.time.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!)}</bdi></>;
};

interface MeetingRow { id: string; title: string; kind: string; starts_at: string; ends_at: string; location: string; status: string; organizer_id: string; attendees: number; open_resolutions: number }

export function MeetingsPage() {
  const a = useApi();
  const canManage = useCan('meetings.meeting.manage');
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['meetings', 'list'], queryFn: () => a.get<MeetingRow[]>('/meetings') });
  const now = Date.now();
  const upcoming = (q.data ?? []).filter((m) => m.status === 'scheduled' && Date.parse(m.ends_at) >= now).reverse();
  const past = (q.data ?? []).filter((m) => !upcoming.includes(m));
  const table = (list: MeetingRow[]) => (
    <Table>
      <thead><tr><Th>موضوع</Th><Th>نوع</Th><Th>زمان</Th><Th>محل</Th><Th>شرکت‌کنندگان</Th><Th>مصوبات باز</Th><Th>وضعیت</Th></tr></thead>
      <tbody>
        {list.map((m) => (
          <tr key={m.id}>
            <Td><Link to={m.id} className="font-medium text-primary underline-offset-4 hover:underline">{m.title}</Link></Td>
            <Td>{KIND[m.kind]}</Td><Td className="whitespace-nowrap">{when(m.starts_at)}</Td><Td>{m.location || '—'}</Td>
            <Td>{m.attendees.toLocaleString('fa-IR')}</Td><Td>{m.open_resolutions.toLocaleString('fa-IR')}</Td>
            <Td><Badge tone={STATUS[m.status]!.tone}>{STATUS[m.status]!.label}</Badge></Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
  return (
    <>
      <PageHeader title="جلسات و مصوبات" actions={canManage && <Button onClick={() => setCreating(true)}><Plus className="size-4" /> جلسه جدید</Button>} />
      <Nav />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<CalendarDays className="size-8" />} title="هنوز جلسه‌ای ثبت نشده است" action={canManage ? <Button onClick={() => setCreating(true)}>تشکیل اولین جلسه</Button> : undefined} />}>
        <div className="space-y-8">
          <section><h2 className="mb-3 font-semibold">پیش‌رو</h2>{upcoming.length ? table(upcoming) : <p className="text-sm text-muted">جلسه برنامه‌ریزی‌شده‌ای ندارید.</p>}</section>
          <section><h2 className="mb-3 font-semibold">گذشته و لغوشده</h2>{past.length ? table(past) : <p className="text-sm text-muted">—</p>}</section>
        </div>
      </PageState>
      {creating && <MeetingForm onClose={() => setCreating(false)} />}
    </>
  );
}

interface MeetingDetail {
  meeting: { id: string; title: string; kind: string; starts_at: string; ends_at: string; location: string; online_link: string; projects_project_id: string | null; organizer_id: string; status: string; minutes: string; minutes_finalized_at: string | null; minutes_finalized_by: string | null };
  attendees: { id: string; user_id: string | null; external_name: string; external_org: string; attendance: string }[];
  agenda: { id: string; title: string }[];
  resolutions: { id: string; number: number; body: string; owner_id: string; due_on: string | null; status: string; done_on: string | null; follow_up: string }[];
  canManage: boolean;
  project: { id: string; code: string; title: string } | null;
}

function MeetingForm({ meeting, onClose }: { meeting?: MeetingDetail; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const nav = useNavigate();
  const me = useMe();
  const dir = useDirectory();
  const projectsOn = useModule('projects');
  const err = useServerErrors();
  const start = meeting ? utcToZoned(meeting.meeting.starts_at) : { date: todayIso(), time: '09:00' };
  const end = meeting ? utcToZoned(meeting.meeting.ends_at) : { date: todayIso(), time: '10:00' };
  const [v, setV] = useState({
    title: meeting?.meeting.title ?? '', kind: meeting?.meeting.kind ?? 'internal', startTime: start.time, endTime: end.time, location: meeting?.meeting.location ?? '', onlineLink: meeting?.meeting.online_link ?? '',
    projectId: meeting?.meeting.projects_project_id ?? '',
  });
  const [date, setDate] = useState<string | null>(start.date);
  const [attendees, setAttendees] = useState<string[]>(meeting ? meeting.attendees.filter((x) => x.user_id && x.user_id !== me.user.id).map((x) => x.user_id!) : []);
  const [externals, setExternals] = useState(meeting ? meeting.attendees.filter((x) => !x.user_id).map((x) => `${x.external_name}${x.external_org ? ` | ${x.external_org}` : ''}`).join('\n') : '');
  const [agenda, setAgenda] = useState(meeting ? meeting.agenda.map((x) => x.title).join('\n') : '');
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...v, date, projectId: v.projectId || null, attendeeIds: attendees,
        externalAttendees: externals.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => ({ name: l.split('|')[0]!.trim(), org: (l.split('|')[1] ?? '').trim() })),
        agenda: agenda.split('\n').map((l) => l.trim()).filter(Boolean),
      };
      return meeting ? a.put<{ id: string }>(`/meetings/${meeting.meeting.id}`, body) : a.post<{ id: string }>('/meetings', body);
    },
    onSuccess: (r) => {
      toast(meeting ? 'جلسه ذخیره شد' : 'جلسه تشکیل و دعوت‌نامه‌ها ارسال شد');
      void qc.invalidateQueries({ queryKey: ['meetings'] });
      void qc.invalidateQueries({ queryKey: ['widget'] });
      onClose();
      if (!meeting) nav(`/app/meetings/${r.id}`);
    },
    onError: err.set,
  });
  const f = err.fields;
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={meeting ? 'ویرایش جلسه' : 'جلسه جدید'}
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} disabled={!date} onClick={() => (err.clear(), save.mutate())}>ذخیره و ارسال دعوت</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="موضوع" required error={f.title} className="sm:col-span-2"><Input value={v.title} onChange={(e) => set('title')(e.target.value)} /></Field>
        <Field label="نوع جلسه"><Select value={v.kind} onChange={(e) => set('kind')(e.target.value)}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="تاریخ" required error={date === null ? 'تاریخ معتبر نیست' : f.date}><DateInput value={date ?? undefined} onChange={setDate} /></Field>
        <Field label="ساعت شروع" required error={f.startTime}><Input type="time" dir="ltr" value={v.startTime} onChange={(e) => set('startTime')(e.target.value)} /></Field>
        <Field label="ساعت پایان" required error={f.endTime}><Input type="time" dir="ltr" value={v.endTime} onChange={(e) => set('endTime')(e.target.value)} /></Field>
        <Field label="محل" error={f.location}><Input value={v.location} onChange={(e) => set('location')(e.target.value)} /></Field>
        <Field label="نشانی جلسه آنلاین" error={f.onlineLink}><Input dir="ltr" value={v.onlineLink} onChange={(e) => set('onlineLink')(e.target.value)} /></Field>
        {projectsOn && <ProjectSelect value={v.projectId} onChange={set('projectId')} />}
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium">دعوت از همکاران</legend>
          <div className="grid max-h-40 gap-2 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-2">
            {dir.users.filter((u) => u.id !== me.user.id).map((u) => (
              <Checkbox key={u.id} label={u.fullName} checked={attendees.includes(u.id)} onChange={(e) => setAttendees((s) => (e.target.checked ? [...s, u.id] : s.filter((x) => x !== u.id)))} />
            ))}
          </div>
        </fieldset>
        <Field label="مدعوین خارج از سازمان" hint="هر نفر در یک سطر؛ سازمان را بعد از | بنویسید" error={f.externalAttendees}><Textarea value={externals} onChange={(e) => setExternals(e.target.value)} /></Field>
        <Field label="دستور جلسه" hint="هر بند در یک سطر" error={f.agenda}><Textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

/** Projects come through this module's lookup (backed by the projects module's public service). */
function ProjectSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const a = useApi();
  const q = useQuery({ queryKey: ['meetings', 'projects-lookup'], queryFn: () => a.get<{ id: string; code: string; title: string }[]>('/lookups/projects?q=') });
  return (
    <Field label="پروژه مرتبط">
      <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={!q.data}>
        <option value="">— بدون پروژه —</option>
        {q.data?.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.title}</option>)}
      </Select>
    </Field>
  );
}

export function MeetingPage() {
  const { id = '' } = useParams();
  const a = useApi();
  const qc = useQueryClient();
  const dir = useDirectory();
  const q = useQuery({ queryKey: ['meetings', 'detail', id], queryFn: () => a.get<MeetingDetail>(`/meetings/${id}`) });
  const [editing, setEditing] = useState(false);
  const [minutes, setMinutes] = useState<string | null>(null);
  const [attendance, setAttendance] = useState<Record<string, string>>({});
  const [resolution, setResolution] = useState(false);
  const [updating, setUpdating] = useState<Resolution | null>(null);
  const refresh = () => (void qc.invalidateQueries({ queryKey: ['meetings'] }), void qc.invalidateQueries({ queryKey: ['widget'] }));
  const act = useMutation({
    mutationFn: ({ path, method = 'post', body }: { path: string; method?: 'post' | 'put'; body?: unknown }) => (method === 'put' ? a.put(path, body) : a.post(path, body)),
    onSuccess: () => (toast('ذخیره شد'), refresh()),
    onError: (e) => toast(e instanceof ApiError ? e.message : 'انجام نشد', 'danger'),
  });
  const today = todayIso();
  return (
    <PageState query={q}>
      {q.data && (() => {
        const m = q.data.meeting;
        const locked = !!m.minutes_finalized_at || m.status === 'cancelled';
        const text = minutes ?? m.minutes;
        const name = (x: MeetingDetail['attendees'][number]) => (x.user_id ? dir.name(x.user_id) : `${x.external_name}${x.external_org ? ` (${x.external_org})` : ''}`);
        return (
          <>
            <Link to="/app/meetings" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ArrowRight className="size-4" /> جلسات</Link>
            <PageHeader
              title={<span className="flex flex-wrap items-center gap-3">{m.title} <Badge tone={STATUS[m.status]!.tone}>{STATUS[m.status]!.label}</Badge></span>}
              description={<>{KIND[m.kind]} · {when(m.starts_at)} تا {utcToZoned(m.ends_at).time.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!)}{m.location && ` · ${m.location}`} · برگزارکننده: {dir.name(m.organizer_id)}{q.data.project && <> · پروژه: <Link className="text-primary underline" to={`/app/projects/${q.data.project.id}`}>{q.data.project.code}</Link></>}</>}
              actions={q.data.canManage && m.status === 'scheduled' && (
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setEditing(true)}>ویرایش</Button>
                  <Button variant="ghost" onClick={() => act.mutate({ path: `/meetings/${m.id}/cancel` })}>لغو جلسه</Button>
                </div>
              )}
            />
            {m.online_link && <p className="mb-4 text-sm">جلسه آنلاین: <a className="text-primary underline" href={m.online_link} target="_blank" rel="noreferrer noopener"><Ltr>{m.online_link}</Ltr></a></p>}
            <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
              <div className="space-y-6">
                <Card className="p-5">
                  <h2 className="mb-3 font-semibold">دستور جلسه</h2>
                  {q.data.agenda.length ? <ol className="list-inside list-decimal space-y-1 text-sm">{q.data.agenda.map((x) => <li key={x.id}>{x.title}</li>)}</ol> : <p className="text-sm text-muted">تعیین نشده است.</p>}
                </Card>
                <Card className="p-5">
                  <h2 className="mb-3 font-semibold">شرکت‌کنندگان</h2>
                  <ul className="space-y-2 text-sm">
                    {q.data.attendees.map((x) => (
                      <li key={x.id} className="flex items-center justify-between gap-2">
                        <span>{name(x)}</span>
                        {q.data!.canManage && !locked ? (
                          <Select aria-label={`حضور ${name(x)}`} className="h-8 w-28 text-xs" value={attendance[x.id] ?? x.attendance} onChange={(e) => setAttendance((s) => ({ ...s, [x.id]: e.target.value }))}>
                            <option value="unknown">نامشخص</option><option value="present">حاضر</option><option value="absent">غایب</option>
                          </Select>
                        ) : <Badge tone={x.attendance === 'present' ? 'success' : x.attendance === 'absent' ? 'danger' : 'neutral'}>{x.attendance === 'present' ? 'حاضر' : x.attendance === 'absent' ? 'غایب' : 'نامشخص'}</Badge>}
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
              <div className="space-y-6">
                <Card className="p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="font-semibold">صورت‌جلسه</h2>
                    {m.minutes_finalized_at && <span className="text-xs text-muted">نهایی‌شده توسط {dir.name(m.minutes_finalized_by)} · <DateText value={m.minutes_finalized_at} /></span>}
                  </div>
                  {q.data.canManage && !locked ? (
                    <>
                      <Textarea aria-label="متن صورت‌جلسه" rows={8} value={text} onChange={(e) => setMinutes(e.target.value)} />
                      <div className="mt-3 flex gap-2">
                        <Button variant="secondary" loading={act.isPending} onClick={() => act.mutate({ path: `/meetings/${m.id}/minutes`, method: 'put', body: { minutes: text, attendance } })}>ذخیره پیش‌نویس</Button>
                        <Button loading={act.isPending} onClick={() => act.mutate({ path: `/meetings/${m.id}/minutes?finalize=1`, method: 'put', body: { minutes: text, attendance } })}>نهایی کردن صورت‌جلسه</Button>
                      </div>
                      <p className="mt-2 text-xs text-muted">پس از نهایی شدن، صورت‌جلسه و فهرست مصوبات قابل تغییر نیست؛ پیگیری مصوبات ادامه دارد.</p>
                    </>
                  ) : m.minutes ? <p className="whitespace-pre-line leading-8">{m.minutes}</p> : <p className="text-sm text-muted">صورت‌جلسه‌ای ثبت نشده است.</p>}
                </Card>
                <Card className="p-5">
                  <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">مصوبات</h2>{q.data.canManage && !locked && <Button size="sm" onClick={() => setResolution(true)}><Plus className="size-4" /> مصوبه</Button>}</div>
                  {!q.data.resolutions.length ? <p className="text-sm text-muted">مصوبه‌ای ثبت نشده است.</p> : <Resolutions items={q.data.resolutions.map((r) => ({ ...r, meeting_id: m.id }))} today={today} onUpdate={setUpdating} />}
                </Card>
              </div>
            </div>
            {editing && <MeetingForm meeting={q.data} onClose={() => setEditing(false)} />}
            {resolution && <ResolutionDialog meetingId={m.id} onClose={() => setResolution(false)} />}
            {updating && <UpdateResolutionDialog resolution={updating} onClose={() => setUpdating(null)} />}
          </>
        );
      })()}
    </PageState>
  );
}

type Resolution = MeetingDetail['resolutions'][number] & { meeting_id: string; meeting_title?: string };

function Resolutions({ items, today, onUpdate, showMeeting }: { items: Resolution[]; today: string; onUpdate: (r: Resolution) => void; showMeeting?: boolean }) {
  const dir = useDirectory();
  const me = useMe();
  const canAll = useCan('meetings.resolution.update');
  return (
    <Table>
      <thead><tr><Th>#</Th><Th>مصوبه</Th>{showMeeting && <Th>جلسه</Th>}<Th>مسئول</Th><Th>مهلت</Th><Th>وضعیت</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
      <tbody>
        {items.map((r) => (
          <tr key={r.id}>
            <Td>{r.number.toLocaleString('fa-IR')}</Td>
            <Td><p>{r.body}</p>{r.follow_up && <p className="mt-1 text-xs text-muted">پیگیری: {r.follow_up}</p>}</Td>
            {showMeeting && <Td><Link className="text-primary underline-offset-4 hover:underline" to={`/app/meetings/${r.meeting_id}`}>{r.meeting_title}</Link></Td>}
            <Td>{dir.name(r.owner_id)}</Td>
            <Td className="whitespace-nowrap"><DayText value={r.due_on} />{r.status === 'open' && r.due_on && r.due_on < today && <Badge tone="danger" className="ms-1">معوق</Badge>}</Td>
            <Td><Badge tone={RES_STATUS[r.status]!.tone}>{RES_STATUS[r.status]!.label}</Badge>{r.done_on && <span className="ms-1 text-xs text-muted"><DayText value={r.done_on} /></span>}</Td>
            <Td>{(canAll || r.owner_id === me.user.id) && <Button size="sm" variant="secondary" onClick={() => onUpdate(r)}>پیگیری</Button>}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function SimpleDialog({ title, path, method, body, onClose, children, disabled }: { title: string; path: string; method: 'post' | 'put'; body: () => unknown; onClose: () => void; children: (f: Record<string, string>) => ReactNode; disabled?: boolean }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const m = useMutation({
    mutationFn: () => (method === 'put' ? a.put(path, body()) : a.post(path, body())),
    onSuccess: () => (toast('ذخیره شد'), void qc.invalidateQueries({ queryKey: ['meetings'] }), void qc.invalidateQueries({ queryKey: ['widget'] }), onClose()),
    onError: err.set,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={title} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={m.isPending} disabled={disabled} onClick={() => (err.clear(), m.mutate())}>ذخیره</Button></>}>
      {err.banner}
      <div className="grid gap-4">{children(err.fields)}</div>
    </Dialog>
  );
}

function ResolutionDialog({ meetingId, onClose }: { meetingId: string; onClose: () => void }) {
  const dir = useDirectory();
  const [body, setBody] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [due, setDue] = useState<string | null>('');
  return (
    <SimpleDialog title="ثبت مصوبه" method="post" path={`/meetings/${meetingId}/resolutions`} onClose={onClose} disabled={due === null || !ownerId} body={() => ({ body, ownerId, dueOn: due || null })}>
      {(f) => (
        <>
          <Field label="متن مصوبه" required error={f.body}><Textarea value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          <Field label="مسئول اجرا" required error={f.ownerId}>
            <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}><option value="">— انتخاب کنید —</option>{dir.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</Select>
          </Field>
          <Field label="مهلت" error={due === null ? 'تاریخ معتبر نیست' : f.dueOn}><DateInput value={due ?? undefined} onChange={setDue} /></Field>
        </>
      )}
    </SimpleDialog>
  );
}

function UpdateResolutionDialog({ resolution, onClose }: { resolution: Resolution; onClose: () => void }) {
  const [status, setStatus] = useState(resolution.status === 'open' ? 'done' : resolution.status);
  const [doneOn, setDoneOn] = useState<string | null>(resolution.done_on ?? todayIso());
  const [followUp, setFollowUp] = useState(resolution.follow_up);
  return (
    <SimpleDialog title={`پیگیری مصوبه ${resolution.number.toLocaleString('fa-IR')}`} method="put" path={`/resolutions/${resolution.id}`} onClose={onClose} disabled={status === 'done' && !doneOn}
      body={() => ({ status, doneOn: status === 'done' ? doneOn : null, followUp })}>
      {(f) => (
        <>
          <p className="text-sm">{resolution.body}</p>
          <Field label="وضعیت"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">در حال پیگیری</option><option value="done">انجام شد</option><option value="cancelled">لغو شد</option></Select></Field>
          {status === 'done' && <Field label="تاریخ انجام" required error={doneOn === null ? 'تاریخ معتبر نیست' : f.doneOn}><DateInput value={doneOn ?? undefined} onChange={setDoneOn} /></Field>}
          <Field label="گزارش پیگیری" error={f.followUp}><Textarea value={followUp} onChange={(e) => setFollowUp(e.target.value)} /></Field>
        </>
      )}
    </SimpleDialog>
  );
}

export function ResolutionsPage() {
  const a = useApi();
  const [status, setStatus] = useState('open');
  const [mine, setMine] = useState(false);
  const [updating, setUpdating] = useState<Resolution | null>(null);
  const params = new URLSearchParams({ ...(status && { status }), ...(mine && { mine: '1' }) }).toString();
  const q = useQuery({ queryKey: ['meetings', 'resolutions', params], queryFn: () => a.get<Resolution[]>(`/resolutions?${params}`) });
  return (
    <>
      <PageHeader title="پیگیری مصوبات" />
      <Nav />
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="w-48">
          <Select aria-label="وضعیت مصوبه" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open">در حال پیگیری</option><option value="overdue">معوق</option><option value="done">انجام‌شده</option><option value="cancelled">لغوشده</option><option value="">همه</option>
          </Select>
        </div>
        <Checkbox label="فقط مصوبات من" checked={mine} onChange={(e) => setMine(e.target.checked)} />
      </div>
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState title={status === 'overdue' ? 'مصوبه معوقی وجود ندارد' : 'مصوبه‌ای یافت نشد'} />}>
        {q.data && <Resolutions items={q.data} today={todayIso()} onUpdate={setUpdating} showMeeting />}
      </PageState>
      {updating && <UpdateResolutionDialog resolution={updating} onClose={() => setUpdating(null)} />}
    </>
  );
}
