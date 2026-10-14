package ir.panjeh.petcare.ui.components

import android.app.Dialog
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.ScrollView
import ir.panjeh.petcare.R
import ir.panjeh.petcare.core.Fa
import ir.panjeh.petcare.core.Jalali
import ir.panjeh.petcare.core.JalaliDate
import ir.panjeh.petcare.ui.theme.TextStyle
import ir.panjeh.petcare.ui.theme.Theme
import java.time.LocalDate

/** پنجره‌های گفت‌وگوی یکپارچه با سبک برنامه */
object Dialogs {

    fun base(ctx: Context, content: View, bottomSheet: Boolean = false): Dialog {
        val d = Dialog(ctx)
        d.requestWindowFeature(Window.FEATURE_NO_TITLE)
        val container = card(ctx, paddingDp = 0, radiusDp = 24, elevated = false).apply {
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            addView(content)
        }
        d.setContentView(container)
        d.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            val width = minOf(ctx.resources.displayMetrics.widthPixels - ctx.dp(32), ctx.dp(420))
            setLayout(width, ViewGroup.LayoutParams.WRAP_CONTENT)
            setGravity(if (bottomSheet) Gravity.BOTTOM else Gravity.CENTER)
            if (bottomSheet) attributes = attributes.apply { y = ctx.dp(16) }
            setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        }
        return d
    }

    private fun actionsRow(ctx: Context, vararg buttons: View): LinearLayout = horizontal(ctx).apply {
        gravity = Gravity.END or Gravity.CENTER_VERTICAL
        buttons.forEachIndexed { i, b -> add(b, w = WRAP, start = if (i == 0) 0 else 8) }
    }

    /** پنجره تأیید؛ برای عملیات حذف از [destructive] استفاده شود. */
    fun confirm(
        ctx: Context,
        title: String,
        message: String,
        confirmLabel: String,
        destructive: Boolean = false,
        cancelLabel: String = "انصراف",
        onConfirm: () -> Unit,
    ): Dialog {
        val col = vertical(ctx).apply { setPaddingRelative(dp(22), dp(22), dp(22), dp(16)) }
        if (destructive) {
            col.add(iconBadge(ctx, R.drawable.ic_trash, Tone.ERROR, 48, 24, 16), w = ctx.dp(48), h = ctx.dp(48), bottom = 14)
        }
        col.add(text(ctx, title, TextStyle.Title))
        col.add(text(ctx, message, TextStyle.Body, Theme.c.textSecondary), top = 8)
        lateinit var d: Dialog
        val cancel = button(ctx, cancelLabel, ButtonKind.TEXT, compact = true) { d.dismiss() }
        val ok = button(ctx, confirmLabel, if (destructive) ButtonKind.DANGER else ButtonKind.PRIMARY, compact = true) {
            d.dismiss()
            onConfirm()
        }
        col.add(actionsRow(ctx, cancel, ok), top = 20)
        d = base(ctx, col)
        d.show()
        return d
    }

    fun message(ctx: Context, title: String, message: CharSequence, okLabel: String = "متوجه شدم") {
        val col = vertical(ctx).apply { setPaddingRelative(dp(22), dp(22), dp(22), dp(16)) }
        col.add(text(ctx, title, TextStyle.Title))
        col.add(text(ctx, message, TextStyle.Body, Theme.c.textSecondary), top = 8)
        lateinit var d: Dialog
        col.add(actionsRow(ctx, button(ctx, okLabel, ButtonKind.PRIMARY, compact = true) { d.dismiss() }), top = 20)
        d = base(ctx, col)
        d.show()
    }

    data class Option(val label: String, val icon: Int? = null, val tone: Tone = Tone.PRIMARY, val subtitle: String? = null, val action: () -> Unit)

    /** فهرست گزینه‌ها به‌صورت برگه پایین صفحه */
    fun options(ctx: Context, title: String?, options: List<Option>) {
        val col = vertical(ctx).apply { setPaddingRelative(dp(8), dp(16), dp(8), dp(8)) }
        if (title != null) col.add(text(ctx, title, TextStyle.Title).apply { setPaddingRelative(dp(14), 0, dp(14), dp(8)) })
        lateinit var d: Dialog
        options.forEach { o ->
            col.add(listRow(ctx, o.icon, o.tone, o.label, o.subtitle) { d.dismiss(); o.action() })
        }
        col.add(button(ctx, "انصراف", ButtonKind.TEXT) { d.dismiss() }, top = 4)
        val scroll = ScrollView(ctx).apply { addView(col) }
        d = base(ctx, scroll, bottomSheet = true)
        d.show()
    }

    /** دریافت رمز عبور (برای نسخه پشتیبان) */
    fun password(ctx: Context, title: String, message: String, confirmTwice: Boolean, onDone: (CharArray) -> Unit) {
        val col = vertical(ctx).apply { setPaddingRelative(dp(22), dp(22), dp(22), dp(16)) }
        col.add(text(ctx, title, TextStyle.Title))
        col.add(text(ctx, message, TextStyle.BodySmall, Theme.c.textSecondary), top = 6)
        val p1 = TextField(ctx, "رمز نسخه پشتیبان", "حداقل ۶ نویسه", required = true, kind = InputKind.PASSWORD, maxLength = 64)
        col.add(p1.view, top = 16)
        val p2 = if (confirmTwice) TextField(ctx, "تکرار رمز", "", required = true, kind = InputKind.PASSWORD, maxLength = 64) else null
        if (p2 != null) col.add(p2.view, top = 12)
        lateinit var d: Dialog
        val ok = button(ctx, "تأیید", ButtonKind.PRIMARY, compact = true) {
            val a = p1.edit.text.toString()
            when {
                a.length < 6 -> p1.error("رمز باید حداقل ۶ نویسه باشد")
                p2 != null && p2.edit.text.toString() != a -> p2.error("تکرار رمز با رمز یکسان نیست")
                else -> {
                    d.dismiss()
                    onDone(a.toCharArray())
                }
            }
        }
        col.add(actionsRow(ctx, button(ctx, "انصراف", ButtonKind.TEXT, compact = true) { d.dismiss() }, ok), top = 18)
        d = base(ctx, ScrollView(ctx).apply { addView(col) })
        d.show()
    }

    /** پنجره پیشرفت (غیرقابل لغو) برای عملیات طولانی */
    fun progress(ctx: Context, message: String): Dialog {
        val row = horizontal(ctx).apply { setPaddingRelative(dp(22), dp(22), dp(22), dp(22)) }
        row.add(
            android.widget.ProgressBar(ctx).apply {
                isIndeterminate = true
                indeterminateTintList = android.content.res.ColorStateList.valueOf(Theme.c.primary)
            },
            w = ctx.dp(32), h = ctx.dp(32), end = 16,
        )
        row.add(text(ctx, message, TextStyle.Body), w = 0, weight = 1f)
        val d = base(ctx, row)
        d.setCancelable(false)
        d.show()
        return d
    }
}

