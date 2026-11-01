import { useQuery } from '@tanstack/react-query';
import { DateText, Ltr, PageHeader, PageState, Table, Td, Th } from '@mohandesyar/ui';
import { appApi } from '../../../lib/api.js';

interface Entry {
  id: number;
  actor_type: string;
  action: string;
  module_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  ip: string | null;
  at: string;
}

const ACTOR: Record<string, string> = { user: 'کاربر', admin: 'مدیر پلتفرم', system: 'سامانه', support: 'پشتیبانی' };

export function Audit() {
  const q = useQuery({ queryKey: ['audit'], queryFn: () => appApi<Entry[]>('/api/core/audit') });
  return (
    <>
      <PageHeader title="گزارش رویدادها" description="ثبت تغییرناپذیر عملیات حساس سازمان (۱۰۰ مورد اخیر)." />
      <PageState query={q} isEmpty={q.data?.length === 0}>
        <Table>
          <thead>
            <tr>
              <Th>زمان</Th>
              <Th>عامل</Th>
              <Th>عملیات</Th>
              <Th>موجودیت</Th>
              <Th>IP</Th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((e) => (
              <tr key={e.id}>
                <Td>
                  <DateText value={e.at} withTime />
                </Td>
                <Td>{ACTOR[e.actor_type] ?? e.actor_type}</Td>
                <Td>
                  <Ltr className="font-mono text-xs">{e.action}</Ltr>
                </Td>
                <Td>
                  <Ltr className="font-mono text-xs">{[e.module_id, e.entity_type].filter(Boolean).join(' / ') || '—'}</Ltr>
                </Td>
                <Td>
                  <Ltr>{e.ip ?? '—'}</Ltr>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
    </>
  );
}
