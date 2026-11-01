# ۰۸ — سیستم طراحی UI

> وضعیت: پیش‌نویس فاز ۰ — منتظر تأیید. پیاده‌سازی در `packages/ui` (کامپوننت‌ها) و `packages/config/tailwind` (preset).

## ۱. اصول

سازمانی، خلوت، خوانا؛ رنگ فقط برای معنا (وضعیت، اقدام اصلی)، نه تزئین؛ بدون گرادیان و سایه سنگین؛ تراکم اطلاعات متوسط به بالا (کاربران با جدول زیاد کار می‌کنند) با گزینه «فشرده/راحت».

## ۲. RTL

- `<html dir="rtl" lang="fa">`؛ ساختار آماده برای `ltr`.
- فقط **ویژگی‌های منطقی**: Tailwind `ms-*`/`me-*`/`ps-*`/`pe-*`/`start-*`/`end-*`/`text-start`؛ لینت (`eslint-plugin-tailwindcss` یا قاعده سفارشی) استفاده از `ml-`/`mr-`/`left-`/`right-`/`text-left` را ممنوع می‌کند.
- آیکون‌های جهت‌دار (فلش، chevron) با کلاس `rtl:-scale-x-100`؛ آیکون‌های غیرجهت‌دار (ساعت، تیک) قرینه نمی‌شوند.
- اعداد، کدها، ایمیل، شبا، شماره قرارداد داخل `<bdi>`/`dir="ltr"` جاسازی می‌شوند تا ترتیب کاراکترها به هم نریزد.
- نمودارها: محور زمان از راست به چپ (تنظیم صریح در کتابخانه نمودار)؛ گانت هم راست‌به‌چپ.

## ۳. توکن‌ها

### رنگ (معنایی؛ مقادیر OKLCH در CSS variables، حالت روشن/تیره)

| توکن | کاربرد | روشن | تیره |
|---|---|---|---|
| `--bg` | پس‌زمینه صفحه | `oklch(0.985 0.003 250)` | `oklch(0.17 0.01 250)` |
| `--surface` | کارت، جدول | `oklch(1 0 0)` | `oklch(0.21 0.012 250)` |
| `--surface-2` | سربرگ جدول، hover | `oklch(0.965 0.005 250)` | `oklch(0.25 0.012 250)` |
| `--border` | خطوط | `oklch(0.90 0.008 250)` | `oklch(0.32 0.012 250)` |
| `--text` | متن اصلی | `oklch(0.24 0.02 255)` | `oklch(0.94 0.008 250)` |
| `--text-muted` | متن ثانویه | `oklch(0.50 0.02 255)` | `oklch(0.72 0.015 250)` |
| `--primary` | اقدام اصلی، لینک | `oklch(0.50 0.13 250)` (آبی مهندسی) | `oklch(0.70 0.12 250)` |
| `--primary-fg` | متن روی primary | سفید | `oklch(0.17 0.01 250)` |
| `--success` / `--warning` / `--danger` / `--info` | وضعیت | سبز/کهربایی/قرمز/فیروزه‌ای با کنتراست ≥ 4.5:1 روی surface | نسخه روشن‌تر |
| `--focus` | حلقه فوکوس | `--primary` با ۲px offset | |

مقادیر نهایی در فاز ۱ با ابزار بررسی کنتراست اعتبارسنجی می‌شوند (تست خودکار نسبت کنتراست جفت‌های توکن). رنگ برند (`--primary`) از تنظیمات برندینگ قابل جایگزینی است و ابزار، کنتراست آن را هنگام ذخیره بررسی می‌کند.

### تایپوگرافی

| توکن | اندازه / ارتفاع خط | وزن | کاربرد |
|---|---|---|---|
| `display` | 2.25rem / 1.3 | 800 | Hero لندینگ |
| `h1` | 1.5rem / 1.5 | 700 | عنوان صفحه |
| `h2` | 1.25rem / 1.6 | 700 | بخش |
| `h3` | 1.0625rem / 1.7 | 600 | کارت |
| `body` | 0.9375rem (15px) / 1.8 | 400 | متن |
| `small` | 0.8125rem / 1.7 | 400 | توضیح، برچسب |
| `mono-num` | `font-variant-numeric: tabular-nums` | | ستون‌های عددی و مبالغ |

ارتفاع خط فارسی بیشتر از لاتین (۱.۷–۱.۸) برای نقطه‌ها و دندانه‌ها.

### جدول فونت

| فونت | مجوز | استفاده | منبع |
|---|---|---|---|
| **Vazirmatn** (متغیر، 100–900) | SIL OFL 1.1 | همه متن UI و PDF | `@fontsource/vazirmatn` (کپی در build، self-host، woff2، `font-display: swap`، subset فارسی+لاتین) |
| Vazirmatn (ارقام فارسی/لاتین) | همان | از `font-feature-settings` استفاده نمی‌شود؛ تبدیل ارقام در لایه فرمت‌کننده انجام می‌شود (تنظیم کاربر) | |
| ایران‌یکان (IRANYekan) | **تجاری** | فقط اگر مجوز خریداری‌شده ارائه شود؛ از طریق تنظیم `branding.fontFamily` + آپلود فایل فونت توسط مشتری | در مخزن قرار نمی‌گیرد |
| JetBrains Mono / سیستم | OFL | کد و شناسه‌ها (کم‌کاربرد) | self-host |

