import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, Webhook } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, DateText, Dialog, EmptyState, Field, Input, Ltr, PageHeader, PageState, Select, Table, Td, Th, toast } from '@mohandesyar/ui';
import { appApi } from '../../../lib/api.js';
import { errorMessage } from '../../../lib/errors.js';

interface Key { id: string; name: string; prefix: string; user_id: string; scopes: string[]; expires_at: string | null; last_used_at: string | null; revoked_at: string | null; created_at: string }
interface Hook { id: string; name: string; url: string; events: string[]; active: boolean; failed: number; last_delivered_at: string | null }
interface Delivery { id: string; event_type: string; status: string; attempts: number; response_status: number | null; last_error: string | null; created_at: string; delivered_at: string | null }
const fail = (e: unknown) => toast(errorMessage(e), 'danger');
const copy = (v: string) => void navigator.clipboard?.writeText(v).then(() => toast('کپی شد'));
const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'info' }> = {
  ok: { label: 'موفق', tone: 'success' }, pending: { label: 'در صف / تلاش دوباره', tone: 'warning' }, sending: { label: 'در حال ارسال', tone: 'info' }, failed: { label: 'ناموفق', tone: 'danger' },
};

/** API keys for the module REST APIs and webhooks for module events. */
export function IntegrationsPage() {
  return (
    <>
      <PageHeader title="اتصال‌ها: کلید API و Webhook" description="برای اتصال سامانه‌های دیگر. کلید API به‌جای سازنده‌اش و فقط با مجوزهایی که انتخاب می‌کنید (و خود سازنده هنوز دارد) روی APIهای ماژول‌ها کار می‌کند؛ Webhook رویدادهای همین شرکت را امضاشده ارسال می‌کند." />
      <div className="space-y-6">
        <Keys />
        <Hooks />
        <Card>
          <CardHeader title="راهنمای سریع" />
          <div className="space-y-2 text-sm">
            <p>درخواست‌ها: <Ltr>{`${location.origin}/api/m/<module>/v1/...`}</Ltr> با سرآیند <Ltr>Authorization: Bearer mk_…</Ltr>؛ حداکثر ۶۰۰ درخواست در دقیقه برای هر کلید.</p>
            <p>امضای Webhook در سرآیند <Ltr>X-Mohandix-Signature: t=…,v1=…</Ltr> است: <Ltr>v1 = HMAC-SHA256(secret, t + "." + body)</Ltr>. پاسخ 2xx یعنی دریافت؛ در غیر این صورت تا ۶ بار با فاصله فزاینده دوباره ارسال می‌شود.</p>
          </div>
        </Card>
      </div>
    </>
  );
}

function Keys() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['integrations', 'keys'], queryFn: () => appApi<Key[]>('/api/core/integrations/api-keys') });
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<Key | null>(null);
  const revoke = useMutation({ mutationFn: (id: string) => appApi(`/api/core/integrations/api-keys/${id}`, { method: 'DELETE' }), onSuccess: () => (toast('کلید باطل شد'), setRevoking(null), void qc.invalidateQueries({ queryKey: ['integrations'] })), onError: fail });
  return (
    <Card>
      <CardHeader title="کلیدهای API" actions={<Button size="sm" onClick={() => setCreating(true)}><Plus className="size-4" /> کلید جدید</Button>} />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<KeyRound className="size-8" />} title="کلیدی ساخته نشده است" />}>
        <Table>
          <thead><tr><Th>نام</Th><Th>شناسه</Th><Th>مجوزها</Th><Th>آخرین استفاده</Th><Th>انقضا</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
          <tbody>
            {q.data?.map((k) => (
              <tr key={k.id}>
                <Td>{k.name}{k.revoked_at && <Badge tone="danger" className="ms-1">باطل‌شده</Badge>}</Td>
                <Td><Ltr>mk_{k.prefix}_…</Ltr></Td>
                <Td className="max-w-72 text-xs"><Ltr>{k.scopes.join(', ')}</Ltr></Td>
                <Td className="text-xs">{k.last_used_at ? <DateText value={k.last_used_at} /> : '—'}</Td>
                <Td className="text-xs">{k.expires_at ? <DateText value={k.expires_at} /> : 'بدون انقضا'}</Td>
                <Td>{!k.revoked_at && <Button size="sm" variant="ghost" onClick={() => setRevoking(k)}>ابطال</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {creating && <KeyDialog onClose={() => setCreating(false)} />}
      <ConfirmDialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)} title="ابطال کلید API" description="سامانه‌هایی که از این کلید استفاده می‌کنند فوراً دسترسی را از دست می‌دهند. این کار برگشت‌پذیر نیست." confirmLabel="ابطال" loading={revoke.isPending} onConfirm={() => revoking && revoke.mutate(revoking.id)} />
    </Card>
  );
}

function KeyDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const scopes = useQuery({ queryKey: ['integrations', 'scopes'], queryFn: () => appApi<{ key: string; module_id: string; label_fa: string }[]>('/api/core/integrations/scopes') });
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [days, setDays] = useState('365');
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => appApi<{ key: string }>('/api/core/integrations/api-keys', { method: 'POST', body: { name, scopes: picked, expiresInDays: days ? Number(days) : null } }),
    onSuccess: (r) => (setCreated(r.key), void qc.invalidateQueries({ queryKey: ['integrations'] })),
    onError: (e) => setError(errorMessage(e)),
  });
  if (created) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()} title="کلید ساخته شد" footer={<Button onClick={onClose}>بستم و ذخیره کردم</Button>}>
        <Alert tone="warning" className="mb-3">این کلید فقط همین یک بار نمایش داده می‌شود؛ آن را در جای امن ذخیره کنید.</Alert>
        <div className="flex items-center gap-2 rounded border border-border p-2"><Ltr className="break-all font-mono text-sm">{created}</Ltr><Button size="sm" variant="ghost" aria-label="کپی کلید" onClick={() => copy(created)}><Copy className="size-4" /></Button></div>
      </Dialog>
    );
  }
  const byModule = Object.entries((scopes.data ?? []).reduce<Record<string, { key: string; label_fa: string }[]>>((m, p) => ((m[p.module_id] ??= []).push(p), m), {}));
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="کلید API جدید" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!picked.length} loading={save.isPending} onClick={() => (setError(null), save.mutate())}>ساخت</Button></>}>
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="نام (سامانه یا کاربرد)" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="انقضا"><Select value={days} onChange={(e) => setDays(e.target.value)}><option value="30">۳۰ روز</option><option value="90">۹۰ روز</option><option value="365">یک سال</option><option value="">بدون انقضا</option></Select></Field>
      </div>
      <h3 className="mb-2 mt-5 font-semibold">مجوزها</h3>
      <PageState query={scopes} isEmpty={scopes.data?.length === 0} empty={<p className="text-sm text-muted">مجوزی از ماژول‌های فعال ندارید.</p>}>
        <div className="max-h-80 space-y-3 overflow-y-auto">
          {byModule.map(([m, list]) => (
            <fieldset key={m}>
              <legend className="mb-1 text-xs text-muted" dir="ltr">{m}</legend>
              {list.map((p) => <div key={p.key}><Checkbox label={<>{p.label_fa} <Ltr className="text-xs text-muted">{p.key}</Ltr></>} checked={picked.includes(p.key)} onChange={(e) => setPicked((s) => (e.target.checked ? [...s, p.key] : s.filter((x) => x !== p.key)))} /></div>)}
            </fieldset>
          ))}
        </div>
      </PageState>
    </Dialog>
  );
}

function Hooks() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['integrations', 'hooks'], queryFn: () => appApi<Hook[]>('/api/core/integrations/webhooks') });
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Hook | null>(null);
  const [removing, setRemoving] = useState<Hook | null>(null);
  const done = (m: string) => (toast(m), void qc.invalidateQueries({ queryKey: ['integrations'] }));
  const toggle = useMutation({ mutationFn: (h: Hook) => appApi(`/api/core/integrations/webhooks/${h.id}/active`, { method: 'PUT', body: { active: !h.active } }), onSuccess: () => done('ذخیره شد'), onError: fail });
  const ping = useMutation({ mutationFn: (id: string) => appApi(`/api/core/integrations/webhooks/${id}/ping`, { method: 'POST' }), onSuccess: () => done('پیام آزمایشی در صف ارسال قرار گرفت'), onError: fail });
  const remove = useMutation({ mutationFn: (id: string) => appApi(`/api/core/integrations/webhooks/${id}`, { method: 'DELETE' }), onSuccess: () => (setRemoving(null), done('حذف شد')), onError: fail });
  return (
    <Card>
      <CardHeader title="Webhookها" actions={<Button size="sm" onClick={() => setCreating(true)}><Plus className="size-4" /> Webhook جدید</Button>} />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<Webhook className="size-8" />} title="Webhookی تعریف نشده است" />}>
        <Table>
          <thead><tr><Th>نام</Th><Th>نشانی</Th><Th>رویدادها</Th><Th>وضعیت</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
          <tbody>
            {q.data?.map((h) => (
              <tr key={h.id}>
                <Td>{h.name}</Td>
                <Td className="max-w-64 break-all text-xs"><Ltr>{h.url}</Ltr></Td>
                <Td className="text-xs"><Ltr>{h.events.join(', ')}</Ltr></Td>
                <Td>{h.active ? <Badge tone="success">فعال</Badge> : <Badge>غیرفعال</Badge>}{h.failed > 0 && <div className="text-xs text-danger">{h.failed.toLocaleString('fa-IR')} ارسال ناموفق</div>}</Td>
                <Td className="whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setViewing(h)}>سابقه</Button>
                  <Button size="sm" variant="ghost" loading={ping.isPending && ping.variables === h.id} onClick={() => ping.mutate(h.id)}>آزمایش</Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle.mutate(h)}>{h.active ? 'غیرفعال' : 'فعال'}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(h)}>حذف</Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {creating && <HookDialog onClose={() => setCreating(false)} />}
      {viewing && <DeliveriesDialog hook={viewing} onClose={() => setViewing(null)} />}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title="حذف Webhook" description="ارسال‌های در صف و سابقه آن هم حذف می‌شود." confirmLabel="حذف" loading={remove.isPending} onConfirm={() => removing && remove.mutate(removing.id)} />
    </Card>
  );
}

function HookDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const events = useQuery({ queryKey: ['integrations', 'events'], queryFn: () => appApi<{ type: string; moduleId: string }[]>('/api/core/integrations/events') });
  const [name, setName] = useState('');
  const [url, setUrl] = useState('https://');
  const [picked, setPicked] = useState<string[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => appApi<{ secret: string }>('/api/core/integrations/webhooks', { method: 'POST', body: { name, url, events: picked } }),
    onSuccess: (r) => (setSecret(r.secret), void qc.invalidateQueries({ queryKey: ['integrations'] })),
    onError: (e) => setError(errorMessage(e)),
  });
  if (secret) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()} title="Webhook ساخته شد" footer={<Button onClick={onClose}>بستم و ذخیره کردم</Button>}>
        <Alert tone="warning" className="mb-3">رمز امضا فقط همین یک بار نمایش داده می‌شود؛ گیرنده با آن امضای هر پیام را بررسی می‌کند.</Alert>
        <div className="flex items-center gap-2 rounded border border-border p-2"><Ltr className="break-all font-mono text-sm">{secret}</Ltr><Button size="sm" variant="ghost" aria-label="کپی رمز" onClick={() => copy(secret)}><Copy className="size-4" /></Button></div>
      </Dialog>
    );
  }
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="Webhook جدید" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!picked.length} loading={save.isPending} onClick={() => (setError(null), save.mutate())}>ساخت</Button></>}>
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <div className="grid gap-4">
        <Field label="نام" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="نشانی (https)" required hint="نشانی‌هایی که به شبکه داخلی سرور اشاره کنند پذیرفته نمی‌شوند."><Input dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
      </div>
      <h3 className="mb-2 mt-5 font-semibold">رویدادها</h3>
      <PageState query={events} isEmpty={events.data?.length === 0} empty={<p className="text-sm text-muted">ماژول‌های فعال رویدادی منتشر نمی‌کنند.</p>}>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {events.data?.map((e) => <div key={e.type}><Checkbox label={<Ltr>{e.type}</Ltr>} checked={picked.includes(e.type)} onChange={(x) => setPicked((s) => (x.target.checked ? [...s, e.type] : s.filter((y) => y !== e.type)))} /></div>)}
        </div>
      </PageState>
    </Dialog>
  );
}

function DeliveriesDialog({ hook, onClose }: { hook: Hook; onClose: () => void }) {
  const q = useQuery({ queryKey: ['integrations', 'deliveries', hook.id], queryFn: () => appApi<Delivery[]>(`/api/core/integrations/webhooks/${hook.id}/deliveries`), refetchInterval: 5000 });
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={`سابقه ارسال — ${hook.name}`} footer={<Button variant="ghost" onClick={onClose}>بستن</Button>}>
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState title="ارسالی ثبت نشده است" />}>
        <Table>
          <thead><tr><Th>رویداد</Th><Th>زمان</Th><Th>نتیجه</Th><Th>تلاش</Th></tr></thead>
          <tbody>{q.data?.map((d) => <tr key={d.id}><Td><Ltr className="text-xs">{d.event_type}</Ltr></Td><Td className="text-xs"><DateText value={d.created_at} /></Td><Td><Badge tone={STATUS[d.status]!.tone}>{STATUS[d.status]!.label}</Badge>{(d.response_status || d.last_error) && <div className="text-xs text-muted"><Ltr>{d.response_status ?? ''} {d.last_error ?? ''}</Ltr></div>}</Td><Td className="tabular-nums">{d.attempts.toLocaleString('fa-IR')}</Td></tr>)}</tbody>
        </Table>
      </PageState>
    </Dialog>
  );
}
