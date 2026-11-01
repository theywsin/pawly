import { useQuery } from '@tanstack/react-query';
import { Badge, Card, CardHeader, DateText, Ltr, PageHeader, PageState, Table, Td, Th } from '@mohandesyar/ui';
import { consoleApi } from '../../lib/api.js';

interface System {
  instance: string;
  bootedAt: string;
  runtime: { instance_id: string; module_id: string; version: string; status: string; error: string | null; booted_at: string }[];
  outbox: { status: string; n: number }[];
  loadErrors: Record<string, string>;
}

const OUTBOX: Record<string, string> = { pending: 'در صف', processing: 'در حال پردازش', dispatched: 'ارسال‌شده', failed: 'ناموفق' };

export function Overview() {
  const q = useQuery({ queryKey: ['system'], queryFn: () => consoleApi<System>('/api/console/system'), refetchInterval: 15_000 });
  return (
    <>
      <PageHeader title="وضعیت سامانه" />
      <PageState query={q}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="نمونه پاسخ‌دهنده" />
            <div className="space-y-1 p-5 text-sm">
              <p>
                شناسه: <Ltr className="font-mono">{q.data?.instance}</Ltr>
              </p>
              <p>
                راه‌اندازی: <DateText value={q.data?.bootedAt} withTime />
              </p>
            </div>
          </Card>
          <Card>
            <CardHeader title="صف رویدادها (outbox)" />
            <div className="flex flex-wrap gap-2 p-5">
              {q.data?.outbox.length ? q.data.outbox.map((o) => <Badge key={o.status} tone={o.status === 'failed' ? 'danger' : 'neutral'}>{`${OUTBOX[o.status] ?? o.status}: ${o.n}`}</Badge>) : <span className="text-sm text-muted">رویدادی ثبت نشده است.</span>}
            </div>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="وضعیت بارگذاری ماژول‌ها در نمونه‌ها" description="پس از نصب یا ارتقا، هر نمونه پس از راه‌اندازی مجدد وضعیت خود را گزارش می‌کند." />
            <div className="p-5">
              {q.data?.runtime.length ? (
                <Table>
                  <thead>
                    <tr>
                      <Th>نمونه</Th>
                      <Th>ماژول</Th>
                      <Th>نسخه</Th>
                      <Th>وضعیت</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.runtime.map((r) => (
                      <tr key={`${r.instance_id}-${r.module_id}`}>
                        <Td>
                          <Ltr className="font-mono text-xs">{r.instance_id}</Ltr>
                        </Td>
                        <Td>{r.module_id}</Td>
                        <Td>
                          <Ltr>{r.version}</Ltr>
                        </Td>
                        <Td>{r.status === 'loaded' ? <Badge tone="success">بارگذاری شد</Badge> : <Badge tone="danger">{r.error ?? r.status}</Badge>}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <p className="text-sm text-muted">ماژولی نصب نشده است.</p>
              )}
            </div>
          </Card>
        </div>
      </PageState>
    </>
  );
}
