# ۱۰ — برنامه تست و استقرار

> وضعیت: پیش‌نویس فاز ۰ — منتظر تأیید

## ۱. هرم تست

| لایه | ابزار | محیط | دامنه |
|---|---|---|---|
| واحد | Vitest | Node، بدون I/O | منطق خالص: EAC، جریان نقدی، مسیر بحرانی، امتیازدهی رزومه، فرمول KPI، تاریخ شمسی، نرمال‌سازی فارسی، اعتبارسنجی manifest، تأیید امضا، محاسبه entitlement |
| یکپارچه (API) | Vitest + Supertest/`app.inject` (Fastify) | **PostgreSQL، Redis و MinIO واقعی** در Docker (Testcontainers یا compose تست) | Guardها، RLS، مهاجرت، چرخه عمر ماژول، گردش کار، outbox، فایل |
| کامپوننت | Vitest + Testing Library (jsdom) | | فرم‌ها، DataTable، PageState، DatePicker |
| سرتاسری | Playwright (Chromium پیش‌نصب) | استک کامل compose | جریان‌های کلیدی، RTL، axe |
| معماری | dependency-cruiser + تست‌های سفارشی | | مرز ماژول‌ها، `@RequirePermission` روی همه routeها، RLS روی همه جداول |
| کارایی | k6 | استقرار مرجع | NFR-PERF |
| لندینگ | Lighthouse CI (محلی، بدون سرویس خارجی) | build prerender | ≥ ۹۰ |

**محیط محلی/CI (فاز ۱):** `pnpm services:up` — PostgreSQL 16 و Redis بومی (یا Docker) و برای S3 سرور `moto` (سازگار با S3) در venv؛ ایمیج‌های MinIO در Docker Hub این محیط در دسترس نبود و Garage در kernel این sandbox کرش می‌کرد. در استقرار هر سرویس S3-سازگار با متغیرهای `S3_*` قابل استفاده است.

**قاعده:** هیچ mock برای دیتابیس در تست‌های یکپارچه (RLS و تراکنش فقط با PostgreSQL واقعی معنا دارند). هر تست یکپارچه در تراکنش/schema جدا یا با truncate بین تست‌ها اجرا می‌شود.

## ۲. تست‌های اجباری سراسری (از بخش ۱۳ پرامپت) و نگاشت

| # | تست | لایه | فاز |
|---|---|---|---|
| T1 | جداسازی Tenantها (API + SQL مستقیم + فایل + کش + جست‌وجو + خروجی) | یکپارچه + E2E | ۱ |
| T2 | دسترسی غیرمجاز (ماتریس نقش × endpoint) | یکپارچه | ۱ به بعد، هر ماژول |
| T3 | چرخه عمر ماژول: نصب/فعال/غیرفعال/ارتقا/rollback/حذف | یکپارچه + E2E (از کنسول) | ۱ |
| T4 | حفظ داده پس از غیرفعال و فعال‌سازی مجدد | یکپارچه + E2E | ۱ |
| T5 | رد بسته امضاناشده/کلید ناشناس/دستکاری‌شده/zip-slip/zip-bomb | یکپارچه | ۱ |
| T6 | شکست مهاجرت → rollback کامل (بدون جدول/ردیف/فایل باقیمانده) | یکپارچه | ۱ |
| T7 | محدودیت‌های اشتراک (read-only، سقف کاربر/فضا، ماژول خریداری‌نشده) | یکپارچه | ۱–۲ |
| T8 | محاسبات مالی: EAC (همه فرمول‌ها)، جریان نقدی قطعی/تخمینی، **انتقال بین حساب‌ها در درآمد/هزینه شمرده نشود** | واحد + یکپارچه | ۵ |
| T9 | گردش تأیید و تفکیک وظایف پرداخت (سه کاربر، سقف) | یکپارچه + E2E | ۵ |
| T10 | صحت گزارش‌ها (مقادیر شناخته‌شده روی fixture، مطابقت با مجوز) | یکپارچه | ۳ به بعد |
| T11 | پشتیبان‌گیری و بازیابی (restore در دیتابیس تازه + مقایسه checksum ردیف‌ها) | اسکریپت CI زمان‌بندی‌شده | ۱ (پایه)، ۶ (کامل) |
| T12 | مهاجرت دیتابیس (اعمال از صفر، اعمال روی نسخه قبل با داده، لینت مهاجرت) | یکپارچه | ۱ |
| T13 | لینت مرزهای ماژول | معماری | ۱ |

