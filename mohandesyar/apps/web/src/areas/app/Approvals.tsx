import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import { Button, Card, DateText, Dialog, EmptyState, Field, Num, PageHeader, PageState, Textarea, toast } from '@mohandesyar/ui';
import { appApi } from '../../lib/api.js';
import { errorMessage } from '../../lib/errors.js';

interface Item {
  id: string;
  title: string;
  amount: string | null;
  module_id: string;
  started_at: string;
  started_by_name: string;
  step_key: string;
}

export function Approvals() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['approvals'], queryFn: () => appApi<Item[]>('/api/core/approvals') });
  const [deciding, setDeciding] = useState<{ item: Item; decision: 'approve' | 'reject' } | null>(null);
  const [comment, setComment] = useState('');
  const decide = useMutation({
    mutationFn: () => appApi(`/api/core/approvals/${deciding!.item.id}/decide`, { method: 'POST', body: { decision: deciding!.decision, comment: comment || undefined } }),
    onSuccess: () => {
      toast(deciding!.decision === 'approve' ? 'تأیید ثبت شد' : 'رد درخواست ثبت شد');
      setDeciding(null);
      setComment('');
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    },
    onError: (e) => toast(errorMessage(e), 'danger'),
  });
  return (
    <>
      <PageHeader title="کارتابل تأیید" description="درخواست‌هایی که منتظر تصمیم شما هستند." />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<ClipboardCheck className="size-8" />} title="درخواستی در انتظار تأیید شما نیست" />}>
        <div className="space-y-3">
          {q.data?.map((i) => (
            <Card key={i.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
              <div>
                <p className="font-semibold">{i.title}</p>
                <p className="text-sm text-muted">
                  {i.started_by_name} · <DateText value={i.started_at} relative />
                  {i.amount && (
                    <>
                      {' '}
                      · مبلغ: <Num value={i.amount} /> ریال
                    </>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setDeciding({ item: i, decision: 'reject' })}>
                  رد
                </Button>
                <Button onClick={() => setDeciding({ item: i, decision: 'approve' })}>تأیید</Button>
              </div>
            </Card>
          ))}
        </div>
      </PageState>
      <Dialog
        open={!!deciding}
        onOpenChange={(o) => !o && setDeciding(null)}
        title={deciding?.decision === 'approve' ? 'تأیید درخواست' : 'رد درخواست'}
        description={deciding?.item.title}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeciding(null)}>
              انصراف
            </Button>
            <Button variant={deciding?.decision === 'reject' ? 'danger' : 'primary'} loading={decide.isPending} onClick={() => decide.mutate()}>
              ثبت تصمیم
            </Button>
          </>
        }
      >
        <Field label="توضیح (اختیاری)">
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </Dialog>
    </>
  );
}
