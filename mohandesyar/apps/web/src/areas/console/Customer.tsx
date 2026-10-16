import { useState } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, CardHeader, DateText, DescriptionList, EmptyState, Money, PageHeader, PageState, Stat, Table, Tabs, Td, Th, toast } from '@mohandesyar/ui';
import { toPersianDigits } from '@mohandesyar/persian';
import { consoleApi } from '../../lib/api.js';
import { errorMessage } from '../../lib/errors.js';
import { PaymentsTable } from './Billing.js';
import { TicketsTable } from './Support.js';

interface Customer {
  tenant: { id: string; name: string; slug: string; status: string; created_at: string; active_users: string; company_count: string; storage_bytes: string; timezone: string };
  companies: { id: string; name: string; legal_name: string | null; national_id: string | null; economic_code: string | null; phone: string | null; address: string | null; status: string }[];
  members: { id: string; user_id: string; email: string; full_name: string; status: string; title: string | null; roles: { role: string; name: string }[]; last_login: string | null }[];
  subscription: { plan_name: string; status: string; effectiveStatus: string | null; period_end: string } | null;
  entitledModules: string[];
  modules: { module_id: string; enabled: boolean; source: string; enabled_at: string | null; name: { fa?: string } }[];
  addons: { module_id: string; valid_to: string; name: { fa?: string } | null }[];
  invoices: { id: string; number: string; kind: string; total: string; status: string; created_at: string }[];
}

const TENANT_STATUS: Record<string, string> = { pending: 'در انتظار تأیید', trial: 'آزمایشی', active: 'فعال', suspended: 'تعلیق', closed: 'بسته' };
const SUB_STATUS: Record<string, string> = { active: 'فعال', trialing: 'دوره آزمایشی', expired: 'منقضی', canceled: 'لغوشده', past_due: 'معوق' };
const mb = (b: string) => `${toPersianDigits((Number(b) / 1024 / 1024).toFixed(1))} مگابایت`;

