# راهنمای توسعه ماژول — با مثال hello-module

این ماژول عمداً ساده است و فقط برای نشان‌دادن **همه نقاط اتصال** یک ماژول به هسته ساخته شده است: جدول با RLS، مجوز، منو، صفحه، ویجت داشبورد، تنظیمات، انتشار و مصرف رویداد، جست‌وجو، KPI، سرویس عمومی و نقش پیش‌فرض. هیچ داده نمونه‌ای ایجاد نمی‌کند.

## ۱. ساختار

```
modules/hello-module/
├─ module.manifest.json        # قرارداد ماژول (docs/03 §2) — با @mohandesyar/module-sdk اعتبارسنجی می‌شود
├─ backend/src/index.ts        # defineModule({...}) — کنترلرها، Providerها، رویدادها
├─ backend/src/notes.ts        # منطق کسب‌وکار (مستقل از HTTP)
├─ backend/src/notes.controller.ts
├─ backend/src/schema.ts       # اسکیمای Drizzle (منبع حقیقت: SQL مهاجرت)
├─ frontend/src/index.tsx      # export های نام‌برده در manifest: routes، NotesCountWidget
├─ migrations/0001_notes.sql   # SQL خام، اجراشده در تراکنش نصب
├─ fixtures/                   # نسخه‌های آزمایشی برای تست‌های چرخه عمر (در بسته قرار نمی‌گیرد)
├─ tests/                      # تست واحد
└─ docs/README.md              # همین سند (در بسته قرار می‌گیرد)
```

## ۲. قواعدی که نصب‌کننده اجبار می‌کند

| قاعده | پیامد تخطی |
|---|---|
| همه کلیدها (مجوز، ویجت، رویداد منتشرشده، Provider، سرویس) با `<id>.` شروع شوند | رد manifest |
| `tablePrefix` = شناسه با `_` به‌جای `-` و `_` پایانی (`hello_module_`) | رد manifest |
| مهاجرت فقط جداول/توابع/انواع با همین پیشوند را لمس کند؛ `CREATE INDEX CONCURRENTLY`، `GRANT`، `SET ROLE`، `DO`، `COPY`، `CREATE EXTENSION`، `SECURITY DEFINER` و … ممنوع | رد در `module:pack` و دوباره در سرور |
| هر جدول دارای `tenant_id` باید RLS **فعال و FORCE** و policy داشته باشد | rollback کامل نصب |
| policyها از `core_current_tenant()` و `core_current_companies()` استفاده کنند (نه `current_setting` خام) | — (توصیه؛ cast خام روی اتصال‌های pool شده خطا می‌دهد) |
| هر route بک‌اند `@RequirePermission(...)` داشته باشد | 403 برای همه درخواست‌ها |
| بک‌اند فقط وابستگی‌های مشترک (`@nestjs/common`، `drizzle-orm`، `zod`، `@mohandesyar/module-sdk`، …) را external بگذارد؛ بقیه bundle می‌شوند | خطای بارگذاری (hook حل‌کننده import را رد می‌کند) |
| بدون top-level await در بک‌اند (بارگذاری با `require(esm)`) | خطای بارگذاری آزمایشی → نصب رد می‌شود |
| تزریق وابستگی Nest فقط با `@Inject(Token)` صریح (esbuild متادیتای decorator تولید نمی‌کند) | وابستگی undefined |

## ۳. بک‌اند

```ts
@Controller('notes')                              // → /api/m/hello-module/v1/notes
export class NotesController {
  @Get()
  @RequirePermission('hello-module.note.view', 'own')
  list(@Ctx() ctx: ModuleRequestContext) {
    return ctx.db.transaction((tx) => tx.select().from(notes)...);   // RLS: فقط Tenant/شرکت جاری
  }
}
```

