package ir.panjeh.petcare

import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import ir.panjeh.petcare.core.Async
import ir.panjeh.petcare.core.Fa
import ir.panjeh.petcare.data.Pet
import ir.panjeh.petcare.data.Sex
import ir.panjeh.petcare.data.Species
import org.robolectric.RuntimeEnvironment
import org.robolectric.shadows.ShadowLooper
import java.time.LocalDate
import java.time.LocalTime
import java.util.TimeZone

/** آماده‌سازی محیط تست: پایگاه داده تازه، اجرای هم‌زمان کارهای پس‌زمینه و منطقه زمانی تهران */
object TestEnv {
    fun reset() {
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Tehran"))
        Async.synchronous = true
        Graph.resetForTests()
        Graph.init(RuntimeEnvironment.getApplication())
        Graph.prefs.clear()
        Fa.dateStyle = Fa.DateStyle.LONG
    }

    fun samplePet(name: String = "پیشی", species: Species = Species.CAT) = Pet(
        name = name, species = species, breed = "پرشین", sex = Sex.FEMALE, birthDate = LocalDate.now().minusMonths(27),
    )

    fun at(daysFromToday: Long, h: Int, m: Int = 0) = Fa.millisOf(LocalDate.now().plusDays(daysFromToday), LocalTime.of(h, m))
}

fun idle() = ShadowLooper.idleMainLooper()

fun View.allViews(): List<View> {
    val out = ArrayList<View>()
    fun walk(v: View) {
        if (v.visibility != View.VISIBLE) return
        out += v
        if (v is ViewGroup) for (i in 0 until v.childCount) walk(v.getChildAt(i))
    }
    walk(this)
    return out
}

fun View.texts(): List<String> = allViews().filterIsInstance<TextView>().map { it.text.toString() }.filter { it.isNotBlank() }

/** یافتن نمای قابل‌کلیک حاوی متن دقیق و کلیک روی آن */
fun View.clickText(text: String) {
    val tv = allViews().filterIsInstance<TextView>().firstOrNull { it.text.toString() == text }
        ?: error("متن پیدا نشد: $text\nموجود: ${texts()}")
    var v: View? = tv
    while (v != null && !v.isClickable) v = v.parent as? View
    (v ?: error("نمای قابل‌کلیک پیدا نشد: $text")).performClick()
    idle()
}

fun View.hasText(text: String) = texts().any { it.contains(text) }
