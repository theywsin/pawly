package ir.panjeh.petcare.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import ir.panjeh.petcare.Graph

/**
 * بازیابی زمان‌بندی یادآورها پس از راه‌اندازی مجدد گوشی، به‌روزرسانی برنامه،
 * تغییر ساعت/منطقه زمانی یا تغییر وضعیت مجوز هشدار دقیق.
 */
class SystemEventsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED,
            "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED",
            -> {
                Graph.init(context)
                val pending = goAsync()
                Thread {
                    try {
                        ReminderScheduler.sync(context.applicationContext)
                    } catch (t: Throwable) {
                        android.util.Log.w("Panjeh", "reschedule failed: ${t.javaClass.simpleName}")
                    } finally {
                        pending.finish()
                    }
                }.start()
            }
        }
    }
}
