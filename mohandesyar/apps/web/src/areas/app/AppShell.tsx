import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckSquare, ClipboardCheck, LayoutDashboard, LogOut, Menu, Moon, Puzzle, ScrollText, Search, Sun, User, Users, WifiOff, X, CalendarDays } from 'lucide-react';
import { Badge, cn, Toaster } from '@mohandesyar/ui';
import { appApi, getToken, setToken } from '../../lib/api.js';
import { useAppSession } from '../../lib/session.js';
import { MenuIcon } from '../../lib/icons.js';
import { useUi } from '../../lib/ui-store.js';
import { BrandMark } from '../../brand.js';

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener('online', on);
    addEventListener('offline', off);
    return () => {
      removeEventListener('online', on);
      removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Live notification signals over SSE (fetch-based so the Authorization header can be sent). */
function useNotificationStream() {
  const qc = useQueryClient();
  useEffect(() => {
    const ctrl = new AbortController();
    let stopped = false;
    const connect = async () => {
      while (!stopped) {
        try {
          const res = await fetch('/api/core/notifications/stream', { headers: { authorization: `Bearer ${getToken('app')}` }, signal: ctrl.signal });
          if (!res.ok || !res.body) throw new Error(String(res.status));
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value.includes('event: notification')) void qc.invalidateQueries({ queryKey: ['notifications'] });
          }
        } catch {
          if (stopped) return;
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
    };
    void connect();
    return () => {
      stopped = true;
      ctrl.abort();
    };
  }, [qc]);
}

export function AppShell() {
  const { me, switchCompany } = useAppSession();
  const { sidebarOpen, setSidebar, theme, setTheme } = useUi();
  const online = useOnline();
  const nav = useNavigate();
  const qc = useQueryClient();
  useNotificationStream();
  const unread = useQuery({ queryKey: ['notifications', 'count'], queryFn: () => appApi<{ unread: number }>('/api/core/notifications?unread=1'), refetchInterval: 60_000 });
  const can = (p: string) => me.permissions.includes(p);
  const moduleItems = me.modules.flatMap((m) => m.menu).sort((a, b) => a.order - b.order);
  const readOnly = me.modules.some((m) => m.mode !== 'full') || me.tenant.status === 'suspended';

  const logout = async () => {
    await appApi('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setToken('app', null);
    qc.clear();
    nav('/auth/login', { replace: true });
  };
  const search = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = new FormData(e.currentTarget).get('q');
    if (typeof q === 'string' && q.trim().length >= 2) nav(`/app/search?q=${encodeURIComponent(q.trim())}`);
  };

  const link = ({ isActive }: { isActive: boolean }) =>
    cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm', isActive ? 'bg-primary/10 font-semibold text-primary' : 'text-text hover:bg-surface-2');

  const sidebar = (
    <nav aria-label="منوی اصلی" className="flex h-full flex-col gap-1 overflow-y-auto p-3" onClick={() => setSidebar(false)}>
      <NavLink to="/app" end className={link}>
        <LayoutDashboard className="size-5" /> داشبورد
      </NavLink>
      <NavLink to="/app/tasks" className={link}>
        <CheckSquare className="size-5" /> وظایف
      </NavLink>
      <NavLink to="/app/approvals" className={link}>
        <ClipboardCheck className="size-5" /> کارتابل تأیید
      </NavLink>
      {moduleItems.length > 0 && <p className="mt-4 px-3 text-xs font-medium text-muted">ماژول‌ها</p>}
      {moduleItems.map((i) => (
        <NavLink key={i.key} to={i.path} className={link}>
          <MenuIcon name={i.icon} /> {i.label.fa}
        </NavLink>
      ))}
      <p className="mt-4 px-3 text-xs font-medium text-muted">تنظیمات</p>
      {can('core.user.view') && (
        <NavLink to="/app/settings/members" className={link}>
          <Users className="size-5" /> کاربران و نقش‌ها
        </NavLink>
      )}
      {can('core.module.view') && (
        <NavLink to="/app/settings/modules" className={link}>
          <Puzzle className="size-5" /> ماژول‌ها
        </NavLink>
      )}
      <NavLink to="/app/settings/calendar" className={link}>
        <CalendarDays className="size-5" /> تقویم کاری
      </NavLink>
      {can('core.audit.view') && (
        <NavLink to="/app/settings/audit" className={link}>
          <ScrollText className="size-5" /> گزارش رویدادها
        </NavLink>
      )}
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">
        رفتن به محتوای اصلی
      </a>
      <aside className="hidden border-e border-border bg-surface lg:block">
        <div className="flex h-14 items-center border-b border-border px-5 font-extrabold text-primary"><BrandMark size={28} /></div>
        {sidebar}
      </aside>
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="منو">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebar(false)} />
          <aside className="absolute inset-y-0 start-0 w-72 bg-surface">
            <div className="flex h-14 items-center justify-between border-b border-border px-4 font-extrabold text-primary">
              <BrandMark size={28} />
              <button aria-label="بستن منو" onClick={() => setSidebar(false)} className="rounded p-1 text-muted">
                <X className="size-5" />
              </button>
            </div>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface/95 px-3 backdrop-blur sm:px-5">
          <button className="rounded p-2 text-muted lg:hidden" aria-label="باز کردن منو" onClick={() => setSidebar(true)}>
            <Menu className="size-5" />
          </button>
          {me.companies.length > 1 ? (
            <select aria-label="شرکت فعال" className="h-9 max-w-40 rounded-md border border-border bg-surface px-2 text-sm" value={me.company.ids.length > 1 ? 'all' : me.company.id} onChange={(e) => switchCompany(e.target.value)}>
              {me.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="all">همه شرکت‌ها</option>
            </select>
          ) : (
            <span className="truncate text-sm font-semibold">{me.tenant.name}</span>
          )}
          <form role="search" onSubmit={search} className="ms-auto hidden max-w-sm flex-1 sm:block">
            <label className="relative block">
              <span className="sr-only">جست‌وجوی سراسری</span>
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input name="q" placeholder="جست‌وجو…" className="h-9 w-full rounded-md border border-border bg-surface-2 ps-9 pe-3 text-sm" />
            </label>
          </form>
          <Link to="/app/search" className="ms-auto rounded p-2 text-muted sm:hidden" aria-label="جست‌وجو">
            <Search className="size-5" />
          </Link>
          <Link to="/app/notifications" className="relative rounded p-2 text-muted hover:bg-surface-2" aria-label={`اعلان‌ها${unread.data?.unread ? ` (${unread.data.unread} خوانده‌نشده)` : ''}`}>
            <Bell className="size-5" />
            {!!unread.data?.unread && <span className="absolute end-1 top-1 size-2 rounded-full bg-danger" />}
          </Link>
          <button className="rounded p-2 text-muted hover:bg-surface-2" aria-label="تغییر حالت روشن/تیره" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </button>
          <Link to="/app/profile" className="rounded p-2 text-muted hover:bg-surface-2" aria-label="حساب کاربری">
            <User className="size-5" />
          </Link>
          <button className="rounded p-2 text-muted hover:bg-surface-2" aria-label="خروج" onClick={() => void logout()}>
            <LogOut className="size-5" />
          </button>
        </header>
        {!online && (
          <div role="status" className="flex items-center gap-2 bg-warning/15 px-5 py-2 text-sm text-warning">
            <WifiOff className="size-4" /> اتصال اینترنت قطع است؛ تغییرات پس از اتصال دوباره ارسال نمی‌شوند.
          </div>
        )}
        {readOnly && (
          <div role="status" className="bg-warning/15 px-5 py-2 text-sm">
            <Badge tone="warning">فقط مشاهده</Badge> اشتراک سازمان منقضی یا حساب تعلیق شده است؛ مشاهده و خروجی ممکن است ولی ثبت اطلاعات جدید نه.
          </div>
        )}
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}
