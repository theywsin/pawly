import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, DateText, EmptyState, Field, Input, Ltr, Money, MoneyInput, PageHeader, PageState, Select, Table, Tabs, Td, Th, toast } from '@mohandesyar/ui';
import { consoleApi } from '../../lib/api.js';
import { errorMessage } from '../../lib/errors.js';
import { useAdmin } from '../../lib/session.js';

interface Settings {
  vatPercent: number;
  trialDays: number | null;
  gateway: { enabled: boolean; terminalId: string; sandbox: boolean };
  sandboxAvailable: boolean;
  callbackUrl: string;
}
interface ModulePrice {
  module_id: string;
  name: { fa?: string } | null;
  price_monthly: string | null;
  price_yearly: string | null;
  purchasable: boolean;
}
export interface PaymentRow {
  id: string;
  status: 'pending' | 'verifying' | 'paid' | 'failed';
  amount: string;
  ref_num: string | null;
  rrn: string | null;
  trace_no: string | null;
  masked_pan: string | null;
  error: string | null;
  created_at: string;
  invoice_id: string;
  number: string;
  kind: 'subscription' | 'module';
  plan_key: string | null;
  module_id: string | null;
  tenant_id: string;
  tenant_name: string;
}

export const PAYMENT_STATUS: Record<PaymentRow['status'], { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' }> = {
  pending: { label: 'در انتظار پرداخت', tone: 'neutral' },
  verifying: { label: 'در حال تأیید بانک', tone: 'warning' },
  paid: { label: 'موفق', tone: 'success' },
  failed: { label: 'ناموفق', tone: 'danger' },
};

