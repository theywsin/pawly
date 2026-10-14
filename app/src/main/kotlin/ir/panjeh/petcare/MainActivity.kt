package ir.panjeh.petcare

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.accessibility.AccessibilityEvent
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import ir.panjeh.petcare.data.Prefs
import ir.panjeh.petcare.reminders.ReminderScheduler
import ir.panjeh.petcare.ui.components.BottomNav
import ir.panjeh.petcare.ui.components.MATCH
import ir.panjeh.petcare.ui.components.Tone
import ir.panjeh.petcare.ui.components.WRAP
import ir.panjeh.petcare.ui.components.dp
import ir.panjeh.petcare.ui.components.horizontal
import ir.panjeh.petcare.ui.components.iconView
import ir.panjeh.petcare.ui.components.rounded
import ir.panjeh.petcare.ui.components.text
import ir.panjeh.petcare.ui.nav.Host
import ir.panjeh.petcare.ui.nav.Route
import ir.panjeh.petcare.ui.nav.Screen
import ir.panjeh.petcare.ui.nav.Tab
import ir.panjeh.petcare.ui.screens.Screens
import ir.panjeh.petcare.ui.theme.TextStyle
import ir.panjeh.petcare.ui.theme.Theme
import java.util.Locale

/**
 * تنها Activity برنامه. ناوبری بین صفحه‌ها با یک پشته سبک از [Screen]ها انجام می‌شود
 * که مسیرهای آن در صورت توقف برنامه توسط سیستم ذخیره و بازیابی می‌شوند.
 */
class MainActivity : Activity(), Host {

    override val context: Context get() = this

    private val stack = ArrayList<Screen>()
    private lateinit var container: FrameLayout
    private lateinit var bottomNav: BottomNav
    private lateinit var toastHost: FrameLayout
    private var imeVisible = false
    private var backCallback: Any? = null
    private val resultCallbacks = HashMap<Int, (Int, Intent?) -> Unit>()
    private val permissionCallbacks = HashMap<Int, (Boolean) -> Unit>()
    private var nextRequestCode = 100

