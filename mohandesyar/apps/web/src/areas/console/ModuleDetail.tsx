import { useState } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, DateText, Dialog, Field, Input, Ltr, Num, PageHeader, PageState, Table, Td, Th, toast } from '@mohandesyar/ui';
import { consoleApi } from '../../lib/api.js';
import { errorMessage } from '../../lib/errors.js';
import { useAdmin } from '../../lib/session.js';
import { STATE, type ConsoleModule } from './Modules.js';

interface TenantRow {
  id: string;
  name: string;
  status: string;
  enabled: boolean;
  enabled_at: string | null;
  disabled_at: string | null;
}
interface Op {
  id: string;
  op: string;
  status: string;
  version: string | null;
  error: string | null;
  started_at: string;
  target_tenant_id: string | null;
}
interface UninstallPreview {
  activeTenants: number;
  globallyEnabled: boolean;
  dependents: string[];
  tables: { table: string; rows: number; bytes: number }[];
  policy: { allowPurge: boolean };
}

const OP: Record<string, string> = {
  upload: 'بارگذاری', install: 'نصب', upgrade: 'ارتقا', rollback: 'بازگشت نسخه', enable_global: 'فعال‌سازی سراسری', disable_global: 'غیرفعال‌سازی سراسری',
  enable_tenant: 'فعال‌سازی برای سازمان', disable_tenant: 'غیرفعال‌سازی برای سازمان', uninstall: 'حذف نصب', purge: 'حذف نصب و پاک‌سازی',
};

function OtpDialog({ open, title, description, onClose, onSubmit, loading, children }: { open: boolean; title: string; description?: string; onClose(): void; onSubmit(otp: string): void; loading?: boolean; children?: React.ReactNode }) {
  const [otp, setOtp] = useState('');
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            انصراف
          </Button>
          <Button variant="danger" disabled={otp.length !== 6} loading={loading} onClick={() => onSubmit(otp)}>
            تأیید
          </Button>
        </>
      }
    >
      {children}
      <Field label="کد تأیید دومرحله‌ای" className="mt-3">
        <Input dir="ltr" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />
      </Field>
    </Dialog>
  );
}

