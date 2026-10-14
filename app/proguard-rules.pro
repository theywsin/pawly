# قوانین ProGuard برای نسخه انتشار «پنجه»
# فقط کوچک‌سازی (حذف کد بلااستفاده) انجام می‌شود؛ مبهم‌سازی برای خوانایی گزارش خطا غیرفعال است.
-dontobfuscate
-dontoptimize
-dontwarn **
-ignorewarnings
-dontnote **

# اجزای تعریف‌شده در مانیفست
-keep class ir.panjeh.petcare.PanjehApp { <init>(); }
-keep class ir.panjeh.petcare.MainActivity { <init>(); }
-keep class ir.panjeh.petcare.reminders.ReminderReceiver { <init>(); }
-keep class ir.panjeh.petcare.reminders.SystemEventsReceiver { <init>(); }
-keep class ir.panjeh.petcare.data.files.PrivateFileProvider { <init>(); }

# متدهای چرخه عمر و بازنویسی‌شده فریم‌ورک حفظ می‌شوند (ProGuard به‌طور خودکار بازنویسی‌ها را نگه می‌دارد)
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}
-keep class ir.panjeh.petcare.R { *; }
-keep class ir.panjeh.petcare.R$* { *; }