function SettingsTab() {
  const qc = useQueryClient();
  const admin = useAdmin();
  const q = useQuery({ queryKey: ['billing-settings'], queryFn: () => consoleApi<Settings>('/api/console/billing/settings') });
  const [v, setV] = useState<Settings | null>(null);
  const [trial, setTrial] = useState('');
  useEffect(() => {
    if (q.data) {
      setV(q.data);
      setTrial(q.data.trialDays === null ? '' : String(q.data.trialDays));
    }
  }, [q.data]);
  const canEdit = admin.roles.includes('super_admin');
  const save = useMutation({
    mutationFn: () => consoleApi('/api/console/billing/settings', { method: 'PUT', body: { vatPercent: v!.vatPercent, trialDays: trial.trim() === '' ? null : Number(trial), gateway: v!.gateway } }),
    onSuccess: () => {
      toast('تنظیمات پرداخت ذخیره شد');
      void qc.invalidateQueries({ queryKey: ['billing-settings'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <PageState query={q}>
      {v && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="درگاه پرداخت سپ (بانک سامان)" description="پس از دریافت ترمینال از بانک سامان، شماره ترمینال را وارد و درگاه را فعال کنید." />
            <div className="space-y-4 p-5">
              <Checkbox label="پرداخت آنلاین فعال باشد" checked={v.gateway.enabled} disabled={!canEdit} onChange={(e) => setV({ ...v, gateway: { ...v.gateway, enabled: e.target.checked } })} />
              <Field label="شماره ترمینال (Terminal ID)">
                <Input dir="ltr" inputMode="numeric" value={v.gateway.terminalId} disabled={!canEdit} onChange={(e) => setV({ ...v, gateway: { ...v.gateway, terminalId: e.target.value.trim() } })} />
              </Field>
              <Field label="نشانی بازگشت (برای ثبت در پنل پذیرندگی بانک)" hint="بانک فقط به نشانی ثبت‌شده برمی‌گرداند؛ همین نشانی را به بانک اعلام کنید.">
                <Input dir="ltr" readOnly value={v.callbackUrl} onFocus={(e) => e.target.select()} />
              </Field>
              {v.sandboxAvailable && (
                <Checkbox
                  label="درگاه آزمایشی (بدون پول واقعی؛ فقط برای آزمایش)"
                  checked={v.gateway.sandbox}
                  disabled={!canEdit}
                  onChange={(e) => setV({ ...v, gateway: { ...v.gateway, sandbox: e.target.checked } })}
                />
              )}
              {v.gateway.enabled && v.gateway.sandbox && <Alert tone="warning">درگاه آزمایشی فعال است؛ پرداخت‌ها واقعی نیستند. پیش از راه‌اندازی آن را خاموش کنید.</Alert>}
            </div>
          </Card>
          <Card>
            <CardHeader title="فاکتور و دوره آزمایشی" />
            <div className="space-y-4 p-5">
              <Field label="مالیات بر ارزش افزوده (درصد)" hint="صفر یعنی بدون مالیات. در فاکتور به‌صورت ردیف جدا نمایش داده می‌شود.">
                <Input dir="ltr" inputMode="decimal" value={String(v.vatPercent)} disabled={!canEdit} onChange={(e) => setV({ ...v, vatPercent: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })} />
              </Field>
              <Field label="دوره آزمایشی رایگان (روز)" hint="صفر یعنی بدون دوره آزمایشی (سازمان تا پرداخت فقط‌خواندنی است)؛ خالی یعنی تنظیم هر پلن.">
                <Input dir="ltr" inputMode="numeric" value={trial} disabled={!canEdit} onChange={(e) => setTrial(e.target.value.replace(/\D/g, ''))} />
              </Field>
            </div>
          </Card>
          <div className="lg:col-span-2">
            {canEdit ? (
              <Button loading={save.isPending} onClick={() => save.mutate()}>
                ذخیره تنظیمات
              </Button>
            ) : (
              <p className="text-sm text-muted">فقط مدیر ارشد پلتفرم می‌تواند تنظیمات پرداخت را تغییر دهد.</p>
            )}
          </div>
        </div>
      )}
    </PageState>
  );
}

function PriceRow({ m }: { m: ModulePrice }) {
  const qc = useQueryClient();
  const [monthly, setMonthly] = useState(m.price_monthly ?? '');
  const [yearly, setYearly] = useState(m.price_yearly ?? '');
  const [on, setOn] = useState(m.purchasable);
  const save = useMutation({
    mutationFn: () => consoleApi(`/api/console/billing/module-prices/${m.module_id}`, { method: 'PUT', body: { priceMonthly: Number(monthly || 0), priceYearly: yearly ? Number(yearly) : null, purchasable: on } }),
    onSuccess: () => {
      toast(`قیمت ${m.name?.fa ?? m.module_id} ذخیره شد`);
      void qc.invalidateQueries({ queryKey: ['module-prices'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const label = m.name?.fa ?? m.module_id;
  return (
    <tr>
      <Td className="font-medium">{label}</Td>
      <Td>
        <MoneyInput aria-label={`قیمت ماهانه ${label} (ریال)`} value={monthly} onChange={setMonthly} />
      </Td>
      <Td>
        <MoneyInput aria-label={`قیمت سالانه ${label} (ریال)`} value={yearly} onChange={setYearly} />
      </Td>
      <Td>
        <Checkbox label="قابل خرید" checked={on} onChange={(e) => setOn(e.target.checked)} />
      </Td>
      <Td>
        <Button size="sm" variant="secondary" loading={save.isPending} disabled={!monthly} onClick={() => save.mutate()}>
          ذخیره
        </Button>
      </Td>
    </tr>
  );
}

function PricesTab() {
  const q = useQuery({ queryKey: ['module-prices'], queryFn: () => consoleApi<ModulePrice[]>('/api/console/billing/module-prices') });
  return (
    <Card>
      <CardHeader title="قیمت ماژول‌ها" description="قیمت خرید جداگانه هر ماژول (ریال). ماژول خریداری‌شده تا پایان اشتراک فعلی سازمان فعال است و با تمدید اشتراک تمدید می‌شود؛ هزینه بر اساس ماه‌های باقی‌مانده محاسبه می‌شود." />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState title="ماژولی نصب نشده است" />}>
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>ماژول</Th>
                <Th>قیمت ماهانه (ریال)</Th>
                <Th>قیمت سالانه (ریال، اختیاری)</Th>
                <Th>وضعیت</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {q.data?.map((m) => (
                <PriceRow key={m.module_id} m={m} />
              ))}
            </tbody>
          </Table>
        </div>
      </PageState>
    </Card>
  );
}

export function PaymentsTable({ tenantId }: { tenantId?: string }) {
  const [status, setStatus] = useState('');
  const q = useQuery({
    queryKey: ['payments', status, tenantId],
    queryFn: () => consoleApi<PaymentRow[]>(`/api/console/billing/payments?${new URLSearchParams({ ...(status ? { status } : {}), ...(tenantId ? { tenantId } : {}) })}`),
  });
  return (
    <Card>
      <CardHeader
        title="پرداخت‌ها"
        actions={
          <Select aria-label="وضعیت پرداخت" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
            <option value="">همه وضعیت‌ها</option>
            {Object.entries(PAYMENT_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        }
      />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState title="پرداختی ثبت نشده است" />}>
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>زمان</Th>
                {!tenantId && <Th>مشتری</Th>}
                <Th>فاکتور</Th>
                <Th>مبلغ</Th>
                <Th>وضعیت</Th>
                <Th>شماره مرجع / پیگیری</Th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <DateText value={p.created_at} withTime />
                  </Td>
                  {!tenantId && (
                    <Td>
                      <Link to={`/console/tenants/${p.tenant_id}`} className="text-primary hover:underline">
                        {p.tenant_name}
                      </Link>
                    </Td>
                  )}
                  <Td>
                    {p.number} — {p.kind === 'subscription' ? `اشتراک ${p.plan_key}` : `ماژول ${p.module_id}`}
                  </Td>
                  <Td>
                    <Money value={p.amount} />
                  </Td>
                  <Td>
                    <Badge tone={PAYMENT_STATUS[p.status].tone}>{PAYMENT_STATUS[p.status].label}</Badge>
                    {p.error && <p className="mt-1 text-xs text-muted">{p.error}</p>}
                  </Td>
                  <Td className="text-xs">
                    {p.rrn ? <Ltr>{p.rrn}</Ltr> : '—'}
                    {p.trace_no && (
                      <>
                        {' / '}
                        <Ltr>{p.trace_no}</Ltr>
                      </>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </PageState>
    </Card>
  );
}

export function ConsoleBilling() {
  const [tab, setTab] = useState('payments');
  return (
    <>
      <PageHeader title="پرداخت و فروش" description="پرداخت‌های آنلاین مشتریان، درگاه سپ، مالیات بر ارزش افزوده، دوره آزمایشی و قیمت ماژول‌ها." />
      <Tabs
        label="بخش‌های پرداخت"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'payments', label: 'پرداخت‌ها' },
          { key: 'prices', label: 'قیمت ماژول‌ها' },
          { key: 'settings', label: 'درگاه و تنظیمات' },
        ]}
      />
      {tab === 'payments' && <PaymentsTable />}
      {tab === 'prices' && <PricesTab />}
      {tab === 'settings' && <SettingsTab />}
    </>
  );
}
