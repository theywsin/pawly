package ir.panjeh.petcare.ui

import android.app.Activity
import android.app.Dialog
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import ir.panjeh.petcare.idle
import org.robolectric.shadows.ShadowDialog
import org.robolectric.shadows.ShadowLooper
import java.io.File
import java.io.FileOutputStream

/** ثبت تصویر واقعی صفحه (رندر بومی Robolectric) */
object Shots {
    private val dir: File? = System.getProperty("screenshots.dir")?.let { File(it) }

    fun settle() {
        repeat(3) {
            ShadowLooper.idleMainLooper(400, java.util.concurrent.TimeUnit.MILLISECONDS)
            idle()
        }
    }

    fun capture(activity: Activity, name: String, dialog: Dialog? = ShadowDialog.getLatestDialog()?.takeIf { it.isShowing }): Bitmap {
        settle()
        val root = activity.window.decorView
        val bmp = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        root.draw(canvas)
        if (dialog != null) {
            canvas.drawColor(0x88101412.toInt())
            val dv: View = dialog.window!!.decorView
            if (dv.width == 0) {
                dv.measure(View.MeasureSpec.makeMeasureSpec(root.width, View.MeasureSpec.AT_MOST), View.MeasureSpec.makeMeasureSpec(root.height, View.MeasureSpec.AT_MOST))
                dv.layout(0, 0, dv.measuredWidth, dv.measuredHeight)
            }
            val gravity = dialog.window!!.attributes.gravity
            val x = (root.width - dv.width) / 2f
            val y = if (gravity and android.view.Gravity.BOTTOM == android.view.Gravity.BOTTOM) (root.height - dv.height - 24f) else (root.height - dv.height) / 2f
            canvas.save()
            canvas.translate(x, y)
            dv.draw(canvas)
            canvas.restore()
        }
        dir?.let {
            it.mkdirs()
            FileOutputStream(File(it, "$name.png")).use { o -> bmp.compress(Bitmap.CompressFormat.PNG, 100, o) }
        }
        return bmp
    }
}
