package ir.panjeh.petcare.ui.components

import android.content.Context
import android.graphics.drawable.StateListDrawable
import android.text.Editable
import android.text.InputFilter
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView
import ir.panjeh.petcare.R
import ir.panjeh.petcare.core.Fa
import ir.panjeh.petcare.ui.theme.Dimens
import ir.panjeh.petcare.ui.theme.TextStyle
import ir.panjeh.petcare.ui.theme.Theme
import java.time.LocalDate
import java.time.LocalTime

/** پس‌زمینه ورودی با حالت فوکوس */
private fun fieldBackground(ctx: Context, error: Boolean = false): StateListDrawable {
    val c = Theme.c
    return StateListDrawable().apply {
        addState(intArrayOf(android.R.attr.state_focused), rounded(ctx, c.surface, Dimens.radiusMd, if (error) c.error else c.primary, 2))
        addState(intArrayOf(), rounded(ctx, c.surface, Dimens.radiusMd, if (error) c.error else c.outline, 1))
    }
}

/** برچسب فیلد؛ فیلدهای اختیاری با «(اختیاری)» مشخص می‌شوند. */
private fun fieldLabel(ctx: Context, label: String, required: Boolean): TextView {
    val t = if (required) label else "$label  (اختیاری)"
    return text(ctx, t, TextStyle.Label, Theme.c.textSecondary)
}

enum class InputKind { TEXT, NAME, MULTILINE, DECIMAL, NUMBER, PHONE, PASSWORD }

/** فیلد ورودی متنی با برچسب، راهنما و پیام خطا */
class TextField(
    ctx: Context,
    label: String,
    hint: String = "",
    val required: Boolean = false,
    kind: InputKind = InputKind.TEXT,
    maxLength: Int = 300,
    helper: String? = null,
) {
    val view: LinearLayout = vertical(ctx)
    val edit: EditText = EditText(ctx)
    private val errorText: TextView
    private val helperText: TextView?

    init {
        view.add(fieldLabel(ctx, label, required), bottom = 6)
        edit.apply {
            Theme.style(this, TextStyle.Body)
            setTextColor(Theme.c.textPrimary)
            setHintTextColor(Theme.c.textTertiary)
            this.hint = hint
            background = fieldBackground(ctx)
            setPaddingRelative(dp(14), dp(12), dp(14), dp(12))
            minHeight = dp(Dimens.fieldHeight)
            textDirection = View.TEXT_DIRECTION_LOCALE
            textAlignment = View.TEXT_ALIGNMENT_VIEW_START
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            filters = arrayOf(InputFilter.LengthFilter(maxLength))
            imeOptions = EditorInfo.IME_ACTION_NEXT
            inputType = when (kind) {
                InputKind.TEXT -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                InputKind.NAME -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
                InputKind.MULTILINE -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
                InputKind.DECIMAL -> InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
                InputKind.NUMBER -> InputType.TYPE_CLASS_NUMBER
                InputKind.PHONE -> InputType.TYPE_CLASS_PHONE
                InputKind.PASSWORD -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            }
            if (kind == InputKind.MULTILINE) {
                gravity = Gravity.START or Gravity.TOP
                minLines = 3
                maxLines = 8
                isSingleLine = false
                imeOptions = EditorInfo.IME_ACTION_NONE
            } else {
                isSingleLine = true
            }
            if (kind == InputKind.DECIMAL || kind == InputKind.NUMBER || kind == InputKind.PHONE) {
                // ارقام فارسی و لاتین هر دو پذیرفته می‌شوند؛ فقط نمایش راست‌چین حفظ می‌شود
                keyListener = android.text.method.DigitsKeyListener.getInstance("0123456789۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩.٫/,+ ")
                setRawInputType(if (kind == InputKind.PHONE) InputType.TYPE_CLASS_PHONE else InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL)
            }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
                override fun afterTextChanged(s: Editable?) { error(null) }
            })
        }
        view.add(edit)
        helperText = helper?.let { text(ctx, it, TextStyle.Caption, Theme.c.textTertiary).also { t -> view.add(t, top = 6) } }
        errorText = text(ctx, "", TextStyle.Caption, Theme.c.error).apply { visibility = View.GONE }
        view.add(errorText, top = 6)
    }

    var value: String
        get() = edit.text.toString().trim()
        set(v) { edit.setText(v) }

    fun error(msg: String?) {
        errorText.text = msg ?: ""
        errorText.visibility = if (msg == null) View.GONE else View.VISIBLE
        helperText?.visibility = if (msg == null) View.VISIBLE else View.GONE
        edit.background = fieldBackground(edit.context, msg != null)
        edit.setPaddingRelative(edit.dp(14), edit.dp(12), edit.dp(14), edit.dp(12))
    }

    /** اعتبارسنجی فیلد ضروری */
    fun requireNotBlank(message: String = "این فیلد لازم است"): Boolean {
        if (value.isBlank()) {
            error(message)
            return false
        }
        return true
    }
}

