package ir.panjeh.petcare.ui.components

import android.content.Context
import android.graphics.Canvas
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.FrameLayout
import android.widget.ImageView
import ir.panjeh.petcare.Graph
import ir.panjeh.petcare.R
import ir.panjeh.petcare.core.Async
import ir.panjeh.petcare.core.Fa
import ir.panjeh.petcare.data.Pet
import ir.panjeh.petcare.data.Species
import ir.panjeh.petcare.data.WeightEntry
import ir.panjeh.petcare.ui.theme.Theme
import kotlin.math.max
import kotlin.math.min

object SpeciesArt {
    fun illustration(s: Species): Int = when (s) {
        Species.DOG -> R.drawable.ill_dog
        Species.CAT -> R.drawable.ill_cat
        Species.BIRD -> R.drawable.ill_bird
        Species.RABBIT -> R.drawable.ill_rabbit
        Species.OTHER -> R.drawable.ill_other
    }

    /** رنگ پس‌زمینه ملایم برای هر گونه (هماهنگ با پالت کرم) */
    fun tint(s: Species): Int {
        if (Theme.c.isDark) return Theme.c.surfaceVariant
        return when (s) {
            Species.DOG -> 0xFFFBEBDA.toInt()
            Species.CAT -> 0xFFFCEEDC.toInt()
            Species.BIRD -> 0xFFE4F0F8.toInt()
            Species.RABBIT -> 0xFFF2EEEA.toInt()
            Species.OTHER -> Theme.c.primaryContainer
        }
    }
}

/**
 * تصویر حیوان؛ اگر عکس ثبت نشده باشد تصویرسازی گونه نمایش داده می‌شود.
 * عکس‌ها در پس‌زمینه رمزگشایی و در حافظه نهان نگهداری می‌شوند.
 */
class PetAvatar(ctx: Context, private val sizeDp: Int, private val radiusDp: Int? = null) : FrameLayout(ctx) {
    private val image = ImageView(ctx)
    private var token = 0

    init {
        addView(image, LayoutParams(MATCH, MATCH))
        clipToOutline = true
        outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(view: View, outline: Outline) {
                val r = radiusDp?.let { dp(it).toFloat() } ?: (min(view.width, view.height) / 2f)
                outline.setRoundRect(0, 0, view.width, view.height, r)
            }
        }
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    fun bind(pet: Pet?) {
        val my = ++token
        val species = pet?.species ?: Species.OTHER
        setBackgroundColor(SpeciesArt.tint(species))
        val photo = pet?.photo
        val px = dp(sizeDp)
        val cached = photo?.let { Graph.files.cachedThumb(it, px) }
        if (cached != null) {
            showPhoto(cached)
            return
        }
        showIllustration(species)
        if (photo != null) {
            Async.run({ Graph.files.loadThumb(photo, px) }, alive = { my == token }) { bmp ->
                if (bmp != null) showPhoto(bmp)
            }
        }
    }

    private fun showPhoto(bmp: android.graphics.Bitmap) {
        image.scaleType = ImageView.ScaleType.CENTER_CROP
        image.setImageBitmap(bmp)
        image.setPadding(0, 0, 0, 0)
    }

    private fun showIllustration(s: Species) {
        image.scaleType = ImageView.ScaleType.FIT_CENTER
        image.setImageResource(SpeciesArt.illustration(s))
        val pad = dp(sizeDp) / 7
        image.setPadding(pad, pad, pad, pad)
    }
}

/**
 * نمودار خطی ساده و خوانا برای روند وزن (بدون برچسب‌گذاری «سالم/بیمار»).
 * محور افقی زمان و محور عمودی وزن است؛ آخرین مقدار برجسته می‌شود.
 */
