package ir.panjeh.petcare.ui.components

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.drawable.Drawable
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import ir.panjeh.petcare.R
import ir.panjeh.petcare.ui.theme.Dimens
import ir.panjeh.petcare.ui.theme.TextStyle
import ir.panjeh.petcare.ui.theme.Theme

// ======================================================================== متن
fun text(
    ctx: Context,
    value: CharSequence,
    style: TextStyle = TextStyle.Body,
    color: Int = Theme.c.textPrimary,
    maxLines: Int = Int.MAX_VALUE,
    center: Boolean = false,
): TextView = TextView(ctx).apply {
    Theme.style(this, style)
    setTextColor(color)
    text = value
    textDirection = View.TEXT_DIRECTION_LOCALE
    gravity = if (center) Gravity.CENTER else Gravity.START or Gravity.CENTER_VERTICAL
    if (maxLines != Int.MAX_VALUE) {
        this.maxLines = maxLines
        ellipsize = TextUtils.TruncateAt.END
    }
}

// ======================================================================== آیکون
fun iconView(ctx: Context, res: Int, tint: Int = Theme.c.textPrimary, sizeDp: Int = 24): ImageView = ImageView(ctx).apply {
    setImageResource(res)
    imageTintList = ColorStateList.valueOf(tint)
    layoutParams = LinearLayout.LayoutParams(ctx.dp(sizeDp), ctx.dp(sizeDp))
    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
}

/** آیکون داخل کادر گرد رنگی (نشان) */
fun iconBadge(ctx: Context, res: Int, tone: Tone = Tone.PRIMARY, sizeDp: Int = 44, iconDp: Int = 22, radiusDp: Int = 14): FrameLayout =
    FrameLayout(ctx).apply {
        background = rounded(ctx, tone.bg, radiusDp)
        addView(iconView(ctx, res, tone.icon, iconDp), FrameLayout.LayoutParams(ctx.dp(iconDp), ctx.dp(iconDp), Gravity.CENTER))
        layoutParams = LinearLayout.LayoutParams(ctx.dp(sizeDp), ctx.dp(sizeDp))
    }

// ======================================================================== دکمه‌ها
enum class ButtonKind { PRIMARY, TONAL, OUTLINE, TEXT, DANGER }

fun button(
    ctx: Context,
    label: String,
    kind: ButtonKind = ButtonKind.PRIMARY,
    icon: Int? = null,
    compact: Boolean = false,
    onClick: () -> Unit,
): TextView = TextView(ctx).apply {
    layoutDirection = View.LAYOUT_DIRECTION_RTL
    val c = Theme.c
    Theme.style(this, if (compact) TextStyle.Label else TextStyle.TitleSmall)
    text = label
    gravity = Gravity.CENTER
    minHeight = ctx.dp(if (compact) 40 else Dimens.buttonHeight)
    setPaddingRelative(ctx.dp(if (compact) 14 else 20), 0, ctx.dp(if (compact) 14 else 20), 0)
    val (bg, fg, stroke) = when (kind) {
        ButtonKind.PRIMARY -> Triple(c.primary, c.onPrimary, null)
        ButtonKind.TONAL -> Triple(c.primaryContainer, c.onPrimaryContainer, null)
        ButtonKind.OUTLINE -> Triple(c.surface, c.textPrimary, c.outline)
        ButtonKind.TEXT -> Triple(android.graphics.Color.TRANSPARENT, c.primary, null)
        ButtonKind.DANGER -> Triple(c.errorContainer, c.error, null)
    }
    setTextColor(fg)
    val radius = if (compact) 12 else Dimens.radiusMd
    background = ripple(ctx, rounded(ctx, bg, radius, stroke, 1), radius, withAlpha(if (kind == ButtonKind.PRIMARY) c.onPrimary else c.primary, 0.2f))
    if (icon != null) {
        val d = ctx.getDrawable(icon)!!.mutate()
        val s = ctx.dp(if (compact) 18 else 20)
        d.setBounds(0, 0, s, s)
        d.setTint(fg)
        setCompoundDrawablesRelative(d, null, null, null)
        compoundDrawablePadding = ctx.dp(8)
    }
    isClickable = true
    isFocusable = true
    setOnClickListener { onClick() }
}

/** دکمه آیکونی ۴۸dp (حداقل اندازه لمسی) با توضیح دسترسی‌پذیری فارسی */
fun iconButton(ctx: Context, res: Int, description: String, tint: Int = Theme.c.textPrimary, filled: Boolean = false, onClick: () -> Unit): FrameLayout =
    FrameLayout(ctx).apply {
        contentDescription = description
        val bg = if (filled) rounded(ctx, Theme.c.surface, 24, Theme.c.outline) else null
        background = ripple(ctx, bg, 24)
        addView(iconView(ctx, res, tint, 22), FrameLayout.LayoutParams(ctx.dp(22), ctx.dp(22), Gravity.CENTER))
        layoutParams = LinearLayout.LayoutParams(ctx.dp(Dimens.touch), ctx.dp(Dimens.touch))
        isClickable = true
        isFocusable = true
        setOnClickListener { onClick() }
    }

