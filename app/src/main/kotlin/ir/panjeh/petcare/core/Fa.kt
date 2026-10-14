package ir.panjeh.petcare.core

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import kotlin.math.abs
import kotlin.math.roundToLong

/**
 * سیاست یکپارچه نمایش اعداد، تاریخ، ساعت و واحدها در سراسر برنامه:
 *  - همه اعداد با ارقام فارسی (۰ تا ۹) نمایش داده می‌شوند.
 *  - جداکننده اعشار «٫» و جداکننده هزارگان «٬» است.
 *  - تاریخ‌ها شمسی هستند؛ قالب بلند «۲۲ مهر ۱۴۰۵» یا عددی «۱۴۰۵/۰۷/۲۲» (قابل انتخاب در تنظیمات).
 *  - ساعت‌ها ۲۴ ساعته‌اند: «۰۸:۳۰».
 *  - وزن در پایگاه داده به گرم ذخیره و به‌صورت «۴٫۲ کیلوگرم» یا «۸۵ گرم» نمایش داده می‌شود.
 *  - مبلغ‌ها به تومان نمایش داده می‌شوند.
 * ورودی‌های عددی هر دو نوع رقم فارسی/عربی و لاتین را می‌پذیرند.
 */
object Fa {

    enum class DateStyle { LONG, NUMERIC }

    /** توسط تنظیمات مقداردهی می‌شود. */
    @Volatile
    var dateStyle: DateStyle = DateStyle.LONG

    val zone: ZoneId get() = ZoneId.systemDefault()

    private const val FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
    private const val AR_DIGITS = "٠١٢٣٤٥٦٧٨٩"

    fun digits(s: String): String {
        val sb = StringBuilder(s.length)
        for (c in s) {
            sb.append(
                when (c) {
                    in '0'..'9' -> FA_DIGITS[c - '0']
                    '.' -> '٫'
                    else -> c
                },
            )
        }
        return sb.toString()
    }

    /** فقط ارقام را فارسی می‌کند و نقطه را دست نمی‌زند (برای متن‌های آزاد). */
    fun digitsOnly(s: String): String {
        val sb = StringBuilder(s.length)
        for (c in s) sb.append(if (c in '0'..'9') FA_DIGITS[c - '0'] else c)
        return sb.toString()
    }

    fun num(n: Int): String = digitsOnly(n.toString())
    fun num(n: Long): String = digitsOnly(n.toString())

    /** تبدیل ارقام فارسی/عربی به لاتین و نرمال‌سازی اعشار برای تجزیه. */
    fun normalizeDigits(s: String): String {
        val sb = StringBuilder(s.length)
        for (c in s) {
            val fa = FA_DIGITS.indexOf(c)
            val ar = AR_DIGITS.indexOf(c)
            sb.append(
                when {
                    fa >= 0 -> '0' + fa
                    ar >= 0 -> '0' + ar
                    c == '٫' || c == '/' || c == ',' || c == '،' -> '.'
                    c == '٬' -> ' '
                    else -> c
                },
            )
        }
        return sb.toString().replace(" ", "").trim()
    }

    fun parseDecimal(s: String?): Double? {
        if (s.isNullOrBlank()) return null
        val v = normalizeDigits(s).toDoubleOrNull() ?: return null
        return if (v.isNaN() || v.isInfinite()) null else v
    }

    fun parseLong(s: String?): Long? {
        if (s.isNullOrBlank()) return null
        return normalizeDigits(s).replace(".", "").toLongOrNull()
    }

    fun decimal(value: Double, maxFraction: Int = 1): String {
        val factor = Math.pow(10.0, maxFraction.toDouble())
        val rounded = (value * factor).roundToLong() / factor
        var text = if (rounded == Math.floor(rounded)) rounded.toLong().toString()
        else String.format(java.util.Locale.US, "%.${maxFraction}f", rounded).trimEnd('0').trimEnd('.')
        if (text == "-0") text = "0"
        return digits(text)
    }

    fun grouped(n: Long): String {
        val raw = abs(n).toString()
        val sb = StringBuilder()
        raw.forEachIndexed { i, c ->
            if (i > 0 && (raw.length - i) % 3 == 0) sb.append('٬')
            sb.append(c)
        }
        return (if (n < 0) "-" else "") + digitsOnly(sb.toString())
    }

