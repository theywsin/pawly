package ir.panjeh.petcare.reminders

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import ir.panjeh.petcare.Graph
import ir.panjeh.petcare.core.Fa
import ir.panjeh.petcare.data.DoseLog
import ir.panjeh.petcare.data.DoseStatus
import ir.panjeh.petcare.data.OccurrenceStatus

/** دریافت هشدارهای زمان‌بندی‌شده و اقدام «انجام شد» از داخل اعلان. */
class ReminderReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        Graph.init(context)
        val pending = goAsync()
        Thread {
            try {
                handle(context.applicationContext, intent)
            } catch (t: Throwable) {
                android.util.Log.w("Panjeh", "reminder handling failed: ${t.javaClass.simpleName}")
            } finally {
                pending.finish()
            }
        }.start()
    }

    private fun handle(context: Context, intent: Intent) {
        val segments = intent.data?.pathSegments ?: return
        if (segments.size < 2) return
        val kind = segments[0]
        val id = segments[1].toLongOrNull() ?: return
        val at = intent.getLongExtra(EXTRA_AT, 0L)
        when (intent.action) {
            ACTION_FIRE -> fire(context, kind, id, at)
            ACTION_DONE -> markDone(context, kind, id, at)
        }
        ReminderScheduler.sync(context)
    }

    private fun fire(context: Context, kind: String, id: Long, at: Long) {
        val repo = Graph.repo
        if (!Graph.prefs.notificationsEnabled) return
        val notifId = notificationId(kind, id, at)
        when (kind) {
            "reminder" -> {
                val r = repo.reminder(id)?.takeIf { it.enabled } ?: return
                val pet = r.petId?.let { repo.pet(it) }
                val text = listOfNotNull(pet?.name, r.note?.takeIf { it.isNotBlank() }, "ساعت ${Fa.time(at)}").joinToString(" · ")
                Notifications.show(
                    context, notifId, Notifications.CH_REMINDERS, "یادآور ${r.type.label}: ${r.title}", text,
                    doneIntent(context, kind, id, at), "انجام شد", "reminders",
                )
            }
            "dose" -> {
                val m = repo.medication(id) ?: return
                val pet = repo.pet(m.petId)
                val text = listOfNotNull(pet?.name, m.dosage, "ساعت ${Fa.time(at)}").joinToString(" · ") +
                    "\nفقط مطابق دستور دامپزشک مصرف شود."
                Notifications.show(
                    context, notifId, Notifications.CH_MEDICATION, "نوبت دارو: ${m.name}", text,
                    doneIntent(context, kind, id, at), "مصرف شد", "reminders",
                )
            }
            "vaccine" -> {
                val v = repo.vaccine(id) ?: return
                val pet = repo.pet(v.petId)
                val date = v.scheduledOn ?: return
                Notifications.show(
                    context, notifId, Notifications.CH_REMINDERS, "نوبت واکسن: ${v.name}",
                    listOfNotNull(pet?.name, "${Fa.relativeDay(date)} (${Fa.date(date)})", v.clinic).joinToString(" · "),
                    null, "", "health",
                )
            }
            "visit" -> {
                val v = repo.visit(id) ?: return
                val pet = repo.pet(v.petId)
                Notifications.show(
                    context, notifId, Notifications.CH_REMINDERS, "نوبت دامپزشک" + (pet?.let { " برای ${it.name}" } ?: ""),
                    listOfNotNull(Fa.dateTime(v.visitAt), v.clinic, v.reason).joinToString(" · "),
                    null, "", "health",
                )
            }
        }
    }

    private fun markDone(context: Context, kind: String, id: Long, at: Long) {
        val repo = Graph.repo
        when (kind) {
            "reminder" -> repo.logOccurrence(id, at, OccurrenceStatus.DONE)
            "dose" -> repo.medication(id)?.let { repo.logDose(DoseLog(medicationId = id, petId = it.petId, scheduledAt = at, status = DoseStatus.TAKEN)) }
        }
        Notifications.cancel(context, notificationId(kind, id, at))
    }

    private fun doneIntent(context: Context, kind: String, id: Long, at: Long): PendingIntent {
        val i = Intent(context, ReminderReceiver::class.java).apply {
            action = ACTION_DONE
            data = Uri.parse("panjeh://done/$kind/$id/$at")
            putExtra(EXTRA_AT, at)
        }
        return PendingIntent.getBroadcast(context, 0, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    companion object {
        const val ACTION_FIRE = "ir.panjeh.petcare.action.FIRE"
        const val ACTION_DONE = "ir.panjeh.petcare.action.DONE"
        const val EXTRA_AT = "at"

        fun notificationId(kind: String, id: Long, at: Long): Int = "$kind/$id/$at".hashCode()
    }
}
