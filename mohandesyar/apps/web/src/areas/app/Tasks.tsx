import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckSquare } from 'lucide-react';
import { Alert, Button, DateText, Dialog, EmptyState, Field, Input, PageHeader, PageState, Select, Table, Td, Th, toast } from '@mohandesyar/ui';
import { appApi } from '../../lib/api.js';
import { applyServerErrors, errorMessage } from '../../lib/errors.js';
import { useAppSession } from '../../lib/session.js';

interface Task {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'done' | 'canceled';
  priority: string;
  due_at: string | null;
  assignee_name: string | null;
}

const STATUS: Record<Task['status'], { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' }> = {
  open: { label: 'باز', tone: 'neutral' },
  in_progress: { label: 'در حال انجام', tone: 'info' },
  done: { label: 'انجام‌شده', tone: 'success' },
  canceled: { label: 'لغوشده', tone: 'warning' },
};
const PRIORITY: Record<string, string> = { low: 'کم', normal: 'عادی', high: 'زیاد', urgent: 'فوری' };

const schema = z.object({
  title: z.string().trim().min(1, 'عنوان الزامی است').max(300),
  assigneeId: z.string().optional(),
  due: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
});

function NewTask({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const { me } = useAppSession();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const members = useQuery({ queryKey: ['members'], queryFn: () => appApi<{ user_id: string; full_name: string }[]>('/api/core/members'), enabled: open && me.permissions.includes('core.user.view') });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { priority: 'normal' } });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await appApi('/api/core/tasks', {
        method: 'POST',
        body: { title: v.title, priority: v.priority, assigneeId: v.assigneeId || undefined, dueAt: v.due ? new Date(`${v.due}T23:59:00+03:30`).toISOString() : undefined },
      });
      toast('وظیفه ثبت شد');
      form.reset({ priority: 'normal' });
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    } catch (err) {
      setError(applyServerErrors(err, form.setError));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="وظیفه جدید">
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="عنوان" error={form.formState.errors.title?.message} required>
          <Input {...form.register('title')} />
        </Field>
        {members.data && (
          <Field label="مسئول">
            <Select {...form.register('assigneeId')}>
              <option value="">خودم</option>
              {members.data.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="مهلت" hint="تاریخ میلادی مرورگر؛ نمایش شمسی است">
            <Input type="date" dir="ltr" {...form.register('due')} />
          </Field>
          <Field label="اولویت">
            <Select {...form.register('priority')}>
              {Object.entries(PRIORITY).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            انصراف
          </Button>
          <Button type="submit" loading={form.formState.isSubmitting}>
            ثبت
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function Tasks() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const q = useQuery({ queryKey: ['tasks', filter], queryFn: () => appApi<Task[]>(`/api/core/tasks${filter ? `?status=${filter}` : ''}`) });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Task['status'] }) => appApi(`/api/core/tasks/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <>
      <PageHeader
        title="وظایف"
        description="وظایف شما و وظایفی که به دیگران سپرده‌اید."
        actions={
          <>
            <Select aria-label="فیلتر وضعیت" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-40">
              <option value="">همه وضعیت‌ها</option>
              {Object.entries(STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
            <Button onClick={() => setOpen(true)}>وظیفه جدید</Button>
          </>
        }
      />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<CheckSquare className="size-8" />} title="وظیفه‌ای وجود ندارد" action={<Button onClick={() => setOpen(true)}>ثبت اولین وظیفه</Button>} />}>
        <Table>
          <thead>
            <tr>
              <Th>عنوان</Th>
              <Th>مسئول</Th>
              <Th>مهلت</Th>
              <Th>اولویت</Th>
              <Th>وضعیت</Th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((t) => (
              <tr key={t.id}>
                <Td className="font-medium">{t.title}</Td>
                <Td>{t.assignee_name ?? '—'}</Td>
                <Td>
                  <DateText value={t.due_at} />
                </Td>
                <Td>{PRIORITY[t.priority]}</Td>
                <Td>
                  <Select aria-label={`وضعیت ${t.title}`} value={t.status} disabled={update.isPending} className="h-8 w-36 text-sm" onChange={(e) => update.mutate({ id: t.id, status: e.target.value as Task['status'] })}>
                    {Object.entries(STATUS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </Select>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      <NewTask open={open} onOpenChange={setOpen} />
    </>
  );
}
