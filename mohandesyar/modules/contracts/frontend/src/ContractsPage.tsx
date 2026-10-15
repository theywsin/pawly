import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { FileSignature, Plus } from 'lucide-react';
import { Badge, Button, DayText, EmptyState, Input, Money, PageHeader, PageState, Select, Stat, Table, Td, Th } from '@mohandesyar/ui';
import { useCan } from '@mohandesyar/module-sdk/web';
import { DIRECTION, STATUS, useApi } from './common.js';
import { ContractForm, type ContractData } from './ContractForm.js';

export function ContractsPage() {
  const a = useApi();
  const canCreate = useCan('contracts.contract.create');
  const [status, setStatus] = useState('');
  const [direction, setDirection] = useState('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const params = new URLSearchParams({ ...(status && { status }), ...(direction && { direction }), ...(q.trim() && { q: q.trim() }) }).toString();
  const list = useQuery({ queryKey: ['contracts', 'list', params], queryFn: () => a.get<ContractData[]>(`/contracts${params ? `?${params}` : ''}`) });
  const summary = useQuery({ queryKey: ['contracts', 'summary'], queryFn: () => a.get<{ active: number; draft: number; income: string; expense: string }>('/summary') });
  const filtered = !!(status || direction || q.trim());

  return (
    <>
      <PageHeader
        title="قراردادها"
        description="قراردادهای درآمدی و هزینه‌ای، الحاقیه‌ها، تضامین و صورت‌وضعیت‌ها"
        actions={canCreate && <Button onClick={() => setCreating(true)}><Plus className="size-4" /> قرارداد جدید</Button>}
      />
      {summary.data && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="قراردادهای جاری">{summary.data.active.toLocaleString('fa-IR')}</Stat>
          <Stat label="پیش‌نویس">{summary.data.draft.toLocaleString('fa-IR')}</Stat>
          <Stat label="مبلغ جاری قراردادهای درآمدی"><Money value={summary.data.income} /></Stat>
          <Stat label="مبلغ جاری قراردادهای هزینه‌ای"><Money value={summary.data.expense} /></Stat>
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="w-full sm:w-64"><Input aria-label="جست‌وجو در قراردادها" placeholder="شماره، عنوان یا طرف قرارداد" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="w-full sm:w-40"><Select aria-label="وضعیت" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">همه وضعیت‌ها</option>
          {Object.entries(STATUS).map(([k, s]) => (
            <option key={k} value={k}>{s.label}</option>
          ))}
        </Select></div>
        <div className="w-full sm:w-40"><Select aria-label="جهت مالی" value={direction} onChange={(e) => setDirection(e.target.value)}>
          <option value="">درآمدی و هزینه‌ای</option>
          <option value="income">درآمدی</option>
          <option value="expense">هزینه‌ای</option>
        </Select></div>
      </div>
      <PageState
        query={list}
        isEmpty={list.data?.length === 0}
        empty={
          <EmptyState
            icon={<FileSignature className="size-8" />}
            title={filtered ? 'قراردادی با این فیلترها یافت نشد' : 'هنوز قراردادی ثبت نشده است'}
            action={!filtered && canCreate ? <Button onClick={() => setCreating(true)}>ثبت اولین قرارداد</Button> : undefined}
          />
        }
      >
        <div className="overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>شماره</Th>
                <Th>عنوان</Th>
                <Th>طرف قرارداد</Th>
                <Th>جهت</Th>
                <Th>مبلغ جاری</Th>
                <Th>پایان</Th>
                <Th>وضعیت</Th>
              </tr>
            </thead>
            <tbody>
              {list.data?.map((c) => (
                <tr key={c.id}>
                  <Td><Link to={c.id} className="font-medium text-primary underline-offset-4 hover:underline"><bdi>{c.code}</bdi></Link></Td>
                  <Td>{c.title}</Td>
                  <Td>{c.counterparty_name}</Td>
                  <Td>{DIRECTION[c.direction]}</Td>
                  <Td><Money value={c.current_amount} /></Td>
                  <Td><DayText value={c.end_on} /></Td>
                  <Td><Badge tone={STATUS[c.status]!.tone}>{STATUS[c.status]!.label}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </PageState>
      {creating && <ContractForm open onClose={() => setCreating(false)} />}
    </>
  );
}