// ======================================================================== کارت
fun card(ctx: Context, paddingDp: Int = Dimens.md, radiusDp: Int = Dimens.radiusLg, color: Int = Theme.c.surface, elevated: Boolean = true): LinearLayout =
    vertical(ctx).apply {
        val c = Theme.c
        background = rounded(ctx, color, radiusDp, if (c.isDark || !elevated) c.outline else null)
        if (elevated && !c.isDark) {
            elevation = ctx.dp(1.5f)
            if (android.os.Build.VERSION.SDK_INT >= 28) {
                outlineSpotShadowColor = c.shadow
                outlineAmbientShadowColor = c.shadow
            }
        }
        setPaddingRelative(ctx.dp(paddingDp), ctx.dp(paddingDp), ctx.dp(paddingDp), ctx.dp(paddingDp))
    }

// ======================================================================== تراشه و برچسب
fun chip(ctx: Context, label: String, selected: Boolean, icon: Int? = null, onClick: () -> Unit): TextView = TextView(ctx).apply {
    layoutDirection = View.LAYOUT_DIRECTION_RTL
    val c = Theme.c
    Theme.style(this, TextStyle.Label)
    text = label
    gravity = Gravity.CENTER
    minHeight = ctx.dp(40)
    setPaddingRelative(ctx.dp(16), 0, ctx.dp(16), 0)
    val bg = if (selected) rounded(ctx, c.primary, 20) else rounded(ctx, c.surface, 20, c.outline)
    background = ripple(ctx, bg, 20)
    val fg = if (selected) c.onPrimary else c.textPrimary
    setTextColor(fg)
    if (icon != null) {
        val d = ctx.getDrawable(icon)!!.mutate()
        val s = ctx.dp(18)
        d.setBounds(0, 0, s, s)
        d.setTint(fg)
        setCompoundDrawablesRelative(d, null, null, null)
        compoundDrawablePadding = ctx.dp(6)
    }
    isSelected = selected
    isClickable = true
    setOnClickListener { onClick() }
}

fun badge(ctx: Context, label: String, tone: Tone): TextView = TextView(ctx).apply {
    Theme.style(this, TextStyle.Overline)
    text = label
    setTextColor(tone.fg)
    background = rounded(ctx, tone.bg, 10)
    setPaddingRelative(ctx.dp(8), ctx.dp(3), ctx.dp(8), ctx.dp(4))
    maxLines = 1
}

/** ردیف افقی قابل پیمایش از تراشه‌ها */
fun chipRow(ctx: Context): Pair<android.widget.HorizontalScrollView, LinearLayout> {
    val row = horizontal(ctx)
    val scroll = android.widget.HorizontalScrollView(ctx).apply {
        isHorizontalScrollBarEnabled = false
        clipToPadding = false
        overScrollMode = View.OVER_SCROLL_NEVER
        addView(row)
    }
    return scroll to row
}

// ======================================================================== سربرگ بخش
fun sectionHeader(ctx: Context, title: String, action: String? = null, onAction: (() -> Unit)? = null): LinearLayout =
    horizontal(ctx).apply {
        add(text(ctx, title, TextStyle.Title), w = 0, weight = 1f)
        if (action != null && onAction != null) {
            add(
                text(ctx, action, TextStyle.Label, Theme.c.primary).apply {
                    setPaddingRelative(dp(10), dp(8), dp(10), dp(8))
                    clickable(12, onAction)
                },
                w = WRAP,
            )
        }
    }

// ======================================================================== ردیف فهرست
/**
 * ردیف استاندارد فهرست: نشان آیکون + عنوان + توضیح + انتهای اختیاری.
 */
fun listRow(
    ctx: Context,
    icon: Int?,
    tone: Tone,
    title: CharSequence,
    subtitle: CharSequence? = null,
    trailing: View? = null,
    chevron: Boolean = false,
    onClick: (() -> Unit)? = null,
): LinearLayout = horizontal(ctx).apply {
    minimumHeight = dp(64)
    setPaddingRelative(dp(12), dp(10), dp(12), dp(10))
    if (icon != null) add(iconBadge(ctx, icon, tone), w = dp(44), h = dp(44), end = 12)
    val texts = vertical(ctx)
    texts.add(text(ctx, title, TextStyle.BodyMedium, maxLines = 2))
    if (!subtitle.isNullOrBlank()) texts.add(text(ctx, subtitle, TextStyle.BodySmall, Theme.c.textSecondary, maxLines = 3), top = 2)
    add(texts, w = 0, weight = 1f)
    if (trailing != null) add(trailing, w = WRAP, start = 8)
    if (chevron) add(iconView(ctx, R.drawable.ic_chevron, Theme.c.textTertiary, 20), w = dp(20), h = dp(20), start = 4)
    if (onClick != null) clickable(16, onClick)
}

