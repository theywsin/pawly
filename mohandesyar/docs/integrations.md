# اتصال سامانه‌های دیگر: REST API و Webhook

## کلید API
- ساخت: «تنظیمات ← اتصال‌ها (API)» با مجوز `core.integration.manage`. کلید فقط یک بار نمایش داده می‌شود (`mk_<prefix>_<secret>`) و فقط SHA-256 آن ذخیره می‌شود.
- کلید **به‌جای سازنده‌اش** و فقط در **شرکتی که در آن ساخته شده** عمل می‌کند. مجوز مؤثر = اشتراک «مجوزهای انتخاب‌شده برای کلید» و «مجوزهایی که سازنده همین حالا دارد» (با همان محدوده company/project/own). اگر سازنده نقشش را از دست بدهد یا عضویتش غیرفعال شود، کلید هم کار نمی‌کند.
- فقط روی APIهای ماژول‌ها (`/api/m/<module>/v1/...`) معتبر است؛ مسیرهای مدیریتی هسته (کاربران، نقش‌ها، کلیدها، webhookها) با کلید ممکن نیست (`API_KEY_SCOPE`).
- سقف ۶۰۰ درخواست در دقیقه برای هر کلید (`429 RATE_LIMITED`)؛ ابطال فوری؛ انقضای اختیاری؛ ثبت آخرین استفاده؛ ساخت و ابطال در Audit.

```bash
curl -H "Authorization: Bearer mk_xxxxxxxxxx_…" https://<host>/api/m/qhse/v1/incidents
```

## Webhook
- برای رویدادهای منتشرشده ماژول‌های فعال (مثل `qhse.incident.reported`، `procurement.order.approved`، `finance.payment.executed`)؛ فقط رویدادهای **همان شرکت**.
- بدنه: `{"id","type","version","occurredAt","companyId","data"}` با `POST` و `Content-Type: application/json`.
- سرآیندها: `X-Mohandix-Event`، `X-Mohandix-Delivery`، `X-Mohandix-Signature: t=<unix>,v1=<hex>` که `v1 = HMAC-SHA256(secret, "<t>.<body>")`. گیرنده باید امضا را بررسی و پیام‌های با `t` قدیمی را رد کند.
- پاسخ 2xx = موفق؛ در غیر این صورت تا ۶ تلاش با فاصله فزاینده (۳۰ ثانیه × ۲ⁿ)؛ هر رویداد برای هر webhook حداکثر یک بار در صف قرار می‌گیرد (idempotent با `event_id`)، گیرنده با `X-Mohandix-Delivery`/`id` تکراری‌ها را تشخیص دهد.
- فقط `https` و نشانی‌هایی که به شبکه داخلی (loopback، خصوصی، link-local) اشاره نکنند؛ این کنترل هنگام ساخت و پیش از هر ارسال انجام می‌شود (`WEBHOOK_ALLOW_PRIVATE=true` فقط برای توسعه).
- دکمه «آزمایش» رویداد `core.ping` می‌فرستد؛ «سابقه» وضعیت ۱۰۰ ارسال آخر را نشان می‌دهد.

```js
// Node: verifying a delivery
const [t, v1] = req.headers['x-mohandix-signature'].split(',').map((p) => p.split('=')[1]);
const ok = crypto.timingSafeEqual(Buffer.from(v1, 'hex'), crypto.createHmac('sha256', SECRET).update(`${t}.${rawBody}`).digest());
```
