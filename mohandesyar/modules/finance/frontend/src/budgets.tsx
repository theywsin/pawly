import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, PieChart } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, DateText, Dialog, EmptyState, ExportMenu, Field, Input, MoneyInput, PageHeader, PageState, ProgressBar, Select, Stat, Table, Td, Th, toast } from '@mohandesyar/ui';
import { useCan, useDirectory } from '@mohandesyar/module-sdk/web';
import { BASE, CategorySelect, Nav, ProjectSelect, rial, useApi, useCategories, useServerErrors } from './common.js';

const pct = (a: string, b: string) => (BigInt(b) > 0n ? Number((BigInt(a) * 10000n) / BigInt(b)) / 100 : 0);

export function BudgetsPage() {
  const a = useApi();
  const canManage = useCan('finance.budget.manage');
  const [pick, setPick] = useState('');
  const q = useQuery({ queryKey: ['finance', 'budgets'], queryFn: () => a.get<{ project_id: string; bac: string | null; actual: string; committed: string; project: { code: string; title: string } | null }[]>('/budgets') });
  return (
    <>
      <PageHeader title="بودجه و هزینه پروژه‌ها" />
      <Nav />
      {canManage && (
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <ProjectSelect value={pick} onChange={setPick} />
          {pick && <Link className="text-sm text-primary underline" to={`${BASE}/budgets/${pick}`}>تهیه یا مشاهده بودجه این پروژه</Link>}
        </div>
      )}
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<PieChart className="size-8" />} title="هنوز بودجه یا هزینه‌ای برای پروژه‌ای ثبت نشده است" />}>
        <Table>
          <thead><tr><Th>پروژه</Th><Th>بودجه مصوب (BAC)</Th><Th>هزینه واقعی</Th><Th>تعهدات باز</Th><Th>مصرف بودجه</Th></tr></thead>
          <tbody>
            {q.data?.map((p) => (
              <tr key={p.project_id}>
                <Td><Link className="text-primary underline-offset-4 hover:underline" to={`${BASE}/budgets/${p.project_id}`}>{p.project ? `${p.project.code} — ${p.project.title}` : 'پروژه'}</Link></Td>
                <Td className="tabular-nums">{p.bac ? rial(p.bac) : <span className="text-muted">تصویب نشده</span>}</Td>
                <Td className="tabular-nums">{rial(p.actual)}</Td><Td className="tabular-nums">{rial(p.committed)}</Td>
                <Td className="w-48">{p.bac ? <ProgressBar value={pct((BigInt(p.actual) + BigInt(p.committed)).toString(), p.bac)} label="مصرف بودجه" tone={BigInt(p.actual) + BigInt(p.committed) > BigInt(p.bac) ? 'danger' : 'primary'} /> : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
    </>
  );
}

interface Detail {
  project: { code: string; title: string } | null;
  progress: { planned: number | null; actual: number | null } | null;
  budgets: { id: string; version: number; kind: string; status: string; note: string; created_by: string; created_at: string; approved_by: string | null; approved_at: string | null; total: string; lines: { category_id: string; amount: string; note: string }[] }[];
  summary: { bac: string; actual: string; committed: string; available: string };
  eac: { ev: string | null; cpi: number | null; eac: string | null; vac: string | null; formula: string; reason: string | null; method: string; methodVersion: number } | null;
  byCategory: { categoryId: string; name: string; budget: string; actual: string; committed: string; remaining: string }[];
  commitments: { id: string; amount: string; consumed: string; description: string; source: string; status: string }[];
  etc: { amount: string; note: string; created_at: string } | null;
  notes: { id: string; note: string; created_at: string; created_by: string }[];
}

export function ProjectBudgetPage() {
  const { projectId } = useParams();
  const a = useApi();
  const qc = useQueryClient();
  const dir = useDirectory();
  const canManage = useCan('finance.budget.manage');
  const canApprove = useCan('finance.budget.approve');
  const [drafting, setDrafting] = useState(false);
  const [commit, setCommit] = useState(false);
  const [etc, setEtc] = useState(false);
  const [note, setNote] = useState('');
  const q = useQuery({ queryKey: ['finance', 'budget', projectId], queryFn: () => a.get<Detail>(`/budgets/${projectId}`) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['finance'] });
  const approve = useMutation({ mutationFn: (id: string) => a.post(`/budget-versions/${id}/approve`), onSuccess: () => (toast('بودجه تصویب شد'), refresh()), onError: (e) => toast(e instanceof Error ? e.message : 'انجام نشد', 'danger') });
  const close = useMutation({ mutationFn: (id: string) => a.post(`/commitments/${id}/close`), onSuccess: () => (toast('تعهد بسته شد'), refresh()) });
  const addNote = useMutation({ mutationFn: () => a.post(`/budgets/${projectId}/notes`, { note }), onSuccess: () => (toast('ثبت شد'), setNote(''), refresh()) });
  const d = q.data;
  const draft = d?.budgets.find((b) => b.status === 'draft');
  const s = d?.summary;
  return (
    <>
      <Link to={`${BASE}/budgets`} className="mb-3 inline-flex items-center gap-1 text-sm text-primary print:hidden"><ArrowRight className="size-4" /> بودجه پروژه‌ها</Link>
      <PageState query={q}>
        {d && s && (
          <>
            <PageHeader title={d.project ? `بودجه ${d.project.code} — ${d.project.title}` : 'بودجه پروژه'} actions={
              <>
                {canManage && <Button variant="secondary" onClick={() => setCommit(true)}>ثبت تعهد</Button>}
                {canManage && d.eac?.method === 'manual_etc' && <Button variant="secondary" onClick={() => setEtc(true)}>برآورد باقی‌مانده (ETC)</Button>}
                {canManage && <Button onClick={() => setDrafting(true)}>{draft ? 'ویرایش پیش‌نویس بودجه' : d.budgets.length ? 'نسخه اصلاحی بودجه' : 'تهیه بودجه اولیه'}</Button>}
              </>
            } />
            <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="بودجه مصوب (BAC)">{rial(s.bac)}</Stat>
              <Stat label="هزینه واقعی (AC)">{rial(s.actual)}</Stat>
              <Stat label="تعهدات باز">{rial(s.committed)}</Stat>
              <Stat label="مانده قابل تعهد">{<span className={BigInt(s.available) < 0n ? 'text-danger' : ''}>{rial(s.available)}</span>}</Stat>
            </div>
            <Card className="mb-6">
              <CardHeader title="برآورد هزینه در پایان (EAC)" description={d.eac ? `روش: ${d.eac.formula} (نسخه ${d.eac.methodVersion.toLocaleString('fa-IR')})` : undefined} />
              <div className="p-5 text-sm">
                {!d.eac ? <p className="text-muted">برای محاسبه، ابتدا بودجه باید تصویب شود.</p> : d.eac.reason ? <Alert tone="info">{d.eac.reason}</Alert> : (
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Stat label="پیشرفت فیزیکی واقعی">{d.progress?.actual !== null && d.progress?.actual !== undefined ? `${d.progress.actual.toLocaleString('fa-IR', { maximumFractionDigits: 1 })}٪` : '—'}</Stat>
                    <Stat label="ارزش کسب‌شده (EV)">{rial(d.eac.ev)}</Stat>
                    <Stat label="CPI">{d.eac.cpi?.toLocaleString('fa-IR', { maximumFractionDigits: 3 }) ?? '—'}</Stat>
                    <Stat label="EAC / انحراف (VAC)">{rial(d.eac.eac)} <span className={`block text-sm ${BigInt(d.eac.vac ?? '0') < 0n ? 'text-danger' : 'text-success'}`}>{rial(d.eac.vac)}</span></Stat>
                  </div>
                )}
              </div>
            </Card>
            <Card className="mb-6">
              <CardHeader title="به تفکیک سرفصل" actions={<ExportMenu filename="project-budget" title="بودجه و هزینه پروژه" rows={d.byCategory} columns={[
                { header: 'سرفصل', value: (r) => r.name }, { header: 'بودجه', value: (r) => r.budget, kind: 'number' }, { header: 'واقعی', value: (r) => r.actual, kind: 'number' },
                { header: 'تعهد باز', value: (r) => r.committed, kind: 'number' }, { header: 'مانده', value: (r) => r.remaining, kind: 'number' },
              ]} />} />
              {d.byCategory.length === 0 ? <p className="p-5 text-sm text-muted">داده کافی وجود ندارد.</p> : (
                <Table>
                  <thead><tr><Th>سرفصل</Th><Th>بودجه</Th><Th>واقعی</Th><Th>تعهد باز</Th><Th>مانده</Th></tr></thead>
                  <tbody>{d.byCategory.map((c) => <tr key={c.categoryId}><Td>{c.name}</Td><Td className="tabular-nums">{rial(c.budget)}</Td><Td className="tabular-nums">{rial(c.actual)}</Td><Td className="tabular-nums">{rial(c.committed)}</Td><Td className={`tabular-nums ${BigInt(c.remaining) < 0n ? 'text-danger' : ''}`}>{rial(c.remaining)}</Td></tr>)}</tbody>
                </Table>
              )}
            </Card>
            <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
              <Card>
                <CardHeader title="نسخه‌های بودجه" />
                <ul className="space-y-2 p-5 text-sm">
                  {d.budgets.length === 0 && <li className="text-muted">بودجه‌ای تهیه نشده است.</li>}
                  {d.budgets.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center gap-2">
                      نسخه {b.version.toLocaleString('fa-IR')} ({b.kind === 'initial' ? 'اولیه' : 'اصلاحی'}) — {rial(b.total)} ریال
                      {b.status === 'approved' ? <Badge tone="success">مصوب · {dir.name(b.approved_by)}</Badge> : <Badge tone="warning">پیش‌نویس · {dir.name(b.created_by)}</Badge>}
                      {b.status === 'draft' && canApprove && <Button size="sm" loading={approve.isPending} onClick={() => approve.mutate(b.id)}>تصویب</Button>}
                      {b.note && <span className="w-full text-muted">{b.note}</span>}
                    </li>
                  ))}
                </ul>
              </Card>
              <Card>
                <CardHeader title="تعهدات" />
                <ul className="space-y-2 p-5 text-sm">
                  {d.commitments.length === 0 && <li className="text-muted">تعهدی ثبت نشده است.</li>}
                  {d.commitments.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2">
                      {c.description} — {rial(c.amount)} (پرداخت‌شده {rial(c.consumed)}) {c.source === 'procurement' && <Badge>تدارکات</Badge>}
                      {c.status === 'open' ? (canManage && <Button size="sm" variant="ghost" onClick={() => close.mutate(c.id)}>بستن</Button>) : <Badge>بسته</Badge>}
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
            <Card className="mt-6">
              <CardHeader title="علت انحراف و یادداشت‌ها" />
              <div className="space-y-3 p-5 text-sm">
                {d.notes.map((n) => <p key={n.id}>{n.note} <span className="text-xs text-muted">— {dir.name(n.created_by)} · <DateText value={n.created_at} /></span></p>)}
                <div className="flex gap-2 print:hidden"><Input aria-label="یادداشت جدید" value={note} onChange={(e) => setNote(e.target.value)} placeholder="علت انحراف هزینه یا برنامه" /><Button variant="secondary" disabled={note.trim().length < 2} loading={addNote.isPending} onClick={() => addNote.mutate()}>ثبت</Button></div>
              </div>
            </Card>
            {drafting && <BudgetDialog projectId={projectId!} base={draft ?? d.budgets.find((b) => b.status === 'approved')} onClose={() => setDrafting(false)} />}
            {commit && <CommitmentDialog projectId={projectId!} onClose={() => setCommit(false)} />}
            {etc && <EtcDialog projectId={projectId!} current={d.etc?.amount ?? ''} onClose={() => setEtc(false)} />}
          </>
        )}
      </PageState>
    </>
  );
}

function BudgetDialog({ projectId, base, onClose }: { projectId: string; base?: Detail['budgets'][number]; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const cats = useCategories();
  const [lines, setLines] = useState<Record<string, string>>(Object.fromEntries((base?.lines ?? []).map((l) => [l.category_id, l.amount])));
  const [note, setNote] = useState(base?.status === 'draft' ? base.note : '');
  const total = Object.values(lines).reduce((s, v) => s + (v ? BigInt(v) : 0n), 0n);
  const save = useMutation({
    mutationFn: () => a.put(`/budgets/${projectId}/draft`, { note, lines: Object.entries(lines).filter(([, v]) => v !== '').map(([categoryId, amount]) => ({ categoryId, amount })) }),
    onSuccess: () => (toast('پیش‌نویس ذخیره شد؛ برای اعمال باید تصویب شود'), void qc.invalidateQueries({ queryKey: ['finance'] }), onClose()),
    onError: err.set,
  });
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title="پیش‌نویس بودجه" description="نسخه مصوب تغییر نمی‌کند؛ هر اصلاح نسخه جدیدی است که فرد دیگری تصویب می‌کند."
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ذخیره پیش‌نویس</Button></>}>
      {err.banner}
      <div className="grid gap-3 sm:grid-cols-2">
        {(cats.data ?? []).filter((c) => c.kind === 'expense' && !c.archived).map((c) => (
          <Field key={c.id} label={c.name}><MoneyInput value={lines[c.id] ?? ''} onChange={(v) => setLines({ ...lines, [c.id]: v })} /></Field>
        ))}
        <Field label="توضیح نسخه" className="sm:col-span-2"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <p className="mt-3 text-sm">جمع: <span className="font-bold tabular-nums">{rial(total)}</span> ریال</p>
    </Dialog>
  );
}

function CommitmentDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [v, setV] = useState({ amount: '', description: '', categoryId: '' });
  const save = useMutation({ mutationFn: () => a.post('/commitments', { ...v, projectId, categoryId: v.categoryId || null }), onSuccess: () => (toast('تعهد ثبت شد'), void qc.invalidateQueries({ queryKey: ['finance'] }), onClose()), onError: err.set });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="ثبت تعهد" description="تعهدات (قرارداد، سفارش) از بودجه قابل مصرف کم می‌شوند تا پرداخت شوند." footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت</Button></>}>
      {err.banner}
      <div className="grid gap-4">
        <Field label="شرح" required error={err.fields.description}><Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <Field label="مبلغ (ریال)" required error={err.fields.amount}><MoneyInput value={v.amount} onChange={(x) => setV({ ...v, amount: x })} /></Field>
        <CategorySelect kind="expense" value={v.categoryId} onChange={(x) => setV({ ...v, categoryId: x })} />
      </div>
    </Dialog>
  );
}

function EtcDialog({ projectId, current, onClose }: { projectId: string; current: string; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const [amount, setAmount] = useState(current);
  const [note, setNote] = useState('');
  const save = useMutation({ mutationFn: () => a.post(`/budgets/${projectId}/etc`, { amount, note }), onSuccess: () => (toast('ثبت شد'), void qc.invalidateQueries({ queryKey: ['finance'] }), onClose()) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="برآورد هزینه باقی‌مانده (ETC)" footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => save.mutate()}>ثبت</Button></>}>
      <div className="grid gap-4">
        <Field label="مبلغ (ریال)"><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="مبنای برآورد"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

export function EacMethodField() {
  const a = useApi();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['finance', 'eac'], queryFn: () => a.get<{ version: number; method: string; created_at: string }[]>('/eac-methods') });
  const save = useMutation({ mutationFn: (method: string) => a.post('/eac-methods', { method }), onSuccess: () => (toast('روش EAC تغییر کرد (نسخه جدید)'), void qc.invalidateQueries({ queryKey: ['finance'] })) });
  const cur = q.data?.[0]?.method ?? 'cpi';
  return (
    <Field label="روش برآورد هزینه در پایان (EAC)" hint={`نسخه فعلی: ${(q.data?.[0]?.version ?? 0).toLocaleString('fa-IR')}`}>
      <Select value={cur} onChange={(e) => save.mutate(e.target.value)}>
        <option value="cpi">AC + (BAC − EV) ÷ CPI</option>
        <option value="budget_rate">AC + (BAC − EV)</option>
        <option value="manual_etc">AC + ETC دستی</option>
      </Select>
    </Field>
  );
}
