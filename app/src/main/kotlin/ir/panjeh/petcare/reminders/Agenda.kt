package ir.panjeh.petcare.reminders

import ir.panjeh.petcare.core.Fa
import ir.panjeh.petcare.core.JalaliDate
import ir.panjeh.petcare.data.DoseStatus
import ir.panjeh.petcare.data.Medication
import ir.panjeh.petcare.data.MedicationStatus
import ir.panjeh.petcare.data.OccurrenceStatus
import ir.panjeh.petcare.data.Reminder
import ir.panjeh.petcare.data.ReminderType
import ir.panjeh.petcare.data.Repeat
import ir.panjeh.petcare.data.Repository
import ir.panjeh.petcare.data.Vaccine
import ir.panjeh.petcare.data.VaccineStatus
import ir.panjeh.petcare.data.VetVisit
import ir.panjeh.petcare.data.VisitStatus
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.temporal.ChronoUnit

/** محاسبه زمان‌های وقوع یادآورها و نوبت‌های دارو (منطق خالص و قابل تست). */
object Occurrences {

    private const val MAX_ITER = 5000

    fun startDateTime(r: Reminder): LocalDateTime = Fa.toLocalDateTime(r.startAt)

    /** k-امین وقوع (k از صفر). ماهانه/سالانه بر اساس تقویم شمسی محاسبه می‌شود. */
    fun nth(r: Reminder, k: Int): LocalDateTime {
        val start = startDateTime(r)
        val step = r.interval.coerceAtLeast(1)
        return when (r.repeat) {
            Repeat.NONE -> start
            Repeat.DAILY -> start.plusDays(k.toLong())
            Repeat.EVERY_N_DAYS -> start.plusDays(k.toLong() * step)
            Repeat.WEEKLY -> start.plusWeeks(k.toLong() * step)
            Repeat.MONTHLY -> JalaliDate.of(start.toLocalDate()).plusMonths(k * step).toLocalDate().atTime(start.toLocalTime())
            Repeat.YEARLY -> JalaliDate.of(start.toLocalDate()).plusYears(k * step).toLocalDate().atTime(start.toLocalTime())
        }
    }

    private fun withinEnd(r: Reminder, t: LocalDateTime) = r.endOn == null || !t.toLocalDate().isAfter(r.endOn)

    /** زمان‌های وقوع در بازه [from, to) به میلی‌ثانیه. */
    fun between(r: Reminder, from: Long, to: Long): List<Long> {
        val out = ArrayList<Long>()
        if (r.repeat == Repeat.NONE) {
            if (r.startAt in from until to) out += r.startAt
            return out
        }
        var k = estimateStartIndex(r, from)
        var guard = 0
        while (guard++ < MAX_ITER) {
            val t = nth(r, k)
            if (!withinEnd(r, t)) break
            val ms = Fa.millisOf(t.toLocalDate(), t.toLocalTime())
            if (ms >= to) break
            if (ms >= from) out += ms
            k++
        }
        return out
    }

    /** نخستین وقوع که زمان آن >= [after] باشد. */
    fun next(r: Reminder, after: Long): Long? {
        if (r.repeat == Repeat.NONE) return r.startAt.takeIf { it >= after }
        var k = estimateStartIndex(r, after)
        var guard = 0
        while (guard++ < MAX_ITER) {
            val t = nth(r, k)
            if (!withinEnd(r, t)) return null
            val ms = Fa.millisOf(t.toLocalDate(), t.toLocalTime())
            if (ms >= after) return ms
            k++
        }
        return null
    }

    private fun estimateStartIndex(r: Reminder, from: Long): Int {
        if (from <= r.startAt) return 0
        val start = startDateTime(r)
        val target = Fa.toLocalDateTime(from)
        val days = ChronoUnit.DAYS.between(start.toLocalDate(), target.toLocalDate())
        val step = r.interval.coerceAtLeast(1)
        val k = when (r.repeat) {
            Repeat.DAILY -> days
            Repeat.EVERY_N_DAYS -> days / step
            Repeat.WEEKLY -> days / (7L * step)
            Repeat.MONTHLY -> days / (31L * step)
            Repeat.YEARLY -> days / (366L * step)
            Repeat.NONE -> 0
        }
        return (k - 1).coerceIn(0, Int.MAX_VALUE.toLong()).toInt()
    }

    /** نوبت‌های مصرف دارو در بازه [from, to). */
    fun doses(m: Medication, from: Long, to: Long): List<Long> {
        if (m.status != MedicationStatus.ACTIVE) return emptyList()
        val out = ArrayList<Long>()
        var day = maxOf(Fa.dateOfMillis(from), m.startOn)
        val lastDay = Fa.dateOfMillis(to - 1).let { if (m.endOn != null && m.endOn.isBefore(it)) m.endOn else it }
        var guard = 0
        while (!day.isAfter(lastDay) && guard++ < MAX_ITER) {
            if (m.isActiveOn(day)) {
                for (t in m.times.sorted()) {
                    val ms = Fa.millisOf(day, t)
                    if (ms in from until to) out += ms
                }
            }
            day = day.plusDays(1)
        }
        return out
    }