/** فیلد انتخابی (تاریخ، ساعت، فهرست) که با لمس، انتخابگر را باز می‌کند */
open class PickerField(ctx: Context, label: String, private val placeholder: String, val required: Boolean, icon: Int) {
    val view: LinearLayout = vertical(ctx)
    protected val valueText: TextView
    private val errorText: TextView
    private val box: LinearLayout
    var onClick: (() -> Unit)? = null

    init {
        view.add(fieldLabel(ctx, label, required), bottom = 6)
        box = horizontal(ctx).apply {
            background = fieldBackground(ctx)
            minimumHeight = dp(Dimens.fieldHeight)
            setPaddingRelative(dp(14), dp(10), dp(12), dp(10))
        }
        valueText = text(ctx, placeholder, TextStyle.Body, Theme.c.textTertiary, maxLines = 1)
        box.add(valueText, w = 0, weight = 1f)
        box.add(iconView(ctx, icon, Theme.c.textSecondary, 20), w = ctx.dp(20), h = ctx.dp(20))
        box.isClickable = true
        box.isFocusable = true
        box.foreground = ripple(ctx, null, Dimens.radiusMd)
        box.setOnClickListener { error(null); onClick?.invoke() }
        box.contentDescription = label
        view.add(box)
        errorText = text(ctx, "", TextStyle.Caption, Theme.c.error).apply { visibility = View.GONE }
        view.add(errorText, top = 6)
    }

    protected fun show(display: String?) {
        if (display == null) {
            valueText.text = placeholder
            valueText.setTextColor(Theme.c.textTertiary)
        } else {
            valueText.text = display
            valueText.setTextColor(Theme.c.textPrimary)
        }
    }

    fun error(msg: String?) {
        errorText.text = msg ?: ""
        errorText.visibility = if (msg == null) View.GONE else View.VISIBLE
        box.background = fieldBackground(box.context, msg != null)
    }
}

class DateField(
    private val ctx: Context,
    label: String,
    required: Boolean = false,
    private val minDate: LocalDate? = null,
    private val maxDate: LocalDate? = null,
    placeholder: String = "انتخاب تاریخ",
) : PickerField(ctx, label, placeholder, required, R.drawable.ic_calendar) {
    var date: LocalDate? = null
        set(v) {
            field = v
            show(v?.let { Fa.date(it, withWeekday = true) })
            onChanged?.invoke(v)
        }
    var onChanged: ((LocalDate?) -> Unit)? = null

    init {
        onClick = {
            JalaliDatePicker.show(ctx, date ?: LocalDate.now().coerceIn(minDate, maxDate), minDate, maxDate, allowClear = !required && date != null) {
                date = it
            }
        }
    }
}

private fun LocalDate.coerceIn(min: LocalDate?, max: LocalDate?): LocalDate = when {
    min != null && isBefore(min) -> min
    max != null && isAfter(max) -> max
    else -> this
}

