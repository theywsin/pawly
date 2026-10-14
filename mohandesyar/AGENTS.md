# مهندس‌یار — راهنمای عامل کدنویس

> این فایل با `AGENTS.md` **محتوای یکسان** دارد. هر تغییر در یکی باید در دیگری هم اعمال شود (`cp CLAUDE.md AGENTS.md`).

## وضعیت پروژه

- **فاز فعلی: ۰ (طراحی) — تکمیل‌شده، منتظر تأیید کارفرما برای شروع فاز ۱.**
- هنوز هیچ کد برنامه‌ای وجود ندارد. پیش از تأیید صریح، کد ننویس.
- اسناد طراحی: [`docs/README.md`](docs/README.md). فرض‌ها: `docs/assumptions.md`. سؤال‌های باز: `docs/open-questions.md`.

## خلاصه معماری

پلتفرم SaaS چندمستاجری و ماژولار برای شرکت‌های مهندسی/عمرانی ایران. هسته حداقلی (احراز هویت، Tenant/Company، RBAC، Module Registry/Loader، Entitlement، Workflow، اعلان، فایل، Audit، Event Bus، گزارش، Widget Registry، تنظیمات، پشتیبانی، جست‌وجو) و همه قابلیت‌های کسب‌وکار به‌صورت **ماژول‌های بسته‌بندی‌شده و امضاشده** که از پنل ادمین نصب، فعال، غیرفعال، ارتقا و حذف می‌شوند. جزئیات: `docs/02-architecture.md` و `docs/03-module-system.md`.

## تصمیم‌های قطعی

| موضوع | تصمیم |
|---|---|
| مخزن | Monorepo: pnpm workspaces + Turborepo؛ lockfile قفل |
| فرانت | SPA: Vite + React + TypeScript؛ React Router (data router)؛ TanStack Query؛ Zustand فقط برای وضعیت UI؛ React Hook Form + Zod؛ Tailwind (RTL، فقط ویژگی‌های منطقی) + Radix |
| لندینگ | همان SPA، prerender ایستا در build (vite-react-ssg)؛ بقیه SPA خالص |
| بک‌اند | NestJS (Fastify adapter)، Monolith ماژولار، OpenAPI از کد |
| دیتابیس | PostgreSQL؛ **Drizzle ORM**؛ runner مهاجرت اختصاصی per-module (`core_module_migrations`) |
| چندمستاجری | DB مشترک، `tenant_id` + `company_id`، RLS با `set_config('app.tenant_id', …, true)` در هر تراکنش، نقش `mohandesyar_app` بدون BYPASSRLS، `FORCE ROW LEVEL SECURITY` |
| صف/کش | Redis + BullMQ؛ Event Bus درون‌فرایندی + Transactional Outbox |
| فایل | S3-سازگار (MinIO)، لینک امضاشده موقت |
| ماژول بک‌اند | `import()` پویا در بوت + NestJS DynamicModule؛ تغییر کد = graceful reload؛ فعال/غیرفعال = بدون ری‌استارت (Guard) |
| ماژول فرانت | ESM با Vite library mode + import map برای کتابخانه‌های مشترک؛ `import()` پویا |
| امضای بسته | Ed25519 روی CHECKSUMS (SHA-256 همه فایل‌ها)؛ CLI: `module:pack`/`sign`/`verify`/`keygen` |
| PDF | Chromium headless (Playwright) در Worker |
| جست‌وجو | PostgreSQL FTS (`simple`) + نرمال‌سازی فارسی + `pg_trgm` |
| فونت | Vazirmatn خودمیزبان (OFL) |
| تاریخ | `timestamptz` UTC، نمایش شمسی، ارقام فارسی/لاتین قابل تنظیم |
| مبلغ | `numeric(20,0)` ریال؛ هرگز float |
| استقرار | Docker Compose؛ قابل انتقال به Kubernetes |
| تست | Vitest (واحد/یکپارچه با DB واقعی)، Playwright (E2E)، dependency-cruiser (مرزها) |
| **حذف‌شده** | هرگونه قابلیت هوش مصنوعی یا placeholder آن |

## دستورها (برنامه‌ریزی‌شده — از فاز ۱ فعال می‌شوند)

