package ir.panjeh.petcare.ui.screens

import android.content.Context
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import ir.panjeh.petcare.Graph
import ir.panjeh.petcare.R
import ir.panjeh.petcare.core.Async
import ir.panjeh.petcare.ui.components.ButtonKind
import ir.panjeh.petcare.ui.components.MATCH
import ir.panjeh.petcare.ui.components.WRAP
import ir.panjeh.petcare.ui.components.add
import ir.panjeh.petcare.ui.components.button
import ir.panjeh.petcare.ui.components.dp
import ir.panjeh.petcare.ui.components.horizontal
import ir.panjeh.petcare.ui.components.iconView
import ir.panjeh.petcare.ui.components.oval
import ir.panjeh.petcare.ui.components.rounded
import ir.panjeh.petcare.ui.components.text
import ir.panjeh.petcare.ui.components.vertical
import ir.panjeh.petcare.ui.nav.Host
import ir.panjeh.petcare.ui.nav.Route
import ir.panjeh.petcare.ui.nav.Screen
import ir.panjeh.petcare.ui.theme.TextStyle
import ir.panjeh.petcare.ui.theme.Theme
import kotlin.math.abs

/** نشان برند: پنجه سفید روی مربع گرد سبز */
fun brandMark(ctx: Context, sizeDp: Int): FrameLayout = FrameLayout(ctx).apply {
    background = rounded(ctx, 0xFF3E9B6E.toInt(), sizeDp * 28 / 100)
    elevation = ctx.dp(3f)
    addView(ImageView(ctx).apply { setImageResource(R.drawable.ic_launcher_foreground) }, FrameLayout.LayoutParams(ctx.dp(sizeDp * 3 / 2), ctx.dp(sizeDp * 3 / 2), Gravity.CENTER))
    clipToOutline = true
    outlineProvider = android.view.ViewOutlineProvider.BACKGROUND
}

/** ترکیب تصویری: دایره ملایم + تصویرسازی حیوانات + نشان قابلیت */
fun heroIllustration(ctx: Context, featureIcon: Int?, left: Int, right: Int, heightDp: Int = 240): FrameLayout = FrameLayout(ctx).apply {
    val circle = View(ctx).apply { background = oval(Theme.c.primaryContainer) }
    addView(circle, FrameLayout.LayoutParams(ctx.dp(heightDp - 20), ctx.dp(heightDp - 20), Gravity.CENTER))
    val small = View(ctx).apply { background = oval(if (Theme.c.isDark) Theme.c.surfaceVariant else 0xFFFCEFDF.toInt()) }
    addView(small, FrameLayout.LayoutParams(ctx.dp(54), ctx.dp(54), Gravity.BOTTOM or Gravity.START).apply { setMargins(ctx.dp(36), 0, ctx.dp(36), ctx.dp(18)) })
    val row = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER
        layoutDirection = View.LAYOUT_DIRECTION_LTR
    }
    row.addView(ImageView(ctx).apply { setImageResource(left) }, LinearLayout.LayoutParams(ctx.dp(120), ctx.dp(120)).apply { marginEnd = -ctx.dp(18) })
    row.addView(ImageView(ctx).apply { setImageResource(right) }, LinearLayout.LayoutParams(ctx.dp(110), ctx.dp(110)).apply { topMargin = ctx.dp(26) })
    addView(row, FrameLayout.LayoutParams(WRAP, WRAP, Gravity.CENTER))
    if (featureIcon != null) {
        val badge = FrameLayout(ctx).apply {
            background = rounded(ctx, Theme.c.surface, 20)
            elevation = ctx.dp(4f)
            addView(iconView(ctx, featureIcon, Theme.c.primary, 30), FrameLayout.LayoutParams(ctx.dp(30), ctx.dp(30), Gravity.CENTER))
        }
        addView(badge, FrameLayout.LayoutParams(ctx.dp(64), ctx.dp(64), Gravity.TOP or Gravity.END).apply { setMargins(ctx.dp(40), ctx.dp(10), ctx.dp(40), 0) })
    }
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
}

/** صفحه شروع */
class WelcomeScreen(host: Host, route: Route) : Screen(host, route) {
    override fun build(): View {
        val col = vertical(ctx).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            setPaddingRelative(dp(24), dp(28), dp(24), dp(24))
        }
        col.add(brandMark(ctx, 64), w = ctx.dp(64), h = ctx.dp(64), gravity = Gravity.CENTER_HORIZONTAL)
        col.add(text(ctx, ctx.getString(R.string.app_name), TextStyle.Display, center = true), top = 14)
        col.add(text(ctx, ctx.getString(R.string.app_tagline), TextStyle.Body, Theme.c.textSecondary, center = true), top = 4)
        col.add(heroIllustration(ctx, R.drawable.ic_heart_pulse, R.drawable.ill_dog, R.drawable.ill_cat, 260), h = ctx.dp(260), top = 22)
        col.add(text(ctx, "همه چیز درباره سلامت حیوان خانگی‌تان، یک‌جا", TextStyle.Headline, center = true), top = 18)
        col.add(
            text(
                ctx, "واکسن‌ها، داروها، مراجعات دامپزشکی، وزن و مدارک را ثبت کنید و به‌موقع یادآوری بگیرید.",
                TextStyle.Body, Theme.c.textSecondary, center = true,
            ),
            top = 8,
        )
        val spacer = View(ctx)
        col.add(spacer, h = 0, weight = 1f, top = 16)
        col.add(button(ctx, "شروع کنیم", ButtonKind.PRIMARY) { host.replace(Route.of(Screens.ONBOARDING)) }, top = 16)
        col.add(
            button(ctx, "قبلاً از برنامه استفاده کرده‌ام", ButtonKind.OUTLINE, R.drawable.ic_upload) {
                host.push(Route.of(Screens.BACKUP, "mode" to "restore"))
            },
            top = 10,
        )
        val note = horizontal(ctx).apply { gravity = Gravity.CENTER }
        note.add(iconView(ctx, R.drawable.ic_lock, Theme.c.textTertiary, 14), w = ctx.dp(14), h = ctx.dp(14), end = 6)
        note.add(text(ctx, "بدون نیاز به حساب کاربری؛ اطلاعات فقط روی همین گوشی ذخیره می‌شود.", TextStyle.Caption, Theme.c.textTertiary), w = WRAP)
        col.add(note, top = 14)
        return ScrollView(ctx).apply {
            isFillViewport = true
            addView(col, FrameLayout.LayoutParams(MATCH, MATCH))
        }
    }

    override fun onShown() {
        // اگر کاربر از مسیر بازیابی برگشته و اطلاعات بازیابی شده باشد، به خانه می‌رود
        if (Graph.prefs.onboardingDone) host.replace(Route.of(Screens.HOME))
    }
}

