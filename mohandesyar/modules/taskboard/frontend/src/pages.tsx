import { useState } from 'react';
import { NavLink } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, ListChecks } from 'lucide-react';
import { Alert, Badge, Button, Card, Checkbox, DateInput, DayText, Dialog, EmptyState, ExportMenu, Field, Input, PageHeader, PageState, Select, Stat, Table, Tabs, Td, Textarea, Th, toast } from '@mohandesyar/ui';
import { ApiError, useCan, useDirectory, useMe, useModuleApi } from '@mohandesyar/module-sdk/web';
import { addDays, todayIso, utcToZoned } from '@mohandesyar/persian';

const useApi = () => useModuleApi('taskboard');
type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const STATUS: Record<string, { label: string; tone: Tone }> = {
  todo: { label: 'انجام‌نشده', tone: 'warning' },
  done: { label: 'منتظر بازبینی', tone: 'info' },
  approved: { label: 'تأییدشده', tone: 'success' },
  returned: { label: 'برگشت برای اصلاح', tone: 'danger' },
  cancelled: { label: 'لغوشده', tone: 'neutral' },
};
const PRIORITY: Record<string, string> = { low: 'کم', normal: 'عادی', high: 'فوری' };
const RECURRENCE: Record<string, string> = { daily: 'هر روز', weekly: 'هفتگی', monthly: 'ماهانه' };
// JS weekdays in Iranian order (Saturday first)
const WEEKDAYS: [number, string][] = [[6, 'شنبه'], [0, 'یکشنبه'], [1, 'دوشنبه'], [2, 'سه‌شنبه'], [3, 'چهارشنبه'], [4, 'پنجشنبه'], [5, 'جمعه']];
const fa = (n: number | null | undefined, suffix = '') => (n === null || n === undefined ? '—' : `${n.toLocaleString('fa-IR')}${suffix}`);
const faTime = (t: string) => t.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!);
const clock = (iso: string) => <bdi className="tabular-nums">{faTime(utcToZoned(iso).time)}</bdi>;
const when = (iso: string) => <><DayText value={utcToZoned(iso).date} /> {clock(iso)}</>;

function errorText(e: unknown) {
  return e instanceof ApiError ? e.message : 'عملیات انجام نشد؛ دوباره تلاش کنید';
}
function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || !Array.isArray(e.details)) return {};
  return Object.fromEntries((e.details as { path: string; message: string }[]).map((x) => [x.path, x.message]));
}

function useRefresh() {
  const qc = useQueryClient();
  return () => (void qc.invalidateQueries({ queryKey: ['taskboard'] }), void qc.invalidateQueries({ queryKey: ['widget'] }));
}

function Nav() {
  const manager = useCan('taskboard.manage');
  const link = ({ isActive }: { isActive: boolean }) => `-mb-px border-b-2 px-3 py-2 text-sm ${isActive ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted hover:text-text'}`;
  return (
    <nav aria-label="بخش‌های تسک منیجر" className="mb-6 flex gap-1 border-b border-border">
      <NavLink to="/app/taskboard" end className={link}>روز من</NavLink>
      <NavLink to="/app/taskboard/history" className={link}>سابقه و کارنامه من</NavLink>
      {manager && <NavLink to="/app/taskboard/team" className={link}>مدیریت کارکنان</NavLink>}
    </nav>
  );
}

interface Task {
  id: string; title: string; description: string; assignee_id: string; created_by: string; duty_id: string | null; due_at: string; priority: string; status: string;
  done_at: string | null; done_note: string; score: number | null; review_note: string;
}
interface Attendance { id: string; user_id?: string; day: string; check_in: string; check_out: string | null; late_minutes: number; note: string }
interface Report { id: string; user_id?: string; day: string; body: string; hours: number | null; score: number | null; review_note: string }
interface Today { today: string; workingDay: boolean; settings: { workStart: string; workEnd: string; graceMinutes: number }; attendance: Attendance | null; tasks: Task[]; report: Report | null }

// ---------------------------------------------------------------- my day

