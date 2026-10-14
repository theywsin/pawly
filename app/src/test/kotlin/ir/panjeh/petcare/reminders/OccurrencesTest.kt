package ir.panjeh.petcare.reminders

import ir.panjeh.petcare.core.Fa
import ir.panjeh.petcare.data.Medication
import ir.panjeh.petcare.data.MedicationStatus
import ir.panjeh.petcare.data.Reminder
import ir.panjeh.petcare.data.ReminderType
import ir.panjeh.petcare.data.Repeat
import ir.panjeh.petcare.data.Vaccine
import ir.panjeh.petcare.data.VaccineStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.LocalDate
import java.time.LocalTime
import java.util.TimeZone

class OccurrencesTest {
    @Before
    fun tz() = TimeZone.setDefault(TimeZone.getTimeZone("Asia/Tehran"))

    private fun ms(y: Int, m: Int, d: Int, h: Int = 9, min: Int = 0) = Fa.millisOf(LocalDate.of(y, m, d), LocalTime.of(h, min))
    private fun rem(repeat: Repeat, start: Long, interval: Int = 1, end: LocalDate? = null) =
        Reminder(id = 1, petId = 1, type = ReminderType.CARE, title = "x", startAt = start, repeat = repeat, interval = interval, endOn = end)

    @Test
    fun oneShot() {
        val r = rem(Repeat.NONE, ms(2026, 10, 20))
        assertEquals(ms(2026, 10, 20), Occurrences.next(r, ms(2026, 10, 14)))
        assertNull(Occurrences.next(r, ms(2026, 10, 21)))
        assertEquals(listOf(ms(2026, 10, 20)), Occurrences.between(r, ms(2026, 10, 20, 0), ms(2026, 10, 21, 0)))
    }

    @Test
    fun dailyAndEveryN() {
        val r = rem(Repeat.DAILY, ms(2026, 1, 1, 8))
        assertEquals(ms(2026, 10, 15, 8), Occurrences.next(r, ms(2026, 10, 14, 8, 1)))
        assertEquals(7, Occurrences.between(r, ms(2026, 10, 14, 0), ms(2026, 10, 21, 0)).size)
        val e3 = rem(Repeat.EVERY_N_DAYS, ms(2026, 10, 1, 8), interval = 3)
        assertEquals(listOf(ms(2026, 10, 13, 8), ms(2026, 10, 16, 8), ms(2026, 10, 19, 8)), Occurrences.between(e3, ms(2026, 10, 12, 0), ms(2026, 10, 21, 0)))
    }

    @Test
    fun weeklyWithEndDate() {
        val r = rem(Repeat.WEEKLY, ms(2026, 10, 1, 18), end = LocalDate.of(2026, 10, 20))
        assertEquals(listOf(ms(2026, 10, 1, 18), ms(2026, 10, 8, 18), ms(2026, 10, 15, 18)), Occurrences.between(r, ms(2026, 9, 1), ms(2026, 12, 1)))
        assertNull(Occurrences.next(r, ms(2026, 10, 16)))
    }

    @Test
    fun monthlyFollowsJalaliCalendar() {
        // ۳۱ شهریور ۱۴۰۵ = 2026-09-22 ؛ ماه بعد (مهر) ۳۰ روزه است → ۳۰ مهر
        val start = ms(2026, 9, 22, 10)
        val r = rem(Repeat.MONTHLY, start)
        val next = Occurrences.next(r, start + 1)!!
        assertEquals(LocalDate.of(2026, 10, 22), Fa.dateOfMillis(next)) // ۳۰ مهر
        val third = Occurrences.between(r, ms(2026, 11, 1), ms(2026, 12, 31))
        assertTrue(third.isNotEmpty())
        // ۱۵ مهر هر ماه
        val r2 = rem(Repeat.MONTHLY, ms(2026, 10, 7, 10))
        val d = Fa.dateOfMillis(Occurrences.next(r2, ms(2026, 10, 8))!!)
        assertEquals(ir.panjeh.petcare.core.JalaliDate(1405, 8, 15), ir.panjeh.petcare.core.JalaliDate.of(d))
    }

    @Test
    fun yearly() {
        val r = rem(Repeat.YEARLY, ms(2025, 3, 21, 9)) // ۱ فروردین
        assertEquals(LocalDate.of(2027, 3, 21), Fa.dateOfMillis(Occurrences.next(r, ms(2026, 10, 14))!!))
    }

    @Test
    fun medicationDoses() {
        val m = Medication(id = 1, petId = 1, name = "x", dosage = "1", times = listOf(LocalTime.of(20, 0), LocalTime.of(8, 0)),
            everyNDays = 2, startOn = LocalDate.of(2026, 10, 10), endOn = LocalDate.of(2026, 10, 14))
        val doses = Occurrences.doses(m, ms(2026, 10, 1, 0), ms(2026, 11, 1, 0))
        assertEquals(listOf(ms(2026, 10, 10, 8), ms(2026, 10, 10, 20), ms(2026, 10, 12, 8), ms(2026, 10, 12, 20), ms(2026, 10, 14, 8), ms(2026, 10, 14, 20)), doses)
        assertEquals(ms(2026, 10, 12, 8), Occurrences.nextDose(m, ms(2026, 10, 10, 21)))
        assertNull(Occurrences.nextDose(m, ms(2026, 10, 14, 21)))
        assertNull(Occurrences.nextDose(m.copy(status = MedicationStatus.STOPPED), ms(2026, 10, 10)))
    }

    @Test
    fun vaccineAlarmUsesUserDateNotAutomaticSchedule() {
        val v = Vaccine(petId = 1, name = "x", status = VaccineStatus.PLANNED, scheduledOn = LocalDate.of(2026, 11, 1), remindDaysBefore = 3)
        assertEquals(ms(2026, 10, 29, 9), Occurrences.vaccineAlarmAt(v, LocalTime.of(9, 0)))
        assertNull(Occurrences.vaccineAlarmAt(v.copy(remindDaysBefore = null), LocalTime.of(9, 0)))
        assertNull(Occurrences.vaccineAlarmAt(v.copy(status = VaccineStatus.DONE), LocalTime.of(9, 0)))
    }
}
