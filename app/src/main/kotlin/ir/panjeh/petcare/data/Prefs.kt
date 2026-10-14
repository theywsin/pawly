package ir.panjeh.petcare.data

import android.content.Context
import android.content.SharedPreferences
import ir.panjeh.petcare.core.Fa
import java.time.LocalTime

/** تنظیمات و اطلاعات کاربر (به‌صورت محلی). در نسخه پشتیبان نیز ذخیره می‌شود. */
class Prefs(context: Context) {
    private val sp: SharedPreferences = context.getSharedPreferences("panjeh_settings", Context.MODE_PRIVATE)

    enum class ThemeMode(val label: String) { SYSTEM("مطابق سیستم"), LIGHT("روشن"), DARK("تیره") }

    var onboardingDone: Boolean
        get() = sp.getBoolean(K_ONBOARD, false)
        set(v) = sp.edit().putBoolean(K_ONBOARD, v).apply()

    var ownerName: String
        get() = sp.getString(K_OWNER, "") ?: ""
        set(v) = sp.edit().putString(K_OWNER, v.trim()).apply()

    var themeMode: ThemeMode
        get() = runCatching { ThemeMode.valueOf(sp.getString(K_THEME, ThemeMode.SYSTEM.name)!!) }.getOrDefault(ThemeMode.SYSTEM)
        set(v) = sp.edit().putString(K_THEME, v.name).apply()

    var dateStyle: Fa.DateStyle
        get() = runCatching { Fa.DateStyle.valueOf(sp.getString(K_DATE, Fa.DateStyle.LONG.name)!!) }.getOrDefault(Fa.DateStyle.LONG)
        set(v) {
            sp.edit().putString(K_DATE, v.name).apply()
            Fa.dateStyle = v
        }

    var notificationsEnabled: Boolean
        get() = sp.getBoolean(K_NOTIF, true)
        set(v) = sp.edit().putBoolean(K_NOTIF, v).apply()

    /** ساعت پیش‌فرض یادآوری برای رویدادهای روزانه مانند نوبت واکسن */
    var defaultReminderTime: LocalTime
        get() = LocalTime.ofSecondOfDay(sp.getInt(K_DEFAULT_TIME, 9 * 3600).toLong().coerceIn(0, 86399))
        set(v) = sp.edit().putInt(K_DEFAULT_TIME, v.toSecondOfDay()).apply()

    var activePetId: Long
        get() = sp.getLong(K_ACTIVE_PET, 0L)
        set(v) = sp.edit().putLong(K_ACTIVE_PET, v).apply()

    var notificationPermissionAsked: Boolean
        get() = sp.getBoolean(K_NOTIF_ASKED, false)
        set(v) = sp.edit().putBoolean(K_NOTIF_ASKED, v).apply()

    var lastBackupAt: Long
        get() = sp.getLong(K_LAST_BACKUP, 0L)
        set(v) = sp.edit().putLong(K_LAST_BACKUP, v).apply()

    /** کلیدهایی که در نسخه پشتیبان ذخیره می‌شوند */
    fun exportMap(): Map<String, String> = mapOf(
        K_OWNER to ownerName,
        K_THEME to themeMode.name,
        K_DATE to dateStyle.name,
        K_NOTIF to notificationsEnabled.toString(),
        K_DEFAULT_TIME to defaultReminderTime.toSecondOfDay().toString(),
    )

    fun importMap(m: Map<String, String>) {
        m[K_OWNER]?.let { ownerName = it }
        m[K_THEME]?.let { v -> ThemeMode.entries.firstOrNull { it.name == v }?.let { themeMode = it } }
        m[K_DATE]?.let { v -> Fa.DateStyle.entries.firstOrNull { it.name == v }?.let { dateStyle = it } }
        m[K_NOTIF]?.let { notificationsEnabled = it == "true" }
        m[K_DEFAULT_TIME]?.toIntOrNull()?.let { defaultReminderTime = LocalTime.ofSecondOfDay(it.toLong().coerceIn(0, 86399)) }
    }

    /** پاک کردن کامل تنظیمات (حذف همه داده‌ها) */
    fun clear() = sp.edit().clear().apply()

    private companion object {
        const val K_ONBOARD = "onboarding_done"
        const val K_OWNER = "owner_name"
        const val K_THEME = "theme_mode"
        const val K_DATE = "date_style"
        const val K_NOTIF = "notifications_enabled"
        const val K_DEFAULT_TIME = "default_reminder_time"
        const val K_ACTIVE_PET = "active_pet"
        const val K_NOTIF_ASKED = "notif_permission_asked"
        const val K_LAST_BACKUP = "last_backup_at"
    }
}
