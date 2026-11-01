import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CreditCard, Printer, XCircle } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, DateText, EmptyState, Ltr, Money, PageHeader, PageState, Stat, Table, Td, Th } from '@mohandesyar/ui';
import { formatMoney, toPersianDigits } from '@mohandesyar/persian';
import { appApi } from '../../lib/api.js';
import { errorMessage } from '../../lib/errors.js';
import { usePlans } from '../public/data.js';

interface Overview {
  subscription: { plan_key: string; plan_name: string; status: string; effectiveStatus: string | null; period_start: string; period_end: string } | null;
  addons: { module_id: string; valid_to: string; name: { fa?: string } | null }[];
  invoices: { id: string; number: string; kind: 'subscription' | 'module'; plan_key: string | null; module_id: string | null; total: string; status: 'unpaid' | 'paid'; created_at: string; paid_at: string | null }[];
  buyableModules: { module_id: string; price_monthly: string; name: { fa?: string }; owned: boolean }[];
  onlinePayment: boolean;
  vatPercent: number;
  trialDays: number | null;
  sandbox: boolean;
}
interface Quote {
  items: { title: string; amount: string }[];
  subtotal: string;
  vatPercent: number;
  vat: string;
  total: string;
  months: number;
  periodEnd: string | null;
}
type Purchase = { kind: 'subscription'; planKey: string; cycle: 'monthly' | 'yearly' } | { kind: 'module'; moduleId: string };

const SUB_STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  active: { label: 'فعال', tone: 'success' },
  trialing: { label: 'دوره آزمایشی', tone: 'warning' },
  expired: { label: 'منقضی', tone: 'danger' },
  canceled: { label: 'لغوشده', tone: 'danger' },
  past_due: { label: 'معوق', tone: 'danger' },
};

/** Result of the bank round trip (?payment=…), read from the server, never from the URL. */
function PaymentResult({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ['payment', id],
    queryFn: () => appApi<{ status: string; error: string | null; rrn: string | null; number: string; kind: string }>(`/api/billing/payments/${id}`),
    refetchInterval: (query) => (query.state.data?.status === 'verifying' || query.state.data?.status === 'pending' ? 3000 : false),
    retry: false,
  });
  if (!q.data) return null;
  const p = q.data;
  if (p.status === 'paid')
    return (
      <Alert tone="success" className="mb-6">
        <CheckCircle2 className="inline size-5" aria-hidden="true" /> پرداخت فاکتور {toPersianDigits(p.number)} با موفقیت انجام شد{p.kind === 'module' ? ' و ماژول فعال شد' : ' و اشتراک سازمان فعال شد'}.
        {p.rrn && (
          <>
            {' '}
            شماره پیگیری: <Ltr>{p.rrn}</Ltr>
          </>
        )}
      </Alert>
    );
  if (p.status === 'failed')
    return (
      <Alert tone="danger" className="mb-6">
        <XCircle className="inline size-5" aria-hidden="true" /> پرداخت انجام نشد: {p.error ?? 'پرداخت ناموفق بود'}. اگر مبلغی از حساب شما کسر شده باشد، بانک آن را حداکثر تا ۷۲ ساعت برمی‌گرداند.
      </Alert>
    );
  return (
    <Alert tone="info" className="mb-6">
      در حال تأیید پرداخت با بانک…
    </Alert>
  );
}

