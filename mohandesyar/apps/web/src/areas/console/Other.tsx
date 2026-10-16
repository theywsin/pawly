import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, CardHeader, DateText, Field, Input, Ltr, Num, PageHeader, PageState, Select, Table, Td, Textarea, Th, toast } from '@mohandesyar/ui';
import { consoleApi } from '../../lib/api.js';
import { errorMessage } from '../../lib/errors.js';

interface Key {
  key_id: string;
  label: string;
  status: string;
  created_at: string;
}

export function Keys() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['keys'], queryFn: () => consoleApi<Key[]>('/api/console/keys') });
  const [pem, setPem] = useState('');
  const [label, setLabel] = useState('');
  const [otp, setOtp] = useState('');
  const add = useMutation({
    mutationFn: () => consoleApi<{ keyId: string }>('/api/console/keys', { method: 'POST', body: { publicKeyPem: pem, label, otp } }),
    onSuccess: (r) => {
      toast(`کلید ${r.keyId} افزوده شد`);
      setPem('');
      setLabel('');
      setOtp('');
      void qc.invalidateQueries({ queryKey: ['keys'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <>
      <PageHeader title="کلیدهای امضای مورد اعتماد" description="فقط بسته‌هایی که با یکی از این کلیدها امضا شده‌اند قابل نصب‌اند." />
      <div className="grid gap-6 lg:grid-cols-2">
        <PageState query={q} isEmpty={q.data?.length === 0}>
          <Table>
            <thead>
              <tr>
                <Th>شناسه</Th>
                <Th>برچسب</Th>
                <Th>وضعیت</Th>
                <Th>افزوده‌شده</Th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map((k) => (
                <tr key={k.key_id}>
                  <Td>
                    <Ltr className="font-mono">{k.key_id}</Ltr>
                  </Td>
                  <Td>{k.label}</Td>
                  <Td>{k.status === 'active' ? <Badge tone="success">فعال</Badge> : <Badge tone="danger">باطل</Badge>}</Td>
                  <Td>
                    <DateText value={k.created_at} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </PageState>
        <Card>
          <CardHeader title="افزودن کلید عمومی" description="خروجی module:keygen (فایل ‎.pub.pem)" />
          <div className="space-y-4 p-5">
            <Field label="برچسب">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field label="کلید عمومی (PEM)">
              <Textarea dir="ltr" className="font-mono text-xs" rows={5} value={pem} onChange={(e) => setPem(e.target.value)} />
            </Field>
            <Field label="کد تأیید دومرحله‌ای">
              <Input dir="ltr" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <Button disabled={!pem || !label || otp.length !== 6} loading={add.isPending} onClick={() => add.mutate()}>
              افزودن
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
  active_users: number;
  companies: number;
  storage_bytes: number;
  plan_key: string | null;
  subscription_status: string | null;
  modules: string[];
}

function SignupMode() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['signup-mode'], queryFn: () => consoleApi<{ mode: string }>('/api/console/settings/signup') });
  const set = useMutation({
    mutationFn: (mode: string) => consoleApi('/api/console/settings/signup', { method: 'PUT', body: { mode } }),
    onSuccess: () => {
      toast('سیاست ثبت‌نام ذخیره شد');
      void qc.invalidateQueries({ queryKey: ['signup-mode'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <Card className="mb-6">
      <CardHeader title="سیاست ثبت‌نام" description="باز: ثبت‌نام و ورود فوری. با تأیید: سازمان تا تأیید شما غیرفعال می‌ماند. بسته: ثبت‌نام عمومی غیرفعال است." />
      <div className="p-5">
        <Field label="حالت" className="max-w-xs">
          <Select value={q.data?.mode ?? 'open'} disabled={!q.data || set.isPending} onChange={(e) => set.mutate(e.target.value)}>
            <option value="open">باز</option>
            <option value="approval">با تأیید مدیر</option>
            <option value="closed">بسته</option>
          </Select>
        </Field>
      </div>
    </Card>
  );
}

export function Tenants() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tenants'], queryFn: () => consoleApi<Tenant[]>('/api/console/tenants') });
  const approve = useMutation({
    mutationFn: (id: string) => consoleApi(`/api/console/tenants/${id}/approve`, { method: 'POST' }),
    onSuccess: () => {
      toast('سازمان تأیید شد');
      void qc.invalidateQueries({ queryKey: ['tenants'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const status = useMutation({
    mutationFn: ({ id, s }: { id: string; s: 'active' | 'suspended' }) => consoleApi(`/api/console/tenants/${id}/status`, { method: 'POST', body: { status: s } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenants'] }),
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <>
      <PageHeader title="مشتریان (سازمان‌ها)" description="فقط آمار مصرف دیده می‌شود؛ داده‌های سازمان‌ها برای مدیر پلتفرم قابل مشاهده نیست." />
      <SignupMode />
      <PageState query={q} isEmpty={q.data?.length === 0}>
        <Table>
          <thead>
            <tr>
              <Th>سازمان</Th>
              <Th>کاربران</Th>
              <Th>شرکت‌ها</Th>
              <Th>اشتراک</Th>
              <Th>ماژول‌های فعال</Th>
              <Th>وضعیت</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {q.data?.map((t) => (
              <tr key={t.id}>
                <Td>
                  <Link to={`/console/tenants/${t.id}`} className="font-medium text-primary hover:underline">
                    {t.name}
                  </Link>
                  <span className="block text-xs text-muted">
                    <DateText value={t.created_at} />
                  </span>
                </Td>
                <Td>
                  <Num value={t.active_users} />
                </Td>
                <Td>
                  <Num value={t.companies} />
                </Td>
                <Td>{t.plan_key ? `${t.plan_key} (${t.subscription_status})` : '—'}</Td>
                <Td>
                  <Ltr className="text-xs">{t.modules.join(', ') || '—'}</Ltr>
                </Td>
                <Td>
                  {t.status === 'pending' ? <Badge tone="info">در انتظار تأیید</Badge> : t.status === 'suspended' ? <Badge tone="warning">تعلیق</Badge> : <Badge tone="success">{t.status === 'trial' ? 'آزمایشی' : 'فعال'}</Badge>}
                </Td>
                <Td>
                  {t.status === 'pending' ? (
                    <Button size="sm" loading={approve.isPending} onClick={() => approve.mutate(t.id)} aria-label={`تأیید ${t.name}`}>
                      تأیید
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" loading={status.isPending} onClick={() => status.mutate({ id: t.id, s: t.status === 'suspended' ? 'active' : 'suspended' })}>
                      {t.status === 'suspended' ? 'فعال‌سازی' : 'تعلیق'}
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
    </>
  );
}

interface AuditRow {
  id: number;
  actor_type: string;
  action: string;
  module_id: string | null;
  entity_id: string | null;
  at: string;
  ip: string | null;
}

export function ConsoleAudit() {
  const q = useQuery({ queryKey: ['console-audit'], queryFn: () => consoleApi<AuditRow[]>('/api/console/audit') });
  const verify = useQuery({ queryKey: ['console-audit-verify'], queryFn: () => consoleApi<{ intact: boolean; firstBrokenId: number | null }>('/api/console/audit/verify') });
  return (
    <>
      <PageHeader title="رویدادهای پلتفرم" />
      {verify.data && (
        <Alert tone={verify.data.intact ? 'success' : 'danger'} className="mb-4">
          {verify.data.intact ? 'زنجیره هش گزارش رویدادها سالم است.' : `زنجیره گزارش رویدادها از ردیف ${verify.data.firstBrokenId} دستکاری شده است.`}
        </Alert>
      )}
      <PageState query={q} isEmpty={q.data?.length === 0}>
        <Table>
          <thead>
            <tr>
              <Th>زمان</Th>
              <Th>عملیات</Th>
              <Th>ماژول</Th>
              <Th>IP</Th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((e) => (
              <tr key={e.id}>
                <Td>
                  <DateText value={e.at} withTime />
                </Td>
                <Td>
                  <Ltr className="font-mono text-xs">{e.action}</Ltr>
                </Td>
                <Td>{e.module_id ?? '—'}</Td>
                <Td>
                  <Ltr>{e.ip ?? '—'}</Ltr>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
    </>
  );
}
