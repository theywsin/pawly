import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Download, FileUp, Plus, Search, Trash2, Users } from 'lucide-react';
import {
  Alert, Badge, Button, Card, CardHeader, ConfirmDialog, DateInput, DateText, DayText, DescriptionList, Dialog, EmptyState, ExportMenu, Field, Input, Ltr, Money, MoneyInput, PageHeader, PageState, Select,
  Table, Tabs, Td, Textarea, Th, toast,
} from '@mohandesyar/ui';
import { useCan, useHost } from '@mohandesyar/module-sdk/web';
import { todayIso } from '@mohandesyar/persian';
import { BASE, CANDIDATE_STATUS, DEGREE, DUP_RULE, LEVEL, Nav, Score, SKILL_KIND, SOURCE, STAGE_KIND, fa, useApi, useServerErrors } from './common.js';

interface CandidateRow {
  id: string;
  full_name: string;
  desired_position: string;
  city: string;
  mobile: string | null;
  email: string | null;
  status: string;
  source: string;
  expected_salary: string | null;
  created_at: string;
  retention_until: string;
  skills: string[] | null;
  degree: string | null;
  duplicates: number;
  applications: number;
  years: number;
}

const FILTERS = { q: '', status: 'active', skill: '', degree: '', minYears: '', maxSalary: '', city: '' };