export function ModuleDetail() {
  const { id = '' } = useParams();
  const admin = useAdmin();
  const tech = admin.roles.includes('tech_admin');
  const qc = useQueryClient();
  const mods = useQuery({ queryKey: ['console-modules'], queryFn: () => consoleApi<ConsoleModule[]>('/api/console/modules') });
  const tenants = useQuery({ queryKey: ['module-tenants', id], queryFn: () => consoleApi<TenantRow[]>(`/api/console/modules/${id}/tenants`) });
  const ops = useQuery({ queryKey: ['module-ops', id], queryFn: () => consoleApi<Op[]>(`/api/console/modules/operations?moduleId=${id}`) });
  const m = mods.data?.find((x) => x.id === id);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmGlobal, setConfirmGlobal] = useState(false);
  const [rollback, setRollback] = useState(false);
  const [uninstall, setUninstall] = useState<UninstallPreview | null>(null);
  const [purge, setPurge] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const refresh = () => qc.invalidateQueries();

  const setTenants = useMutation({
    mutationFn: ({ ids, enabled }: { ids: string[]; enabled: boolean }) => consoleApi<{ results: { tenantId: string; ok: boolean; error?: string }[] }>(`/api/console/modules/${id}/tenants`, { method: 'POST', body: { tenantIds: ids, enabled } }),
    onSuccess: (r) => {
      const failed = r.results.filter((x) => !x.ok);
      if (failed.length) toast(`${failed.length} مورد انجام نشد: ${failed[0]!.error}`, 'danger');
      else toast('انجام شد');
      setSelected(new Set());
      void refresh();
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const global = useMutation({
    mutationFn: (enabled: boolean) => consoleApi(`/api/console/modules/${id}/global`, { method: 'POST', body: { enabled } }),
    onSuccess: () => {
      setConfirmGlobal(false);
      toast('وضعیت سراسری تغییر کرد');
      void refresh();
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const doRollback = useMutation({
    mutationFn: (otp: string) => consoleApi<{ version: string }>(`/api/console/modules/${id}/rollback`, { method: 'POST', body: { otp } }),
    onSuccess: (r) => {
      setRollback(false);
      toast(`به نسخه ${r.version} بازگشت`);
      void refresh();
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const doUninstall = useMutation({
    mutationFn: (otp: string) => consoleApi<{ backup: string }>(`/api/console/modules/${id}/uninstall`, { method: 'POST', body: { otp, purgeData: purge, confirmName } }),
    onSuccess: (r) => {
      setUninstall(null);
      toast(`حذف نصب انجام شد. پشتیبان: ${r.backup}`);
      void refresh();
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const openUninstall = async () => {
    try {
      setUninstall(await consoleApi<UninstallPreview>(`/api/console/modules/${id}/uninstall-preview`));
    } catch (e) {
      toast(errorMessage(e), 'danger');
    }
  };

  return (
    <PageState query={mods} isEmpty={!m}>
      {m && (
        <>
          <PageHeader
            title={m.name.fa}
            description={
              <span>
                <Ltr className="font-mono">{m.id}</Ltr> · نسخه <Ltr>{m.active_version ?? '—'}</Ltr> · <Badge tone={STATE[m.state]?.tone}>{STATE[m.state]?.label}</Badge>
              </span>
            }
            actions={
              tech &&
              m.state === 'installed' && (
                <>
                  <Button variant="secondary" onClick={() => (m.globally_enabled ? setConfirmGlobal(true) : global.mutate(true))} loading={global.isPending}>
                    {m.globally_enabled ? 'غیرفعال‌سازی سراسری' : 'فعال‌سازی سراسری'}
                  </Button>
                  {m.previous_version && (
                    <Button variant="secondary" onClick={() => setRollback(true)}>
                      بازگشت به {m.previous_version}
                    </Button>
                  )}
                  <Button variant="danger" onClick={() => void openUninstall()}>
                    حذف نصب
                  </Button>
                </>
              )
            }
          />
          {m.runtime.filter((r) => r.status !== 'loaded').map((r) => (
            <Alert key={r.instance_id} tone="danger" className="mb-4" title={`بارگذاری در نمونه ${r.instance_id} ناموفق بود`}>
              {r.error}
            </Alert>
          ))}
          <div className="space-y-6">
            <Card>
              <CardHeader
                title="سازمان‌ها"
                description="فعال‌سازی ماژول برای هر سازمان؛ غیرفعال‌سازی داده‌ای را حذف نمی‌کند."
                actions={
                  m.state === 'installed' && (
                    <>
                      <Button size="sm" disabled={!selected.size} loading={setTenants.isPending} onClick={() => setTenants.mutate({ ids: [...selected], enabled: true })}>
                        فعال‌سازی گروهی
                      </Button>
                      <Button size="sm" variant="secondary" disabled={!selected.size} loading={setTenants.isPending} onClick={() => setTenants.mutate({ ids: [...selected], enabled: false })}>
                        غیرفعال‌سازی گروهی
                      </Button>
                    </>
                  )
                }
              />
              <div className="p-5">
                <PageState query={tenants} isEmpty={tenants.data?.length === 0}>
                  <Table>
                    <thead>
                      <tr>
                        <Th className="w-10">
                          <span className="sr-only">انتخاب</span>
                        </Th>
                        <Th>سازمان</Th>
                        <Th>وضعیت ماژول</Th>
                        <Th>آخرین تغییر</Th>
                        <Th />
                      </tr>
                    </thead>
                    <tbody>
                      {tenants.data?.map((t) => (
                        <tr key={t.id}>
                          <Td>
                            <Checkbox
                              label={<span className="sr-only">{t.name}</span>}
                              checked={selected.has(t.id)}
                              onChange={(e) => {
                                const s = new Set(selected);
                                if (e.target.checked) s.add(t.id);
                                else s.delete(t.id);
                                setSelected(s);
                              }}
                            />
                          </Td>
                          <Td>{t.name}</Td>
                          <Td>{t.enabled ? <Badge tone="success">فعال</Badge> : <Badge>غیرفعال</Badge>}</Td>
                          <Td>
                            <DateText value={t.enabled ? t.enabled_at : t.disabled_at} withTime />
                          </Td>
                          <Td>
                            {m.state === 'installed' && (
                              <Button size="sm" variant={t.enabled ? 'secondary' : 'primary'} loading={setTenants.isPending} onClick={() => setTenants.mutate({ ids: [t.id], enabled: !t.enabled })} aria-label={`${t.enabled ? 'غیرفعال‌سازی' : 'فعال‌سازی'} برای ${t.name}`}>
                                {t.enabled ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                              </Button>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </PageState>
              </div>
            </Card>
            <Card>
              <CardHeader title="تاریخچه عملیات" />
              <div className="p-5">
                <PageState query={ops} isEmpty={ops.data?.length === 0}>
                  <Table>
                    <thead>
                      <tr>
                        <Th>زمان</Th>
                        <Th>عملیات</Th>
                        <Th>نسخه</Th>
                        <Th>نتیجه</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {ops.data?.map((o) => (
                        <tr key={o.id}>
                          <Td>
                            <DateText value={o.started_at} withTime />
                          </Td>
                          <Td>{OP[o.op] ?? o.op}</Td>
                          <Td>
                            <Ltr>{o.version ?? '—'}</Ltr>
                          </Td>
                          <Td>{o.status === 'succeeded' ? <Badge tone="success">موفق</Badge> : o.status === 'failed' ? <Badge tone="danger" className="max-w-sm whitespace-normal">{o.error ?? 'ناموفق'}</Badge> : <Badge>{o.status}</Badge>}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </PageState>
              </div>
            </Card>
          </div>
          <ConfirmDialog
            open={confirmGlobal}
            onOpenChange={setConfirmGlobal}
            title="غیرفعال‌سازی سراسری"
            description={`ماژول برای همه ${m.activeTenants} سازمان فعال بسته می‌شود (داده‌ها حفظ می‌شوند).`}
            confirmLabel="غیرفعال‌سازی"
            loading={global.isPending}
            onConfirm={() => global.mutate(false)}
          />
          <OtpDialog open={rollback} title={`بازگشت به نسخه ${m.previous_version}`} description="کد نسخه قبلی بارگذاری می‌شود؛ مهاجرت‌های افزایشی باقی می‌مانند." onClose={() => setRollback(false)} loading={doRollback.isPending} onSubmit={(otp) => doRollback.mutate(otp)} />
          <OtpDialog open={!!uninstall} title="حذف نصب ماژول" onClose={() => setUninstall(null)} loading={doUninstall.isPending} onSubmit={(otp) => doUninstall.mutate(otp)}>
            {uninstall && (
              <div className="space-y-3 text-sm">
                {(uninstall.activeTenants > 0 || uninstall.globallyEnabled) && <Alert tone="warning">ابتدا ماژول را در سطح پلتفرم و برای همه سازمان‌ها ({uninstall.activeTenants}) غیرفعال کنید.</Alert>}
                {uninstall.dependents.length > 0 && <Alert tone="warning">ماژول‌های وابسته: {uninstall.dependents.join('، ')}</Alert>}
                <p>حجم داده‌ها (پیش از حذف، پشتیبان کامل گرفته می‌شود):</p>
                <ul className="list-disc ps-5">
                  {uninstall.tables.map((t) => (
                    <li key={t.table}>
                      <Ltr className="font-mono">{t.table}</Ltr>: <Num value={t.rows} /> ردیف
                    </li>
                  ))}
                </ul>
                {uninstall.policy.allowPurge && <Checkbox label="داده‌ها هم پاک شوند (برگشت‌ناپذیر)" checked={purge} onChange={(e) => setPurge(e.target.checked)} />}
                <Field label={<>برای تأیید، شناسه <Ltr className="font-mono">{m.id}</Ltr> را تایپ کنید</>}>
                  <Input dir="ltr" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
                </Field>
              </div>
            )}
          </OtpDialog>
        </>
      )}
    </PageState>
  );
}
