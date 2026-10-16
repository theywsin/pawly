import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { Alert, Badge, Button, DateText, Dialog, EmptyState, ExportMenu, Field, Input, PageHeader, PageState, Select, Table, Td, Th, toast } from '@mohandesyar/ui';
import { useCan, useDirectory, useMe } from '@mohandesyar/module-sdk/web';
import { BASE, LEVEL, Nav, PeriodPicker, SOURCE, VALUE_STATUS, currentPeriod, fa, unitLabel, useApi, useServerErrors } from './common.js';
import type { Definition } from './definitions.js';

interface ValueRow { id: string; value: number; source: string; status: string; note: string; entered_by: string; entered_at: string; decided_by: string | null; decision_note: string; provider_snapshot: Record<string, unknown> | null }
interface SheetRow { definition: Definition; subjectType: string; subjectId: string; subjectName: string; target: number | null; value: ValueRow | null; canEnter: boolean }

export function ValuesPage() {
  const a = useApi();
  const qc = useQueryClient();
  const dir = useDirectory();
  const me = useMe();
  const canApprove = useCan('kpi.value.approve');
  const [period, setPeriod] = useState(currentPeriod('quarterly'));
  const [level, setLevel] = useState('');
  const [entering, setEntering] = useState<SheetRow | null>(null);
  const [deciding, setDeciding] = useState<{ row: SheetRow; decision: 'approve' | 'reject' } | null>(null);
  const q = useQuery({ queryKey: ['kpi', 'values', period, level], queryFn: () => a.get<{ label: string; rows: SheetRow[] }>(`/values?period=${period}${level ? `&level=${level}` : ''}`) });
  const err = useServerErrors();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['kpi'] });
  const compute = useMutation({
    mutationFn: (r: SheetRow) => a.post<{ value: number }>(`/definitions/${r.definition.id}/compute`, { period, subjectType: r.subjectType, subjectId: r.subjectId, subjectName: r.subjectName }),
    onSuccess: (r) => (toast(`مقدار ${fa(r.value)} محاسبه و برای تأیید ثبت شد`), err.clear(), refresh()),
    onError: err.set,
  });
  const reopen = useMutation({ mutationFn: (id: string) => a.post(`/values/${id}/reopen`, { comment: '' }), onSuccess: () => (toast('بازگشایی شد'), refresh()), onError: err.set });
  return (
    <>
      <PageHeader title="ثبت و تأیید مقادیر" description={q.data?.label} actions={<ExportMenu filename={`kpi-values-${period}`} title={`مقادیر شاخص‌ها ${q.data?.label ?? ''}`} rows={q.data?.rows} columns={[
        { header: 'شاخص', value: (r) => r.definition.name }, { header: 'موضوع', value: (r) => r.subjectName }, { header: 'هدف', value: (r) => r.target, kind: 'number' },
        { header: 'مقدار', value: (r) => r.value?.value, kind: 'number' }, { header: 'واحد', value: (r) => unitLabel(r.definition.unit) }, { header: 'منبع', value: (r) => (r.value ? SOURCE[r.value.source] : '') },
        { header: 'وضعیت', value: (r) => (r.value ? VALUE_STATUS[r.value.status]?.label : 'ثبت نشده') },
      ]} />} />
      <Nav />
      <div className="mb-4 flex flex-wrap items-end gap-3 print:hidden">
        <PeriodPicker value={period} onChange={setPeriod} />
        <Field label="سطح"><Select value={level} onChange={(e) => setLevel(e.target.value)}><option value="">همه</option>{Object.entries(LEVEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      </div>
      {err.banner}
      <PageState query={q} isEmpty={q.data?.rows.length === 0} empty={<EmptyState icon={<ClipboardList className="size-8" />} title="برای این دوره شاخص یا هدفی وجود ندارد" description="ابتدا در صفحه هر شاخص هدف این دوره را تعیین کنید." />}>
        <Table>
          <thead><tr><Th>شاخص</Th><Th>موضوع</Th><Th>هدف</Th><Th>مقدار</Th><Th>وضعیت</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
          <tbody>
            {q.data?.rows.map((r) => {
              const v = r.value;
              const enter = r.canEnter;
              return (
                <tr key={`${r.definition.id}:${r.subjectId}`}>
                  <Td><Link className="text-primary underline-offset-4 hover:underline" to={`${BASE}/definitions/${r.definition.id}`}>{r.definition.name}</Link><div className="text-xs text-muted">{SOURCE[r.definition.source]}{r.definition.is_gate && ' · شرط لازم'}</div></Td>
                  <Td>{r.subjectName}</Td>
                  <Td className="tabular-nums">{fa(r.target)}</Td>
                  <Td className="tabular-nums">
                    {v ? <>{fa(v.value)} <span className="text-xs text-muted">{unitLabel(r.definition.unit)}</span></> : '—'}
                    {v?.provider_snapshot && <div className="text-xs text-muted">{'provider' in v.provider_snapshot ? `از ${String(v.provider_snapshot.title ?? v.provider_snapshot.provider)}` : 'از فرمول'}</div>}
                  </Td>
                  <Td>
                    {v ? <Badge tone={VALUE_STATUS[v.status]!.tone}>{VALUE_STATUS[v.status]!.label}</Badge> : <Badge>ثبت نشده</Badge>}
                    {v && <div className="text-xs text-muted">{dir.name(v.entered_by)} · <DateText value={v.entered_at} /></div>}
                    {v?.decision_note && <div className="text-xs text-danger">{v.decision_note}</div>}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {enter && v?.status !== 'approved' && (r.definition.source === 'manual'
                      ? <Button size="sm" variant="secondary" onClick={() => setEntering(r)}>{v ? 'اصلاح' : 'ثبت مقدار'}</Button>
                      : <Button size="sm" variant="secondary" loading={compute.isPending} onClick={() => compute.mutate(r)}>{r.definition.source === 'provider' ? 'دریافت از ماژول' : 'محاسبه فرمول'}</Button>)}
                    {canApprove && v?.status === 'submitted' && v.entered_by !== me.user.id && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setDeciding({ row: r, decision: 'approve' })}>تأیید</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeciding({ row: r, decision: 'reject' })}>رد</Button>
                      </>
                    )}
                    {canApprove && v?.status === 'approved' && <Button size="sm" variant="ghost" loading={reopen.isPending} onClick={() => reopen.mutate(v.id)}>بازگشایی</Button>}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <p className="mt-3 text-xs text-muted">ثبت‌کننده یک مقدار نمی‌تواند همان مقدار را تأیید کند. فقط مقادیر تأییدشده در کارت امتیاز و روند به کار می‌روند.</p>
      </PageState>
      {entering && <EnterDialog row={entering} period={period} onClose={() => setEntering(null)} />}
      {deciding && <DecideDialog {...deciding} onClose={() => setDeciding(null)} />}
    </>
  );
}

function EnterDialog({ row, period, onClose }: { row: SheetRow; period: string; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [value, setValue] = useState(row.value ? String(row.value.value) : '');
  const [note, setNote] = useState(row.value?.note ?? '');
  const save = useMutation({
    mutationFn: () => a.post(`/definitions/${row.definition.id}/values`, { period, subjectType: row.subjectType, subjectId: row.subjectId, subjectName: row.subjectName, value: Number(value.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))), note }),
    onSuccess: () => (toast('مقدار ثبت و برای تأیید ارسال شد'), void qc.invalidateQueries({ queryKey: ['kpi'] }), onClose()),
    onError: err.set,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${row.definition.name} — ${row.subjectName}`} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={value === ''} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4">
        {row.target !== null && <Alert tone="info">هدف این دوره: {fa(row.target)} {unitLabel(row.definition.unit)}</Alert>}
        <Field label={`مقدار (${unitLabel(row.definition.unit)})`} required error={err.fields.value}><Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label="توضیح / مستند" hint="منبع عدد را برای تأییدکننده بنویسید"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function DecideDialog({ row, decision, onClose }: { row: SheetRow; decision: 'approve' | 'reject'; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [note, setNote] = useState('');
  const save = useMutation({ mutationFn: () => a.post(`/values/${row.value!.id}/decision`, { decision, note }), onSuccess: () => (toast(decision === 'approve' ? 'تأیید شد' : 'رد شد'), void qc.invalidateQueries({ queryKey: ['kpi'] }), onClose()), onError: err.set });
  const snap = row.value?.provider_snapshot;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={decision === 'approve' ? 'تأیید مقدار' : 'رد مقدار'}
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button variant={decision === 'reject' ? 'danger' : 'primary'} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>{decision === 'approve' ? 'تأیید' : 'رد'}</Button></>}>
      {err.banner}
      <p className="mb-3 text-sm">{row.definition.name} — {row.subjectName}: <span className="font-bold tabular-nums">{fa(row.value?.value)}</span> {unitLabel(row.definition.unit)} (هدف {fa(row.target)})</p>
      {row.value?.note && <p className="mb-3 text-sm text-muted">توضیح ثبت‌کننده: {row.value.note}</p>}
      {snap && <pre className="mb-3 overflow-x-auto rounded bg-surface-2 p-2 text-xs" dir="ltr">{JSON.stringify(snap, null, 2)}</pre>}
      <Field label={decision === 'reject' ? 'دلیل رد' : 'یادداشت'} required={decision === 'reject'} error={err.fields.note}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Dialog>
  );
}