/** معرفی کوتاه سه‌مرحله‌ای */
class OnboardingScreen(host: Host, route: Route) : Screen(host, route) {
    private data class Page(val icon: Int, val left: Int, val right: Int, val title: String, val body: String)

    private val pages = listOf(
        Page(
            R.drawable.ic_heart_pulse, R.drawable.ill_dog, R.drawable.ill_rabbit,
            "مدیریت سلامت در یک نگاه",
            "برای هر حیوان یک پروفایل کامل بسازید و وزن، سوابق درمان و مراجعات دامپزشکی را منظم نگه دارید.",
        ),
        Page(
            R.drawable.ic_bell, R.drawable.ill_cat, R.drawable.ill_bird,
            "یادآور واکسن و دارو",
            "زمان واکسن و نوبت‌های دارو را همان‌طور که دامپزشک تعیین کرده ثبت کنید تا به‌موقع اعلان بگیرید.",
        ),
        Page(
            R.drawable.ic_file, R.drawable.ill_rabbit, R.drawable.ill_dog,
            "سوابق و مدارک همیشه همراه شما",
            "گواهی واکسن، نسخه‌ها و نتایج آزمایش را ذخیره کنید و از همه اطلاعات نسخه پشتیبان رمزدار بگیرید.",
        ),
    )
    private var index = 0
    private lateinit var pageHost: FrameLayout
    private lateinit var dots: LinearLayout
    private lateinit var nextBtn: android.widget.TextView

    override fun build(): View {
        val root = vertical(ctx).apply { setPaddingRelative(dp(24), dp(8), dp(24), dp(24)) }
        val top = horizontal(ctx)
        top.add(brandMark(ctx, 36), w = ctx.dp(36), h = ctx.dp(36))
        top.add(View(ctx), w = 0, weight = 1f)
        top.add(button(ctx, "رد کردن", ButtonKind.TEXT, compact = true) { finish() }, w = WRAP)
        root.add(top, top = 8)
        pageHost = FrameLayout(ctx)
        root.add(pageHost, h = 0, weight = 1f)
        dots = horizontal(ctx).apply { gravity = Gravity.CENTER }
        root.add(dots, top = 8)
        nextBtn = button(ctx, "بعدی", ButtonKind.PRIMARY) { next() }
        root.add(nextBtn, top = 20)

        val detector = GestureDetector(ctx, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent) = true
            override fun onFling(e1: MotionEvent?, e2: MotionEvent, vx: Float, vy: Float): Boolean {
                if (abs(vx) < abs(vy) || abs(vx) < 600) return false
                // در راست‌به‌چپ، کشیدن به راست = صفحه بعد
                if (vx > 0) next() else prev()
                return true
            }
        })
        pageHost.setOnTouchListener { _, ev -> detector.onTouchEvent(ev) }
        render(false)
        return root
    }

    private fun render(animate: Boolean) {
        val p = pages[index]
        val col = vertical(ctx).apply { gravity = Gravity.CENTER }
        col.add(heroIllustration(ctx, p.icon, p.left, p.right, 250), h = ctx.dp(250))
        col.add(text(ctx, p.title, TextStyle.Headline, center = true), top = 28)
        col.add(text(ctx, p.body, TextStyle.Body, Theme.c.textSecondary, center = true), top = 10)
        col.contentDescription = "${p.title}. ${p.body}"
        pageHost.removeAllViews()
        pageHost.addView(col, FrameLayout.LayoutParams(MATCH, MATCH))
        if (animate) {
            col.alpha = 0f
            col.animate().alpha(1f).setDuration(220).start()
        }
        dots.removeAllViews()
        pages.indices.forEach { i ->
            val active = i == index
            dots.add(
                View(ctx).apply { background = rounded(ctx, if (active) Theme.c.primary else Theme.c.outline, 4) },
                w = ctx.dp(if (active) 22 else 8), h = ctx.dp(8), start = 3, end = 3,
            )
        }
        nextBtn.text = if (index == pages.size - 1) "شروع استفاده" else "بعدی"
    }

    private fun next() {
        if (index < pages.size - 1) {
            index++
            render(true)
        } else {
            finish()
        }
    }

    private fun prev() {
        if (index > 0) {
            index--
            render(true)
        }
    }

    override fun onBack(): Boolean {
        if (index > 0) {
            prev()
            return true
        }
        return false
    }

    private fun finish() {
        Async.run({
            Graph.prefs.onboardingDone = true
            Graph.repo.petCount()
        }) { count ->
            if (count == 0) host.replace(Route.of(Screens.PET_EDIT, "first" to true))
            else host.replace(Route.of(Screens.HOME))
        }
    }
}
