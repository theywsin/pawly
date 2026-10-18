import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, DateText, Dialog, EmptyState, ExportMenu, Field, Input, PageHeader, PageState, Select, Table, Td, Textarea, Th, toast } from '@mohandesyar/ui';
import { useCan, useDirectory } from '@mohandesyar/module-sdk/web';
import { BASE, Nav, fa, useApi, useServerErrors } from './common.js';

export interface Review { id: string; period: string; reviewer_id: string; criteria: { label: string; weight: number; score: number }[]; score: number | null; strengths: string; improvements: string; status: string; finalized_at: string | null }
interface ReviewRow { id: string; employee_id: string; full_name: string; department: string; position: string; period: string; reviewer_id: string; score: number | null; status: string; updated_at: string }

const SCORE = ['', 'ضعیف', 'نیازمند بهبود', 'مطابق انتظار', 'فراتر از انتظار', 'عالی'];
const DEFAULT_CRITERIA = [
  { label: 'کیفیت کار', weight: 3, score: 3 },
  { label: 'تحقق اهداف و تعهدات', weight: 3, score: 3 },
  { label: 'دانش فنی', weight: 2, score: 3 },
  { label: 'همکاری و ارتباطات', weight: 2, score: 3 },
  { label: 'رعایت ایمنی و مقررات', weight: 2, score: 3 },
];

export function ReviewView({ review }: { review: Review }) {
  const dir = useDirectory();
  return (
    <Card className="p-5 text-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{review.period}</span>
        <span className="flex items-center gap-2">امتیاز: <span className="text-lg font-bold tabular-nums">{fa(review.score)}</span> از ۱۰۰ {review.status === 'final' ? <Badge tone="success">نهایی</Badge> : <Badge tone="warning">پیش‌نویس</Badge>}</span>
      </div>
      <ul className="mb-3 space-y-1">{review.criteria.map((c, i) => <li key={i}>{c.label} <span className="text-muted">(وزن {fa(c.weight)})</span>: {fa(c.score)} — {SCORE[c.score]}</li>)}</ul>
      {review.strengths && <p><span className="font-medium">نقاط قوت:</span> {review.strengths}</p>}
      {review.improvements && <p><span className="font-medium">زمینه‌های بهبود:</span> {review.improvements}</p>}
      <p className="mt-2 text-xs text-muted">ارزیاب: {dir.name(review.reviewer_id)}{review.finalized_at && <> · <DateText value={review.finalized_at} /></>}</p>
    </Card>
  );
}

