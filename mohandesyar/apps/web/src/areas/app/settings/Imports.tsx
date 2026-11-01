import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, downloadBlob, EmptyState, Field, Input, PageHeader, PageState, Table, Td, Th, toXlsx } from '@mohandesyar/ui';
import { appApi } from '../../../lib/api.js';
import { errorMessage } from '../../../lib/errors.js';

interface Column { key: string; header: string; required: boolean; type: string; values?: Record<string, string>; hint?: string }
interface Template { moduleId: string; moduleName: { fa: string }; key: string; title: { fa: string }; description?: { fa: string }; columns: Column[] }
interface Outcome { total: number; created: number; imported: boolean; errors: { row: number; column?: string; message: string }[]; ignoredColumns: string[] }

const TYPE: Record<string, string> = { text: 'متن', integer: 'عدد صحیح', decimal: 'عدد', money: 'مبلغ ریال', date: 'تاریخ (شمسی یا Excel)', boolean: 'بله/خیر', enum: 'یکی از گزینه‌ها' };
const fa = (n: number) => n.toLocaleString('fa-IR');

/** Data migration from spreadsheets: templates declared by active modules; validate first, then import all or nothing. */
export function ImportsPage() {
  const templates = useQuery({ queryKey: ['imports', 'templates'], queryFn: () => appApi<Template[]>('/api/core/imports/templates') });
  const [selected, setSelected] = useState<string | null>(null);
  const t = templates.data?.find((x) => `${x.moduleId}/${x.key}` === selected) ?? null;
  return (
    <>
      <PageHeader title="ورود داده از Excel" description="برای انتقال داده‌های قبلی: قالب را دانلود و پر کنید، فایل را بررسی کنید و اگر خطایی نبود وارد کنید. اگر حتی یک ردیف خطا داشته باشد هیچ ردیفی وارد نمی‌شود." />
      <PageState query={templates} isEmpty={templates.data?.length === 0} empty={<EmptyState icon={<FileSpreadsheet className="size-8" />} title="قالبی در دسترس نیست" description="ماژول‌های فعال قالب ورود داده‌ای ندارند یا مجوز آن را ندارید." />}>
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <nav aria-label="قالب‌ها">
            <ul className="space-y-1">
              {templates.data?.map((x) => {
                const k = `${x.moduleId}/${x.key}`;
                return (
                  <li key={k}>
                    <button type="button" aria-current={k === selected} onClick={() => setSelected(k)} className={`w-full rounded-md px-3 py-2 text-start text-sm ${k === selected ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-surface-2'}`}>
                      {x.title.fa}<span className="block text-xs text-muted">{x.moduleName.fa}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          {t ? <TemplatePanel key={selected} t={t} /> : <p className="text-sm text-muted">یک قالب را انتخاب کنید.</p>}
        </div>
      </PageState>
    </>
  );
}

function TemplatePanel({ t }: { t: Template }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const [result, setResult] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const header = (k?: string) => t.columns.find((c) => c.key === k)?.header ?? '';
  const downloadTemplate = () => {
    const cols = t.columns.map((c) => ({ header: c.required ? `${c.header} *` : c.header, value: () => '' }));
    downloadBlob(`${t.key}.xlsx`, toXlsx(t.title.fa.slice(0, 31), cols, []) as BlobPart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };
  const send = async (commit: boolean) => {
    if (!file) return;
    setBusy(commit ? 'import' : 'check');
    setError(null);
    try {
      const fd = new FormData();
      fd.append('commit', commit ? '1' : '0');
      fd.append('file', file);
      const r = await appApi<Outcome>(`/api/core/imports/${t.moduleId}/${t.key}`, { method: 'POST', raw: fd });
      setResult(r);
      if (r.imported) void qc.invalidateQueries();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t.title.fa} actions={<Button variant="secondary" onClick={downloadTemplate}><Download className="size-4" /> دانلود قالب</Button>} />
        {t.description && <p className="mb-3 text-sm">{t.description.fa}</p>}
        <Table>
          <thead><tr><Th>ستون</Th><Th>نوع</Th><Th>توضیح</Th></tr></thead>
          <tbody>
            {t.columns.map((c) => (
              <tr key={c.key}>
                <Td>{c.header}{c.required && <Badge tone="warning" className="ms-1">الزامی</Badge>}</Td>
                <Td>{TYPE[c.type] ?? c.type}</Td>
                <Td className="text-xs">{c.values ? Object.keys(c.values).join('، ') : c.hint ?? ''}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-3 text-xs text-muted">سطر اول فایل باید عنوان ستون‌ها باشد (ترتیب مهم نیست). فایل xlsx یا CSV (UTF-8)، حداکثر ۵٬۰۰۰ ردیف.</p>
      </Card>
      <Card>
        <CardHeader title="بارگذاری فایل" />
        <div className="flex flex-wrap items-end gap-3">
          <Field label="فایل پرشده" className="min-w-64 flex-1">
            <Input type="file" accept=".xlsx,.csv,.txt" onChange={(e) => (setFile(e.target.files?.[0] ?? null), setResult(null), setError(null))} />
          </Field>
          <Button variant="secondary" disabled={!file} loading={busy === 'check'} onClick={() => void send(false)}>بررسی فایل</Button>
        </div>
        {error && <Alert tone="danger" className="mt-4">{error}</Alert>}
        {result && (
          <div className="mt-4 space-y-3" aria-live="polite">
            {result.imported ? (
              <Alert tone="success">{fa(result.created)} ردیف وارد شد.</Alert>
            ) : result.errors.length ? (
              <Alert tone="danger">{fa(result.errors.length)} خطا پیدا شد؛ هیچ ردیفی وارد نشد. فایل را اصلاح و دوباره بررسی کنید.</Alert>
            ) : (
              <Alert tone="info">
                {fa(result.total)} ردیف بدون خطاست و آماده ورود است.
                <Button className="ms-3" size="sm" loading={busy === 'import'} onClick={() => void send(true)}>ورود {fa(result.total)} ردیف</Button>
              </Alert>
            )}
            {result.ignoredColumns.length > 0 && <p className="text-sm text-muted">ستون‌های ناشناخته (نادیده گرفته شد): {result.ignoredColumns.join('، ')}</p>}
            {result.errors.length > 0 && (
              <Table>
                <thead><tr><Th>ردیف فایل</Th><Th>ستون</Th><Th>خطا</Th></tr></thead>
                <tbody>{result.errors.map((e, i) => <tr key={i}><Td className="tabular-nums">{e.row ? fa(e.row) : '—'}</Td><Td>{header(e.column) || '—'}</Td><Td>{e.message}</Td></tr>)}</tbody>
              </Table>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