`ModuleRequestContext` تنها راه دسترسی به هسته است: `db.transaction`، `publish` (رویداد در همان تراکنش، از طریق outbox)، `audit`، `notify`، `settings`، `services.get(name, range)` (سرویس عمومی ماژول دیگر یا `undefined`)، `modules.isActive(id)`، `can(permission, scope)` و `startWorkflow(...)`.

**ورود داده از Excel:** قالب را در `manifest.importTemplates` (کلید، عنوان، `permission` و ستون‌ها با `key`/`header`/`type`/`required`) اعلام کنید و در `defineModule` یک `importers: { '<key>': (ctx, rows, { dryRun }) => … }` بدهید. کلید ستون‌ها را هم‌نام فیلدهای اسکیمای Zod ورودی بگذارید تا خطاها به ستون درست برسند؛ در `dryRun` هیچ چیز ننویسید و در اجرای واقعی همه ردیف‌ها را در یک تراکنش بنویسید و دوباره اعتبارسنجی کنید. نمونه‌ها: `modules/{projects,crm,finance,procurement,hr}/backend/src/import.ts`.

## ۴. فرانت‌اند

بسته فرانت ESM است و React، روتر، TanStack Query، `@mohandesyar/ui` و `@mohandesyar/module-sdk/web` را از import map میزبان می‌گیرد (یک نمونه React مشترک). کلاس‌های Tailwind استفاده‌شده هنگام `module:pack` به `frontend/module.css` تبدیل می‌شوند (فقط utility؛ توکن‌های رنگ از میزبان). در manifest باید `"styles": ["frontend/module.css"]` باشد.

```tsx
export const routes: RouteObject[] = [{ index: true, element: <NotesPage /> }];   // زیر /app/hello
export function NotesCountWidget({ moduleId, widgetKey }: WidgetProps) { ... useWidgetData(...) }
```

## ۵. بسته‌بندی، امضا و نصب

```bash
pnpm module:keygen --out ~/keys                         # یک بار؛ کلید خصوصی را خارج از سرور نگه دارید
pnpm module:pack modules/hello-module --out dist/pkgs   # build + lint مهاجرت + CHECKSUMS
pnpm module:sign dist/pkgs/hello-module-1.0.0.mypkg --key ~/keys/module-signing-<id>.key.pem
pnpm module:verify dist/pkgs/hello-module-1.0.0.mypkg --pub ~/keys/module-signing-<id>.pub.pem
```

سپس در پنل مدیریت: **کلیدهای امضا** ← افزودن کلید عمومی (یک بار)، و **ماژول‌ها ← نصب ماژول جدید** ← بارگذاری ← بررسی ← تأیید با کد دومرحله‌ای ← نتیجه. پس از نصب، سرویس‌ها به‌صورت چرخشی راه‌اندازی مجدد می‌شوند و ماژول در «وضعیت سامانه» برای هر نمونه «بارگذاری شد» نشان داده می‌شود. سپس ماژول را برای سازمان‌ها فعال کنید.

## ۶. ارتقا و بازگشت

- مهاجرت‌های نسخه جدید باید **افزایشی (expand)** باشند تا بازگشت به نسخه قبل بدون تغییر schema ممکن باشد (مثال: `fixtures/v1.1.0`).
- تغییر تخریبی را در فایلی با نام شامل `.contract.` قرار دهید و فایل `<name>.down.sql` کنارش بگذارید؛ بدون فایل down، بازگشت آن نسخه ممکن نیست.
- مهاجرتی را که قبلاً اجرا شده تغییر ندهید؛ نصب‌کننده checksum را مقایسه و ارتقا را رد می‌کند.

## ۷. تست

- `tests/` — تست واحد (manifest، lint مهاجرت، اعتبارسنجی ورودی).
- `apps/api/test/integration/module-lifecycle.test.ts` — نصب/فعال/غیرفعال/ارتقا/بازگشت/حذف این ماژول روی PostgreSQL واقعی.
- `e2e/phase1.spec.ts` — همان مسیر از طریق پنل و رابط کاربری.
