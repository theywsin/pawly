import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks } from 'lucide-react';
import { Badge, Button, DateInput, DayText, Dialog, EmptyState, ExportMenu, Field, Input, PageHeader, PageState, Select, Table, Tabs, Td, Textarea, Th, toast } from '@mohandesyar/ui';
import { useCan, useDirectory, useMe } from '@mohandesyar/module-sdk/web';
import { addDays, todayIso } from '@mohandesyar/persian';
import { ACTION_STATUS, BASE, Nav, num, useApi, useServerErrors } from './common.js';

export interface Action { id: string; kind: string; title: string; owner_id: string; due_on: string; status: string; done_note: string; verified_by: string | null; overdue?: boolean; ncr_id?: string | null; incident_id?: string | null; ncr_number?: number | null; incident_number?: number | null }

export function ActionsPage() {
  const a = useApi();
  const dir = useDirectory();
  const [st, setSt] = useState('');
  const q = useQuery({ queryKey: ['qhse', 'actions', st], queryFn: () => a.get<Action[]>(`/actions${st === 'mine' ? '?mine=1' : st ? `?status=${st}` : ''}`) });
  return (
    <>
      <PageHeader
        title="اقدامات اصلاحی و پیشگیرانه"
        description="مسئول هر اقدام انجام آن را ثبت می‌کند؛ اثربخشی را فرد دیگری با مجوز مدیریت QHSE تأیید می‌کند."
        actions={<ExportMenu filename="qhse-actions" title="اقدامات" rows={q.data} columns={[
          { header: 'نوع', value: (x) => (x.kind === 'corrective' ? 'اصلاحی' : 'پیشگیرانه') }, { header: 'شرح', value: (x) => x.title }, { header: 'مسئول', value: (x) => dir.name(x.owner_id) },
          { header: 'مهلت', value: (x) => x.due_on }, { header: 'وضعیت', value: (x) => ACTION_STATUS[x.status]?.label },
        ]} />}
      />
      <Nav />
      <Tabs label="فیلتر" value={st} onChange={setSt} items={[{ key: '', label: 'همه' }, { key: 'mine', label: 'اقدامات من' }, { key: 'overdue', label: 'معوق' }, { key: 'done', label: 'منتظر تأیید' }, { key: 'verified', label: 'تأییدشده' }]} />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<ListChecks className="size-8" />} title="اقدامی وجود ندارد" />}>
        <ActionsTable actions={q.data ?? []} showSource />
      </PageState>
    </>
  );
}

export function ActionsTable({ actions, showSource }: { actions: Action[]; showSource?: boolean }) {
  const a = useApi();
  const qc = useQueryClient();
  const me = useMe();
  const dir = useDirectory();
  const canManage = useCan('qhse.manage');
  const [doing, setDoing] = useState<Action | null>(null);
  const verify = useMutation({
    mutationFn: (x: { id: string; accept: boolean }) => a.post(`/actions/${x.id}/verify`, { accept: x.accept }),
    onSuccess: (_r, x) => (toast(x.accept ? 'اثربخشی تأیید شد' : 'اقدام دوباره باز شد'), void qc.invalidateQueries({ queryKey: ['qhse'] })),
    onError: (e) => toast(e instanceof Error ? e.message : 'انجام نشد', 'danger'),
  });
  return (
    <>
      <Table>
        <thead><tr><Th>اقدام</Th>{showSource && <Th>مربوط به</Th>}<Th>مسئول</Th><Th>مهلت</Th><Th>وضعیت</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
        <tbody>
          {actions.map((x) => (
            <tr key={x.id}>
              <Td>{x.title}<div className="text-xs text-muted">{x.kind === 'corrective' ? 'اصلاحی' : 'پیشگیرانه'}{x.done_note && ` · ${x.done_note}`}</div></Td>
              {showSource && <Td>{x.ncr_id ? <Link className="text-primary underline" to={`${BASE}/ncrs/${x.ncr_id}`}>NCR-{num(x.ncr_number)}</Link> : x.incident_id ? <Link className="text-primary underline" to={`${BASE}/incidents/${x.incident_id}`}>حادثه {num(x.incident_number)}</Link> : '—'}</Td>}
              <Td>{dir.name(x.owner_id)}</Td>
              <Td><DayText value={x.due_on} />{x.overdue && <Badge tone="danger" className="ms-1">معوق</Badge>}</Td>
              <Td><Badge tone={ACTION_STATUS[x.status]!.tone}>{ACTION_STATUS[x.status]!.label}</Badge>{x.verified_by && <div className="text-xs text-muted">{dir.name(x.verified_by)}</div>}</Td>
              <Td className="whitespace-nowrap">
                {x.status === 'open' && x.owner_id === me.user.id && <Button size="sm" onClick={() => setDoing(x)}>ثبت انجام</Button>}
                {x.status === 'done' && canManage && x.owner_id !== me.user.id && (
                  <>
                    <Button size="sm" loading={verify.isPending} onClick={() => verify.mutate({ id: x.id, accept: true })}>تأیید اثربخشی</Button>
                    <Button size="sm" variant="ghost" onClick={() => verify.mutate({ id: x.id, accept: false })}>بازگشایی</Button>
                  </>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {doing && <DoneDialog action={doing} onClose={() => setDoing(null)} />}
    </>
  );
}

function DoneDialog({ action, onClose }: { action: Action; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [note, setNote] = useState('');
  const save = useMutation({ mutationFn: () => a.post(`/actions/${action.id}/done`, { note }), onSuccess: () => (toast('انجام اقدام ثبت شد'), void qc.invalidateQueries({ queryKey: ['qhse'] }), onClose()), onError: err.set });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="ثبت انجام اقدام" description={action.title} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <Field label="شرح کار انجام‌شده" required error={err.fields.note}><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </Dialog>
  );
}

export function ActionDialog({ ncrId, incidentId, onClose }: { ncrId?: string; incidentId?: string; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const dir = useDirectory();
  const err = useServerErrors();
  const [kind, setKind] = useState(ncrId ? 'corrective' : 'preventive');
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState<string | null>(addDays(todayIso(), 14));
  const save = useMutation({
    mutationFn: () => a.post('/actions', { kind, title, ownerId: owner || undefined, dueOn: due, ncrId: ncrId ?? null, incidentId: incidentId ?? null }),
    onSuccess: () => (toast('اقدام ثبت و به مسئول اعلام شد'), void qc.invalidateQueries({ queryKey: ['qhse'] }), onClose()),
    onError: err.set,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="اقدام اصلاحی / پیشگیرانه" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!due} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4">
        <Field label="نوع"><Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="corrective">اصلاحی</option><option value="preventive">پیشگیرانه</option></Select></Field>
        <Field label="شرح اقدام" required error={err.fields.title}><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="مسئول" required error={err.fields.ownerId}><Select value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">انتخاب کنید</option>{dir.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</Select></Field>
        <Field label="مهلت" required><DateInput value={due} onChange={setDue} /></Field>
      </div>
    </Dialog>
  );
}