/** انتخابگر تاریخ شمسی */
object JalaliDatePicker {

    fun show(
        ctx: Context,
        initial: LocalDate,
        minDate: LocalDate?,
        maxDate: LocalDate?,
        allowClear: Boolean,
        onPicked: (LocalDate?) -> Unit,
    ) {
        var selected = initial
        var month = JalaliDate.of(initial).let { JalaliDate(it.year, it.month, 1) }
        val today = LocalDate.now()

        val root = vertical(ctx)
        val header = vertical(ctx).apply {
            background = rounded(ctx, Theme.c.primaryContainer, 24)
            setPaddingRelative(dp(20), dp(18), dp(20), dp(18))
        }
        val headerYear = text(ctx, "", TextStyle.Label, Theme.c.onPrimaryContainer)
        val headerDate = text(ctx, "", TextStyle.Headline, Theme.c.onPrimaryContainer)
        header.add(headerYear)
        header.add(headerDate, top = 4)
        root.add(header)

        val body = vertical(ctx).apply { setPaddingRelative(dp(12), dp(10), dp(12), dp(4)) }
        root.add(body)
        val nav = horizontal(ctx)
        val monthTitle = text(ctx, "", TextStyle.TitleSmall, center = true)
        lateinit var render: () -> Unit
        nav.add(iconButton(ctx, R.drawable.ic_back, "ماه قبل") { month = month.plusMonths(-1); render() })
        nav.add(monthTitle, w = 0, weight = 1f)
        monthTitle.setPaddingRelative(0, ctx.dp(10), 0, ctx.dp(10))
        monthTitle.contentDescription = "انتخاب سال"
        monthTitle.clickable(12) {
            val thisYear = JalaliDate.of(today).year
            val minY = minDate?.let { JalaliDate.of(it).year } ?: (thisYear - 30)
            val maxY = maxDate?.let { JalaliDate.of(it).year } ?: (thisYear + 5)
            Dialogs.options(ctx, "انتخاب سال", (maxY downTo minY).map { y ->
                Dialogs.Option(Fa.num(y), null) {
                    month = JalaliDate(y, month.month, 1)
                    render()
                }
            })
        }
        nav.add(iconButton(ctx, R.drawable.ic_chevron, "ماه بعد") { month = month.plusMonths(1); render() })
        body.add(nav)

        val week = horizontal(ctx)
        Jalali.WEEK_HEADER.forEach { week.add(text(ctx, it, TextStyle.Caption, Theme.c.textTertiary, center = true), w = 0, weight = 1f) }
        body.add(week, top = 4, bottom = 4)
        val grid = vertical(ctx)
        body.add(grid)

        fun allowed(d: LocalDate) = (minDate == null || !d.isBefore(minDate)) && (maxDate == null || !d.isAfter(maxDate))

        render = {
            val sj = JalaliDate.of(selected)
            headerYear.text = Fa.num(sj.year)
            headerDate.text = "${Jalali.weekdayName(selected)}، ${Fa.num(sj.day)} ${Jalali.MONTHS[sj.month - 1]}"
            monthTitle.text = Fa.monthYear(month)
            grid.removeAllViews()
            val first = month.toLocalDate()
            val offset = Jalali.weekColumn(first)
            val len = Jalali.monthLength(month.year, month.month)
            var day = 1 - offset
            for (r in 0 until 6) {
                if (day > len) break
                val row = horizontal(ctx)
                for (col in 0 until 7) {
                    val cell = text(ctx, "", TextStyle.Body, center = true)
                    if (day in 1..len) {
                        val date = Jalali.toGregorian(month.year, month.month, day)
                        cell.text = Fa.num(day)
                        val isSel = date == selected
                        val ok = allowed(date)
                        when {
                            isSel -> {
                                cell.background = oval(Theme.c.primary)
                                cell.setTextColor(Theme.c.onPrimary)
                            }
                            date == today -> {
                                cell.background = android.graphics.drawable.GradientDrawable().apply {
                                    shape = android.graphics.drawable.GradientDrawable.OVAL
                                    setStroke(ctx.dp(1), Theme.c.primary)
                                }
                                cell.setTextColor(Theme.c.primary)
                            }
                            !ok -> cell.setTextColor(Theme.c.textTertiary)
                        }
                        if (ok) {
                            cell.isClickable = true
                            cell.foreground = ripple(ctx, null, 20)
                            cell.setOnClickListener { selected = date; render() }
                        } else {
                            cell.alpha = 0.45f
                        }
                        cell.contentDescription = Fa.date(date, true)
                    }
                    row.add(cell, w = 0, h = ctx.dp(42), weight = 1f, start = 2, end = 2)
                    day++
                }
                grid.add(row, bottom = 2)
            }
        }
        render()

        lateinit var d: Dialog
        val actions = horizontal(ctx).apply { setPaddingRelative(dp(12), dp(4), dp(12), dp(12)) }
        actions.add(button(ctx, "امروز", ButtonKind.TEXT, compact = true) {
            if (allowed(today)) {
                selected = today
                month = JalaliDate.of(today).let { JalaliDate(it.year, it.month, 1) }
                render()
            }
        }, w = WRAP)
        if (allowClear) actions.add(button(ctx, "پاک کردن", ButtonKind.TEXT, compact = true) { d.dismiss(); onPicked(null) }, w = WRAP)
        actions.fill()
        actions.add(button(ctx, "انصراف", ButtonKind.TEXT, compact = true) { d.dismiss() }, w = WRAP)
        actions.add(button(ctx, "تأیید", ButtonKind.PRIMARY, compact = true) { d.dismiss(); onPicked(selected) }, w = WRAP, start = 6)
        root.add(actions)

        d = Dialogs.base(ctx, ScrollView(ctx).apply { addView(root) })
        d.show()
    }
}
