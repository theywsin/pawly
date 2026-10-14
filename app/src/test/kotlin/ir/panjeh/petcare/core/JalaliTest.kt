package ir.panjeh.petcare.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class JalaliTest {
    @Test
    fun knownNowruzDates() {
        assertEquals(JalaliDate(1403, 1, 1), JalaliDate.of(LocalDate.of(2024, 3, 20)))
        assertEquals(JalaliDate(1404, 1, 1), JalaliDate.of(LocalDate.of(2025, 3, 21)))
        assertEquals(JalaliDate(1405, 1, 1), JalaliDate.of(LocalDate.of(2026, 3, 21)))
        assertEquals(JalaliDate(1403, 12, 30), JalaliDate.of(LocalDate.of(2025, 3, 20)))
    }

    @Test
    fun knownDates() {
        assertEquals(JalaliDate(1405, 7, 22), JalaliDate.of(LocalDate.of(2026, 10, 14)))
        assertEquals(JalaliDate(1357, 11, 22), JalaliDate.of(LocalDate.of(1979, 2, 11)))
        assertEquals(LocalDate.of(2026, 10, 14), Jalali.toGregorian(1405, 7, 22))
    }

    @Test
    fun roundTripEveryDayForFiftyYears() {
        var d = LocalDate.of(1990, 1, 1)
        val end = LocalDate.of(2040, 12, 31)
        var prev: JalaliDate? = null
        while (!d.isAfter(end)) {
            val j = JalaliDate.of(d)
            assertEquals(d, j.toLocalDate())
            assertTrue(j.day in 1..Jalali.monthLength(j.year, j.month))
            if (prev != null) assertTrue(j > prev)
            prev = j
            d = d.plusDays(1)
        }
    }

    @Test
    fun leapYears() {
        assertTrue(Jalali.isLeap(1403))
        assertFalse(Jalali.isLeap(1404))
        assertEquals(30, Jalali.monthLength(1403, 12))
        assertEquals(29, Jalali.monthLength(1404, 12))
    }

    @Test
    fun monthArithmeticClampsDay() {
        assertEquals(JalaliDate(1405, 7, 30), JalaliDate(1405, 6, 31).plusMonths(1))
        assertEquals(JalaliDate(1406, 1, 15), JalaliDate(1405, 12, 15).plusMonths(1))
        assertEquals(JalaliDate(1404, 12, 29), JalaliDate(1403, 12, 30).plusYears(1))
    }

    @Test
    fun weekColumnStartsOnSaturday() {
        assertEquals(0, Jalali.weekColumn(LocalDate.of(2026, 10, 10))) // شنبه
        assertEquals(6, Jalali.weekColumn(LocalDate.of(2026, 10, 16))) // جمعه
        assertEquals("سه‌شنبه", Jalali.weekdayName(LocalDate.of(2026, 10, 13)))
    }
}
