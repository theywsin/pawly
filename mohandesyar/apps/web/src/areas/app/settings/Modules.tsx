import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Puzzle } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, DateText, Dialog, EmptyState, Field, Input, PageHeader, PageState, Select, toast } from '@mohandesyar/ui';
import { appApi } from '../../../lib/api.js';
import { errorMessage } from '../../../lib/errors.js';
import { formatMoney } from '@mohandesyar/persian';
import { useAppSession } from '../../../lib/session.js';

interface TenantModule {
  id: string;
  name: { fa: string };
  active_version: string;
  globally_enabled: boolean;
  enabled: boolean;
  entitled: boolean;
  enabled_at: string | null;
}

interface SettingsProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  title: string;
  description?: string;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
}

/** Settings form generated from the module manifest's settings schema (docs/03 §2). */
function ModuleSettings({ moduleId, onClose }: { moduleId: string; onClose(): void }) {
  const q = useQuery({ queryKey: ['module-settings', moduleId], queryFn: () => appApi<{ schema: { properties: Record<string, SettingsProperty> } | null; value: Record<string, unknown> }>(`/api/core/modules/${moduleId}/settings`) });
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const value = draft ?? q.data?.value ?? {};
  const save = useMutation({
    mutationFn: () => appApi(`/api/core/modules/${moduleId}/settings`, { method: 'PUT', body: value }),
    onSuccess: () => {
      toast('تنظیمات ذخیره شد');
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const props = Object.entries(q.data?.schema?.properties ?? {});
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="تنظیمات ماژول" footer={props.length ? <Button loading={save.isPending} onClick={() => save.mutate()}>ذخیره</Button> : undefined}>
      <PageState query={q} isEmpty={props.length === 0} empty={<p className="text-sm text-muted">این ماژول تنظیماتی ندارد.</p>}>
        <div className="space-y-4">
          {props.map(([key, p]) => {
            const set = (v: unknown) => setDraft({ ...value, [key]: v });
            const v = value[key];
            if (p.type === 'boolean') return <Checkbox key={key} label={p.title} checked={!!v} onChange={(e) => set(e.target.checked)} />;
            if (p.enum)
              return (
                <Field key={key} label={p.title} hint={p.description}>
                  <Select value={String(v ?? '')} onChange={(e) => set(p.type === 'string' ? e.target.value : Number(e.target.value))}>
                    {p.enum.map((o) => (
                      <option key={String(o)} value={String(o)}>
                        {String(o)}
                      </option>
                    ))}
                  </Select>
                </Field>
              );
            if (p.type === 'number' || p.type === 'integer')
              return (
                <Field key={key} label={p.title} hint={p.description}>
                  <Input type="number" dir="ltr" min={p.minimum} max={p.maximum} value={v === undefined ? '' : String(v)} onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value))} />
                </Field>
              );
            if (p.type === 'string')
              return (
                <Field key={key} label={p.title} hint={p.description}>
                  <Input maxLength={p.maxLength} value={String(v ?? '')} onChange={(e) => set(e.target.value)} />
                </Field>
              );
            return null;
          })}
        </div>
      </PageState>
    </Dialog>
  );
}

export function Modules() {
  const { me } = useAppSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tenant-modules'], queryFn: () => appApi<TenantModule[]>('/api/core/modules') });
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [disable, setDisable] = useState<TenantModule | null>(null);
  const toggle = useMutation({
    mutationFn: ({ id, enable }: { id: string; enable: boolean }) => appApi(`/api/core/modules/${id}/${enable ? 'enable' : 'disable'}`, { method: 'POST' }),
    onSuccess: (_d, v) => {
      toast(v.enable ? 'ماژول فعال شد' : 'ماژول غیرفعال شد؛ داده‌ها حفظ شده‌اند');
      setDisable(null);
      void qc.invalidateQueries();
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const canManage = me.permissions.includes('core.module.manage_tenant');
  const canBuy = me.permissions.includes('core.billing.manage');
  const billing = useQuery({ queryKey: ['billing'], enabled: canBuy, queryFn: () => appApi<{ buyableModules: { module_id: string; price_monthly: string; owned: boolean }[] }>('/api/billing') });
  const priceOf = (id: string) => billing.data?.buyableModules.find((b) => b.module_id === id && !b.owned)?.price_monthly;
  return (
    <>
      <PageHeader title="ماژول‌ها" description="فقط ماژول‌هایی که فعال می‌کنید در منو و داشبورد دیده می‌شوند. غیرفعال‌کردن هیچ داده‌ای را حذف نمی‌کند." />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<Puzzle className="size-8" />} title="ماژولی روی این سامانه نصب نشده است" />}>
        <div className="grid gap-4 md:grid-cols-2">
          {q.data?.map((m) => (
            <Card key={m.id}>
              <CardHeader
                title={m.name.fa}
                description={`نسخه ${m.active_version}`}
                actions={m.enabled ? <Badge tone="success">فعال</Badge> : m.entitled ? <Badge>غیرفعال</Badge> : <Badge tone="warning">خارج از اشتراک</Badge>}
              />
              <div className="flex flex-wrap items-center gap-2 p-4">
                {m.enabled && m.enabled_at && (
                  <span className="me-auto text-xs text-muted">
                    فعال از <DateText value={m.enabled_at} />
                  </span>
                )}
                {!m.globally_enabled && <Alert tone="warning" className="w-full">این ماژول موقتاً در سطح پلتفرم غیرفعال است.</Alert>}
                {canManage && m.enabled && (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => setSettingsFor(m.id)}>
                      تنظیمات
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDisable(m)}>
                      غیرفعال‌سازی
                    </Button>
                  </>
                )}
                {canBuy && !m.entitled && m.globally_enabled && priceOf(m.id) && (
                  <>
                    <span className="me-auto text-sm">{formatMoney(priceOf(m.id)!, { unit: 'toman' })} در ماه</span>
                    <Link to={`/app/billing/checkout?module=${encodeURIComponent(m.id)}`} className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-fg">
                      خرید ماژول
                    </Link>
                  </>
                )}
                {canManage && !m.enabled && m.entitled && m.globally_enabled && (
                  <Button size="sm" loading={toggle.isPending} onClick={() => toggle.mutate({ id: m.id, enable: true })}>
                    فعال‌سازی
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      </PageState>
      {settingsFor && <ModuleSettings moduleId={settingsFor} onClose={() => setSettingsFor(null)} />}
      <ConfirmDialog
        open={!!disable}
        onOpenChange={(o) => !o && setDisable(null)}
        title={`غیرفعال‌سازی «${disable?.name.fa ?? ''}»`}
        description="منو، صفحات، ویجت‌ها و API این ماژول برای سازمان شما بسته می‌شود. همه داده‌ها حفظ می‌شوند و با فعال‌سازی دوباره بازمی‌گردند."
        confirmLabel="غیرفعال‌سازی"
        loading={toggle.isPending}
        onConfirm={() => disable && toggle.mutate({ id: disable.id, enable: false })}
      />
    </>
  );
}
