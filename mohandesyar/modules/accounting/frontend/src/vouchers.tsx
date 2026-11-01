import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, DateInput, DayText, EmptyState, ExportMenu, Field, Input, MoneyInput, PageHeader, PageState, Select, Table, Td, Textarea, Th, toast } from '@mohandesyar/ui';
import { useDirectory } from '@mohandesyar/module-sdk/web';
import { todayIso } from '@mohandesyar/persian';
import { AccountSelect, BASE, DetailSelect, ErrorBanner, Nav, SOURCE, VOUCHER_KIND, VOUCHER_STATUS, onFail, rial, useAccounts, useApi, useCanDo, useRange, useRefresh } from './common.js';

interface VoucherRow { id: string; number: number | null; date: string; description: string; kind: string; status: string; source: string; debit: string; credit: string; created_by: string | null; posted_by: string | null }

export function VouchersPage() {
  const a = useApi();
  const can = useCanDo();
  const nav = useNavigate();
  const r = useRange();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const list = useQuery({
    queryKey: ['accounting', 'vouchers', r.from, r.to, status, q],
    enabled: r.ok,
    queryFn: () => a.get<VoucherRow[]>(`/vouchers?from=${r.from}&to=${r.to}${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  });
  return (
    <>
      <PageHeader title="حسابداری" actions={can.voucher && <Button onClick={() => nav(`${BASE}/vouchers/new`)}><Plus className="size-4" /> سند جدید</Button>} />
      <Nav />
      <div className="flex flex-wrap items-end gap-3">
        {r.picker}
        <div className="mb-4"><Field label="وضعیت"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">همه</option>{Object.entries(VOUCHER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field></div>
        <div className="mb-4"><Field label="جست‌وجو (شرح یا شماره)"><Input value={q} onChange={(e) => setQ(e.target.value)} /></Field></div>
      </div>
      <PageState query={list} isEmpty={list.data?.length === 0} empty={<EmptyState icon={<FileText className="size-8" />} title="سندی در این بازه نیست" action={can.voucher ? <Button onClick={() => nav(`${BASE}/vouchers/new`)}>ثبت اولین سند</Button> : undefined} />}>
        <ExportMenu filename="vouchers" title="فهرست اسناد حسابداری" rows={list.data} columns={[
          { header: 'شماره', value: (v) => v.number ?? '' , kind: 'number' },
          { header: 'تاریخ', value: (v) => v.date },
          { header: 'شرح', value: (v) => v.description },
          { header: 'منبع', value: (v) => SOURCE[v.source] ?? v.source },
          { header: 'وضعیت', value: (v) => VOUCHER_STATUS[v.status]!.label },
          { header: 'بدهکار', value: (v) => v.debit, kind: 'number' },
          { header: 'بستانکار', value: (v) => v.credit, kind: 'number' },
        ]} />
        <Table>
          <thead><tr><Th>شماره</Th><Th>تاریخ</Th><Th>شرح</Th><Th>نوع / منبع</Th><Th>بدهکار</Th><Th>بستانکار</Th><Th>وضعیت</Th></tr></thead>
          <tbody>
            {(list.data ?? []).map((v) => (
              <tr key={v.id}>
                <Td><Link to={`${BASE}/vouchers/${v.id}`} className="font-medium text-primary underline-offset-4 hover:underline">{v.number ? v.number.toLocaleString('fa-IR') : 'پیش‌نویس'}</Link></Td>
                <Td className="whitespace-nowrap"><DayText value={v.date} /></Td>
                <Td className="max-w-md">{v.description || '—'}</Td>
                <Td className="whitespace-nowrap">{VOUCHER_KIND[v.kind]} · {SOURCE[v.source] ?? v.source}</Td>
                <Td className="tabular-nums">{rial(v.debit)}</Td><Td className="tabular-nums">{rial(v.credit)}</Td>
                <Td><Badge tone={VOUCHER_STATUS[v.status]!.tone}>{VOUCHER_STATUS[v.status]!.label}</Badge>{v.debit !== v.credit && <Badge tone="danger">نامتوازن</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
    </>
  );
}

interface Line { key: string; accountId: string; detailId: string; description: string; debit: string; credit: string }
interface VoucherDetail {
  voucher: VoucherRow & { reverses_id: string | null; source_ref: string | null; posted_at: string | null };
  lines: { id: string; line_no: number; account_id: string; account_code: string; account_name: string; detail_id: string | null; detail_name: string | null; description: string; debit: string; credit: string }[];
}

let seq = 0;
const blank = (): Line => ({ key: `n${++seq}`, accountId: '', detailId: '', description: '', debit: '', credit: '' });

export function VoucherPage() {
  const { id = 'new' } = useParams();
  const a = useApi();
  const isNew = id === 'new';
  const q = useQuery({ queryKey: ['accounting', 'voucher', id], enabled: !isNew, queryFn: () => a.get<VoucherDetail>(`/vouchers/${id}`) });
  if (isNew) return <VoucherEditor />;
  return <PageState query={q}>{q.data && (q.data.voucher.status === 'draft' ? <VoucherEditor existing={q.data} key={q.data.voucher.id} /> : <VoucherView data={q.data} />)}</PageState>;
}

function VoucherEditor({ existing }: { existing?: VoucherDetail }) {
  const a = useApi();
  const nav = useNavigate();
  const refresh = useRefresh();
  const can = useCanDo();
  const accounts = useAccounts();
  const [date, setDate] = useState<string | null>(existing?.voucher.date ?? todayIso());
  const [description, setDescription] = useState(existing?.voucher.description ?? '');
  const [lines, setLines] = useState<Line[]>(
    existing ? existing.lines.map((l) => ({ key: l.id, accountId: l.account_id, detailId: l.detail_id ?? '', description: l.description, debit: l.debit === '0' ? '' : l.debit, credit: l.credit === '0' ? '' : l.credit })) : [blank(), blank()],
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const sum = (f: 'debit' | 'credit') => lines.reduce((s, l) => s + BigInt(l[f] || '0'), 0n);
  const diff = sum('debit') - sum('credit');
  const body = () => ({ date, description, lines: lines.filter((l) => l.accountId || l.debit || l.credit).map((l) => ({ accountId: l.accountId, detailId: l.detailId || null, description: l.description, debit: l.debit || '0', credit: l.credit || '0' })) });
  const save = useMutation({
    mutationFn: () => (existing ? a.put<{ id: string }>(`/vouchers/${existing.voucher.id}`, body()) : a.post<{ id: string }>('/vouchers', body())),
    onSuccess: (r) => (toast('سند پیش‌نویس ذخیره شد'), refresh(), existing || nav(`${BASE}/vouchers/${r.id}`, { replace: true })),
  });
  const post = useMutation({ mutationFn: () => a.post<{ number: number }>(`/vouchers/${existing!.voucher.id}/post`), onSuccess: (r) => (toast(`سند با شماره ${r.number.toLocaleString('fa-IR')} قطعی شد`), refresh()), onError: onFail });
  const remove = useMutation({ mutationFn: () => a.post(`/vouchers/${existing!.voucher.id}/delete`), onSuccess: () => (toast('پیش‌نویس حذف شد'), refresh(), nav(BASE)), onError: onFail });
  const needsDetail = (accountId: string) => accounts.data?.find((x) => x.id === accountId)?.needs_detail;
  return (
    <>
      <PageHeader title={existing ? 'سند پیش‌نویس' : 'سند حسابداری جدید'} actions={<Link to={BASE} className="text-sm text-primary underline">بازگشت به اسناد</Link>} />
      <ErrorBanner error={save.error} />
      {existing && existing.voucher.source !== 'manual' && <p className="mb-3 text-sm text-muted">این پیش‌نویس از «{SOURCE[existing.voucher.source]}» آمده است؛ ردیف‌ها را بازبینی و تکمیل کنید.</p>}
      <Card>
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <Field label="تاریخ سند" required error={date === null ? 'تاریخ معتبر نیست' : undefined}><DateInput value={date ?? undefined} onChange={setDate} /></Field>
          <Field label="شرح سند" className="sm:col-span-2"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
        <div className="space-y-3">
          {lines.map((l, i) => (
            <div key={l.key} className="grid items-end gap-2 rounded-md border border-border p-2 md:grid-cols-12">
              <AccountSelect className="md:col-span-3" label={`حساب ردیف ${(i + 1).toLocaleString('fa-IR')}`} value={l.accountId} onChange={(v) => set(l.key, { accountId: v })} />
              <DetailSelect className="md:col-span-3" label={needsDetail(l.accountId) ? 'تفصیلی (الزامی)' : 'تفصیلی'} allowEmpty="—" value={l.detailId} onChange={(v) => set(l.key, { detailId: v })} />
              <Field label="شرح ردیف" className="md:col-span-2"><Input value={l.description} onChange={(e) => set(l.key, { description: e.target.value })} /></Field>
              <Field label="بدهکار" className="md:col-span-2"><MoneyInput value={l.debit} onChange={(v) => set(l.key, { debit: v, credit: v ? '' : l.credit })} /></Field>
              <Field label="بستانکار" className="md:col-span-1"><MoneyInput value={l.credit} onChange={(v) => set(l.key, { credit: v, debit: v ? '' : l.debit })} /></Field>
              <Button variant="ghost" size="sm" aria-label="حذف ردیف" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} disabled={lines.length <= 2}><Trash2 className="size-4" /></Button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <Button variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, blank()])}><Plus className="size-4" /> ردیف</Button>
          <span className="text-sm">جمع بدهکار: <b className="tabular-nums">{rial(sum('debit'))}</b></span>
          <span className="text-sm">جمع بستانکار: <b className="tabular-nums">{rial(sum('credit'))}</b></span>
          {diff !== 0n ? <Badge tone="danger">اختلاف {rial(diff < 0n ? -diff : diff)}</Badge> : <Badge tone="success">تراز</Badge>}
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          {can.voucher && <Button loading={save.isPending} disabled={!date} onClick={() => save.mutate()}>ذخیره پیش‌نویس</Button>}
          {existing && can.post && <Button variant="secondary" loading={post.isPending} disabled={diff !== 0n} onClick={() => post.mutate()}>قطعی کردن سند</Button>}
          {existing && can.voucher && <Button variant="danger" onClick={() => setConfirmDelete(true)}>حذف پیش‌نویس</Button>}
        </div>
      </Card>
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title="حذف سند پیش‌نویس" description="این پیش‌نویس حذف می‌شود و قابل بازگشت نیست." confirmLabel="حذف" onConfirm={() => remove.mutate()} />
    </>
  );
}

function VoucherView({ data }: { data: VoucherDetail }) {
  const a = useApi();
  const refresh = useRefresh();
  const can = useCanDo();
  const dir = useDirectory();
  const v = data.voucher;
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reason, setReason] = useState('');
  const reverse = useMutation({ mutationFn: () => a.post<{ id: string; number: number }>(`/vouchers/${v.id}/reverse`, { date: todayIso(), reason }), onSuccess: (r) => (toast(`سند برگشت ${r.number.toLocaleString('fa-IR')} صادر شد`), refresh(), setReverseOpen(false)), onError: onFail });
  const reversible = v.status === 'posted' && ['manual', 'procurement', 'finance'].includes(v.source);
  return (
    <>
      <PageHeader title={`سند حسابداری شماره ${v.number?.toLocaleString('fa-IR')}`} actions={<div className="flex gap-2 print:hidden"><Button variant="secondary" onClick={() => window.print()}>چاپ</Button><Link to={BASE} className="self-center text-sm text-primary underline">بازگشت</Link></div>} />
      <Card>
        <div className="mb-4 flex flex-wrap gap-4 text-sm">
          <span>تاریخ: <DayText value={v.date} /></span>
          <span>نوع: {VOUCHER_KIND[v.kind]}</span>
          <span>منبع: {SOURCE[v.source] ?? v.source}</span>
          <Badge tone={VOUCHER_STATUS[v.status]!.tone}>{VOUCHER_STATUS[v.status]!.label}</Badge>
          {v.created_by && <span className="text-muted">ثبت: {dir.name(v.created_by)}</span>}
          {v.posted_by && <span className="text-muted">قطعی: {dir.name(v.posted_by)}</span>}
          {v.reverses_id && <Link to={`${BASE}/vouchers/${v.reverses_id}`} className="text-primary underline">سند اصلی</Link>}
        </div>
        {v.description && <p className="mb-4">{v.description}</p>}
        <Table>
          <thead><tr><Th>ردیف</Th><Th>کد</Th><Th>حساب</Th><Th>تفصیلی</Th><Th>شرح</Th><Th>بدهکار</Th><Th>بستانکار</Th></tr></thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.id}>
                <Td>{l.line_no.toLocaleString('fa-IR')}</Td><Td className="tabular-nums">{l.account_code}</Td><Td>{l.account_name}</Td><Td>{l.detail_name ?? '—'}</Td><Td>{l.description || '—'}</Td>
                <Td className="tabular-nums">{l.debit === '0' ? '' : rial(l.debit)}</Td><Td className="tabular-nums">{l.credit === '0' ? '' : rial(l.credit)}</Td>
              </tr>
            ))}
            <tr className="font-bold"><Td colSpan={5}>جمع</Td><Td className="tabular-nums">{rial(v.debit)}</Td><Td className="tabular-nums">{rial(v.credit)}</Td></tr>
          </tbody>
        </Table>
        {reversible && can.post && (
          <div className="mt-4 print:hidden">
            {reverseOpen ? (
              <div className="flex flex-wrap items-end gap-2">
                <Field label="دلیل برگشت"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                <Button variant="danger" loading={reverse.isPending} onClick={() => reverse.mutate()}>صدور سند برگشت (امروز)</Button>
                <Button variant="ghost" onClick={() => setReverseOpen(false)}>انصراف</Button>
              </div>
            ) : <Button variant="secondary" onClick={() => setReverseOpen(true)}>برگشت سند</Button>}
          </div>
        )}
        {v.status === 'posted' && !reversible && <p className="mt-4 text-sm text-muted print:hidden">این سند خودکار است؛ برای اصلاح، فاکتور یا سند خزانه/چک/دارایی مربوط را ابطال کنید.</p>}
      </Card>
    </>
  );
}
