import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus } from 'lucide-react';
import { Badge, Button, Card, DayText, DescriptionList, EmptyState, Money, PageHeader, PageState, ProgressBar, Stat, Table, Tabs, Td, Th, toast } from '@mohandesyar/ui';
import { ApiError, useCan, useDirectory } from '@mohandesyar/module-sdk/web';
import { todayIso } from '@mohandesyar/persian';
import { Gantt, SCurve, type GanttRow } from './charts.js';
import { CHANGE_STATUS, DEP_TYPE, ISSUE_KIND, MEMBER_ROLE, pct, PHASE_KIND, STATUS, TYPE, useApi, type ProjectData, type Progress } from './common.js';
import { ActivityDialog, ChangeRequestDialog, DailyReportDialog, DependencyDialog, IssueDialog, MemberDialog, PhaseDialog, PhaseStatusDialog, ProgressDialog, RiskDialog, type ActivityLite } from './dialogs.js';
import { ProjectForm } from './ProjectForm.js';

type Activity = ActivityLite & { progress: string; planned_start: string | null; planned_finish: string | null; total_float: number | null; critical: boolean; actual_start: string | null; actual_finish: string | null };
interface Detail {
  project: ProjectData;
  progress: Progress;
  computedFinish: string | null;
  members: { id: string; user_id: string; role: string }[];
  activities: Activity[];
  dependencies: { id: string; predecessor_id: string; successor_id: string; type: string; lag_days: number }[];
  phases: { id: string; kind: string; name: string; planned_date: string | null; delivered_on: string | null; client_approved_on: string | null; notes: string }[];
  issues: { id: string; kind: string; title: string; cause: string; impact_days: number; owner_id: string | null; due_on: string | null; status: string; resolved_on: string | null }[];
  risks: { id: string; title: string; probability: number; impact: number; score: number; response: string; owner_id: string | null; status: string }[];
  reports: { id: string; report_date: string; weather: string; workforce: number; equipment: string; work_done: string; problems: string; created_by: string }[];
  changes: { id: string; number: number; title: string; cost_impact: string; time_impact_days: number; status: string }[];
  can: { update: boolean; schedule: boolean; progress: boolean; change: boolean };
  linked: { contracts: { id: string; code: string; title: string; status: string; current_amount: string; approved_gross: string }[] | null; account: { id: string; title: string } | null };
}

/** Activities in WBS order (parents before children) with their depth. */
function wbs(acts: Activity[]): (Activity & { depth: number; code: string })[] {
  const byParent = new Map<string | null, Activity[]>();
  for (const a of acts) byParent.set(a.parent_id, [...(byParent.get(a.parent_id) ?? []), a]);
  const out: (Activity & { depth: number; code: string })[] = [];
  const walk = (parent: string | null, depth: number, prefix: string) =>
    (byParent.get(parent) ?? []).forEach((a, i) => {
      const code = `${prefix}${i + 1}`;
      out.push({ ...a, depth, code });
      walk(a.id, depth + 1, `${code}.`);
    });
  walk(null, 0, '');
  return out;
}

