import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Building2, Handshake, Plus, Target } from 'lucide-react';
import { Badge, Button, Card, DateInput, DateText, DayText, DescriptionList, EmptyState, Field, Input, Ltr, Money, MoneyInput, PageHeader, PageState, Select, Stat, Table, Td, Textarea, Th, toast, ExportMenu } from '@mohandesyar/ui';
import { ApiError, useCan, useDirectory } from '@mohandesyar/module-sdk/web';
import { addDays, todayIso } from '@mohandesyar/persian';
import { CrmNav, FormDialog, INTERACTION, InteractionDialog, LEAD_STATUS, PROPOSAL_KIND, PROPOSAL_STATUS, SOURCE, useApi, useDate } from './common.js';
import { AccountForm, LeadForm, OpportunityForm, type AccountData, type LeadData, type OpportunityData } from './forms.js';

const pctText = (n: number | null) => (n === null ? '—' : `${Math.round(n).toLocaleString('fa-IR')}٪`);
type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

function useAct() {
  const a = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, method = 'post', body }: { path: string; method?: 'post' | 'del'; body?: unknown }) => (method === 'del' ? a.del(path) : a.post(path, body)),
    onSuccess: () => (toast('انجام شد'), void qc.invalidateQueries({ queryKey: ['crm'] }), void qc.invalidateQueries({ queryKey: ['widget'] })),
    onError: (e) => toast(e instanceof ApiError ? e.message : 'انجام نشد', 'danger'),
  });
}

interface Stage { id: string; name: string; probability: number; kind: 'open' | 'won' | 'lost'; sort: number; archived: boolean }
interface BoardOpp { id: string; title: string; account_name: string; amount: string; stage_id: string; status: string; owner_id: string | null; expected_close_on: string | null; probability: number | null; stage_probability: number }

