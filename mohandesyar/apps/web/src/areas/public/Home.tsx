import { Link } from 'react-router';
import { Building2, ClipboardCheck, LayoutDashboard, Lock, ShieldCheck, Workflow } from 'lucide-react';
import { useSite } from './data.js';
import { usePageMeta } from './meta.js';
import { AUDIENCES, PROBLEMS, SECURITY, STEPS } from './catalog.js';
import { ArchitectureDiagram, HeroMockup, ModuleGrid, Plans, Section } from './Sections.js';
import { CtaLink } from './PublicLayout.js';
import { LeadForm } from './LeadForm.js';
import { toPersianDigits } from '@mohandesyar/persian';

export const HOME_META = {
  title: 'مهندس‌یار',
  description: 'سامانه ماژولار مدیریت پروژه، قرارداد، مالی، منابع انسانی و ایمنی برای شرکت‌های مهندسی، مشاور، پیمانکار و هلدینگ‌های عمرانی؛ قابل استقرار روی سرور سازمان.',
};

function Faq() {
  const site = useSite();
  const faq = site.data?.faq ?? [];
  if (!faq.length) return null;
  return (
    <Section id="faq" title="پرسش‌های متداول" tone="muted">
      <div className="space-y-3">
        {faq.map((f) => (
          <details key={f.id} className="group rounded-lg border border-border bg-surface p-4">
            <summary className="cursor-pointer list-none font-semibold marker:content-none">{f.question}</summary>
            <p className="mt-3 whitespace-pre-line text-sm leading-7 text-muted">{f.answer}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

export function Home() {
  usePageMeta(HOME_META);
  const site = useSite();
  const canSignup = site.data?.signupMode !== 'closed';
  return (
    <>
      <section className="border-b border-border bg-gradient-to-b from-primary/5 to-transparent">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:py-24 lg:grid-cols-2">
          <div>
            <h1 className="text-3xl font-extrabold leading-[1.5] sm:text-4xl">مدیریت شرکت مهندسی، در یک سامانه؛ فقط با ماژول‌هایی که لازم دارید</h1>
            <p className="mt-5 max-w-xl text-lg leading-9 text-muted">
              پروژه، قرارداد، بودجه، تدارکات، منابع انسانی و ایمنی را یکپارچه مدیریت کنید. داده‌های هر سازمان جدا نگهداری می‌شود و سامانه روی سرور خود شما قابل استقرار است.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <CtaLink to="/demo">درخواست دمو</CtaLink>
              {canSignup ? (
                <CtaLink to="/auth/signup" variant="secondary">
                  ساخت فضای کاری
                </CtaLink>
              ) : (
                <CtaLink to="/modules" variant="secondary">
                  آشنایی با ماژول‌ها
                </CtaLink>
              )}
            </div>
          </div>
          <HeroMockup />
        </div>
      </section>

      <Section id="problems" title="چالش‌هایی که حل می‌کنیم" lead="شرکت‌های مهندسی معمولاً با اطلاعات پراکنده و فرایندهای دستی کار می‌کنند. مهندس‌یار برای همین مسائل طراحی شده است.">
        <ul className="grid gap-4 md:grid-cols-2">
          {PROBLEMS.map((p) => (
            <li key={p.problem} className="rounded-lg border border-border bg-surface p-5">
              <p className="font-semibold">{p.problem}</p>
              <p className="mt-2 text-sm leading-7 text-muted">{p.solution}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="modules" title="ماژول‌ها" lead="هر ماژول یک بسته مستقل است. ماژول‌هایی که روی این سامانه هنوز نصب نشده‌اند با برچسب «در دست توسعه» مشخص شده‌اند." tone="muted">
        <ModuleGrid />
      </Section>

      <Section id="architecture" title="فقط آنچه نیاز دارید را فعال کنید" lead="یک هسته مشترک (کاربران، نقش‌ها، گردش کار، اعلان‌ها و فایل‌ها) و ماژول‌هایی که جداگانه فعال یا غیرفعال می‌شوند. غیرفعال‌کردن یک ماژول هیچ داده‌ای را حذف نمی‌کند.">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <ArchitectureDiagram />
          <ul className="space-y-4">
            {[
              { icon: Workflow, t: 'فعال‌سازی برای هر سازمان', d: 'منو، صفحات و ویجت‌ها فقط برای ماژول‌های فعال نمایش داده می‌شوند و API ماژول‌های غیرفعال در سرور بسته است.' },
              { icon: ShieldCheck, t: 'افزودن ماژول بدون توقف', d: 'ماژول‌های جدید به‌صورت بسته امضاشده نصب و سرویس‌ها بدون قطع دسترسی دوباره راه‌اندازی می‌شوند.' },
              { icon: ClipboardCheck, t: 'داده‌ها همیشه حفظ می‌شوند', d: 'با غیرفعال‌سازی یا پایان اشتراک داده‌ای پاک نمی‌شود؛ با فعال‌سازی دوباره همه چیز برمی‌گردد.' },
            ].map(({ icon: I, t, d }) => (
              <li key={t} className="flex gap-4">
                <I className="mt-1 size-6 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <p className="font-semibold">{t}</p>
                  <p className="mt-1 text-sm leading-7 text-muted">{d}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section id="audiences" title="مناسب چه سازمان‌هایی است؟" tone="muted">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AUDIENCES.map((a) => (
            <li key={a.title} className="rounded-lg border border-border bg-surface p-5">
              <p className="font-semibold">{a.title}</p>
              <p className="mt-2 text-sm leading-7 text-muted">{a.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="holding" title="چند شرکت، یک حساب" lead="هلدینگ‌ها و گروه‌های شرکتی همه شرکت‌های زیرمجموعه را در یک فضای کاری نگه می‌دارند؛ هر کاربر فقط شرکت‌هایی را می‌بیند که به آن‌ها دسترسی دارد.">
        <div className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-6 md:flex-row md:items-center">
          <Building2 className="size-12 shrink-0 text-primary" aria-hidden="true" />
          <ul className="grid flex-1 gap-3 text-sm leading-7 sm:grid-cols-3">
            <li>جداسازی داده هر شرکت در پایگاه داده</li>
            <li>دسترسی بین‌شرکتی فقط با مجوز صریح و ثبت‌شده</li>
            <li>انتخاب شرکت فعال یا نمای «همه شرکت‌ها» برای مدیران مجاز</li>
          </ul>
        </div>
      </Section>

      <Section id="security" title="امنیت و جداسازی داده" lead="آنچه در این بخش آمده، در نسخه فعلی سامانه پیاده‌سازی و آزمون شده است." tone="muted">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SECURITY.map((s) => (
            <li key={s.title} className="rounded-lg border border-border bg-surface p-5">
              <Lock className="size-5 text-primary" aria-hidden="true" />
              <p className="mt-3 font-semibold">{s.title}</p>
              <p className="mt-2 text-sm leading-7 text-muted">{s.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="dashboard" title="داشبورد مدیریتی" lead="داشبورد از ویجت‌هایی ساخته می‌شود که ماژول‌های فعال فراهم می‌کنند؛ هر کاربر فقط ویجت‌هایی را می‌بیند که مجوزشان را دارد.">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { t: 'داده واقعی یا هیچ', d: 'وقتی داده‌ای ثبت نشده، داشبورد «داده کافی وجود ندارد» نشان می‌دهد؛ عدد ساختگی نمایش داده نمی‌شود.' },
            { t: 'تاریخ شمسی و اعداد فارسی', d: 'همه تاریخ‌ها شمسی و با منطقه زمانی سازمان؛ نمایش اعداد فارسی یا لاتین قابل تنظیم است.' },
            { t: 'گزارش‌گیری و خروجی', d: 'خروجی Excel، CSV و PDF فارسی در نسخه‌های بعدی همراه ماژول‌های عملیاتی ارائه می‌شود.' },
          ].map((x) => (
            <div key={x.t} className="rounded-lg border border-border bg-surface p-5">
              <LayoutDashboard className="size-5 text-primary" aria-hidden="true" />
              <p className="mt-3 font-semibold">{x.t}</p>
              <p className="mt-2 text-sm leading-7 text-muted">{x.d}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="pricing" title="پلن‌ها و قیمت‌ها" tone="muted">
        <Plans compact />
        <p className="mt-6 text-sm">
          <Link to="/pricing" className="text-primary underline">
            مقایسه کامل پلن‌ها
          </Link>
        </p>
      </Section>

      <Section id="start" title="شروع کار در چهار گام">
        <ol className="grid gap-4 md:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-lg border border-border bg-surface p-5">
              <span className="inline-flex size-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-fg">{toPersianDigits(i + 1)}</span>
              <p className="mt-3 font-semibold">{s.title}</p>
              <p className="mt-2 text-sm leading-7 text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Faq />

      <Section id="demo" title="درخواست دمو" lead="فرم را پر کنید تا برای نمایش سامانه و بررسی نیازهای سازمان شما هماهنگ کنیم.">
        <LeadForm kind="demo" />
      </Section>
    </>
  );
}

export function NotFound() {
  usePageMeta({ title: 'صفحه یافت نشد', description: 'صفحه‌ای با این نشانی وجود ندارد.' });
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-5xl font-extrabold text-muted">۴۰۴</p>
      <h1 className="text-xl font-bold">صفحه‌ای با این نشانی وجود ندارد.</h1>
      <Link to="/" className="text-primary underline">
        بازگشت به صفحه اصلی
      </Link>
    </div>
  );
}
