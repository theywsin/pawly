package ir.panjeh.petcare.ui.nav

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.FrameLayout
import ir.panjeh.petcare.ui.components.Tone

/** زبانه‌های نوار پیمایش پایین */
enum class Tab(val label: String) {
    HOME("خانه"), PETS("حیوانات من"), HEALTH("سلامت"), REMINDERS("یادآورها"), SETTINGS("تنظیمات")
}

/**
 * مسیر قابل ذخیره هر صفحه. برای بازسازی پشته صفحات پس از توقف برنامه توسط سیستم استفاده می‌شود.
 */
data class Route(val name: String, val args: Bundle = Bundle()) {
    fun long(key: String): Long = args.getLong(key, 0L)
    fun longOrNull(key: String): Long? = if (args.containsKey(key)) args.getLong(key) else null
    fun string(key: String): String? = args.getString(key)

    companion object {
        fun of(name: String, vararg pairs: Pair<String, Any?>): Route {
            val b = Bundle()
            for ((k, v) in pairs) when (v) {
                is Long -> b.putLong(k, v)
                is Int -> b.putInt(k, v)
                is String -> b.putString(k, v)
                is Boolean -> b.putBoolean(k, v)
                null -> {}
                else -> error("unsupported arg")
            }
            return Route(name, b)
        }
    }
}

/** امکاناتی که صفحه‌ها از میزبان (Activity) دریافت می‌کنند */
interface Host {
    val context: android.content.Context
    fun push(route: Route)
    fun replace(route: Route)
    fun pop()
    fun popTo(name: String)
    fun switchTab(tab: Tab)
    fun toast(message: String, tone: Tone = Tone.SUCCESS)
    fun startForResult(intent: Intent, onResult: (resultCode: Int, data: Intent?) -> Unit): Boolean
    fun requestPermission(permission: String, onResult: (Boolean) -> Unit)
    fun recreateForTheme()
    /** پس از تغییر داده‌ها: زمان‌بندی یادآورها دوباره محاسبه شود */
    fun dataChanged()
}

/**
 * پایه همه صفحه‌ها. هر صفحه یک View می‌سازد و هنگام نمایش مجدد داده‌های خود را تازه می‌کند.
 */
abstract class Screen(val host: Host, val route: Route) {
    val ctx get() = host.context
    open val tab: Tab? = null
    /** آیا نوار پیمایش پایین در این صفحه نمایش داده شود؟ */
    open val showsBottomNav: Boolean get() = tab != null

    var alive = true
        private set

    private var root: FrameLayout? = null

    fun view(): View {
        root?.let { return it }
        val r = FrameLayout(ctx)
        r.addView(build(), FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        root = r
        return r
    }

    /** ساخت رابط صفحه */
    protected abstract fun build(): View

    /** هر بار که صفحه دوباره در بالای پشته قرار می‌گیرد */
    open fun onShown() {}

    /** true یعنی بازگشت توسط خود صفحه مدیریت شد */
    open fun onBack(): Boolean = false

    open fun onDestroy() {
        alive = false
    }

    /** اجرای کار پس‌زمینه با تحویل نتیجه فقط تا زمانی که صفحه زنده است */
    protected fun <T> load(work: () -> T, onError: (Throwable) -> Unit = { host.toast("خطا در خواندن اطلاعات", Tone.ERROR) }, onResult: (T) -> Unit) {
        ir.panjeh.petcare.core.Async.run(work, alive = { alive }, onError = onError, onResult = onResult)
    }

    /** ذخیره با پیام موفقیت/شکست یکسان */
    protected fun save(work: () -> Unit, success: String, then: () -> Unit = { host.pop() }) {
        ir.panjeh.petcare.core.Async.run(
            work,
            alive = { true },
            onError = { host.toast("ذخیره انجام نشد. دوباره تلاش کنید.", Tone.ERROR) },
        ) {
            host.dataChanged()
            host.toast(success)
            if (alive) then()
        }
    }
}