/** One customer organisation: profile, people, subscription, modules, money and support. */
export function CustomerPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState('overview');
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => consoleApi<Customer>(`/api/console/customers/${id}`) });
  const status = useMutation({
    mutationFn: (s: 'active' | 'suspended') => consoleApi(`/api/console/tenants/${id}/status`, { method: 'POST', body: { status: s } }),
    onSuccess: () => {
      toast('وضعیت مشتری تغییر کرد');
      void qc.invalidateQueries({ queryKey: ['customer', id] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <PageState query={q}>
      {q.data && (
        <>
          <PageHeader
            title={q.data.tenant.name}
            description={`ثبت‌نام: ${new Date(q.data.tenant.created_at).toLocaleDateString('fa-IR')} — شناسه ${q.data.tenant.slug}`}
            actions={
              q.data.tenant.status === 'suspended' ? (
                <Button loading={status.isPending} onClick={() => status.mutate('active')}>
                  رفع تعلیق
                </Button>
              ) : (
                q.data.tenant.status !== 'closed' && (
                  <Button variant="secondary" loading={status.isPending} onClick={() => status.mutate('suspended')}>
                    تعلیق حساب
                  </Button>
                )
              )
            }
          />
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="وضعیت حساب">
              <Badge tone={q.data.tenant.status === 'active' ? 'success' : q.data.tenant.status === 'suspended' ? 'danger' : 'warning'}>{TENANT_STATUS[q.data.tenant.status] ?? q.data.tenant.status}</Badge>
            </Stat>
            <Stat label="اشتراک" hint={q.data.subscription ? `تا ${new Date(q.data.subscription.period_end).toLocaleDateString('fa-IR')}` : undefined}>
              {q.data.subscription ? `${q.data.subscription.plan_name} — ${SUB_STATUS[q.data.subscription.effectiveStatus ?? q.data.subscription.status] ?? ''}` : 'بدون اشتراک'}
            </Stat>
            <Stat label="کاربران فعال">{toPersianDigits(q.data.tenant.active_users)}</Stat>
            <Stat label="فضای استفاده‌شده">{mb(q.data.tenant.storage_bytes)}</Stat>
          </div>
          <Tabs
            label="بخش‌های پرونده مشتری"
            value={tab}
            onChange={setTab}
            items={[
              { key: 'overview', label: 'شرکت‌ها و ماژول‌ها' },
              { key: 'members', label: 'کاربران', count: q.data.members.length },
              { key: 'billing', label: 'فاکتور و پرداخت', count: q.data.invoices.length },
              { key: 'tickets', label: 'تیکت‌ها' },
            ]}
          />
          {tab === 'overview' && (
            <div className="grid gap-6 lg:grid-cols-2">
              {q.data.companies.map((c) => (
                <Card key={c.id}>
                  <CardHeader title={c.name} description={c.status === 'archived' ? 'بایگانی‌شده' : undefined} />
                  <div className="p-5">
                    <DescriptionList
                      items={[
                        { label: 'نام حقوقی', value: c.legal_name ?? '—' },
                        { label: 'شناسه ملی', value: c.national_id ? toPersianDigits(c.national_id) : '—' },
                        { label: 'کد اقتصادی', value: c.economic_code ? toPersianDigits(c.economic_code) : '—' },
                        { label: 'تلفن', value: c.phone ?? '—' },
                        { label: 'نشانی', value: c.address ?? '—' },
                      ]}
                    />
                  </div>
                </Card>
              ))}
              <Card>
                <CardHeader title="ماژول‌ها" />
                {q.data.modules.length === 0 ? (
                  <p className="p-5 text-sm text-muted">ماژولی برای این سازمان فعال نشده است.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {q.data.modules.map((m) => (
                      <li key={m.module_id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                        <span>{m.name.fa ?? m.module_id}</span>
                        <span className="flex gap-2">
                          {q.data.addons.some((a) => a.module_id === m.module_id) && <Badge tone="info">خریداری‌شده</Badge>}
                          {m.enabled ? <Badge tone="success">فعال</Badge> : <Badge>غیرفعال</Badge>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          )}
          {tab === 'members' && (
            <Card>
              <div className="overflow-x-auto">
                <Table>
                  <thead>
                    <tr>
                      <Th>نام</Th>
                      <Th>ایمیل</Th>
                      <Th>نقش‌ها</Th>
                      <Th>وضعیت</Th>
                      <Th>آخرین ورود</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.members.map((m) => (
                      <tr key={m.id}>
                        <Td>
                          {m.full_name}
                          {m.title && <span className="block text-xs text-muted">{m.title}</span>}
                        </Td>
                        <Td dir="ltr" className="text-start">
                          {m.email}
                        </Td>
                        <Td>{m.roles.map((r) => r.name).join('، ') || '—'}</Td>
                        <Td>{m.status === 'active' ? <Badge tone="success">فعال</Badge> : <Badge>غیرفعال</Badge>}</Td>
                        <Td>
                          <DateText value={m.last_login} withTime />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </Card>
          )}
          {tab === 'billing' && (
            <div className="space-y-6">
              <Card>
                <CardHeader title="فاکتورها" />
                {q.data.invoices.length === 0 ? (
                  <EmptyState title="فاکتوری صادر نشده است" />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <thead>
                        <tr>
                          <Th>شماره</Th>
                          <Th>نوع</Th>
                          <Th>تاریخ</Th>
                          <Th>مبلغ کل</Th>
                          <Th>وضعیت</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {q.data.invoices.map((i) => (
                          <tr key={i.id}>
                            <Td>{toPersianDigits(i.number)}</Td>
                            <Td>{i.kind === 'subscription' ? 'اشتراک' : 'ماژول'}</Td>
                            <Td>
                              <DateText value={i.created_at} />
                            </Td>
                            <Td>
                              <Money value={i.total} />
                            </Td>
                            <Td>{i.status === 'paid' ? <Badge tone="success">پرداخت‌شده</Badge> : <Badge>پرداخت‌نشده</Badge>}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                )}
              </Card>
              <PaymentsTable tenantId={id} />
            </div>
          )}
          {tab === 'tickets' && <TicketsTable tenantId={id} />}
        </>
      )}
    </PageState>
  );
}