export function ReviewsPage() {
  const a = useApi();
  const dir = useDirectory();
  const canManage = useCan('hr.review.manage');
  const [editing, setEditing] = useState<ReviewRow | 'new' | null>(null);
  const q = useQuery({ queryKey: ['hr', 'reviews'], queryFn: () => a.get<ReviewRow[]>('/reviews') });
  return (
    <>
      <PageHeader title="ارزیابی عملکرد" actions={
        <>
          <ExportMenu filename="reviews" title="ارزیابی عملکرد" rows={q.data} columns={[
            { header: 'کارمند', value: (r) => r.full_name }, { header: 'واحد', value: (r) => r.department }, { header: 'دوره', value: (r) => r.period },
            { header: 'امتیاز', value: (r) => r.score, kind: 'number' }, { header: 'ارزیاب', value: (r) => dir.name(r.reviewer_id) }, { header: 'وضعیت', value: (r) => (r.status === 'final' ? 'نهایی' : 'پیش‌نویس') },
          ]} />
          {canManage && <Button onClick={() => setEditing('new')}><Plus className="size-4" /> ارزیابی جدید</Button>}
        </>
      } />
      <Nav />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<ClipboardList className="size-8" />} title="ارزیابی‌ای ثبت نشده است" />}>
        <Table>
          <thead><tr><Th>کارمند</Th><Th>دوره</Th><Th>امتیاز</Th><Th>ارزیاب</Th><Th>وضعیت</Th></tr></thead>
          <tbody>
            {q.data?.map((r) => (
              <tr key={r.id}>
                <Td><Link className="text-primary underline-offset-4 hover:underline" to={`${BASE}/employees/${r.employee_id}`}>{r.full_name}</Link><div className="text-xs text-muted">{r.position}</div></Td>
                <Td>{canManage && r.status === 'draft' ? <button type="button" className="text-primary underline" onClick={() => setEditing(r)}>{r.period}</button> : r.period}</Td>
                <Td className="tabular-nums">{fa(r.score)}</Td><Td>{dir.name(r.reviewer_id)}</Td>
                <Td>{r.status === 'final' ? <Badge tone="success">نهایی</Badge> : <Badge tone="warning">پیش‌نویس</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {editing && <ReviewDialog row={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ReviewDialog({ row, onClose }: { row?: ReviewRow; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const employees = useQuery({ queryKey: ['hr', 'employees', 'status=active'], queryFn: () => a.get<{ id: string; full_name: string; personnel_no: string }[]>('/employees?status=active') });
  const detail = useQuery({ queryKey: ['hr', 'employee', row?.employee_id], queryFn: () => a.get<{ reviews: Review[] }>(`/employees/${row!.employee_id}`), enabled: !!row });
  const existing = detail.data?.reviews.find((r) => r.id === row?.id);
  const [employeeId, setEmployeeId] = useState(row?.employee_id ?? '');
  const [period, setPeriod] = useState(row?.period ?? '');
  const [criteria, setCriteria] = useState<Review['criteria'] | null>(null);
  const [strengths, setStrengths] = useState<string | null>(null);
  const [improvements, setImprovements] = useState<string | null>(null);
  const list = criteria ?? existing?.criteria ?? DEFAULT_CRITERIA;
  const total = list.reduce((s, c) => s + c.weight, 0);
  const preview = total ? (list.reduce((s, c) => s + c.weight * c.score, 0) / total / 5) * 100 : 0;
  const save = useMutation({
    mutationFn: (finalize: boolean) => {
      const body = { employeeId, period, criteria: list, strengths: strengths ?? existing?.strengths ?? '', improvements: improvements ?? existing?.improvements ?? '' };
      const qs = finalize ? '?finalize=1' : '';
      return row ? a.put(`/reviews/${row.id}${qs}`, body) : a.post(`/reviews${qs}`, body);
    },
    onSuccess: (_, finalize) => (toast(finalize ? 'ارزیابی نهایی شد و به کارمند اطلاع داده شد' : 'پیش‌نویس ذخیره شد'), void qc.invalidateQueries({ queryKey: ['hr'] }), onClose()),
    onError: err.set,
  });
  const set = (i: number, p: Partial<Review['criteria'][number]>) => setCriteria(list.map((c, j) => (j === i ? { ...c, ...p } : c)));
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={row ? 'ویرایش ارزیابی' : 'ارزیابی عملکرد جدید'}
      description="فقط عملکرد و رفتار شغلی ارزیابی شود. ارزیابی نهایی‌شده قابل تغییر نیست و کارمند آن را می‌بیند."
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button variant="secondary" disabled={!employeeId} loading={save.isPending} onClick={() => (err.clear(), save.mutate(false))}>ذخیره پیش‌نویس</Button><Button disabled={!employeeId} loading={save.isPending} onClick={() => (err.clear(), save.mutate(true))}>نهایی‌کردن</Button></>}>
      {err.banner}
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="کارمند" required>
            <Select value={employeeId} disabled={!!row} onChange={(e) => setEmployeeId(e.target.value)}><option value="">انتخاب کنید</option>{employees.data?.map((x) => <option key={x.id} value={x.id}>{x.full_name} ({x.personnel_no})</option>)}</Select>
          </Field>
          <Field label="دوره" required error={err.fields.period}><Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="مثلاً: نیمه اول ۱۴۰۵" /></Field>
        </div>
        <fieldset className="space-y-2 rounded-lg border border-border p-4">
          <legend className="px-1 font-semibold">معیارها (امتیاز ۱ تا ۵)</legend>
          {list.map((c, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <Field label={`معیار ${fa(i + 1)}`} className="grow"><Input value={c.label} onChange={(e) => set(i, { label: e.target.value })} /></Field>
              <Field label="وزن"><Select value={c.weight} onChange={(e) => set(i, { weight: Number(e.target.value) })}>{Array.from({ length: 10 }, (_, n) => <option key={n} value={n + 1}>{fa(n + 1)}</option>)}</Select></Field>
              <Field label="امتیاز"><Select value={c.score} onChange={(e) => set(i, { score: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{fa(n)} — {SCORE[n]}</option>)}</Select></Field>
              <Button variant="ghost" disabled={list.length === 1} aria-label={`حذف معیار ${i + 1}`} onClick={() => setCriteria(list.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setCriteria([...list, { label: '', weight: 1, score: 3 }])}><Plus className="size-4" /> معیار</Button>
          <p className="text-sm">امتیاز کل: <span className="font-bold tabular-nums">{fa(Math.round(preview * 10) / 10)}</span> از ۱۰۰</p>
        </fieldset>
        <Field label="نقاط قوت"><Textarea rows={2} value={strengths ?? existing?.strengths ?? ''} onChange={(e) => setStrengths(e.target.value)} /></Field>
        <Field label="زمینه‌های بهبود"><Textarea rows={2} value={improvements ?? existing?.improvements ?? ''} onChange={(e) => setImprovements(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