export function ProjectDetail() {
  const { id = '' } = useParams();
  const a = useApi();
  const qc = useQueryClient();
  const dir = useDirectory();
  const canDelete = useCan('projects.project.delete');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const today = todayIso();
  const q = useQuery({ queryKey: ['projects', 'detail', id], queryFn: () => a.get<Detail>(`/projects/${id}`) });
  const curve = useQuery({ queryKey: ['projects', 'curve', id], queryFn: () => a.get<{ points: { date: string; planned: number; actual: number | null }[]; reason?: string }>(`/projects/${id}/curve`), enabled: tab === 'overview' });
  const [dialog, setDialog] = useState<null | { kind: string; payload?: unknown }>(null);
  const close = () => setDialog(null);
  const act = useMutation({
    mutationFn: ({ path, method = 'post', body }: { path: string; method?: 'post' | 'del'; body?: unknown }) => (method === 'del' ? a.del(path) : a.post(path, body)),
    onSuccess: () => (toast('انجام شد'), void qc.invalidateQueries({ queryKey: ['projects'] }), void qc.invalidateQueries({ queryKey: ['widget'] })),
    onError: (e) => toast(e instanceof ApiError ? e.message : 'انجام نشد', 'danger'),
  });
  const ordered = useMemo(() => wbs(q.data?.activities ?? []), [q.data?.activities]);
  const nameOf = (aid: string) => q.data?.activities.find((x) => x.id === aid)?.name ?? '—';

  return (
    <PageState query={q}>
      {q.data && (() => {
        const { project: p, progress, can } = q.data;
        const items = [
          { key: 'overview', label: 'خلاصه' },
          { key: 'schedule', label: 'برنامه و فعالیت‌ها', count: q.data.activities.length },
          { key: 'gantt', label: 'گانت' },
          { key: 'team', label: 'تیم', count: q.data.members.length },
          { key: 'phases', label: 'مراحل و تحویل', count: q.data.phases.length },
          { key: 'issues', label: 'تأخیرها و موانع', count: q.data.issues.filter((i) => i.status === 'open').length },
          { key: 'risks', label: 'ریسک‌ها', count: q.data.risks.filter((r) => r.status === 'open').length },
          { key: 'reports', label: 'گزارش روزانه', count: q.data.reports.length },
          { key: 'changes', label: 'درخواست تغییر', count: q.data.changes.length },
        ];
        const gantt: GanttRow[] = ordered.map((x) => ({ id: x.id, name: `${x.code.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!)} ${x.name}`, depth: x.depth, leaf: x.leaf, start: x.planned_start, finish: x.planned_finish, progress: Number(x.progress), critical: x.critical, milestone: x.leaf && x.duration_days === 0 }));
        const add = (kind: string, label: string, enabled: boolean) => enabled && <Button size="sm" onClick={() => setDialog({ kind })}><Plus className="size-4" /> {label}</Button>;
        return (
          <>
            <Link to=".." relative="path" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-text"><ArrowRight className="size-4" /> همه پروژه‌ها</Link>
            <PageHeader
              title={<span className="flex flex-wrap items-center gap-3"><bdi>{p.code}</bdi> — {p.title} <Badge tone={STATUS[p.status]!.tone}>{STATUS[p.status]!.label}</Badge></span>}
              description={`${TYPE[p.project_type]} · کارفرما: ${q.data.linked.account?.title ?? (p.employer_name || '—')} · مدیر پروژه: ${dir.name(p.manager_id)}`}
              actions={<div className="flex gap-2">
                {can.update && <Button variant="secondary" onClick={() => setDialog({ kind: 'edit' })}>ویرایش</Button>}
                {canDelete && <Button variant="ghost" onClick={() => act.mutate({ path: `/projects/${p.id}`, method: 'del' }, { onSuccess: () => history.back() })}>حذف</Button>}
              </div>}
            />
            <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="پیشرفت فیزیکی واقعی" hint={`برنامه‌ای: ${pct(progress.planned)}`}>{pct(progress.actual)}</Stat>
              <Stat label="پیشرفت زمانی" hint="روزهای سپری‌شده از مدت برنامه‌ای">{pct(progress.time)}</Stat>
              <Stat label="پیشرفت مالی" hint={progress.financial === null ? 'نیازمند قرارداد درآمدی متصل (ماژول قراردادها)' : 'کارکرد تأییدشده به مبلغ قراردادها'}>{pct(progress.financial)}</Stat>
              <Stat label="پایان طبق برنامه زمان‌بندی" hint={p.planned_finish ? 'پایان قراردادی در مشخصات پروژه' : undefined}>
                <DayText value={q.data.computedFinish} />
                {q.data.computedFinish && p.planned_finish && q.data.computedFinish > p.planned_finish && <Badge tone="danger" className="ms-2">بعد از موعد</Badge>}
              </Stat>
            </div>
            <Tabs label="بخش‌های پروژه" items={items} value={tab} onChange={(k) => setParams(k === 'overview' ? {} : { tab: k }, { replace: true })} />

            {tab === 'overview' && (
              <div className="grid gap-6 lg:grid-cols-2">
                <Card className="p-5">
                  <h2 className="mb-4 font-semibold">منحنی پیشرفت</h2>
                  {curve.data?.points.length ? <SCurve points={curve.data.points} /> : (
                    <p className="text-sm text-muted">{curve.data?.reason === 'NO_START' ? 'تاریخ شروع برنامه‌ای پروژه تعریف نشده است.' : 'هنوز فعالیتی برای پروژه تعریف نشده است.'}</p>
                  )}
                </Card>
                <Card className="space-y-4 p-5">
                  <DescriptionList items={[
                    { label: 'شروع برنامه‌ای', value: <DayText value={p.planned_start} /> },
                    { label: 'پایان برنامه‌ای', value: <DayText value={p.planned_finish} /> },
                    { label: 'شروع واقعی', value: <DayText value={p.actual_start} /> },
                    { label: 'پایان واقعی', value: <DayText value={p.actual_finish} /> },
                    { label: 'بودجه', value: <Money value={p.budget_amount} /> },
                    { label: 'محل اجرا', value: [p.province, p.city, p.location].filter(Boolean).join('، ') || null },
                  ]} />
                  {p.specs && <div><h3 className="mb-1 text-sm text-muted">مشخصات فنی</h3><p className="whitespace-pre-line leading-8">{p.specs}</p></div>}
                  {q.data.linked.contracts && (
                    <div>
                      <h3 className="mb-2 text-sm text-muted">قراردادهای متصل</h3>
                      {q.data.linked.contracts.length ? (
                        <ul className="space-y-1 text-sm">
                          {q.data.linked.contracts.map((c) => <li key={c.id}><Link className="text-primary underline" to={`/app/contracts/${c.id}`}><bdi>{c.code}</bdi> — {c.title}</Link> · <Money value={c.current_amount} /></li>)}
                        </ul>
                      ) : <p className="text-sm text-muted">قراردادی به این پروژه متصل نشده است (اتصال از صفحه قرارداد).</p>}
                    </div>
                  )}
                </Card>
              </div>
            )}

            {tab === 'schedule' && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted">{p.planned_start ? 'تاریخ‌ها با روش مسیر بحرانی (CPM) از شروع برنامه‌ای پروژه محاسبه می‌شوند؛ همه روزهای تقویم کاری حساب می‌شوند.' : 'برای محاسبه تاریخ‌ها، شروع برنامه‌ای پروژه را تعیین کنید.'}</p>
                  <div className="flex gap-2">{add('activity', 'فعالیت', can.schedule)}{can.schedule && q.data.activities.length > 1 && <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'dependency' })}>وابستگی</Button>}</div>
                </div>
                {ordered.length === 0 ? <EmptyState title="هنوز فعالیتی تعریف نشده است" description="ساختار شکست کار (WBS) را با افزودن فعالیت‌ها بسازید." /> : (
                  <Table>
                    <thead><tr><Th>کد</Th><Th>فعالیت</Th><Th>مدت</Th><Th>شروع</Th><Th>پایان</Th><Th>شناوری</Th><Th className="w-40">پیشرفت</Th><Th>مسئول</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
                    <tbody>
                      {ordered.map((x) => (
                        <tr key={x.id} className={x.leaf ? '' : 'bg-surface-2/50 font-semibold'}>
                          <Td className="tabular-nums">{x.code.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]!)}</Td>
                          <Td><span style={{ paddingInlineStart: `${x.depth * 1.25}rem` }}>{x.name}</span>{x.critical && <Badge tone="danger" className="ms-2">بحرانی</Badge>}{x.leaf && x.duration_days === 0 && <Badge className="ms-2">نقطه عطف</Badge>}</Td>
                          <Td>{x.leaf ? `${x.duration_days.toLocaleString('fa-IR')} روز` : '—'}</Td>
                          <Td><DayText value={x.planned_start} /></Td>
                          <Td><DayText value={x.planned_finish} /></Td>
                          <Td>{x.total_float === null ? '—' : `${x.total_float.toLocaleString('fa-IR')} روز`}</Td>
                          <Td><ProgressBar value={Number(x.progress)} label={`پیشرفت ${x.name}`} tone="success" /><span className="text-xs text-muted">{pct(Number(x.progress))}</span></Td>
                          <Td>{dir.name(x.assignee_id)}</Td>
                          <Td>
                            <div className="flex flex-wrap gap-1">
                              {x.leaf && can.progress && <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'progress', payload: x })}>پیشرفت</Button>}
                              {can.schedule && <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'child', payload: x })}>زیرفعالیت</Button>}
                              {can.schedule && <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'editActivity', payload: x })}>ویرایش</Button>}
                              {can.schedule && <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/projects/${p.id}/activities/${x.id}`, method: 'del' })}>حذف</Button>}
                            </div>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
                {q.data.dependencies.length > 0 && (
                  <Card className="p-5">
                    <h2 className="mb-3 font-semibold">وابستگی‌ها</h2>
                    <ul className="space-y-2 text-sm">
                      {q.data.dependencies.map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center gap-2">
                          <span>{nameOf(d.predecessor_id)}</span><span className="text-muted">← {DEP_TYPE[d.type]}{d.lag_days ? ` (${d.lag_days.toLocaleString('fa-IR')} روز)` : ''} ←</span><span>{nameOf(d.successor_id)}</span>
                          {can.schedule && <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/projects/${p.id}/dependencies/${d.id}`, method: 'del' })}>حذف</Button>}
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </div>
            )}

            {tab === 'gantt' && <Gantt rows={gantt} today={today} />}

            {tab === 'team' && (
              <div className="space-y-4">
                <div className="flex justify-end">{add('member', 'افزودن عضو', can.update)}</div>
                <Table>
                  <thead><tr><Th>نام</Th><Th>نقش در پروژه</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
                  <tbody>
                    {q.data.members.map((m) => (
                      <tr key={m.id}><Td>{dir.name(m.user_id)}</Td><Td>{MEMBER_ROLE[m.role]}</Td>
                        <Td>{can.update && m.user_id !== p.manager_id && <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/projects/${p.id}/members/${m.user_id}`, method: 'del' })}>حذف</Button>}</Td></tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}

            {tab === 'phases' && (
              <div className="space-y-4">
                <div className="flex justify-end">{add('phase', 'مرحله یا تحویل', can.update)}</div>
                {!q.data.phases.length ? <EmptyState title="مرحله‌ای تعریف نشده است" /> : (
                  <Table>
                    <thead><tr><Th>نوع</Th><Th>عنوان</Th><Th>تاریخ برنامه‌ای</Th><Th>تحویل</Th><Th>تأیید کارفرما</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
                    <tbody>
                      {q.data.phases.map((ph) => (
                        <tr key={ph.id}><Td>{PHASE_KIND[ph.kind]}</Td><Td>{ph.name}</Td><Td><DayText value={ph.planned_date} /></Td><Td><DayText value={ph.delivered_on} /></Td><Td><DayText value={ph.client_approved_on} /></Td>
                          <Td>{can.update && !ph.client_approved_on && <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'phaseStatus', payload: ph })}>ثبت تحویل/تأیید</Button>}</Td></tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </div>
            )}

            {tab === 'issues' && (
              <div className="space-y-4">
                <div className="flex justify-end">{add('issue', 'ثبت مورد', can.progress)}</div>
                {!q.data.issues.length ? <EmptyState title="تأخیر، مانع یا مسئله‌ای ثبت نشده است" /> : (
                  <Table>
                    <thead><tr><Th>نوع</Th><Th>عنوان</Th><Th>علت</Th><Th>اثر (روز)</Th><Th>مسئول</Th><Th>مهلت</Th><Th>وضعیت</Th></tr></thead>
                    <tbody>
                      {q.data.issues.map((i) => (
                        <tr key={i.id}><Td>{ISSUE_KIND[i.kind]}</Td><Td>{i.title}</Td><Td>{i.cause || '—'}</Td><Td>{i.impact_days.toLocaleString('fa-IR')}</Td><Td>{dir.name(i.owner_id)}</Td>
                          <Td><DayText value={i.due_on} />{i.status === 'open' && i.due_on && i.due_on < today && <Badge tone="danger" className="ms-1">معوق</Badge>}</Td>
                          <Td>{i.status === 'resolved' ? <Badge tone="success">رفع‌شده</Badge> : can.progress ? <Button size="sm" variant="secondary" onClick={() => act.mutate({ path: `/projects/${p.id}/issues/${i.id}/resolve`, body: { resolvedOn: today } })}>رفع شد</Button> : <Badge tone="warning">باز</Badge>}</Td></tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </div>
            )}

            {tab === 'risks' && (
              <div className="space-y-4">
                <div className="flex justify-end">{add('risk', 'ثبت ریسک', can.progress)}</div>
                {!q.data.risks.length ? <EmptyState title="ریسکی ثبت نشده است" /> : (
                  <Table>
                    <thead><tr><Th>ریسک</Th><Th>احتمال × اثر</Th><Th>پاسخ</Th><Th>مالک</Th><Th>وضعیت</Th></tr></thead>
                    <tbody>
                      {q.data.risks.map((r) => (
                        <tr key={r.id}><Td>{r.title}</Td>
                          <Td><Badge tone={r.score >= 15 ? 'danger' : r.score >= 8 ? 'warning' : 'neutral'}>{`${r.probability.toLocaleString('fa-IR')} × ${r.impact.toLocaleString('fa-IR')} = ${r.score.toLocaleString('fa-IR')}`}</Badge></Td>
                          <Td>{r.response || '—'}</Td><Td>{dir.name(r.owner_id)}</Td>
                          <Td>{can.progress ? <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/projects/${p.id}/risks/${r.id}/status`, body: { status: r.status === 'open' ? 'closed' : 'open' } })}>{r.status === 'open' ? 'بستن' : 'بازگشایی'}</Button> : r.status === 'open' ? 'باز' : 'بسته'}</Td></tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </div>
            )}

            {tab === 'reports' && (
              <div className="space-y-4">
                <div className="flex justify-end">{add('report', 'گزارش روزانه', can.progress)}</div>
                {!q.data.reports.length ? <EmptyState title="گزارش روزانه‌ای ثبت نشده است" /> : q.data.reports.map((r) => (
                  <Card key={r.id} className="space-y-2 p-4 text-sm">
                    <p className="font-semibold"><DayText value={r.report_date} /> <span className="font-normal text-muted">· {dir.name(r.created_by)} · نیرو: {r.workforce.toLocaleString('fa-IR')}{r.weather && ` · هوا: ${r.weather}`}</span></p>
                    <p className="whitespace-pre-line leading-7">{r.work_done}</p>
                    {r.equipment && <p className="text-muted">تجهیزات: {r.equipment}</p>}
                    {r.problems && <p className="text-danger">مشکلات: {r.problems}</p>}
                  </Card>
                ))}
              </div>
            )}

            {tab === 'changes' && (
              <div className="space-y-4">
                <div className="flex justify-end">{add('change', 'درخواست تغییر', can.change)}</div>
                {!q.data.changes.length ? <EmptyState title="درخواست تغییری ثبت نشده است" /> : (
                  <Table>
                    <thead><tr><Th>شماره</Th><Th>عنوان</Th><Th>اثر هزینه</Th><Th>اثر زمان</Th><Th>وضعیت</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
                    <tbody>
                      {q.data.changes.map((c) => (
                        <tr key={c.id}><Td>{c.number.toLocaleString('fa-IR')}</Td><Td>{c.title}</Td><Td><Money value={c.cost_impact} /></Td><Td>{`${c.time_impact_days.toLocaleString('fa-IR')} روز`}</Td>
                          <Td><Badge tone={CHANGE_STATUS[c.status]!.tone}>{CHANGE_STATUS[c.status]!.label}</Badge></Td>
                          <Td>{c.status === 'draft' && can.change && <Button size="sm" onClick={() => act.mutate({ path: `/projects/${p.id}/change-requests/${c.id}/submit` })}>ارسال برای تأیید</Button>}</Td></tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </div>
            )}

            {dialog?.kind === 'edit' && <ProjectForm project={p} onClose={close} />}
            {dialog?.kind === 'activity' && <ActivityDialog projectId={p.id} onClose={close} />}
            {dialog?.kind === 'child' && <ActivityDialog projectId={p.id} parent={dialog.payload as Activity} onClose={close} />}
            {dialog?.kind === 'editActivity' && <ActivityDialog projectId={p.id} activity={dialog.payload as Activity} onClose={close} />}
            {dialog?.kind === 'dependency' && <DependencyDialog projectId={p.id} activities={q.data.activities} onClose={close} />}
            {dialog?.kind === 'progress' && <ProgressDialog projectId={p.id} activity={dialog.payload as Activity} onClose={close} />}
            {dialog?.kind === 'member' && <MemberDialog projectId={p.id} onClose={close} />}
            {dialog?.kind === 'phase' && <PhaseDialog projectId={p.id} onClose={close} />}
            {dialog?.kind === 'phaseStatus' && <PhaseStatusDialog projectId={p.id} phase={dialog.payload as Detail['phases'][number]} onClose={close} />}
            {dialog?.kind === 'issue' && <IssueDialog projectId={p.id} onClose={close} />}
            {dialog?.kind === 'risk' && <RiskDialog projectId={p.id} onClose={close} />}
            {dialog?.kind === 'report' && <DailyReportDialog projectId={p.id} onClose={close} />}
            {dialog?.kind === 'change' && <ChangeRequestDialog projectId={p.id} onClose={close} />}
          </>
        );
      })()}
    </PageState>
  );
}
