import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { Menu, Moon, Sun, X } from 'lucide-react';
import { cn, Ltr } from '@mohandesyar/ui';
import { jalaliParts, toPersianDigits } from '@mohandesyar/persian';
import { useUi } from '../../lib/ui-store.js';
import { useSite } from './data.js';
import { BRAND_NAME, BrandMark } from '../../brand.js';

const NAV = [
  { to: '/modules', label: 'ماژول‌ها' },
  { to: '/pricing', label: 'قیمت‌ها' },
  { to: '/download', label: 'دانلود اپلیکیشن' },
  { to: '/about', label: 'درباره ما' },
  { to: '/contact', label: 'تماس' },
];

export function CtaLink({ to, children, variant = 'primary', className }: { to: string; children: ReactNode; variant?: 'primary' | 'secondary'; className?: string }) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex h-11 items-center justify-center rounded-md px-5 font-medium transition-colors',
        variant === 'primary' ? 'bg-primary text-primary-fg hover:bg-primary/90' : 'border border-border bg-surface hover:bg-surface-2',
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function PublicLayout() {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useUi();
  // The stored theme is only known in the browser; render the neutral icon until mounted so hydration matches.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && theme === 'dark';
  const site = useSite();
  const year = toPersianDigits(jalaliParts(Date.now()).year);
  const link = ({ isActive }: { isActive: boolean }) => cn('rounded-md px-3 py-2 text-[0.9375rem] hover:bg-surface-2', isActive && 'font-semibold text-primary');
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">
        رفتن به محتوای اصلی
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <Link to="/" className="text-xl font-extrabold text-primary" aria-label={`${BRAND_NAME} — صفحه اصلی`}>
            <BrandMark />
          </Link>
          <nav aria-label="منوی اصلی" className="hidden flex-1 items-center gap-1 md:flex">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={link}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <button className="rounded-md p-2 text-muted hover:bg-surface-2" aria-label="تغییر حالت روشن/تیره" onClick={() => setTheme(dark ? 'light' : 'dark')}>
              {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
            </button>
            <Link to="/auth/login" className="hidden rounded-md px-3 py-2 text-[0.9375rem] hover:bg-surface-2 sm:inline-block">
              ورود
            </Link>
            <CtaLink to="/pricing" className="hidden h-10 sm:inline-flex">
              خرید اشتراک
            </CtaLink>
            <button className="rounded-md p-2 md:hidden" aria-label={open ? 'بستن منو' : 'باز کردن منو'} aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? <X className="size-6" /> : <Menu className="size-6" />}
            </button>
          </div>
        </div>
        {open && (
          <nav aria-label="منوی موبایل" className="border-t border-border px-4 py-3 md:hidden" onClick={() => setOpen(false)}>
            <div className="flex flex-col gap-1">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} className={link}>
                  {n.label}
                </NavLink>
              ))}
              <NavLink to="/auth/login" className={link}>
                ورود
              </NavLink>
              <CtaLink to="/pricing" className="mt-2">
                خرید اشتراک
              </CtaLink>
            </div>
          </nav>
        )}
      </header>
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-lg font-extrabold text-primary"><BrandMark size={28} /></p>
            <p className="mt-2 text-sm leading-7 text-muted">سامانه ماژولار مدیریت شرکت‌های مهندسی، مشاور، پیمانکار و هلدینگ‌های عمرانی؛ قابل استقرار روی سرور خود سازمان.</p>
          </div>
          <div>
            <p className="font-semibold">محصول</p>
            <ul className="mt-2 space-y-1 text-sm">
              <li><Link className="hover:text-primary" to="/modules">ماژول‌ها</Link></li>
              <li><Link className="hover:text-primary" to="/pricing">قیمت‌ها</Link></li>
              <li><Link className="hover:text-primary" to="/download">دانلود اپلیکیشن</Link></li>
              {site.data?.signupMode !== 'closed' && <li><Link className="hover:text-primary" to="/auth/signup">ثبت‌نام سازمان</Link></li>}
            </ul>
          </div>
          <div>
            <p className="font-semibold">شرکت</p>
            <ul className="mt-2 space-y-1 text-sm">
              <li><Link className="hover:text-primary" to="/about">درباره ما</Link></li>
              <li><Link className="hover:text-primary" to="/contact">تماس با ما</Link></li>
              <li><Link className="hover:text-primary" to="/terms">شرایط استفاده</Link></li>
              <li><Link className="hover:text-primary" to="/privacy">حریم خصوصی</Link></li>
            </ul>
          </div>
          {site.data?.contact && (
            <div>
              <p className="font-semibold">ارتباط</p>
              <ul className="mt-2 space-y-1 text-sm text-muted">
                {site.data.contact.phone && <li>تلفن: <Ltr>{site.data.contact.phone}</Ltr></li>}
                {site.data.contact.email && <li>ایمیل: <Ltr>{site.data.contact.email}</Ltr></li>}
                {site.data.contact.address && <li>{site.data.contact.address}</li>}
              </ul>
            </div>
          )}
        </div>
        <p className="border-t border-border px-4 py-4 text-center text-xs leading-6 text-muted">
          © {year} {BRAND_NAME} — طراحی شده توسط شرکت دات وب{' '}
          <a href="https://dot-web.ir/" target="_blank" rel="noopener" className="hover:text-primary" dir="ltr">
            dot-web.ir
          </a>
        </p>
      </footer>
    </div>
  );
}