/** Pipeline board: one column per open stage; cards move with an accessible stage selector. */
export function BoardPage() {
  const a = useApi();
  const dir = useDirectory();
  const canManage = useCan('crm.pipeline.manage');
  const q = useQuery({ queryKey: ['crm', 'board'], queryFn: () => a.get<{ stages: Stage[]; opportunities: BoardOpp[] }>('/board') });
  const [creating, setCreating] = useState(false);
  const [losing, setLosing] = useState<{ opp: BoardOpp; stage: Stage } | null>(null);
  const act = useAct();
  const move = (opp: BoardOpp, stageId: string) => {
    const stage = q.data!.stages.find((s) => s.id === stageId)!;
    if (stage.kind === 'lost') setLosing({ opp, stage });
    else act.mutate({ path: `/opportunities/${opp.id}/move`, body: { stageId } });
  };
  return (
    <>
      <PageHeader title="فروش و مشتریان" description="قیف فروش، سرنخ‌ها و پیشنهادها" actions={canManage && <Button onClick={() => setCreating(true)}><Plus className="size-4" /> فرصت جدید</Button>} />
      <CrmNav />
      <PageState query={q} isEmpty={q.data?.opportunities.length === 0} empty={<EmptyState icon={<Handshake className="size-8" />} title="هنوز فرصت فروشی ثبت نشده است" description="سرنخ‌ها را ثبت و پس از ارزیابی به فرصت تبدیل کنید، یا مستقیماً فرصت جدید بسازید." />}>
        {q.data && (
          <div className="flex gap-3 overflow-x-auto pb-4">
            {q.data.stages.map((s) => {
              const cards = q.data.opportunities.filter((o) => o.stage_id === s.id);
              const total = cards.reduce((n, o) => n + Number(o.amount), 0);
              return (
                <section key={s.id} aria-label={`مرحله ${s.name}`} className="w-64 shrink-0 rounded-lg bg-surface-2/60 p-3">
                  <h2 className="flex items-center justify-between text-sm font-semibold">
                    <span>{s.name}</span>
                    <Badge tone={s.kind === 'won' ? 'success' : s.kind === 'lost' ? 'danger' : 'neutral'}>{cards.length.toLocaleString('fa-IR')}</Badge>
                  </h2>
                  <p className="mb-3 text-xs text-muted">{s.kind === 'open' ? `احتمال ${s.probability.toLocaleString('fa-IR')}٪ · ` : '۹۰ روز اخیر · '}<Money value={String(total)} /></p>
                  <ul className="space-y-2">
                    {cards.map((o) => (
                      <li key={o.id}>
                        <Card className="space-y-2 p-3 text-sm">
                          <Link to={`opportunities/${o.id}`} className="font-medium text-primary underline-offset-4 hover:underline">{o.title}</Link>
                          <p className="text-xs text-muted">{o.account_name} · {dir.name(o.owner_id)}</p>
                          <p className="text-xs"><Money value={o.amount} />{o.expected_close_on && <> · <DayText value={o.expected_close_on} /></>}</p>
                          {canManage && o.status === 'open' && (
                            <Select aria-label={`انتقال «${o.title}» به مرحله`} className="h-8 text-xs" value={o.stage_id} onChange={(e) => move(o, e.target.value)}>
                              {q.data.stages.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                            </Select>
                          )}
                        </Card>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </PageState>
      {creating && <OpportunityForm onClose={() => setCreating(false)} />}
      {losing && <LostDialog oppId={losing.opp.id} stageId={losing.stage.id} onClose={() => setLosing(null)} />}
    </>
  );
}

function LostDialog({ oppId, stageId, onClose }: { oppId: string; stageId: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <FormDialog title="فرصت از دست رفت" done="ثبت شد" path={`/opportunities/${oppId}/move`} onClose={onClose} body={() => ({ stageId, lostReason: reason })}>
      {(f) => <Field label="دلیل از دست رفتن" required error={f.lostReason}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
    </FormDialog>
  );
}

// ---------------------------------------------------------------- leads

export function LeadsPage() {
  const a = useApi();
  const dir = useDirectory();
  const canManage = useCan('crm.pipeline.manage');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const params = new URLSearchParams({ ...(status && { status }), ...(q.trim() && { q: q.trim() }) }).toString();
  const list = useQuery({ queryKey: ['crm', 'leads', params], queryFn: () => a.get<LeadData[]>(`/leads${params ? `?${params}` : ''}`) });
  const today = todayIso();
  return (
    <>
      <PageHeader title="سرنخ‌ها" actions={canManage && <Button onClick={() => setCreating(true)}><Plus className="size-4" /> سرنخ جدید</Button>} />
      <CrmNav />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="w-full sm:w-64"><Input aria-label="جست‌وجو در سرنخ‌ها" placeholder="عنوان، سازمان یا مخاطب" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="w-full sm:w-48">
          <Select aria-label="وضعیت سرنخ" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">سرنخ‌های باز</option>
            {Object.entries(LEAD_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </Select>
        </div>
      </div>
      <div className="mb-4 flex justify-end">
        <ExportMenu filename="leads" title="سرنخ‌ها" rows={list.data} columns={[
          { header: 'عنوان', value: (l) => l.title },
          { header: 'سازمان', value: (l) => l.organization_name },
          { header: 'مخاطب', value: (l) => l.contact_name },
          { header: 'منبع', value: (l) => SOURCE[l.source] },
          { header: 'بودجه تخمینی (ریال)', value: (l) => l.estimated_budget, kind: 'number' },
          { header: 'امتیاز', value: (l) => l.score, kind: 'number' },
          { header: 'مسئول', value: (l) => dir.name(l.owner_id) },
          { header: 'وضعیت', value: (l) => LEAD_STATUS[l.status]!.label },
        ]} />
      </div>
      <PageState query={list} isEmpty={list.data?.length === 0} empty={<EmptyState icon={<Target className="size-8" />} title="سرنخی یافت نشد" action={canManage && !status && !q ? <Button onClick={() => setCreating(true)}>ثبت اولین سرنخ</Button> : undefined} />}>
        <Table>
          <thead><tr><Th>عنوان</Th><Th>سازمان / مخاطب</Th><Th>منبع</Th><Th>بودجه تخمینی</Th><Th>امتیاز</Th><Th>تماس بعدی</Th><Th>مسئول</Th><Th>وضعیت</Th></tr></thead>
          <tbody>
            {list.data?.map((l) => (
              <tr key={l.id}>
                <Td><Link to={l.id} className="font-medium text-primary underline-offset-4 hover:underline">{l.title}</Link></Td>
                <Td>{[l.organization_name, l.contact_name].filter(Boolean).join(' / ') || '—'}</Td>
                <Td>{SOURCE[l.source]}</Td>
                <Td><Money value={l.estimated_budget} /></Td>
                <Td>{l.score.toLocaleString('fa-IR')}</Td>
                <Td><DayText value={l.next_contact_on} />{l.next_contact_on && l.next_contact_on < today && <Badge tone="danger" className="ms-1">معوق</Badge>}</Td>
                <Td>{dir.name(l.owner_id)}</Td>
                <Td><Badge tone={LEAD_STATUS[l.status]!.tone}>{LEAD_STATUS[l.status]!.label}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {creating && <LeadForm onClose={() => setCreating(false)} />}
    </>
  );
}

export function LeadPage() {
  const { id = '' } = useParams();
  const a = useApi();
  const nav = useNavigate();
  const dir = useDirectory();
  const canManage = useCan('crm.pipeline.manage');
  const q = useQuery({ queryKey: ['crm', 'lead', id], queryFn: () => a.get<{ lead: LeadData & { lost_reason: string; opportunity_id: string | null }; interactions: { id: string; kind: string; occurred_on: string; summary: string; created_by: string }[] }>(`/leads/${id}`) });
  const [dialog, setDialog] = useState<null | 'edit' | 'interaction' | 'lost' | 'convert'>(null);
  return (
    <PageState query={q}>
      {q.data && (() => {
        const l = q.data.lead;
        const open = l.status !== 'converted' && l.status !== 'lost';
        return (
          <>
            <Link to="/app/crm/leads" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ArrowRight className="size-4" /> سرنخ‌ها</Link>
            <PageHeader title={<span className="flex flex-wrap items-center gap-3">{l.title} <Badge tone={LEAD_STATUS[l.status]!.tone}>{LEAD_STATUS[l.status]!.label}</Badge></span>}
              actions={canManage && open && (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setDialog('convert')}>تبدیل به فرصت</Button>
                  <Button variant="secondary" onClick={() => setDialog('interaction')}>ثبت ارتباط</Button>
                  <Button variant="secondary" onClick={() => setDialog('edit')}>ویرایش</Button>
                  <Button variant="ghost" onClick={() => setDialog('lost')}>از دست رفت</Button>
                </div>
              )} />
            {l.status === 'converted' && l.opportunity_id && <p className="mb-4 text-sm">این سرنخ به <Link className="text-primary underline" to={`/app/crm/opportunities/${l.opportunity_id}`}>فرصت فروش</Link> تبدیل شده است.</p>}
            {l.status === 'lost' && <p className="mb-4 text-sm text-danger">دلیل: {l.lost_reason}</p>}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="p-5">
                <DescriptionList items={[
                  { label: 'سازمان', value: l.organization_name || null },
                  { label: 'مخاطب', value: l.contact_name || null },
                  { label: 'موبایل', value: l.mobile ? <Ltr>{l.mobile}</Ltr> : null },
                  { label: 'ایمیل', value: l.email ? <Ltr>{l.email}</Ltr> : null },
                  { label: 'منبع', value: SOURCE[l.source] },
                  { label: 'بودجه تخمینی', value: <Money value={l.estimated_budget} /> },
                  { label: 'امتیاز', value: l.score.toLocaleString('fa-IR') },
                  { label: 'مسئول', value: dir.name(l.owner_id) },
                  { label: 'تماس بعدی', value: <DayText value={l.next_contact_on} /> },
                ]} />
                {l.need && <p className="mt-4 whitespace-pre-line leading-8">{l.need}</p>}
              </Card>
              <Interactions items={q.data.interactions} />
            </div>
            {dialog === 'edit' && <LeadForm lead={l} onClose={() => setDialog(null)} />}
            {dialog === 'interaction' && <InteractionDialog target={{ leadId: l.id }} onClose={() => setDialog(null)} />}
            {dialog === 'lost' && <LeadLostDialog id={l.id} onClose={() => setDialog(null)} />}
            {dialog === 'convert' && <ConvertDialog lead={l} onClose={() => setDialog(null)} onDone={(oppId) => nav(`/app/crm/opportunities/${oppId}`)} />}
          </>
        );
      })()}
    </PageState>
  );
}

function LeadLostDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <FormDialog title="سرنخ از دست رفت" done="ثبت شد" path={`/leads/${id}/lost`} onClose={onClose} body={() => ({ reason })}>
      {(f) => <Field label="دلیل" required error={f.reason}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
    </FormDialog>
  );
}

function ConvertDialog({ lead, onClose, onDone }: { lead: LeadData; onClose: () => void; onDone: (oppId: string) => void }) {
  const a = useApi();
  const accounts = useQuery({ queryKey: ['crm', 'accounts', ''], queryFn: () => a.get<{ id: string; name: string }[]>('/accounts') });
  const [accountId, setAccountId] = useState(lead.account_id ?? '');
  const [amount, setAmount] = useState(lead.estimated_budget ?? '');
  const close = useDate(addDays(todayIso(), 60));
  return (
    <FormDialog<{ opportunityId: string }> title="تبدیل سرنخ به فرصت فروش" done="فرصت فروش ساخته شد" path={`/leads/${lead.id}/convert`} onClose={onClose} disabled={close.bad} onDone={(r) => onDone(r.opportunityId)}
      body={() => ({ accountId: accountId || null, amount: amount || '0', expectedCloseOn: close.value || null })}>
      {(f) => (
        <>
          <Field label="مشتری" hint={accountId ? undefined : `مشتری جدید «${lead.organization_name || lead.contact_name || '—'}» ساخته می‌شود`} error={f.accountId}>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">— مشتری جدید از اطلاعات سرنخ —</option>
              {accounts.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
          <Field label="ارزش فرصت" error={f.amount}><MoneyInput value={amount} onChange={setAmount} /></Field>
          <Field label="تاریخ پیش‌بینی بستن" error={close.bad ? 'تاریخ معتبر نیست' : f.expectedCloseOn}><DateInput value={close.value} onChange={close.onChange} /></Field>
        </>
      )}
    </FormDialog>
  );
}

function Interactions({ items, onAdd }: { items: { id: string; kind: string; occurred_on: string; summary: string; created_by: string }[]; onAdd?: () => void }) {
  const dir = useDirectory();
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">سابقه ارتباط</h2>{onAdd && <Button size="sm" variant="secondary" onClick={onAdd}>ثبت ارتباط</Button>}</div>
      {!items.length ? <p className="text-sm text-muted">ارتباطی ثبت نشده است.</p> : (
        <ol className="space-y-3">
          {items.map((i) => (
            <li key={i.id} className="border-b border-border pb-3 text-sm last:border-0">
              <p className="text-muted"><Badge>{INTERACTION[i.kind]}</Badge> <DayText value={i.occurred_on} /> · {dir.name(i.created_by)}</p>
              <p className="mt-1 whitespace-pre-line leading-7">{i.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- accounts

export function AccountsPage() {
  const a = useApi();
  const canManage = useCan('crm.account.manage');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['crm', 'accounts', q.trim()], queryFn: () => a.get<(AccountData & { open_opportunities: number })[]>(`/accounts${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`) });
  return (
    <>
      <PageHeader title="مشتریان" actions={canManage && <Button onClick={() => setCreating(true)}><Plus className="size-4" /> مشتری جدید</Button>} />
      <CrmNav />
      <div className="mb-4 w-full sm:w-64"><Input aria-label="جست‌وجو در مشتریان" placeholder="نام مشتری" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="mb-4 flex justify-end">
        <ExportMenu filename="accounts" title="مشتریان" rows={list.data} columns={[
          { header: 'نام', value: (x) => x.name },
          { header: 'نوع', value: (x) => (x.kind === 'company' ? 'شرکت' : 'شخص') },
          { header: 'حوزه', value: (x) => x.industry },
          { header: 'شهر', value: (x) => x.city },
          { header: 'تلفن', value: (x) => x.phone },
          { header: 'فرصت‌های باز', value: (x) => x.open_opportunities, kind: 'number' },
        ]} />
      </div>
      <PageState query={list} isEmpty={list.data?.length === 0} empty={<EmptyState icon={<Building2 className="size-8" />} title={q ? 'مشتری‌ای با این نام یافت نشد' : 'هنوز مشتری‌ای ثبت نشده است'} />}>
        <Table>
          <thead><tr><Th>نام</Th><Th>نوع</Th><Th>حوزه</Th><Th>شهر</Th><Th>تلفن</Th><Th>فرصت‌های باز</Th></tr></thead>
          <tbody>
            {list.data?.map((x) => (
              <tr key={x.id}>
                <Td><Link to={x.id} className="font-medium text-primary underline-offset-4 hover:underline">{x.name}</Link></Td>
                <Td>{x.kind === 'company' ? 'شرکت' : 'شخص'}</Td><Td>{x.industry || '—'}</Td><Td>{x.city || '—'}</Td><Td>{x.phone ? <Ltr>{x.phone}</Ltr> : '—'}</Td><Td>{x.open_opportunities.toLocaleString('fa-IR')}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {creating && <AccountForm onClose={() => setCreating(false)} />}
    </>
  );
}

export function AccountPage() {
  const { id = '' } = useParams();
  const a = useApi();
  const dir = useDirectory();
  const canManage = useCan('crm.account.manage');
  const canPipeline = useCan('crm.pipeline.manage');
  const q = useQuery({ queryKey: ['crm', 'account', id], queryFn: () => a.get<{ account: AccountData; contacts: { id: string; full_name: string; position: string; mobile: string | null; phone: string; email: string }[]; interactions: { id: string; kind: string; occurred_on: string; summary: string; created_by: string }[]; opportunities: { id: string; title: string; amount: string; status: string; stage: string; expected_close_on: string | null }[] }>(`/accounts/${id}`) });
  const [dialog, setDialog] = useState<null | 'edit' | 'contact' | 'interaction' | 'opportunity'>(null);
  const act = useAct();
  return (
    <PageState query={q}>
      {q.data && (() => {
        const c = q.data.account;
        return (
          <>
            <Link to="/app/crm/accounts" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ArrowRight className="size-4" /> مشتریان</Link>
            <PageHeader title={c.name} description={[c.kind === 'company' ? 'شرکت/سازمان' : 'شخص', c.industry, c.city].filter(Boolean).join(' · ')}
              actions={<div className="flex flex-wrap gap-2">
                {canPipeline && <Button onClick={() => setDialog('opportunity')}>فرصت جدید</Button>}
                {canManage && <Button variant="secondary" onClick={() => setDialog('edit')}>ویرایش</Button>}
              </div>} />
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="space-y-4 p-5">
                <DescriptionList items={[
                  { label: 'تلفن', value: c.phone ? <Ltr>{c.phone}</Ltr> : null },
                  { label: 'ایمیل', value: c.email ? <Ltr>{c.email}</Ltr> : null },
                  { label: 'شناسه/کد ملی', value: c.national_id ? <Ltr>{c.national_id}</Ltr> : null },
                  { label: 'کد اقتصادی', value: c.economic_code ? <Ltr>{c.economic_code}</Ltr> : null },
                  { label: 'نشانی', value: c.address || null },
                  { label: 'مسئول', value: dir.name(c.owner_id) },
                ]} />
                {c.notes && <p className="whitespace-pre-line leading-8">{c.notes}</p>}
                <div>
                  <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">مخاطبان</h2>{canManage && <Button size="sm" variant="secondary" onClick={() => setDialog('contact')}>افزودن مخاطب</Button>}</div>
                  {!q.data.contacts.length ? <p className="text-sm text-muted">مخاطبی ثبت نشده است.</p> : (
                    <ul className="space-y-2 text-sm">
                      {q.data.contacts.map((x) => (
                        <li key={x.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span>{x.full_name}{x.position && <span className="text-muted"> — {x.position}</span>}{x.mobile && <> · <Ltr>{x.mobile}</Ltr></>}</span>
                          {canManage && <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/accounts/${c.id}/contacts/${x.id}`, method: 'del' })}>حذف</Button>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h2 className="mb-2 font-semibold">فرصت‌ها</h2>
                  {!q.data.opportunities.length ? <p className="text-sm text-muted">فرصتی ثبت نشده است.</p> : (
                    <ul className="space-y-1 text-sm">
                      {q.data.opportunities.map((o) => <li key={o.id}><Link className="text-primary underline-offset-4 hover:underline" to={`/app/crm/opportunities/${o.id}`}>{o.title}</Link> · {o.stage} · <Money value={o.amount} /></li>)}
                    </ul>
                  )}
                </div>
              </Card>
              <Interactions items={q.data.interactions} onAdd={canManage ? () => setDialog('interaction') : undefined} />
            </div>
            {dialog === 'edit' && <AccountForm account={c} onClose={() => setDialog(null)} />}
            {dialog === 'contact' && <ContactDialog accountId={c.id} onClose={() => setDialog(null)} />}
            {dialog === 'interaction' && <InteractionDialog target={{ accountId: c.id }} onClose={() => setDialog(null)} />}
            {dialog === 'opportunity' && <OpportunityForm accountId={c.id} onClose={() => setDialog(null)} />}
          </>
        );
      })()}
    </PageState>
  );
}

function ContactDialog({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const [v, setV] = useState({ fullName: '', position: '', mobile: '', phone: '', email: '' });
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <FormDialog<{ duplicates: { full_name: string; account_name: string }[] }> title="افزودن مخاطب" done="مخاطب افزوده شد" path={`/accounts/${accountId}/contacts`} onClose={onClose} body={() => v}
      onDone={(r) => r.duplicates.length && toast(`این شماره قبلاً برای ${r.duplicates.map((d) => `${d.full_name} (${d.account_name})`).join('، ')} ثبت شده است`, 'info')}>
      {(f) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام" required error={f.fullName}><Input value={v.fullName} onChange={(e) => set('fullName')(e.target.value)} /></Field>
          <Field label="سمت"><Input value={v.position} onChange={(e) => set('position')(e.target.value)} /></Field>
          <Field label="موبایل" error={f.mobile}><Input dir="ltr" inputMode="tel" value={v.mobile} onChange={(e) => set('mobile')(e.target.value)} /></Field>
          <Field label="تلفن"><Input dir="ltr" value={v.phone} onChange={(e) => set('phone')(e.target.value)} /></Field>
          <Field label="ایمیل" error={f.email} className="sm:col-span-2"><Input dir="ltr" value={v.email} onChange={(e) => set('email')(e.target.value)} /></Field>
        </div>
      )}
    </FormDialog>
  );
}

// ---------------------------------------------------------------- opportunity

interface Proposal { id: string; number: number; title: string; kind: string; status: string; versions: { id: string; version: number; amount: string | null; validUntil: string | null; content: string; sentOn: string | null; createdAt: string; createdBy: string }[] }

export function OpportunityPage() {
  const { id = '' } = useParams();
  const a = useApi();
  const dir = useDirectory();
  const canManage = useCan('crm.pipeline.manage');
  const q = useQuery({ queryKey: ['crm', 'opportunity', id], queryFn: () => a.get<{ opportunity: OpportunityData & { account_name: string; stage_id: string; stage_name: string; stage_probability: number; status: string; lost_reason: string; closed_on: string | null }; history: { id: string; to_name: string; changed_at: string; changed_by: string }[]; interactions: { id: string; kind: string; occurred_on: string; summary: string; created_by: string }[]; proposals: Proposal[]; stages: Stage[] }>(`/opportunities/${id}`) });
  const [dialog, setDialog] = useState<null | { kind: string; payload?: unknown }>(null);
  const act = useAct();
  const today = todayIso();
  return (
    <PageState query={q}>
      {q.data && (() => {
        const o = q.data.opportunity;
        const probability = o.probability ?? o.stage_probability;
        const tone: Tone = o.status === 'won' ? 'success' : o.status === 'lost' ? 'danger' : 'info';
        return (
          <>
            <Link to="/app/crm" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ArrowRight className="size-4" /> قیف فروش</Link>
            <PageHeader title={<span className="flex flex-wrap items-center gap-3">{o.title} <Badge tone={tone}>{o.stage_name}</Badge></span>}
              description={<>مشتری: <Link className="text-primary underline" to={`/app/crm/accounts/${o.account_id}`}>{o.account_name}</Link> · مسئول: {dir.name(o.owner_id)}</>}
              actions={canManage && (
                <div className="flex flex-wrap items-center gap-2">
                  {o.status === 'open' && (
                    <div className="w-44">
                      <Select aria-label="تغییر مرحله" value={o.stage_id} onChange={(e) => {
                        const s = q.data.stages.find((x) => x.id === e.target.value)!;
                        if (s.kind === 'lost') setDialog({ kind: 'lost', payload: s.id });
                        else act.mutate({ path: `/opportunities/${o.id}/move`, body: { stageId: s.id } });
                      }}>
                        {q.data.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </Select>
                    </div>
                  )}
                  <Button variant="secondary" onClick={() => setDialog({ kind: 'interaction' })}>ثبت ارتباط</Button>
                  <Button variant="secondary" onClick={() => setDialog({ kind: 'edit' })}>ویرایش</Button>
                </div>
              )} />
            <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="ارزش فرصت"><Money value={o.amount} /></Stat>
              <Stat label="احتمال" hint={o.probability === null ? 'احتمال مرحله' : 'تعیین‌شده برای این فرصت'}>{pctText(probability)}</Stat>
              <Stat label="ارزش وزنی"><Money value={String(Math.round((Number(o.amount) * probability) / 100))} /></Stat>
              <Stat label={o.status === 'open' ? 'پیش‌بینی بستن' : 'تاریخ بسته شدن'}><DayText value={o.status === 'open' ? o.expected_close_on : o.closed_on} /></Stat>
            </div>
            {o.status === 'lost' && <p className="mb-4 text-sm text-danger">دلیل از دست رفتن: {o.lost_reason}</p>}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="p-5">
                <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">پیشنهادهای فنی و مالی</h2>{canManage && <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'proposal' })}>پیشنهاد جدید</Button>}</div>
                {!q.data.proposals.length ? <p className="text-sm text-muted">پیشنهادی ثبت نشده است.</p> : (
                  <ul className="space-y-4">
                    {q.data.proposals.map((p) => {
                      const latest = p.versions[0]!;
                      return (
                        <li key={p.id} className="rounded-md border border-border p-3 text-sm">
                          <p className="flex flex-wrap items-center gap-2 font-medium">#{p.number.toLocaleString('fa-IR')} {p.title} <Badge>{PROPOSAL_KIND[p.kind]}</Badge> <Badge tone={PROPOSAL_STATUS[p.status]!.tone}>{PROPOSAL_STATUS[p.status]!.label}</Badge></p>
                          <p className="mt-1 text-muted">نسخه {latest.version.toLocaleString('fa-IR')} · <Money value={latest.amount} /> · اعتبار تا <DayText value={latest.validUntil} />{latest.validUntil && latest.validUntil < today && p.status === 'sent' && <Badge tone="warning" className="ms-1">منقضی</Badge>}</p>
                          {canManage && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {p.status === 'draft' && <Button size="sm" onClick={() => act.mutate({ path: `/opportunities/${o.id}/proposals/${p.id}/status`, body: { status: 'sent', on: today } })}>ثبت ارسال</Button>}
                              {p.status === 'sent' && <Button size="sm" variant="secondary" onClick={() => act.mutate({ path: `/opportunities/${o.id}/proposals/${p.id}/status`, body: { status: 'accepted', on: today } })}>پذیرفته شد</Button>}
                              {p.status === 'sent' && <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/opportunities/${o.id}/proposals/${p.id}/status`, body: { status: 'rejected', on: today } })}>رد شد</Button>}
                              {(p.status === 'draft' || p.status === 'sent') && <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'version', payload: p })}>نسخه جدید</Button>}
                            </div>
                          )}
                          {p.versions.length > 1 && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-muted">نسخه‌های قبلی</summary>
                              <ul className="mt-1 space-y-1">{p.versions.slice(1).map((v) => <li key={v.id}>نسخه {v.version.toLocaleString('fa-IR')}: <Money value={v.amount} />{v.sentOn && <> · ارسال <DayText value={v.sentOn} /></>}</li>)}</ul>
                            </details>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
              <div className="space-y-6">
                <Interactions items={q.data.interactions} />
                <Card className="p-5">
                  <h2 className="mb-3 font-semibold">تاریخچه مراحل</h2>
                  <ol className="space-y-2 text-sm">{q.data.history.map((h) => <li key={h.id}>{h.to_name} <span className="text-muted">· {dir.name(h.changed_by)} · <DateText value={h.changed_at} /></span></li>)}</ol>
                </Card>
              </div>
            </div>
            {dialog?.kind === 'edit' && <OpportunityForm opportunity={o} onClose={() => setDialog(null)} />}
            {dialog?.kind === 'interaction' && <InteractionDialog target={{ opportunityId: o.id }} onClose={() => setDialog(null)} />}
            {dialog?.kind === 'lost' && <LostDialog oppId={o.id} stageId={dialog.payload as string} onClose={() => setDialog(null)} />}
            {dialog?.kind === 'proposal' && <ProposalDialog oppId={o.id} onClose={() => setDialog(null)} />}
            {dialog?.kind === 'version' && <ProposalDialog oppId={o.id} proposal={dialog.payload as Proposal} onClose={() => setDialog(null)} />}
          </>
        );
      })()}
    </PageState>
  );
}

function ProposalDialog({ oppId, proposal, onClose }: { oppId: string; proposal?: Proposal; onClose: () => void }) {
  const latest = proposal?.versions[0];
  const [v, setV] = useState({ title: '', kind: 'technical_financial', amount: latest?.amount ?? '', content: latest?.content ?? '' });
  const valid = useDate(latest?.validUntil ?? addDays(todayIso(), 30));
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <FormDialog size="lg" title={proposal ? `نسخه جدید پیشنهاد «${proposal.title}»` : 'پیشنهاد جدید'} done="پیشنهاد ذخیره شد" onClose={onClose} disabled={valid.bad}
      path={proposal ? `/opportunities/${oppId}/proposals/${proposal.id}/versions` : `/opportunities/${oppId}/proposals`}
      body={() => ({ ...(proposal ? {} : { title: v.title, kind: v.kind }), amount: v.amount || null, validUntil: valid.value || null, content: v.content })}>
      {(f) => (
        <div className="grid gap-4 sm:grid-cols-2">
          {!proposal && (
            <>
              <Field label="عنوان" required error={f.title}><Input value={v.title} onChange={(e) => set('title')(e.target.value)} /></Field>
              <Field label="نوع">
                <Select value={v.kind} onChange={(e) => set('kind')(e.target.value)}>{Object.entries(PROPOSAL_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
              </Field>
            </>
          )}
          <Field label="مبلغ پیشنهادی" error={f.amount}><MoneyInput value={v.amount} onChange={set('amount')} /></Field>
          <Field label="اعتبار تا" error={valid.bad ? 'تاریخ معتبر نیست' : f.validUntil}><DateInput value={valid.value} onChange={valid.onChange} /></Field>
          <Field label="شرح خدمات و شرایط" className="sm:col-span-2" error={f.content}><Textarea rows={8} value={v.content} onChange={(e) => set('content')(e.target.value)} /></Field>
        </div>
      )}
    </FormDialog>
  );
}

// ---------------------------------------------------------------- reports & settings

interface Report {
  leads: { total: number; converted: number; lost: number; conversionRate: number | null };
  opportunities: { won: number; won_value: string; lost: number; winRate: number | null };
  bySource: { source: string; leads: number; converted: number; won_value: string }[];
  pipeline: { id: string; name: string; count: number; value: string; weighted: string }[];
  byOwner: { owner_id: string | null; open: number; open_value: string; won: number; won_value: string; lost: number }[];
  lostReasons: { reason: string; n: number }[];
}

export function ReportsPage() {
  const a = useApi();
  const dir = useDirectory();
  const from = useDate(addDays(todayIso(), -90));
  const to = useDate(todayIso());
  const ok = !from.bad && !to.bad && !!from.value && !!to.value;
  const q = useQuery({ queryKey: ['crm', 'report', from.value, to.value], queryFn: () => a.get<Report>(`/reports/sales?from=${from.value}&to=${to.value}`), enabled: ok });
  return (
    <>
      <PageHeader title="گزارش فروش" />
      <CrmNav />
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <Field label="از تاریخ" error={from.bad ? 'تاریخ معتبر نیست' : undefined}><DateInput value={from.value} onChange={from.onChange} /></Field>
        <Field label="تا تاریخ" error={to.bad ? 'تاریخ معتبر نیست' : undefined}><DateInput value={to.value} onChange={to.onChange} /></Field>
      </div>
      <PageState query={q}>
        {q.data && (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="سرنخ‌های جدید" hint={`تبدیل‌شده: ${q.data.leads.converted.toLocaleString('fa-IR')}`}>{q.data.leads.total.toLocaleString('fa-IR')}</Stat>
              <Stat label="نرخ تبدیل سرنخ" hint="سرنخ‌های تبدیل‌شده به کل سرنخ‌های دوره">{pctText(q.data.leads.conversionRate)}</Stat>
              <Stat label="فرصت‌های برنده" hint={<Money value={q.data.opportunities.won_value} />}>{q.data.opportunities.won.toLocaleString('fa-IR')}</Stat>
              <Stat label="نرخ موفقیت" hint={`از دست رفته: ${q.data.opportunities.lost.toLocaleString('fa-IR')}`}>{pctText(q.data.opportunities.winRate)}</Stat>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="p-5">
                <h2 className="mb-3 font-semibold">قیف فعلی (فرصت‌های باز)</h2>
                <Table><thead><tr><Th>مرحله</Th><Th>تعداد</Th><Th>ارزش</Th><Th>ارزش وزنی</Th></tr></thead>
                  <tbody>{q.data.pipeline.map((s) => <tr key={s.id}><Td>{s.name}</Td><Td>{s.count.toLocaleString('fa-IR')}</Td><Td><Money value={s.value} /></Td><Td><Money value={s.weighted} /></Td></tr>)}</tbody></Table>
              </Card>
              <Card className="p-5">
                <h2 className="mb-3 font-semibold">منابع مؤثر جذب</h2>
                {!q.data.bySource.length ? <p className="text-sm text-muted">در این بازه سرنخی ثبت نشده است.</p> : (
                  <Table><thead><tr><Th>منبع</Th><Th>سرنخ</Th><Th>تبدیل</Th><Th>ارزش برنده</Th></tr></thead>
                    <tbody>{q.data.bySource.map((s) => <tr key={s.source}><Td>{SOURCE[s.source]}</Td><Td>{s.leads.toLocaleString('fa-IR')}</Td><Td>{s.converted.toLocaleString('fa-IR')}</Td><Td><Money value={s.won_value} /></Td></tr>)}</tbody></Table>
                )}
              </Card>
              <Card className="p-5">
                <h2 className="mb-3 font-semibold">عملکرد کارشناسان</h2>
                <Table><thead><tr><Th>کارشناس</Th><Th>باز</Th><Th>برنده</Th><Th>ارزش برنده</Th><Th>از دست رفته</Th></tr></thead>
                  <tbody>{q.data.byOwner.map((o) => <tr key={o.owner_id ?? 'none'}><Td>{dir.name(o.owner_id)}</Td><Td>{o.open.toLocaleString('fa-IR')}</Td><Td>{o.won.toLocaleString('fa-IR')}</Td><Td><Money value={o.won_value} /></Td><Td>{o.lost.toLocaleString('fa-IR')}</Td></tr>)}</tbody></Table>
              </Card>
              <Card className="p-5">
                <h2 className="mb-3 font-semibold">دلایل از دست رفتن</h2>
                {!q.data.lostReasons.length ? <p className="text-sm text-muted">فرصتی در این بازه از دست نرفته است.</p> : <ul className="space-y-1 text-sm">{q.data.lostReasons.map((r) => <li key={r.reason}>{r.reason} — {r.n.toLocaleString('fa-IR')}</li>)}</ul>}
              </Card>
            </div>
          </div>
        )}
      </PageState>
    </>
  );
}

export function SettingsPage() {
  const a = useApi();
  const q = useQuery({ queryKey: ['crm', 'stages'], queryFn: () => a.get<Stage[]>('/stages') });
  const [editing, setEditing] = useState<Stage | 'new' | null>(null);
  const act = useAct();
  return (
    <>
      <PageHeader title="مراحل قیف فروش" description="قیف باید دست‌کم یک مرحله باز، یک مرحله «برنده» و یک مرحله «از دست رفته» داشته باشد." actions={<Button onClick={() => setEditing('new')}><Plus className="size-4" /> مرحله جدید</Button>} />
      <CrmNav />
      <PageState query={q}>
        <Table>
          <thead><tr><Th>ترتیب</Th><Th>نام</Th><Th>نوع</Th><Th>احتمال</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
          <tbody>
            {q.data?.map((s) => (
              <tr key={s.id} className={s.archived ? 'opacity-60' : ''}>
                <Td>{s.sort.toLocaleString('fa-IR')}</Td><Td>{s.name}{s.archived && <Badge className="ms-2">بایگانی</Badge>}</Td>
                <Td>{s.kind === 'won' ? 'برنده' : s.kind === 'lost' ? 'از دست رفته' : 'باز'}</Td><Td>{`${s.probability.toLocaleString('fa-IR')}٪`}</Td>
                <Td><div className="flex gap-1"><Button size="sm" variant="secondary" onClick={() => setEditing(s)}>ویرایش</Button>
                  <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/stages/${s.id}/archive`, body: { archived: !s.archived } })}>{s.archived ? 'بازگردانی' : 'بایگانی'}</Button></div></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {editing && <StageDialog stage={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function StageDialog({ stage, onClose }: { stage?: Stage; onClose: () => void }) {
  const [v, setV] = useState({ name: stage?.name ?? '', probability: String(stage?.probability ?? 30), kind: stage?.kind ?? 'open', sort: String(stage?.sort ?? 35) });
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  return (
    <FormDialog title={stage ? `ویرایش «${stage.name}»` : 'مرحله جدید'} done="مرحله ذخیره شد" method="put" path={`/stages/${stage?.id ?? 'new'}`} onClose={onClose} body={() => v}>
      {(f) => (
        <>
          <Field label="نام" required error={f.name}><Input value={v.name} onChange={(e) => set('name')(e.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="نوع"><Select value={v.kind} onChange={(e) => set('kind')(e.target.value)}><option value="open">باز</option><option value="won">برنده</option><option value="lost">از دست رفته</option></Select></Field>
            <Field label="احتمال (٪)" error={f.probability}><Input dir="ltr" inputMode="numeric" value={v.probability} onChange={(e) => set('probability')(e.target.value)} /></Field>
            <Field label="ترتیب" error={f.sort}><Input dir="ltr" inputMode="numeric" value={v.sort} onChange={(e) => set('sort')(e.target.value)} /></Field>
          </div>
        </>
      )}
    </FormDialog>
  );
}
