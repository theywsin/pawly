# مهندیکس — راهنمای عامل کدنویس

> این فایل با `AGENTS.md` **محتوای یکسان** دارد. هر تغییر در یکی باید در دیگری هم اعمال شود (`cp CLAUDE.md AGENTS.md`).

## وضعیت پروژه

- فاز ۰ تا ۳ تأیید شدند. **فاز ۴ (خروجی Excel/CSV/PDF، تقویم کاری، ایمیل SMTP، ماژول‌های استخدام، پرونده کارکنان و KPI) تکمیل‌شده، منتظر تأیید برای شروع فاز ۵.**
- گزارش‌ها: [`docs/phase-1-report.md`](docs/phase-1-report.md)، [`docs/phase-2-report.md`](docs/phase-2-report.md)، [`docs/phase-3-report.md`](docs/phase-3-report.md)، [`docs/phase-4-report.md`](docs/phase-4-report.md). ماژول‌های کسب‌وکار در `modules/{contracts,projects,crm,meetings,recruitment,hr,kpi}` با مستند در `docs/README.md` هرکدام. اسناد طراحی: [`docs/README.md`](docs/README.md). فرض‌ها: `docs/assumptions.md`.
- راهنمای نوشتن ماژول: [`modules/hello-module/docs/README.md`](modules/hello-module/docs/README.md).

## خلاصه معماری

پلتفرم SaaS چندمستاجری و ماژولار برای شرکت‌های مهندسی/عمرانی ایران. هسته حداقلی (احراز هویت، Tenant/Company، RBAC، Module Registry/Loader، Entitlement، Workflow، اعلان، فایل، Audit، Event Bus، گزارش، Widget Registry، تنظیمات، پشتیبانی، جست‌وجو) و همه قابلیت‌های کسب‌وکار به‌صورت **ماژول‌های بسته‌بندی‌شده و امضاشده** که از پنل ادمین نصب، فعال، غیرفعال، ارتقا و حذف می‌شوند. جزئیات: `docs/02-architecture.md` و `docs/03-module-system.md`.

## تصمیم‌های قطعی

| موضوع | تصمیم |
|---|---|
| مخزن | Monorepo: pnpm workspaces + Turborepo؛ lockfile قفل |
| فرانت | SPA: Vite + React + TypeScript؛ React Router (data router)؛ TanStack Query؛ Zustand فقط برای وضعیت UI؛ React Hook Form + Zod؛ Tailwind (RTL، فقط ویژگی‌های منطقی) + Radix |
| لندینگ | همان SPA، prerender ایستا در build با اسکریپت داخلی (`renderToString` + StaticRouter، `apps/web/scripts/prerender.mjs`)؛ داده API در مرورگر؛ فایل‌های ایستا پیش‌فشرده (br/gzip)؛ بقیه SPA خالص |
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

## دستورها

