import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ClipboardCheck, Download } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, DayText, EmptyState, Field, Ltr, PageHeader, PageState, Select, Table, Td, Textarea, Th, toast } from '@mohandesyar/ui';
import { useDirectory } from '@mohandesyar/module-sdk/web';
import { utcToZoned } from '@mohandesyar/persian';
import { ResumeView, SkillsView } from './candidates.js';
import { BASE, MODE, Nav, RECOMMENDATION, Score, fa, toFaDigits, useApi, useServerErrors } from './common.js';

const when = (iso: string) => {
  const z = utcToZoned(iso);
  return <><DayText value={z.date} /> <bdi>{toFaDigits(z.time)}</bdi></>;
};

export function MyInterviewsPage() {
  const a = useApi();
  const q = useQuery({ queryKey: ['recruitment', 'interviews', 'mine'], queryFn: () => a.get<{ id: string; scheduled_at: string; mode: string; status: string; score: number | null; recommendation: string | null; full_name: string; job_title: string }[]>('/interviews/mine') });
  return (
    <>
      <PageHeader title="مصاحبه‌های من" description="مصاحبه‌هایی که ارزیابی آن‌ها به شما سپرده شده است." />
      <Nav />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<ClipboardCheck className="size-8" />} title="مصاحبه‌ای به شما سپرده نشده است" />}>
        <Table>
          <thead><tr><Th>متقاضی</Th><Th>موقعیت</Th><Th>زمان</Th><Th>نحوه</Th><Th>ارزیابی</Th></tr></thead>
          <tbody>
            {q.data?.map((i) => (
              <tr key={i.id}>
                <Td><Link to={`${BASE}/interviews/${i.id}`} className="font-medium text-primary underline-offset-4 hover:underline">{i.full_name}</Link></Td>
                <Td>{i.job_title}</Td><Td className="whitespace-nowrap">{when(i.scheduled_at)}</Td><Td>{MODE[i.mode]}</Td>
                <Td>{i.status === 'done' ? <span className="flex items-center gap-2"><Score value={i.score} />{i.recommendation && <Badge tone={RECOMMENDATION[i.recommendation]!.tone}>{RECOMMENDATION[i.recommendation]!.label}</Badge>}</span> : <Badge tone="warning">در انتظار ارزیابی</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
    </>
  );
}

interface InterviewDetail {
  interview: {
    id: string; interviewer_id: string; scheduled_at: string; mode: string; status: string; ratings: Record<string, number>; score: number | null; recommendation: string | null; notes: string; evaluated_at: string | null;
    form_name: string; criteria: { key: string; label: string; weight: number }[]; candidate_id: string; full_name: string; desired_position: string; summary: string; candidate_status: string; job_title: string;
  };
  educations: { degree: string; field: string; institution: string; end_year: number | null }[];
  experiences: { employer: string; title: string; started_on: string; ended_on: string | null; description: string }[];
  projects: { title: string; role: string; client: string; year: number | null; description: string }[];
  skills: { kind: string; name: string; level: number }[];
  files: { id: string; kind: string; name: string; size: number }[];
}

const RATING = ['', 'ضعیف', 'کمتر از انتظار', 'در حد انتظار', 'خوب', 'عالی'];

export function InterviewPage() {
  const { id } = useParams();
  const a = useApi();
  const qc = useQueryClient();
  const dir = useDirectory();
  const err = useServerErrors();
  const q = useQuery({ queryKey: ['recruitment', 'interview', id], queryFn: () => a.get<InterviewDetail>(`/interviews/${id}`) });
  const [ratings, setRatings] = useState<Record<string, number> | null>(null);
  const [rec, setRec] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const d = q.data;
  const r = ratings ?? d?.interview.ratings ?? {};
  const save = useMutation({
    mutationFn: () => a.put(`/interviews/${id}/evaluation`, { ratings: r, recommendation: rec ?? d!.interview.recommendation, notes: notes ?? d!.interview.notes }),
    onSuccess: () => (toast('ارزیابی ثبت شد'), void qc.invalidateQueries({ queryKey: ['recruitment'] })),
    onError: err.set,
  });
  const download = async (fid: string) => window.location.assign((await a.get<{ url: string }>(`/interviews/${id}/files/${fid}/url`)).url);
  const recommendation = rec ?? d?.interview.recommendation ?? '';
  const complete = d ? d.interview.criteria.every((c) => r[c.key]) && !!recommendation : false;
  return (
    <>
      <Link to={`${BASE}/interviews`} className="mb-3 inline-flex items-center gap-1 text-sm text-primary print:hidden"><ArrowRight className="size-4" /> مصاحبه‌های من</Link>
      <PageState query={q}>
        {d && (
          <>
            <PageHeader title={`مصاحبه با ${d.interview.full_name}`} description={<>{d.interview.job_title} · {when(d.interview.scheduled_at)} · {MODE[d.interview.mode]} · مصاحبه‌گر: {dir.name(d.interview.interviewer_id)}</>} />
            {d.interview.status === 'cancelled' && <Alert tone="warning" className="mb-4">این مصاحبه لغو شده است.</Alert>}
            <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
              <Card>
                <CardHeader title={`فرم ارزیابی: ${d.interview.form_name}`} description="به هر معیار از ۱ (ضعیف) تا ۵ (عالی) امتیاز دهید؛ فقط شایستگی‌های مرتبط با شغل." />
                <div className="space-y-4 p-5">
                  {err.banner}
                  {d.interview.criteria.map((c) => (
                    <fieldset key={c.key}>
                      <legend className="mb-1 text-sm font-medium">{c.label} <span className="text-muted">(وزن {fa(c.weight)})</span></legend>
                      <div className="flex flex-wrap gap-2">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <label key={n} className={`cursor-pointer rounded-md border px-3 py-1 text-sm ${r[c.key] === n ? 'border-primary bg-primary text-primary-fg' : 'border-border'}`}>
                            <input type="radio" className="sr-only" name={c.key} checked={r[c.key] === n} disabled={d.interview.status === 'cancelled'} onChange={() => setRatings({ ...r, [c.key]: n })} />
                            {fa(n)} · {RATING[n]}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                  <Field label="جمع‌بندی" required>
                    <Select value={recommendation} disabled={d.interview.status === 'cancelled'} onChange={(e) => setRec(e.target.value)}>
                      <option value="">انتخاب کنید</option>
                      {Object.entries(RECOMMENDATION).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}
                    </Select>
                  </Field>
                  <Field label="یادداشت‌ها" hint="فقط مشاهدات مرتبط با شغل؛ این یادداشت‌ها با پایان مدت نگهداری رزومه حذف می‌شوند."><Textarea rows={5} value={notes ?? d.interview.notes} disabled={d.interview.status === 'cancelled'} onChange={(e) => setNotes(e.target.value)} /></Field>
                  {d.interview.status === 'done' && <p className="text-sm">امتیاز ثبت‌شده: <Score value={d.interview.score} /></p>}
                  {d.interview.status !== 'cancelled' && <Button disabled={!complete} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>{d.interview.status === 'done' ? 'به‌روزرسانی ارزیابی' : 'ثبت ارزیابی'}</Button>}
                </div>
              </Card>
              <Card>
                <CardHeader title="رزومه" description={d.interview.desired_position || undefined} />
                <div className="p-5">
                  {d.files.length > 0 && (
                    <ul className="mb-4 space-y-1">
                      {d.files.map((f) => <li key={f.id}><Button size="sm" variant="ghost" onClick={() => void download(f.id)}><Download className="size-4" /> <Ltr>{f.name}</Ltr></Button></li>)}
                    </ul>
                  )}
                  <ResumeView d={{ ...d, candidate: { summary: d.interview.summary } }} />
                  <h2 className="mb-2 font-semibold">مهارت‌ها</h2>
                  <SkillsView skills={d.skills} />
                </div>
              </Card>
            </div>
          </>
        )}
      </PageState>
    </>
  );
}
