package ir.panjeh.petcare.core

import java.time.LocalDate

/**
 * تبدیل تاریخ میلادی ↔ شمسی (هجری خورشیدی) بر اساس الگوریتم شناخته‌شده jalaali
 * (محاسبه سال‌های کبیسه با جدول «breaks»). برای بازه ۱۷۸- تا ۳۱۷۷ شمسی معتبر است.
 */
data class JalaliDate(val year: Int, val month: Int, val day: Int) : Comparable<JalaliDate> {

    fun toLocalDate(): LocalDate = Jalali.toGregorian(year, month, day)

    fun plusMonths(months: Int): JalaliDate {
        val total = year * 12 + (month - 1) + months
        val y = Math.floorDiv(total, 12)
        val m = Math.floorMod(total, 12) + 1
        val d = minOf(day, Jalali.monthLength(y, m))
        return JalaliDate(y, m, d)
    }

    fun plusYears(years: Int): JalaliDate {
        val y = year + years
        return JalaliDate(y, month, minOf(day, Jalali.monthLength(y, month)))
    }

    override fun compareTo(other: JalaliDate): Int =
        compareValuesBy(this, other, { it.year }, { it.month }, { it.day })

    companion object {
        fun of(date: LocalDate): JalaliDate = Jalali.fromGregorian(date)
        fun today(): JalaliDate = of(LocalDate.now())
    }
}

object Jalali {

    val MONTHS = arrayOf(
        "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
        "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
    )

    /** نام روزهای هفته؛ ترتیب مطابق java.time.DayOfWeek (دوشنبه=۱ ... یکشنبه=۷). */
    private val WEEKDAYS_ISO = arrayOf(
        "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه", "شنبه", "یکشنبه",
    )

    /** سرستون تقویم شمسی؛ هفته از شنبه شروع می‌شود. */
    val WEEK_HEADER = arrayOf("ش", "ی", "د", "س", "چ", "پ", "ج")

    fun weekdayName(date: LocalDate): String = WEEKDAYS_ISO[date.dayOfWeek.value - 1]

    /** ایندکس ستون در تقویم شمسی (شنبه=۰ ... جمعه=۶). */
    fun weekColumn(date: LocalDate): Int = (date.dayOfWeek.value + 1) % 7

    private val BREAKS = intArrayOf(
        -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
        1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178,
    )

    private class Cal(val leap: Int, val gy: Int, val march: Int)

    private fun jalCal(jy: Int): Cal {
        require(jy >= BREAKS[0] && jy < BREAKS[BREAKS.size - 1]) { "سال خارج از محدوده: $jy" }
        val gy = jy + 621
        var leapJ = -14
        var jp = BREAKS[0]
        var jump = 0
        for (i in 1 until BREAKS.size) {
            val jm = BREAKS[i]
            jump = jm - jp
            if (jy < jm) break
            leapJ += jump / 33 * 8 + (jump % 33) / 4
            jp = jm
        }
        var n = jy - jp
        leapJ += n / 33 * 8 + ((n % 33) + 3) / 4
        if (jump % 33 == 4 && jump - n == 4) leapJ += 1
        val leapG = gy / 4 - ((gy / 100 + 1) * 3) / 4 - 150
        val march = 20 + leapJ - leapG
        if (jump - n < 6) n = n - jump + (jump + 4) / 33 * 33
        var leap = (((n + 1) % 33) - 1) % 4
        if (leap == -1) leap = 4
        return Cal(leap, gy, march)
    }

    fun isLeap(jy: Int): Boolean = jalCal(jy).leap == 0

    fun monthLength(jy: Int, jm: Int): Int = when {
        jm <= 6 -> 31
        jm <= 11 -> 30
        isLeap(jy) -> 30
        else -> 29
    }

    fun toGregorian(jy: Int, jm: Int, jd: Int): LocalDate {
        val cal = jalCal(jy)
        val nowruz = LocalDate.of(cal.gy, 3, cal.march)
        val offset = (jm - 1) * 31 - (jm / 7) * (jm - 7) + jd - 1
        return nowruz.plusDays(offset.toLong())
    }

    fun fromGregorian(date: LocalDate): JalaliDate {
        val gy = date.year
        var jy = gy - 621
        val cal = jalCal(jy)
        val nowruz = LocalDate.of(gy, 3, cal.march)
        var k = (date.toEpochDay() - nowruz.toEpochDay()).toInt()
        if (k >= 0) {
            if (k <= 185) return JalaliDate(jy, 1 + k / 31, k % 31 + 1)
            k -= 186
        } else {
            jy -= 1
            k += 179
            if (cal.leap == 1) k += 1
        }
        return JalaliDate(jy, 7 + k / 30, k % 30 + 1)
    }
}
