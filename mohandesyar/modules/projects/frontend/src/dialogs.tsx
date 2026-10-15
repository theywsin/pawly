import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, DateInput, Dialog, Field, Input, MoneyInput, Select, Textarea, toast } from '@mohandesyar/ui';
import { useDirectory } from '@mohandesyar/module-sdk/web';
import { todayIso } from '@mohandesyar/persian';
import { DEP_TYPE, ISSUE_KIND, MEMBER_ROLE, PHASE_KIND, useApi, useServerErrors } from './common.js';

function FormDialog({ title, path, method = 'post', body, onClose, children, disabled, done, size }: { title: string; path: string; method?: 'post' | 'put'; body: () => unknown; onClose: () => void; children: (f: Record<string, string>) => ReactNode; disabled?: boolean; done: string; size?: 'md' | 'lg' }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const m = useMutation({
    mutationFn: () => (method === 'put' ? a.put(path, body()) : a.post(path, body())),
    onSuccess: () => {
      toast(done);
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['widget'] });
      onClose();
    },
    onError: err.set,
  });
  return (
    <Dialog open size={size} onOpenChange={(o) => !o && onClose()} title={title}
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={m.isPending} disabled={disabled} onClick={() => (err.clear(), m.mutate())}>ذخیره</Button></>}>
      {err.banner}
      <div className="grid gap-4">{children(err.fields)}</div>
    </Dialog>
  );
}

function useDate(initial = '') {
  const [value, setValue] = useState(initial);
  const [bad, setBad] = useState(false);
  return { value, bad, onChange: (iso: string | null) => (setBad(iso === null), iso !== null && setValue(iso)) };
}

function UserSelect({ value, onChange, allowEmpty = true }: { value: string; onChange: (v: string) => void; allowEmpty?: boolean }) {
  const dir = useDirectory();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">— انتخاب نشده —</option>}
      {dir.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
    </Select>
  );
}

export interface ActivityLite {
  id: string;
  name: string;
  parent_id: string | null;
  duration_days: number;
  weight: string;
  assignee_id: string | null;
  sort: number;
  leaf: boolean;
}

