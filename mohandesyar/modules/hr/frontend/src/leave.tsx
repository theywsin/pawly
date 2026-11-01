import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, Plus } from 'lucide-react';
import { Badge, Button, Card, CardHeader, Checkbox, DateInput, DayText, Dialog, EmptyState, ExportMenu, Field, Input, PageHeader, PageState, Select, Table, Tabs, Td, Th, toast } from '@mohandesyar/ui';
import { useCan } from '@mohandesyar/module-sdk/web';
import { todayIso } from '@mohandesyar/persian';
import { BASE, LEAVE_STATUS, Nav, fa, useApi, useServerErrors } from './common.js';

export interface Balance { typeId: string; name: string; paid: boolean; allowance: number | null; approved: number; pending: number; remaining: number | null }
interface LeaveRow { id: string; employee_id?: string; full_name: string; personnel_no?: string; department?: string; type_name: string; starts_on: string; ends_on: string; days: number; reason: string; status: string; requested_by?: string }

export function LeaveList({ items, showName, onCancel, cancelling }: { items: LeaveRow[]; showName: boolean; onCancel?: (id: string) => void; cancelling?: boolean }) {
  if (!items.length) return <p className="text-sm text-muted">درخواست مرخصی‌ای ثبت نشده است.</p>;
  return (
    <Table>
      <thead><tr>{showName && <Th>کارمند</Th>}<Th>نوع</Th><Th>از</Th><Th>تا</Th><Th>روز کاری</Th><Th>علت</Th><Th>وضعیت</Th>{onCancel && <Th><span className="sr-only">عملیات</span></Th>}</tr></thead>
      <tbody>
        {items.map((l) => (
          <tr key={l.id}>
            {showName && <Td>{l.employee_id ? <Link className="text-primary underline-offset-4 hover:underline" to={`${BASE}/employees/${l.employee_id}`}>{l.full_name}</Link> : l.full_name}</Td>}
            <Td>{l.type_name}</Td><Td><DayText value={l.starts_on} /></Td><Td><DayText value={l.ends_on} /></Td><Td>{fa(l.days)}</Td><Td className="max-w-56 truncate">{l.reason || '—'}</Td>
            <Td><Badge tone={LEAVE_STATUS[l.status]!.tone}>{LEAVE_STATUS[l.status]!.label}</Badge></Td>
            {onCancel && <Td>{(l.status === 'pending' || l.status === 'approved') && <Button size="sm" variant="ghost" loading={cancelling} onClick={() => onCancel(l.id)}>{l.status === 'pending' ? 'انصراف از درخواست' : 'لغو'}</Button>}</Td>}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function LeaveRequestDialog({ employeeId, onClose }: { employeeId: string | null; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const types = useQuery({ queryKey: ['hr', 'leave-types'], queryFn: () => a.get<{ id: string; name: string; annual_days: number | null; archived: boolean }[]>('/leave/types') });
  const [typeId, setTypeId] = useState('');
  const [starts, setStarts] = useState<string | null>(todayIso());
  const [ends, setEnds] = useState<string | null>(todayIso());
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => a.post<{ days: number; state: string }>('/leave', { employeeId, typeId: typeId || types.data?.find((t) => !t.archived)?.id, startsOn: starts, endsOn: ends, reason }),
    onSuccess: (r) => (toast(`درخواست ${fa(r.days)} روز کاری ثبت و برای تأیید ارسال شد`), void qc.invalidateQueries({ queryKey: ['hr'] }), void qc.invalidateQueries({ queryKey: ['widget'] }), onClose()),
    onError: err.set,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="درخواست مرخصی" description="روزهای تعطیل هفته و تعطیلات تقویم کاری سازمان شمرده نمی‌شوند."
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!starts || !ends} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ارسال برای تأیید</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نوع مرخصی" className="sm:col-span-2">
          <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>{(types.data ?? []).filter((t) => !t.archived).map((t) => <option key={t.id} value={t.id}>{t.name}{t.annual_days !== null ? ` (${fa(t.annual_days)} روز در سال)` : ''}</option>)}</Select>
        </Field>
        <Field label="از تاریخ" required error={err.fields.startsOn}><DateInput value={starts} onChange={setStarts} /></Field>
        <Field label="تا تاریخ (شامل)" required error={err.fields.endsOn}><DateInput value={ends} onChange={setEnds} /></Field>
        <Field label="علت / توضیح" className="sm:col-span-2"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

export function LeavePage() {
  const a = useApi();
  const qc = useQueryClient();
  const all = useCan('hr.leave.manage');
  const [tab, setTab] = useState('mine');
  const [status, setStatus] = useState('pending');
  const [asking, setAsking] = useState(false);
  const mine = useQuery({ queryKey: ['hr', 'leave', 'mine'], queryFn: () => a.get<LeaveRow[]>('/leave?mine=1') });
  const others = useQuery({ queryKey: ['hr', 'leave', 'all', status], queryFn: () => a.get<LeaveRow[]>(`/leave${status ? `?status=${status}` : ''}`), enabled: all && tab === 'all' });
  const me = useQuery({ queryKey: ['hr', 'me'], queryFn: () => a.get<{ id: string | null }>('/employees/me') });
  const cancel = useMutation({ mutationFn: (id: string) => a.post(`/leave/${id}/cancel`), onSuccess: () => (toast('درخواست لغو شد'), void qc.invalidateQueries({ queryKey: ['hr'] })) });
  return (
    <>
      <PageHeader title="مرخصی" actions={me.data?.id && <Button onClick={() => setAsking(true)}><Plus className="size-4" /> درخواست مرخصی</Button>} />
      <Nav />
      {all && <Tabs label="فهرست‌های مرخصی" value={tab} onChange={setTab} items={[{ key: 'mine', label: 'درخواست‌های من' }, { key: 'all', label: 'همه کارکنان' }]} />}
      {tab === 'mine' && (
        <PageState query={mine} isEmpty={mine.data?.length === 0 && !me.data?.id} empty={<EmptyState icon={<CalendarOff className="size-8" />} title="پرونده کارمندی به حساب شما متصل نیست" description="برای درخواست مرخصی، مسئول منابع انسانی باید حساب شما را در پرونده‌تان ثبت کند." />}>
          {me.data?.id && <p className="mb-3 text-sm"><Link className="text-primary underline" to={`${BASE}/employees/${me.data.id}`}>مانده مرخصی در پرونده من</Link></p>}
          <LeaveList items={mine.data ?? []} showName={false} onCancel={(id) => cancel.mutate(id)} cancelling={cancel.isPending} />
        </PageState>
      )}
      {tab === 'all' && all && (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <Field label="وضعیت"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">همه</option>{Object.entries(LEAVE_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</Select></Field>
            <ExportMenu filename="leave" title="درخواست‌های مرخصی" rows={others.data} columns={[
              { header: 'کارمند', value: (r) => r.full_name }, { header: 'شماره پرسنلی', value: (r) => r.personnel_no }, { header: 'واحد', value: (r) => r.department }, { header: 'نوع', value: (r) => r.type_name },
              { header: 'از', value: (r) => r.starts_on }, { header: 'تا', value: (r) => r.ends_on }, { header: 'روز کاری', value: (r) => r.days, kind: 'number' }, { header: 'وضعیت', value: (r) => LEAVE_STATUS[r.status]?.label },
            ]} />
            {status === 'pending' && <Link to="/app/approvals" className="text-sm text-primary underline">تأیید در کارتابل</Link>}
          </div>
          <PageState query={others}>
            <LeaveList items={others.data ?? []} showName onCancel={(id) => cancel.mutate(id)} cancelling={cancel.isPending} />
          </PageState>
        </>
      )}
      {asking && <LeaveRequestDialog employeeId={null} onClose={() => setAsking(false)} />}
    </>
  );
}

export function LeaveTypesPage() {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const q = useQuery({ queryKey: ['hr', 'leave-types'], queryFn: () => a.get<{ id: string | null; name: string; annual_days: number | null; paid: boolean; archived: boolean }[]>('/leave/types') });
  const [list, setList] = useState<{ id: string | null; name: string; annualDays: string; paid: boolean; archived: boolean }[] | null>(null);
  const rows = list ?? (q.data ?? []).map((t) => ({ id: t.id, name: t.name, annualDays: t.annual_days === null ? '' : String(t.annual_days), paid: t.paid, archived: t.archived }));
  const set = (i: number, p: Partial<(typeof rows)[number]>) => setList(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const save = useMutation({
    mutationFn: () => a.put('/leave/types', { types: rows.map((r) => ({ ...r, annualDays: r.annualDays === '' ? null : Number(r.annualDays) })) }),
    onSuccess: () => (toast('انواع مرخصی ذخیره شد'), setList(null), void qc.invalidateQueries({ queryKey: ['hr'] })),
    onError: err.set,
  });
  return (
    <>
      <PageHeader title="انواع مرخصی" />
      <Nav />
      <Card>
        <CardHeader title="انواع مرخصی و سقف سالانه" description="سقف خالی یعنی بدون سقف سالانه. سال مرخصی، سال شمسی است. نوع استفاده‌شده حذف نمی‌شود؛ بایگانی کنید." />
        <div className="space-y-3 p-5">
          {err.banner}
          <PageState query={q}>
            {rows.map((r, i) => (
              <div key={r.id ?? `n${i}`} className="flex flex-wrap items-end gap-3">
                <Field label="نام"><Input value={r.name} onChange={(e) => set(i, { name: e.target.value })} /></Field>
                <Field label="سقف سالانه (روز)"><Input inputMode="decimal" value={r.annualDays} onChange={(e) => set(i, { annualDays: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
                <Checkbox label="با حقوق" checked={r.paid} onChange={(e) => set(i, { paid: e.target.checked })} />
                <Checkbox label="بایگانی" checked={r.archived} onChange={(e) => set(i, { archived: e.target.checked })} />
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <Button variant="secondary" onClick={() => setList([...rows, { id: null, name: '', annualDays: '', paid: true, archived: false }])}><Plus className="size-4" /> نوع جدید</Button>
              <Button disabled={!list} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ذخیره</Button>
            </div>
          </PageState>
        </div>
      </Card>
    </>
  );
}
