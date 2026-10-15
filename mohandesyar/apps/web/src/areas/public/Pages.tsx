import { Link, useParams } from 'react-router';
import { Check } from 'lucide-react';
import { Ltr, Skeleton } from '@mohandesyar/ui';
import { formatDate } from '@mohandesyar/persian';
import { MODULES } from './catalog.js';
import { usePage, useSite } from './data.js';
import { usePageMeta } from './meta.js';
import { AvailabilityBadge, ModuleGrid, Plans, Section } from './Sections.js';
import { LeadForm } from './LeadForm.js';
import { CtaLink } from './PublicLayout.js';
import { NotFound } from './Home.js';

export const PAGE_META = {
  pricing: { title: 'پلن‌ها و قیمت‌ها', description: 'پلن‌های اشتراک مهندیکس، ماژول‌های هر پلن و مقایسه آن‌ها.' },
  modules: { title: 'ماژول‌ها', description: 'ماژول‌های مهندیکس: پروژه، CRM، قراردادها، مالی و بودجه، تدارکات، منابع انسانی، KPI، اسناد، QHSE، جلسات و هلدینگ.' },
  about: { title: 'درباره ما', description: 'درباره مهندیکس.' },
  contact: { title: 'تماس با ما', description: 'راه‌های ارتباط با مهندیکس و فرم تماس.' },
  demo: { title: 'درخواست دمو', description: 'درخواست نمایش سامانه مهندیکس و بررسی نیازهای سازمان شما.' },
  terms: { title: 'شرایط استفاده', description: 'شرایط استفاده از سامانه مهندیکس.' },
  privacy: { title: 'حریم خصوصی', description: 'سیاست حریم خصوصی مهندیکس.' },
} as const;

export function PricingPage() {
  usePageMeta(PAGE_META.pricing);
  return (
    <Section page title="پلن‌ها و قیمت‌ها" lead="قیمت‌ها توسط مدیر سامانه تعیین و به‌روز می‌شوند. برای استقرار اختصاصی یا قرارداد سازمانی درخواست دمو ثبت کنید.">
      <Plans />
    </Section>
  );
}

export function ModulesPage() {
  usePageMeta(PAGE_META.modules);
  return (
    <Section page title="ماژول‌ها" lead="هر سازمان فقط ماژول‌های مورد نیاز خود را فعال می‌کند. ماژول‌های «در دست توسعه» هنوز روی این سامانه نصب نشده‌اند.">
      <ModuleGrid />
    </Section>
  );
}

export function ModuleDetailPage() {
  const { id } = useParams();
  const m = MODULES.find((x) => x.id === id);
  usePageMeta(m ? { title: m.name, description: m.tagline } : { title: 'صفحه یافت نشد', description: '' });
  if (!m) return <NotFound />;
  return (
    <Section page title={m.name} lead={m.tagline}>
      <div className="mb-6">
        <AvailabilityBadge id={m.id} />
      </div>
      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <ul className="space-y-3">
          {m.features.map((f) => (
            <li key={f} className="flex gap-3 leading-8">
              <Check className="mt-1.5 size-5 shrink-0 text-success" aria-hidden="true" />
              {f}
            </li>
          ))}
        </ul>
        <aside className="h-fit rounded-lg border border-border bg-surface p-5">
          <p className="font-semibold">کار در کنار ماژول‌های دیگر</p>
          <ul className="mt-3 space-y-2 text-sm">
            {m.worksWith.map((w) => {
              const o = MODULES.find((x) => x.id === w);
              return o ? (
                <li key={w}>
                  <Link to={`/modules/${w}`} className="text-primary underline">
                    {o.name}
                  </Link>
                </li>
              ) : null;
            })}
          </ul>
          <p className="mt-3 text-xs leading-6 text-muted">اتصال به این ماژول‌ها اختیاری است؛ اگر فعال نباشند، قابلیت‌های مربوط پنهان می‌شوند.</p>
          <CtaLink to="/demo" className="mt-5 w-full">
            درخواست دمو
          </CtaLink>
        </aside>
      </div>
    </Section>
  );
}

export function ContentPage({ pageKey }: { pageKey: 'about' | 'terms' | 'privacy' }) {
  usePageMeta(PAGE_META[pageKey]);
  const q = usePage(pageKey);
  return (
    <Section page title={q.data?.title ?? PAGE_META[pageKey].title}>
      {q.isPending ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ) : q.isError ? (
        <p className="text-muted">متن این صفحه هنوز توسط مدیر سامانه منتشر نشده است.</p>
      ) : (
        <article className="max-w-3xl space-y-4 leading-9">
          {q.data.body.split(/\n\s*\n/).map((p, i) => (
            <p key={i} className="whitespace-pre-line">
              {p}
            </p>
          ))}
          <p className="text-sm text-muted">آخرین به‌روزرسانی: {formatDate(q.data.updatedAt)}</p>
        </article>
      )}
    </Section>
  );
}

export function ContactPage() {
  usePageMeta(PAGE_META.contact);
  const site = useSite();
  const c = site.data?.contact;
  return (
    <Section page title="تماس با ما" lead="پرسش یا پیشنهاد خود را بفرستید.">
      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <LeadForm kind="contact" />
        {c && (
          <aside className="h-fit space-y-2 rounded-lg border border-border bg-surface p-5 text-sm">
            {c.phone && <p>تلفن: <Ltr>{c.phone}</Ltr></p>}
            {c.email && <p>ایمیل: <Ltr>{c.email}</Ltr></p>}
            {c.address && <p>نشانی: {c.address}</p>}
            {c.hours && <p>ساعات پاسخ‌گویی: {c.hours}</p>}
          </aside>
        )}
      </div>
    </Section>
  );
}

export function DemoPage() {
  usePageMeta(PAGE_META.demo);
  return (
    <Section page title="درخواست دمو" lead="اطلاعات تماس و نیازهای سازمان خود را بنویسید تا برای نمایش سامانه هماهنگ کنیم.">
      <LeadForm kind="demo" />
    </Section>
  );
}