export function MyDayPage() {
  const a = useApi();
  const refresh = useRefresh();
  const q = useQuery({ queryKey: ['taskboard', 'today'], queryFn: () => a.get<Today>('/me/today') });
  const [doneFor, setDoneFor] = useState<Task | null>(null);
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => a.post(path, body ?? {}),
    onSuccess: () => (toast('ثبت شد'), refresh()),
    onError: (e) => toast(errorText(e), 'danger'),
  });
  return (
    <>
      <PageHeader title="کارهای من و حضور" />
      <Nav />
      <PageState query={q}>
        {q.data && (() => {
          const d = q.data;
          const att = d.attendance;
          return (
            <div className="space-y-6">
              <Card>
                <h2 className="mb-3 font-semibold">حضور امروز — <DayText value={d.today} /></h2>
                {!d.workingDay && <Alert tone="info" className="mb-3">امروز در تقویم کاری سازمان روز تعطیل است.</Alert>}
                <p className="mb-3 text-sm text-muted">ساعت کاری: <bdi>{faTime(d.settings.workStart)}</bdi> تا <bdi>{faTime(d.settings.workEnd)}</bdi> · مهلت ورود {fa(d.settings.graceMinutes)} دقیقه</p>
                <div className="flex flex-wrap items-center gap-3">
                  {att ? (
                    <>
                      <span>ورود: {clock(att.check_in)}</span>
                      {att.late_minutes > 0 ? <Badge tone="danger">{fa(att.late_minutes)} دقیقه تأخیر</Badge> : <Badge tone="success">به‌موقع</Badge>}
                      {att.check_out ? <span>خروج: {clock(att.check_out)}</span> : <Button variant="secondary" loading={act.isPending} onClick={() => act.mutate({ path: '/attendance/check-out' })}>ثبت خروج</Button>}
                    </>
                  ) : (
                    <Button loading={act.isPending} onClick={() => act.mutate({ path: '/attendance/check-in' })}>ثبت ورود (حضور)</Button>
                  )}
                </div>
              </Card>

              <section>
                <h2 className="mb-3 font-semibold">کارهای امروز و عقب‌افتاده</h2>
                {d.tasks.length === 0 ? (
                  <EmptyState icon={<ListChecks className="size-8" />} title="برای امروز کاری به شما سپرده نشده است" />
                ) : (
                  <ul className="space-y-2">
                    {d.tasks.map((t) => {
                      const overdue = (t.status === 'todo' || t.status === 'returned') && Date.parse(t.due_at) < Date.now();
                      const checked = t.status === 'done' || t.status === 'approved';
                      return (
                        <li key={t.id} className="rounded-lg border border-border bg-surface p-3">
                          <div className="flex flex-wrap items-start gap-3">
                            <Checkbox
                              label={<span className={checked ? 'line-through text-muted' : 'font-medium'}>{t.title}</span>}
                              checked={checked}
                              disabled={t.status === 'approved' || act.isPending}
                              onChange={(e) => (e.target.checked ? setDoneFor(t) : act.mutate({ path: `/tasks/${t.id}/undo` }))}
                            />
                            <span className="ms-auto flex flex-wrap items-center gap-2 text-sm">
                              <span className={overdue ? 'text-danger' : 'text-muted'}>مهلت: {when(t.due_at)}</span>
                              {t.priority === 'high' && <Badge tone="danger">فوری</Badge>}
                              {t.duty_id && <Badge tone="neutral">وظیفه ثابت</Badge>}
                              <Badge tone={STATUS[t.status]!.tone}>{STATUS[t.status]!.label}</Badge>
                              {t.score !== null && <Badge tone="success">نمره {fa(t.score)} از ۵</Badge>}
                            </span>
                          </div>
                          {t.description && <p className="mt-2 whitespace-pre-line text-sm text-muted">{t.description}</p>}
                          {t.review_note && <p className="mt-2 text-sm">نظر مدیر: {t.review_note}</p>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <ReportCard report={d.report} />
            </div>
          );
        })()}
      </PageState>
      {doneFor && <DoneDialog task={doneFor} onClose={() => setDoneFor(null)} />}
    </>
  );
}

function DoneDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const a = useApi();
  const refresh = useRefresh();
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => a.post(`/tasks/${task.id}/done`, { note }),
    onSuccess: () => (toast('کار انجام‌شده ثبت شد'), refresh(), onClose()),
    onError: (e) => toast(errorText(e), 'danger'),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`انجام شد: ${task.title}`}
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={m.isPending} onClick={() => m.mutate()}>ثبت انجام</Button></>}>
      <Field label="توضیح (اختیاری)" hint="مثلاً نتیجه کار یا نکته‌ای برای مدیر"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Dialog>
  );
}

function ReportCard({ report }: { report: Report | null }) {
  const a = useApi();
  const refresh = useRefresh();
  const [body, setBody] = useState(report?.body ?? '');
  const [hours, setHours] = useState(report?.hours ? String(report.hours) : '');
  const save = useMutation({
    mutationFn: () => a.put('/reports/today', { body, hours: hours ? Number(hours) : null }),
    onSuccess: () => (toast('گزارش کار ذخیره شد'), refresh()),
    onError: (e) => toast(errorText(e), 'danger'),
  });
  const f = fieldErrors(save.error);
  const locked = report?.score != null;
  return (
    <Card>
      <h2 className="mb-3 font-semibold">گزارش کار امروز</h2>
      {locked && <Alert tone="success" className="mb-3">مدیر به این گزارش نمره {fa(report!.score)} از ۵ داده است{report!.review_note ? `: ${report!.review_note}` : ''}.</Alert>}
      <div className="grid gap-4">
        <Field label="شرح کارهای انجام‌شده" required error={f.body}><Textarea rows={5} value={body} disabled={locked} onChange={(e) => setBody(e.target.value)} /></Field>
        <Field label="ساعت کار مفید" hint="اختیاری؛ با گام نیم ساعت" error={f.hours}><Input type="number" dir="ltr" min={0.5} max={24} step={0.5} value={hours} disabled={locked} onChange={(e) => setHours(e.target.value)} className="max-w-32" /></Field>
        {!locked && <div><Button loading={save.isPending} onClick={() => save.mutate()}>{report ? 'به‌روزرسانی گزارش' : 'ثبت گزارش'}</Button></div>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- history + scorecard (own)

interface Score {
  userId: string; onTimeRate: number | null; averageScore: number | null; attendanceRate: number | null; reportRate: number | null; performance: number | null;
  tasks: number; onTime: number; late: number; missed: number; workingDays: number; presentDays: number; lateDays: number; reports: number;
}

function useRange() {
  const [from, setFrom] = useState<string | null>(addDays(todayIso(), -29));
  const [to, setTo] = useState<string | null>(todayIso());
  const ok = !!from && !!to && from <= to;
  const picker = (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <Field label="از تاریخ"><DateInput value={from ?? undefined} onChange={setFrom} /></Field>
      <Field label="تا تاریخ" error={from && to && from > to ? 'پایان پیش از شروع است' : undefined}><DateInput value={to ?? undefined} onChange={setTo} /></Field>
    </div>
  );
  return { from, to, ok, qs: `from=${from}&to=${to}`, picker };
}

export function HistoryPage() {
  const a = useApi();
  const r = useRange();
  const card = useQuery({ queryKey: ['taskboard', 'scorecard', 'me', r.qs], enabled: r.ok, queryFn: () => a.get<Score[]>(`/scorecard?${r.qs}`) });
  const tasks = useQuery({ queryKey: ['taskboard', 'tasks', 'mine', r.qs], enabled: r.ok, queryFn: () => a.get<Task[]>(`/tasks?scope=mine&${r.qs}`) });
  const att = useQuery({ queryKey: ['taskboard', 'attendance', 'me', r.qs], enabled: r.ok, queryFn: () => a.get<Attendance[]>(`/attendance?${r.qs}`) });
  const reps = useQuery({ queryKey: ['taskboard', 'reports', 'me', r.qs], enabled: r.ok, queryFn: () => a.get<Report[]>(`/reports?${r.qs}`) });
  return (
    <>
      <PageHeader title="سابقه و کارنامه من" />
      <Nav />
      {r.picker}
      <PageState query={card}>{card.data?.[0] && <ScoreStats s={card.data[0]} />}</PageState>
      <h2 className="mb-3 mt-6 font-semibold">کارها</h2>
      <PageState query={tasks} isEmpty={tasks.data?.length === 0} empty={<p className="text-sm text-muted">در این بازه کاری ندارید.</p>}>
        <TaskTable tasks={tasks.data ?? []} />
      </PageState>
      <h2 className="mb-3 mt-6 font-semibold">حضور</h2>
      <PageState query={att} isEmpty={att.data?.length === 0} empty={<p className="text-sm text-muted">در این بازه حضوری ثبت نشده است.</p>}>
        <AttendanceTable rows={att.data ?? []} />
      </PageState>
      <h2 className="mb-3 mt-6 font-semibold">گزارش‌های کار</h2>
      <PageState query={reps} isEmpty={reps.data?.length === 0} empty={<p className="text-sm text-muted">در این بازه گزارشی ننوشته‌اید.</p>}>
        <ReportTable rows={reps.data ?? []} />
      </PageState>
    </>
  );
}

function ScoreStats({ s }: { s: Score }) {
  return (
    <div className="grid gap-3 sm:grid-cols-5">
      <Stat label="امتیاز عملکرد کلی" hint="از ۱۰۰">{fa(s.performance)}</Stat>
      <Stat label="انجام در مهلت" hint={`${fa(s.onTime)} از ${fa(s.tasks)} کار`}>{fa(s.onTimeRate, '٪')}</Stat>
      <Stat label="میانگین نمره" hint="از ۱۰۰">{fa(s.averageScore)}</Stat>
      <Stat label="ورود به‌موقع" hint={`${fa(s.presentDays - s.lateDays)} از ${fa(s.workingDays)} روز کاری`}>{fa(s.attendanceRate, '٪')}</Stat>
      <Stat label="گزارش کار" hint={`${fa(s.reports)} گزارش`}>{fa(s.reportRate, '٪')}</Stat>
    </div>
  );
}

function TaskTable({ tasks, team, onReview, onCancel }: { tasks: Task[]; team?: boolean; onReview?: (t: Task) => void; onCancel?: (t: Task) => void }) {
  const dir = useDirectory();
  return (
    <Table>
      <thead><tr><Th>کار</Th>{team && <Th>مسئول</Th>}<Th>مهلت</Th><Th>انجام</Th><Th>وضعیت</Th><Th>نمره</Th>{team && <Th>عملیات</Th>}</tr></thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t.id}>
            <Td><span className="font-medium">{t.title}</span>{t.done_note && <p className="text-xs text-muted">{t.done_note}</p>}</Td>
            {team && <Td>{dir.name(t.assignee_id)}</Td>}
            <Td className="whitespace-nowrap">{when(t.due_at)}</Td>
            <Td className="whitespace-nowrap">{t.done_at ? <span className={Date.parse(t.done_at) > Date.parse(t.due_at) ? 'text-danger' : ''}>{when(t.done_at)}</span> : '—'}</Td>
            <Td><Badge tone={STATUS[t.status]!.tone}>{STATUS[t.status]!.label}</Badge></Td>
            <Td>{t.score !== null ? `${fa(t.score)} از ۵` : '—'}</Td>
            {team && (
              <Td className="whitespace-nowrap">
                {t.status === 'done' && <Button size="sm" onClick={() => onReview?.(t)}>بازبینی و نمره</Button>}
                {(t.status === 'todo' || t.status === 'returned' || t.status === 'done') && <Button size="sm" variant="ghost" onClick={() => onCancel?.(t)}>لغو</Button>}
              </Td>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function AttendanceTable({ rows, team }: { rows: Attendance[]; team?: boolean }) {
  const dir = useDirectory();
  return (
    <>
      <ExportMenu filename="attendance" title="حضور و تأخیر" rows={rows} columns={[
        ...(team ? [{ header: 'کارمند', value: (x: Attendance) => dir.name(x.user_id!) }] : []),
        { header: 'روز', value: (x) => x.day },
        { header: 'ورود', value: (x) => utcToZoned(x.check_in).time },
        { header: 'خروج', value: (x) => (x.check_out ? utcToZoned(x.check_out).time : '') },
        { header: 'تأخیر (دقیقه)', value: (x) => x.late_minutes, kind: 'number' },
      ]} />
      <Table>
        <thead><tr>{team && <Th>کارمند</Th>}<Th>روز</Th><Th>ورود</Th><Th>خروج</Th><Th>تأخیر</Th></tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.id}>
              {team && <Td>{dir.name(x.user_id!)}</Td>}
              <Td><DayText value={x.day} /></Td><Td>{clock(x.check_in)}</Td><Td>{x.check_out ? clock(x.check_out) : '—'}</Td>
              <Td>{x.late_minutes > 0 ? <span className="text-danger">{fa(x.late_minutes)} دقیقه</span> : 'به‌موقع'}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

function ReportTable({ rows, team, onScore }: { rows: Report[]; team?: boolean; onScore?: (r: Report) => void }) {
  const dir = useDirectory();
  return (
    <Table>
      <thead><tr>{team && <Th>کارمند</Th>}<Th>روز</Th><Th>گزارش</Th><Th>ساعت</Th><Th>نمره</Th>{team && <Th>عملیات</Th>}</tr></thead>
      <tbody>
        {rows.map((x) => (
          <tr key={x.id}>
            {team && <Td>{dir.name(x.user_id!)}</Td>}
            <Td className="whitespace-nowrap"><DayText value={x.day} /></Td>
            <Td><p className="max-w-xl whitespace-pre-line">{x.body}</p>{x.review_note && <p className="text-xs text-muted">نظر مدیر: {x.review_note}</p>}</Td>
            <Td>{fa(x.hours)}</Td>
            <Td>{x.score !== null ? `${fa(x.score)} از ۵` : '—'}</Td>
            {team && <Td>{x.score === null && <Button size="sm" onClick={() => onScore?.(x)}>نمره‌دهی</Button>}</Td>}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

// ---------------------------------------------------------------- team management

export function TeamPage() {
  const [tab, setTab] = useState('tasks');
  const canManage = useCan('taskboard.manage');
  if (!canManage) return <><PageHeader title="مدیریت کار کارکنان" /><Alert tone="warning">برای این بخش دسترسی «مدیریت کار کارکنان» لازم است.</Alert></>;
  return (
    <>
      <PageHeader title="مدیریت کار کارکنان" />
      <Nav />
      <Tabs label="بخش‌های مدیریت" value={tab} onChange={setTab} items={[
        { key: 'tasks', label: 'کارها و بازبینی' },
        { key: 'duties', label: 'وظایف ثابت' },
        { key: 'attendance', label: 'حضور و تأخیر' },
        { key: 'reports', label: 'گزارش‌های کار' },
        { key: 'scorecard', label: 'کارنامه و KPI' },
      ]} />
      <div className="mt-4">
        {tab === 'tasks' && <TeamTasks />}
        {tab === 'duties' && <Duties />}
        {tab === 'attendance' && <TeamAttendance />}
        {tab === 'reports' && <TeamReports />}
        {tab === 'scorecard' && <Scorecard />}
      </div>
    </>
  );
}

function PersonFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const dir = useDirectory();
  return (
    <Field label="کارمند">
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">همه کارکنان</option>
        {dir.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
      </Select>
    </Field>
  );
}

function TeamTasks() {
  const a = useApi();
  const refresh = useRefresh();
  const [status, setStatus] = useState('review');
  const [person, setPerson] = useState('');
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState<Task | null>(null);
  const q = useQuery({ queryKey: ['taskboard', 'tasks', 'team', status, person], queryFn: () => a.get<Task[]>(`/tasks?scope=team&status=${status}${person ? `&assigneeId=${person}` : ''}`) });
  const cancel = useMutation({ mutationFn: (t: Task) => a.post(`/tasks/${t.id}/cancel`), onSuccess: () => (toast('کار لغو شد'), refresh()), onError: (e) => toast(errorText(e), 'danger') });
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="وضعیت">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="review">منتظر بازبینی</option><option value="open">انجام‌نشده</option><option value="closed">بسته‌شده</option><option value="all">همه</option>
          </Select>
        </Field>
        <PersonFilter value={person} onChange={setPerson} />
        <Button className="ms-auto" onClick={() => setCreating(true)}>سپردن کار جدید</Button>
      </div>
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<ClipboardCheck className="size-8" />} title="کاری با این فیلتر نیست" />}>
        <TaskTable tasks={q.data ?? []} team onReview={setReviewing} onCancel={(t) => cancel.mutate(t)} />
      </PageState>
      {creating && <TaskForm onClose={() => setCreating(false)} />}
      {reviewing && <ReviewDialog task={reviewing} onClose={() => setReviewing(null)} />}
    </>
  );
}

function PeoplePicker({ value, onChange, error }: { value: string[]; onChange: (v: string[]) => void; error?: string }) {
  const dir = useDirectory();
  return (
    <fieldset className="sm:col-span-2">
      <legend className="mb-2 text-sm font-medium">کارکنان</legend>
      <div className="grid max-h-40 gap-2 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-2">
        {dir.users.map((u) => <Checkbox key={u.id} label={u.fullName} checked={value.includes(u.id)} onChange={(e) => onChange(e.target.checked ? [...value, u.id] : value.filter((x) => x !== u.id))} />)}
      </div>
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </fieldset>
  );
}

function TaskForm({ onClose }: { onClose: () => void }) {
  const a = useApi();
  const refresh = useRefresh();
  const [v, setV] = useState({ title: '', description: '', dueTime: '12:00', priority: 'normal' });
  const [dueDate, setDueDate] = useState<string | null>(todayIso());
  const [people, setPeople] = useState<string[]>([]);
  const m = useMutation({
    mutationFn: () => a.post('/tasks', { ...v, dueDate, assigneeIds: people }),
    onSuccess: () => (toast('کار سپرده شد و به کارکنان اعلان رفت'), refresh(), onClose()),
  });
  const f = fieldErrors(m.error);
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="سپردن کار"
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={m.isPending} disabled={!dueDate} onClick={() => m.mutate()}>ثبت و اعلان</Button></>}>
      {m.error && <Alert tone="danger" className="mb-4">{errorText(m.error)}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="عنوان کار" required error={f.title} className="sm:col-span-2"><Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label="شرح" error={f.description} className="sm:col-span-2"><Textarea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <Field label="تاریخ مهلت" required error={dueDate === null ? 'تاریخ معتبر نیست' : f.dueDate}><DateInput value={dueDate ?? undefined} onChange={setDueDate} /></Field>
        <Field label="ساعت مهلت" required error={f.dueTime}><Input type="time" dir="ltr" value={v.dueTime} onChange={(e) => setV({ ...v, dueTime: e.target.value })} /></Field>
        <Field label="اولویت"><Select value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>{Object.entries(PRIORITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <PeoplePicker value={people} onChange={setPeople} error={f.assigneeIds} />
      </div>
    </Dialog>
  );
}

function ReviewDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const a = useApi();
  const refresh = useRefresh();
  const dir = useDirectory();
  const [score, setScore] = useState('5');
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: (decision: 'approve' | 'return') => a.post(`/tasks/${task.id}/review`, { decision, score: decision === 'approve' ? Number(score) : null, note }),
    onSuccess: () => (toast('بازبینی ثبت شد'), refresh(), onClose()),
  });
  const f = fieldErrors(m.error);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`بازبینی: ${task.title}`}
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button variant="secondary" loading={m.isPending} onClick={() => m.mutate('return')}>برگشت برای اصلاح</Button><Button loading={m.isPending} onClick={() => m.mutate('approve')}>تأیید با نمره</Button></>}>
      {m.error && <Alert tone="danger" className="mb-4">{errorText(m.error)}</Alert>}
      <p className="mb-3 text-sm">{dir.name(task.assignee_id)} · انجام: {task.done_at ? when(task.done_at) : '—'}{task.done_note && ` · ${task.done_note}`}</p>
      <div className="grid gap-4">
        <Field label="نمره (۱ تا ۵)" error={f.score}><Select value={score} onChange={(e) => setScore(e.target.value)}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{fa(n)}</option>)}</Select></Field>
        <Field label="توضیح" hint="برای برگشت الزامی است" error={f.note}><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

interface Duty { id: string; title: string; description: string; assignee_id: string; recurrence: string; weekdays: number[]; month_day: number | null; due_time: string; priority: string; skip_days_off: boolean; active: boolean }

function Duties() {
  const a = useApi();
  const refresh = useRefresh();
  const dir = useDirectory();
  const [editing, setEditing] = useState<Duty | 'new' | null>(null);
  const q = useQuery({ queryKey: ['taskboard', 'duties'], queryFn: () => a.get<Duty[]>('/duties') });
  const toggle = useMutation({ mutationFn: (d: Duty) => a.post(`/duties/${d.id}/active`, { active: !d.active }), onSuccess: () => (toast('ذخیره شد'), refresh()), onError: (e) => toast(errorText(e), 'danger') });
  const schedule = (d: Duty) =>
    d.recurrence === 'weekly' ? WEEKDAYS.filter(([n]) => d.weekdays.includes(n)).map(([, l]) => l).join('، ') : d.recurrence === 'monthly' ? `روز ${fa(d.month_day)} هر ماه` : 'هر روز';
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted">وظیفه ثابت هر روزی که برنامه‌اش برسد، خودکار برای کارمند در «روز من» ایجاد می‌شود (مثل حضور ساعت ۸ یا گزارش هفتگی).</p>
        <Button className="ms-auto" onClick={() => setEditing('new')}>وظیفه ثابت جدید</Button>
      </div>
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<ListChecks className="size-8" />} title="هنوز وظیفه ثابتی تعریف نشده است" />}>
        <Table>
          <thead><tr><Th>وظیفه</Th><Th>کارمند</Th><Th>تکرار</Th><Th>ساعت</Th><Th>وضعیت</Th><Th>عملیات</Th></tr></thead>
          <tbody>
            {(q.data ?? []).map((d) => (
              <tr key={d.id}>
                <Td className="font-medium">{d.title}</Td><Td>{dir.name(d.assignee_id)}</Td><Td>{RECURRENCE[d.recurrence]} · {schedule(d)}</Td><Td><bdi>{faTime(d.due_time)}</bdi></Td>
                <Td>{d.active ? <Badge tone="success">فعال</Badge> : <Badge tone="neutral">متوقف</Badge>}</Td>
                <Td className="whitespace-nowrap">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(d)}>ویرایش</Button>{' '}
                  <Button size="sm" variant="ghost" onClick={() => toggle.mutate(d)}>{d.active ? 'توقف' : 'فعال‌سازی'}</Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {editing && <DutyForm duty={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function DutyForm({ duty, onClose }: { duty: Duty | null; onClose: () => void }) {
  const a = useApi();
  const refresh = useRefresh();
  const dir = useDirectory();
  const [v, setV] = useState({
    title: duty?.title ?? '', description: duty?.description ?? '', assigneeId: duty?.assignee_id ?? '', recurrence: duty?.recurrence ?? 'daily',
    dueTime: duty?.due_time ?? '08:00', priority: duty?.priority ?? 'normal', monthDay: duty?.month_day ? String(duty.month_day) : '1', skipDaysOff: duty?.skip_days_off ?? true,
  });
  const [weekdays, setWeekdays] = useState<number[]>(duty?.weekdays ?? []);
  const m = useMutation({
    mutationFn: () => {
      const body = { ...v, weekdays, monthDay: v.recurrence === 'monthly' ? Number(v.monthDay) : null };
      return duty ? a.put(`/duties/${duty.id}`, body) : a.post('/duties', body);
    },
    onSuccess: () => (toast('وظیفه ذخیره شد'), refresh(), onClose()),
  });
  const f = fieldErrors(m.error);
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={duty ? 'ویرایش وظیفه ثابت' : 'وظیفه ثابت جدید'}
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={m.isPending} onClick={() => m.mutate()}>ذخیره</Button></>}>
      {m.error && <Alert tone="danger" className="mb-4">{errorText(m.error)}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="عنوان" required error={f.title} className="sm:col-span-2"><Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label="شرح" className="sm:col-span-2"><Textarea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <Field label="کارمند" required error={f.assigneeId}>
          <Select value={v.assigneeId} onChange={(e) => setV({ ...v, assigneeId: e.target.value })}>
            <option value="">— انتخاب کنید —</option>
            {dir.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </Select>
        </Field>
        <Field label="ساعت انجام" required error={f.dueTime}><Input type="time" dir="ltr" value={v.dueTime} onChange={(e) => setV({ ...v, dueTime: e.target.value })} /></Field>
        <Field label="تکرار"><Select value={v.recurrence} onChange={(e) => setV({ ...v, recurrence: e.target.value })}>{Object.entries(RECURRENCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="اولویت"><Select value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>{Object.entries(PRIORITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        {v.recurrence === 'weekly' && (
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-sm font-medium">روزهای هفته</legend>
            <div className="flex flex-wrap gap-3">{WEEKDAYS.map(([n, l]) => <Checkbox key={n} label={l} checked={weekdays.includes(n)} onChange={(e) => setWeekdays((s) => (e.target.checked ? [...s, n] : s.filter((x) => x !== n)))} />)}</div>
            {f.weekdays && <p className="mt-1 text-sm text-danger">{f.weekdays}</p>}
          </fieldset>
        )}
        {v.recurrence === 'monthly' && <Field label="روز ماه (شمسی)" hint="اگر ماه کوتاه‌تر باشد، روز آخر ماه" error={f.monthDay}><Input type="number" dir="ltr" min={1} max={31} value={v.monthDay} onChange={(e) => setV({ ...v, monthDay: e.target.value })} /></Field>}
        <div className="sm:col-span-2"><Checkbox label="در روزهای تعطیل تقویم کاری ایجاد نشود" checked={v.skipDaysOff} onChange={(e) => setV({ ...v, skipDaysOff: e.target.checked })} /></div>
      </div>
    </Dialog>
  );
}

function TeamAttendance() {
  const a = useApi();
  const r = useRange();
  const [person, setPerson] = useState('');
  const q = useQuery({ queryKey: ['taskboard', 'attendance', 'team', r.qs, person], enabled: r.ok, queryFn: () => a.get<Attendance[]>(`/attendance?${r.qs}${person ? `&userId=${person}` : ''}`) });
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">{r.picker}<div className="mb-4"><PersonFilter value={person} onChange={setPerson} /></div></div>
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<p className="text-sm text-muted">حضوری در این بازه ثبت نشده است.</p>}>
        <AttendanceTable rows={q.data ?? []} team />
      </PageState>
    </>
  );
}

function TeamReports() {
  const a = useApi();
  const refresh = useRefresh();
  const r = useRange();
  const [person, setPerson] = useState('');
  const [scoring, setScoring] = useState<Report | null>(null);
  const [score, setScore] = useState('5');
  const [note, setNote] = useState('');
  const q = useQuery({ queryKey: ['taskboard', 'reports', 'team', r.qs, person], enabled: r.ok, queryFn: () => a.get<Report[]>(`/reports?${r.qs}${person ? `&userId=${person}` : ''}`) });
  const m = useMutation({
    mutationFn: () => a.post(`/reports/${scoring!.id}/score`, { score: Number(score), note }),
    onSuccess: () => (toast('نمره ثبت شد'), refresh(), setScoring(null), setNote('')),
    onError: (e) => toast(errorText(e), 'danger'),
  });
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">{r.picker}<div className="mb-4"><PersonFilter value={person} onChange={setPerson} /></div></div>
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<p className="text-sm text-muted">گزارشی در این بازه نوشته نشده است.</p>}>
        <ReportTable rows={q.data ?? []} team onScore={setScoring} />
      </PageState>
      {scoring && (
        <Dialog open onOpenChange={(o) => !o && setScoring(null)} title="نمره گزارش کار"
          footer={<><Button variant="ghost" onClick={() => setScoring(null)}>انصراف</Button><Button loading={m.isPending} onClick={() => m.mutate()}>ثبت نمره</Button></>}>
          <p className="mb-3 whitespace-pre-line text-sm">{scoring.body}</p>
          <div className="grid gap-4">
            <Field label="نمره (۱ تا ۵)"><Select value={score} onChange={(e) => setScore(e.target.value)}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{fa(n)}</option>)}</Select></Field>
            <Field label="توضیح"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
        </Dialog>
      )}
    </>
  );
}

function Scorecard() {
  const a = useApi();
  const dir = useDirectory();
  const me = useMe();
  const r = useRange();
  const q = useQuery({ queryKey: ['taskboard', 'scorecard', 'team', r.qs], enabled: r.ok, queryFn: () => a.get<Score[]>(`/scorecard?${r.qs}`) });
  const rows = [...(q.data ?? [])].sort((x, y) => (y.performance ?? -1) - (x.performance ?? -1));
  return (
    <>
      {r.picker}
      <p className="mb-3 text-sm text-muted">امتیاز کلی = ۴۰٪ انجام در مهلت + ۳۰٪ میانگین نمره + ۲۰٪ ورود به‌موقع + ۱۰٪ گزارش کار روزانه (جزء بدون داده کنار گذاشته می‌شود). این شاخص‌ها در ماژول KPI هم به‌عنوان منبع داده برای هر شخص در دسترس‌اند.</p>
      <PageState query={q} isEmpty={rows.length === 0} empty={<p className="text-sm text-muted">در این بازه داده‌ای نیست.</p>}>
        <ExportMenu filename="scorecard" title="کارنامه کارکنان" rows={rows} columns={[
          { header: 'کارمند', value: (s) => dir.name(s.userId) },
          { header: 'امتیاز کلی', value: (s) => s.performance, kind: 'number' },
          { header: 'انجام در مهلت ٪', value: (s) => s.onTimeRate, kind: 'number' },
          { header: 'میانگین نمره', value: (s) => s.averageScore, kind: 'number' },
          { header: 'ورود به‌موقع ٪', value: (s) => s.attendanceRate, kind: 'number' },
          { header: 'گزارش کار ٪', value: (s) => s.reportRate, kind: 'number' },
          { header: 'کارهای عقب‌افتاده', value: (s) => s.missed, kind: 'number' },
        ]} />
        <Table>
          <thead><tr><Th>کارمند</Th><Th>امتیاز کلی</Th><Th>انجام در مهلت</Th><Th>میانگین نمره</Th><Th>ورود به‌موقع</Th><Th>گزارش کار</Th><Th>عقب‌افتاده</Th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.userId}>
                <Td className="font-medium">{dir.name(s.userId)}{s.userId === me.user.id && ' (شما)'}</Td>
                <Td className="font-bold">{fa(s.performance)}</Td>
                <Td>{fa(s.onTimeRate, '٪')} <span className="text-xs text-muted">({fa(s.onTime)}/{fa(s.tasks)})</span></Td>
                <Td>{fa(s.averageScore)}</Td>
                <Td>{fa(s.attendanceRate, '٪')} <span className="text-xs text-muted">({fa(s.lateDays)} تأخیر)</span></Td>
                <Td>{fa(s.reportRate, '٪')}</Td>
                <Td>{s.missed ? <span className="text-danger">{fa(s.missed)}</span> : '۰'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
    </>
  );
}
