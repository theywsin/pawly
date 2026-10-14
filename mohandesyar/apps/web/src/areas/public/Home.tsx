import { Link } from 'react-router';

/**
 * Minimal public entry for phase 1. The full landing page (docs/07 §2) is phase 2; until then this page
 * makes no product claims beyond what exists.
 */
export function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-3xl font-extrabold text-primary">مهندس‌یار</h1>
      <p className="max-w-md leading-8 text-muted">سامانه مدیریت شرکت‌های مهندسی و عمرانی</p>
      <div className="flex gap-3">
        <Link to="/auth/login" className="rounded-md bg-primary px-5 py-2 font-medium text-primary-fg">
          ورود
        </Link>
        <Link to="/auth/signup" className="rounded-md border border-border bg-surface px-5 py-2 font-medium">
          ثبت‌نام سازمان
        </Link>
      </div>
    </main>
  );
}

export function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-5xl font-extrabold text-muted">۴۰۴</p>
      <p>صفحه‌ای با این نشانی وجود ندارد.</p>
      <Link to="/" className="text-primary underline">
        بازگشت به صفحه اصلی
      </Link>
    </main>
  );
}
