import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { FolderKanban, Plus } from 'lucide-react';
import { Badge, Button, EmptyState, Input, PageHeader, PageState, ProgressBar, Select, Table, Td, Th } from '@mohandesyar/ui';
import { useCan, useDirectory } from '@mohandesyar/module-sdk/web';
import { pct, STATUS, useApi, type ProjectData, type Progress } from './common.js';
import { ProjectForm } from './ProjectForm.js';

export function ProjectsPage() {
  const a = useApi();
  const dir = useDirectory();
  const canCreate = useCan('projects.project.create');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const params = new URLSearchParams({ ...(status && { status }), ...(q.trim() && { q: q.trim() }) }).toString();
  const list = useQuery({ queryKey: ['projects', 'list', params], queryFn: () => a.get<(ProjectData & { progress: Progress; delayed: boolean })[]>(`/projects${params ? `?${params}` : ''}`) });
  const filtered = !!(status || q.trim());
  return (
    <>
      <PageHeader title="پروژه‌ها" description="برنامه زمان‌بندی، پیشرفت برنامه‌ای و واقعی، موانع و ریسک‌ها" actions={canCreate && <Button onClick={() => setCreating(true)}><Plus className="size-4" /> پروژه جدید</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="w-full sm:w-64"><Input aria-label="جست‌وجو در پروژه‌ها" placeholder="کد، عنوان یا کارفرما" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="w-full sm:w-44"><Select aria-label="وضعیت" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">همه وضعیت‌ها</option>
          {Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
        </Select></div>
      </div>
      <PageState query={list} isEmpty={list.data?.length === 0}
        empty={<EmptyState icon={<FolderKanban className="size-8" />} title={filtered ? 'پروژه‌ای با این فیلترها یافت نشد' : 'هنوز پروژه‌ای تعریف نشده است'} action={!filtered && canCreate ? <Button onClick={() => setCreating(true)}>تعریف اولین پروژه</Button> : undefined} />}>
        <Table>
          <thead><tr><Th>کد</Th><Th>عنوان</Th><Th>کارفرما</Th><Th>مدیر پروژه</Th><Th className="w-56">پیشرفت واقعی / برنامه‌ای</Th><Th>وضعیت</Th></tr></thead>
          <tbody>
            {list.data?.map((p) => (
              <tr key={p.id}>
                <Td><Link to={p.id} className="font-medium text-primary underline-offset-4 hover:underline"><bdi>{p.code}</bdi></Link></Td>
                <Td>{p.title}</Td>
                <Td>{p.employer_name || '—'}</Td>
                <Td>{dir.name(p.manager_id)}</Td>
                <Td>
                  {p.progress.actual === null ? <span className="text-sm text-muted">بدون برنامه زمان‌بندی</span> : (
                    <div className="space-y-1">
                      <ProgressBar value={p.progress.actual} planned={p.progress.planned} label={`پیشرفت واقعی ${p.code}`} tone={p.delayed ? 'danger' : 'success'} />
                      <p className="text-xs text-muted">واقعی {pct(p.progress.actual)} · برنامه‌ای {pct(p.progress.planned)}</p>
                    </div>
                  )}
                </Td>
                <Td className="whitespace-nowrap"><Badge tone={STATUS[p.status]!.tone}>{STATUS[p.status]!.label}</Badge>{p.delayed && <Badge tone="danger" className="ms-1">دارای تأخیر</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {creating && <ProjectForm onClose={() => setCreating(false)} />}
    </>
  );
}
