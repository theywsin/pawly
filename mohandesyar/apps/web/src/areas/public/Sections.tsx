import { Link } from 'react-router';
import { Check, ChevronLeft, Minus } from 'lucide-react';
import { Badge, Skeleton, cn } from '@mohandesyar/ui';
import { formatMoney, toPersianDigits } from '@mohandesyar/persian';
import { MenuIcon } from '../../lib/icons.js';
import { MODULES } from './catalog.js';
import { useAvailability, usePlans, type PublicPlan } from './data.js';

/** A landing section; `page` marks the main section of an inner page, whose title is the page's only h1. */
export function Section({ id, title, lead, children, tone = 'plain', page }: { id?: string; title: string; lead?: string; children: React.ReactNode; tone?: 'plain' | 'muted'; page?: boolean }) {
  const Heading = page ? 'h1' : 'h2';
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={cn('py-16 sm:py-20', tone === 'muted' && 'bg-surface-2/60')}>
      <div className="mx-auto max-w-6xl px-4">
        <Heading id={id ? `${id}-title` : undefined} className="text-2xl font-extrabold sm:text-3xl">
          {title}
        </Heading>
        {lead && <p className="mt-3 max-w-3xl leading-8 text-muted">{lead}</p>}
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

export function AvailabilityBadge({ id }: { id: string }) {
  const a = useAvailability()(id);
  if (a === 'unknown') return null;
  return a === 'available' ? <Badge tone="success">در دسترس</Badge> : <Badge>در دست توسعه</Badge>;
}

export function ModuleGrid() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {MODULES.map((m) => (
        <li key={m.id}>
          <Link to={`/modules/${m.id}`} className="group flex h-full flex-col rounded-lg border border-border bg-surface p-5 transition-colors hover:border-primary/50">
            <div className="flex items-start justify-between gap-3">
              <span className="rounded-md bg-primary/10 p-2 text-primary">
                <MenuIcon name={m.icon} />
              </span>
              <AvailabilityBadge id={m.id} />
            </div>
            <h3 className="mt-4 font-bold">{m.name}</h3>
            <p className="mt-2 flex-1 text-sm leading-7 text-muted">{m.tagline}</p>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
              جزئیات <ChevronLeft className="size-4" aria-hidden="true" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Core-and-modules diagram (section 5). Purely illustrative; labels are module names, no figures. */
export function ArchitectureDiagram() {
  const r = 150;
  const items = MODULES.map((m, i) => {
    const a = (i / MODULES.length) * Math.PI * 2 - Math.PI / 2;
    return { m, x: 200 + r * Math.cos(a), y: 200 + r * Math.sin(a) };
  });
  return (
    <figure className="mx-auto max-w-md">
      <svg viewBox="0 0 400 400" role="img" aria-labelledby="arch-title arch-desc" className="w-full">
        <title id="arch-title">هسته و ماژول‌ها</title>
        <desc id="arch-desc">هسته مشترک در مرکز و ماژول‌ها در اطراف آن؛ هر سازمان فقط ماژول‌های مورد نیاز خود را فعال می‌کند.</desc>
        {items.map(({ m, x, y }) => (
          <line key={`l-${m.id}`} x1="200" y1="200" x2={x} y2={y} stroke="var(--border)" strokeWidth="1.5" />
        ))}
        <circle cx="200" cy="200" r="62" fill="var(--primary)" />
        <text x="200" y="195" textAnchor="middle" fill="var(--primary-fg)" fontSize="17" fontWeight="700">
          هسته
        </text>
        <text x="200" y="218" textAnchor="middle" fill="var(--primary-fg)" fontSize="10.5">
          کاربران، مجوزها، گردش کار
        </text>
        {items.map(({ m, x, y }) => (
          <g key={m.id}>
            <circle cx={x} cy={y} r="27" fill="var(--surface)" stroke="var(--primary)" strokeWidth="1.5" />
            <text x={x} y={y + 4} textAnchor="middle" fill="var(--text)" fontSize="10.5">
              {m.short}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="mt-2 text-center text-sm text-muted">هر ماژول مستقل است و فقط از طریق رابط‌های تعریف‌شده با هسته و دیگر ماژول‌ها کار می‌کند.</figcaption>
    </figure>
  );
}

/** Sample UI built from the real design tokens; generic labels only, no numbers that could pass as data. */
export function HeroMockup() {
  return (
    <div role="img" aria-label="نمای نمونه از رابط کاربری سامانه" className="overflow-hidden rounded-xl border border-border bg-bg shadow-lg">
      <div className="flex items-center gap-2 border-b border-border bg-surface px-4 py-3">
        <span className="size-3 rounded-full bg-danger/60" />
        <span className="size-3 rounded-full bg-warning/60" />
        <span className="size-3 rounded-full bg-success/60" />
        <span className="ms-3 text-xs text-muted">نمای نمونه</span>
      </div>
      <div className="grid grid-cols-[6rem_1fr] gap-0" aria-hidden="true">
        <div className="space-y-2 border-e border-border bg-surface p-3">
          {['داشبورد', 'پروژه‌ها', 'قراردادها', 'اسناد'].map((x, i) => (
            <div key={x} className={cn('rounded px-2 py-1 text-[0.7rem]', i === 1 ? 'bg-primary/10 font-semibold text-primary' : 'text-muted')}>
              {x}
            </div>
          ))}
        </div>
        <div className="space-y-3 p-4">
          <p className="text-sm font-bold">پروژه نمونه</p>
          <div className="grid grid-cols-2 gap-3">
            {['پیشرفت برنامه‌ای', 'پیشرفت واقعی'].map((x, i) => (
              <div key={x} className="rounded-lg border border-border bg-surface p-3">
                <p className="text-[0.7rem] text-muted">{x}</p>
                <div className="mt-2 h-2 rounded-full bg-surface-2">
                  <div className={cn('h-2 rounded-full', i === 0 ? 'w-2/3 bg-primary' : 'w-1/2 bg-success')} />
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-border bg-surface p-3">
            {['فعالیت نمونه ۱', 'فعالیت نمونه ۲', 'فعالیت نمونه ۳'].map((x, i) => (
              <div key={x} className="flex items-center gap-2 py-1.5">
                <span className="w-24 truncate text-[0.7rem] text-muted">{x}</span>
                <div className="h-2 flex-1 rounded bg-surface-2">
                  <div className="h-2 rounded bg-primary/70" style={{ width: `${[70, 45, 25][i]}%`, marginInlineStart: `${[0, 20, 45][i]}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function price(p: PublicPlan, yearly: boolean): string {
  const v = yearly ? p.price_yearly : p.price_monthly;
  return v === null ? 'تماس بگیرید' : formatMoney(v, { unit: 'toman' });
}

/** Plans read from the API (never hard-coded), with a comparison table. */
export function Plans({ compact }: { compact?: boolean }) {
  const q = usePlans();
  const available = useAvailability();
  if (q.isPending) {
    return (
      <div className="grid gap-4 md:grid-cols-3" aria-busy="true" aria-label="در حال بارگذاری پلن‌ها">
        <Skeleton className="h-44 md:h-64" />
        <Skeleton className="hidden h-64 md:block" />
        <Skeleton className="hidden h-64 md:block" />
      </div>
    );
  }
  if (q.isError || !q.data?.length) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center">
        <p className="font-semibold">پلن‌های اشتراک هنوز منتشر نشده‌اند.</p>
        <p className="mt-2 text-sm text-muted">برای دریافت پیشنهاد قیمت متناسب با سازمان خود، درخواست دمو ثبت کنید.</p>
        <Link to="/demo" className="mt-4 inline-block text-primary underline">
          درخواست دمو و قیمت
        </Link>
      </div>
    );
  }
  const plans = q.data;
  const moduleIds = [...new Set(plans.flatMap((p) => p.modules.map((m) => m.moduleId)))];
  const nameOf = (id: string) => MODULES.find((m) => m.id === id)?.name ?? plans.flatMap((p) => p.modules).find((m) => m.moduleId === id)?.name?.fa ?? id;
  return (
    <div className="space-y-10">
      <ul className={cn('grid gap-4', plans.length >= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2')}>
        {plans.map((p) => (
          <li key={p.key} className="flex flex-col rounded-lg border border-border bg-surface p-6">
            <h3 className="text-lg font-bold">{p.name}</h3>
            {p.description && <p className="mt-2 text-sm leading-7 text-muted">{p.description}</p>}
            <p className="mt-4 text-2xl font-extrabold">
              {price(p, false)}
              {p.price_monthly !== null && <span className="ms-1 text-sm font-normal text-muted">/ ماه</span>}
            </p>
            {p.price_yearly !== null && <p className="text-sm text-muted">سالانه: {price(p, true)}</p>}
            <ul className="mt-4 flex-1 space-y-2 text-sm">
              <li>{p.user_limit ? `تا ${toPersianDigits(p.user_limit)} کاربر` : 'تعداد کاربر نامحدود'}</li>
              {p.storage_gb && <li>{toPersianDigits(p.storage_gb)} گیگابایت فضای ذخیره‌سازی</li>}
              {p.modules.filter((m) => m.included).map((m) => (
                <li key={m.moduleId} className="flex items-center gap-2">
                  <Check className="size-4 text-success" aria-hidden="true" /> {nameOf(m.moduleId)}
                  {available(m.moduleId) === 'coming' && <Badge>در دست توسعه</Badge>}
                </li>
              ))}
            </ul>
            <Link to="/demo" className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 font-medium text-primary-fg">
              درخواست این پلن
            </Link>
          </li>
        ))}
      </ul>
      {!compact && moduleIds.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <caption className="sr-only">مقایسه پلن‌ها</caption>
            <thead>
              <tr className="bg-surface-2">
                <th scope="col" className="px-4 py-3 text-start font-medium">ماژول / ظرفیت</th>
                {plans.map((p) => (
                  <th key={p.key} scope="col" className="px-4 py-3 text-center font-medium">{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border">
                <th scope="row" className="px-4 py-3 text-start font-normal">تعداد کاربر</th>
                {plans.map((p) => (
                  <td key={p.key} className="px-4 py-3 text-center">{p.user_limit ? toPersianDigits(p.user_limit) : 'نامحدود'}</td>
                ))}
              </tr>
              {moduleIds.map((id) => (
                <tr key={id} className="border-t border-border">
                  <th scope="row" className="px-4 py-3 text-start font-normal">{nameOf(id)}</th>
                  {plans.map((p) => {
                    const m = p.modules.find((x) => x.moduleId === id);
                    return (
                      <td key={p.key} className="px-4 py-3 text-center">
                        {m?.included ? (
                          <Check className="mx-auto size-5 text-success" aria-label="دارد" />
                        ) : m?.addonPrice ? (
                          <span className="text-xs">افزونه: {formatMoney(m.addonPrice, { unit: 'toman' })}</span>
                        ) : (
                          <Minus className="mx-auto size-5 text-muted" aria-label="ندارد" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