```bash
pnpm install --frozen-lockfile
pnpm dev                     # compose (pg, redis, minio) + api + web
pnpm lint                    # eslint + dependency-cruiser (مرز ماژول‌ها)
pnpm typecheck
pnpm test:unit
pnpm test:integration        # نیازمند Docker (Postgres/Redis/MinIO واقعی)
pnpm test:e2e                # Playwright
pnpm build
pnpm module:keygen | module:pack <dir> | module:sign <pkg> --key <file> | module:verify <pkg> --pub <file>
pnpm db:migrate              # مهاجرت هسته + ماژول‌های پیش‌نصب
pnpm ci:local                # همه موارد بالا به ترتیب CI
```

این بخش را هنگام افزودن هر اسکریپت واقعی به‌روز کن و دستورهای ناموجود را حذف یا علامت‌گذاری کن.

## قواعد کاری (غیرقابل مذاکره)

1. **اول طراحی، بعد کد.** پایان هر فاز: توقف و انتظار تأیید.
2. هر فاز → وظایف کوچک → **یک commit مستقل برای هر وظیفه** با پیام روشن.
3. وظیفه «تمام» = کد + تست + **اجرای تست و دیدن نتیجه**. هرگز ادعای تکمیل چیزی که اجرا نشده.
4. **هیچ داده ساختگی، صفحه بدون بک‌اند، دکمه بی‌عملکرد، آمار جعلی یا نظر مشتری ساختگی.** نبود داده = حالت خالی صادقانه.
5. ابهام پرهزینه → گزینه‌ها و پیامدها را بنویس و بپرس. ابهام کم‌هزینه → فرض در `docs/assumptions.md` و ادامه.
6. گزارش پایان فاز: فایل‌ها، قابلیت‌ها، تست‌ها و نتیجه اجرا، محدودیت‌ها، پیش‌نیاز فاز بعد.
7. وابستگی: بررسی نگه‌داری و مجوز پیش از افزودن؛ نسخه‌ها در lockfile قفل؛ بدون کتابخانه رهاشده یا مجوز نامناسب.
8. **بدون وابستگی زمان اجرا به سرویس خارجی** (CDN، Google Fonts، آنالیتیکس، API ابری). پیامک/درگاه فقط adapter اختیاری.
9. این فایل و `AGENTS.md` را در طول پروژه به‌روز و یکسان نگه دار.

## قواعد کدنویسی

- TypeScript `strict`؛ بدون `any` بدون توضیح؛ Zod برای همه ورودی‌های API (اسکیمای مشترک در `packages/shared-types`).
- **مرز ماژول‌ها:** `apps/api/src/core` هرگز از `modules/*` import نمی‌کند؛ ماژول فقط از `@mohandesyar/module-sdk`، `shared-types`، `ui` و کتابخانه‌های مجاز import می‌کند؛ ارتباط بین ماژول‌ها فقط از Public API ثبت‌شده، Event Bus یا Provider. dependency-cruiser این را در CI اجبار می‌کند.
- جداول ماژول با پیشوند `<moduleId>_`؛ ارجاع بین‌ماژولی فقط uuid نرم (بدون FK).
- هر جدول دارای `tenant_id` باید RLS فعال و FORCE داشته باشد (runner بررسی می‌کند). از helper `tenantTable()` در SDK استفاده کن.
- هر route باید `@RequirePermission(...)` یا `@Public()` صریح داشته باشد. کنترل دسترسی و entitlement همیشه سمت سرور.
- مبالغ ریال در `numeric`/`bigint`؛ هرگز `number` اعشاری برای پول. انتقال بین حساب‌ها هرگز درآمد/هزینه نیست.
- اسناد تأییدشده تغییرناپذیرند؛ اصلاح با سند اصلاحی/ابطال.
- UI: فقط ویژگی‌های منطقی Tailwind (`ms-`/`me-`/`start-`/`end-`)؛ همه متن‌ها از کلید i18n؛ هر صفحه از `<PageState>` برای حالت‌های بارگذاری/خطا/خالی/بدون دسترسی/آفلاین/در حال انجام استفاده کند؛ عملیات مخرب با `ConfirmDialog`.
- لاگ بدون داده حساس (رمز، توکن، کدملی، حقوق، شماره حساب).
- مهاجرت‌ها SQL خام بازبینی‌شده؛ بدون `CREATE INDEX CONCURRENTLY` در مهاجرت ماژول؛ الگوی expand/contract.
- تست‌های یکپارچه با PostgreSQL واقعی؛ mock دیتابیس ممنوع.
