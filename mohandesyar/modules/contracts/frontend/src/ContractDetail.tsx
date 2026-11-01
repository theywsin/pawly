import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus } from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, DateInput, DateText, DayText, DescriptionList, Dialog, EmptyState, Field, Money, PageHeader, PageState, ProgressBar, Select, Stat, Table, Tabs, Td, Textarea, Th, toast } from '@mohandesyar/ui';
import { ApiError, useCan, useDirectory } from '@mohandesyar/module-sdk/web';
import { todayIso } from '@mohandesyar/persian';
import { AMENDMENT_KIND, DIRECTION, GUARANTEE_KIND, GUARANTEE_STATUS, KIND, STATEMENT_STATUS, STATUS, useApi } from './common.js';
import { ContractForm, type ContractData } from './ContractForm.js';
import { AmendmentDialog, GuaranteeDialog, ObligationDialog, PaymentTermDialog, StatementDialog, type StatementData } from './dialogs.js';

interface Detail {
  contract: ContractData;
  amendments: { id: string; number: number; kind: string; title: string; amount_delta: string; new_end_on: string | null; signed_on: string; description: string }[];
  guarantees: { id: string; kind: string; number: string; issuer: string; amount: string; issued_on: string | null; expires_on: string | null; status: string }[];
  paymentTerms: { id: string; title: string; amount: string | null; percent: string | null; due_on: string | null; condition: string }[];
  obligations: { id: string; party: string; description: string; due_on: string | null; done_on: string | null }[];
  statements: (StatementData & { status: string; period_gross: string; good_performance: string; insurance: string; tax: string; prepayment_recovery: string; vat: string; net_payable: string; created_at: string })[];
  history: { id: string; action: string; summary: string; actor_id: string | null; created_at: string }[];
  linked: { project: { id: string; title: string } | null; account: { id: string; title: string } | null };
}

const pctText = (v: string) => `${Number(v).toLocaleString('fa-IR')}٪`;

