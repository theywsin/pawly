# مستندات پایگاه داده

- موتور: SQLite فریم‌ورک اندروید (`SQLiteOpenHelper`)، فایل `panjeh.db` در حافظه خصوصی برنامه
- نسخه طرح: `1` (مهاجرت‌های آینده در `AppDatabase.onUpgrade`)
- کلیدهای خارجی فعال‌اند (`PRAGMA foreign_keys=ON`)؛ با حذف هر حیوان، همه سوابق او به‌صورت `ON DELETE CASCADE` حذف می‌شوند.
- هر رکورد شناسه مستقل `INTEGER PRIMARY KEY AUTOINCREMENT` دارد و از طریق `pet_id` به یک حیوان تعلق دارد.
- قالب زمان: تاریخ‌ها به‌صورت `epochDay` (عدد روز)، زمان‌ها به‌صورت میلی‌ثانیه یونیکس ذخیره می‌شوند؛ نمایش شمسی فقط در لایه رابط انجام می‌شود.
- وزن به **گرم** (`REAL`) و هزینه به **تومان** (`INTEGER`) ذخیره می‌شود.
- تنظیمات و اطلاعات کاربر در `SharedPreferences` (`panjeh_settings`) نگهداری و در نسخه پشتیبان نیز ذخیره می‌شوند.

## نمودار روابط

```
pets ─┬─< weights
      ├─< vaccines ──< documents (related_type='vaccine')
      ├─< medications ─< dose_logs
      ├─< vet_visits ──< documents (related_type='visit')
      ├─< reminders ───< reminder_logs
      ├─< health_records
      ├─< care_logs
      └─< documents
```

## نگاشت موجودیت‌های خواسته‌شده

| موجودیت | جدول/محل |
|---------|----------|
| کاربر | `SharedPreferences` (نام کاربر) — حساب آنلاین وجود ندارد |
| حیوان | `pets` |
| سابقه سلامت | `health_records` + فیلدهای `allergies`/`conditions` در `pets` |
| واکسن | `vaccines` |
| دارو | `medications` |
| برنامه مصرف دارو | فیلدهای `times`، `every_n_days`، `start_on`، `end_on` در `medications` + سابقه در `dose_logs` |
| مراجعه دامپزشکی | `vet_visits` |
| اندازه‌گیری وزن | `weights` |
| یادآور | `reminders` + `reminder_logs` |
| سند | `documents` (فایل در `filesDir/media/docs`) |
| فعالیت مراقبتی | `care_logs` (+ برنامه تغذیه در `pets.food_type/meals_per_day/feeding_notes`) |
| تنظیمات | `SharedPreferences` |

## جداول

### pets
| ستون | نوع | توضیح |
|------|-----|-------|
| id | INTEGER PK | |
| name | TEXT NOT NULL | خالی نمی‌تواند باشد (CHECK) |
| species | TEXT NOT NULL | `DOG`، `CAT`، `BIRD`، `RABBIT`، `OTHER` |
| species_other | TEXT | نام گونه برای «سایر» |
| breed, color, microchip, notes | TEXT | اختیاری |
| sex | TEXT | `MALE`، `FEMALE`، `UNKNOWN` |
| birth_date | INTEGER | epochDay |
| neutered | INTEGER | ۱/۰/NULL(نامشخص) |
| allergies, conditions | TEXT | حساسیت‌ها و بیماری‌های شناخته‌شده |
| photo | TEXT | مسیر نسبی تصویر (`media/photos/*.jpg`) |
| food_type, meals_per_day, feeding_notes | | برنامه تغذیه ثبت‌شده توسط کاربر |
| vet_name, vet_clinic, vet_phone | TEXT | اطلاعات دامپزشک |
| created_at | INTEGER | |

### weights
`id`، `pet_id`، `grams REAL CHECK(grams>0)`، `measured_at`، `note` — نمایه روی `(pet_id, measured_at)`.

### vaccines
`id`، `pet_id`، `name`، `status` (`DONE`=تزریق شده، `PLANNED`=نوبت آینده)، `scheduled_on`، `given_on`، `clinic`، `vet`، `note`، `remind_days_before` (NULL=بدون یادآور)، `created_at`.
هر ردیف یک نوبت است؛ «نوبت بعدی» به‌صورت یک ردیف `PLANNED` جداگانه با تاریخی که کاربر وارد می‌کند ثبت می‌شود. برنامه هیچ تاریخی را خودکار محاسبه نمی‌کند.

