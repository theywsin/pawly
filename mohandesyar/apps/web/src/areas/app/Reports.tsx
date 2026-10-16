import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileBarChart, Printer, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, DateInput, DateText, DayText, Dialog, EmptyState, ExportMenu, Field, Input, PageHeader, PageState, Select, Table, Tabs, Td, Th, toast } from '@mohandesyar/ui';
import { appApi } from '../../lib/api.js';
import { errorMessage } from '../../lib/errors.js';
import { useAppSession } from '../../lib/session.js';

interface Filter { key: string; label: string; options?: Record<string, string> }
interface ReportDef { moduleId: string; moduleName: { fa: string }; key: string; title: { fa: string }; description?: { fa: string }; filters: Filter[] }
interface Result { columns: { key: string; header: string; kind?: string }[]; rows: Record<string, string | number | null>[]; period: { from: string; to: string } }
interface Params { range: string; from: string | null; to: string | null; filters: Record<string, string> }
interface Saved { id: string; module_id: string; report_key: string; name: string; params: Params; schedule: string; recipients: string[]; next_run_at: string | null; last_run_at: string | null; mine: boolean }
interface Run { id: string; name: string; period_from: string | null; period_to: string | null; status: string; row_count: number; error: string | null; created_at: string; has_file: boolean }

const RANGE: Record<string, string> = { last_7_days: '۷ روز اخیر', month_to_date: 'از ابتدای ماه جاری', last_month: 'ماه گذشته', year_to_date: 'از ابتدای سال', custom: 'بازه دلخواه' };
const SCHEDULE: Record<string, string> = { none: 'بدون ارسال خودکار', daily: 'روزانه (ساعت ۷)', weekly: 'هفتگی (شنبه ساعت ۷)', monthly: 'ماهانه (اول ماه ساعت ۷)' };
const fail = (e: unknown) => toast(errorMessage(e), 'danger');
const cell = (v: string | number | null, kind?: string) => (v === null || v === '' ? '—' : kind === 'date' ? <DayText value={String(v)} /> : kind === 'number' ? Number(v).toLocaleString('fa-IR') : String(v));

/** Reports of active modules: run with filters, export/print, save with a schedule, and a delivery inbox. */
export function ReportsPage() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'run';
  return (
    <>
      <PageHeader title="گزارش‌ها" description="هر گزارش با سطح دسترسی خواننده ساخته می‌شود: در ارسال زمان‌بندی‌شده هم برای هر گیرنده جداگانه و فقط با داده‌ای که خودش در سامانه می‌بیند." />
      <Tabs label="بخش" value={tab} onChange={(k) => setSp({ tab: k })} items={[{ key: 'run', label: 'اجرای گزارش' }, { key: 'saved', label: 'گزارش‌های ذخیره‌شده' }, { key: 'inbox', label: 'گزارش‌های دریافتی' }]} />
      {tab === 'run' && <RunTab />}
      {tab === 'saved' && <SavedTab />}
      {tab === 'inbox' && <InboxTab />}
    </>
  );
}

