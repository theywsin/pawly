import { useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { Badge, Button, cn, DateText, Field, Textarea, toast, type Tone } from '@mohandesyar/ui';
import { downloadFile, request, type Realm } from './api.js';
import { errorMessage } from './errors.js';

export interface TicketFile {
  id: string;
  name: string;
  size: number;
}
export interface TicketMessage {
  id: string;
  author_type: 'user' | 'admin';
  author_name: string;
  body: string;
  created_at: string;
  files: TicketFile[];
}
export interface TicketDetail {
  id: string;
  number: string;
  subject: string;
  category: string;
  priority: 'low' | 'normal' | 'high';
  status: 'open' | 'answered' | 'customer_reply' | 'closed';
  created_at: string;
  created_by_name: string;
  tenant_id: string;
  tenant_name: string;
  messages: TicketMessage[];
}

export const TICKET_STATUS: Record<TicketDetail['status'], { label: string; tone: Tone }> = {
  open: { label: 'در انتظار پاسخ', tone: 'warning' },
  answered: { label: 'پاسخ داده شد', tone: 'success' },
  customer_reply: { label: 'پاسخ مشتری', tone: 'warning' },
  closed: { label: 'بسته', tone: 'neutral' },
};
export const TICKET_CATEGORY: Record<string, string> = { technical: 'فنی', billing: 'مالی و پرداخت', feature: 'پیشنهاد قابلیت', other: 'سایر' };
export const TICKET_PRIORITY: Record<string, { label: string; tone: Tone }> = { low: { label: 'کم', tone: 'neutral' }, normal: { label: 'عادی', tone: 'info' }, high: { label: 'فوری', tone: 'danger' } };

export function StatusBadge({ status }: { status: TicketDetail['status'] }) {
  return <Badge tone={TICKET_STATUS[status].tone}>{TICKET_STATUS[status].label}</Badge>;
}

const size = (n: number) => (n < 1024 * 1024 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** The conversation, oldest first; the platform's messages are on the opposite side. */
export function TicketThread({ ticket, realm, filesPath }: { ticket: TicketDetail; realm: Realm; filesPath: string }) {
  return (
    <ol className="space-y-4" aria-label="گفت‌وگو">
      {ticket.messages.map((m) => (
        <li key={m.id} className={cn('max-w-3xl rounded-lg border p-4', m.author_type === 'admin' ? 'me-auto border-primary/30 bg-primary/5' : 'ms-auto border-border bg-surface')}>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <strong>{m.author_name}</strong>
            <span className="text-muted">
              <DateText value={m.created_at} withTime />
            </span>
          </p>
          <p className="mt-2 whitespace-pre-line leading-8">{m.body}</p>
          {m.files.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {m.files.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-sm hover:bg-surface-2"
                    onClick={() => downloadFile(realm, `${filesPath}/${f.id}`, f.name).catch((e) => toast(errorMessage(e), 'danger'))}
                  >
                    <Paperclip className="size-4" aria-hidden="true" /> {f.name} <span className="text-xs text-muted">({size(f.size)})</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Message box with attachments (uploaded first, sent with the message). */
export function ReplyBox({
  realm,
  uploadPath,
  label = 'پاسخ',
  submitLabel = 'ارسال',
  onSend,
  extra,
}: {
  realm: Realm;
  uploadPath: string;
  label?: string;
  submitLabel?: string;
  onSend(body: string, attachmentIds: string[]): Promise<unknown>;
  extra?: React.ReactNode;
}) {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<TicketFile[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const upload = async (f: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await request<TicketFile>(realm, uploadPath, { method: 'POST', raw: fd });
      setFiles((x) => [...x, r]);
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSend(body, files.map((f) => f.id));
          setBody('');
          setFiles([]);
        } catch (err) {
          toast(errorMessage(err), 'danger');
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label={label}>
        <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="پیوست‌ها">
          {files.map((f) => (
            <li key={f.id} className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-sm">
              <Paperclip className="size-4" aria-hidden="true" /> {f.name}
              <button type="button" aria-label={`حذف ${f.name}`} onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))}>
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          className="sr-only"
          aria-label="افزودن پیوست"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void upload(f);
          }}
        />
        <Button type="button" variant="secondary" size="sm" disabled={busy || files.length >= 5} onClick={() => input.current?.click()}>
          <Paperclip className="size-4" /> پیوست (حداکثر ۱۰ مگابایت)
        </Button>
        {extra}
        <Button type="submit" loading={busy} disabled={!body.trim()} className="ms-auto">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