### فاصله، شعاع، سایه، حرکت
- فاصله: مقیاس ۴px Tailwind؛ چگالی جدول: ردیف ۴۰px (راحت) / ۳۲px (فشرده).
- شعاع: `--radius-sm 4px`، `--radius 8px`، `--radius-lg 12px`.
- سایه: فقط `--shadow-sm` برای popover/مودال؛ کارت‌ها border دارند نه سایه.
- حرکت: ۱۵۰–۲۰۰ms `ease-out`؛ همه انیمیشن‌ها زیر `@media (prefers-reduced-motion: no-preference)`.
- breakpointها: `sm 640`، `md 768` (تبلت)، `lg 1024` (نوار کناری ثابت)، `xl 1280`.

## ۴. کامپوننت‌ها (`@mohandesyar/ui`)

پایه: Radix Primitives (headless، دسترس‌پذیر، پشتیبانی `dir`) + کلاس‌های Tailwind به سبک shadcn/ui (کد کامپوننت در مخزن ما، نه وابستگی).

| گروه | کامپوننت‌ها |
|---|---|
| پایه | Button (primary/secondary/ghost/danger، loading)، IconButton، Link، Badge/StatusBadge، Avatar، Tooltip، Separator، Skeleton، Spinner |
| فرم (با RHF + Zod) | Form/FormField/FormMessage (پیام خطای فارسی از نقشه کد خطای Zod)، Input، Textarea، NumberInput (جداکننده هزارگان، ارقام فارسی/لاتین)، **MoneyInput** (ریال/تومان، نمایش به حروف)، Select، Combobox (async)، MultiSelect، Checkbox، Radio، Switch، **JalaliDatePicker** و DateRangePicker (ذخیره ISO UTC)، FileUpload (پیشرفت، اسکن)، TagInput، PhoneInput (نرمال‌سازی ۰۹…)، NationalIdInput (اعتبارسنجی کدملی/شناسه ملی) |
| داده | **DataTable** (TanStack Table: مرتب‌سازی، فیلتر ستونی، صفحه‌بندی سمت سرور، انتخاب ردیف، ستون‌های قابل پنهان‌سازی، چگالی، خروجی، ذخیره فیلتر)، FilterBar، EmptyState، Pagination، DescriptionList، Timeline، KanbanBoard، TreeView، **Gantt** (فاز ۳، احتمالاً پیاده‌سازی داخلی SVG؛ کتابخانه‌های موجود RTL ضعیف دارند) |
| ساختار | AppShell، Sidebar (منوی پویا)، Topbar، Breadcrumb، PageHeader (عنوان + اقدامات)، Tabs، Card، Drawer، Dialog، **ConfirmDialog** (برای عملیات مخرب: تایپ نام در موارد بسیار مخرب)، Toast، Banner، **PageState** |
| نمودار | بر پایه یک کتابخانه سبک SVG (پیشنهاد: Recharts یا visx — انتخاب در فاز ۳ پس از تست RTL)؛ KpiTile، Sparkline، BarChart، LineChart، Donut، ProgressBar (برنامه‌ای/واقعی هم‌زمان) |
| ویجت | WidgetFrame (عنوان، لینک جزئیات، حالت «داده کافی وجود ندارد»، زمان آخرین به‌روزرسانی، منبع داده) |

## ۵. فرمت‌کننده‌ها (`@mohandesyar/persian`)

- `formatDate(utc, { calendar: 'jalali', tz })`، `formatRelative`، تبدیل شمسی↔میلادی (با `date-fns-jalali` — نسخه پایدار باید در فاز ۱ بررسی شود؛ جایگزین: پیاده‌سازی الگوریتم مستقل با تست مرجع).
- `formatNumber(n, { digits: 'fa'|'latn' })`، `formatMoney(rial, { unit: 'rial'|'toman' })`، `numberToWords` فارسی.
- `normalizePersian(text)`: ي→ی، ك→ک، حذف اعراب و کشیده، یکسان‌سازی نیم‌فاصله، ارقام عربی/فارسی→لاتین؛ برای ذخیره کلید جست‌وجو و تشخیص تکرار.
- ورودی‌ها هر دو نوع رقم را می‌پذیرند.

## ۶. دسترس‌پذیری

ناوبری کامل با کیبورد (ترتیب tab منطقی در RTL)، `skip-to-content`، فوکوس قابل مشاهده، `aria-live` برای toast و نتایج async، برچسب برای همه کنترل‌ها، کنتراست AA، اهداف لمسی ≥ ۴۰px در موبایل، تست خودکار با `@axe-core/playwright`.

## ۷. حالت تیره

اختیاری با سه گزینه (روشن/تیره/سیستم)، ذخیره در تنظیمات کاربر؛ لندینگ هم پشتیبانی می‌کند. پیاده‌سازی فقط از طریق توکن‌ها (کلاس `dark` روی `html`).