    override fun attachBaseContext(newBase: Context) {
        Graph.init(newBase)
        super.attachBaseContext(localized(newBase, Graph.prefs.themeMode))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        setTheme(R.style.Theme_Panjeh)
        super.onCreate(savedInstanceState)
        Theme.apply(this)
        setupWindow()

        val root = FrameLayout(this).apply {
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setBackgroundColor(Theme.c.background)
        }
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        container = FrameLayout(this)
        column.addView(container, LinearLayout.LayoutParams(MATCH, 0, 1f))
        bottomNav = BottomNav(this) { switchTab(it) }
        column.addView(bottomNav.view, LinearLayout.LayoutParams(MATCH, WRAP))
        root.addView(column, FrameLayout.LayoutParams(MATCH, MATCH))
        toastHost = FrameLayout(this)
        root.addView(toastHost, FrameLayout.LayoutParams(MATCH, MATCH))
        applyInsets(root)
        setContentView(root)

        val saved = savedInstanceState?.getParcelableArrayList<Bundle>(STATE_STACK)
        if (!saved.isNullOrEmpty()) {
            saved.forEach { b -> stack += Screens.create(this, Route(b.getString("name")!!, b.getBundle("args") ?: Bundle())) }
            show(animate = false)
        } else {
            val start = if (Graph.prefs.onboardingDone) Route.of(Screens.HOME) else Route.of(Screens.WELCOME)
            stack += Screens.create(this, start)
            show(animate = false)
            handleOpenIntent(intent)
        }
        registerBack()
        ReminderScheduler.syncAsync(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleOpenIntent(intent)
    }

    private fun handleOpenIntent(intent: Intent?) {
        if (!Graph.prefs.onboardingDone) return
        when (intent?.getStringExtra(EXTRA_OPEN)) {
            "reminders" -> switchTab(Tab.REMINDERS)
            "health" -> switchTab(Tab.HEALTH)
        }
    }

    override fun onResume() {
        super.onResume()
        stack.lastOrNull()?.onShown()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        val list = ArrayList<Bundle>()
        stack.forEach { s -> list += Bundle().apply { putString("name", s.route.name); putBundle("args", s.route.args) } }
        outState.putParcelableArrayList(STATE_STACK, list)
    }

    override fun onDestroy() {
        stack.forEach { it.onDestroy() }
        super.onDestroy()
    }

    // ------------------------------------------------------------------ پنجره و حاشیه‌های سیستم
    @Suppress("DEPRECATION")
    private fun setupWindow() {
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
        } else {
            var flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            if (!Theme.c.isDark) flags = flags or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            window.decorView.systemUiVisibility = flags
        }
        window.statusBarColor = android.graphics.Color.TRANSPARENT
        window.navigationBarColor = android.graphics.Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= 29) window.isNavigationBarContrastEnforced = false
    }

    @Suppress("DEPRECATION")
    private fun applyInsets(root: View) {
        root.setOnApplyWindowInsetsListener { v, insets ->
            val top: Int
            val bottom: Int
            val left: Int
            val right: Int
            val ime: Int
            if (Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                ime = insets.getInsets(WindowInsets.Type.ime()).bottom
                top = bars.top; bottom = bars.bottom; left = bars.left; right = bars.right
            } else {
                top = insets.systemWindowInsetTop
                left = insets.systemWindowInsetLeft
                right = insets.systemWindowInsetRight
                val sys = insets.systemWindowInsetBottom
                // در نسخه‌های قدیمی، ارتفاع صفحه‌کلید در حاشیه پایین گنجانده می‌شود
                ime = if (sys > dp(100)) sys else 0
                bottom = if (ime > 0) 0 else sys
            }
            imeVisible = ime > 0
            v.setPadding(left, top, right, maxOf(bottom, ime))
            updateBottomNav()
            if (Build.VERSION.SDK_INT >= 30) WindowInsets.CONSUMED else insets.consumeSystemWindowInsets()
        }
    }

    // ------------------------------------------------------------------ ناوبری
    private fun show(animate: Boolean, forward: Boolean = true) {
        val top = stack.last()
        val v = top.view()
        (v.parent as? FrameLayout)?.removeView(v)
        val old = if (container.childCount > 0) container.getChildAt(0) else null
        container.addView(v, FrameLayout.LayoutParams(MATCH, MATCH))
        if (old != null) {
            if (animate) {
                old.animate().alpha(0f).setDuration(120).withEndAction { container.removeView(old); old.alpha = 1f }.start()
            } else {
                container.removeView(old)
            }
        }
        if (animate) {
            // در راست‌به‌چپ، صفحه جدید از سمت چپ وارد می‌شود
            v.alpha = 0f
            v.translationX = dp(if (forward) -24 else 24).toFloat()
            v.animate().alpha(1f).translationX(0f).setDuration(200).start()
        }
        updateBottomNav()
        top.onShown()
        updateBackCallback()
        v.sendAccessibilityEvent(AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED)
    }

    private fun updateBottomNav() {
        val top = stack.lastOrNull() ?: return
        bottomNav.view.visibility = if (top.showsBottomNav && !imeVisible) View.VISIBLE else View.GONE
        bottomNav.select(top.tab)
    }

    override fun push(route: Route) {
        stack += Screens.create(this, route)
        show(animate = true)
    }

    override fun replace(route: Route) {
        stack.removeAt(stack.size - 1).onDestroy()
        stack += Screens.create(this, route)
        show(animate = true)
    }

    override fun pop() {
        if (stack.size <= 1) {
            finish()
            return
        }
        stack.removeAt(stack.size - 1).onDestroy()
        show(animate = true, forward = false)
    }

    override fun popTo(name: String) {
        while (stack.size > 1 && stack.last().route.name != name) stack.removeAt(stack.size - 1).onDestroy()
        show(animate = true, forward = false)
    }

    override fun switchTab(tab: Tab) {
        val name = Screens.rootOf(tab)
        if (stack.size == 1 && stack[0].route.name == name) {
            stack[0].onShown()
            return
        }
        stack.forEach { it.onDestroy() }
        stack.clear()
        stack += Screens.create(this, Route.of(name))
        show(animate = false)
    }

    private fun handleBack() {
        val top = stack.lastOrNull() ?: return finish()
        if (top.onBack()) return
        if (stack.size > 1) {
            pop()
        } else if (top.tab != null && top.tab != Tab.HOME) {
            switchTab(Tab.HOME)
        } else {
            finish()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        handleBack()
    }

    private fun registerBack() {
        if (Build.VERSION.SDK_INT >= 33) {
            val cb = OnBackInvokedCallback { handleBack() }
            backCallback = cb
            updateBackCallback()
        }
    }

    /** در اندروید ۱۳+ فقط وقتی بازگشت درون برنامه معنا دارد، رهگیری می‌شود (پشتیبانی از بازگشت پیش‌بین) */
    private fun updateBackCallback() {
        if (Build.VERSION.SDK_INT < 33) return
        val cb = backCallback as? OnBackInvokedCallback ?: return
        val top = stack.lastOrNull()
        val intercept = stack.size > 1 || (top?.tab != null && top.tab != Tab.HOME) || top?.route?.name == Screens.ONBOARDING
        onBackInvokedDispatcher.unregisterOnBackInvokedCallback(cb)
        if (intercept) onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, cb)
    }

    // ------------------------------------------------------------------ پیام کوتاه
    override fun toast(message: String, tone: Tone) {
        toastHost.removeAllViews()
        val bar = horizontal(this).apply {
            background = rounded(this@MainActivity, if (Theme.c.isDark) Theme.c.surfaceVariant else 0xFF22302A.toInt(), 16)
            setPaddingRelative(dp(16), dp(14), dp(16), dp(14))
            elevation = dp(6).toFloat()
            val icon = when (tone) {
                Tone.ERROR -> R.drawable.ic_alert
                Tone.WARNING -> R.drawable.ic_info
                else -> R.drawable.ic_check_circle
            }
            val tint = when (tone) {
                Tone.ERROR -> 0xFFF4A49D.toInt()
                Tone.WARNING -> 0xFFF6C08A.toInt()
                else -> 0xFF8FD9B1.toInt()
            }
            addView(iconView(this@MainActivity, icon, tint, 20), LinearLayout.LayoutParams(dp(20), dp(20)).apply { marginEnd = dp(10) })
            addView(text(this@MainActivity, message, TextStyle.BodyMedium, 0xFFF4F6F4.toInt()), LinearLayout.LayoutParams(0, WRAP, 1f))
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        val navShown = bottomNav.view.visibility == View.VISIBLE
        val lp = FrameLayout.LayoutParams(MATCH, WRAP, Gravity.BOTTOM).apply {
            setMargins(dp(16), 0, dp(16), dp(if (navShown) 92 else 20))
        }
        toastHost.addView(bar, lp)
        bar.alpha = 0f
        bar.translationY = dp(12).toFloat()
        bar.animate().alpha(1f).translationY(0f).setDuration(180).start()
        bar.announceForAccessibility(message)
        bar.postDelayed({
            bar.animate().alpha(0f).setDuration(200).withEndAction { toastHost.removeView(bar) }.start()
        }, if (tone == Tone.ERROR) 4000 else 2600)
    }

    // ------------------------------------------------------------------ نتایج و مجوزها
    override fun startForResult(intent: Intent, onResult: (Int, Intent?) -> Unit): Boolean {
        val code = nextRequestCode++
        return try {
            resultCallbacks[code] = onResult
            startActivityForResult(intent, code)
            true
        } catch (e: android.content.ActivityNotFoundException) {
            resultCallbacks.remove(code)
            false
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        resultCallbacks.remove(requestCode)?.invoke(resultCode, data)
    }

    override fun requestPermission(permission: String, onResult: (Boolean) -> Unit) {
        if (checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) {
            onResult(true)
            return
        }
        val code = nextRequestCode++
        permissionCallbacks[code] = onResult
        requestPermissions(arrayOf(permission), code)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        permissionCallbacks.remove(requestCode)?.invoke(grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED)
    }

    override fun recreateForTheme() {
        recreate()
    }

    override fun dataChanged() {
        ReminderScheduler.syncAsync(this)
    }

    companion object {
        const val EXTRA_OPEN = "open"
        private const val STATE_STACK = "stack"

        /** زبان رابط همیشه فارسی است و حالت روشن/تیره از تنظیمات اعمال می‌شود. */
        fun localized(base: Context, mode: Prefs.ThemeMode): Context {
            val locale = Locale("fa", "IR")
            Locale.setDefault(locale)
            val config = Configuration(base.resources.configuration)
            config.setLocale(locale)
            config.setLayoutDirection(locale)
            val night = when (mode) {
                Prefs.ThemeMode.SYSTEM -> config.uiMode and Configuration.UI_MODE_NIGHT_MASK
                Prefs.ThemeMode.LIGHT -> Configuration.UI_MODE_NIGHT_NO
                Prefs.ThemeMode.DARK -> Configuration.UI_MODE_NIGHT_YES
            }
            config.uiMode = (config.uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or night
            return base.createConfigurationContext(config)
        }
    }
}