export function ActivityDialog({ projectId, parent, activity, onClose }: { projectId: string; parent?: ActivityLite | null; activity?: ActivityLite; onClose: () => void }) {
  const [v, setV] = useState({ name: activity?.name ?? '', durationDays: String(activity?.duration_days ?? 1), weight: String(Number(activity?.weight ?? 1)), assigneeId: activity?.assignee_id ?? '' });
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <FormDialog
      title={activity ? `ویرایش «${activity.name}»` : parent ? `زیرفعالیت «${parent.name}»` : 'فعالیت جدید'}
      done="فعالیت ذخیره شد"
      method={activity ? 'put' : 'post'}
      path={activity ? `/projects/${projectId}/activities/${activity.id}` : `/projects/${projectId}/activities`}
      onClose={onClose}
      body={() => ({ name: v.name, durationDays: v.durationDays, weight: v.weight, assigneeId: v.assigneeId || null, parentId: activity ? activity.parent_id : (parent?.id ?? null) })}
    >
      {(f) => (
        <>
          <Field label="نام فعالیت" required error={f.name}><Input value={v.name} onChange={(e) => set('name')(e.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="مدت (روز)" required error={f.durationDays} hint="۰ = نقطه عطف (milestone)"><Input dir="ltr" inputMode="numeric" value={v.durationDays} onChange={(e) => set('durationDays')(e.target.value)} /></Field>
            <Field label="وزن در پیشرفت پروژه" error={f.weight} hint="نسبی؛ مثلاً هزینه یا نفر-روز"><Input dir="ltr" inputMode="decimal" value={v.weight} onChange={(e) => set('weight')(e.target.value)} /></Field>
          </div>
          <Field label="مسئول" error={f.assigneeId}><UserSelect value={v.assigneeId} onChange={set('assigneeId')} /></Field>
        </>
      )}
    </FormDialog>
  );
}

export function DependencyDialog({ projectId, activities, onClose }: { projectId: string; activities: ActivityLite[]; onClose: () => void }) {
  const leafs = activities.filter((a) => a.leaf);
  const [v, setV] = useState({ predecessorId: '', successorId: '', type: 'FS', lagDays: '0' });
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const select = (k: 'predecessorId' | 'successorId') => (
    <Select value={v[k]} onChange={(e) => set(k)(e.target.value)}>
      <option value="">— انتخاب کنید —</option>
      {leafs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </Select>
  );
  return (
    <FormDialog title="افزودن وابستگی" done="وابستگی ثبت شد" path={`/projects/${projectId}/dependencies`} onClose={onClose} disabled={!v.predecessorId || !v.successorId} body={() => v}>
      {(f) => (
        <>
          <Field label="پیش‌نیاز" required error={f.predecessorId}>{select('predecessorId')}</Field>
          <Field label="فعالیت وابسته" required error={f.successorId}>{select('successorId')}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نوع">
              <Select value={v.type} onChange={(e) => set('type')(e.target.value)}>
                {Object.entries(DEP_TYPE).map(([k, l]) => <option key={k} value={k}>{l} ({k})</option>)}
              </Select>
            </Field>
            <Field label="تأخیر/تقدم (روز)" error={f.lagDays} hint="منفی = هم‌پوشانی"><Input dir="ltr" inputMode="numeric" value={v.lagDays} onChange={(e) => set('lagDays')(e.target.value)} /></Field>
          </div>
        </>
      )}
    </FormDialog>
  );
}

export function ProgressDialog({ projectId, activity, onClose }: { projectId: string; activity: ActivityLite & { progress: string }; onClose: () => void }) {
  const date = useDate(todayIso());
  const [percent, setPercent] = useState(String(Number(activity.progress)));
  const [note, setNote] = useState('');
  return (
    <FormDialog title={`ثبت پیشرفت «${activity.name}»`} done="پیشرفت ثبت شد" path={`/projects/${projectId}/activities/${activity.id}/progress`} onClose={onClose} disabled={date.bad} body={() => ({ date: date.value, percent, note })}>
      {(f) => (
        <>
          <Field label="تاریخ" required error={date.bad ? 'تاریخ معتبر نیست' : f.date}><DateInput value={date.value} onChange={date.onChange} /></Field>
          <Field label="درصد پیشرفت تجمعی فیزیکی" required error={f.percent} hint="درصد انجام کل فعالیت تا این تاریخ"><Input dir="ltr" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} /></Field>
          <Field label="توضیح" error={f.note}><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </>
      )}
    </FormDialog>
  );
}

export function MemberDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('member');
  return (
    <FormDialog title="افزودن عضو تیم" done="عضو افزوده شد" path={`/projects/${projectId}/members`} onClose={onClose} disabled={!userId} body={() => ({ userId, role })}>
      {(f) => (
        <>
          <Field label="کاربر" required error={f.userId}><UserSelect value={userId} onChange={setUserId} /></Field>
          <Field label="نقش در پروژه">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              {Object.entries(MEMBER_ROLE).filter(([k]) => k !== 'manager').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
        </>
      )}
    </FormDialog>
  );
}

export function PhaseDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [v, setV] = useState({ kind: 'phase', name: '', notes: '' });
  const date = useDate();
  return (
    <FormDialog title="افزودن مرحله یا تحویل" done="مرحله افزوده شد" path={`/projects/${projectId}/phases`} onClose={onClose} disabled={date.bad} body={() => ({ ...v, plannedDate: date.value || null })}>
      {(f) => (
        <>
          <Field label="نوع">
            <Select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
              {Object.entries(PHASE_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <Field label="عنوان" required error={f.name}><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          <Field label="تاریخ برنامه‌ای" error={date.bad ? 'تاریخ معتبر نیست' : f.plannedDate}><DateInput value={date.value} onChange={date.onChange} /></Field>
          <Field label="توضیحات"><Textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
        </>
      )}
    </FormDialog>
  );
}

export function IssueDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [v, setV] = useState({ kind: 'obstacle', title: '', description: '', cause: '', impactDays: '0', ownerId: '' });
  const due = useDate();
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <FormDialog title="ثبت تأخیر، مانع یا مسئله" done="ثبت شد" path={`/projects/${projectId}/issues`} onClose={onClose} disabled={due.bad} body={() => ({ ...v, ownerId: v.ownerId || null, dueOn: due.value || null })}>
      {(f) => (
        <>
          <Field label="نوع">
            <Select value={v.kind} onChange={(e) => set('kind')(e.target.value)}>
              {Object.entries(ISSUE_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <Field label="عنوان" required error={f.title}><Input value={v.title} onChange={(e) => set('title')(e.target.value)} /></Field>
          <Field label="شرح" error={f.description}><Textarea value={v.description} onChange={(e) => set('description')(e.target.value)} /></Field>
          <Field label="علت" error={f.cause}><Input value={v.cause} onChange={(e) => set('cause')(e.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="اثر بر زمان (روز)" error={f.impactDays}><Input dir="ltr" inputMode="numeric" value={v.impactDays} onChange={(e) => set('impactDays')(e.target.value)} /></Field>
            <Field label="مهلت رفع" error={due.bad ? 'تاریخ معتبر نیست' : f.dueOn}><DateInput value={due.value} onChange={due.onChange} /></Field>
          </div>
          <Field label="مسئول پیگیری" hint="به او اعلان داده می‌شود"><UserSelect value={v.ownerId} onChange={set('ownerId')} /></Field>
        </>
      )}
    </FormDialog>
  );
}

export function RiskDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [v, setV] = useState({ title: '', probability: '3', impact: '3', response: '', ownerId: '' });
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const scale = (k: 'probability' | 'impact') => (
    <Select value={v[k]} onChange={(e) => set(k)(e.target.value)}>
      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n.toLocaleString('fa-IR')}</option>)}
    </Select>
  );
  return (
    <FormDialog title="ثبت ریسک" done="ریسک ثبت شد" path={`/projects/${projectId}/risks`} onClose={onClose} body={() => ({ ...v, ownerId: v.ownerId || null })}>
      {(f) => (
        <>
          <Field label="عنوان ریسک" required error={f.title}><Input value={v.title} onChange={(e) => set('title')(e.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="احتمال (۱ تا ۵)">{scale('probability')}</Field>
            <Field label="اثر (۱ تا ۵)">{scale('impact')}</Field>
          </div>
          <Field label="پاسخ/اقدام" error={f.response}><Textarea value={v.response} onChange={(e) => set('response')(e.target.value)} /></Field>
          <Field label="مالک ریسک"><UserSelect value={v.ownerId} onChange={set('ownerId')} /></Field>
        </>
      )}
    </FormDialog>
  );
}

export function DailyReportDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [v, setV] = useState({ weather: '', workforce: '0', equipment: '', workDone: '', problems: '' });
  const date = useDate(todayIso());
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <FormDialog size="lg" title="گزارش روزانه کارگاه" done="گزارش ثبت شد" path={`/projects/${projectId}/daily-reports`} onClose={onClose} disabled={date.bad} body={() => ({ ...v, reportDate: date.value })}>
      {(f) => (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="تاریخ" required error={date.bad ? 'تاریخ معتبر نیست' : f.reportDate}><DateInput value={date.value} onChange={date.onChange} /></Field>
            <Field label="وضعیت هوا"><Input value={v.weather} onChange={(e) => set('weather')(e.target.value)} /></Field>
            <Field label="تعداد نیروی انسانی" error={f.workforce}><Input dir="ltr" inputMode="numeric" value={v.workforce} onChange={(e) => set('workforce')(e.target.value)} /></Field>
          </div>
          <Field label="ماشین‌آلات و تجهیزات"><Input value={v.equipment} onChange={(e) => set('equipment')(e.target.value)} /></Field>
          <Field label="کارهای انجام‌شده" required error={f.workDone}><Textarea value={v.workDone} onChange={(e) => set('workDone')(e.target.value)} /></Field>
          <Field label="مشکلات و موانع"><Textarea value={v.problems} onChange={(e) => set('problems')(e.target.value)} /></Field>
        </>
      )}
    </FormDialog>
  );
}