fun divider(ctx: Context, insetStartDp: Int = 0): View = View(ctx).apply {
    setBackgroundColor(Theme.c.outline)
    layoutParams = LinearLayout.LayoutParams(MATCH, 1).apply { marginStart = ctx.dp(insetStartDp) }
}

// ======================================================================== حالت‌های صفحه
fun emptyState(
    ctx: Context,
    icon: Int,
    title: String,
    body: String,
    actionLabel: String? = null,
    illustration: Boolean = false,
    onAction: (() -> Unit)? = null,
): LinearLayout = vertical(ctx).apply {
    gravity = Gravity.CENTER_HORIZONTAL
    setPaddingRelative(dp(24), dp(28), dp(24), dp(28))
    val badgeSize = if (illustration) 96 else 72
    val frame = FrameLayout(ctx).apply {
        background = oval(Theme.c.primaryContainer)
        if (illustration) {
            addView(ImageView(ctx).apply { setImageResource(icon) }, FrameLayout.LayoutParams(dp(64), dp(64), Gravity.CENTER))
        } else {
            addView(iconView(ctx, icon, Theme.c.primary, 32), FrameLayout.LayoutParams(dp(32), dp(32), Gravity.CENTER))
        }
    }
    add(frame, w = dp(badgeSize), h = dp(badgeSize))
    add(text(ctx, title, TextStyle.Title, center = true), top = 16)
    add(text(ctx, body, TextStyle.Body, Theme.c.textSecondary, center = true), top = 6)
    if (actionLabel != null && onAction != null) {
        add(button(ctx, actionLabel, ButtonKind.PRIMARY, R.drawable.ic_plus, onClick = onAction), w = WRAP, top = 20)
    }
}

fun loadingState(ctx: Context, message: String = "در حال بارگذاری…"): LinearLayout = vertical(ctx).apply {
    gravity = Gravity.CENTER
    setPaddingRelative(0, dp(48), 0, dp(48))
    add(
        ProgressBar(ctx).apply {
            isIndeterminate = true
            indeterminateTintList = ColorStateList.valueOf(Theme.c.primary)
            contentDescription = message
        },
        w = dp(40), h = dp(40),
    )
    add(text(ctx, message, TextStyle.BodySmall, Theme.c.textSecondary, center = true), top = 12)
}

fun errorState(ctx: Context, message: String, onRetry: (() -> Unit)?): LinearLayout = vertical(ctx).apply {
    gravity = Gravity.CENTER_HORIZONTAL
    setPaddingRelative(dp(24), dp(32), dp(24), dp(32))
    val frame = FrameLayout(ctx).apply {
        background = oval(Theme.c.errorContainer)
        addView(iconView(ctx, R.drawable.ic_alert, Theme.c.error, 30), FrameLayout.LayoutParams(dp(30), dp(30), Gravity.CENTER))
    }
    add(frame, w = dp(64), h = dp(64))
    add(text(ctx, "مشکلی پیش آمد", TextStyle.Title, center = true), top = 14)
    add(text(ctx, message, TextStyle.Body, Theme.c.textSecondary, center = true), top = 6)
    if (onRetry != null) add(button(ctx, "تلاش دوباره", ButtonKind.TONAL, onClick = onRetry), w = WRAP, top = 18)
}

/** کادر اطلاع‌رسانی (هشدار/توضیح) */
fun notice(ctx: Context, icon: Int, message: CharSequence, tone: Tone, action: String? = null, onAction: (() -> Unit)? = null): LinearLayout =
    horizontal(ctx).apply {
        gravity = Gravity.TOP
        background = rounded(ctx, tone.bg, 16)
        setPaddingRelative(dp(14), dp(12), dp(14), dp(12))
        add(iconView(ctx, icon, tone.fg, 20), w = dp(20), h = dp(20), end = 10, top = 2)
        val col = vertical(ctx)
        col.add(text(ctx, message, TextStyle.BodySmall, Theme.c.textPrimary))
        if (action != null && onAction != null) {
            col.add(
                text(ctx, action, TextStyle.Label, tone.fg).apply {
                    setPaddingRelative(0, dp(8), 0, dp(2))
                    clickable(8, onAction)
                },
                w = WRAP,
            )
        }
        add(col, w = 0, weight = 1f)
    }

fun Drawable.tinted(color: Int): Drawable = mutate().also { it.setTint(color) }
