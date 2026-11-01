import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy } from 'lucide-react';
import { Badge, Button, Card, CardHeader, DateText, EmptyState, Field, Input, PageHeader, PageState, Select, Table, Td, Th } from '@mohandesyar/ui';
import { toPersianDigits } from '@mohandesyar/persian';
import { appApi } from '../../lib/api.js';
import { ReplyBox, StatusBadge, TICKET_CATEGORY, TICKET_PRIORITY, TicketThread, type TicketDetail } from '../../lib/tickets.js';

interface Row {
  id: string;
  number: string;
  subject: string;
  category: string;
  priority: string;
  status: TicketDetail['status'];
  updated_at: string;
  created_by_name: string;
}

export function SupportList() {
  const q = useQuery({ queryKey: ['tickets'], queryFn: () => appApi<Row[]>('/api/support/tickets') });
  return (
    <>
      <PageHeader title="پشتیبانی" description="سؤال، گزارش خطا یا درخواست خود را برای تیم پشتیبانی بفرستید؛ پاسخ را همین‌جا و در اعلان‌ها می‌بینید." actions={<Link to="/app/support/new" className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-fg">تیکت جدید</Link>} />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<LifeBuoy className="size-8" />} title="هنوز تیکتی ثبت نکرده‌اید" />}>
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>شماره</Th>
                  <Th>موضوع</Th>
                  <Th>دسته</Th>
                  <Th>وضعیت</Th>
                  <Th>آخرین تغییر</Th>
                </tr>
              </thead>
              <tbody>
                {q.data?.map((t) => (
                  <tr key={t.id}>
                    <Td>{toPersianDigits(t.number)}</Td>
                    <Td>
                      <Link to={`/app/support/${t.id}`} className="font-medium text-primary hover:underline">
                        {t.subject}
                      </Link>
                      {t.priority === 'high' && <Badge tone="danger" className="ms-2">فوری</Badge>}
                    </Td>
                    <Td>{TICKET_CATEGORY[t.category]}</Td>
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
        </Card>
      </PageState>
    </>
  );
}

export function NewTicket() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('technical');
  const [priority, setPriority] = useState('normal');
  return (
    <>
      <PageHeader title="تیکت جدید" />
      <Card className="max-w-3xl">
        <div className="space-y-4 p-5">
          <Field label="موضوع">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="دسته">
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                {Object.entries(TICKET_CATEGORY).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="اولویت">
              <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                {Object.entries(TICKET_PRIORITY).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <ReplyBox
            realm="app"
            uploadPath="/api/support/attachments"
            label="شرح درخواست"
            submitLabel="ثبت تیکت"
            onSend={async (body, attachmentIds) => {
              const r = await appApi<{ id: string }>('/api/support/tickets', { method: 'POST', body: { subject, category, priority, body, attachmentIds } });
              void qc.invalidateQueries({ queryKey: ['tickets'] });
              nav(`/app/support/${r.id}`, { replace: true });
            }}
          />
        </div>
      </Card>
    </>
  );
}

export function TicketPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ticket', id], queryFn: () => appApi<TicketDetail>(`/api/support/tickets/${id}`) });
  const close = useMutation({
    mutationFn: () => appApi(`/api/support/tickets/${id}/close`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ticket', id] }),
  });
  return (
    <PageState query={q}>
      {q.data && (
        <>
          <PageHeader
            title={q.data.subject}
            description={`تیکت ${toPersianDigits(q.data.number)} — ${TICKET_CATEGORY[q.data.category]}`}
            actions={
              <div className="flex items-center gap-2">
                <StatusBadge status={q.data.status} />
                {q.data.status !== 'closed' && (
                  <Button size="sm" variant="ghost" loading={close.isPending} onClick={() => close.mutate()}>
                    بستن تیکت
                  </Button>
                )}
              </div>
            }
          />
          <TicketThread ticket={q.data} realm="app" filesPath="/api/support/attachments" />
          <Card className="mt-6 max-w-3xl">
            <CardHeader title={q.data.status === 'closed' ? 'بازگشایی با پیام جدید' : 'پاسخ'} />
            <div className="p-5">
              <ReplyBox
                realm="app"
                uploadPath="/api/support/attachments"
                onSend={async (body, attachmentIds) => {
                  await appApi(`/api/support/tickets/${id}/reply`, { method: 'POST', body: { body, attachmentIds } });
                  await qc.invalidateQueries({ queryKey: ['ticket', id] });
                }}
              />
            </div>
          </Card>
        </>
      )}
    </PageState>
  );
}
