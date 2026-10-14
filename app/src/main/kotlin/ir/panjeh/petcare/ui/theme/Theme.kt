package ir.panjeh.petcare.ui.theme

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.util.TypedValue
import android.widget.TextView
import ir.panjeh.petcare.R

/**
 * توکن‌های طراحی «پنجه». همه رنگ‌ها، اندازه‌ها و سبک‌های متن فقط از این فایل خوانده می‌شوند
 * تا تغییر هویت بصری در یک نقطه انجام شود.
 */
data class Palette(
    val primary: Int,
    val onPrimary: Int,
    val primaryContainer: Int,
    val onPrimaryContainer: Int,
    val secondary: Int,
    val onSecondary: Int,
    val background: Int,
    val surface: Int,
    val surfaceVariant: Int,
    val outline: Int,
    val textPrimary: Int,
    val textSecondary: Int,
    val textTertiary: Int,
    val warning: Int,
    val warningContainer: Int,
    val error: Int,
    val errorContainer: Int,
    val success: Int,
    val successContainer: Int,
    val info: Int,
    val infoContainer: Int,
    val scrim: Int,
    val shadow: Int,
    val isDark: Boolean,
)

object Palettes {
    val light = Palette(
        primary = 0xFF3E9B6E.toInt(),          // سبز ملایم و مدرن
        onPrimary = Color.WHITE,
        primaryContainer = 0xFFE2F2E8.toInt(),
        onPrimaryContainer = 0xFF16503A.toInt(),
        secondary = 0xFF1F5A44.toInt(),        // سبز تیره مکمل
        onSecondary = Color.WHITE,
        background = 0xFFFAF7F0.toInt(),       // سفید مایل به کرم
        surface = Color.WHITE,                 // کارت‌ها
        surfaceVariant = 0xFFF2EEE5.toInt(),
        outline = 0xFFE7E2D7.toInt(),
        textPrimary = 0xFF1E2320.toInt(),      // خاکستری بسیار تیره
        textSecondary = 0xFF666D68.toInt(),    // خاکستری متوسط
        textTertiary = 0xFF969D98.toInt(),
        warning = 0xFFD9822B.toInt(),          // نارنجی ملایم
        warningContainer = 0xFFFCEFDF.toInt(),
        error = 0xFFC2453D.toInt(),            // قرمز کنترل‌شده
        errorContainer = 0xFFFBE7E4.toInt(),
        success = 0xFF2E8B57.toInt(),
        successContainer = 0xFFE1F3E8.toInt(),
        info = 0xFF3D7AA8.toInt(),
        infoContainer = 0xFFE5EFF7.toInt(),
        scrim = 0x66101412,
        shadow = 0x33284034,
        isDark = false,
    )

    val dark = Palette(
        primary = 0xFF6CC69A.toInt(),
        onPrimary = 0xFF0C2A1D.toInt(),
        primaryContainer = 0xFF1C3B2D.toInt(),
        onPrimaryContainer = 0xFFBFE8D2.toInt(),
        secondary = 0xFF9FD8BB.toInt(),
        onSecondary = 0xFF0C2A1D.toInt(),
        background = 0xFF111513.toInt(),
        surface = 0xFF1A1F1C.toInt(),
        surfaceVariant = 0xFF242A26.toInt(),
        outline = 0xFF2F3632.toInt(),
        textPrimary = 0xFFEAEEEB.toInt(),
        textSecondary = 0xFFA8B0AB.toInt(),
        textTertiary = 0xFF7B847F.toInt(),
        warning = 0xFFF0A65C.toInt(),
        warningContainer = 0xFF3A2C1C.toInt(),
        error = 0xFFEF8077.toInt(),
        errorContainer = 0xFF3D2220.toInt(),
        success = 0xFF67C48F.toInt(),
        successContainer = 0xFF1B3426.toInt(),
        info = 0xFF8DBDE3.toInt(),
        infoContainer = 0xFF1D2C38.toInt(),
        scrim = 0x99000000.toInt(),
        shadow = 0x00000000,
        isDark = true,
    )
}

/** فاصله‌گذاری و شعاع‌ها (dp) */
object Dimens {
    const val xxs = 4
    const val xs = 8
    const val sm = 12
    const val md = 16
    const val lg = 20
    const val xl = 24
    const val xxl = 32
    const val screenPadding = 20

    const val radiusSm = 10
    const val radiusMd = 14
    const val radiusLg = 20
    const val radiusXl = 28

    const val touch = 48
    const val buttonHeight = 52
    const val fieldHeight = 52
}

/** مقیاس تایپوگرافی با فونت وزیرمتن */
enum class TextStyle(val sizeSp: Float, val weight: Int, val lineMult: Float) {
    Display(26f, 700, 1.0f),
    Headline(21f, 700, 1.05f),
    Title(18f, 700, 1.05f),
    TitleSmall(16f, 500, 1.05f),
    Body(15f, 400, 1.15f),
    BodyMedium(15f, 500, 1.1f),
    BodySmall(13f, 400, 1.12f),
    Label(13f, 500, 1.05f),
    Caption(12f, 400, 1.1f),
    Overline(11f, 500, 1.0f),
}

object Theme {
    lateinit var c: Palette
        private set
    private lateinit var regular: Typeface
    private lateinit var medium: Typeface
    private lateinit var bold: Typeface

    fun apply(context: Context) {
        val night = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        c = if (night) Palettes.dark else Palettes.light
        if (!::regular.isInitialized) {
            regular = context.resources.getFont(R.font.vazirmatn_regular)
            medium = context.resources.getFont(R.font.vazirmatn_medium)
            bold = context.resources.getFont(R.font.vazirmatn_bold)
        }
    }

    fun font(weight: Int): Typeface = when {
        weight >= 700 -> bold
        weight >= 500 -> medium
        else -> regular
    }

    fun style(tv: TextView, s: TextStyle) {
        tv.typeface = font(s.weight)
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, s.sizeSp)
        tv.setLineSpacing(0f, s.lineMult)
        tv.includeFontPadding = false
    }
}
