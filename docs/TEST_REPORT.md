# گزارش تست قابلیت‌های اصلی

تاریخ اجرا: ۲۲ مهر ۱۴۰۵ — نسخه ۱٫۰٫۰ (ساخت ۱)

## روش تست و محدودیت‌ها

| روش | وضعیت |
|-----|-------|
| تست واحد روی JVM (منطق تقویم، قالب‌بندی، تکرار یادآور، رمزنگاری) | ✅ اجرا شد |
| تست یکپارچه با **Robolectric 4.16** (اجرای واقعی کد فریم‌ورک اندروید ۱۴ روی JVM: SQLite، AlarmManager، NotificationManager، BroadcastReceiver، Activity) | ✅ اجرا شد |
| تست مسیرهای رابط کاربری با Robolectric (لمس دکمه‌ها، پر کردن فرم، ناوبری، بازسازی Activity) | ✅ اجرا شد |
| رندر واقعی صفحه‌ها با موتور گرافیک بومی Robolectric و ذخیره اسکرین‌شات | ✅ اجرا شد (۲۵ تصویر) |
| اجرای همه تست‌ها روی **خروجی ProGuard نسخه انتشار** (`testRelease`) | ✅ اجرا شد |
| بررسی ارجاع به APIهای جدیدتر از اندروید ۸٫۰ (`checkMinSdkApi`) | ✅ اجرا شد |
| صحت ساختار APK، DEX و امضا (`apksigner verify`، `aapt dump`، `dexdump`) | ✅ اجرا شد |
| **نصب و اجرا روی گوشی واقعی یا شبیه‌ساز** | ❌ **انجام نشد** — تصویر سیستم شبیه‌ساز از `dl.google.com` قابل دریافت نبود |
| Android Lint رسمی | ❌ در دسترس نبود (جایگزین جزئی: `checkMinSdkApi`) |

> ⚠️ Robolectric رفتار اندروید را با دقت بالا شبیه‌سازی می‌کند، اما جایگزین آزمایش روی دستگاه واقعی نیست. موارد وابسته به سخت‌افزار و سازنده گوشی (تحویل واقعی اعلان در حالت Doze، محدودیت باتری سازندگان، برنامه دوربین، انتخابگر فایل، کیبورد واقعی) باید طبق چک‌لیست انتهای این سند دستی آزموده شوند.

## نتیجه اجرای خودکار

```
gradle :app:test         → 46 تست، 46 موفق، 0 ناموفق
gradle :app:testRelease  → 39 تست روی خروجی ProGuard، 39 موفق
gradle :app:checkMinSdkApi → 21 ارجاع به API بالاتر از ۲۶، همه پشت شرط بررسی نسخه
```

## سناریوهای ضروری و پوشش آن‌ها