export function CandidatesPage() {
  const a = useApi();
  const canManage = useCan('recruitment.candidate.manage');
  const [draft, setDraft] = useState(FILTERS);
  const [f, setF] = useState(FILTERS);
  const [creating, setCreating] = useState(false);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '')).toString();
  const q = useQuery({ queryKey: ['recruitment', 'candidates', qs], queryFn: () => a.get<CandidateRow[]>(`/candidates?${qs}`) });
  const set = (k: keyof typeof FILTERS) => (v: string) => setDraft((s) => ({ ...s, [k]: v }));
  const filtered = qs !== new URLSearchParams(Object.entries(FILTERS).filter(([, v]) => v !== '')).toString();
  return (
    <>
      <PageHeader
        title="بانک رزومه و استخدام"
        actions={
          <>
            <ExportMenu
              filename="resumes"
              title="بانک رزومه"
              rows={q.data}
              columns={[
                { header: 'نام', value: (r) => r.full_name },
                { header: 'موقعیت مورد نظر', value: (r) => r.desired_position },
                { header: 'شهر', value: (r) => r.city },
                { header: 'همراه', value: (r) => r.mobile },
                { header: 'ایمیل', value: (r) => r.email },
                { header: 'بالاترین مدرک', value: (r) => (r.degree ? DEGREE[r.degree] : '') },
                { header: 'سابقه (سال)', value: (r) => r.years, kind: 'number' },
                { header: 'مهارت‌ها', value: (r) => (r.skills ?? []).join('، ') },
                { header: 'حقوق مورد انتظار (ریال)', value: (r) => r.expected_salary, kind: 'number' },
                { header: 'منبع', value: (r) => SOURCE[r.source] },
                { header: 'وضعیت', value: (r) => CANDIDATE_STATUS[r.status]?.label },
              ]}
            />
            {canManage && <Button onClick={() => setCreating(true)}><Plus className="size-4" /> ثبت رزومه</Button>}
          </>
        }
      />
      <Nav />
      <form
        className="mb-6 grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4 print:hidden"
        onSubmit={(e) => (e.preventDefault(), setF(draft))}
        role="search"
        aria-label="جست‌وجو و فیلتر رزومه‌ها"
      >
        <Field label="جست‌وجوی متنی" hint="نام، موقعیت، سوابق، پروژه‌ها، مهارت‌ها، همراه یا ایمیل" className="sm:col-span-2">
          <Input value={draft.q} onChange={(e) => set('q')(e.target.value)} placeholder="مثلاً: طراح سازه ETABS" />
        </Field>
        <Field label="مهارت یا نرم‌افزار"><Input value={draft.skill} onChange={(e) => set('skill')(e.target.value)} /></Field>
        <Field label="وضعیت">
          <Select value={draft.status} onChange={(e) => set('status')(e.target.value)}>
            <option value="active">فعال</option><option value="hired">استخدام‌شده</option><option value="archived">بایگانی</option><option value="all">همه</option>
          </Select>
        </Field>
        <Field label="حداقل مدرک">
          <Select value={draft.degree} onChange={(e) => set('degree')(e.target.value)}>
            <option value="">همه</option>
            {['diploma', 'associate', 'bachelor', 'master', 'phd'].map((d) => <option key={d} value={d}>{DEGREE[d]}</option>)}
          </Select>
        </Field>
        <Field label="حداقل سابقه (سال)"><Input inputMode="decimal" value={draft.minYears} onChange={(e) => set('minYears')(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
        <Field label="سقف حقوق مورد انتظار (ریال)"><MoneyInput value={draft.maxSalary} onChange={set('maxSalary')} /></Field>
        <Field label="شهر"><Input value={draft.city} onChange={(e) => set('city')(e.target.value)} /></Field>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
          <Button type="submit"><Search className="size-4" /> جست‌وجو</Button>
          {filtered && <Button type="button" variant="ghost" onClick={() => (setDraft(FILTERS), setF(FILTERS))}>پاک‌کردن فیلترها</Button>}
        </div>
      </form>
      <PageState
        query={q}
        isEmpty={q.data?.length === 0}
        empty={
          filtered ? (
            <EmptyState icon={<Search className="size-8" />} title="رزومه‌ای با این مشخصات یافت نشد" />
          ) : (
            <EmptyState icon={<Users className="size-8" />} title="هنوز رزومه‌ای ثبت نشده است" description="رزومه‌ها را با رضایت متقاضی ثبت کنید؛ پس از پایان مدت نگهداری خودکار حذف می‌شوند." action={canManage ? <Button onClick={() => setCreating(true)}>ثبت اولین رزومه</Button> : undefined} />
          )
        }
      >
        <Table>
          <thead><tr><Th>نام</Th><Th>موقعیت مورد نظر</Th><Th>مدرک</Th><Th>سابقه</Th><Th>مهارت‌های اصلی</Th><Th>شهر</Th><Th>وضعیت</Th></tr></thead>
          <tbody>
            {q.data?.map((c) => (
              <tr key={c.id}>
                <Td>
                  <Link to={`${BASE}/candidates/${c.id}`} className="font-medium text-primary underline-offset-4 hover:underline">{c.full_name}</Link>
                  {c.duplicates > 0 && <Badge tone="warning" className="ms-2">احتمال تکرار</Badge>}
                </Td>
                <Td>{c.desired_position || '—'}</Td>
                <Td>{c.degree ? DEGREE[c.degree] : '—'}</Td>
                <Td className="whitespace-nowrap">{c.years ? `${fa(c.years)} سال` : '—'}</Td>
                <Td className="max-w-64 truncate">{(c.skills ?? []).join('، ') || '—'}</Td>
                <Td>{c.city || '—'}</Td>
                <Td><Badge tone={CANDIDATE_STATUS[c.status]!.tone}>{CANDIDATE_STATUS[c.status]!.label}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {q.data?.length === 500 && <p className="mt-2 text-sm text-muted">فقط ۵۰۰ نتیجه نخست نمایش داده شد؛ جست‌وجو را دقیق‌تر کنید.</p>}
      </PageState>
      {creating && <CandidateForm onClose={() => setCreating(false)} />}
    </>
  );
}

// ---------------------------------------------------------------- detail

interface Detail {
  candidate: {
    id: string; full_name: string; mobile: string | null; email: string | null; city: string; desired_position: string; expected_salary: string | null; available_from: string | null; referrer: string;
    source: string; portfolio_url: string; summary: string; consent_on: string; consent_note: string; retention_until: string; status: string; merged_into: string | null; created_at: string;
  };
  educations: { id: string; degree: string; field: string; institution: string; end_year: number | null }[];
  experiences: { id: string; employer: string; title: string; started_on: string; ended_on: string | null; description: string }[];
  projects: { id: string; title: string; role: string; client: string; year: number | null; description: string }[];
  skills: { id: string; kind: string; name: string; level: number; detail: string }[];
  files: { id: string; kind: string; name: string; size: number; created_at: string }[];
  applications: { id: string; job_id: string; job_title: string; stage_name: string; stage_kind: string; score: number | null; created_at: string; hired_on: string | null }[];
  duplicates: { id: string; rules: string[]; other_id: string; other_name: string }[];
}

const FILE_KIND: Record<string, string> = { resume: 'رزومه', portfolio: 'نمونه‌کار', certificate: 'مدرک/گواهی', other: 'سایر' };
const size = (b: number) => (b > 1048576 ? `${fa(b / 1048576)} مگابایت` : `${fa(Math.max(1, Math.round(b / 1024)), 0)} کیلوبایت`);

export function CandidatePage() {
  const { id } = useParams();
  const a = useApi();
  const qc = useQueryClient();
  const nav = useNavigate();
  const canManage = useCan('recruitment.candidate.manage');
  const [tab, setTab] = useState('resume');
  const [editing, setEditing] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [consent, setConsent] = useState(false);
  const q = useQuery({ queryKey: ['recruitment', 'candidate', id], queryFn: () => a.get<Detail>(`/candidates/${id}`) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['recruitment'] });
  const status = useMutation({ mutationFn: (s: string) => a.put(`/candidates/${id}/status`, { status: s }), onSuccess: () => (toast('وضعیت ذخیره شد'), refresh()) });
  const erase = useMutation({
    mutationFn: () => a.del(`/candidates/${id}`),
    onSuccess: () => (toast('اطلاعات شخصی و فایل‌های متقاضی حذف شد'), refresh(), nav(`${BASE}/candidates`)),
  });
  const d = q.data;
  const c = d?.candidate;
  return (
    <>
      <Link to={`${BASE}/candidates`} className="mb-3 inline-flex items-center gap-1 text-sm text-primary print:hidden"><ArrowRight className="size-4" /> بانک رزومه</Link>
      <PageState query={q}>
        {d && c && (
          <>
            <PageHeader
              title={c.full_name}
              description={c.desired_position || undefined}
              actions={
                canManage && c.status !== 'merged' && (
                  <>
                    <Button variant="secondary" onClick={() => setEditing(true)}>ویرایش رزومه</Button>
                    {c.status === 'archived' ? (
                      <Button variant="ghost" loading={status.isPending} onClick={() => status.mutate('active')}>بازگردانی از بایگانی</Button>
                    ) : (
                      c.status === 'active' && <Button variant="ghost" loading={status.isPending} onClick={() => status.mutate('archived')}>بایگانی</Button>
                    )}
                    <Button variant="ghost" onClick={() => setErasing(true)}><Trash2 className="size-4" /> حذف به درخواست متقاضی</Button>
                  </>
                )
              }
            />
            {c.status === 'merged' && <Alert tone="info" className="mb-4">این رزومه در رزومه دیگری ادغام شده است. <Link className="underline" to={`${BASE}/candidates/${c.merged_into}`}>مشاهده رزومه اصلی</Link></Alert>}
            {d.duplicates.length > 0 && (
              <Alert tone="warning" className="mb-4" title="احتمال رزومه تکراری">
                {d.duplicates.map((x) => <span key={x.id} className="me-3 inline-block"><Link className="underline" to={`${BASE}/candidates/${x.other_id}`}>{x.other_name}</Link> ({x.rules.map((r) => DUP_RULE[r]).join('، ')})</span>)}
                {canManage && <Link to={`${BASE}/duplicates`} className="font-semibold underline">بررسی و ادغام</Link>}
              </Alert>
            )}
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="min-w-0 lg:col-span-1">
                <CardHeader title="مشخصات" />
                <div className="p-5">
                  <DescriptionList
                    items={[
                      { label: 'وضعیت', value: <Badge tone={CANDIDATE_STATUS[c.status]!.tone}>{CANDIDATE_STATUS[c.status]!.label}</Badge> },
                      { label: 'همراه', value: c.mobile ? <Ltr>{c.mobile}</Ltr> : '—' },
                      { label: 'ایمیل', value: c.email ? <Ltr>{c.email}</Ltr> : '—' },
                      { label: 'شهر', value: c.city || '—' },
                      { label: 'حقوق مورد انتظار', value: c.expected_salary ? <Money value={c.expected_salary} /> : '—' },
                      { label: 'آمادگی شروع', value: c.available_from ? <DayText value={c.available_from} /> : '—' },
                      { label: 'منبع', value: SOURCE[c.source] },
                      { label: 'معرف', value: c.referrer || '—' },
                      { label: 'نمونه‌کار', value: c.portfolio_url ? <a href={c.portfolio_url} target="_blank" rel="noreferrer noopener" className="text-primary underline"><Ltr>{c.portfolio_url}</Ltr></a> : '—' },
                      { label: 'رضایت متقاضی', value: <><DayText value={c.consent_on} />{c.consent_note && <span className="block text-xs text-muted">{c.consent_note}</span>}</> },
                      {
                        label: 'نگهداری تا',
                        value: (
                          <span>
                            <DayText value={c.retention_until} />
                            {canManage && <button type="button" className="ms-2 text-xs text-primary underline" onClick={() => setConsent(true)}>تمدید با رضایت جدید</button>}
                          </span>
                        ),
                      },
                    ]}
                  />
                </div>
              </Card>
              <div className="min-w-0 lg:col-span-2">
                <Tabs
                  label="بخش‌های رزومه"
                  value={tab}
                  onChange={setTab}
                  items={[
                    { key: 'resume', label: 'سوابق و تحصیلات' },
                    { key: 'skills', label: 'مهارت‌ها', count: d.skills.length },
                    { key: 'files', label: 'فایل‌ها', count: d.files.length },
                    { key: 'apps', label: 'موقعیت‌های شغلی', count: d.applications.length },
                  ]}
                />
                {tab === 'resume' && <ResumeView d={d} />}
                {tab === 'skills' && <SkillsView skills={d.skills} />}
                {tab === 'files' && <FilesView id={c.id} files={d.files} canManage={canManage && c.status !== 'merged'} />}
                {tab === 'apps' && <ApplicationsView d={d} />}
              </div>
            </div>
            {editing && <CandidateForm detail={d} onClose={() => setEditing(false)} />}
            {consent && <ConsentDialog id={c.id} onClose={() => setConsent(false)} />}
            <ConfirmDialog
              open={erasing}
              onOpenChange={setErasing}
              title="حذف اطلاعات متقاضی"
              description="اطلاعات شخصی، سوابق و فایل‌های این متقاضی برای همیشه حذف می‌شود. فقط آمار بی‌نام (تعداد درخواست‌ها و مراحل) باقی می‌ماند. این کار برگشت‌پذیر نیست."
              confirmLabel="حذف دائمی"
              confirmText={c.full_name}
              loading={erase.isPending}
              onConfirm={() => erase.mutate()}
            />
          </>
        )}
      </PageState>
    </>
  );
}

function Section({ title, empty, children }: { title: string; empty: boolean; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 font-semibold">{title}</h2>
      {empty ? <p className="text-sm text-muted">ثبت نشده است.</p> : children}
    </section>
  );
}

type ResumeParts = {
  educations: Omit<Detail['educations'][number], 'id'>[];
  experiences: Omit<Detail['experiences'][number], 'id'>[];
  projects: Omit<Detail['projects'][number], 'id'>[];
  candidate?: { summary: string };
};

export function ResumeView({ d }: { d: ResumeParts }) {
  return (
    <>
      {d.candidate?.summary && <Section title="خلاصه" empty={false}><p className="whitespace-pre-line text-sm">{d.candidate.summary}</p></Section>}
      <Section title="سوابق کاری" empty={!d.experiences.length}>
        <ol className="space-y-3">
          {d.experiences.map((e, i) => (
            <li key={i} className="rounded-lg border border-border p-3 text-sm">
              <div className="font-medium">{e.title} — {e.employer}</div>
              <div className="text-muted"><DayText value={e.started_on} /> تا {e.ended_on ? <DayText value={e.ended_on} /> : 'اکنون'}</div>
              {e.description && <p className="mt-1 whitespace-pre-line">{e.description}</p>}
            </li>
          ))}
        </ol>
      </Section>
      <Section title="تحصیلات" empty={!d.educations.length}>
        <ul className="space-y-1 text-sm">
          {d.educations.map((e, i) => <li key={i}>{DEGREE[e.degree]} {e.field}{e.institution && ` — ${e.institution}`}{e.end_year && <span className="text-muted"> ({fa(e.end_year, 0).replace(/٬/g, '')})</span>}</li>)}
        </ul>
      </Section>
      <Section title="پروژه‌ها" empty={!d.projects.length}>
        <ul className="space-y-2 text-sm">
          {d.projects.map((p, i) => (
            <li key={i}>
              <span className="font-medium">{p.title}</span>
              {p.role && ` — ${p.role}`}{p.client && <span className="text-muted"> (کارفرما: {p.client})</span>}{p.year && <span className="text-muted"> {fa(p.year, 0).replace(/٬/g, '')}</span>}
              {p.description && <p className="whitespace-pre-line text-muted">{p.description}</p>}
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

export function SkillsView({ skills }: { skills: { kind: string; name: string; level: number; detail?: string }[] }) {
  if (!skills.length) return <p className="text-sm text-muted">مهارتی ثبت نشده است.</p>;
  return (
    <div className="space-y-4">
      {Object.keys(SKILL_KIND).map((k) => {
        const list = skills.filter((s) => s.kind === k);
        if (!list.length) return null;
        return (
          <section key={k}>
            <h2 className="mb-2 font-semibold">{SKILL_KIND[k]}</h2>
            <ul className="flex flex-wrap gap-2">
              {list.map((s, i) => <li key={i} className="rounded-full border border-border px-3 py-1 text-sm">{s.name} <span className="text-muted">· {LEVEL[s.level]}</span>{s.detail && <span className="text-muted"> · {s.detail}</span>}</li>)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function FilesView({ id, files, canManage }: { id: string; files: Detail['files']; canManage: boolean }) {
  const a = useApi();
  const host = useHost();
  const qc = useQueryClient();
  const [kind, setKind] = useState('resume');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const upload = async (file: File) => {
    if (!host.upload) return;
    setBusy(true);
    try {
      const up = await host.upload(file, { module: 'recruitment', confidentiality: 'confidential' });
      await a.post(`/candidates/${id}/files`, { fileId: up.id, kind });
      toast('فایل بارگذاری شد');
      void qc.invalidateQueries({ queryKey: ['recruitment', 'candidate', id] });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'بارگذاری ممکن نشد', 'danger');
    } finally {
      setBusy(false);
    }
  };
  const download = async (fid: string) => {
    const r = await a.get<{ url: string }>(`/candidates/${id}/files/${fid}/url`);
    window.location.assign(r.url);
  };
  const remove = useMutation({
    mutationFn: (fid: string) => a.del(`/candidates/${id}/files/${fid}`),
    onSuccess: () => (toast('فایل حذف شد'), setRemoving(null), void qc.invalidateQueries({ queryKey: ['recruitment', 'candidate', id] })),
  });
  return (
    <>
      {canManage && (
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-border p-4">
          <Field label="نوع فایل"><Select value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(FILE_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-fg focus-within:outline focus-within:outline-2">
            <FileUp className="size-4" /> {busy ? 'در حال بارگذاری…' : 'انتخاب و بارگذاری فایل'}
            <input type="file" className="sr-only" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
          </label>
          <p className="w-full text-xs text-muted">فایل‌ها محرمانه نگهداری می‌شوند و هر دانلود ثبت می‌شود. حداکثر ۵۰ مگابایت.</p>
        </div>
      )}
      {files.length === 0 ? (
        <p className="text-sm text-muted">فایلی پیوست نشده است.</p>
      ) : (
        <Table>
          <thead><tr><Th>نام فایل</Th><Th>نوع</Th><Th>حجم</Th><Th>تاریخ</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id}>
                <Td><Ltr>{f.name}</Ltr></Td><Td>{FILE_KIND[f.kind]}</Td><Td>{size(f.size)}</Td><Td><DateText value={f.created_at} /></Td>
                <Td className="whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => void download(f.id)}><Download className="size-4" /> دانلود</Button>
                  {canManage && <Button size="sm" variant="ghost" onClick={() => setRemoving(f.id)} aria-label={`حذف ${f.name}`}><Trash2 className="size-4" /></Button>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title="حذف فایل" description="فایل برای همیشه حذف می‌شود." confirmLabel="حذف" loading={remove.isPending} onConfirm={() => removing && remove.mutate(removing)} />
    </>
  );
}

function ApplicationsView({ d }: { d: Detail }) {
  const canApps = useCan('recruitment.application.manage');
  const [adding, setAdding] = useState(false);
  return (
    <>
      {canApps && d.candidate.status !== 'merged' && <Button className="mb-4" variant="secondary" onClick={() => setAdding(true)}><Plus className="size-4" /> افزودن به موقعیت شغلی</Button>}
      {d.applications.length === 0 ? (
        <p className="text-sm text-muted">برای هیچ موقعیتی بررسی نشده است.</p>
      ) : (
        <Table>
          <thead><tr><Th>موقعیت</Th><Th>مرحله</Th><Th>امتیاز کمکی</Th><Th>تاریخ</Th></tr></thead>
          <tbody>
            {d.applications.map((x) => (
              <tr key={x.id}>
                <Td>{canApps ? <Link className="text-primary underline-offset-4 hover:underline" to={`${BASE}/jobs/${x.job_id}?app=${x.id}`}>{x.job_title}</Link> : x.job_title}</Td>
                <Td><Badge tone={STAGE_KIND[x.stage_kind]!.tone}>{x.stage_name}</Badge></Td>
                <Td><Score value={x.score} /></Td>
                <Td><DateText value={x.created_at} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {adding && <AddToJob candidateId={d.candidate.id} onClose={() => setAdding(false)} />}
    </>
  );
}

function AddToJob({ candidateId, onClose }: { candidateId: string; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const jobs = useQuery({ queryKey: ['recruitment', 'jobs'], queryFn: () => a.get<{ id: string; title: string; status: string }[]>('/jobs') });
  const [jobId, setJobId] = useState('');
  const add = useMutation({
    mutationFn: () => a.post<{ added: number }>(`/jobs/${jobId}/applications`, { candidateIds: [candidateId] }),
    onSuccess: (r) => (toast(r.added ? 'به قیف استخدام اضافه شد' : 'این متقاضی قبلاً برای این موقعیت ثبت شده است'), void qc.invalidateQueries({ queryKey: ['recruitment'] }), onClose()),
    onError: err.set,
  });
  const open = (jobs.data ?? []).filter((j) => j.status !== 'closed');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="افزودن به موقعیت شغلی"
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!jobId} loading={add.isPending} onClick={() => (err.clear(), add.mutate())}>افزودن</Button></>}>
      {err.banner}
      {jobs.isPending ? <p className="text-sm text-muted">در حال بارگذاری…</p> : open.length === 0 ? <p className="text-sm text-muted">موقعیت شغلی بازی وجود ندارد.</p> : (
        <Field label="موقعیت شغلی" required>
          <Select value={jobId} onChange={(e) => setJobId(e.target.value)}><option value="">انتخاب کنید</option>{open.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}</Select>
        </Field>
      )}
    </Dialog>
  );
}

function ConsentDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [on, setOn] = useState<string | null>(todayIso());
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () => a.put<{ retentionUntil: string }>(`/candidates/${id}/consent`, { consentOn: on, consentNote: note }),
    onSuccess: () => (toast('مدت نگهداری تمدید شد'), void qc.invalidateQueries({ queryKey: ['recruitment', 'candidate', id] }), onClose()),
    onError: err.set,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="تمدید مدت نگهداری"
      description="فقط وقتی متقاضی دوباره رضایت داده است تمدید کنید؛ مدت نگهداری از تاریخ رضایت جدید محاسبه می‌شود."
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button disabled={!on} loading={save.isPending} onClick={() => (err.clear(), save.mutate())}>ثبت رضایت</Button></>}>
      {err.banner}
      <div className="grid gap-4">
        <Field label="تاریخ رضایت جدید" required><DateInput value={on} onChange={setOn} /></Field>
        <Field label="شرح رضایت" hint="مثلاً: تأیید تلفنی در تماس پیگیری"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- form

type Edu = { degree: string; field: string; institution: string; endYear: string };
type Exp = { employer: string; title: string; startedOn: string | null; endedOn: string | null; description: string };
type Proj = { title: string; role: string; client: string; year: string; description: string };
type Skill = { kind: string; name: string; level: number; detail: string };

const toFaYear = (y: number | null) => (y ? String(y) : '');
const latin = (s: string) => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const yearOrNull = (s: string) => (s.trim() ? Number(latin(s.trim())) : null);

function Rows<T>({ title, items, onChange, blank, render, addLabel }: { title: string; items: T[]; onChange: (v: T[]) => void; blank: T; render: (item: T, set: (patch: Partial<T>) => void, i: number) => ReactNode; addLabel: string }) {
  return (
    <fieldset className="rounded-lg border border-border p-4">
      <legend className="px-1 font-semibold">{title}</legend>
      <div className="space-y-4">
        {items.map((it, i) => (
          <div key={i} className="relative rounded-md bg-surface-2 p-3 pe-12">
            {render(it, (p) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x))), i)}
            <Button type="button" size="sm" variant="ghost" className="absolute end-1 top-1" aria-label={`حذف ردیف ${i + 1} از ${title}`} onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
          </div>
        ))}
      </div>
      <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={() => onChange([...items, { ...blank }])}><Plus className="size-4" /> {addLabel}</Button>
    </fieldset>
  );
}

export function CandidateForm({ detail, onClose }: { detail?: Detail; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const nav = useNavigate();
  const err = useServerErrors();
  const c = detail?.candidate;
  const [v, setV] = useState({
    fullName: c?.full_name ?? '', mobile: c?.mobile ?? '', email: c?.email ?? '', city: c?.city ?? '', desiredPosition: c?.desired_position ?? '', expectedSalary: c?.expected_salary ?? '',
    referrer: c?.referrer ?? '', source: c?.source ?? 'manual', portfolioUrl: c?.portfolio_url ?? '', summary: c?.summary ?? '', consentNote: c?.consent_note ?? '',
  });
  const [availableFrom, setAvailableFrom] = useState<string | null>(c?.available_from ?? null);
  const [consentOn, setConsentOn] = useState<string | null>(c?.consent_on ?? todayIso());
  const [edus, setEdus] = useState<Edu[]>(detail?.educations.map((e) => ({ degree: e.degree, field: e.field, institution: e.institution, endYear: toFaYear(e.end_year) })) ?? []);
  const [exps, setExps] = useState<Exp[]>(detail?.experiences.map((e) => ({ employer: e.employer, title: e.title, startedOn: e.started_on, endedOn: e.ended_on, description: e.description })) ?? []);
  const [projs, setProjs] = useState<Proj[]>(detail?.projects.map((p) => ({ title: p.title, role: p.role, client: p.client, year: toFaYear(p.year), description: p.description })) ?? []);
  const [skills, setSkills] = useState<Skill[]>(detail?.skills.map((s) => ({ kind: s.kind, name: s.name, level: s.level, detail: s.detail })) ?? []);
  const set = (k: keyof typeof v) => (x: string) => setV((s) => ({ ...s, [k]: x }));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...v, expectedSalary: v.expectedSalary ? Number(v.expectedSalary) : null, availableFrom, consentOn,
        educations: edus.map((e) => ({ ...e, endYear: yearOrNull(e.endYear) })),
        experiences: exps,
        projects: projs.map((p) => ({ ...p, year: yearOrNull(p.year) })),
        skills,
      };
      return c ? a.put<{ id: string; duplicates: number }>(`/candidates/${c.id}`, body) : a.post<{ id: string; duplicates: number }>('/candidates', body);
    },
    onSuccess: (r) => {
      toast(r.duplicates ? 'ذخیره شد؛ رزومه مشابهی وجود دارد — بخش «رزومه‌های تکراری» را بررسی کنید' : 'رزومه ذخیره شد');
      void qc.invalidateQueries({ queryKey: ['recruitment'] });
      onClose();
      if (!c) nav(`${BASE}/candidates/${r.id}`);
    },
    onError: err.set,
  });
  const f = err.fields;
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={c ? 'ویرایش رزومه' : 'ثبت رزومه'}
      description="سن، جنسیت، وضعیت تأهل، قومیت، مذهب و سلامت ثبت نمی‌شوند و در امتیازدهی نقشی ندارند."
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} disabled={!consentOn} onClick={() => (err.clear(), save.mutate())}>ذخیره</Button></>}>
      {err.banner}
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام و نام خانوادگی" required error={f.fullName}><Input value={v.fullName} onChange={(e) => set('fullName')(e.target.value)} /></Field>
          <Field label="موقعیت مورد نظر" error={f.desiredPosition}><Input value={v.desiredPosition} onChange={(e) => set('desiredPosition')(e.target.value)} /></Field>
          <Field label="شماره همراه" error={f.mobile} hint="همراه یا ایمیل، دست‌کم یکی"><Input dir="ltr" inputMode="tel" value={v.mobile} onChange={(e) => set('mobile')(e.target.value)} /></Field>
          <Field label="ایمیل" error={f.email}><Input dir="ltr" type="email" value={v.email} onChange={(e) => set('email')(e.target.value)} /></Field>
          <Field label="شهر محل سکونت"><Input value={v.city} onChange={(e) => set('city')(e.target.value)} /></Field>
          <Field label="حقوق مورد انتظار ماهانه (ریال)" error={f.expectedSalary}><MoneyInput value={v.expectedSalary} onChange={set('expectedSalary')} /></Field>
          <Field label="آمادگی شروع از" error={f.availableFrom}><DateInput value={availableFrom} onChange={setAvailableFrom} /></Field>
          <Field label="منبع رزومه"><Select value={v.source} onChange={(e) => set('source')(e.target.value)}>{Object.entries(SOURCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="معرف"><Input value={v.referrer} onChange={(e) => set('referrer')(e.target.value)} /></Field>
          <Field label="نشانی نمونه‌کار" error={f.portfolioUrl}><Input dir="ltr" value={v.portfolioUrl} onChange={(e) => set('portfolioUrl')(e.target.value)} placeholder="https://" /></Field>
          <Field label="خلاصه رزومه" className="sm:col-span-2"><Textarea rows={3} value={v.summary} onChange={(e) => set('summary')(e.target.value)} /></Field>
        </div>
        <Rows title="سوابق کاری" items={exps} onChange={setExps} addLabel="افزودن سابقه" blank={{ employer: '', title: '', startedOn: null, endedOn: null, description: '' }}
          render={(e, s, i) => (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="سازمان" required error={f[`experiences.${i}.employer`]}><Input value={e.employer} onChange={(x) => s({ employer: x.target.value })} /></Field>
              <Field label="عنوان شغل" required error={f[`experiences.${i}.title`]}><Input value={e.title} onChange={(x) => s({ title: x.target.value })} /></Field>
              <Field label="از تاریخ" required error={f[`experiences.${i}.startedOn`]}><DateInput value={e.startedOn} onChange={(x) => s({ startedOn: x })} /></Field>
              <Field label="تا تاریخ" hint="خالی یعنی هنوز مشغول است" error={f[`experiences.${i}.endedOn`]}><DateInput value={e.endedOn} onChange={(x) => s({ endedOn: x })} /></Field>
              <Field label="شرح وظایف و دستاوردها" className="sm:col-span-2"><Textarea rows={2} value={e.description} onChange={(x) => s({ description: x.target.value })} /></Field>
            </div>
          )}
        />
        <Rows title="تحصیلات" items={edus} onChange={setEdus} addLabel="افزودن مدرک" blank={{ degree: 'bachelor', field: '', institution: '', endYear: '' }}
          render={(e, s, i) => (
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="مقطع"><Select value={e.degree} onChange={(x) => s({ degree: x.target.value })}>{Object.entries(DEGREE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
              <Field label="رشته" required error={f[`educations.${i}.field`]}><Input value={e.field} onChange={(x) => s({ field: x.target.value })} /></Field>
              <Field label="دانشگاه / مؤسسه"><Input value={e.institution} onChange={(x) => s({ institution: x.target.value })} /></Field>
              <Field label="سال فراغت (شمسی)" error={f[`educations.${i}.endYear`]}><Input inputMode="numeric" value={e.endYear} onChange={(x) => s({ endYear: x.target.value })} placeholder="۱۳۹۸" /></Field>
            </div>
          )}
        />
        <Rows title="پروژه‌ها" items={projs} onChange={setProjs} addLabel="افزودن پروژه" blank={{ title: '', role: '', client: '', year: '', description: '' }}
          render={(p, s, i) => (
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="عنوان پروژه" required error={f[`projects.${i}.title`]} className="sm:col-span-2"><Input value={p.title} onChange={(x) => s({ title: x.target.value })} /></Field>
              <Field label="نقش"><Input value={p.role} onChange={(x) => s({ role: x.target.value })} /></Field>
              <Field label="سال (شمسی)" error={f[`projects.${i}.year`]}><Input inputMode="numeric" value={p.year} onChange={(x) => s({ year: x.target.value })} /></Field>
              <Field label="کارفرما" className="sm:col-span-2"><Input value={p.client} onChange={(x) => s({ client: x.target.value })} /></Field>
              <Field label="شرح" className="sm:col-span-2"><Input value={p.description} onChange={(x) => s({ description: x.target.value })} /></Field>
            </div>
          )}
        />
        <Rows title="مهارت‌ها، نرم‌افزارها، گواهینامه‌ها و زبان‌ها" items={skills} onChange={setSkills} addLabel="افزودن مورد" blank={{ kind: 'software', name: '', level: 3, detail: '' }}
          render={(k, s, i) => (
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="نوع"><Select value={k.kind} onChange={(x) => s({ kind: x.target.value })}>{Object.entries(SKILL_KIND).map(([key, l]) => <option key={key} value={key}>{l}</option>)}</Select></Field>
              <Field label="نام" required error={f[`skills.${i}.name`]}><Input value={k.name} onChange={(x) => s({ name: x.target.value })} /></Field>
              <Field label="سطح"><Select value={k.level} onChange={(x) => s({ level: Number(x.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{LEVEL[n]}</option>)}</Select></Field>
              <Field label="توضیح"><Input value={k.detail} onChange={(x) => s({ detail: x.target.value })} placeholder={k.kind === 'certificate' ? 'مرجع صدور' : ''} /></Field>
            </div>
          )}
        />
        <fieldset className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
          <legend className="px-1 font-semibold">رضایت متقاضی</legend>
          <Field label="تاریخ رضایت برای نگهداری رزومه" required error={f.consentOn} hint="مدت نگهداری از این تاریخ محاسبه می‌شود"><DateInput value={consentOn} onChange={setConsentOn} /></Field>
          <Field label="شرح رضایت" hint="مثلاً: فرم رضایت امضاشده، ایمیل متقاضی"><Input value={v.consentNote} onChange={(e) => set('consentNote')(e.target.value)} /></Field>
        </fieldset>
      </div>
    </Dialog>
  );
}
