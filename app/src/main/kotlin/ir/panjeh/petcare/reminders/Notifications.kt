package ir.panjeh.petcare.reminders

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import ir.panjeh.petcare.MainActivity
import ir.panjeh.petcare.R

/** ایجاد کانال‌ها و نمایش اعلان‌های یادآور. */
object Notifications {
    const val CH_REMINDERS = "reminders"
    const val CH_MEDICATION = "medication"

    fun ensureChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)!!
        nm.createNotificationChannel(
            NotificationChannel(CH_REMINDERS, "یادآورهای مراقبت", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "واکسن، مراجعه به دامپزشک و کارهای مراقبتی"
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_MEDICATION, "نوبت داروها", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "یادآوری زمان مصرف داروی ثبت‌شده"
            },
        )
    }

    /** آیا برنامه مجاز به نمایش اعلان است؟ */
    fun canPost(context: Context): Boolean {
        val nm = context.getSystemService(NotificationManager::class.java)!!
        if (!nm.areNotificationsEnabled()) return false
        return Build.VERSION.SDK_INT < 33 ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    }

    fun show(
        context: Context,
        id: Int,
        channel: String,
        title: String,
        text: String,
        doneAction: PendingIntent?,
        doneLabel: String,
        openTarget: String,
    ) {
        if (!canPost(context)) return
        ensureChannels(context)
        val open = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(MainActivity.EXTRA_OPEN, openTarget)
        }
        val contentIntent = PendingIntent.getActivity(
            context, id, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val b = Notification.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_paw)
            .setColor(context.getColor(R.color.brand_primary))
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_REMINDER)
            .setShowWhen(true)
        if (doneAction != null) {
            b.addAction(Notification.Action.Builder(null, doneLabel, doneAction).build())
        }
        context.getSystemService(NotificationManager::class.java)!!.notify(id, b.build())
    }

    fun cancel(context: Context, id: Int) {
        context.getSystemService(NotificationManager::class.java)!!.cancel(id)
    }
}
