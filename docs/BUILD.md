# مستندات ساخت پروژه

## چرا بدون Android Gradle Plugin؟

در محیطی که این پروژه در آن ساخته شد، دسترسی شبکه به `dl.google.com` و مخزن Maven گوگل (`maven.google.com`) مسدود بود. بنابراین:

- Android Gradle Plugin، Jetpack Compose، AndroidX و Android SDK رسمی قابل دریافت نبودند.
- Flutter نیز برای ساخت APK به همین مخزن نیاز دارد.

راه‌حل انتخاب‌شده، که خروجی آن یک APK واقعی و استاندارد است:

| مرحله | ابزار | منبع |
|------|-------|------|
| کلاس‌های فریم‌ورک (android.jar) | `org.robolectric:android-all` نسخه‌های API 35 (کلاس‌ها) و API 34 (جدول منابع) | Maven Central |
| کامپایل منابع و تولید `R.java` | `aapt` (نسخه ۱) | بسته اوبونتو `aapt` |
| کامپایل کد | Kotlin 2.2.21 با `-Xjdk-release=1.8` | Maven Central |
| کوچک‌سازی (فقط نسخه انتشار) | ProGuard 7.7 | Maven Central |
| تبدیل به DEX | `dx` (`dalvik-exchange`) با `--min-sdk-version=26` | بسته اوبونتو |
| تراز و امضا | `zipalign`، `apksigner` (امضای v1+v2+v3) | بسته‌های اوبونتو |
| تست | JUnit 4، Robolectric 4.16 | Maven Central |

همه این مراحل در `app/build.gradle.kts` به‌صورت تسک‌های Gradle تعریف شده‌اند.

> **پیشنهاد برای آینده:** در محیطی با دسترسی کامل به مخزن گوگل، می‌توان همین سورس را بدون تغییر منطق، به پروژه استاندارد AGP منتقل کرد (کد فقط از APIهای عمومی فریم‌ورک استفاده می‌کند). در آن صورت Android Lint رسمی و ساخت AAB نیز در دسترس خواهد بود.

## پیش‌نیازها

- JDK 21
- Gradle 8.14 (یا `gradle wrapper`)
- اوبونتو/دبیان: `sudo apt-get install aapt dalvik-exchange zipalign apksigner`

مسیر ابزارها را در صورت نیاز می‌توان با ویژگی‌های Gradle تغییر داد:
`-Ptool.aapt=... -Ptool.dx=... -Ptool.zipalign=... -Ptool.apksigner=...`

## دستورها

| دستور | کار |
|------|-----|
| `gradle :app:assembleDebug` | APK اشکال‌زدایی ← `app/build/outputs/apk/debug/` (کلید اشکال‌زدایی در `~/.android/panjeh-debug.jks` خودکار ساخته می‌شود) |
| `gradle :app:assembleRelease` | APK انتشار کوچک‌سازی‌شده و امضاشده ← `app/build/outputs/apk/release/` |
| `gradle :app:test` | همه تست‌ها؛ اسکرین‌شات‌ها در `docs/screenshots` و تصاویر فروشگاه در `docs/store` بازتولید می‌شوند |
| `gradle :app:testRelease` | اجرای تست‌ها روی خروجی ProGuard (بررسی درستی کوچک‌سازی) |
| `gradle :app:checkMinSdkApi` | بررسی ارجاع‌ها به APIهای جدیدتر از اندروید ۸٫۰ (جایگزین بخشی از Lint) |

## امضای نسخه انتشار

فایل `keystore.properties` در ریشه پروژه (خارج از گیت):

```properties
storeFile=release-signing/panjeh-release.jks
storePassword=...
keyAlias=panjeh
keyPassword=...
```

- فایل کلید (`*.jks`) و `keystore.properties` در `.gitignore` هستند و هرگز وارد مخزن نمی‌شوند.
- **از کلید انتشار حداقل دو نسخه پشتیبان در جای امن نگه دارید.** بدون همین کلید، انتشار به‌روزرسانی برای کاربران فعلی در مایکت ممکن نیست.
- برای ساخت کلید جدید:
  ```bash
  keytool -genkeypair -keystore release-signing/panjeh-release.jks -storetype PKCS12 \
    -alias panjeh -keyalg RSA -keysize 4096 -validity 10950 -dname "CN=Panjeh,O=Panjeh,C=IR"
  ```

## تغییر نام، شناسه و نسخه

| مورد | محل تنظیم |
|------|-----------|
| نام برنامه (لانچر و داخل برنامه) | `app/src/main/res/values/app_config.xml` ← `app_name` |
| شناسه بسته | `gradle.properties` ← `app.id` (پس از انتشار عمومی تغییر ندهید) |
| شماره نسخه / شماره ساخت | `gradle.properties` ← `app.versionName` / `app.versionCode` (برای هر انتشار افزایش دهید) |
| حداقل/هدف SDK | `gradle.properties` ← `app.minSdk` / `app.targetSdk` |

فضای نام کد (`ir.panjeh.petcare`) از شناسه بسته جداست؛ تغییر شناسه نیازی به تغییر کد ندارد.

## ساختار سورس

```
app/src/main/
  AndroidManifest.xml
  kotlin/ir/panjeh/petcare/
    core/          تقویم شمسی، قالب‌بندی فارسی، اجرای پس‌زمینه
    data/          مدل‌ها، SQLite، مخزن داده، تنظیمات، فایل‌ها، نسخه پشتیبان
    reminders/     موتور تکرار، برنامه روزانه، زمان‌بندی هشدار، اعلان، گیرنده‌ها
    ui/theme/      توکن‌های طراحی (رنگ، فاصله، تایپوگرافی)
    ui/components/ کامپوننت‌های قابل استفاده مجدد
    ui/nav/        ناوبری سبک مبتنی بر مسیر
    ui/screens/    صفحه‌ها
  res/             آیکون‌ها (برداری)، فونت وزیرمتن، تم‌ها
app/src/test/      تست‌ها و جایگزین حداقلی androidx.test برای Robolectric
tools/gen_icons.py تولید آیکون‌های خطی
```

## محدودیت‌های شناخته‌شده زنجیره ساخت

- `aapt` نسخه ۱ جدول منابع API 35 را نمی‌خواند؛ منابع با جدول API 34 لینک می‌شوند (فقط ویژگی‌های XML جدید API 35 در دسترس نیستند؛ برنامه از آن‌ها استفاده نمی‌کند).
- Android Lint رسمی اجرا نشده است؛ تسک `checkMinSdkApi` ارجاع‌های جدیدتر از API 26 را پیدا می‌کند، ولی فهرست مجاز آن بر اساس **نام** API است و وجود شرط نسخه را خودش اثبات نمی‌کند (شرط‌ها دستی بازبینی شده‌اند).
- خروجی AAB ساخته نمی‌شود (`bundletool` و AGP در دسترس نبودند).