export function ChangeRequestDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [v, setV] = useState({ title: '', description: '', costImpact: '', timeImpactDays: '0' });
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <FormDialog title="درخواست تغییر" done="درخواست تغییر ثبت شد" path={`/projects/${projectId}/change-requests`} onClose={onClose} body={() => ({ ...v, costImpact: v.costImpact || '0' })}>
      {(f) => (
        <>
          <Field label="عنوان" required error={f.title}><Input value={v.title} onChange={(e) => set('title')(e.target.value)} /></Field>
          <Field label="شرح تغییر" error={f.description}><Textarea value={v.description} onChange={(e) => set('description')(e.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="اثر بر هزینه (کاهش با منفی)" error={f.costImpact}><MoneyInput allowNegative value={v.costImpact} onChange={set('costImpact')} /></Field>
            <Field label="اثر بر زمان (روز)" error={f.timeImpactDays}><Input dir="ltr" inputMode="numeric" value={v.timeImpactDays} onChange={(e) => set('timeImpactDays')(e.target.value)} /></Field>
          </div>
        </>
      )}
    </FormDialog>
  );
}

/** Delivery / client approval dates of a phase. */
export function PhaseStatusDialog({ projectId, phase, onClose }: { projectId: string; phase: { id: string; name: string; delivered_on: string | null; client_approved_on: string | null }; onClose: () => void }) {
  const delivered = useDate(phase.delivered_on ?? todayIso());
  const approved = useDate(phase.client_approved_on ?? '');
  return (
    <FormDialog title={`تحویل «${phase.name}»`} done="ثبت شد" path={`/projects/${projectId}/phases/${phase.id}/status`} onClose={onClose} disabled={delivered.bad || approved.bad}
      body={() => ({ deliveredOn: delivered.value || null, clientApprovedOn: approved.value || null })}>
      {(f) => (
        <>
          <Field label="تاریخ تحویل" error={delivered.bad ? 'تاریخ معتبر نیست' : f.deliveredOn}><DateInput value={delivered.value} onChange={delivered.onChange} /></Field>
          <Field label="تاریخ تأیید کارفرما" error={approved.bad ? 'تاریخ معتبر نیست' : f.clientApprovedOn}><DateInput value={approved.value} onChange={approved.onChange} /></Field>
        </>
      )}
    </FormDialog>
  );
}
