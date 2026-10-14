package ir.panjeh.petcare.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Path
import android.graphics.RectF
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import ir.panjeh.petcare.MainActivity
import ir.panjeh.petcare.R
import ir.panjeh.petcare.TestEnv
import ir.panjeh.petcare.idle
import ir.panjeh.petcare.ui.components.add
import ir.panjeh.petcare.ui.components.dp
import ir.panjeh.petcare.ui.components.text
import ir.panjeh.petcare.ui.components.vertical
import ir.panjeh.petcare.ui.screens.brandMark
import ir.panjeh.petcare.ui.theme.TextStyle
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.io.FileOutputStream

/** تولید آیکون فروشگاهی ۵۱۲×۵۱۲ و تصویر شاخص ۱۰۲۴×۵۰۰ از همان منابع برداری برنامه */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w400dp-h800dp-mdpi")
class StoreAssetsTest {
    private val dir = System.getProperty("store.dir")?.let { File(it) }

    @Before
    fun setUp() = TestEnv.reset()

    private fun save(bmp: Bitmap, name: String) {
        val d = dir ?: return
        d.mkdirs()
        FileOutputStream(File(d, name)).use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test
    fun icons() {
        val a = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        for ((size, rounded) in listOf(512 to false, 512 to true, 192 to true)) {
            val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            val c = Canvas(bmp)
            if (rounded) {
                val p = Path().apply { addRoundRect(RectF(0f, 0f, size.toFloat(), size.toFloat()), size * 0.22f, size * 0.22f, Path.Direction.CW) }
                c.clipPath(p)
            }
            // لایه‌های آیکون تطبیقی (۱۰۸ واحد) به‌گونه‌ای که حاشیه مناسب در آیکون فروشگاه حفظ شود
            val bleed = (size * 108f / 88f).toInt()
            val off = (size - bleed) / 2
            listOf(R.drawable.ic_launcher_background, R.drawable.ic_launcher_foreground).forEach { res ->
                a.getDrawable(res)!!.apply { setBounds(off, off, off + bleed, off + bleed); draw(c) }
            }
            save(bmp, "icon-$size${if (rounded) "-rounded" else ""}.png")
        }
    }

    @Test
    fun featureGraphic() {
        val a = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        idle()
        val w = 1024
        val h = 500
        val root = FrameLayout(a).apply {
            setBackgroundColor(0xFF1F5A44.toInt())
            layoutDirection = View.LAYOUT_DIRECTION_RTL
        }
        val circle = View(a).apply { background = ir.panjeh.petcare.ui.components.oval(0x14FFFFFF) }
        root.addView(circle, FrameLayout.LayoutParams(a.dp(520), a.dp(520), Gravity.START or Gravity.CENTER_VERTICAL).apply { marginStart = -a.dp(140) })
        val col = vertical(a).apply { gravity = Gravity.START or Gravity.CENTER_VERTICAL; setPaddingRelative(a.dp(64), 0, a.dp(64), 0) }
        col.add(brandMark(a, 72), w = a.dp(72), h = a.dp(72))
        col.add(text(a, a.getString(R.string.app_name), TextStyle.Display, 0xFFFFFFFF.toInt()).apply { textSize = 54f }, top = 18)
        col.add(text(a, a.getString(R.string.app_tagline), TextStyle.Title, 0xE6FFFFFF.toInt()).apply { textSize = 26f }, top = 6)
        col.add(text(a, "واکسن · دارو · دامپزشک · وزن · یادآور", TextStyle.Body, 0xB3FFFFFF.toInt()).apply { textSize = 20f }, top = 14)
        root.addView(col, FrameLayout.LayoutParams(a.dp(560), FrameLayout.LayoutParams.MATCH_PARENT, Gravity.START))
        val pets = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER; layoutDirection = View.LAYOUT_DIRECTION_LTR }
        listOf(R.drawable.ill_dog to 190, R.drawable.ill_cat to 170, R.drawable.ill_bird to 120).forEach { (res, s) ->
            pets.addView(ImageView(a).apply { setImageResource(res) }, LinearLayout.LayoutParams(a.dp(s), a.dp(s)))
        }
        root.addView(pets, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.END or Gravity.CENTER_VERTICAL).apply { marginEnd = a.dp(36) })
        root.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        root.layout(0, 0, w, h)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        root.draw(Canvas(bmp))
        save(bmp, "feature-graphic-1024x500.png")
    }
}
