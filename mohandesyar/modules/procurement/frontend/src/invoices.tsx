import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { Alert, Badge, Button, DayText, Dialog, EmptyState, ExportMenu, Field, PageHeader, PageState, Table, Td, Textarea, Th, toast } from '@mohandesyar/ui';
import { useCan, useDirectory, useMe } from '@mohandesyar/module-sdk/web';
import { INVOICE_STATUS, Nav, num, rial, useApi, useServerErrors } from './common.js';

interface Inv { id: string; number: string; order_id: string; order_number: number; supplier_name: string; issued_on: string; due_on: string; amount: string; status: string; matched: boolean; match: { ok: boolean; issues: { message: string }[] }; override_reason: string; decision_note: string; created_by: string; decided_by: string | null }

export function InvoicesPage() {
  const a = useApi();
  const me = useMe();
  const dir = useDirectory();
  const canApprove = useCan('procurement.invoice.approve');
  const [deciding, setDeciding] = useState<Inv | null>(null);
  const q = useQuery({ queryKey: ['procurement', 'invoices'], queryFn: () => a.get<Inv[]>('/invoices') });
  return (
    <>
      <PageHeader
        title="فاکتورهای تأمین‌کنندگان"
        description="فاکتور از صفحه سفارش ثبت می‌شود. تأیید با فردی غیر از ثبت‌کننده است؛ فاکتور دارای مغایرت فقط با دلیل مکتوب تأیید می‌شود. فاکتور تأییدشده در «مالی» بدهی تأمین‌کننده می‌شود."
        actions={<ExportMenu filename="supplier-invoices" title="فاکتورهای تأمین‌کنندگان" rows={q.data} columns={[
          { header: 'شماره', value: (i) => i.number }, { header: 'تأمین‌کننده', value: (i) => i.supplier_name }, { header: 'سفارش', value: (i) => `PO-${i.order_number}` },
          { header: 'تاریخ', value: (i) => i.issued_on }, { header: 'سررسید', value: (i) => i.due_on }, { header: 'مبلغ (ریال)', value: (i) => i.amount, kind: 'number' },
          { header: 'تطبیق', value: (i) => (i.matched ? 'برقرار' : 'مغایرت') }, { header: 'وضعیت', value: (i) => INVOICE_STATUS[i.status]?.label },
        ]} />}
      />
      <Nav />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<FileText className="size-8" />} title="فاکتوری ثبت نشده است" />}>
        <Table>
          <thead><tr><Th>شماره</Th><Th>تأمین‌کننده</Th><Th>سفارش</Th><Th>سررسید</Th><Th>مبلغ (ریال)</Th><Th>تطبیق سه‌طرفه</Th><Th>وضعیت</Th><Th><span className="sr-only">عملیات</span></Th></tr></thead>
          <tbody>
            {q.data?.map((i) => (
              <tr key={i.id}>
                <Td>{i.number}<div className="text-xs text-muted"><DayText value={i.issued_on} /> · {dir.name(i.created_by)}</div></Td>
                <Td>{i.supplier_name}</Td><Td className="tabular-nums">PO-{num(i.order_number)}</Td><Td><DayText value={i.due_on} /></Td><Td className="tabular-nums">{rial(i.amount)}</Td>
                <Td>{i.matched ? <Badge tone="success">برقرار</Badge> : <Badge tone="danger">مغایرت</Badge>}{i.override_reason && <div className="text-xs text-muted">تأیید با دلیل: {i.override_reason}</div>}</Td>
                <Td><Badge tone={INVOICE_STATUS[i.status]!.tone}>{INVOICE_STATUS[i.status]!.label}</Badge>{i.decided_by && <div className="text-xs text-muted">{dir.name(i.decided_by)}</div>}</Td>
                <Td>{canApprove && i.status === 'pending' && i.created_by !== me.user.id && <Button size="sm" onClick={() => setDeciding(i)}>بررسی</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
      {deciding && <DecisionDialog inv={deciding} onClose={() => setDeciding(null)} />}
    </>
  );
}

function DecisionDialog({ inv, onClose }: { inv: Inv; onClose: () => void }) {
  const a = useApi();
  const qc = useQueryClient();
  const err = useServerErrors();
  const [note, setNote] = useState('');
  const [override, setOverride] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') => a.post<{ status: string }>(`/invoices/${inv.id}/decision`, { decision, note, overrideReason: override }),
    onSuccess: (r) => (toast(r.status === 'approved' ? 'فاکتور تأیید شد' : 'فاکتور رد شد'), void qc.invalidateQueries({ queryKey: ['procurement'] }), onClose()),
    onError: err.set,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`فاکتور ${inv.number} — ${inv.supplier_name}`}
      description={`مبلغ ${rial(inv.amount)} ریال · سفارش PO-${num(inv.order_number)}`}
      footer={<><Button variant="ghost" onClick={onClose}>انصراف</Button><Button variant="danger" loading={decide.isPending && decide.variables === 'reject'} onClick={() => (err.clear(), decide.mutate('reject'))}>رد</Button><Button loading={decide.isPending && decide.variables === 'approve'} onClick={() => (err.clear(), decide.mutate('approve'))}>تأیید</Button></>}
    >
      {err.banner}
      {inv.match.ok ? <Alert tone="success" className="mb-4">مقدار و قیمت فاکتور با سفارش و تحویل پذیرفته‌شده مطابقت دارد (هنگام تأیید دوباره بررسی می‌شود).</Alert> : (
        <Alert tone="warning" className="mb-4">
          مغایرت کنترل سه‌طرفه:
          <ul className="list-disc ps-5">{inv.match.issues.map((x, k) => <li key={k}>{x.message}</li>)}</ul>
        </Alert>
      )}
      <div className="grid gap-4">
        {!inv.match.ok && <Field label="دلیل تأیید با وجود مغایرت (حداقل ۱۰ نویسه)"><Textarea value={override} onChange={(e) => setOverride(e.target.value)} /></Field>}
        <Field label="یادداشت (برای رد الزامی)" error={err.fields.note}><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
