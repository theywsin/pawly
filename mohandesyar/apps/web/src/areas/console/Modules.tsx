import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Puzzle } from 'lucide-react';
import { Badge, Button, EmptyState, Ltr, Num, PageHeader, PageState, Table, Td, Th } from '@mohandesyar/ui';
import { consoleApi } from '../../lib/api.js';
import { useAdmin } from '../../lib/session.js';

export interface ConsoleModule {
  id: string;
  name: { fa: string };
  state: string;
  active_version: string | null;
  previous_version: string | null;
  globally_enabled: boolean;
  activeTenants: number;
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  signer_key_id: string | null;
  runtime: { instance_id: string; status: string; error: string | null; version: string }[];
}

export const STATE: Record<string, { label: string; tone: 'success' | 'neutral' | 'danger' | 'warning' }> = {
  installed: { label: 'نصب‌شده', tone: 'success' },
  failed: { label: 'ناموفق', tone: 'danger' },
  uninstalled_data_retained: { label: 'حذف‌شده (داده حفظ شده)', tone: 'warning' },
  uninstalled: { label: 'حذف‌شده', tone: 'neutral' },
};

export function ConsoleModules() {
  const admin = useAdmin();
  const q = useQuery({ queryKey: ['console-modules'], queryFn: () => consoleApi<ConsoleModule[]>('/api/console/modules') });
  return (
    <>
      <PageHeader
        title="ماژول‌ها"
        description="نصب، فعال‌سازی و ارتقای ماژول‌ها. فقط بسته‌های امضاشده با کلید مورد اعتماد پذیرفته می‌شوند."
        actions={
          admin.roles.includes('tech_admin') && (
            <Link to="/console/modules/install">
              <Button>نصب ماژول جدید</Button>
            </Link>
          )
        }
      />
      <PageState query={q} isEmpty={q.data?.length === 0} empty={<EmptyState icon={<Puzzle className="size-8" />} title="هنوز ماژولی نصب نشده است" />}>
        <Table>
          <thead>
            <tr>
              <Th>ماژول</Th>
              <Th>نسخه</Th>
              <Th>وضعیت</Th>
              <Th>سراسری</Th>
              <Th>سازمان‌های فعال</Th>
              <Th>وابستگی‌ها</Th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((m) => (
              <tr key={m.id}>
                <Td>
                  <Link className="font-medium text-primary" to={`/console/modules/${m.id}`}>
                    {m.name.fa}
                  </Link>
                  <Ltr className="block font-mono text-xs text-muted">{m.id}</Ltr>
                </Td>
                <Td>
                  <Ltr>{m.active_version ?? '—'}</Ltr>
                </Td>
                <Td>
                  <Badge tone={STATE[m.state]?.tone}>{STATE[m.state]?.label ?? m.state}</Badge>
                  {m.runtime.some((r) => r.status !== 'loaded') && <Badge tone="danger" className="ms-1">خطای بارگذاری</Badge>}
                </Td>
                <Td>{m.globally_enabled ? <Badge tone="success">فعال</Badge> : <Badge>غیرفعال</Badge>}</Td>
                <Td>
                  <Num value={m.activeTenants} />
                </Td>
                <Td>
                  <Ltr className="text-xs">{Object.keys(m.dependencies).join(', ') || '—'}</Ltr>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageState>
    </>
  );
}