### medications
`id`، `pet_id`، `name`، `dosage` (متن آزاد دقیقاً طبق نسخه)، `times` (مثلاً `08:00,20:00`)، `every_n_days ≥ 1`، `start_on`، `end_on`، `prescriber`، `note`، `status` (`ACTIVE`/`STOPPED`)، `reminders_enabled`، `created_at`.

### dose_logs
`id`، `medication_id`، `pet_id`، `scheduled_at`، `status` (`TAKEN`/`SKIPPED`)، `logged_at` — یکتا روی `(medication_id, scheduled_at)`.

### vet_visits
`id`، `pet_id`، `status` (`DONE`/`SCHEDULED`)، `visit_at`، `clinic`، `vet`، `reason`، `symptoms`، `diagnosis` (نتیجه معاینه)، `prescriptions`، `cost_toman`، `note`، `remind_minutes_before`، `created_at`.

### reminders
`id`، `pet_id` (NULL=عمومی)، `type` (`VACCINE`، `MEDICATION`، `VET`، `WEIGHT`، `GROOMING`، `FEEDING`، `CARE`، `OTHER`)، `title`، `note`، `start_at`، `repeat` (`NONE`، `DAILY`، `EVERY_N_DAYS`، `WEEKLY`، `MONTHLY`، `YEARLY`)، `interval ≥ 1`، `end_on`، `enabled`، `created_at`.
تکرار ماهانه و سالانه بر اساس **تقویم شمسی** است (مثلاً «۱۵ هر ماه»؛ روز ۳۱ در ماه‌های ۳۰ روزه به آخرین روز ماه منتقل می‌شود).

### reminder_logs
`id`، `reminder_id`، `occurrence_at`، `status` (`DONE`/`SKIPPED`)، `logged_at` — یکتا روی `(reminder_id, occurrence_at)`.

### health_records
`id`، `pet_id`، `kind` (`SYMPTOM`، `ILLNESS`، `TEST`، `SURGERY`، `ALLERGY`، `NOTE`)، `title`، `date`، `note`، `created_at`.

### care_logs
`id`، `pet_id`، `kind` (`FEEDING`، `ACTIVITY`، `GROOMING`، `OTHER`)، `title`، `amount`، `duration_minutes`، `logged_at`، `note`.

### documents
`id`، `pet_id`، `title`، `category` (`VACCINE_CERT`، `PRESCRIPTION`، `LAB`، `ID`، `IMAGING`، `OTHER`)، `file_path`، `mime`، `size_bytes`، `note`، `related_type` (`vaccine`/`visit`)، `related_id`، `created_at`.

## ذخیره فایل‌ها

| نوع | مسیر | توضیح |
|-----|------|------|
| تصویر حیوان | `filesDir/media/photos/<uuid>.jpg` | حداکثر ۱۶۰۰ پیکسل، جهت EXIF اصلاح می‌شود |
| سند تصویری | `filesDir/media/docs/<uuid>.jpg` | حداکثر ۲۴۰۰ پیکسل |
| سایر اسناد (PDF و ...) | `filesDir/media/docs/<uuid>.<ext>` | عیناً کپی، حداکثر ۲۵ مگابایت |
| عکس موقت دوربین | `cacheDir/camera/` | فقط تا انتقال به حافظه دائمی |

- مسیرها نسبی ذخیره می‌شوند و هنگام خواندن از خروج از پوشه `media` (path traversal) جلوگیری می‌شود.
- دسترسی برنامه‌های دیگر فقط با مجوز موقت URI از طریق `PrivateFileProvider` (غیرصادرشده) ممکن است.
- `android:allowBackup="false"`: پشتیبان‌گیری خودکار ابری سیستم غیرفعال است.

## سیاست پایداری

- همه نوشتن‌ها خارج از رشته اصلی و عملیات چندمرحله‌ای (مثل ذخیره حیوان + وزن اولیه، بازیابی نسخه پشتیبان) در تراکنش انجام می‌شوند.
- تست `RepositoryTest.petCrudAndPersistenceAcrossReopen` بستن و باز کردن مجدد پایگاه داده را بررسی می‌کند.
