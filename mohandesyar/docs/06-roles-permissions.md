# ۰۶ — ماتریس نقش‌ها و مجوزها

> وضعیت: پیش‌نویس فاز ۰ — منتظر تأیید

## ۱. مدل

- **مجوز (Permission):** رشته `<module>.<resource>.<action>`؛ مثال `finance.payment.approve`. هسته با `core.` شروع می‌شود.
- **کنش‌های استاندارد:** `view`, `create`, `update`, `delete`, `approve`, `export`؛ کنش‌های خاص در صورت نیاز (`execute`, `request`, `void`, `download`, `manage`).
- **محدوده (Scope):** `company` | `unit` (واحد و زیرواحدها) | `project` (پروژه‌هایی که عضو است) | `own` (رکوردهای خودش). محدوده بزرگ‌تر شامل کوچک‌تر است.
- **شرط (Condition):** `maxAmount` (سقف مالی تأیید)، `maxConfidentiality` (سقف سطح محرمانگی).
- **نقش:** مجموعه‌ای از `(permission, scope, conditions)`؛ تخصیص نقش به عضو در یک شرکت (و اختیاری واحد/پروژه).
- **ارزیابی:** اجتماع همه نقش‌های کاربر در شرکت فعال + grantهای بین‌شرکتی؛ «deny» صریح در این نسخه وجود ندارد (سادگی و قابل‌فهم بودن)، به‌جز قواعد سخت‌کد امنیتی (تفکیک وظایف).
- **قواعد سخت (غیرقابل دور زدن با نقش):**
  - تفکیک وظایف پرداخت: درخواست‌کننده، تأییدکننده و اجراکننده یک پرداخت سه نفر متفاوت‌اند.
  - تأییدکننده هیچ گردش کاری درخواست‌کننده همان مورد نیست (قابل تنظیم فقط به سمت سخت‌تر).
  - مشاهده داده‌های حساس (`sensitive: true` در manifest) ثبت در `core_access_log`.
  - خروجی همیشه با همان فیلتر مجوز مشاهده.

## ۲. نقش‌های سطح پلتفرم

| مجوز / قابلیت | مدیر کل | مدیر فنی | مدیر فروش/اشتراک | پشتیبان |
|---|:-:|:-:|:-:|:-:|
| مشاهده داشبورد و سلامت سیستم | ✓ | ✓ | ✓ (بدون جزئیات فنی) | ✓ |
| نصب/ارتقا/بازگشت/حذف ماژول (۲FA تازه) | — | ✓ | — | — |
| فعال/غیرفعال‌سازی سراسری ماژول | — | ✓ | — | — |
| فعال/غیرفعال‌سازی ماژول برای Tenant | ✓ | ✓ | ✓ | — |
| مدیریت کلیدهای امضای مورد اعتماد (۲FA) | — | ✓ | — | — |
| مدیریت Tenant (ایجاد/تعلیق/فعال‌سازی) | ✓ | — | ✓ | — |
| پلن، تخفیف، فاکتور، ثبت پرداخت | ✓ | — | ✓ | — |
| گزارش رشد و درآمد | ✓ | — | ✓ | — |
| لیدها (دمو/تماس) | ✓ | — | ✓ | ✓ (فقط مشاهده) |
| تیکت پشتیبانی | ✓ | ✓ | ✓ | ✓ |
| درخواست دسترسی پشتیبانی موقت به Tenant | ✓ | ✓ | — | ✓ |
| محتوای لندینگ (FAQ، تماس، پلن‌های عمومی) | ✓ | — | ✓ | — |
| اطلاعیه‌ها | ✓ | ✓ | ✓ | — |
| Audit Log پلتفرم | ✓ | ✓ | — | — |
| مدیریت ادمین‌های پلتفرم | ✓ | — | — | — |

همه ادمین‌های پلتفرم **۲FA اجباری** دارند. «مدیر کل» عمداً مجوز نصب ماژول را ندارد (تفکیک نقش)؛ یک فرد می‌تواند هر دو نقش را داشته باشد. هیچ نقش پلتفرمی بدون دسترسی پشتیبانی موقت داده Tenant را نمی‌بیند (RLS).

## ۳. نقش‌های پیش‌فرض سطح شرکت

نقش‌ها قالب‌اند؛ هر Tenant می‌تواند آن‌ها را ویرایش یا نقش جدید بسازد. هر ماژول هنگام فعال‌شدن مجوزهایش را به این نقش‌ها اضافه می‌کند (از `defaultRoles` در manifest).

نماد: **V** مشاهده، **C** ایجاد، **U** ویرایش، **D** حذف، **A** تأیید، **E** خروجی؛ زیرنویس محدوده: ᶜ شرکت، ᵘ واحد، ᵖ پروژه، ᵒ خود.

