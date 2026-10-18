import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Alert, Button, Card, CardHeader, Dialog, Field, Input, Money, MoneyInput, PageHeader, PageState, Select, Table, Td, Th, toast } from '@mohandesyar/ui';
import { ApiError } from '@mohandesyar/module-sdk/web';
import { appApi } from '../../../lib/api.js';
import { useAppSession } from '../../../lib/session.js';

interface Role { key: string; name: string; module_id: string | null; approval_limit: string | null }
interface Step { key: string; label: string; approverRole?: string; approverUserId?: string; minAmount?: number }
interface Def { key: string; module_id: string; version: number; definition: { title: string; steps: Step[] } }

const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : 'انجام نشد', 'danger');

/** Approval workflows (steps, approver roles, amount thresholds) and each role's approval limit. */
export function ApprovalSettings() {
  const { me } = useAppSession();
  const canRoles = me.permissions.includes('core.role.manage');
  const canFlows = me.permissions.includes('core.workflow.manage_definitions');
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => appApi<Role[]>('/api/core/roles') });
  const flows = useQuery({ queryKey: ['workflows'], queryFn: () => appApi<Def[]>('/api/core/workflows'), enabled: canFlows });
  const [limitFor, setLimitFor] = useState<Role | null>(null);
  const [editing, setEditing] = useState<Def | null>(null);
  const roleName = (k?: string) => roles.data?.find((r) => r.key === k)?.name ?? k ?? '—';
  return (
    <>
      <PageHeader title="گردش‌های تأیید" description="مراحل تأیید هر نوع درخواست، تأییدکننده هر مرحله، آستانه مبلغ و سقف اختیار هر نقش." />
      <div className="space-y-6">
        {canFlows && (
          <Card>
            <CardHeader title="گردش‌ها" />
            <PageState query={flows} isEmpty={flows.data?.length === 0} empty={<p className="p-5 text-sm text-muted">ماژول‌های فعال هنوز گردش تأییدی تعریف نکرده‌اند.</p>}>
              <Table>
                <thead><tr><Th>گردش</Th><Th>مراحل</Th><Th>نسخه</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
                <tbody>
                  {flows.data?.map((f) => (
                    <tr key={f.key}>
                      <Td>{f.definition.title}<div className="text-xs text-muted" dir="ltr">{f.key}</div></Td>
                      <Td>
                        <ol className="list-inside list-decimal text-sm">
                          {f.definition.steps.map((s) => <li key={s.key}>{s.label}: {roleName(s.approverRole)}{s.minAmount !== undefined && <> (از <Money value={s.minAmount} />)</>}</li>)}
                        </ol>
                      </Td>
                      <Td>{f.version.toLocaleString('fa-IR')}</Td>
                      <Td><Button size="sm" variant="secondary" onClick={() => setEditing(f)}>ویرایش</Button></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </PageState>
          </Card>
        )}
        <Card>
          <CardHeader title="سقف اختیار تأیید نقش‌ها" description="در مراحلی که مبلغ دارند، تأییدکننده نمی‌تواند بیش از سقف نقش خود تأیید کند. خالی = بدون سقف." />
          <PageState query={roles}>
            <Table>
              <thead><tr><Th>نقش</Th><Th>سقف تأیید</Th>{canRoles && <Th><span className="sr-only">عملیات</span></Th>}</tr></thead>
              <tbody>
                {roles.data?.map((r) => (
                  <tr key={r.key}>
                    <Td>{r.name}</Td>
                    <Td>{r.approval_limit === null ? 'بدون سقف' : <Money value={r.approval_limit} />}</Td>
                    {canRoles && <Td><Button size="sm" variant="ghost" onClick={() => setLimitFor(r)}>تغییر سقف</Button></Td>}
                  </tr>
                ))}
              </tbody>
            </Table>
          </PageState>
        </Card>
      </div>
      {limitFor && <LimitDialog role={limitFor} onClose={() => setLimitFor(null)} />}
      {editing && <FlowDialog def={editing} roles={roles.data ?? []} onClose={() => setEditing(null)} />}
    </>
  );
}

function LimitDialog({ role, onClose }: { role: Role; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState(role.approval_limit ?? '');
  const save = useMutation({
    mutationFn: () => appApi(`/api/core/roles/${role.key}/approval-limit`, { method: 'PUT', body: { limit: v || null } }),
    onSuccess: () => (toast('سقف ذخیره شد'), void qc.invalidateQueries({ queryKey: ['roles'] }), onClose()),
    onError: fail,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`سقف تأیید «${role.name}»`} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => save.mutate()}>ذخیره</Button></>}>
      <Field label="سقف (ریال)" hint="خالی = بدون سقف"><MoneyInput value={v} onChange={setV} /></Field>
    </Dialog>
  );
}

function FlowDialog({ def, roles, onClose }: { def: Def; roles: Role[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(def.definition.title);
  const [steps, setSteps] = useState(def.definition.steps.map((s) => ({ ...s, min: s.minAmount !== undefined ? String(s.minAmount) : '' })));
  const save = useMutation({
    mutationFn: () =>
      appApi(`/api/core/workflows/${def.key}`, {
        method: 'PUT',
        body: { moduleId: def.module_id, definition: { title, steps: steps.map(({ min, ...s }, i) => ({ key: s.key || `s${i + 1}`, label: s.label, approverRole: s.approverRole, ...(min ? { minAmount: Number(min) } : {}) })) } },
      }),
    onSuccess: () => (toast('گردش ذخیره شد؛ درخواست‌های جدید از این نسخه استفاده می‌کنند'), void qc.invalidateQueries({ queryKey: ['workflows'] }), onClose()),
    onError: fail,
  });
  const set = (i: number, p: Partial<(typeof steps)[number]>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="ویرایش گردش تأیید" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => save.mutate()}>ذخیره نسخه جدید</Button></>}>
      <div className="space-y-3">
        <Field label="عنوان"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        {steps.map((s, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2 rounded-md bg-surface-2 p-3">
            <Field label={`مرحله ${(i + 1).toLocaleString('fa-IR')}`}><Input value={s.label} onChange={(e) => set(i, { label: e.target.value })} /></Field>
            <Field label="نقش تأییدکننده"><Select value={s.approverRole ?? ''} onChange={(e) => set(i, { approverRole: e.target.value })}>{roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</Select></Field>
            <Field label="فقط از مبلغ (ریال)" hint="خالی = همیشه"><MoneyInput value={s.min} onChange={(x) => set(i, { min: x })} /></Field>
            <Button variant="ghost" disabled={steps.length === 1} aria-label={`حذف مرحله ${i + 1}`} onClick={() => setSteps(steps.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setSteps([...steps, { key: `s${steps.length + 1}`, label: 'تأیید', approverRole: roles[0]?.key, min: '' }])}><Plus className="size-4" /> مرحله</Button>
        <Alert tone="info">درخواست‌دهنده هرگز درخواست خودش را تأیید نمی‌کند و هر فرد فقط یک مرحله از یک درخواست را تأیید می‌کند.</Alert>
      </div>
    </Dialog>
  );
}
