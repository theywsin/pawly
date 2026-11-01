import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, DateText, Dialog, EmptyState, ExportMenu, Field, Input, PageHeader, PageState, Select, Stat, Table, Td, Th, toast } from '@mohandesyar/ui';
import { useCan, useDirectory, useMe } from '@mohandesyar/module-sdk/web';
import { BASE, CARD_STATUS, LEVEL, Nav, PeriodPicker, STATUS, currentPeriod, fa, unitLabel, useApi, useServerErrors } from './common.js';

interface CardRow { id: string; subject_type: string; subject_id: string; subject_name: string; period: string; version: number; score: number | null; complete: boolean; gate_failed: boolean; status: string; computed_at: string; reward_coefficient: number | null }
interface Item { definitionId: string; name: string; unit: string; weight: number; isGate: boolean; target: number | null; value: number | null; valueStatus: string | null; achievement: number | null; score: number | null; status: string; reason: string }

const periodLabel = (p: string) => {
  const [y, x] = p.split('-');
  const yy = Number(y).toLocaleString('fa-IR', { useGrouping: false });
  if (!x) return `سال ${yy}`;
  if (x.startsWith('Q')) return `${['', 'بهار', 'تابستان', 'پاییز', 'زمستان'][Number(x[1])]} ${yy}`;
  return `${['', 'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'][Number(x)]} ${yy}`;
};

