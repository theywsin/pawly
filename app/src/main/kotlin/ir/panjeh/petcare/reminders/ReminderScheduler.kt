package ir.panjeh.petcare.reminders

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import ir.panjeh.petcare.Graph
import ir.panjeh.petcare.core.Async

/**
 * زمان‌بندی پایدار یادآورها با AlarmManager.
 *
 * برای هر منبع (یادآور، دارو، واکسن برنامه‌ریزی‌شده، نوبت دامپزشک) فقط «نزدیک‌ترین» وقوع بعدی
 * زمان‌بندی می‌شود. پس از اجرای هر هشدار، راه‌اندازی مجدد گوشی، تغییر ساعت یا هر تغییر در داده‌ها،
 * کل زمان‌بندی دوباره محاسبه می‌شود ([sync]). فهرست هشدارهای فعال در SharedPreferences نگهداری
 * می‌شود تا هشدارهای منسوخ لغو شوند.
 *
 * اگر مجوز «هشدار دقیق» (اندروید ۱۲ به بعد) داده نشده باشد، از زمان‌بندی تقریبی
 * setAndAllowWhileIdle استفاده می‌شود که ممکن است چند دقیقه تأخیر داشته باشد.
 */
object ReminderScheduler {

    private const val PREFS = "panjeh_alarms"
    private const val KEY_SET = "scheduled"

    /** همگام‌سازی در پس‌زمینه */
    fun syncAsync(context: Context) = Async.background { sync(context.applicationContext) }

    @Synchronized
    fun sync(context: Context) {
        val repo = Graph.repo
        val prefs = Graph.prefs
        val now = System.currentTimeMillis()
        val wanted = HashMap<String, Long>()

        if (prefs.notificationsEnabled) {
            for (r in repo.enabledReminders()) {
                // وقوع‌هایی که از قبل «انجام شد» ثبت شده‌اند رد می‌شوند
                var t = Occurrences.next(r, now + 1)
                var guard = 0
                while (t != null && guard++ < 50) {
                    val logged = repo.occurrenceLogsBetween(t, t + 1).isNotEmpty()
                    if (!logged) break
                    t = Occurrences.next(r, t + 1)
                }
                if (t != null) wanted["reminder/${r.id}"] = t
            }
            for (m in repo.activeMedications()) {
                if (!m.remindersEnabled) continue
                Occurrences.nextDose(m, now + 1)?.let { wanted["dose/${m.id}"] = it }
            }
            val defaultTime = prefs.defaultReminderTime
            for (v in repo.plannedVaccines()) {
                Occurrences.vaccineAlarmAt(v, defaultTime)?.takeIf { it > now }?.let { wanted["vaccine/${v.id}"] = it }
            }
            for (v in repo.scheduledVisits()) {
                Occurrences.visitAlarmAt(v)?.takeIf { it > now }?.let { wanted["visit/${v.id}"] = it }
            }
        }

        val sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val previous = sp.getStringSet(KEY_SET, emptySet()) ?: emptySet()
        val am = context.getSystemService(AlarmManager::class.java)!!
        for (key in previous) {
            if (key !in wanted) am.cancel(pendingIntent(context, key, 0L))
        }
        for ((key, at) in wanted) schedule(context, am, key, at)
        sp.edit().putStringSet(KEY_SET, HashSet(wanted.keys)).apply()
    }

    fun canScheduleExact(context: Context): Boolean =
        Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager::class.java)!!.canScheduleExactAlarms()

    private fun schedule(context: Context, am: AlarmManager, key: String, at: Long) {
        val pi = pendingIntent(context, key, at)
        if (canScheduleExact(context)) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        } else {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        }
    }

    private fun pendingIntent(context: Context, key: String, at: Long): PendingIntent {
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_FIRE
            data = Uri.parse("panjeh://alarm/$key")
            putExtra(ReminderReceiver.EXTRA_AT, at)
        }
        return PendingIntent.getBroadcast(
            context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** فقط برای تست: کلیدهای زمان‌بندی‌شده فعلی */
    fun scheduledKeys(context: Context): Set<String> =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet(KEY_SET, emptySet()) ?: emptySet()
}
