import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { Button, Card, cn, DateText, EmptyState, PageHeader, PageState } from '@mohandesyar/ui';
import { appApi } from '../../lib/api.js';

interface N {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read_at: string | null;
}

export function Notifications() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications', 'list'], queryFn: () => appApi<{ items: N[]; unread: number }>('/api/core/notifications') });
  const readAll = useMutation({
    mutationFn: () => appApi('/api/core/notifications/read', { method: 'POST', body: { ids: 'all' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  return (
    <>
      <PageHeader
        title="اعلان‌ها"
        actions={
          q.data?.unread ? (
            <Button variant="secondary" loading={readAll.isPending} onClick={() => readAll.mutate()}>
              علامت‌گذاری همه به‌عنوان خوانده‌شده
            </Button>
          ) : undefined
        }
      />
      <PageState query={q} isEmpty={q.data?.items.length === 0} empty={<EmptyState icon={<Bell className="size-8" />} title="اعلانی ندارید" />}>
        <ul className="space-y-2">
          {q.data?.items.map((n) => (
            <li key={n.id}>
              <Card className={cn('p-4', !n.read_at && 'border-primary/40')}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className={cn(!n.read_at && 'font-semibold')}>{n.link ? <Link to={n.link}>{n.title}</Link> : n.title}</p>
                    {n.body && <p className="mt-1 text-sm text-muted">{n.body}</p>}
                  </div>
                  <span className="shrink-0 text-xs text-muted">
                    <DateText value={n.created_at} relative />
                  </span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </PageState>
    </>
  );
}
