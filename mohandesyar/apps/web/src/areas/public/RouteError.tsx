import { Link, isRouteErrorResponse, useRouteError } from 'react-router';

/** Last-resort error page for render errors outside module boundaries (never shows a stack trace). */
export function RouteError() {
  const err = useRouteError();
  console.error(err);
  const notFound = isRouteErrorResponse(err) && err.status === 404;
  return (
    <main role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-lg font-bold">{notFound ? 'صفحه یافت نشد' : 'نمایش این صفحه با خطا مواجه شد'}</p>
      <p className="max-w-md text-sm leading-7 text-muted">اگر مشکل ادامه داشت، با پشتیبانی تماس بگیرید.</p>
      <div className="flex gap-3">
        <button className="text-primary underline" onClick={() => location.reload()}>
          بارگذاری دوباره
        </button>
        <Link to="/" className="text-primary underline">
          صفحه اصلی
        </Link>
      </div>
    </main>
  );
}
