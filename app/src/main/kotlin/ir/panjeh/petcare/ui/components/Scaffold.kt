package ir.panjeh.petcare.ui.components

import android.content.Context
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import ir.panjeh.petcare.R
import ir.panjeh.petcare.ui.nav.Tab
import ir.panjeh.petcare.ui.theme.Dimens
import ir.panjeh.petcare.ui.theme.TextStyle
import ir.panjeh.petcare.ui.theme.Theme

/** سربرگ صفحه: دکمه بازگشت (سمت راست در چیدمان راست‌به‌چپ)، عنوان و اقدامات */
fun topBar(ctx: Context, title: String, onBack: (() -> Unit)?, actions: List<View> = emptyList(), subtitle: String? = null): LinearLayout =
    horizontal(ctx).apply {
        minimumHeight = dp(64)
        setPaddingRelative(dp(if (onBack != null) 6 else Dimens.screenPadding), dp(6), dp(8), dp(6))
        if (onBack != null) add(iconButton(ctx, R.drawable.ic_back, "بازگشت", onClick = onBack), w = dp(48), h = dp(48), end = 4)
        val col = vertical(ctx)
        col.add(text(ctx, title, TextStyle.Title, maxLines = 1).apply { accessibilityHeading() })
        if (subtitle != null) col.add(text(ctx, subtitle, TextStyle.Caption, Theme.c.textSecondary, maxLines = 1))
        add(col, w = 0, weight = 1f)
        actions.forEach { add(it, w = dp(48), h = dp(48)) }
    }

private fun TextView.accessibilityHeading() {
    if (android.os.Build.VERSION.SDK_INT >= 28) isAccessibilityHeading = true
}

/**
 * اسکلت استاندارد صفحه: سربرگ + محتوای قابل پیمایش + نوار اقدام پایینی (اختیاری) + دکمه شناور (اختیاری).
 */
class Scaffold(
    private val ctx: Context,
    title: String,
    onBack: (() -> Unit)?,
    actions: List<View> = emptyList(),
    subtitle: String? = null,
    scrollable: Boolean = true,
) {
    val root = FrameLayout(ctx)
    private val column = vertical(ctx)
    val header: LinearLayout = topBar(ctx, title, onBack, actions, subtitle)
    val content: LinearLayout = vertical(ctx).apply {
        setPaddingRelative(dp(Dimens.screenPadding), dp(4), dp(Dimens.screenPadding), dp(28))
    }
    val scroll: ScrollView? = if (scrollable) ScrollView(ctx).apply {
        isFillViewport = true
        clipToPadding = false
        addView(content)
    } else null
    private var bottomBar: LinearLayout? = null
    private var fab: View? = null

    init {
        column.add(header)
        column.add(scroll ?: content, h = 0, weight = 1f)
        root.addView(column, FrameLayout.LayoutParams(MATCH, MATCH))
    }

    /** نوار اقدام چسبیده به پایین (بالای صفحه‌کلید) */
    fun bottomActions(vararg views: View) {
        val bar = horizontal(ctx).apply {
            setBackgroundColor(Theme.c.background)
            setPaddingRelative(dp(Dimens.screenPadding), dp(10), dp(Dimens.screenPadding), dp(14))
            elevation = 0f
        }
        views.forEachIndexed { i, v -> bar.add(v, w = 0, weight = 1f, start = if (i == 0) 0 else 10) }
        column.add(View(ctx).apply { setBackgroundColor(Theme.c.outline) }, h = 1)
        column.add(bar)
        bottomBar = bar
    }

    /** دکمه شناور «افزودن» در گوشه پایین (سمت چپ در راست‌به‌چپ) */
    fun fab(label: String, onClick: () -> Unit) {
        val b = button(ctx, label, ButtonKind.PRIMARY, R.drawable.ic_plus, onClick = onClick).apply {
            elevation = dp(4f)
            background = ripple(ctx, rounded(ctx, Theme.c.primary, 18), 18, withAlpha(Theme.c.onPrimary, 0.2f))
            minHeight = dp(54)
        }
        val lp = FrameLayout.LayoutParams(WRAP, WRAP, Gravity.BOTTOM or Gravity.END).apply {
            setMargins(ctx.dp(20), ctx.dp(20), ctx.dp(20), ctx.dp(20))
        }
        root.addView(b, lp)
        fab = b
        content.setPaddingRelative(content.paddingStart, content.paddingTop, content.paddingEnd, ctx.dp(96))
    }

    fun setBody(vararg views: View) {
        content.removeAllViews()
        views.forEach { content.add(it) }
    }
}

/** نوار پیمایش پایین صفحه با پنج زبانه */
class BottomNav(private val ctx: Context, private val onSelect: (Tab) -> Unit) {
    val view: LinearLayout = horizontal(ctx).apply {
        setBackgroundColor(Theme.c.surface)
        setPaddingRelative(dp(6), dp(6), dp(6), dp(6))
        elevation = dp(8f)
    }
    private val items = HashMap<Tab, Triple<FrameLayout, android.widget.ImageView, TextView>>()

    init {
        val icons = mapOf(
            Tab.HOME to R.drawable.ic_home, Tab.PETS to R.drawable.ic_paw, Tab.HEALTH to R.drawable.ic_heart_pulse,
            Tab.REMINDERS to R.drawable.ic_bell, Tab.SETTINGS to R.drawable.ic_settings,
        )
        Tab.entries.forEach { tab ->
            val col = vertical(ctx).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                setPaddingRelative(0, dp(4), 0, dp(4))
                contentDescription = tab.label
            }
            val pill = FrameLayout(ctx)
            val icon = iconView(ctx, icons.getValue(tab), Theme.c.textSecondary, 22)
            pill.addView(icon, FrameLayout.LayoutParams(ctx.dp(22), ctx.dp(22), Gravity.CENTER))
            col.add(pill, w = ctx.dp(60), h = ctx.dp(32))
            val label = text(ctx, tab.label, TextStyle.Overline, Theme.c.textSecondary, maxLines = 1, center = true)
            col.add(label, w = WRAP, top = 4)
            col.clickable(16) { onSelect(tab) }
            view.add(col, w = 0, weight = 1f)
            items[tab] = Triple(pill, icon, label)
        }
    }

    fun select(tab: Tab?) {
        items.forEach { (t, v) ->
            val (pill, icon, label) = v
            val active = t == tab
            pill.background = if (active) rounded(ctx, Theme.c.primaryContainer, 16) else null
            icon.imageTintList = android.content.res.ColorStateList.valueOf(if (active) Theme.c.primary else Theme.c.textSecondary)
            label.setTextColor(if (active) Theme.c.textPrimary else Theme.c.textSecondary)
            label.typeface = Theme.font(if (active) 700 else 500)
            (pill.parent as View).isSelected = active
        }
    }
}