class TimeField(private val ctx: Context, label: String, required: Boolean = true, placeholder: String = "انتخاب ساعت") :
    PickerField(ctx, label, placeholder, required, R.drawable.ic_clock) {
    var time: LocalTime? = null
        set(v) {
            field = v
            show(v?.let { Fa.time(it) })
        }

    init {
        onClick = {
            val t = time ?: LocalTime.of(9, 0)
            android.app.TimePickerDialog(ctx, { _, h, m -> time = LocalTime.of(h, m) }, t.hour, t.minute, true).show()
        }
    }
}

/** انتخاب یک گزینه از میان چند تراشه */
class ChoiceField<T>(
    private val ctx: Context,
    label: String?,
    private val options: List<Pair<T, String>>,
    initial: T?,
    val required: Boolean = false,
    private val icons: Map<T, Int> = emptyMap(),
    private val wrap: Boolean = true,
) {
    val view: LinearLayout = vertical(ctx)
    private val rows: LinearLayout = vertical(ctx)
    private val errorText: TextView
    var selected: T? = initial
        private set
    var onChanged: ((T?) -> Unit)? = null

    init {
        if (label != null) view.add(fieldLabel(ctx, label, required), bottom = 8)
        view.add(rows)
        errorText = text(ctx, "", TextStyle.Caption, Theme.c.error).apply { visibility = View.GONE }
        view.add(errorText, top = 6)
        render()
    }

    fun select(v: T?) {
        selected = v
        render()
        onChanged?.invoke(v)
    }

    fun error(msg: String?) {
        errorText.text = msg ?: ""
        errorText.visibility = if (msg == null) View.GONE else View.VISIBLE
    }

    private fun render() {
        rows.removeAllViews()
        // چیدمان چندسطری ساده: حداکثر ۳ تراشه در هر سطر
        val perRow = if (wrap) 3 else options.size
        options.chunked(perRow).forEach { chunk ->
            val row = horizontal(ctx)
            chunk.forEachIndexed { i, (value, title) ->
                val c = chip(ctx, title, value == selected, icons[value]) {
                    error(null)
                    select(value)
                }
                row.add(c, w = if (wrap) 0 else WRAP, weight = if (wrap) 1f else 0f, end = if (i < chunk.size - 1) 8 else 0)
            }
            if (wrap) repeat(perRow - chunk.size) { row.add(View(ctx), w = 0, weight = 1f, start = 8) }
            rows.add(row, bottom = 8)
        }
    }
}

/** ردیف کلید روشن/خاموش */
class SwitchRow(ctx: Context, title: String, subtitle: String? = null, checked: Boolean, onChange: (Boolean) -> Unit) {
    val switch: Switch = Switch(ctx).apply {
        isChecked = checked
        thumbTintList = android.content.res.ColorStateList(
            arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
            intArrayOf(Theme.c.primary, if (Theme.c.isDark) 0xFF9AA19C.toInt() else 0xFFFFFFFF.toInt()),
        )
        trackTintList = android.content.res.ColorStateList(
            arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
            intArrayOf(withAlpha(Theme.c.primary, 0.45f), Theme.c.outline),
        )
        setOnCheckedChangeListener { _, b -> onChange(b) }
        contentDescription = title
    }
    val view: LinearLayout = horizontal(ctx).apply {
        minimumHeight = dp(56)
        setPaddingRelative(dp(4), dp(6), dp(4), dp(6))
        val col = vertical(ctx)
        col.add(text(ctx, title, TextStyle.BodyMedium))
        if (subtitle != null) col.add(text(ctx, subtitle, TextStyle.BodySmall, Theme.c.textSecondary), top = 2)
        add(col, w = 0, weight = 1f)
        add(switch, w = WRAP, start = 8)
        clickable(12) { switch.isChecked = !switch.isChecked }
    }
}

/** ستون فرم با فاصله استاندارد بین فیلدها */
fun formColumn(ctx: Context, vararg fields: View): LinearLayout = vertical(ctx).apply {
    fields.forEachIndexed { i, v -> add(v, top = if (i == 0) 0 else 16) }
}