**شرط پایان فاز ۱** (از پرامپت) = T1، T3، T4، T5، T6 به‌صورت تست خودکار سبز که خروجی اجرای آن در گزارش فاز ضمیمه می‌شود.

## ۳. CI

پرامپت سرویس CI مشخصی تعیین نکرده است. پیشنهاد: GitHub Actions (چون مخزن روی GitHub است) با گام‌ها:
`pnpm install --frozen-lockfile` → `turbo lint typecheck` → `turbo test:unit` → سرویس‌های Postgres/Redis/MinIO → `turbo test:integration` → build → `module:pack` + `verify` برای همه ماژول‌ها → Playwright → Lighthouse (لندینگ).
همان دستورها به‌صورت محلی با `pnpm ci:local` اجرا می‌شوند (برای مشتری خودمیزبان یا CI داخلی مثل GitLab/Gitea).

## ۴. استقرار

### Docker Compose (مرجع)
سرویس‌ها: `proxy` (Caddy — TLS با گواهی محلی/دستی؛ ACME خاموش پیش‌فرض چون خارجی است)، `web` (فایل ایستا از همان Caddy)، `api` (×n)، `worker`، `migrate` (job یک‌باره در هر استقرار: مهاجرت هسته + bootstrap ماژول‌های پیش‌نصب)، `postgres` (16+)، `redis` (با AOF)، `minio`، `clamav` (پروفایل اختیاری)، `backup` (cron داخلی).
- volumeها: `pgdata`، `redisdata`، `miniodata`، `modules-store` (مشترک api/worker، فقط worker نوشتنی)، `backups`.
- همه imageها با digest پین می‌شوند؛ اسکریپت `infra/scripts/export-images.sh` برای انتقال آفلاین (`docker save`) به سرور بدون اینترنت.
- اسرار از فایل `.env` با مجوز ۶۰۰ یا Docker secrets؛ کلید رمزنگاری فیلدهای حساس (`APP_ENCRYPTION_KEY`) و کلید عمومی امضای ماژول.
- شبکه `internal: true` برای سرویس‌های داخلی؛ فقط proxy پورت بیرونی دارد.

### Kubernetes (آینده)
Helm chart یا manifest ساده؛ api به‌صورت Deployment با readiness probe (`/health/ready` که در حالت draining false می‌شود)؛ worker Deployment جدا؛ `modules-store` به‌صورت PVC `ReadWriteMany` یا (بهتر) دریافت بسته‌ها از MinIO در init container — تصمیم در فاز ۶.

### پشتیبان‌گیری و بازیابی
- `pg_dump -Fc` روزانه (RPO ۲۴h) + اختیاری WAL archiving با `pgBackRest`/`wal-g` به MinIO دوم یا دیسک جدا.
- MinIO: mirror روزانه (`mc mirror`) به مقصد دوم.
- Module Store: از MinIO قابل بازسازی (بسته‌ها آنجا هم ذخیره می‌شوند).
- **آزمون بازیابی خودکار هفتگی:** کانتینر `restore-test` آخرین پشتیبان را در PostgreSQL موقت بازیابی، مهاجرت‌ها را بررسی، شمارش ردیف جداول کلیدی را با متادیتای پشتیبان مقایسه و نتیجه را در `/console/system` ثبت می‌کند.
- Runbook بازیابی کامل در `docs/runbooks/restore.md` (هدف RTO ۴h) — فاز ۱.

### مشاهده‌پذیری
- لاگ JSON با pino (ماسک خودکار فیلدهای حساس: رمز، توکن، کدملی، شماره حساب، حقوق).
- `/health/live`، `/health/ready` (DB، Redis، MinIO، وضعیت بارگذاری ماژول‌ها).
- متریک Prometheus (`/metrics` روی پورت داخلی) — اختیاری؛ داشبورد پایه در کنسول از داده داخلی (صف‌ها، خطاها).
- شناسه همبستگی درخواست (`x-request-id`) در پاسخ خطا برای پشتیبانی.

## ۵. محیط‌ها
`dev` (compose + Vite dev server) · `test` (CI) · `staging` (اختیاری) · `prod`. فقط از طریق متغیر محیطی متفاوت‌اند؛ build یکسان.