    fun toman(amount: Long): String = "${grouped(amount)} تومان"

    // ---------------------------------------------------------------- وزن
    fun weight(grams: Double): String =
        if (grams < 1000) "${decimal(grams, 0)} گرم" else "${decimal(grams / 1000.0, 2)} کیلوگرم"

    fun weightDelta(grams: Double): String {
        val sign = if (grams > 0) "+" else if (grams < 0) "−" else ""
        return sign + weight(abs(grams))
    }

    // ---------------------------------------------------------------- زمان
    fun time(t: LocalTime): String = digitsOnly(String.format(java.util.Locale.US, "%02d:%02d", t.hour, t.minute))

    fun time(millis: Long): String = time(LocalDateTime.ofInstant(Instant.ofEpochMilli(millis), zone).toLocalTime())

    fun date(d: LocalDate, withWeekday: Boolean = false): String {
        val j = JalaliDate.of(d)
        val core = when (dateStyle) {
            DateStyle.LONG -> "${num(j.day)} ${Jalali.MONTHS[j.month - 1]} ${num(j.year)}"
            DateStyle.NUMERIC -> digitsOnly(String.format(java.util.Locale.US, "%04d/%02d/%02d", j.year, j.month, j.day))
        }
        return if (withWeekday) "${Jalali.weekdayName(d)}، $core" else core
    }

    /** «۲۲ مهر» بدون سال؛ برای فهرست‌های فشرده. */
    fun dayMonth(d: LocalDate): String {
        val j = JalaliDate.of(d)
        return "${num(j.day)} ${Jalali.MONTHS[j.month - 1]}"
    }

    fun monthYear(j: JalaliDate): String = "${Jalali.MONTHS[j.month - 1]} ${num(j.year)}"

    fun dateOfMillis(millis: Long): LocalDate = toLocalDateTime(millis).toLocalDate()

    fun toLocalDateTime(millis: Long): LocalDateTime = LocalDateTime.ofInstant(Instant.ofEpochMilli(millis), zone)

    fun millisOf(date: LocalDate, time: LocalTime): Long = date.atTime(time).atZone(zone).toInstant().toEpochMilli()

    fun dateTime(millis: Long): String {
        val dt = toLocalDateTime(millis)
        return "${date(dt.toLocalDate())}، ساعت ${time(dt.toLocalTime())}"
    }

    /** برچسب نسبی: امروز / فردا / دیروز / ۳ روز دیگر / ۲ روز پیش. */
    fun relativeDay(d: LocalDate, today: LocalDate = LocalDate.now()): String {
        val diff = ChronoUnit.DAYS.between(today, d)
        return when {
            diff == 0L -> "امروز"
            diff == 1L -> "فردا"
            diff == -1L -> "دیروز"
            diff == 2L -> "پس‌فردا"
            diff > 0 -> "${num(diff)} روز دیگر"
            else -> "${num(-diff)} روز پیش"
        }
    }

    /** تاریخ خوانا همراه با برچسب نسبی برای فاصله‌های نزدیک. */
    fun friendlyDate(d: LocalDate, today: LocalDate = LocalDate.now()): String {
        val diff = abs(ChronoUnit.DAYS.between(today, d))
        return if (diff <= 2) "${relativeDay(d, today)}، ${dayMonth(d)}" else date(d)
    }

    /** سن بر اساس تاریخ تولد. */
    fun age(birth: LocalDate, today: LocalDate = LocalDate.now()): String {
        if (birth.isAfter(today)) return "هنوز متولد نشده"
        val months = ChronoUnit.MONTHS.between(birth, today)
        val years = months / 12
        val rem = months % 12
        return when {
            years > 0 && rem > 0 -> "${num(years)} سال و ${num(rem)} ماه"
            years > 0 -> "${num(years)} سال"
            months > 0 -> "${num(months)} ماه"
            else -> {
                val days = ChronoUnit.DAYS.between(birth, today)
                if (days == 0L) "امروز به دنیا آمده" else "${num(days)} روز"
            }
        }
    }
}
