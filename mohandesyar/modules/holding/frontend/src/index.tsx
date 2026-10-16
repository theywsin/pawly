import { useState } from 'react';
import type { RouteObject } from 'react-router';
import { Navigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Trash2 } from 'lucide-react';
import { Alert, Button, Card, CardHeader, Checkbox, DateInput, EmptyState, ExportMenu, Field, Input, PageHeader, PageState, Select, Table, Tabs, Td, Th, toast } from '@mohandesyar/ui';
import { ApiError, useCan, useModuleApi } from '@mohandesyar/module-sdk/web';
import { todayIso } from '@mohandesyar/persian';

const useApi = () => useModuleApi('holding');
interface Provider { key: string; moduleId: string; title: string; unit: string }
interface Company { id: string; name: string }
interface Compare { columns: Provider[]; rows: { companyId: string; name: string; values: Record<string, number | null> }[]; totals: Record<string, { value: number | null; method: 'sum' | 'average' | 'none' }> }
interface Trend { provider: Provider; months: string[]; series: { companyId: string; name: string; points: (number | null)[] }[] }
interface View { id: string; name: string; providers: string[] }

const UNIT: Record<string, string> = { count: 'تعداد', rial: 'ریال', percent: 'درصد', rate: 'نرخ', days: 'روز', hours: 'ساعت' };
const fmt = (v: number | null | undefined, unit: string) => (v === null || v === undefined ? '—' : unit === 'percent' ? `${v.toLocaleString('fa-IR')}٪` : v.toLocaleString('fa-IR'));
const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : 'انجام نشد', 'danger');

export const routes: RouteObject[] = [
  { index: true, element: <Navigate to="compare" replace /> },
  { path: 'compare', element: <HoldingPage /> },
];