function ParamsForm({ def, value, onChange }: { def: ReportDef; value: Params; onChange: (p: Params) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <Field label="بازه"><Select value={value.range} onChange={(e) => onChange({ ...value, range: e.target.value })}>{Object.entries(RANGE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
      {value.range === 'custom' && (
        <>
          <Field label="از تاریخ"><DateInput value={value.from} onChange={(v) => onChange({ ...value, from: v })} /></Field>
          <Field label="تا تاریخ"><DateInput value={value.to} onChange={(v) => onChange({ ...value, to: v })} /></Field>
        </>
      )}
      {def.filters.map((f) => (
        <Field key={f.key} label={f.label}>
          {f.options ? (
            <Select value={value.filters[f.key] ?? ''} onChange={(e) => onChange({ ...value, filters: { ...value.filters, [f.key]: e.target.value } })}>
              <option value="">همه</option>
              {Object.entries(f.options).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          ) : (
            <Input value={value.filters[f.key] ?? ''} onChange={(e) => onChange({ ...value, filters: { ...value.filters, [f.key]: e.target.value } })} />
          )}
        </Field>
      ))}
    </div>
  );
}

function useDefs() {
  return useQuery({ queryKey: ['reports', 'defs'], queryFn: () => appApi<ReportDef[]>('/api/core/reports') });
}

function RunTab() {
  const defs = useDefs();
  const [sel, setSel] = useState('');
  const [params, setParams] = useState<Params>({ range: 'month_to_date', from: null, to: null, filters: {} });
  const [saving, setSaving] = useState(false);
  const def = defs.data?.find((d) => `${d.moduleId}/${d.key}` === sel);
  const run = useMutation({ mutationFn: () => appApi<Result>(`/api/core/reports/run/${def!.moduleId}/${def!.key}`, { method: 'POST', body: params }), onError: fail });
  const r = run.data;
  return (
    <PageState query={defs} isEmpty={defs.data?.length === 0} empty={<EmptyState icon={<FileBarChart className="size-8" />} title="گزارشی در دسترس نیست" description="ماژول‌های فعال گزارشی ارائه نمی‌کنند یا مجوز آن را ندارید." />}>
      <Card>
        <div className="space-y-4">
          <Field label="گزارش">
            <Select value={sel} onChange={(e) => (setSel(e.target.value), setParams((p) => ({ ...p, filters: {} })), run.reset())}>
              <option value="">انتخاب کنید</option>
              {defs.data?.map((d) => <option key={`${d.moduleId}/${d.key}`} value={`${d.moduleId}/${d.key}`}>{d.title.fa} — {d.moduleName.fa}</option>)}
            </Select>
          </Field>
          {def?.description && <p className="text-sm text-muted">{def.description.fa}</p>}
          {def && <ParamsForm def={def} value={params} onChange={setParams} />}
          {def && (
            <div className="flex flex-wrap gap-2 print:hidden">
              <Button loading={run.isPending} onClick={() => run.mutate()}>اجرا</Button>
              <Button variant="secondary" onClick={() => setSaving(true)}>ذخیره و زمان‌بندی</Button>
            </div>
          )}
        </div>
      </Card>
      {r && def && (
        <Card>
          <CardHeader
            title={<>{def.title.fa} <span className="text-sm font-normal text-muted">(<DayText value={r.period.from} /> تا <DayText value={r.period.to} />، {r.rows.length.toLocaleString('fa-IR')} ردیف)</span></>}
            actions={<span className="flex gap-2 print:hidden">
              <ExportMenu filename={def.key} title={def.title.fa} rows={r.rows} columns={r.columns.map((c) => ({ header: c.header, value: (x: Result['rows'][number]) => x[c.key], kind: c.kind === 'number' ? ('number' as const) : ('text' as const) }))} />
              <Button size="sm" variant="ghost" onClick={() => window.print()}><Printer className="size-4" /> چاپ / PDF</Button>
            </span>}
          />
          {r.rows.length === 0 ? <EmptyState title="داده‌ای در این بازه نیست" /> : (
            <Table>
              <thead><tr>{r.columns.map((c) => <Th key={c.key}>{c.header}</Th>)}</tr></thead>
              <tbody>{r.rows.map((row, i) => <tr key={i}>{r.columns.map((c) => <Td key={c.key} className={c.kind === 'number' ? 'tabular-nums' : ''}>{cell(row[c.key] ?? null, c.kind)}</Td>)}</tr>)}</tbody>
            </Table>
          )}
        </Card>
      )}
      {saving && def && <SaveDialog def={def} params={params} onClose={() => setSaving(false)} />}
    </PageState>
  );
}

function SaveDialog({ def, params, saved, onClose }: { def: ReportDef; params: Params; saved?: Saved; onClose: () => void }) {
  const qc = useQueryClient();
  const { me } = useAppSession();
  const dir = useQuery({ queryKey: ['core', 'directory'], queryFn: () => appApi<{ id: string; fullName: string }[]>('/api/core/directory') });
  const [name, setName] = useState(saved?.name ?? def.title.fa);
  const [schedule, setSchedule] = useState(saved?.schedule ?? 'none');
  const [recipients, setRecipients] = useState<string[]>(saved?.recipients ?? [me.user.id]);
  const [p, setP] = useState<Params>(saved?.params ?? params);
  const [pick, setPick] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => appApi(saved ? `/api/core/reports/saved/${saved.id}` : '/api/core/reports/saved', { method: saved ? 'PUT' : 'POST', body: { moduleId: def.moduleId, reportKey: def.key, name, params: p, schedule, recipients } }),
    onSuccess: () => (toast('گزارش ذخیره شد'), void qc.invalidateQueries({ queryKey: ['reports'] }), onClose()),
    onError: (e) => setError(errorMessage(e)),
  });
  const nameOf = (id: string) => dir.data?.find((u) => u.id === id)?.fullName ?? '—';
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={saved ? 'ویرایش گزارش ذخیره‌شده' : 'ذخیره گزارش'} footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (setError(null), save.mutate())}>ذخیره</Button></>}>
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <div className="space-y-4">
        <Field label="نام" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <ParamsForm def={def} value={p} onChange={setP} />
        <Field label="ارسال خودکار"><Select value={schedule} onChange={(e) => setSchedule(e.target.value)}>{Object.entries(SCHEDULE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <div>
          <div className="flex items-end gap-2">
            <Field label="گیرندگان" className="flex-1"><Select value={pick} onChange={(e) => setPick(e.target.value)}><option value="">افزودن…</option>{(dir.data ?? []).filter((u) => !recipients.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</Select></Field>
            <Button variant="secondary" disabled={!pick} onClick={() => (setRecipients((s) => [...s, pick]), setPick(''))}>افزودن</Button>
          </div>
          <ul className="mt-2 space-y-1 text-sm">{recipients.map((id) => <li key={id} className="flex items-center justify-between">{nameOf(id)}<Button size="sm" variant="ghost" aria-label={`حذف ${nameOf(id)}`} onClick={() => setRecipients((s) => s.filter((x) => x !== id))}><Trash2 className="size-4" /></Button></li>)}</ul>
          <p className="mt-1 text-xs text-muted">گیرنده‌ای که به این گزارش دسترسی ندارد چیزی دریافت نمی‌کند و ارسال برای او «ناموفق» ثبت می‌شود.</p>
        </div>
      </div>
    </Dialog>
  );
}

function SavedTab() {
  const qc = useQueryClient();
  const defs = useDefs();
  const q = useQuery({ queryKey: ['reports', 'saved'], queryFn: () => appApi<Saved[]>('/api/core/reports/saved') });
  const [editing, setEditing] = useState<Saved | null>(null);
  const [removing, setRemoving] = useState<Saved | null>(null);
  const send = useMutation({ mutationFn: (id: string) => appApi<{ delivered: number }>(`/api/core/reports/saved/${id}/send`, { method: 'POST' }), onSuccess: (r) => (toast(`برای ${r.delivered.toLocaleString('fa-IR')} گیرنده ارسال شد`), void qc.invalidateQueries({ queryKey: ['reports'] })), onError: fail });
  const remove = useMutation({ mutationFn: (id: string) => appApi(`/api/core/reports/saved/${id}`, { method: 'DELETE' }), onSuccess: () => (setRemoving(null), void qc.invalidateQueries({ queryKey: ['reports'] })), onError: fail });
  const defOf = (s: Saved) => defs.data?.find((d) => d.moduleId === s.module_id && d.key === s.report_key);
  return (
    <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState title="گزارش ذخیره‌شده‌ای ندارید" description="در «اجرای گزارش» یک گزارش را ذخیره کنید." />}>
      <Table>
        <thead><tr><Th>نام</Th><Th>بازه</Th><Th>ارسال خودکار</Th><Th>آخرین / بعدی</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
        <tbody>
          {q.data?.map((s) => (
            <tr key={s.id}>
              <Td>{s.name}<div className="text-xs text-muted">{defOf(s)?.title.fa ?? s.report_key}{!s.mine && ' · شما گیرنده هستید'}</div></Td>
              <Td>{RANGE[s.params.range]}</Td>
              <Td>{SCHEDULE[s.schedule]}{s.recipients.length > 0 && <div className="text-xs text-muted">{s.recipients.length.toLocaleString('fa-IR')} گیرنده</div>}</Td>
              <Td className="text-xs">{s.last_run_at ? <DateText value={s.last_run_at} /> : '—'}<div>{s.next_run_at ? <DateText value={s.next_run_at} /> : ''}</div></Td>
              <Td className="whitespace-nowrap">
                {s.mine && <Button size="sm" loading={send.isPending && send.variables === s.id} disabled={!s.recipients.length} onClick={() => send.mutate(s.id)}>ارسال اکنون</Button>}
                {s.mine && defOf(s) && <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>ویرایش</Button>}
                {s.mine && <Button size="sm" variant="ghost" onClick={() => setRemoving(s)}>حذف</Button>}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {editing && defOf(editing) && <SaveDialog def={defOf(editing)!} params={editing.params} saved={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title="حذف گزارش ذخیره‌شده" description="ارسال خودکار متوقف و سابقه ارسال‌های آن حذف می‌شود." confirmLabel="حذف" loading={remove.isPending} onConfirm={() => removing && remove.mutate(removing.id)} />
    </PageState>
  );
}

function InboxTab() {
  const q = useQuery({ queryKey: ['reports', 'inbox'], queryFn: () => appApi<Run[]>('/api/core/reports/inbox') });
  const download = async (id: string) => {
    try {
      const r = await appApi<{ url: string }>(`/api/core/reports/inbox/${id}/download`);
      window.location.assign(r.url);
    } catch (e) {
      fail(e);
    }
  };
  return (
    <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState title="گزارشی برای شما ارسال نشده است" />}>
      <Table>
        <thead><tr><Th>گزارش</Th><Th>بازه</Th><Th>زمان</Th><Th>نتیجه</Th><Th><span className="sr-only">دانلود</span></Th></tr></thead>
        <tbody>
          {q.data?.map((r) => (
            <tr key={r.id}>
              <Td>{r.name}</Td>
              <Td className="text-xs">{r.period_from ? <><DayText value={r.period_from} /> تا <DayText value={r.period_to!} /></> : '—'}</Td>
              <Td className="text-xs"><DateText value={r.created_at} /></Td>
              <Td>{r.status === 'ok' ? <Badge tone="success">{r.row_count.toLocaleString('fa-IR')} ردیف</Badge> : <><Badge tone="danger">ناموفق</Badge><div className="text-xs text-muted">{r.error}</div></>}</Td>
              <Td>{r.has_file && <Button size="sm" variant="ghost" aria-label={`دانلود ${r.name}`} onClick={() => void download(r.id)}><Download className="size-4" /> Excel</Button>}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </PageState>
  );
}
