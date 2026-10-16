import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NotebookPen } from 'lucide-react';
import { Alert, Button, Card, ConfirmDialog, DateText, EmptyState, Field, Input, PageHeader, PageState, Textarea, toast } from '@mohandesyar/ui';
import { ApiError, useCan, useModuleApi } from '@mohandesyar/module-sdk/web';

interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

export function NotesPage() {
  const api = useModuleApi('hello-module');
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const highlighted = params.get('note');
  const canCreate = useCan('hello-module.note.create');
  const canDelete = useCan('hello-module.note.delete');
  const greeting = useQuery({ queryKey: ['hello', 'greeting'], queryFn: () => api.get<{ greeting: string }>('/notes/greeting') });
  const notes = useQuery({ queryKey: ['hello', 'notes'], queryFn: () => api.get<Note[]>('/notes') });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Note | null>(null);

  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/notes', { title, body }),
    onSuccess: () => {
      setTitle('');
      setBody('');
      setError(null);
      toast('یادداشت ثبت شد');
      void qc.invalidateQueries({ queryKey: ['hello'] });
      void qc.invalidateQueries({ queryKey: ['widget'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'ثبت یادداشت ممکن نشد'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/notes/${id}`),
    onSuccess: () => {
      setToDelete(null);
      toast('یادداشت حذف شد');
      void qc.invalidateQueries({ queryKey: ['hello'] });
      void qc.invalidateQueries({ queryKey: ['widget'] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'حذف ممکن نشد', 'danger'),
  });

  return (
    <>
      <PageHeader title="یادداشت‌ها" description={greeting.data?.greeting} />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <PageState query={notes} isEmpty={notes.data?.length === 0} empty={<EmptyState icon={<NotebookPen className="size-8" />} title="هنوز یادداشتی ثبت نشده است" />}>
          <ul className="space-y-3" aria-label="فهرست یادداشت‌ها">
            {notes.data?.map((n) => (
              <li key={n.id}>
                <Card className={`p-4 ${highlighted === n.id ? 'ring-2 ring-primary' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{n.title}</p>
                      {n.body && <p className="mt-1 whitespace-pre-line text-sm leading-7 text-muted">{n.body}</p>}
                      <p className="mt-2 text-xs text-muted">
                        <DateText value={n.createdAt} withTime />
                      </p>
                    </div>
                    {canDelete && (
                      <Button size="sm" variant="ghost" onClick={() => setToDelete(n)} aria-label={`حذف ${n.title}`}>
                        حذف
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </PageState>
        {canCreate && (
          <Card className="h-fit p-4">
            <h2 className="mb-3 font-semibold">یادداشت جدید</h2>
            {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <Field label="عنوان" required>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
              </Field>
              <Field label="متن">
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} />
              </Field>
              <Button type="submit" className="w-full" loading={create.isPending} disabled={!title.trim()}>
                ثبت یادداشت
              </Button>
            </form>
          </Card>
        )}
      </div>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="حذف یادداشت"
        description={`«${toDelete?.title ?? ''}» حذف می‌شود.`}
        confirmLabel="حذف"
        loading={remove.isPending}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
      />
    </>
  );
}
