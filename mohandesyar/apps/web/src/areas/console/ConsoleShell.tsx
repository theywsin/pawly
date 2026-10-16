import { NavLink, Outlet, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Activity, Building2, CreditCard, FileText, Inbox, KeyRound, LogOut, Newspaper, Puzzle, ScrollText } from 'lucide-react';
import { cn, Toaster } from '@mohandesyar/ui';
import { consoleApi, setToken } from '../../lib/api.js';
import { useAdmin } from '../../lib/session.js';

export function ConsoleShell() {
  const admin = useAdmin();
  const nav = useNavigate();
  const qc = useQueryClient();
  const link = ({ isActive }: { isActive: boolean }) => cn('flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap', isActive ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-surface-2');
  const logout = async () => {
    await consoleApi('/api/console/auth/logout', { method: 'POST' }).catch(() => undefined);
    setToken('console', null);
    qc.clear();
    nav('/console/login', { replace: true });
  };
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2">
          <span className="me-4 font-extrabold text-primary">مدیریت پلتفرم</span>
          <nav aria-label="منوی پنل مدیریت" className="flex flex-1 gap-1 overflow-x-auto">
            <NavLink to="/console" end className={link}>
              <Activity className="size-4" /> وضعیت سامانه
            </NavLink>
            <NavLink to="/console/modules" className={link}>
              <Puzzle className="size-4" /> ماژول‌ها
            </NavLink>
            <NavLink to="/console/tenants" className={link}>
              <Building2 className="size-4" /> مشتریان
            </NavLink>
            <NavLink to="/console/leads" className={link}>
              <Inbox className="size-4" /> درخواست‌ها
            </NavLink>
            {(admin.roles.includes('super_admin') || admin.roles.includes('sales_admin')) && (
              <>
                <NavLink to="/console/plans" className={link}>
                  <CreditCard className="size-4" /> پلن‌ها
                </NavLink>
                <NavLink to="/console/content" className={link}>
                  <FileText className="size-4" /> محتوای سایت
                </NavLink>
                <NavLink to="/console/blog" className={link}>
                  <Newspaper className="size-4" /> وبلاگ
                </NavLink>
              </>
            )}
            {admin.roles.includes('tech_admin') && (
              <NavLink to="/console/keys" className={link}>
                <KeyRound className="size-4" /> کلیدهای امضا
              </NavLink>
            )}
            <NavLink to="/console/audit" className={link}>
              <ScrollText className="size-4" /> رویدادها
            </NavLink>
          </nav>
          <span className="text-sm text-muted">{admin.fullName}</span>
          <button className="rounded p-2 text-muted hover:bg-surface-2" aria-label="خروج" onClick={() => void logout()}>
            <LogOut className="size-4" />
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
}
