import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Gauge, Plus } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, DateText, DescriptionList, Dialog, EmptyState, ExportMenu, Field, Input, PageHeader, PageState, Select, Table, Td, Textarea, Th, toast } from '@mohandesyar/ui';
import { useCan, useDirectory } from '@mohandesyar/module-sdk/web';
import { BASE, FREQ, LEVEL, Nav, PeriodPicker, SOURCE, UNITS, VALUE_STATUS, currentPeriod, fa, unitLabel, useApi, useServerErrors } from './common.js';

export interface Definition {
  id: string; code: string; name: string; description: string; unit: string; direction: 'higher' | 'lower'; level: string; frequency: string; source: string; provider_key: string | null; formula: string | null;
  weight: number; good_pct: number; warning_pct: number; is_gate: boolean; owner_user_id: string | null; status: string; version: number; pending_values?: number;
}

export function DefinitionsPage() {
  const a = useApi();
  const dir = useDirectory();
  const canManage = useCan('kpi.definition.manage');
  const [editing, setEditing] = useState<Definition | 'new' | null>(null);
  const q = useQuery({ queryKey: ['kpi', 'definitions'], queryFn: () => a.get<Definition[]>('/definitions') });
  return (
    <>
      <PageHeader title="شاخص‌های عملکرد" description="هیچ پرداختی بر پایه محاسبه تأییدنشده انجام نمی‌شود؛ ضرایب پاداش فقط پیشنهادی‌اند." actions={
        <>
          <ExportMenu filename="kpi-definitions" title="شاخص‌های عملکرد" rows={q.data} columns={[
            { header: 'کد', value: (r) => r.code }, { header: 'نام', value: (r) => r.name }, { header: 'سطح', value: (r) => LEVEL[r.level] }, { header: 'دوره', value: (r) => FREQ[r.frequency] },
            { header: 'منبع', value: (r) => SOURCE[r.source] }, { header: 'جهت مطلوب', value: (r) => (r.direction === 'higher' ? 'بیشتر بهتر' : 'کمتر بهتر') }, { header: 'وزن', value: (r) => r.weight, kind: 'number' },
            { header: 'شرط لازم', value: (r) => (r.is_gate ? 'بله' : '') }, { header: 'مسئول', value: (r) => (r.owner_user_id ? dir.name(r.owner_user_id) : '') }, { header: 'نسخه', value: (r) => r.version, kind: 'number' },
          ]} />
          {canManage && <Button onClick={() => setEditing('new')}><Plus className="size-4" /> شاخص جدید</Button>}
        </>
      } />
      <Nav />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<Gauge className="size-8" />} title="هنوز شاخصی تعریف نشده است" action={canManage ? <Button onClick={() => setEditing('new')}>تعریف اولین شاخص</Button> : undefined} />}>
        <Table>
          <thead><tr><Th>شاخص</Th><Th>سطح</Th><Th>دوره</Th><Th>منبع</Th><Th>جهت</Th><Th>وزن</Th><Th>مسئول</Th><Th>وضعیت</Th></tr></thead>
          <tbody>
            {q.data?.map((d) => (
              <tr key={d.id}>
                <Td>
                  <Link to={`${BASE}/definitions/${d.id}`} className="font-medium text-primary underline-offset-4 hover:underline">{d.name}</Link>
                  {d.is_gate && <Badge tone="warning" className="ms-2">شرط لازم</Badge>}
                  <div className="text-xs text-muted" dir="ltr">{d.code}</div>
                </Td>
                <Td>{LEVEL[d.level]}</Td><Td>{FREQ[d.frequency]}</Td><Td>{SOURCE[d.source]}</Td><Td>{d.direction === 'higher' ? 'بیشتر بهتر' : 'کمتر بهتر'}</Td>
                <Td>{fa(d.weight)}</Td><Td>{d.owner_user_id ? dir.name(d.owner_user_id) : '—'}</Td>
                <Td>{d.status === 'archived' ? <Badge>بایگانی</Badge> : d.pending_values ? <Badge tone="warning">{fa(d.pending_values)} مقدار در انتظار</Badge> : <Badge tone="success">فعال</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {editing && <DefinitionForm def={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function DefinitionForm({ def, onClose }: { def?: Definition; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const nav = useNavigate();
  const dir = useDirectory();
  const err = useServerErrors();
  const providers = useQuery({ queryKey: ['kpi', 'providers'], queryFn: () => a.get<{ key: string; moduleId: string; title: string; unit: string }[]>('/providers') });
  const [v, setV] = useState({
    code: def?.code ?? '', name: def?.name ?? '', description: def?.description ?? '', unit: def?.unit ?? 'count', direction: def?.direction ?? 'higher', level: def?.level ?? 'org',
    frequency: def?.frequency ?? 'quarterly', source: def?.source ?? 'manual', providerKey: def?.provider_key ?? '', formula: def?.formula ?? '', weight: String(def?.weight ?? 1),
    goodPct: String(def?.good_pct ?? 100), warningPct: String(def?.warning_pct ?? 80), ownerUserId: def?.owner_user_id ?? '', status: def?.status ?? 'active',
  });
  const [isGate, setIsGate] = useState(def?.is_gate ?? false);
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...v, isGate, weight: Number(v.weight) || 1, goodPct: Number(v.goodPct), warningPct: Number(v.warningPct), ownerUserId: v.ownerUserId || null, providerKey: v.providerKey || null, formula: v.formula || null };
      return def ? a.put<{ id: string; version: number }>(`/definitions/${def.id}`, body) : a.post<{ id: string; version: number }>('/definitions', body);
    },
    onSuccess: (r) => (toast(`شاخص ذخیره شد (نسخه ${fa(r.version)})`), void qc.invalidateQueries({ queryKey: ['kpi'] }), onClose(), !def && nav(`${BASE}/definitions/${r.id}`)),
    onError: err.set,
  });
  const f = err.fields;
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={def ? `ویرایش شاخص (نسخه ${fa(def.version)})` : 'شاخص جدید'} description={def ? 'هر ذخیره نسخه جدیدی می‌سازد؛ نسخه‌های قبلی و مقادیر ثبت‌شده با آن‌ها نگه داشته می‌شوند.' : undefined}
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ذخیره</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نام شاخص" required error={f.name}><Input value={v.name} onChange={(e) => set('name')(e.target.value)} placeholder="مثلاً: درصد پیشرفت فیزیکی" /></Field>
        <Field label="کد (برای فرمول)" required error={f.code} hint="حروف کوچک لاتین، رقم و _"><Input dir="ltr" value={v.code} onChange={(e) => set('code')(e.target.value)} placeholder="physical_progress" /></Field>
        <Field label="توضیح" className="sm:col-span-2"><Textarea rows={2} value={v.description} onChange={(e) => set('description')(e.target.value)} /></Field>
        <Field label="سطح"><Select value={v.level} onChange={(e) => set('level')(e.target.value)}>{Object.entries(LEVEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="دوره سنجش"><Select value={v.frequency} onChange={(e) => set('frequency')(e.target.value)}>{Object.entries(FREQ).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="واحد"><Select value={v.unit} onChange={(e) => set('unit')(e.target.value)}>{Object.entries(UNITS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="جهت مطلوب"><Select value={v.direction} onChange={(e) => set('direction')(e.target.value)}><option value="higher">بیشتر بهتر</option><option value="lower">کمتر بهتر</option></Select></Field>
        <Field label="منبع داده"><Select value={v.source} onChange={(e) => set('source')(e.target.value)}>{Object.entries(SOURCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        {v.source === 'provider' && (
          <Field label="Provider" required error={f.providerKey}>
            <Select value={v.providerKey} onChange={(e) => set('providerKey')(e.target.value)}>
              <option value="">انتخاب کنید</option>
              {providers.data?.map((p) => <option key={p.key} value={p.key}>{p.title} ({unitLabel(p.unit)})</option>)}
            </Select>
          </Field>
        )}
        {v.source === 'formula' && (
          <Field label="فرمول" required error={f.formula} hint="کد شاخص‌های هم‌سطح و هم‌دوره، + − × ÷، پرانتز، min، max، abs، round" className="sm:col-span-2">
            <Input dir="ltr" value={v.formula} onChange={(e) => set('formula')(e.target.value)} placeholder="done / planned * 100" />
          </Field>
        )}
        <Field label="وزن در کارت امتیاز" error={f.weight}><Input inputMode="numeric" value={v.weight} onChange={(e) => set('weight')(e.target.value.replace(/\D/g, ''))} /></Field>
        <Field label="مسئول شاخص"><Select value={v.ownerUserId} onChange={(e) => set('ownerUserId')(e.target.value)}><option value="">—</option>{dir.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</Select></Field>
        <Field label="آستانه مطلوب (٪ تحقق هدف)" error={f.goodPct}><Input inputMode="decimal" value={v.goodPct} onChange={(e) => set('goodPct')(e.target.value)} /></Field>
        <Field label="آستانه هشدار (٪ تحقق هدف)" hint="کمتر از این: بحرانی" error={f.warningPct}><Input inputMode="decimal" value={v.warningPct} onChange={(e) => set('warningPct')(e.target.value)} /></Field>
        <div className="sm:col-span-2"><Checkbox label="شرط لازم (ایمنی/کیفیت/انطباق): اگر مطلوب نباشد، کارت امتیاز ضریب پاداش شرط لازم را می‌گیرد" checked={isGate} onChange={(e) => setIsGate(e.target.checked)} /></div>
        {def && <Field label="وضعیت"><Select value={v.status} onChange={(e) => set('status')(e.target.value)}><option value="active">فعال</option><option value="archived">بایگانی</option></Select></Field>}
      </div>
    </Dialog>
  );
}

interface HistoryRow { period: string; label: string; subject_type: string; subject_id: string; subject_name: string; value: number | null; status: string | null; target: number | null }

export function DefinitionPage() {
  const { id } = useParams();
  const a = useApi();
  const dir = useDirectory();
  const canManage = useCan('kpi.definition.manage');
  const [editing, setEditing] = useState(false);
  const [targets, setTargets] = useState(false);
  const q = useQuery({ queryKey: ['kpi', 'definition', id], queryFn: () => a.get<{ definition: Definition; versions: { version: number; created_at: string; created_by: string }[]; history: HistoryRow[] }>(`/definitions/${id}`) });
  const data = q.data;
  const d = data?.definition;
  const subjects = [...new Set((q.data?.history ?? []).map((h) => h.subject_name))];
  const [subject, setSubject] = useState<string | null>(null);
  const sel = subject ?? subjects[0] ?? null;
  return (
    <>
      <Link to={`${BASE}/definitions`} className="mb-3 inline-flex items-center gap-1 text-sm text-primary print:hidden"><ArrowRight className="size-4" /> شاخص‌ها</Link>
      <PageState query={q}>
        {d && data && (
          <>
            <PageHeader title={d.name} description={d.description || undefined} actions={canManage && <><Button variant="secondary" onClick={() => setTargets(true)}>تعیین هدف</Button><Button variant="secondary" onClick={() => setEditing(true)}>ویرایش</Button></>} />
            <Nav />
            <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
              <Card>
                <CardHeader title="مشخصات" />
                <div className="p-5">
                  <DescriptionList items={[
                    { label: 'کد', value: <span dir="ltr">{d.code}</span> },
                    { label: 'سطح / دوره', value: `${LEVEL[d.level]} · ${FREQ[d.frequency]}` },
                    { label: 'منبع', value: <>{SOURCE[d.source]}{d.formula && <code className="ms-1 block text-xs" dir="ltr">{d.formula}</code>}{d.provider_key && <span className="ms-1 text-xs" dir="ltr">{d.provider_key}</span>}</> },
                    { label: 'واحد / جهت', value: `${unitLabel(d.unit)} · ${d.direction === 'higher' ? 'بیشتر بهتر' : 'کمتر بهتر'}` },
                    { label: 'آستانه‌ها', value: `مطلوب ≥ ${fa(d.good_pct)}٪ · هشدار ≥ ${fa(d.warning_pct)}٪ تحقق` },
                    { label: 'وزن', value: fa(d.weight) },
                    { label: 'شرط لازم', value: d.is_gate ? 'بله' : 'خیر' },
                    { label: 'مسئول', value: d.owner_user_id ? dir.name(d.owner_user_id) : '—' },
                    { label: 'نسخه', value: fa(d.version) },
                  ]} />
                </div>
              </Card>
              <Card className="lg:col-span-2">
                <CardHeader title="روند تاریخی" description="مقدار تأییدشده در برابر هدف" actions={subjects.length > 1 && <Select aria-label="موضوع" value={sel ?? ''} onChange={(e) => setSubject(e.target.value)}>{subjects.map((s) => <option key={s} value={s}>{s}</option>)}</Select>} />
                <div className="p-5">
                  {sel ? <TrendChart rows={data.history.filter((h) => h.subject_name === sel)} unit={d.unit} /> : <p className="text-sm text-muted">داده کافی وجود ندارد.</p>}
                </div>
              </Card>
            </div>
            <Card className="mt-6">
              <CardHeader title="هدف‌ها و مقادیر" />
              {data.history.length === 0 ? <p className="p-5 text-sm text-muted">هنوز هدف یا مقداری ثبت نشده است.</p> : (
                <Table>
                  <thead><tr><Th>دوره</Th><Th>موضوع</Th><Th>هدف</Th><Th>مقدار</Th><Th>وضعیت مقدار</Th></tr></thead>
                  <tbody>{[...data.history].reverse().map((h, i) => <tr key={i}><Td>{h.label}</Td><Td>{h.subject_name}</Td><Td>{fa(h.target)}</Td><Td>{fa(h.value)}</Td><Td>{h.status ? <Badge tone={VALUE_STATUS[h.status]!.tone}>{VALUE_STATUS[h.status]!.label}</Badge> : '—'}</Td></tr>)}</tbody>
                </Table>
              )}
            </Card>
            <Card className="mt-6">
              <CardHeader title="نسخه‌های تعریف" />
              <ul className="space-y-1 p-5 text-sm">{data.versions.map((v) => <li key={v.version}>نسخه {fa(v.version)} · <DateText value={v.created_at} /> · {dir.name(v.created_by)}</li>)}</ul>
            </Card>
            {editing && <DefinitionForm def={d} onClose={() => setEditing(false)} />}
            {targets && <TargetsDialog def={d} onClose={() => setTargets(false)} />}
          </>
        )}
      </PageState>
    </>
  );
}

/** Small inline SVG line chart (no chart library): approved values and targets per period. */
function TrendChart({ rows, unit }: { rows: HistoryRow[]; unit: string }) {
  const pts = rows.filter((r) => r.value !== null || r.target !== null);
  if (!pts.length) return <p className="text-sm text-muted">داده کافی وجود ندارد.</p>;
  const all = pts.flatMap((p) => [p.status === 'approved' ? p.value : null, p.target]).filter((x): x is number => x !== null);
  const max = Math.max(...all, 0);
  const min = Math.min(...all, 0);
  const W = 560;
  const H = 200;
  const pad = 30;
  const x = (i: number) => (pts.length === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (pts.length - 1));
  const y = (v: number) => H - pad - ((v - min) / (max - min || 1)) * (H - 2 * pad);
  const line = (sel: (r: HistoryRow) => number | null) => pts.map((r, i) => [i, sel(r)] as const).filter(([, v]) => v !== null).map(([i, v], k) => `${k ? 'L' : 'M'}${x(i)},${y(v!)}`).join(' ');
  const approved = (r: HistoryRow) => (r.status === 'approved' ? r.value : null);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`روند: ${pts.map((p) => `${p.label} مقدار ${fa(approved(p))} هدف ${fa(p.target)}`).join('؛ ')}`}>
        <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} className="stroke-border" />
        <path d={line((r) => r.target)} fill="none" className="stroke-muted" strokeDasharray="5 4" strokeWidth={2} />
        <path d={line(approved)} fill="none" className="stroke-primary" strokeWidth={2.5} />
        {pts.map((r, i) => approved(r) !== null && <circle key={i} cx={x(i)} cy={y(approved(r)!)} r={4} className="fill-primary" />)}
        {pts.map((r, i) => <text key={`t${i}`} x={x(i)} y={H - 8} textAnchor="middle" className="fill-muted text-[10px]">{r.label}</text>)}
      </svg>
      <figcaption className="mt-2 flex gap-4 text-xs text-muted"><span><span className="inline-block h-0.5 w-4 bg-primary align-middle" /> مقدار تأییدشده ({unitLabel(unit)})</span><span><span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-muted align-middle" /> هدف</span></figcaption>
    </figure>
  );
}

function TargetsDialog({ def, onClose }: { def: Definition; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [period, setPeriod] = useState(currentPeriod(def.frequency));
  const subjects = useQuery({ queryKey: ['kpi', 'subjects', def.level], queryFn: () => a.get<{ id: string; name: string }[]>(`/subjects?type=${def.level}`) });
  const sheet = useQuery({ queryKey: ['kpi', 'values', period, def.level], queryFn: () => a.get<{ rows: { definition: { id: string }; subjectId: string; subjectName: string; target: number | null }[] }>(`/values?period=${period}&level=${def.level}`) });
  const existing = (sheet.data?.rows ?? []).filter((r) => r.definition.id === def.id);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState('');
  const options = [...(subjects.data ?? []), ...(extra && !(subjects.data ?? []).some((s) => s.id === extra) ? [{ id: extra, name: extra }] : [])];
  const value = (sid: string) => vals[`${period}:${sid}`] ?? (existing.find((e) => e.subjectId === sid)?.target?.toString() ?? '');
  const save = useMutation({
    mutationFn: () => a.put(`/definitions/${def.id}/targets`, {
      period,
      targets: options.filter((s) => value(s.id) !== '').map((s) => ({ subjectType: def.level, subjectId: s.id, subjectName: s.name, target: Number(value(s.id).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))) })),
    }),
    onSuccess: () => (toast('هدف‌ها ذخیره شد'), void qc.invalidateQueries({ queryKey: ['kpi'] }), onClose()),
    onError: err.set,
  });
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={`هدف‌های «${def.name}»`} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ذخیره</Button></>}>
      {err.banner}
      <PeriodPicker value={period} onChange={setPeriod} fixedFrequency={def.frequency} />
      <PageState query={subjects}>
        {options.length === 0 && <Alert tone="info" className="my-3">موضوعی برای سطح «{LEVEL[def.level]}» یافت نشد؛ نام آن را وارد کنید.</Alert>}
        <div className="mt-4 space-y-2">
          {options.map((s) => (
            <div key={s.id} className="flex items-end gap-3">
              <span className="w-56 truncate text-sm">{s.name}</span>
              <Input aria-label={`هدف ${s.name}`} inputMode="decimal" className="w-40" value={value(s.id)} onChange={(e) => setVals({ ...vals, [`${period}:${s.id}`]: e.target.value })} />
              <span className="text-xs text-muted">{unitLabel(def.unit)}</span>
            </div>
          ))}
        </div>
        {(def.level === 'unit' || def.level === 'role') && (
          <Field label={`افزودن ${LEVEL[def.level]}`} className="mt-4"><Input value={extra} onChange={(e) => setExtra(e.target.value.trim())} placeholder="نام" /></Field>
        )}
      </PageState>
    </Dialog>
  );
}