```bash
pnpm install --frozen-lockfile
pnpm services:up                      # PostgreSQL :54329، Redis :63799، S3 (moto) :39000 — محلی
# ساخت کتابخانه‌ها (پیش‌نیاز typecheck/test بسته‌های وابسته)
pnpm --filter @mohandesyar/module-sdk build && pnpm --filter @mohandesyar/persian build \
  && pnpm --filter @mohandesyar/module-package build && pnpm --filter @mohandesyar/module-cli build
pnpm lint                             # eslint + dependency-cruiser (مرز ماژول‌ها)
pnpm -r --if-present typecheck
pnpm -r --if-present test:unit
pnpm --filter @mohandesyar/api test:integration   # PostgreSQL/Redis/S3 واقعی؛ هر فایل دیتابیس تازه می‌سازد
pnpm --filter @mohandesyar/web build && pnpm --filter @mohandesyar/api build
PW_CHROMIUM=/opt/pw-browsers/chromium pnpm test:e2e   # Playwright روی کلاستر واقعی (e2e/start-server.sh)؛ شامل axe روشن/تیره
PW_CHROMIUM=/opt/pw-browsers/chromium pnpm test:lighthouse <baseUrl>   # صفحات عمومی موبایل/دسکتاپ؛ زیر ۹۰ = شکست

# اجرای سرور (env نمونه: infra/compose/.env.example)
node apps/api/dist/main.js migrate            # مهاجرت هسته + کلیدهای مورد اعتماد + بسته‌های پیش‌نصب
ADMIN_PASSWORD=... node apps/api/dist/main.js create-admin --email a@b --name 'نام'
node apps/api/dist/main.js serve              # primary + workers؛ SPA از WEB_DIST_DIR

# ماژول‌ها
pnpm module:keygen --out <dir> | pnpm module:pack <moduleDir> --out <dir>
pnpm module:sign <pkg> --key <private.pem> | pnpm module:verify <pkg> --pub <public.pem>
```

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
- policyهای RLS با `core_current_tenant()` / `core_current_companies()` (نه cast خام `current_setting`).
- بسته بک‌اند ماژول با `require(esm)` بارگذاری می‌شود: top-level await ممنوع؛ تزریق Nest فقط با `@Inject(Token)` صریح (بدون emitDecoratorMetadata).
- سرویس‌های هسته کلاس‌های ساده در `apps/api/src/app/services.ts` هستند و با `@Inject(Services)` به کنترلرها می‌رسند.
- مقادیر timestamp از Drizzle/pg به‌صورت رشته برمی‌گردند؛ قبل از مقایسه `new Date(...)` کنید.
- تست‌های یکپارچه با PostgreSQL واقعی؛ mock دیتابیس ممنوع.
- صفحات عمومی: هر صفحه دقیقاً یک `h1` (`<Section page>`)؛ متن بازاریابی فقط در `areas/public/catalog.ts` و بدون آمار/مشتری/نظر ساختگی؛ ادعای امنیتی فقط برای رفتار تست‌شده؛ مسیر عمومی جدید باید به `PRERENDER` در `routes.tsx` اضافه شود.
- `zod` در وب با `jitless` پیکربندی شده (CSP بدون eval)؛ `src/zod-config.ts` باید اولین import در `main.tsx` بماند.
- ماژول‌های کسب‌وکار: منطق در `backend/src/logic.ts` با SQL خام (`sql` از drizzle) و تاریخ‌ها به‌صورت `::text`؛ ورودی‌ها در `inputs.ts` (Zod، پیام فارسی)؛ محدوده own/project در خود کوئری؛ اتصال به ماژول دیگر فقط از `ctx.services.get(...)` و lookup سمت بک‌اند (فرانت ماژول هرگز API ماژول دیگر را صدا نمی‌زند).
- تاریخ بدون زمان: `date` و ISO؛ در UI `DateInput`/`DayText`؛ ساعت: `zonedToUtc`/`utcToZoned` از `@mohandesyar/persian`؛ مبلغ: `MoneyInput`/`Money` و `bigint` در محاسبات.
- تست یکپارچه ماژول: `buildModule(id, key)` و `t.installModules(...)`؛ کارهای زمان‌بندی با `t.services.scheduler.tick(now)`.
- IP کاربر از `X-Forwarded-For` فقط برای peerهای `TRUST_PROXY` خوانده می‌شود.
- خروجی جدول‌ها با `ExportMenu` از `@mohandesyar/ui` (Excel/CSV در مرورگر از داده‌ای که کاربر مجاز دیده؛ PDF با چاپ مرورگر و قواعد `@media print`).
- روز کاری: `ctx.workCalendar()` + `isWorkingDay`/`workingDaysBetween` از `@mohandesyar/persian` (جمعه و تعطیلات رسمی ثابت خودکار؛ تعطیلات قمری را سازمان در «تقویم کاری» وارد می‌کند).
- فایل متعلق به ماژول: فرانت با `host.upload(file, { module })` بارگذاری، بک‌اند با `ctx.files.claim/url/remove`؛ مسیر عمومی دانلود هسته این فایل‌ها را نمی‌دهد.
- اعلان‌ها خودکار ایمیل هم می‌شوند (صف `core_email_queue` در همان تراکنش؛ `SMTP_URL`)؛ ماژول فقط `ctx.notify` را صدا می‌زند.
- گردش تأیید: `ctx.ensureWorkflow` در `seedTenant`، `ctx.startWorkflow`/`ctx.cancelWorkflow`، نتیجه از رویداد `core.workflow.completed`.
- شاخص‌ها: Providerهای اعلام‌شده در manifest از `ctx.kpi.providers()/evaluate()` در دسترس‌اند؛ فرمول KPI فقط با پارسر `modules/kpi/backend/src/formula.ts` (هرگز eval).
- داده شخصی (رزومه، پرونده، حقوق): مشاهده و دانلود در Audit ثبت شود؛ فیلد سن/جنسیت/قومیت/مذهب/سلامت در مدل داده نباشد؛ هیچ انتقال یا پرداخت خودکار.
