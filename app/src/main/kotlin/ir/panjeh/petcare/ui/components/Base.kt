package ir.panjeh.petcare.ui.components

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import ir.panjeh.petcare.ui.theme.Theme
import kotlin.math.roundToInt

const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT

fun Context.dp(v: Int): Int = (v * resources.displayMetrics.density).roundToInt()
fun Context.dp(v: Float): Float = v * resources.displayMetrics.density
fun View.dp(v: Int): Int = context.dp(v)
fun View.dp(v: Float): Float = context.dp(v)

fun withAlpha(color: Int, alpha: Float): Int =
    Color.argb((Color.alpha(color) * alpha).roundToInt(), Color.red(color), Color.green(color), Color.blue(color))

/** پس‌زمینه گرد با رنگ و حاشیه اختیاری */
fun rounded(ctx: Context, color: Int, radiusDp: Int, strokeColor: Int? = null, strokeDp: Int = 1): GradientDrawable =
    GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = ctx.dp(radiusDp.toFloat())
        setColor(color)
        if (strokeColor != null) setStroke(ctx.dp(strokeDp), strokeColor)
    }

fun oval(color: Int): GradientDrawable = GradientDrawable().apply {
    shape = GradientDrawable.OVAL
    setColor(color)
}

/** افکت لمسی موجی با ماسک گرد */
fun ripple(ctx: Context, content: Drawable?, radiusDp: Int, rippleColor: Int = withAlpha(Theme.c.primary, 0.16f)): RippleDrawable {
    val mask = rounded(ctx, Color.WHITE, radiusDp)
    return RippleDrawable(ColorStateList.valueOf(rippleColor), content, mask)
}

fun View.clickable(radiusDp: Int, onClick: () -> Unit) {
    isClickable = true
    isFocusable = true
    foreground = ripple(context, null, radiusDp)
    setOnClickListener { onClick() }
}

fun View.padding(h: Int, v: Int) = setPaddingRelative(dp(h), dp(v), dp(h), dp(v))
fun View.padding(all: Int) = setPaddingRelative(dp(all), dp(all), dp(all), dp(all))

fun linLp(w: Int = MATCH, h: Int = WRAP, weight: Float = 0f, top: Int = 0, bottom: Int = 0, start: Int = 0, end: Int = 0, ctx: Context): LinearLayout.LayoutParams =
    LinearLayout.LayoutParams(w, h, weight).apply {
        topMargin = ctx.dp(top)
        bottomMargin = ctx.dp(bottom)
        marginStart = ctx.dp(start)
        marginEnd = ctx.dp(end)
    }

fun LinearLayout.add(
    v: View,
    w: Int = MATCH,
    h: Int = WRAP,
    weight: Float = 0f,
    top: Int = 0,
    bottom: Int = 0,
    start: Int = 0,
    end: Int = 0,
    gravity: Int = -1,
): View {
    val lp = linLp(w, h, weight, top, bottom, start, end, context)
    if (gravity != -1) lp.gravity = gravity
    addView(v, lp)
    return v
}

fun FrameLayout.addFrame(v: View, w: Int = MATCH, h: Int = WRAP, gravity: Int = -1, margin: Int = 0): View {
    val lp = FrameLayout.LayoutParams(w, h)
    if (gravity != -1) lp.gravity = gravity
    lp.setMargins(dp(margin), dp(margin), dp(margin), dp(margin))
    addView(v, lp)
    return v
}

fun vertical(ctx: Context): LinearLayout = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
fun horizontal(ctx: Context, centerVertical: Boolean = true): LinearLayout = LinearLayout(ctx).apply {
    orientation = LinearLayout.HORIZONTAL
    if (centerVertical) gravity = android.view.Gravity.CENTER_VERTICAL
}

fun spacer(ctx: Context, hDp: Int): View = View(ctx).apply { layoutParams = LinearLayout.LayoutParams(1, ctx.dp(hDp)) }

/** فضای پرکننده در ردیف افقی */
fun LinearLayout.fill(): View = View(context).also { addView(it, LinearLayout.LayoutParams(0, 1, 1f)) }

/** رنگ‌مایه‌های معنایی برای برچسب‌ها و نشان‌ها */
enum class Tone {
    PRIMARY, WARNING, ERROR, SUCCESS, INFO, NEUTRAL;

    val fg: Int
        get() = when (this) {
            PRIMARY -> Theme.c.onPrimaryContainer
            WARNING -> Theme.c.warning
            ERROR -> Theme.c.error
            SUCCESS -> Theme.c.success
            INFO -> Theme.c.info
            NEUTRAL -> Theme.c.textSecondary
        }
    val bg: Int
        get() = when (this) {
            PRIMARY -> Theme.c.primaryContainer
            WARNING -> Theme.c.warningContainer
            ERROR -> Theme.c.errorContainer
            SUCCESS -> Theme.c.successContainer
            INFO -> Theme.c.infoContainer
            NEUTRAL -> Theme.c.surfaceVariant
        }
    val icon: Int
        get() = when (this) {
            PRIMARY -> Theme.c.primary
            else -> fg
        }
}