class WeightChart(ctx: Context) : View(ctx) {
    private var points: List<WeightEntry> = emptyList()
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = ctx.dp(2.5f)
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG)
    private val grid = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeWidth = 1f }
    private val label = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = ctx.dp(11f) }

    fun setData(entries: List<WeightEntry>) {
        points = entries.sortedBy { it.measuredAt }.takeLast(24)
        contentDescription = if (points.isEmpty()) "نمودار وزن: داده‌ای ثبت نشده"
        else "نمودار وزن از ${Fa.date(Fa.dateOfMillis(points.first().measuredAt))} تا ${Fa.date(Fa.dateOfMillis(points.last().measuredAt))}"
        invalidate()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val w = MeasureSpec.getSize(widthMeasureSpec)
        setMeasuredDimension(w, dp(180))
    }

    override fun onDraw(canvas: Canvas) {
        val c = Theme.c
        line.color = c.primary
        dot.color = c.primary
        grid.color = c.outline
        label.color = c.textTertiary
        label.typeface = Theme.font(400)
        val padTop = dp(16f)
        val padBottom = dp(26f)
        val padSide = dp(12f)
        val left = padSide + dp(36f)
        val right = width - padSide
        val top = padTop
        val bottom = height - padBottom
        if (points.isEmpty()) return

        var minV = points.minOf { it.grams }
        var maxV = points.maxOf { it.grams }
        if (maxV - minV < 1) { minV -= 50; maxV += 50 }
        val span = maxV - minV
        minV -= span * 0.15
        maxV += span * 0.15
        val t0 = points.first().measuredAt.toDouble()
        val t1 = max(points.last().measuredAt.toDouble(), t0 + 1)

        // خطوط راهنما و برچسب محور عمودی
        label.textAlign = Paint.Align.RIGHT
        for (i in 0..2) {
            val y = top + (bottom - top) * i / 2f
            canvas.drawLine(left, y, right, y, grid)
            val v = maxV - (maxV - minV) * i / 2.0
            canvas.drawText(Fa.decimal(if (maxV >= 1000) v / 1000 else v, 1), left - dp(6f), y + dp(4f), label)
        }

        // در چیدمان راست‌به‌چپ، زمان جدیدتر در سمت چپ قرار می‌گیرد
        fun x(t: Long): Float = if (points.size == 1) (left + right) / 2f
        else (right - (right - left) * ((t - t0) / (t1 - t0))).toFloat()
        fun y(v: Double): Float = (bottom - (bottom - top) * ((v - minV) / (maxV - minV))).toFloat()

        val path = Path()
        val area = Path()
        points.forEachIndexed { i, p ->
            val px = x(p.measuredAt)
            val py = y(p.grams)
            if (i == 0) {
                path.moveTo(px, py)
                area.moveTo(px, bottom)
                area.lineTo(px, py)
            } else {
                path.lineTo(px, py)
                area.lineTo(px, py)
            }
        }
        area.lineTo(x(points.last().measuredAt), bottom)
        area.close()
        fill.shader = android.graphics.LinearGradient(0f, top, 0f, bottom, withAlpha(c.primary, 0.22f), withAlpha(c.primary, 0.0f), android.graphics.Shader.TileMode.CLAMP)
        if (points.size > 1) {
            canvas.drawPath(area, fill)
            canvas.drawPath(path, line)
        }
        points.forEachIndexed { i, p ->
            val last = i == points.size - 1
            val r = if (last) dp(5.5f) else dp(3.5f)
            dot.color = c.surface
            canvas.drawCircle(x(p.measuredAt), y(p.grams), r + dp(2f), dot)
            dot.color = c.primary
            canvas.drawCircle(x(p.measuredAt), y(p.grams), r, dot)
        }
        // تاریخ اولین و آخرین اندازه‌گیری
        label.textAlign = Paint.Align.RIGHT
        canvas.drawText(Fa.dayMonth(Fa.dateOfMillis(points.first().measuredAt)), right, height - dp(6f), label)
        if (points.size > 1) {
            label.textAlign = Paint.Align.LEFT
            canvas.drawText(Fa.dayMonth(Fa.dateOfMillis(points.last().measuredAt)), left, height - dp(6f), label)
        }
    }

    @Suppress("unused")
    private val rect = RectF()
}