export function BillingPage() {
  const [sp] = useSearchParams();
  const payment = sp.get('payment');
  const q = useQuery({ queryKey: ['billing'], queryFn: () => appApi<Overview>('/api/billing') });
  const plans = usePlans();
  const s = q.data?.subscription;
  const status = s ? SUB_STATUS[s.effectiveStatus ?? s.status] ?? SUB_STATUS.active! : null;
  const daysLeft = s ? Math.ceil((new Date(s.period_end).getTime() - Date.now()) / 86_400_000) : 0;
  return (
    <>
      <PageHeader title="اشتراک و پرداخت" description="پلن سازمان، تمدید، خرید ماژول و فاکتورها." />
      {payment && /^[0-9a-f-]{36}$/.test(payment) && <PaymentResult id={payment} />}
      <PageState query={q}>
        {q.data && (
          <div className="space-y-6">
            {!q.data.onlinePayment && <Alert tone="warning">پرداخت آنلاین هنوز توسط مدیر سامانه فعال نشده است؛ برای خرید با پشتیبانی تماس بگیرید.</Alert>}
            {q.data.sandbox && <Alert tone="warning">درگاه پرداخت در حالت آزمایشی است؛ پرداخت‌ها واقعی نیستند.</Alert>}
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="پلن فعلی">{s?.plan_name ?? 'بدون اشتراک'}</Stat>
              <Stat label="وضعیت">{status ? <Badge tone={status.tone}>{status.label}</Badge> : '—'}</Stat>
              <Stat label="پایان دوره" hint={s && daysLeft > 0 ? `${toPersianDigits(daysLeft)} روز باقی‌مانده` : undefined}>
                {s ? <DateText value={s.period_end} /> : '—'}
              </Stat>
            </div>

            <Card>
              <CardHeader title={s ? 'تمدید یا تغییر پلن' : 'خرید اشتراک'} description="با تمدید همان پلن، دوره جدید از پایان دوره فعلی شروع می‌شود؛ با تغییر پلن، دوره جدید از امروز آغاز می‌شود." />
              <PageState query={plans} isEmpty={plans.data?.length === 0} empty={<p className="p-5 text-sm text-muted">پلنی برای خرید منتشر نشده است.</p>}>
                <ul className="grid gap-4 p-5 md:grid-cols-3">
                  {plans.data?.map((p) => (
                    <li key={p.key} className="flex flex-col rounded-lg border border-border p-4">
                      <p className="font-bold">
                        {p.name} {s?.plan_key === p.key && <Badge tone="success">پلن فعلی</Badge>}
                      </p>
                      <p className="mt-2 text-sm">{p.price_monthly !== null ? `${formatMoney(p.price_monthly, { unit: 'toman' })} ماهانه` : 'قیمت ماهانه ندارد'}</p>
                      {p.price_yearly !== null && <p className="text-sm text-muted">{formatMoney(p.price_yearly, { unit: 'toman' })} سالانه</p>}
                      <div className="mt-4 flex flex-wrap gap-2">
                        {p.price_monthly !== null && (
                          <Link className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-fg" to={`/app/billing/checkout?plan=${encodeURIComponent(p.key)}&cycle=monthly`}>
                            {s?.plan_key === p.key ? 'تمدید ماهانه' : 'خرید ماهانه'}
                          </Link>
                        )}
                        {p.price_yearly !== null && (
                          <Link className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-surface-2" to={`/app/billing/checkout?plan=${encodeURIComponent(p.key)}&cycle=yearly`}>
                            {s?.plan_key === p.key ? 'تمدید سالانه' : 'خرید سالانه'}
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </PageState>
            </Card>

            <Card>
              <CardHeader title="خرید ماژول" description="ماژول خریداری‌شده تا پایان دوره اشتراک فعلی فعال است و هنگام تمدید اشتراک، همراه آن تمدید می‌شود." />
              {q.data.buyableModules.length === 0 ? (
                <p className="p-5 text-sm text-muted">ماژولی برای خرید جداگانه عرضه نشده است.</p>
              ) : (
                <ul className="grid gap-3 p-5 sm:grid-cols-2">
                  {q.data.buyableModules.map((m) => (
                    <li key={m.module_id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                      <div>
                        <p className="font-medium">{m.name.fa ?? m.module_id}</p>
                        <p className="text-sm text-muted">{formatMoney(m.price_monthly, { unit: 'toman' })} در ماه</p>
                      </div>
                      {m.owned ? (
                        <Badge tone="success">در اشتراک شما</Badge>
                      ) : (
                        <Link className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-fg" to={`/app/billing/checkout?module=${encodeURIComponent(m.module_id)}`}>
                          خرید
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader title="فاکتورها" />
              {q.data.invoices.length === 0 ? (
                <EmptyState icon={<CreditCard className="size-8" />} title="هنوز فاکتوری صادر نشده است" />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <thead>
                      <tr>
                        <Th>شماره</Th>
                        <Th>شرح</Th>
                        <Th>تاریخ</Th>
                        <Th>مبلغ کل</Th>
                        <Th>وضعیت</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.invoices.map((i) => (
                        <tr key={i.id}>
                          <Td>
                            <Link to={`/app/billing/invoices/${i.id}`} className="text-primary hover:underline">
                              {toPersianDigits(i.number)}
                            </Link>
                          </Td>
                          <Td>{i.kind === 'subscription' ? `اشتراک پلن ${plans.data?.find((p) => p.key === i.plan_key)?.name ?? i.plan_key}` : `ماژول ${q.data.buyableModules.find((m) => m.module_id === i.module_id)?.name.fa ?? i.module_id}`}</Td>
                          <Td>
                            <DateText value={i.created_at} />
                          </Td>
                          <Td>
                            <Money value={i.total} unit="toman" />
                          </Td>
                          <Td>{i.status === 'paid' ? <Badge tone="success">پرداخت‌شده</Badge> : <Badge>پرداخت‌نشده</Badge>}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </Card>
          </div>
        )}
      </PageState>
    </>
  );
}

/** Quote → invoice → bank. The quote is computed by the server; the page only shows it. */
export function CheckoutPage() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const moduleId = sp.get('module');
  const purchase: Purchase = moduleId ? { kind: 'module', moduleId } : { kind: 'subscription', planKey: sp.get('plan') ?? '', cycle: sp.get('cycle') === 'yearly' ? 'yearly' : 'monthly' };
  const q = useQuery({ queryKey: ['quote', purchase], queryFn: () => appApi<Quote>('/api/billing/quote', { method: 'POST', body: purchase }), retry: false });
  const [error, setError] = useState<string | null>(null);
  const pay = useMutation({
    mutationFn: async () => {
      const inv = await appApi<{ id: string }>('/api/billing/invoices', { method: 'POST', body: purchase });
      return appApi<{ payUrl: string }>(`/api/billing/invoices/${inv.id}/pay`, { method: 'POST', body: { returnTo: '/app/billing' } });
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['billing'] });
      // The bank page lives on another site; a full navigation is required.
      if (/^https?:\/\//.test(r.payUrl) || r.payUrl.startsWith('/api/')) window.location.assign(r.payUrl);
      else nav(r.payUrl);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <>
      <PageHeader title="پرداخت" description="جزئیات خرید را بررسی کنید و برای پرداخت به درگاه بانک سامان (سپ) منتقل شوید." />
      <div className="max-w-xl">
        <PageState query={q}>
          {q.data && (
            <Card>
              <CardHeader title="پیش‌فاکتور" />
              <div className="space-y-3 p-5">
                <ul className="space-y-2">
                  {q.data.items.map((i) => (
                    <li key={i.title} className="flex justify-between gap-4 text-sm">
                      <span>{i.title}</span>
                      <Money value={i.amount} unit="toman" />
                    </li>
                  ))}
                </ul>
                <div className="space-y-1 border-t border-border pt-3 text-sm">
                  <p className="flex justify-between">
                    <span>جمع</span>
                    <Money value={q.data.subtotal} unit="toman" />
                  </p>
                  {q.data.vatPercent > 0 && (
                    <p className="flex justify-between">
                      <span>مالیات بر ارزش افزوده ({toPersianDigits(q.data.vatPercent)}٪)</span>
                      <Money value={q.data.vat} unit="toman" />
                    </p>
                  )}
                  <p className="flex justify-between text-base font-bold">
                    <span>مبلغ قابل پرداخت</span>
                    <Money value={q.data.total} unit="toman" />
                  </p>
                </div>
                {q.data.periodEnd && (
                  <p className="text-sm text-muted">
                    اعتبار پس از پرداخت تا <DateText value={q.data.periodEnd} />
                  </p>
                )}
                {error && <Alert tone="danger">{error}</Alert>}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button loading={pay.isPending} onClick={() => pay.mutate()}>
                    <CreditCard className="size-4" /> پرداخت آنلاین
                  </Button>
                  <Link to="/app/billing" className="inline-flex h-10 items-center rounded-md px-3 text-sm hover:bg-surface-2">
                    {sp.get('plan') ? 'بعداً (ادامه با دوره آزمایشی)' : 'انصراف'}
                  </Link>
                </div>
              </div>
            </Card>
          )}
        </PageState>
      </div>
    </>
  );
}

interface InvoiceDetail {
  number: string;
  kind: string;
  items: { title: string; amount: string }[];
  subtotal: string;
  vat_percent: string;
  vat: string;
  total: string;
  status: string;
  created_at: string;
  paid_at: string | null;
  tenant_name: string;
  buyer: { name?: string; legal_name?: string | null; national_id?: string | null; economic_code?: string | null; address?: string | null; phone?: string | null };
  payments: { id: string; status: string; rrn: string | null; trace_no: string | null; masked_pan: string | null; completed_at: string | null }[];
}

/** Printable invoice (browser print → PDF). */
export function InvoicePage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => appApi<InvoiceDetail>(`/api/billing/invoices/${id}`) });
  const paid = q.data?.payments.find((p) => p.status === 'paid');
  return (
    <PageState query={q}>
      {q.data && (
        <article className="mx-auto max-w-3xl rounded-lg border border-border bg-surface p-6 print:border-0 print:p-0">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
            <div>
              <h1 className="text-xl font-extrabold">فاکتور فروش شماره {toPersianDigits(q.data.number)}</h1>
              <p className="mt-1 text-sm text-muted">
                تاریخ صدور: <DateText value={q.data.created_at} />
              </p>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              {q.data.status === 'paid' ? <Badge tone="success">پرداخت‌شده</Badge> : <Badge>پرداخت‌نشده</Badge>}
              <Button size="sm" variant="secondary" onClick={() => window.print()}>
                <Printer className="size-4" /> چاپ / PDF
              </Button>
            </div>
          </header>
          <section className="mt-4 text-sm leading-7">
            <h2 className="font-semibold">خریدار</h2>
            <p>{q.data.buyer.legal_name || q.data.buyer.name || q.data.tenant_name}</p>
            {q.data.buyer.national_id && <p>شناسه ملی: {toPersianDigits(q.data.buyer.national_id)}</p>}
            {q.data.buyer.economic_code && <p>کد اقتصادی: {toPersianDigits(q.data.buyer.economic_code)}</p>}
            {q.data.buyer.address && <p>نشانی: {q.data.buyer.address}</p>}
          </section>
          <Table className="mt-4">
            <thead>
              <tr>
                <Th>شرح</Th>
                <Th>مبلغ (ریال)</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((i) => (
                <tr key={i.title}>
                  <Td>{i.title}</Td>
                  <Td>
                    <Money value={i.amount} />
                  </Td>
                </tr>
              ))}
              <tr>
                <Td className="font-medium">جمع</Td>
                <Td>
                  <Money value={q.data.subtotal} />
                </Td>
              </tr>
              {Number(q.data.vat_percent) > 0 && (
                <tr>
                  <Td>مالیات بر ارزش افزوده ({toPersianDigits(Number(q.data.vat_percent))}٪)</Td>
                  <Td>
                    <Money value={q.data.vat} />
                  </Td>
                </tr>
              )}
              <tr>
                <Td className="font-bold">مبلغ کل</Td>
                <Td className="font-bold">
                  <Money value={q.data.total} />
                </Td>
              </tr>
            </tbody>
          </Table>
          {paid && (
            <p className="mt-4 text-sm">
              پرداخت از درگاه سپ در <DateText value={paid.completed_at} withTime />
              {paid.rrn && (
                <>
                  {' '}— شماره مرجع <Ltr>{paid.rrn}</Ltr>
                </>
              )}
              {paid.masked_pan && (
                <>
                  {' '}— کارت <Ltr>{paid.masked_pan}</Ltr>
                </>
              )}
            </p>
          )}
        </article>
      )}
    </PageState>
  );
}
