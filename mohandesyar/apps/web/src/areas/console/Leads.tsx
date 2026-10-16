import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { Badge, Button, DateText, Dialog, EmptyState, Field, Ltr, PageHeader, PageState, Select, Table, Td, Textarea, Th, toast, type Tone } from '@mohandesyar/ui';
import { consoleApi } from '../../lib/api.js';
import { errorMessage } from '../../lib/errors.js';

interface Lead {
  id: string;
  kind: 'demo' | 'contact';
  full_name: string;
  company: string | null;
  company_size: string | null;
  phone: string | null;
  email: string | null;
  message: string | null;
  status: string;
  spam_reason: string | null;
  created_at: string;
  notes: number;
}
interface LeadDetail extends Omit<Lead, 'notes'> {
  notes: { id: string; body: string; admin_name: string; created_at: string }[];
}

export const LEAD_STATUS: Record<string, { label: string; tone: Tone }> = {
  new: { label: 'جدید', tone: 'info' },
  contacted: { label: 'تماس گرفته شد', tone: 'neutral' },
  qualified: { label: 'واجد شرایط', tone: 'success' },
  won: { label: 'تبدیل به مشتری', tone: 'success' },
  lost: { label: 'از دست رفت', tone: 'warning' },
  spam: { label: 'هرزنامه', tone: 'danger' },
};

function LeadDialog({ id, onClose }: { id: string; onClose(): void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['lead', id], queryFn: () => consoleApi<LeadDetail>(`/api/console/leads/${id}`) });
  const [note, setNote] = useState('');
  const update = useMutation({
    mutationFn: (body: { status?: string; note?: string }) => consoleApi(`/api/console/leads/${id}`, { method: 'POST', body }),
    onSuccess: () => {
      setNote('');
      void qc.invalidateQueries({ queryKey: ['lead', id] });
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  const l = q.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={l ? `${l.kind === 'demo' ? 'درخواست دمو' : 'پیام تماس'} — ${l.full_name}` : 'جزئیات'}>
      <PageState query={q}>
        {l && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-[7rem_1fr] gap-y-1">
              <dt className="text-muted">شرکت</dt>
              <dd>{l.company ?? '—'}</dd>
              <dt className="text-muted">اندازه</dt>
              <dd>{l.company_size ?? '—'}</dd>
              <dt className="text-muted">تلفن</dt>
              <dd><Ltr>{l.phone ?? '—'}</Ltr></dd>
              <dt className="text-muted">ایمیل</dt>
              <dd><Ltr>{l.email ?? '—'}</Ltr></dd>
              <dt className="text-muted">زمان</dt>
              <dd><DateText value={l.created_at} withTime /></dd>
            </dl>
            {l.message && <p className="whitespace-pre-line rounded bg-surface-2 p-3 leading-7">{l.message}</p>}
            {l.spam_reason && <Badge tone="danger">علت علامت هرزنامه: {l.spam_reason}</Badge>}
            <Field label="وضعیت پیگیری">
              <Select value={l.status} onChange={(e) => update.mutate({ status: e.target.value })} disabled={update.isPending}>
                {Object.entries(LEAD_STATUS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </Select>
            </Field>
            <div>
              <p className="font-medium">یادداشت‌ها</p>
              <ul className="mt-2 space-y-2">
                {l.notes.map((n) => (
                  <li key={n.id} className="rounded border border-border p-2">
                    <p className="whitespace-pre-line">{n.body}</p>
                    <p className="mt-1 text-xs text-muted">{n.admin_name} · <DateText value={n.created_at} withTime /></p>
                  </li>
                ))}
              </ul>
              <Textarea className="mt-2" rows={2} value={note} onChange={(e) => setNote(e.target.value)} aria-label="یادداشت جدید" />
              <Button size="sm" className="mt-2" disabled={!note.trim()} loading={update.isPending} onClick={() => update.mutate({ note })}>
                افزودن یادداشت
              </Button>
            </div>
          </div>
        )}
      </PageState>
    </Dialog>
  );
}

export function Leads() {
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['leads', status], queryFn: () => consoleApi<Lead[]>(`/api/console/leads${status ? `?status=${status}` : ''}`) });
  return (
    <>
      <PageHeader
        title="پیام‌های تماس"
        description="از فرم‌های سایت. موارد مشکوک به هرزنامه جدا نگهداری می‌شوند."
        actions={
          <Select aria-label="فیلتر وضعیت" value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
            <option value="">همه (بجز هرزنامه)</option>
            {Object.entries(LEAD_STATUS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </Select>
        }
      />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<Inbox className="size-8" />} title="درخواستی وجود ندارد" />}>
        <Table>
          <thead>
            <tr>
              <Th>زمان</Th>
              <Th>نوع</Th>
              <Th>نام</Th>
              <Th>شرکت</Th>
              <Th>تماس</Th>
              <Th>وضعیت</Th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((l) => (
              <tr key={l.id}>
                <Td><DateText value={l.created_at} relative /></Td>
                <Td>{l.kind === 'demo' ? 'دمو' : 'تماس'}</Td>
                <Td>
                  <button className="font-medium text-primary underline" onClick={() => setOpen(l.id)}>{l.full_name}</button>
                </Td>
                <Td>{l.company ?? '—'}</Td>
                <Td><Ltr>{l.phone ?? l.email}</Ltr></Td>
                <Td><Badge tone={LEAD_STATUS[l.status]?.tone}>{LEAD_STATUS[l.status]?.label}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {open && <LeadDialog id={open} onClose={() => setOpen(null)} />}
    </>
  );
}