export function ScorecardsPage() {
  const a = useApi();
  const qc = useQueryClient();
  const canReview = useCan('kpi.scorecard.review');
  const [period, setPeriod] = useState(currentPeriod('quarterly'));
  const [level, setLevel] = useState('person');
  const err = useServerErrors();
  const q = useQuery({ queryKey: ['kpi', 'scorecards', period], queryFn: () => a.get<CardRow[]>(`/scorecards?period=${period}`) });
  const compute = useMutation({
    mutationFn: () => a.post<{ id: string }[]>('/scorecards/compute', { period, subjectType: level }),
    onSuccess: (r) => (toast(`${fa(r.length)} کارت امتیاز محاسبه شد`), err.clear(), void qc.invalidateQueries({ queryKey: ['kpi'] })),
    onError: err.set,
  });
  return (
    <>
      <PageHeader title="کارت امتیاز" description={periodLabel(period)} actions={<ExportMenu filename={`scorecards-${period}`} title={`کارت امتیاز ${periodLabel(period)}`} rows={q.data} columns={[
        { header: 'سطح', value: (r) => LEVEL[r.subject_type] }, { header: 'موضوع', value: (r) => r.subject_name }, { header: 'امتیاز', value: (r) => r.score, kind: 'number' },
        { header: 'شرط لازم', value: (r) => (r.gate_failed ? 'برقرار نیست' : 'برقرار') }, { header: 'کامل', value: (r) => (r.complete ? 'بله' : 'خیر') }, { header: 'نسخه', value: (r) => r.version, kind: 'number' },
        { header: 'وضعیت', value: (r) => CARD_STATUS[r.status]?.label }, { header: 'ضریب پاداش پیشنهادی', value: (r) => r.reward_coefficient, kind: 'number' },
      ]} />} />
      <Nav />
      <div className="mb-4 flex flex-wrap items-end gap-3 print:hidden">
        <PeriodPicker value={period} onChange={setPeriod} />
        {canReview && (
          <>
            <Field label="سطح"><Select value={level} onChange={(e) => setLevel(e.target.value)}>{Object.entries(LEVEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Button loading={compute.isPending} onClick={() => compute.mutate()}>محاسبه / به‌روزرسانی کارت‌ها</Button>
          </>
        )}
      </div>
      {err.banner}
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState title="برای این دوره کارت امتیازی وجود ندارد" description={canReview ? 'پس از تعیین هدف و تأیید مقادیر، کارت‌ها را محاسبه کنید.' : undefined} />}>
        <Table>
          <thead><tr><Th>موضوع</Th><Th>سطح</Th><Th>امتیاز</Th><Th>شرط لازم</Th><Th>وضعیت</Th><Th>ضریب پاداش پیشنهادی</Th></tr></thead>
          <tbody>
            {q.data?.map((c) => (
              <tr key={c.id}>
                <Td><Link className="font-medium text-primary underline-offset-4 hover:underline" to={`${BASE}/scorecards/${c.id}`}>{c.subject_name}</Link>{c.version > 1 && <span className="text-xs text-muted"> · نسخه {fa(c.version)}</span>}</Td>
                <Td>{LEVEL[c.subject_type]}</Td>
                <Td className="tabular-nums">{fa(c.score, 1)}{!c.complete && <Badge tone="warning" className="ms-2">ناقص</Badge>}</Td>
                <Td>{c.gate_failed ? <Badge tone="danger">برقرار نیست</Badge> : <Badge tone="success">برقرار</Badge>}</Td>
                <Td><Badge tone={CARD_STATUS[c.status]!.tone}>{CARD_STATUS[c.status]!.label}</Badge></Td>
                <Td className="tabular-nums">{c.reward_coefficient === null ? '—' : `× ${fa(c.reward_coefficient, 3)}`}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
    </>
  );
}

export function ScorecardPage() {
  const { id } = useParams();
  const a = useApi();
  const qc = useQueryClient();
  const dir = useDirectory();
  const me = useMe();
  const canReview = useCan('kpi.scorecard.review');
  const canApprove = useCan('kpi.scorecard.approve');
  const err = useServerErrors();
  const [comment, setComment] = useState('');
  const q = useQuery({
    queryKey: ['kpi', 'scorecard', id],
    queryFn: () => a.get<{
      scorecard: CardRow & { label: string; breakdown: { items: Item[]; gateReasons: string[] }; reviewed_by: string | null; reviewed_at: string | null; approved_by: string | null; approved_at: string | null; comment: string; computed_by: string };
      versions: { id: string; version: number; score: number | null; status: string }[];
      reward: { coefficient: number; reason: string; rule_name: string; rule_version: number } | null;
    }>(`/scorecards/${id}`),
  });
  const act = useMutation({
    mutationFn: (what: 'review' | 'approve') => a.post(`/scorecards/${id}/${what}`, { comment }),
    onSuccess: (_, what) => (toast(what === 'review' ? 'بازبینی ثبت شد' : 'کارت امتیاز تأیید شد'), err.clear(), void qc.invalidateQueries({ queryKey: ['kpi'] })),
    onError: err.set,
  });
  const d = q.data;
  const s = d?.scorecard;
  const self = s?.subject_type === 'person' && s.subject_id === me.user.id;
  return (
    <>
      <Link to={`${BASE}/scorecards`} className="mb-3 inline-flex items-center gap-1 text-sm text-primary print:hidden"><ArrowRight className="size-4" /> کارت‌های امتیاز</Link>
      <PageState query={q}>
        {d && s && (
          <>
            <PageHeader title={`${s.subject_name} — ${s.label}`} description={`${LEVEL[s.subject_type]} · نسخه ${fa(s.version)}`} actions={<Button variant="secondary" onClick={() => window.print()}>چاپ / PDF</Button>} />
            <div className="mb-6 grid gap-3 sm:grid-cols-4">
              <Stat label="امتیاز">{fa(s.score, 1)} <span className="text-sm text-muted">از ۱۰۰</span></Stat>
              <Stat label="شرط لازم">{s.gate_failed ? <Badge tone="danger">برقرار نیست</Badge> : <Badge tone="success">برقرار</Badge>}</Stat>
              <Stat label="وضعیت"><Badge tone={CARD_STATUS[s.status]!.tone}>{CARD_STATUS[s.status]!.label}</Badge></Stat>
              <Stat label="ضریب پاداش پیشنهادی" hint={d.reward ? `${d.reward.rule_name} (نسخه ${fa(d.reward.rule_version)}) · ${d.reward.reason}` : 'پس از تأیید نهایی'}>{d.reward ? `× ${fa(d.reward.coefficient, 3)}` : '—'}</Stat>
            </div>
            {!s.complete && <Alert tone="warning" className="mb-4">کارت ناقص است: برخی شاخص‌ها هدف یا مقدار تأییدشده ندارند و تا کامل شدن قابل تأیید نهایی نیست.</Alert>}
            {s.breakdown.gateReasons.length > 0 && <Alert tone="danger" className="mb-4" title="شرط لازم برقرار نیست">{s.breakdown.gateReasons.join('؛ ')}</Alert>}
            <Card>
              <CardHeader title="جزئیات و دلیل امتیاز" description="تحقق هدف حداکثر ۱۲۰٪ شمرده می‌شود؛ فقط مقادیر تأییدشده." />
              <Table>
                <thead><tr><Th>شاخص</Th><Th>وزن</Th><Th>هدف</Th><Th>مقدار تأییدشده</Th><Th>امتیاز</Th><Th>وضعیت</Th><Th>دلیل</Th></tr></thead>
                <tbody>
                  {s.breakdown.items.map((i) => (
                    <tr key={i.definitionId}>
                      <Td>{i.name}{i.isGate && <Badge tone="warning" className="ms-2">شرط لازم</Badge>}</Td>
                      <Td>{fa(i.weight)}</Td><Td>{fa(i.target)} <span className="text-xs text-muted">{unitLabel(i.unit)}</span></Td><Td>{fa(i.value)}</Td>
                      <Td className="tabular-nums">{fa(i.score, 1)}</Td>
                      <Td><Badge tone={STATUS[i.status]!.tone}>{STATUS[i.status]!.label}</Badge></Td>
                      <Td className="text-sm text-muted">{i.reason}{i.valueStatus === 'submitted' && ' (مقدار در انتظار تأیید)'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
            <div className="mt-6 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
              <Card className="p-5 text-sm">
                <h2 className="mb-2 font-semibold">گردش بازبینی و تأیید</h2>
                <ul className="space-y-1">
                  <li>محاسبه: {dir.name(s.computed_by)} · <DateText value={s.computed_at} /></li>
                  <li>بازبینی: {s.reviewed_by ? <>{dir.name(s.reviewed_by)} · <DateText value={s.reviewed_at} /></> : '—'}</li>
                  <li>تأیید نهایی: {s.approved_by ? <>{dir.name(s.approved_by)} · <DateText value={s.approved_at} /></> : '—'}</li>
                  {s.comment && <li>یادداشت: {s.comment}</li>}
                </ul>
                {err.banner}
                {((canReview && s.status === 'draft') || (canApprove && s.status === 'reviewed' && !self)) && (
                  <div className="mt-4 space-y-2 print:hidden">
                    <Field label="یادداشت"><Input value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
                    {canReview && s.status === 'draft' && <Button loading={act.isPending} onClick={() => act.mutate('review')}>ثبت بازبینی</Button>}
                    {canApprove && s.status === 'reviewed' && !self && <Button loading={act.isPending} disabled={!s.complete} onClick={() => act.mutate('approve')}>تأیید نهایی</Button>}
                    <p className="text-xs text-muted">بازبین و تأییدکننده نهایی باید دو نفر متفاوت باشند. ضریب پاداش فقط پیشنهاد است و پرداختی انجام نمی‌شود.</p>
                  </div>
                )}
              </Card>
              <Card className="p-5 text-sm">
                <h2 className="mb-2 font-semibold">نسخه‌ها</h2>
                <ul className="space-y-1">{d.versions.map((v) => <li key={v.id}>{v.id === s.id ? <span className="font-semibold">نسخه {fa(v.version)}</span> : <Link className="text-primary underline" to={`${BASE}/scorecards/${v.id}`}>نسخه {fa(v.version)}</Link>} · امتیاز {fa(v.score, 1)} · {CARD_STATUS[v.status]!.label}</li>)}</ul>
              </Card>
            </div>
          </>
        )}
      </PageState>
    </>
  );
}

interface Rule { id: string; version: number; name: string; bands: { minScore: number; coefficient: number }[]; gate_coefficient: number; active: boolean; created_at: string; created_by: string }

export function RewardsPage() {
  const a = useApi();
  const dir = useDirectory();
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['kpi', 'rules'], queryFn: () => a.get<Rule[]>('/reward-rules') });
  const active = q.data?.find((r) => r.active);
  return (
    <>
      <PageHeader title="ضرایب پاداش" description="فقط پیشنهادی: این ماژول هیچ پرداختی انجام نمی‌دهد و به حقوق و دستمزد متصل نیست." actions={<Button onClick={() => setEditing(true)}><Plus className="size-4" /> نسخه جدید قاعده</Button>} />
      <Nav />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState title="قاعده‌ای تعریف نشده است" description="بدون قاعده، کارت‌های تأییدشده ضریب پیشنهادی نمی‌گیرند." action={<Button onClick={() => setEditing(true)}>تعریف قاعده</Button>} />}>
        <div className="space-y-4">
          {q.data?.map((r) => (
            <Card key={r.id} className="p-5 text-sm">
              <div className="mb-2 flex flex-wrap items-center gap-2"><span className="font-semibold">{r.name}</span><span className="text-muted">نسخه {fa(r.version)}</span>{r.active ? <Badge tone="success">فعال</Badge> : <Badge>بایگانی</Badge>}</div>
              <ul className="mb-2">{r.bands.map((b, i) => <li key={i}>امتیاز ≥ {fa(b.minScore)} ← ضریب × {fa(b.coefficient, 3)}</li>)}</ul>
              <p>در صورت برقرار نبودن شرط لازم: ضریب × {fa(r.gate_coefficient, 3)}</p>
              <p className="mt-1 text-xs text-muted">{dir.name(r.created_by)} · <DateText value={r.created_at} /></p>
            </Card>
          ))}
        </div>
      </PageState>
      {editing && <RuleDialog base={active} onClose={() => setEditing(false)} />}
    </>
  );
}

function RuleDialog({ base, onClose }: { base?: Rule; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [name, setName] = useState(base?.name ?? 'ضریب پاداش عملکرد');
  const [bands, setBands] = useState(base?.bands.map((b) => ({ minScore: String(b.minScore), coefficient: String(b.coefficient) })) ?? [{ minScore: '90', coefficient: '1.2' }, { minScore: '70', coefficient: '1' }, { minScore: '50', coefficient: '0.5' }]);
  const [gate, setGate] = useState(String(base?.gate_coefficient ?? 0));
  const save = useMutation({
    mutationFn: () => a.post<{ version: number }>('/reward-rules', { name, bands: bands.map((b) => ({ minScore: Number(b.minScore), coefficient: Number(b.coefficient) })), gateCoefficient: Number(gate) }),
    onSuccess: (r) => (toast(`نسخه ${fa(r.version)} فعال شد`), void qc.invalidateQueries({ queryKey: ['kpi', 'rules'] }), onClose()),
    onError: err.set,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="نسخه جدید قاعده ضریب پاداش" description="کارت‌هایی که قبلاً تأیید شده‌اند با نسخه قبلی باقی می‌مانند."
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ذخیره و فعال‌سازی</Button></>}>
      {err.banner}
      <div className="space-y-3">
        <Field label="نام" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {bands.map((b, i) => (
          <div key={i} className="flex items-end gap-2">
            <Field label="حداقل امتیاز"><Input inputMode="decimal" value={b.minScore} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, minScore: e.target.value } : x)))} /></Field>
            <Field label="ضریب"><Input inputMode="decimal" value={b.coefficient} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, coefficient: e.target.value } : x)))} /></Field>
            <Button variant="ghost" disabled={bands.length === 1} aria-label={`حذف بازه ${i + 1}`} onClick={() => setBands(bands.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setBands([...bands, { minScore: '', coefficient: '' }])}><Plus className="size-4" /> بازه</Button>
        <Field label="ضریب در صورت برقرار نبودن شرط لازم"><Input inputMode="decimal" value={gate} onChange={(e) => setGate(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
