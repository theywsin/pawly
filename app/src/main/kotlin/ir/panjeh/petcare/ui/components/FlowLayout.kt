package ir.panjeh.petcare.ui.components

import android.content.Context
import android.view.View
import android.view.ViewGroup

/** چیدمان جریانی (چندسطری) با پشتیبانی از راست‌به‌چپ؛ برای تراشه‌ها و برچسب‌ها */
class FlowLayout(ctx: Context, private val hGapDp: Int = 6, private val vGapDp: Int = 6) : ViewGroup(ctx) {

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val maxW = MeasureSpec.getSize(widthMeasureSpec) - paddingLeft - paddingRight
        val hGap = context.dp(hGapDp)
        val vGap = context.dp(vGapDp)
        var x = 0
        var y = 0
        var lineH = 0
        var usedW = 0
        for (i in 0 until childCount) {
            val c = getChildAt(i)
            if (c.visibility == View.GONE) continue
            c.measure(MeasureSpec.makeMeasureSpec(maxW, MeasureSpec.AT_MOST), MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED))
            if (x > 0 && x + c.measuredWidth > maxW) {
                x = 0
                y += lineH + vGap
                lineH = 0
            }
            x += c.measuredWidth + hGap
            usedW = maxOf(usedW, x - hGap)
            lineH = maxOf(lineH, c.measuredHeight)
        }
        val w = if (MeasureSpec.getMode(widthMeasureSpec) == MeasureSpec.EXACTLY) MeasureSpec.getSize(widthMeasureSpec) else usedW + paddingLeft + paddingRight
        setMeasuredDimension(w, y + lineH + paddingTop + paddingBottom)
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val rtl = layoutDirection == View.LAYOUT_DIRECTION_RTL
        val width = r - l
        val maxW = width - paddingLeft - paddingRight
        val hGap = context.dp(hGapDp)
        val vGap = context.dp(vGapDp)
        var x = 0
        var y = paddingTop
        var lineH = 0
        for (i in 0 until childCount) {
            val c = getChildAt(i)
            if (c.visibility == View.GONE) continue
            if (x > 0 && x + c.measuredWidth > maxW) {
                x = 0
                y += lineH + vGap
                lineH = 0
            }
            val left = if (rtl) width - paddingRight - x - c.measuredWidth else paddingLeft + x
            c.layout(left, y, left + c.measuredWidth, y + c.measuredHeight)
            x += c.measuredWidth + hGap
            lineH = maxOf(lineH, c.measuredHeight)
        }
    }
}
