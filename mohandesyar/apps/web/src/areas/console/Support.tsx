import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Card, CardHeader, Checkbox, DateText, EmptyState, Field, PageHeader, PageState, Select, Table, Td, Th, toast } from '@mohandesyar/ui';
import { toPersianDigits } from '@mohandesyar/persian';
import { consoleApi } from '../../lib/api.js';
import { errorMessage } from '../../lib/errors.js';
import { ReplyBox, StatusBadge, TICKET_CATEGORY, TICKET_PRIORITY, TICKET_STATUS, TicketThread, type TicketDetail } from '../../lib/tickets.js';

interface Row {
  id: string;
  number: string;
  subject: string;
  category: string;
  priority: string;
  status: TicketDetail['status'];
  updated_at: string;
  tenant_id: string;
  tenant_name: string;
  created_by_name: string;
}

export function TicketsTable({ tenantId }: { tenantId?: string }) {
  const [status, setStatus] = useState(tenantId ? '' : 'waiting');
  const q = useQuery({
    queryKey: ['console-tickets', status, tenantId],
    queryFn: () => consoleApi<Row[]>(`/api/console/support/tickets?${new URLSearchParams({ ...(status ? { status } : {}), ...(tenantId ? { tenantId } : {}) })}`),
  });
  return (
    <Card>
      <CardHeader
        title="تیکت‌ها"
        actions={
          <Select aria-label="وضعیت تیکت" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
            <option value="waiting">منتظر پاسخ ما</option>
            <option value="">همه</option>
            {Object.entries(TICKET_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        }
      />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState title="تیکتی در این فهرست نیست" />}>
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>شماره</Th>
                <Th>موضوع</Th>
                {!tenantId && <Th>مشتری</Th>}
                <Th>اولویت</Th>
                <Th>وضعیت</Th>
                <Th>آخرین تغییر</Th>
              </tr>
            </thead>
            <tbody>
              {q.data?.map((t) => (
                <tr key={t.id}>
                  <Td>{toPersianDigits(t.number)}</Td>
                  <Td>
                    <Link to={`/console/support/${t.id}`} className="font-medium text-primary hover:underline">
                      {t.subject}
                    </Link>
                    <p className="text-xs text-muted">{t.created_by_name}</p>
                  </Td>
                  {!tenantId && (
                    <Td>
                      <Link to={`/console/tenants/${t.tenant_id}`} className="hover:underline">
                        {t.tenant_name}
                      </Link>
                    </Td>
                  )}
                  <Td>
                    <Badge tone={TICKET_PRIORITY[t.priority]!.tone}>{TICKET_PRIORITY[t.priority]!.label}</Badge>
                  </Td>
                  <Td>
                    <StatusBadge status={t.status} />
                  </Td>
                  <Td>
                    <DateText value={t.updated_at} withTime />
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

export function ConsoleSupport() {
  return (
    <>
      <PageHeader title="پشتیبانی" description="تیکت‌های مشتریان؛ تیکت‌های فوری و منتظر پاسخ بالاتر نمایش داده می‌شوند." />
      <TicketsTable />
    </>
  );
}

export function ConsoleTicket() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [close, setClose] = useState(false);
  const q = useQuery({ queryKey: ['console-ticket', id], queryFn: () => consoleApi<TicketDetail>(`/api/console/support/tickets/${id}`) });
  const update = useMutation({
    mutationFn: (patch: { status?: string; priority?: string }) => consoleApi(`/api/console/support/tickets/${id}`, { method: 'POST', body: patch }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['console-ticket', id] }),
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <PageState query={q}>
      {q.data && (
        <>
          <PageHeader
            title={q.data.subject}
            description={`تیکت ${toPersianDigits(q.data.number)} — ${TICKET_CATEGORY[q.data.category]} — ${q.data.created_by_name}، ${q.data.tenant_name}`}
            actions={
              <div className="flex flex-wrap items-end gap-2">
                <Field label="اولویت">
                  <Select value={q.data.priority} onChange={(e) => update.mutate({ priority: e.target.value })}>
                    {Object.entries(TICKET_PRIORITY).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="وضعیت">
                  <Select value={q.data.status} onChange={(e) => update.mutate({ status: e.target.value })}>
                    {Object.entries(TICKET_STATUS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Link to={`/console/tenants/${q.data.tenant_id}`} className="inline-flex h-10 items-center rounded-md border border-border px-3 text-sm hover:bg-surface-2">
                  پرونده مشتری
                </Link>
              </div>
            }
          />
          <TicketThread ticket={q.data} realm="console" filesPath="/api/console/support/attachments" />
          <Card className="mt-6 max-w-3xl">
            <CardHeader title="پاسخ پشتیبانی" />
            <div className="p-5">
              <ReplyBox
                realm="console"
                uploadPath={`/api/console/support/attachments?ticketId=${id}`}
                submitLabel="ارسال پاسخ"
                extra={<Checkbox label="بستن تیکت پس از پاسخ" checked={close} onChange={(e) => setClose(e.target.checked)} />}
                onSend={async (body, attachmentIds) => {
                  await consoleApi(`/api/console/support/tickets/${id}/reply`, { method: 'POST', body: { body, attachmentIds, close } });
                  toast('پاسخ ارسال شد');
                  await qc.invalidateQueries({ queryKey: ['console-ticket', id] });
                }}
              />
            </div>
          </Card>
        </>
      )}
    </PageState>
  );
}