function HoldingPage() {
  const a = useApi();
  const qc = useQueryClient();
  const canSave = useCan('holding.manage');
  const companies = useQuery({ queryKey: ['holding', 'companies'], queryFn: () => a.get<Company[]>('/companies') });
  const providers = useQuery({ queryKey: ['holding', 'providers'], queryFn: () => a.get<Provider[]>('/providers') });
  const views = useQuery({ queryKey: ['holding', 'views'], queryFn: () => a.get<View[]>('/views') });
  const [tab, setTab] = useState('compare');
  const [selected, setSelected] = useState<string[]>([]);
  const [from, setFrom] = useState<string | null>(`${todayIso().slice(0, 4)}-01-01`);
  const [to, setTo] = useState<string | null>(todayIso());
  const [trendKey, setTrendKey] = useState('');
  const [months, setMonths] = useState('6');
  const [viewName, setViewName] = useState('');
  const compare = useMutation({ mutationFn: () => a.post<Compare>('/compare', { providers: selected, from, to }), onError: fail });
  const trend = useMutation({ mutationFn: () => a.post<Trend>('/trend', { provider: trendKey, to, months: Number(months) }), onError: fail });
  const save = useMutation({ mutationFn: () => a.post('/views', { name: viewName, providers: selected }), onSuccess: () => (toast('نما ذخیره شد'), setViewName(''), void qc.invalidateQueries({ queryKey: ['holding', 'views'] })), onError: fail });
  const remove = useMutation({ mutationFn: (id: string) => a.del(`/views/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['holding', 'views'] }), onError: fail });
  const byModule = Object.entries((providers.data ?? []).reduce<Record<string, Provider[]>>((m, p) => ((m[p.moduleId] ??= []).push(p), m), {}));
  const c = compare.data;
  return (
    <>
      <PageHeader title="گزارش‌های تجمیعی هلدینگ" description="مقادیر هر بار مستقیماً از ماژول‌های فعال هر شرکت محاسبه می‌شوند و فقط شرکت‌هایی نمایش داده می‌شوند که در آن‌ها مجوز «مشاهده گزارش‌های تجمیعی» دارید. «—» یعنی داده‌ای ثبت نشده، نه صفر." />
      <PageState query={companies} isEmpty={companies.data?.length === 0} empty={<EmptyState icon={<Building2 className="size-8" />} title="شرکتی در دسترس نیست" />}>
        <p className="mb-4 text-sm">شرکت‌ها: {companies.data?.map((x) => x.name).join('، ')}</p>
        <Tabs label="نوع گزارش" value={tab} onChange={setTab} items={[{ key: 'compare', label: 'مقایسه شرکت‌ها' }, { key: 'trend', label: 'روند ماهانه' }]} />
        <div className="mb-6 flex flex-wrap gap-4">
          {tab === 'compare' && <Field label="از تاریخ"><DateInput value={from} onChange={setFrom} /></Field>}
          <Field label="تا تاریخ"><DateInput value={to} onChange={setTo} /></Field>
          {tab === 'trend' && (
            <>
              <Field label="شاخص"><Select value={trendKey} onChange={(e) => setTrendKey(e.target.value)}><option value="">انتخاب کنید</option>{(providers.data ?? []).map((p) => <option key={p.key} value={p.key}>{p.title}</option>)}</Select></Field>
              <Field label="تعداد ماه"><Select value={months} onChange={(e) => setMonths(e.target.value)}>{[3, 6, 12].map((n) => <option key={n} value={n}>{n.toLocaleString('fa-IR')}</option>)}</Select></Field>
            </>
          )}
        </div>
        {tab === 'compare' ? (
          <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
            <Card>
              <CardHeader title="شاخص‌ها" />
              {(views.data ?? []).length > 0 && (
                <div className="mb-3 space-y-1 text-sm">
                  {views.data!.map((v) => (
                    <div key={v.id} className="flex items-center justify-between">
                      <button type="button" className="text-primary underline" onClick={() => setSelected(v.providers)}>{v.name}</button>
                      {canSave && <Button size="sm" variant="ghost" aria-label={`حذف نمای ${v.name}`} onClick={() => remove.mutate(v.id)}><Trash2 className="size-4" /></Button>}
                    </div>
                  ))}
                </div>
              )}
              <PageState query={providers} isEmpty={providers.data?.length === 0} empty={<p className="text-sm text-muted">ماژول فعالی شاخص ارائه نمی‌کند.</p>}>
                <div className="space-y-3">
                  {byModule.map(([m, list]) => (
                    <fieldset key={m}>
                      <legend className="mb-1 text-xs text-muted" dir="ltr">{m}</legend>
                      {list.map((p) => <div key={p.key}><Checkbox label={p.title} checked={selected.includes(p.key)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, p.key] : s.filter((x) => x !== p.key)))} /></div>)}
                    </fieldset>
                  ))}
                </div>
              </PageState>
              <Button className="mt-4 w-full" disabled={!selected.length || !from || !to} loading={compare.isPending} onClick={() => compare.mutate()}>مقایسه</Button>
              {canSave && selected.length > 0 && (
                <div className="mt-3 flex items-end gap-2">
                  <Field label="ذخیره به‌عنوان نما" className="flex-1"><Input value={viewName} onChange={(e) => setViewName(e.target.value)} /></Field>
                  <Button variant="secondary" disabled={viewName.trim().length < 2} loading={save.isPending} onClick={() => save.mutate()}>ذخیره</Button>
                </div>
              )}
            </Card>
            <div>
              {!c ? <Alert tone="info">شاخص‌ها را انتخاب و «مقایسه» را بزنید.</Alert> : (
                <Card>
                  <CardHeader title="مقایسه شرکت‌ها" actions={<ExportMenu filename="holding-compare" title="مقایسه شرکت‌ها" rows={c.rows} columns={[{ header: 'شرکت', value: (r) => r.name }, ...c.columns.map((p) => ({ header: p.title, value: (r: Compare['rows'][number]) => r.values[p.key], kind: 'number' as const }))]} />} />
                  <Table>
                    <thead><tr><Th>شرکت</Th>{c.columns.map((p) => <Th key={p.key}>{p.title}<div className="text-xs font-normal text-muted">{UNIT[p.unit] ?? p.unit}</div></Th>)}</tr></thead>
                    <tbody>
                      {c.rows.map((r) => <tr key={r.companyId}><Td>{r.name}</Td>{c.columns.map((p) => <Td key={p.key} className="tabular-nums">{fmt(r.values[p.key], p.unit)}</Td>)}</tr>)}
                      <tr className="font-semibold"><Td>کل هلدینگ</Td>{c.columns.map((p) => <Td key={p.key} className="tabular-nums">{fmt(c.totals[p.key]?.value, p.unit)}<div className="text-xs font-normal text-muted">{c.totals[p.key]?.method === 'sum' ? 'جمع' : c.totals[p.key]?.method === 'average' ? 'میانگین' : ''}</div></Td>)}</tr>
                    </tbody>
                  </Table>
                </Card>
              )}
            </div>
          </div>
        ) : (
          <>
            <Button disabled={!trendKey || !to} loading={trend.isPending} onClick={() => trend.mutate()}>نمایش روند</Button>
            {trend.data && (
              <Card>
                <CardHeader title={`روند ${trend.data.provider.title}`} actions={<ExportMenu filename="holding-trend" title="روند ماهانه" rows={trend.data.series} columns={[{ header: 'شرکت', value: (s) => s.name }, ...trend.data.months.map((m, i) => ({ header: m, value: (s: Trend['series'][number]) => s.points[i], kind: 'number' as const }))]} />} />
                <Table>
                  <thead><tr><Th>شرکت</Th>{trend.data.months.map((m) => <Th key={m}>{m.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!)}</Th>)}</tr></thead>
                  <tbody>{trend.data.series.map((s) => <tr key={s.companyId}><Td>{s.name}</Td>{s.points.map((v, i) => <Td key={i} className="tabular-nums">{fmt(v, trend.data!.provider.unit)}</Td>)}</tr>)}</tbody>
                </Table>
              </Card>
            )}
          </>
        )}
      </PageState>
    </>
  );
}