export function ContractDetail() {
  const { id = '' } = useParams();
  const a = useApi();
  const qc = useQueryClient();
  const dir = useDirectory();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const canUpdate = useCan('contracts.contract.update');
  const canDelete = useCan('contracts.contract.delete');
  const canStatement = useCan('contracts.statement.create');
  const q = useQuery({ queryKey: ['contracts', 'detail', id], queryFn: () => a.get<Detail>(`/contracts/${id}`) });
  const [dialog, setDialog] = useState<null | 'edit' | 'activate' | 'close' | 'delete' | 'amendment' | 'guarantee' | 'payment' | 'obligation' | 'statement'>(null);
  const [editingStatement, setEditingStatement] = useState<StatementData | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['contracts'] });
    void qc.invalidateQueries({ queryKey: ['widget'] });
  };
  const act = useMutation({
    mutationFn: ({ path, method = 'post', body }: { path: string; method?: 'post' | 'del'; body?: unknown }) => (method === 'del' ? a.del(path) : a.post(path, body)),
    onSuccess: (_r, vars) => {
      toast(vars.path.endsWith('/submit') ? 'برای تأیید ارسال شد' : 'انجام شد');
      refresh();
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'انجام نشد', 'danger'),
  });

  return (
    <PageState query={q}>
      {q.data && (() => {
        const { contract: c } = q.data;
        const open = c.status === 'draft' || c.status === 'active';
        const progress = Number(c.current_amount) > 0 ? (Number(c.approved_gross) / Number(c.current_amount)) * 100 : 0;
        const today = todayIso();
        const items = [
          { key: 'overview', label: 'خلاصه' },
          { key: 'amendments', label: 'الحاقیه‌ها', count: q.data.amendments.length },
          { key: 'statements', label: 'صورت‌وضعیت‌ها', count: q.data.statements.length },
          { key: 'guarantees', label: 'تضامین', count: q.data.guarantees.length },
          { key: 'payments', label: 'شرایط پرداخت', count: q.data.paymentTerms.length },
          { key: 'obligations', label: 'تعهدات', count: q.data.obligations.length },
          { key: 'history', label: 'تاریخچه' },
        ];
        return (
          <>
            <Link to=".." relative="path" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ArrowRight className="size-4" /> همه قراردادها</Link>
            <PageHeader
              title={<span className="flex flex-wrap items-center gap-3"><bdi>{c.code}</bdi> — {c.title} <Badge tone={STATUS[c.status]!.tone}>{STATUS[c.status]!.label}</Badge></span>}
              description={`${KIND[c.kind]} · ${DIRECTION[c.direction]} · طرف قرارداد: ${c.counterparty_name}`}
              actions={canUpdate && (
                <div className="flex flex-wrap gap-2">
                  {open && <Button variant="secondary" onClick={() => setDialog('edit')}>ویرایش</Button>}
                  {c.status === 'draft' && <Button onClick={() => setDialog('activate')}>ثبت امضا</Button>}
                  {c.status === 'active' && <Button variant="secondary" onClick={() => setDialog('close')}>پایان یا فسخ</Button>}
                  {c.status === 'draft' && canDelete && <Button variant="ghost" onClick={() => setDialog('delete')}>حذف</Button>}
                </div>
              )}
            />
            <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="مبلغ اولیه"><Money value={c.initial_amount} /></Stat>
              <Stat label="مبلغ جاری (با الحاقیه‌ها)"><Money value={c.current_amount} /></Stat>
              <Stat label="کارکرد تأییدشده"><Money value={c.approved_gross} /></Stat>
              <Stat label="پایان قرارداد" hint={c.end_on && c.status === 'active' && c.end_on < today ? 'مدت قرارداد گذشته است' : undefined}><DayText value={c.end_on} /></Stat>
            </div>
            <Tabs label="بخش‌های قرارداد" items={items} value={tab} onChange={(k) => setParams(k === 'overview' ? {} : { tab: k }, { replace: true })} />

            {tab === 'overview' && (
              <Card className="space-y-6 p-5">
                <div>
                  <p className="mb-2 text-sm text-muted">پیشرفت مالی (کارکرد تأییدشده نسبت به مبلغ جاری): {Math.round(progress).toLocaleString('fa-IR')}٪</p>
                  <ProgressBar value={progress} label="پیشرفت مالی قرارداد" tone="success" />
                </div>
                <DescriptionList items={[
                  { label: 'مسئول قرارداد', value: dir.name(c.owner_id) },
                  { label: 'تاریخ امضا', value: <DayText value={c.signed_on} /> },
                  { label: 'تاریخ شروع', value: <DayText value={c.start_on} /> },
                  { label: 'پیش‌پرداخت', value: <Money value={c.prepayment_amount} /> },
                  { label: 'پروژه مرتبط', value: q.data.linked.project?.title ?? (c.projects_project_id ? '(ماژول پروژه فعال نیست)' : null) },
                  { label: 'طرف حساب در CRM', value: q.data.linked.account?.title ?? (c.crm_account_id ? '(ماژول CRM فعال نیست)' : null) },
                  { label: 'کسورات', value: `حسن انجام کار ${pctText(c.good_performance_pct)}، بیمه ${pctText(c.insurance_pct)}، مالیات ${pctText(c.tax_pct)}، استهلاک پیش‌پرداخت ${pctText(c.prepayment_recovery_pct)}` },
                  { label: 'ارزش افزوده', value: pctText(c.vat_pct) },
                ]} />
                {c.description && <p className="whitespace-pre-line leading-8">{c.description}</p>}
              </Card>
            )}

            {tab === 'amendments' && (
              <Section empty={!q.data.amendments.length} emptyText="الحاقیه‌ای ثبت نشده است" add={canUpdate && c.status === 'active' ? () => setDialog('amendment') : undefined} addLabel="ثبت الحاقیه"
                note={c.status === 'draft' ? 'الحاقیه پس از ثبت امضای قرارداد ممکن است؛ قرارداد پیش‌نویس را مستقیماً ویرایش کنید.' : undefined}>
                <Table>
                  <thead><tr><Th>شماره</Th><Th>نوع</Th><Th>عنوان</Th><Th>تغییر مبلغ</Th><Th>پایان جدید</Th><Th>تاریخ امضا</Th></tr></thead>
                  <tbody>
                    {q.data.amendments.map((x) => (
                      <tr key={x.id}><Td>{x.number.toLocaleString('fa-IR')}</Td><Td>{AMENDMENT_KIND[x.kind]}</Td><Td>{x.title}</Td><Td>{x.amount_delta === '0' ? '—' : <Money value={x.amount_delta} />}</Td><Td><DayText value={x.new_end_on} /></Td><Td><DayText value={x.signed_on} /></Td></tr>
                    ))}
                  </tbody>
                </Table>
              </Section>
            )}

            {tab === 'statements' && (
              <Section empty={!q.data.statements.length} emptyText="صورت‌وضعیتی ثبت نشده است" add={canStatement && c.status === 'active' ? () => setDialog('statement') : undefined} addLabel="صورت‌وضعیت جدید"
                note={c.status === 'draft' ? 'صورت‌وضعیت پس از ثبت امضای قرارداد ممکن است.' : 'پس از ارسال، صورت‌وضعیت در «تأییدها» برای تأییدکننده نمایش داده می‌شود و دیگر قابل تغییر نیست.'}>
                <Table>
                  <thead><tr><Th>شماره</Th><Th>تا تاریخ</Th><Th>کارکرد تجمعی</Th><Th>کارکرد دوره</Th><Th>خالص قابل پرداخت</Th><Th>وضعیت</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
                  <tbody>
                    {q.data.statements.map((s) => (
                      <tr key={s.id}>
                        <Td>{s.number.toLocaleString('fa-IR')}</Td>
                        <Td><DayText value={s.period_to} /></Td>
                        <Td><Money value={s.cumulative_gross} /></Td>
                        <Td><Money value={s.period_gross} /></Td>
                        <Td className="font-semibold"><Money value={s.net_payable} /></Td>
                        <Td><Badge tone={STATEMENT_STATUS[s.status]!.tone}>{STATEMENT_STATUS[s.status]!.label}</Badge></Td>
                        <Td>
                          {s.status === 'draft' && canStatement && (
                            <div className="flex gap-1">
                              <Button size="sm" variant="secondary" onClick={() => setEditingStatement(s)}>ویرایش</Button>
                              <Button size="sm" loading={act.isPending} onClick={() => act.mutate({ path: `/contracts/${c.id}/statements/${s.id}/submit` })}>ارسال برای تأیید</Button>
                              <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/contracts/${c.id}/statements/${s.id}`, method: 'del' })}>حذف</Button>
                            </div>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Section>
            )}

            {tab === 'guarantees' && (
              <Section empty={!q.data.guarantees.length} emptyText="ضمانت‌نامه‌ای ثبت نشده است" add={canUpdate && open ? () => setDialog('guarantee') : undefined} addLabel="ثبت ضمانت‌نامه">
                <Table>
                  <thead><tr><Th>نوع</Th><Th>شماره</Th><Th>صادرکننده</Th><Th>مبلغ</Th><Th>سررسید</Th><Th>وضعیت</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
                  <tbody>
                    {q.data.guarantees.map((g) => (
                      <tr key={g.id}>
                        <Td>{GUARANTEE_KIND[g.kind]}</Td><Td><bdi>{g.number || '—'}</bdi></Td><Td>{g.issuer || '—'}</Td><Td><Money value={g.amount} /></Td>
                        <Td><DayText value={g.expires_on} />{g.status === 'active' && g.expires_on && g.expires_on < today && <Badge tone="danger" className="ms-2">گذشته</Badge>}</Td>
                        <Td><Badge tone={GUARANTEE_STATUS[g.status]!.tone}>{GUARANTEE_STATUS[g.status]!.label}</Badge></Td>
                        <Td>
                          {canUpdate && g.status === 'active' && (
                            <Select aria-label={`تغییر وضعیت ضمانت‌نامه ${g.number}`} className="h-8 w-32 text-xs" value="" onChange={(e) => e.target.value && act.mutate({ path: `/contracts/${c.id}/guarantees/${g.id}/status`, body: { status: e.target.value, on: today } })}>
                              <option value="">تغییر وضعیت…</option>
                              <option value="released">آزاد شد</option>
                              <option value="seized">ضبط شد</option>
                              <option value="expired">منقضی شد</option>
                            </Select>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Section>
            )}

            {tab === 'payments' && (
              <Section empty={!q.data.paymentTerms.length} emptyText="شرط پرداختی ثبت نشده است" add={canUpdate && open ? () => setDialog('payment') : undefined} addLabel="افزودن شرط پرداخت">
                <Table>
                  <thead><tr><Th>عنوان</Th><Th>مبلغ/درصد</Th><Th>سررسید</Th><Th>شرط</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
                  <tbody>
                    {q.data.paymentTerms.map((p) => (
                      <tr key={p.id}>
                        <Td>{p.title}</Td>
                        <Td>{p.amount ? <Money value={p.amount} /> : p.percent ? pctText(p.percent) : '—'}</Td>
                        <Td><DayText value={p.due_on} /></Td><Td>{p.condition || '—'}</Td>
                        <Td>{canUpdate && open && <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/contracts/${c.id}/payment-terms/${p.id}`, method: 'del' })}>حذف</Button>}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Section>
            )}

            {tab === 'obligations' && (
              <Section empty={!q.data.obligations.length} emptyText="تعهدی ثبت نشده است" add={canUpdate && open ? () => setDialog('obligation') : undefined} addLabel="افزودن تعهد">
                <Table>
                  <thead><tr><Th>متعهد</Th><Th>شرح</Th><Th>مهلت</Th><Th>انجام</Th></tr></thead>
                  <tbody>
                    {q.data.obligations.map((o) => (
                      <tr key={o.id}>
                        <Td>{o.party === 'us' ? 'ما' : 'طرف قرارداد'}</Td>
                        <Td>{o.description}</Td>
                        <Td><DayText value={o.due_on} />{!o.done_on && o.due_on && o.due_on < today && <Badge tone="danger" className="ms-2">معوق</Badge>}</Td>
                        <Td>
                          <label className="inline-flex items-center gap-2 text-sm">
                            <input type="checkbox" className="size-4 accent-primary" disabled={!canUpdate} checked={!!o.done_on}
                              onChange={(e) => act.mutate({ path: `/contracts/${c.id}/obligations/${o.id}/done`, body: { doneOn: e.target.checked ? today : null } })} />
                            {o.done_on ? <DayText value={o.done_on} /> : 'انجام نشده'}
                          </label>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Section>
            )}

            {tab === 'history' && (
              <Card className="p-5">
                <ol className="space-y-3" aria-label="تاریخچه تغییرات">
                  {q.data.history.map((h) => (
                    <li key={h.id} className="flex flex-wrap gap-x-3 border-b border-border pb-3 text-sm last:border-0">
                      <span className="font-medium">{h.summary}</span>
                      <span className="text-muted">{h.actor_id ? dir.name(h.actor_id) : 'سامانه'} · <DateText value={h.created_at} withTime /></span>
                    </li>
                  ))}
                </ol>
              </Card>
            )}

            {dialog === 'edit' && <ContractForm open contract={c} onClose={() => setDialog(null)} />}
            {dialog === 'activate' && <ActivateDialog id={c.id} onClose={() => setDialog(null)} onDone={refresh} />}
            {dialog === 'close' && <CloseDialog id={c.id} onClose={() => setDialog(null)} onDone={refresh} />}
            {dialog === 'amendment' && <AmendmentDialog contractId={c.id} onClose={() => setDialog(null)} />}
            {dialog === 'guarantee' && <GuaranteeDialog contractId={c.id} onClose={() => setDialog(null)} />}
            {dialog === 'payment' && <PaymentTermDialog contractId={c.id} onClose={() => setDialog(null)} />}
            {dialog === 'obligation' && <ObligationDialog contractId={c.id} onClose={() => setDialog(null)} />}
            {dialog === 'statement' && <StatementDialog contractId={c.id} onClose={() => setDialog(null)} />}
            {editingStatement && <StatementDialog contractId={c.id} statement={editingStatement} onClose={() => setEditingStatement(null)} />}
            <ConfirmDialog
              open={dialog === 'delete'}
              onOpenChange={(o) => !o && setDialog(null)}
              title={`حذف قرارداد پیش‌نویس ${c.code}`}
              description="قرارداد از فهرست حذف می‌شود. این کار فقط برای پیش‌نویس ممکن است."
              confirmLabel="حذف"
              onConfirm={async () => {
                await a.del(`/contracts/${c.id}`);
                refresh();
                history.back();
              }}
            />
          </>
        );
      })()}
    </PageState>
  );
}

function Section({ children, empty, emptyText, add, addLabel, note }: { children: React.ReactNode; empty: boolean; emptyText: string; add?: () => void; addLabel: string; note?: string }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {note ? <p className="text-sm text-muted">{note}</p> : <span />}
        {add && <Button size="sm" onClick={add}><Plus className="size-4" /> {addLabel}</Button>}
      </div>
      {empty ? <EmptyState title={emptyText} /> : children}
    </div>
  );
}

function ActivateDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const a = useApi();
  const [signedOn, setSignedOn] = useState<string | null>(todayIso());
  const m = useMutation({ mutationFn: () => a.post(`/contracts/${id}/activate`, { signedOn }), onSuccess: () => (toast('امضای قرارداد ثبت شد'), onDone(), onClose()), onError: (e) => toast(e instanceof ApiError ? e.message : 'انجام نشد', 'danger') });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="ثبت امضای قرارداد" description="پس از ثبت امضا، مبلغ، مدت و نرخ کسورات فقط از طریق الحاقیه قابل تغییر است."
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={m.isPending} disabled={!signedOn} onClick={() => m.mutate()}>ثبت امضا</Button></>}>
      <Field label="تاریخ امضا" required error={signedOn === null ? 'تاریخ معتبر نیست' : undefined}>
        <DateInput value={signedOn ?? undefined} onChange={setSignedOn} />
      </Field>
    </Dialog>
  );
}

function CloseDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const a = useApi();
  const [status, setStatus] = useState<'completed' | 'terminated'>('completed');
  const [note, setNote] = useState('');
  const m = useMutation({ mutationFn: () => a.post(`/contracts/${id}/close`, { status, note }), onSuccess: () => (toast('وضعیت قرارداد ثبت شد'), onDone(), onClose()), onError: (e) => toast(e instanceof ApiError ? e.message : 'انجام نشد', 'danger') });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="پایان یا فسخ قرارداد"
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button variant={status === 'terminated' ? 'danger' : 'primary'} loading={m.isPending} onClick={() => m.mutate()}>ثبت</Button></>}>
      <div className="grid gap-4">
        <Field label="وضعیت">
          <Select value={status} onChange={(e) => setStatus(e.target.value as 'completed' | 'terminated')}>
            <option value="completed">پایان قرارداد</option>
            <option value="terminated">فسخ قرارداد</option>
          </Select>
        </Field>
        <Field label="توضیح"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
