package ir.panjeh.petcare.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.LocalTime

class FaTest {
    @Test
    fun persianDigits() {
        assertEquals("۱۲۳۴۵۶۷۸۹۰", Fa.num(1234567890L))
        assertEquals("۴٫۲", Fa.decimal(4.2))
        assertEquals("۱۲۰٬۰۰۰ تومان", Fa.toman(120_000))
    }

    @Test
    fun parsesPersianArabicAndLatinDigits() {
        assertEquals(4.25, Fa.parseDecimal("۴٫۲۵")!!, 1e-9)
        assertEquals(4.25, Fa.parseDecimal("٤.٢٥")!!, 1e-9)
        assertEquals(12.5, Fa.parseDecimal("12/5")!!, 1e-9)
        assertEquals(1500L, Fa.parseLong("۱٬۵۰۰"))
        assertNull(Fa.parseDecimal("abc"))
        assertNull(Fa.parseDecimal(""))
    }

    @Test
    fun weightUnits() {
        assertEquals("۸۵ گرم", Fa.weight(85.0))
        assertEquals("۴٫۲ کیلوگرم", Fa.weight(4200.0))
        assertEquals("۱۲٫۳۵ کیلوگرم", Fa.weight(12345.0))
        assertEquals("+۲۰۰ گرم", Fa.weightDelta(200.0))
    }

    @Test
    fun timeIs24h() {
        assertEquals("۰۸:۰۵", Fa.time(LocalTime.of(8, 5)))
        assertEquals("۲۱:۳۰", Fa.time(LocalTime.of(21, 30)))
    }

    @Test
    fun dateStyles() {
        val d = LocalDate.of(2026, 10, 14)
        Fa.dateStyle = Fa.DateStyle.LONG
        assertEquals("۲۲ مهر ۱۴۰۵", Fa.date(d))
        assertEquals("سه\u200cشنبه، ۲۱ مهر ۱۴۰۵", Fa.date(LocalDate.of(2026, 10, 13), true))
        Fa.dateStyle = Fa.DateStyle.NUMERIC
        assertEquals("۱۴۰۵/۰۷/۲۲", Fa.date(d))
        Fa.dateStyle = Fa.DateStyle.LONG
    }

    @Test
    fun relativeAndAge() {
        val today = LocalDate.of(2026, 10, 14)
        assertEquals("امروز", Fa.relativeDay(today, today))
        assertEquals("فردا", Fa.relativeDay(today.plusDays(1), today))
        assertEquals("۵ روز دیگر", Fa.relativeDay(today.plusDays(5), today))
        assertEquals("۳ روز پیش", Fa.relativeDay(today.minusDays(3), today))
        assertEquals("۲ سال و ۳ ماه", Fa.age(LocalDate.of(2024, 7, 1), today))
        assertEquals("۵ ماه", Fa.age(LocalDate.of(2026, 5, 10), today))
    }
}
