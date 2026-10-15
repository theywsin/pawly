import { Link, Navigate } from 'react-router';
import { LayoutDashboard } from 'lucide-react';
import { Card, CardHeader, EmptyState, PageHeader } from '@mohandesyar/ui';
import { useAppSession } from '../../lib/session.js';
import { ModuleWidget } from '../../module-host/ModuleOutlet.js';

/** Built only from widgets registered by active modules (docs/01 CORE-DASH); no placeholder figures. */
export function Dashboard() {
  const { me } = useAppSession();
  const widgets = me.modules.flatMap((m) => m.widgets.map((w) => ({ m, w })));
  // First visit of an administrator: run the onboarding wizard.
  if (!me.tenant.onboarding_completed_at && me.permissions.includes('core.settings.manage')) return <Navigate to="/app/onboarding" replace />;
  return (
    <>
      <PageHeader title="داشبورد" description={`${me.user.fullName}، خوش آمدید.`} />
      {widgets.length === 0 ? (
        <EmptyState
          icon={<LayoutDashboard className="size-8" />}
          title="هنوز ویجتی برای نمایش وجود ندارد"
          description="ویجت‌ها را ماژول‌های فعال سازمان فراهم می‌کنند. با فعال‌شدن ماژول‌ها، شاخص‌های آن‌ها این‌جا نمایش داده می‌شود."
          action={
            me.permissions.includes('core.module.view') ? (
              <Link to="/app/settings/modules" className="text-sm text-primary underline">
                مدیریت ماژول‌ها
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {widgets.map(({ m, w }) => (
            <Card key={w.key}>
              <CardHeader title={w.title.fa} description={m.name.fa} />
              <div className="p-5">
                <ModuleWidget module={m} widget={w} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
