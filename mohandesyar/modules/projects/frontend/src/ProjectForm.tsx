import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DateInput, Dialog, Field, Input, MoneyInput, Select, Textarea, toast } from '@mohandesyar/ui';
import { useDirectory, useMe, useModule } from '@mohandesyar/module-sdk/web';
import { STATUS, TYPE, useApi, useServerErrors, type ProjectData } from './common.js';

export function ProjectForm({ project, onClose }: { project?: ProjectData; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const me = useMe();
  const dir = useDirectory();
  const err = useServerErrors();
  const crm = useModule('crm');
  const [v, setV] = useState({
    code: project?.code ?? '',
    title: project?.title ?? '',
    projectType: project?.project_type ?? 'building',
    employerName: project?.employer_name ?? '',
    crmAccountId: project?.crm_account_id ?? null,
    contractId: project?.contracts_contract_id ?? null,
    managerId: (project ? project.manager_id : me.user.id) as string | null,
    province: project?.province ?? '',
    city: project?.city ?? '',
    location: project?.location ?? '',
    specs: project?.specs ?? '',
    description: project?.description ?? '',
    plannedStart: project?.planned_start ?? '',
    plannedFinish: project?.planned_finish ?? '',
    budgetAmount: project?.budget_amount ?? '',
    status: project?.status ?? 'planning',
  });
  const [bad, setBad] = useState<Record<string, boolean>>({});
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV((s) => ({ ...s, [k]: x }));
  const date = (k: 'plannedStart' | 'plannedFinish') => (iso: string | null) => (setBad((b) => ({ ...b, [k]: iso === null })), iso !== null && set(k, iso));
  const accounts = useQuery({ queryKey: ['projects', 'lookup', 'accounts'], queryFn: () => a.get<{ id: string; title: string }[]>('/projects/lookups/accounts?q='), enabled: crm });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...v, plannedStart: v.plannedStart || null, plannedFinish: v.plannedFinish || null, budgetAmount: v.budgetAmount || null, ...(project ? { version: project.version } : {}) };
      return project ? a.put(`/projects/${project.id}`, body) : a.post('/projects', body);
    },
    onSuccess: () => {
      toast(project ? 'پروژه ذخیره شد' : 'پروژه تعریف شد');
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['widget'] });
      onClose();
    },
    onError: err.set,
  });
  const f = err.fields;
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={project ? `ویرایش پروژه ${project.code}` : 'پروژه جدید'}
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button loading={save.isPending} disabled={Object.values(bad).some(Boolean)} onClick={() => (err.clear(), save.mutate())}>ذخیره</Button></>}>
      {err.banner}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="کد پروژه" required error={f.code}><Input dir="auto" value={v.code} onChange={(e) => set('code', e.target.value)} /></Field>
        <Field label="عنوان" required error={f.title}><Input value={v.title} onChange={(e) => set('title', e.target.value)} /></Field>
        <Field label="نوع پروژه">
          <Select value={v.projectType} onChange={(e) => set('projectType', e.target.value)}>
            {Object.entries(TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="وضعیت">
          <Select value={v.status} onChange={(e) => set('status', e.target.value)}>
            {Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </Select>
        </Field>
        <Field label="کارفرما" error={f.employerName}><Input value={v.employerName} onChange={(e) => set('employerName', e.target.value)} /></Field>
        {crm && (
          <Field label="کارفرما در CRM">
            <Select value={v.crmAccountId ?? ''} onChange={(e) => set('crmAccountId', e.target.value || null)}>
              <option value="">— بدون اتصال —</option>
              {accounts.data?.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
            </Select>
          </Field>
        )}
        <Field label="مدیر پروژه" error={f.managerId}>
          <Select value={v.managerId ?? ''} onChange={(e) => set('managerId', e.target.value || null)}>
            {dir.users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </Select>
        </Field>
        <Field label="بودجه (ریال)" error={f.budgetAmount}><MoneyInput value={v.budgetAmount} onChange={(d) => set('budgetAmount', d)} /></Field>
        <Field label="شروع برنامه‌ای" error={bad.plannedStart ? 'تاریخ معتبر نیست' : f.plannedStart} hint="مبنای زمان‌بندی فعالیت‌ها"><DateInput value={v.plannedStart} onChange={date('plannedStart')} /></Field>
        <Field label="پایان برنامه‌ای (قراردادی)" error={bad.plannedFinish ? 'تاریخ معتبر نیست' : f.plannedFinish}><DateInput value={v.plannedFinish} onChange={date('plannedFinish')} /></Field>
        <Field label="استان"><Input value={v.province} onChange={(e) => set('province', e.target.value)} /></Field>
        <Field label="شهر"><Input value={v.city} onChange={(e) => set('city', e.target.value)} /></Field>
        <Field label="محل اجرا" className="sm:col-span-2"><Input value={v.location} onChange={(e) => set('location', e.target.value)} /></Field>
        <Field label="مشخصات فنی" className="sm:col-span-2"><Textarea value={v.specs} onChange={(e) => set('specs', e.target.value)} /></Field>
        <Field label="توضیحات" className="sm:col-span-2"><Textarea value={v.description} onChange={(e) => set('description', e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