| حوزه | مدیر شرکت | مدیرعامل | مدیر پروژه | مدیر مالی | مسئول HR | مدیر فروش | مسئول تدارکات | کارشناس فنی | کارمند | ناظر/حسابرس | فقط‌خواندنی |
|---|---|---|---|---|---|---|---|---|---|---|---|
| core: کاربران، نقش‌ها، تنظیمات، ماژول‌های Tenant | VCUDᶜ | Vᶜ | — | — | Vᶜ | — | — | — | — | Vᶜ | — |
| core: Audit Tenant | Vᶜ | Vᶜ | — | — | — | — | — | — | — | VEᶜ | — |
| projects | VCUDAEᶜ | VAEᶜ | VCUDAEᵖ | VEᶜ | — | Vᶜ | Vᵖ | VCUᵖ | Vᵖ | VEᶜ | Vᶜ |
| crm | VCUDEᶜ | VEᶜ | Vᵖ | Vᶜ | — | VCUDAEᶜ | — | — | — | VEᶜ | Vᶜ |
| contracts | VCUDAEᶜ | VAEᶜ | VCUᵖ | VAEᶜ | — | VCᶜ | VCᶜ | Vᵖ | — | VEᶜ | Vᶜ |
| meetings | VCUDEᶜ | VCEᶜ | VCUDᵖ | VCᵒ | VCᵒ | VCᵒ | VCᵒ | VCᵒ | Vᵒ | VEᶜ | Vᶜ |
| recruitment (حساس) | VCUDAEᶜ | VAEᶜ | Vᵒ (مصاحبه‌گر) | — | VCUDAEᶜ | — | — | Vᵒ (مصاحبه‌گر) | — | — | — |
| hr (حساس؛ حقوق جدا) | VCUDAEᶜ | VAEᶜ | V(مرخصی تیم)Aᵖ | V(حقوق)ᶜ | VCUDAEᶜ | — | — | — | VCᵒ (مرخصی خود) | VEᶜ | — |
| kpi | VCUDAEᶜ | VAEᶜ | VCUᵖ | VCUᶜ | VCUᶜ | VCUᶜ | VCUᶜ | Vᵒ | Vᵒ | VEᶜ | Vᶜ |
| finance (حساس) | VCUDAEᶜ | VAEᶜ (با سقف) | V(بودجه)ᵖ + درخواست پرداختᵖ | VCUAEᶜ (با سقف) + اجرا* | — | — | درخواست پرداختᶜ | — | — | VEᶜ | — |
| procurement | VCUDAEᶜ | VAEᶜ | VC(درخواست)ᵖ Aᵖ | VAᶜ | — | — | VCUDEᶜ | VCᵖ | Cᵒ | VEᶜ | Vᶜ |
| documents | VCUDAEᶜ | VAEᶜ | VCUDAᵖ | VCUᶜ | VCUᶜ | VCUᶜ | VCUᶜ | VCUᵖ | Vᵒ | VEᶜ | Vᶜ |
| qhse | VCUDAEᶜ | VAEᶜ | VCUAᵖ | — | — | — | — | VCᵖ | Cᵒ (گزارش شبه‌حادثه) | VEᶜ | Vᶜ |
| holding | VEᶜ | VE(همه شرکت‌های grant‌شده) | — | VE(مالی) | — | — | — | — | — | VE | — |
| داشبورد مدیرعامل | V | V | — | — | — | — | — | — | — | V | — |

\* **تفکیک وظایف:** «اجرای پرداخت» (`finance.payment.execute`) به‌صورت پیش‌فرض به نقش جدا «مسئول خزانه» داده می‌شود (نقش اضافه)؛ در شرکت‌های کوچک مدیر مالی می‌تواند هر دو را داشته باشد ولی قاعده سخت مانع می‌شود که همان فرد هم تأیید و هم اجرا کند.

### سطح محرمانگی اسناد
`public < internal < confidential < secret`. پیش‌فرض سقف: کارمند/فقط‌خواندنی `internal`، کارشناس/مدیر پروژه `confidential`، مدیر شرکت/مدیرعامل `secret`. دانلود/مشاهده `confidential+` ثبت می‌شود.

## ۴. فهرست مجوزهای هسته (نمونه کامل)

```
core.user.view|create|update|deactivate        core.role.view|manage
core.company.view|manage                       core.company.cross_view
core.company_grant.manage                      core.org_unit.manage
core.module.view|manage_tenant                 core.settings.manage
core.audit.view|export                         core.task.view|create|update|delete
core.file.upload|download                      core.workflow.manage_definitions
core.report.export|schedule                    core.dashboard.manage_defaults
core.import.run                                core.support.ticket|grant_access
core.subscription.view|manage                  core.data.export_tenant
```

مجوزهای پلتفرم با پیشوند `platform.` و در جدول جدا (هرگز به کاربر Tenant قابل اختصاص نیستند).

## ۵. اجرا و تست

- `@RequirePermission('projects.project.update', { scopeFrom: 'project', param: 'id' })` روی handler؛ Guard محدوده را با resolver ماژول (`ScopeResolver` ثبت‌شده در SDK) بررسی می‌کند.
- لینت سفارشی: هر route ماژول باید `@RequirePermission` یا `@Public` صریح داشته باشد (تست معماری که همه routeها را enumerate می‌کند).
- تست ماتریس: برای هر ماژول، جدول بالا به fixture تبدیل و برای هر (نقش × endpoint) نتیجه مورد انتظار بررسی می‌شود.