| سناریو | تست | نتیجه |
|--------|-----|-------|
| اجرای اولیه برنامه | `UiFlowTest.firstRunOnboardingAddPetAndRecordWeight`، `ScreenshotTest.onboardingScreens` | ✅ |
| افزودن حیوان (فرم مرحله‌ای + اعتبارسنجی) | `UiFlowTest.firstRunOnboardingAddPetAndRecordWeight` | ✅ |
| ویرایش حیوان | `RepositoryTest.petCrudAndPersistenceAcrossReopen` + رندر فرم ویرایش در `allScreensRender…` | ✅ |
| حذف حیوان با تأیید (دو مرحله پنجره) | `UiFlowTest.deletePetRequiresConfirmation` | ✅ |
| جدا ماندن داده‌های هر حیوان و حذف آبشاری | `RepositoryTest.petsAreIsolatedAndDeleteCascades` | ✅ |
| جلوگیری از ثبت داده ناقص | `RepositoryTest.rejectsIncompleteData` + خطای فارسی در `UiFlowTest` | ✅ |
| ثبت واکسن / نوبت بعدی / یادآور واکسن | `ReminderSystemTest.syncSchedules…`، `OccurrencesTest.vaccineAlarm…` | ✅ |
| ثبت دارو و نوبت‌های مصرف | `OccurrencesTest.medicationDoses`، `ReminderSystemTest` | ✅ |
| علامت‌گذاری «مصرف شد/انجام شد» از داشبورد | `UiFlowTest.markAgendaItemDoneFromDashboard` | ✅ |
| تعریف یادآور تکرارشونده (روزانه، هر N روز، هفتگی، ماهانه/سالانه شمسی، پایان) | `OccurrencesTest` (۷ تست) | ✅ |
| زمان‌بندی هشدار، لغو هشدار حذف‌شده، خاموشی اعلان | `ReminderSystemTest.syncSchedulesOneAlarmPerSourceAndCancelsStale` | ✅ |
| دریافت اعلان (متن فارسی + دکمه «مصرف شد» در اعلان) | `ReminderSystemTest.firingPostsPersianNotificationAndDoneActionLogs` | ✅ (شبیه‌سازی‌شده) |
| مجوز اعلان رد شده ← نمایش داخل برنامه | `ReminderSystemTest.noNotificationWithoutPermissionButAgendaStillWorks` | ✅ |
| هشدار دقیق رد شده ← زمان‌بندی تقریبی | `ReminderSystemTest.fallsBackToInexactWhenExactDenied` | ✅ |
| راه‌اندازی مجدد گوشی ← بازیابی زمان‌بندی | `ReminderSystemTest.bootCompletedReschedules` | ✅ |
| ثبت وزن (واحد، اعتبارسنجی ورودی فارسی/لاتین) | `UiFlowTest`، `FaTest.parses…` | ✅ |
| ثبت مراجعه دامپزشکی و جست‌وجو در سوابق | `RepositoryTest.visitSearch` | ✅ |
| افزودن تصویر/سند | ذخیره و خواندن فایل در `RepositoryTest.backupRoundTrip…` | ⚠️ انتخابگر گالری/دوربین سیستم فقط روی دستگاه قابل آزمون است |
| بستن و اجرای مجدد برنامه / ماندگاری داده | `RepositoryTest.petCrudAndPersistenceAcrossReopen` | ✅ |
| بازسازی Activity و حفظ پشته صفحات | `UiFlowTest.backNavigationAndStateRestore` | ✅ |
| دکمه بازگشت | `UiFlowTest.backNavigationAndStateRestore` | ✅ |
| رابط راست‌چین | بررسی `layoutDirection == RTL` در `UiFlowTest` + اسکرین‌شات‌ها | ✅ |
| متن‌های فارسی (نبود هیچ متن لاتین در ۲۸ صفحه و ۹ زبانه پروفایل) | `UiFlowTest.allScreensRenderPersianWithoutLatinText` | ✅ |
| صفحه کوچک (۳۲۰×۵۶۸dp) | `ScreenshotTest.smallScreen` | ✅ (بازبینی بصری) |
| حالت تیره | `ScreenshotTest.darkMode` | ✅ (بازبینی بصری) |
| حالت خالی | `ScreenshotTest.emptyStates` | ✅ |
| مدیریت خطا (نبود «مشکلی پیش آمد» در صفحات) | `UiFlowTest.allScreensRender…` | ✅ |
| تهیه و بازیابی نسخه پشتیبان (+ رمز اشتباه، فایل دست‌کاری‌شده/ناقص) | `RepositoryTest.backupRoundTripRestoresEverything`، `BackupCryptoTest` (۵ تست) | ✅ |
| تقویم شمسی (نوروزهای معلوم، سال کبیسه، رفت‌وبرگشت ۵۰ سال روزبه‌روز) | `JalaliTest` (۶ تست) | ✅ |

## چک‌لیست تست دستی پیش از انتشار (روی حداقل دو گوشی: اندروید ۸ یا ۹ و اندروید ۱۴ یا ۱۵)

- [ ] نصب `dist/panjeh-1.0.0-release.apk` و نمایش نام «پنجه» و آیکون در لانچر
- [ ] شروع، معرفی، رد کردن معرفی، افزودن اولین حیوان با عکس از گالری و از دوربین
- [ ] ثبت یادآور برای ۲ دقیقه بعد، بستن برنامه و دریافت اعلان؛ لمس «انجام شد» در اعلان
- [ ] رد کردن مجوز اعلان و بررسی نمایش یادآورها داخل برنامه
- [ ] خاموش/روشن کردن گوشی و دریافت یادآور بعدی
- [ ] «اعلان آزمایشی» در تنظیمات › اعلان‌ها
- [ ] افزودن سند PDF و تصویر، مشاهده و «باز کردن با برنامه دیگر»
- [ ] تهیه نسخه پشتیبان، حذف همه اطلاعات، بازیابی با همان رمز
- [ ] تغییر قالب روشن/تیره و قالب تاریخ
- [ ] کیبورد فارسی: ورود ارقام فارسی در وزن و هزینه؛ پنهان نشدن دکمه ذخیره زیر کیبورد
- [ ] دکمه/حرکت بازگشت سیستم در همه سطوح