    fun nextDose(m: Medication, after: Long): Long? {
        if (m.status != MedicationStatus.ACTIVE) return null
        val horizon = after + 400L * 24 * 3600 * 1000
        var from = after
        while (from < horizon) {
            val to = from + 7L * 24 * 3600 * 1000
            doses(m, from, to).firstOrNull()?.let { return it }
            if (m.endOn != null && Fa.dateOfMillis(from).isAfter(m.endOn)) return null
            from = to
        }
        return null
    }

    fun vaccineAlarmAt(v: Vaccine, defaultTime: LocalTime): Long? {
        if (v.status != VaccineStatus.PLANNED || v.scheduledOn == null || v.remindDaysBefore == null) return null
        return Fa.millisOf(v.scheduledOn.minusDays(v.remindDaysBefore.toLong()), defaultTime)
    }

    fun visitAlarmAt(v: VetVisit): Long? {
        if (v.status != VisitStatus.SCHEDULED || v.remindMinutesBefore == null) return null
        return v.visitAt - v.remindMinutesBefore * 60_000L
    }
}

/** یک مورد در برنامه روزانه (یادآور، نوبت دارو، واکسن، مراجعه). */
data class AgendaItem(
    val key: String,
    val kind: Kind,
    val type: ReminderType,
    val sourceId: Long,
    val petId: Long?,
    val title: String,
    val detail: String?,
    /** زمان دقیق؛ برای موارد تمام‌روز ابتدای روز است */
    val at: Long,
    val allDay: Boolean,
    val state: State,
) {
    enum class Kind { REMINDER, DOSE, VACCINE, VISIT }
    enum class State { PENDING, DONE, SKIPPED }

    /** آیا کاربر می‌تواند آن را «انجام شد» علامت بزند؟ */
    val checkable: Boolean get() = kind == Kind.REMINDER || kind == Kind.DOSE
}

object AgendaBuilder {

    /**
     * ساخت برنامه برای روزهای [from] تا [to] (شامل هر دو).
     * واکسن‌های عقب‌افتاده نیز اگر [includeOverdue] باشد در ابتدای فهرست می‌آیند.
     */
    fun build(repo: Repository, from: LocalDate, to: LocalDate, includeOverdue: Boolean, petId: Long? = null): List<AgendaItem> {
        val start = Fa.millisOf(from, LocalTime.MIN)
        val end = Fa.millisOf(to.plusDays(1), LocalTime.MIN)
        val items = ArrayList<AgendaItem>()

        val logs = repo.occurrenceLogsBetween(start, end)
        for (r in repo.enabledReminders()) {
            if (petId != null && r.petId != petId) continue
            for (t in Occurrences.between(r, start, end)) {
                val st = when (logs[r.id to t]) {
                    OccurrenceStatus.DONE -> AgendaItem.State.DONE
                    OccurrenceStatus.SKIPPED -> AgendaItem.State.SKIPPED
                    null -> AgendaItem.State.PENDING
                }
                items += AgendaItem("r:${r.id}:$t", AgendaItem.Kind.REMINDER, r.type, r.id, r.petId, r.title, r.note, t, false, st)
            }
        }

        val doseLogs = repo.doseLogsBetween(start, end).associateBy { it.medicationId to it.scheduledAt }
        for (m in repo.activeMedications()) {
            if (petId != null && m.petId != petId) continue
            for (t in Occurrences.doses(m, start, end)) {
                val st = when (doseLogs[m.id to t]?.status) {
                    DoseStatus.TAKEN -> AgendaItem.State.DONE
                    DoseStatus.SKIPPED -> AgendaItem.State.SKIPPED
                    null -> AgendaItem.State.PENDING
                }
                items += AgendaItem("m:${m.id}:$t", AgendaItem.Kind.DOSE, ReminderType.MEDICATION, m.id, m.petId, m.name, m.dosage, t, false, st)
            }
        }

        for (v in repo.plannedVaccines()) {
            if (petId != null && v.petId != petId) continue
            val d = v.scheduledOn ?: continue
            val inRange = !d.isBefore(from) && !d.isAfter(to)
            val overdue = includeOverdue && d.isBefore(from)
            if (inRange || overdue) {
                items += AgendaItem(
                    "v:${v.id}", AgendaItem.Kind.VACCINE, ReminderType.VACCINE, v.id, v.petId, v.name,
                    if (overdue) "عقب‌افتاده از ${Fa.date(d)}" else v.clinic,
                    Fa.millisOf(d, LocalTime.MIN), true, AgendaItem.State.PENDING,
                )
            }
        }

        for (v in repo.scheduledVisits()) {
            if (petId != null && v.petId != petId) continue
            if (v.visitAt in start until end) {
                items += AgendaItem(
                    "x:${v.id}", AgendaItem.Kind.VISIT, ReminderType.VET, v.id, v.petId,
                    v.reason?.takeIf { it.isNotBlank() } ?: "مراجعه به دامپزشک",
                    listOfNotNull(v.clinic, v.vet).joinToString(" · ").ifBlank { null },
                    v.visitAt, false, AgendaItem.State.PENDING,
                )
            }
        }
        return items.sortedWith(compareBy<AgendaItem>({ !it.allDay }, { it.at }, { it.title }))
    }
}
