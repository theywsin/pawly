package ir.panjeh.petcare.ui.screens

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.view.Gravity
import android.view.View
import ir.panjeh.petcare.Graph
import ir.panjeh.petcare.MainActivity
import ir.panjeh.petcare.R
import ir.panjeh.petcare.core.Async
import ir.panjeh.petcare.core.Fa
import ir.panjeh.petcare.core.JalaliDate
import ir.panjeh.petcare.data.Prefs
import ir.panjeh.petcare.data.backup.BackupCrypto
import ir.panjeh.petcare.data.backup.BackupManager
import ir.panjeh.petcare.reminders.Notifications
import ir.panjeh.petcare.reminders.ReminderScheduler
import ir.panjeh.petcare.ui.components.ButtonKind
import ir.panjeh.petcare.ui.components.Dialogs
import ir.panjeh.petcare.ui.components.InputKind
import ir.panjeh.petcare.ui.components.Scaffold
import ir.panjeh.petcare.ui.components.SwitchRow
import ir.panjeh.petcare.ui.components.TextField
import ir.panjeh.petcare.ui.components.Tone
import ir.panjeh.petcare.ui.components.WRAP
import ir.panjeh.petcare.ui.components.add
import ir.panjeh.petcare.ui.components.badge
import ir.panjeh.petcare.ui.components.button
import ir.panjeh.petcare.ui.components.card
import ir.panjeh.petcare.ui.components.divider
import ir.panjeh.petcare.ui.components.dp
import ir.panjeh.petcare.ui.components.iconBadge
import ir.panjeh.petcare.ui.components.listRow
import ir.panjeh.petcare.ui.components.notice
import ir.panjeh.petcare.ui.components.text
import ir.panjeh.petcare.ui.components.vertical
import ir.panjeh.petcare.ui.nav.Host
import ir.panjeh.petcare.ui.nav.Route
import ir.panjeh.petcare.ui.nav.Screen
import ir.panjeh.petcare.ui.nav.Tab
import ir.panjeh.petcare.ui.theme.TextStyle
import ir.panjeh.petcare.ui.theme.Theme
import java.time.LocalDate

fun appVersion(ctx: android.content.Context): Pair<String, Long> = runCatching {
    val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
    (pi.versionName ?: "") to (if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode else @Suppress("DEPRECATION") pi.versionCode.toLong())
}.getOrDefault("" to 0L)

/** زبانه تنظیمات */
class SettingsScreen(host: Host, route: Route) : Screen(host, route) {
    override val tab = Tab.SETTINGS
    private lateinit var sc: Scaffold

    override fun build(): View {
        sc = Scaffold(ctx, "تنظیمات", null)
        return sc.root
    }

    override fun onShown() = render()

    private fun group(title: String, vararg rows: View): View = vertical(ctx).apply {
        add(text(ctx, title, TextStyle.Label, Theme.c.textSecondary).apply { setPaddingRelative(dp(4), 0, 0, dp(8)) })
        add(listCard(ctx, rows.toList()))
    }

    private fun render() {
        val prefs = Graph.prefs
        val c = sc.content
        c.removeAllViews()
        val owner = prefs.ownerName
        c.add(group("کاربر",
            listRow(ctx, R.drawable.ic_user, Tone.PRIMARY, "اطلاعات کاربر", owner.ifBlank { "نام شما ثبت نشده" }, chevron = true) { host.push(Route.of(Screens.PROFILE)) },
            listRow(ctx, R.drawable.ic_paw, Tone.PRIMARY, "مدیریت حیوانات", "افزودن، ویرایش و حذف پروفایل‌ها", chevron = true) { host.switchTab(Tab.PETS) },
        ), bottom = 20)
        val notifState = when {
            !prefs.notificationsEnabled -> "خاموش"
            !Notifications.canPost(ctx) -> "اجازه داده نشده"
            else -> "روشن"
        }
        c.add(group("یادآور و نمایش",
            listRow(ctx, R.drawable.ic_bell, Tone.PRIMARY, "اعلان‌ها", notifState, chevron = true) { host.push(Route.of(Screens.NOTIF_SETTINGS)) },
            listRow(ctx, R.drawable.ic_moon, Tone.PRIMARY, "قالب نمایش", prefs.themeMode.label, chevron = true) { chooseTheme() },
            listRow(ctx, R.drawable.ic_calendar, Tone.PRIMARY, "نمایش تاریخ", dateStyleLabel(prefs.dateStyle), chevron = true) { chooseDateStyle() },
        ), bottom = 20)
        c.add(group("داده‌ها",
            listRow(ctx, R.drawable.ic_download, Tone.PRIMARY, "نسخه پشتیبان و بازیابی",
                if (prefs.lastBackupAt > 0) "آخرین پشتیبان: ${Fa.friendlyDate(Fa.dateOfMillis(prefs.lastBackupAt))}" else "هنوز نسخه پشتیبان تهیه نشده", chevron = true) {
                host.push(Route.of(Screens.BACKUP))
            },
            listRow(ctx, R.drawable.ic_database, Tone.PRIMARY, "مدیریت داده‌ها", "فضای استفاده‌شده و حذف اطلاعات", chevron = true) { host.push(Route.of(Screens.DATA)) },
        ), bottom = 20)
        val (vName, vCode) = appVersion(ctx)
        c.add(group("پشتیبانی",
            listRow(ctx, R.drawable.ic_help, Tone.PRIMARY, "راهنمای استفاده", null, chevron = true) { host.push(Route.of(Screens.HELP)) },
            listRow(ctx, R.drawable.ic_shield, Tone.PRIMARY, "قوانین و حریم خصوصی", null, chevron = true) { host.push(Route.of(Screens.PRIVACY)) },
            listRow(ctx, R.drawable.ic_info, Tone.PRIMARY, "درباره برنامه", null, chevron = true) { host.push(Route.of(Screens.ABOUT)) },
            listRow(ctx, R.drawable.ic_sparkle, Tone.NEUTRAL, "نسخه برنامه", "${Fa.digitsOnly(vName)} (ساخت ${Fa.num(vCode)})"),
        ))
    }

    private fun dateStyleLabel(s: Fa.DateStyle) = when (s) {
        Fa.DateStyle.LONG -> "بلند — ${Fa.num(JalaliDate.today().day)} ${ir.panjeh.petcare.core.Jalali.MONTHS[JalaliDate.today().month - 1]} ${Fa.num(JalaliDate.today().year)}"
        Fa.DateStyle.NUMERIC -> "عددی — " + Fa.digitsOnly(JalaliDate.today().let { String.format(java.util.Locale.US, "%04d/%02d/%02d", it.year, it.month, it.day) })
    }

    private fun chooseTheme() {
        Dialogs.options(ctx, "قالب نمایش", Prefs.ThemeMode.entries.map { m ->
            Dialogs.Option(m.label, if (m == Graph.prefs.themeMode) R.drawable.ic_check else R.drawable.ic_circle) {
                if (m != Graph.prefs.themeMode) {
                    Graph.prefs.themeMode = m
                    host.recreateForTheme()
                }
            }
        })
    }

    private fun chooseDateStyle() {
        Dialogs.options(ctx, "نمایش تاریخ", Fa.DateStyle.entries.map { s ->
            Dialogs.Option(dateStyleLabel(s), if (s == Graph.prefs.dateStyle) R.drawable.ic_check else R.drawable.ic_circle) {
                Graph.prefs.dateStyle = s
                render()
                host.toast("قالب تاریخ تغییر کرد")
            }
        })
    }
}

/** تنظیمات اعلان‌ها */
class NotificationSettingsScreen(host: Host, route: Route) : Screen(host, route) {
    private lateinit var sc: Scaffold

    override fun build(): View {
        sc = Scaffold(ctx, "اعلان‌ها", { host.pop() })
        return sc.root
    }

    override fun onShown() = render()

    private fun render() {
        val prefs = Graph.prefs
        val c = sc.content
        c.removeAllViews()
        val master = SwitchRow(ctx, "نمایش اعلان یادآورها", "در صورت خاموش بودن، یادآورها فقط داخل برنامه نمایش داده می‌شوند.", prefs.notificationsEnabled) { on ->
            prefs.notificationsEnabled = on
            host.dataChanged()
            if (on) askNotificationsIfNeeded(host)
        }
        c.add(card(ctx, paddingDp = 8).apply { add(master.view) })

        val permOk = Notifications.canPost(ctx)
        c.add(text(ctx, "وضعیت دسترسی‌ها", TextStyle.Label, Theme.c.textSecondary), top = 20, bottom = 8)
        val rows = ArrayList<View>()
        rows += listRow(ctx, R.drawable.ic_bell, if (permOk) Tone.SUCCESS else Tone.WARNING, "اجازه نمایش اعلان",
            if (permOk) "داده شده" else "داده نشده — برای دریافت یادآور خارج از برنامه لازم است",
            badge(ctx, if (permOk) "فعال" else "غیرفعال", if (permOk) Tone.SUCCESS else Tone.WARNING)) {
            requestOrOpenNotificationSettings(host)
        }
        if (Build.VERSION.SDK_INT >= 31) {
            val exact = ReminderScheduler.canScheduleExact(ctx)
            rows += listRow(ctx, R.drawable.ic_clock, if (exact) Tone.SUCCESS else Tone.INFO, "هشدار دقیق",
                if (exact) "یادآورها سر وقت ارسال می‌شوند" else "بدون این اجازه، اعلان ممکن است چند دقیقه دیرتر برسد",
                badge(ctx, if (exact) "فعال" else "غیرفعال", if (exact) Tone.SUCCESS else Tone.NEUTRAL)) {
                openExactAlarmSettings(host)
            }
        }
        c.add(listCard(ctx, rows))

        c.add(text(ctx, "ساعت پیش‌فرض", TextStyle.Label, Theme.c.textSecondary), top = 20, bottom = 8)
        val t = prefs.defaultReminderTime
        c.add(listCard(ctx, listOf(
            listRow(ctx, R.drawable.ic_syringe, Tone.INFO, "ساعت یادآوری نوبت واکسن", "${Fa.time(t)} — در روز تعیین‌شده", chevron = true) {
                android.app.TimePickerDialog(ctx, { _, h, m ->
                    prefs.defaultReminderTime = java.time.LocalTime.of(h, m)
                    host.dataChanged()
                    render()
                }, t.hour, t.minute, true).show()
            },
        )))

        c.add(button(ctx, "ارسال اعلان آزمایشی", ButtonKind.TONAL, R.drawable.ic_bell) {
            if (!Notifications.canPost(ctx)) {
                host.toast("ابتدا اجازه نمایش اعلان را بدهید", Tone.WARNING)
                requestOrOpenNotificationSettings(host)
            } else {
                Notifications.show(ctx, 4242, Notifications.CH_REMINDERS, "اعلان آزمایشی ${ctx.getString(R.string.app_name)}",
                    "اعلان‌ها به‌درستی کار می‌کنند.", null, "", "reminders")
                host.toast("اعلان آزمایشی ارسال شد")
            }
        }, top = 20)
        c.add(notice(ctx, R.drawable.ic_info,
            "برخی گوشی‌ها برای صرفه‌جویی در باتری، اعلان برنامه‌ها را محدود می‌کنند. اگر یادآورها نمی‌رسند، «بهینه‌سازی باتری» را برای این برنامه غیرفعال کنید. پس از خاموش و روشن شدن گوشی، یادآورها به‌طور خودکار دوباره زمان‌بندی می‌شوند.",
            Tone.NEUTRAL), top = 16)
    }
}

/** اطلاعات کاربر (بدون حساب کاربری آنلاین) */
class ProfileScreen(host: Host, route: Route) : Screen(host, route) {
    override fun build(): View {
        val sc = Scaffold(ctx, "اطلاعات کاربر", { host.pop() })
        val name = TextField(ctx, "نام شما", "برای خوشامدگویی در داشبورد", kind = InputKind.NAME, maxLength = 40)
        name.value = Graph.prefs.ownerName
        sc.content.add(name.view)
        sc.content.add(notice(ctx, R.drawable.ic_lock, "این نسخه حساب کاربری آنلاین و همگام‌سازی ابری ندارد. همه اطلاعات فقط روی همین گوشی ذخیره می‌شود؛ برای انتقال به گوشی دیگر از «نسخه پشتیبان» استفاده کنید.", Tone.INFO), top = 16)
        sc.bottomActions(button(ctx, "ذخیره", ButtonKind.PRIMARY) {
            Graph.prefs.ownerName = name.value
            host.toast("ذخیره شد")
            host.pop()
        })
        return sc.root
    }
}

/** نسخه پشتیبان و بازیابی */
class BackupScreen(host: Host, route: Route) : Screen(host, route) {
    private val restoreMode = route.string("mode") == "restore"
    private lateinit var sc: Scaffold

    private fun manager() = BackupManager(ctx, Graph.repo, Graph.prefs, Graph.files, appVersion(ctx).first)

    override fun build(): View {
        sc = Scaffold(ctx, if (restoreMode) "بازیابی اطلاعات" else "نسخه پشتیبان و بازیابی", { host.pop() })
        render()
        return sc.root
    }

    private fun render() {
        val c = sc.content
        c.removeAllViews()
        if (!restoreMode) {
            c.add(card(ctx).apply {
                add(iconBadge(ctx, R.drawable.ic_download, Tone.PRIMARY, 48, 24, 16), w = ctx.dp(48), h = ctx.dp(48))
                add(text(ctx, "تهیه نسخه پشتیبان", TextStyle.Title), top = 12)
                add(text(ctx, "همه حیوانات، سوابق، یادآورها، تصاویر و اسناد در یک فایل رمزدار ذخیره می‌شوند. محل ذخیره (حافظه گوشی، کارت حافظه یا هر جای دیگر) را خودتان انتخاب می‌کنید.", TextStyle.Body, Theme.c.textSecondary), top = 4)
                val last = Graph.prefs.lastBackupAt
                if (last > 0) add(text(ctx, "آخرین پشتیبان: ${Fa.dateTime(last)}", TextStyle.Caption, Theme.c.textTertiary), top = 8)
                add(button(ctx, "تهیه نسخه پشتیبان", ButtonKind.PRIMARY, R.drawable.ic_download) { startBackup() }, top = 14)
            })
        }
        c.add(card(ctx).apply {
            add(iconBadge(ctx, R.drawable.ic_upload, Tone.INFO, 48, 24, 16), w = ctx.dp(48), h = ctx.dp(48))
            add(text(ctx, "بازیابی از نسخه پشتیبان", TextStyle.Title), top = 12)
            add(text(ctx, "فایل پشتیبانی را که قبلاً با همین برنامه ساخته‌اید انتخاب و رمز آن را وارد کنید. اطلاعات فعلی این گوشی با اطلاعات فایل جایگزین می‌شود.", TextStyle.Body, Theme.c.textSecondary), top = 4)
            add(button(ctx, "انتخاب فایل پشتیبان", if (restoreMode) ButtonKind.PRIMARY else ButtonKind.OUTLINE, R.drawable.ic_upload) { startRestore() }, top = 14)
        }, top = if (restoreMode) 0 else 16)
        c.add(notice(ctx, R.drawable.ic_lock,
            "امنیت: فایل پشتیبان با رمزنگاری قوی ۲۵۶ بیتی و رمزی که خودتان انتخاب می‌کنید محافظت می‌شود. رمز در هیچ‌جا ذخیره نمی‌شود و بدون آن امکان بازیابی وجود ندارد؛ آن را فراموش نکنید.",
            Tone.INFO), top = 16)
        c.add(text(ctx, "برنامه هیچ اطلاعاتی را به اینترنت ارسال نمی‌کند و همگام‌سازی ابری ندارد.", TextStyle.Caption, Theme.c.textTertiary), top = 12)
    }

    private fun startBackup() {
        Dialogs.password(ctx, "رمز نسخه پشتیبان", "این رمز برای بازیابی لازم است. آن را در جای امنی یادداشت کنید.", confirmTwice = true) { pass ->
            val j = JalaliDate.today()
            val fileName = String.format(java.util.Locale.US, "panjeh-backup-%04d-%02d-%02d.%s", j.year, j.month, j.day, BackupManager.EXTENSION)
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = BackupManager.MIME
                putExtra(Intent.EXTRA_TITLE, fileName)
            }
            val ok = host.startForResult(intent) { code, data ->
                val uri = data?.data
                if (code != Activity.RESULT_OK || uri == null) { pass.fill(' '); return@startForResult }
                val progress = Dialogs.progress(ctx, "در حال تهیه نسخه پشتیبان…")
                Async.run({ manager().export(uri, pass) }, onError = {
                    pass.fill(' ')
                    progress.dismiss()
                    host.toast("نسخه پشتیبان ساخته نشد. فضای ذخیره‌سازی را بررسی کنید.", Tone.ERROR)
                }) { s ->
                    pass.fill(' ')
                    progress.dismiss()
                    Dialogs.message(ctx, "نسخه پشتیبان آماده شد",
                        "${Fa.num(s.pets)} حیوان، ${Fa.num(s.records)} سابقه و ${Fa.num(s.files)} فایل در نسخه پشتیبان ذخیره شد.")
                    if (alive) render()
                }
            }
            if (!ok) host.toast("برنامه مدیریت فایل در دسترس نیست", Tone.ERROR)
        }
    }

    private fun startRestore() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        val ok = host.startForResult(intent) { code, data ->
            val uri = data?.data
            if (code != Activity.RESULT_OK || uri == null) return@startForResult
            Dialogs.password(ctx, "رمز نسخه پشتیبان", "رمزی را که هنگام تهیه این نسخه انتخاب کرده بودید وارد کنید.", confirmTwice = false) { pass ->
                Async.run({ Graph.repo.petCount() }) { count ->
                    val go = {
                        val progress = Dialogs.progress(ctx, "در حال بازیابی اطلاعات…")
                        Async.run({
                            val s = manager().restore(uri, pass)
                            ReminderScheduler.sync(ctx.applicationContext)
                            s
                        }, onError = { e ->
                            pass.fill(' ')
                            progress.dismiss()
                            host.toast(
                                when (e) {
                                    is BackupCrypto.WrongPasswordOrCorrupt -> "رمز نادرست است یا فایل آسیب دیده است"
                                    is BackupCrypto.NotABackup, is BackupManager.InvalidBackup -> "این فایل، نسخه پشتیبان معتبر این برنامه نیست"
                                    is BackupManager.NewerBackup -> "این نسخه پشتیبان با نسخه جدیدتری از برنامه ساخته شده است"
                                    else -> "بازیابی انجام نشد"
                                },
                                Tone.ERROR,
                            )
                        }) { s ->
                            pass.fill(' ')
                            progress.dismiss()
                            host.toast("${Fa.num(s.pets)} حیوان و ${Fa.num(s.records)} سابقه بازیابی شد")
                            restartApp()
                        }
                    }
                    if (count > 0) {
                        Dialogs.confirm(ctx, "جایگزینی اطلاعات فعلی", "همه اطلاعات فعلی این گوشی با محتوای نسخه پشتیبان جایگزین می‌شود.", "بازیابی", destructive = true) { go() }
                    } else go()
                }
            }
        }
        if (!ok) host.toast("برنامه مدیریت فایل در دسترس نیست", Tone.ERROR)
    }

    private fun restartApp() {
        val a = ctx as? Activity ?: return
        a.startActivity(Intent(a, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        a.finish()
    }
}

/** مدیریت داده‌ها */
class DataScreen(host: Host, route: Route) : Screen(host, route) {
    private lateinit var sc: Scaffold

    override fun build(): View {
        sc = Scaffold(ctx, "مدیریت داده‌ها", { host.pop() })
        return sc.root
    }

    override fun onShown() {
        load({ Graph.repo.counts() to Graph.files.totalSizeBytes() }) { (counts, bytes) ->
            val c = sc.content
            c.removeAllViews()
            val labels = linkedMapOf(
                "pets" to "حیوانات", "vaccines" to "واکسن‌ها", "medications" to "داروها", "vet_visits" to "مراجعات",
                "weights" to "اندازه‌گیری وزن", "reminders" to "یادآورها", "health_records" to "سوابق سلامت",
                "care_logs" to "ثبت‌های مراقبت", "documents" to "اسناد",
            )
            c.add(card(ctx).apply {
                add(text(ctx, "اطلاعات ذخیره‌شده روی این گوشی", TextStyle.TitleSmall), bottom = 8)
                labels.entries.forEachIndexed { i, (k, l) ->
                    if (i > 0) add(divider(ctx))
                    val row = ir.panjeh.petcare.ui.components.horizontal(ctx).apply { setPaddingRelative(0, dp(10), 0, dp(10)) }
                    row.add(text(ctx, l, TextStyle.Body), w = 0, weight = 1f)
                    row.add(text(ctx, Fa.num(counts[k] ?: 0L), TextStyle.BodyMedium), w = WRAP)
                    add(row)
                }
                add(divider(ctx))
                val mb = bytes / 1024.0 / 1024.0
                add(text(ctx, "فضای تصاویر و اسناد: ${Fa.decimal(mb, 1)} مگابایت", TextStyle.BodySmall, Theme.c.textSecondary), top = 10)
            })
            c.add(notice(ctx, R.drawable.ic_lock, "اطلاعات در حافظه خصوصی برنامه نگهداری می‌شود و برنامه‌های دیگر به آن دسترسی ندارند. پشتیبان‌گیری خودکار ابری سیستم برای این برنامه غیرفعال است.", Tone.INFO), top = 16)
            c.add(button(ctx, "تهیه نسخه پشتیبان", ButtonKind.TONAL, R.drawable.ic_download) { host.push(Route.of(Screens.BACKUP)) }, top = 16)
            c.add(button(ctx, "حذف همه اطلاعات", ButtonKind.DANGER, R.drawable.ic_trash) { confirmWipe() }, top = 10)
        }
    }

    private fun confirmWipe() {
        Dialogs.confirm(ctx, "حذف همه اطلاعات؟", "همه حیوانات، سوابق، یادآورها، تصاویر، اسناد و تنظیمات از این گوشی پاک می‌شود. اگر نسخه پشتیبان ندارید، این اطلاعات قابل بازگشت نیست.", "ادامه", destructive = true) {
            Dialogs.confirm(ctx, "تأیید نهایی", "آیا مطمئن هستید؟ این کار قابل بازگشت نیست.", "بله، همه را حذف کن", destructive = true) {
                val progress = Dialogs.progress(ctx, "در حال حذف اطلاعات…")
                Async.run({
                    Graph.repo.wipeAll()
                    Graph.files.wipe()
                    Graph.prefs.clear()
                    ReminderScheduler.sync(ctx.applicationContext)
                    (ctx.getSystemService(android.app.NotificationManager::class.java))?.cancelAll()
                }, onError = { progress.dismiss(); host.toast("حذف کامل انجام نشد", Tone.ERROR) }) {
                    progress.dismiss()
                    val a = ctx as Activity
                    a.startActivity(Intent(a, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
                    a.finish()
                }
            }
        }
    }
}

/** راهنما و حریم خصوصی */
class InfoScreen(host: Host, route: Route, private val kind: Kind) : Screen(host, route) {
    enum class Kind { HELP, PRIVACY }

    override fun build(): View {
        val sc = Scaffold(ctx, if (kind == Kind.HELP) "راهنمای استفاده" else "قوانین و حریم خصوصی", { host.pop() })
        val sections = if (kind == Kind.HELP) HELP else PRIVACY
        sections.forEach { (title, body) ->
            sc.content.add(card(ctx).apply {
                add(text(ctx, title, TextStyle.TitleSmall))
                add(text(ctx, body, TextStyle.Body, Theme.c.textSecondary), top = 6)
            }, bottom = 12)
        }
        if (kind == Kind.PRIVACY) {
            sc.content.add(text(ctx, "آخرین به‌روزرسانی: ${Fa.date(LocalDate.of(2026, 10, 14))}", TextStyle.Caption, Theme.c.textTertiary), top = 4)
        }
        return sc.root
    }

    companion object {
        val HELP = listOf(
            "شروع کار" to "از زبانه «حیوانات من» برای هر حیوان یک پروفایل بسازید. فقط نام و نوع حیوان ضروری است و بقیه اطلاعات را هر زمان خواستید تکمیل کنید.",
            "داشبورد" to "در «خانه» حیوان فعال، برنامه امروز و خلاصه سلامت را می‌بینید. اگر چند حیوان دارید، از ردیف تصاویر بالای صفحه بین آن‌ها جابه‌جا شوید. میان‌برها برای ثبت سریع واکسن، یادآور، وزن، مراجعه و دارو هستند.",
            "واکسن" to "واکسن تزریق‌شده را با تاریخ ثبت کنید و اگر دامپزشک تاریخ نوبت بعدی را گفته، آن را هم وارد کنید تا یادآوری شود. برنامه به‌طور خودکار زمان واکسن تعیین نمی‌کند. با «ثبت انجام شدن» یک نوبت برنامه‌ریزی‌شده را تکمیل کنید.",
            "دارو" to "نام دارو، مقدار تجویزشده (دقیقاً طبق نسخه)، ساعت‌های مصرف و دوره درمان را وارد کنید. در زمان هر نوبت اعلان می‌گیرید و می‌توانید «مصرف شد» یا «داده نشد» را ثبت کنید. اگر نوبتی فراموش شد، دوز بعدی را دوبرابر نکنید و با دامپزشک مشورت کنید.",
            "مراجعات دامپزشکی" to "مراجعه انجام‌شده را با علت، علائم، نتیجه معاینه، داروها و هزینه ثبت کنید. برای نوبت آینده، «نوبت آینده» را انتخاب کنید تا قبل از آن یادآوری شود. از زبانه «سلامت» می‌توانید در سوابق جست‌وجو کنید.",
            "وزن" to "وزن را به کیلوگرم یا گرم ثبت کنید؛ با دو اندازه‌گیری یا بیشتر نمودار روند نمایش داده می‌شود.",
            "یادآورها" to "برای کارهای تکراری مثل غذا، نظافت یا ثبت وزن یادآور بسازید (روزانه، هر چند روز، هفتگی، ماهانه یا سالانه بر اساس تقویم شمسی). با لمس دایره کنار هر مورد آن را «انجام شد» علامت بزنید.",
            "اسناد" to "گواهی واکسن، نسخه و نتیجه آزمایش را از گالری، دوربین یا فایل‌ها اضافه کنید. فایل‌ها در حافظه خصوصی برنامه نگهداری می‌شوند.",
            "اگر اعلان نمی‌رسد" to "از «تنظیمات › اعلان‌ها» اجازه اعلان و «هشدار دقیق» را بررسی کنید و «اعلان آزمایشی» بفرستید. در برخی گوشی‌ها لازم است بهینه‌سازی باتری برای برنامه غیرفعال شود.",
            "نسخه پشتیبان" to "از «تنظیمات › نسخه پشتیبان و بازیابی» یک فایل رمزدار بسازید و آن را در جای امن نگه دارید. برای انتقال به گوشی جدید، برنامه را نصب کنید، «قبلاً از برنامه استفاده کرده‌ام» را بزنید و فایل را با همان رمز بازیابی کنید.",
        )
        val PRIVACY = listOf(
            "خلاصه" to "این برنامه برای کار به اینترنت نیاز ندارد و مجوز دسترسی به اینترنت را هم درخواست نمی‌کند. هیچ اطلاعاتی به سرور، شبکه تبلیغاتی یا سرویس تحلیل آماری ارسال نمی‌شود.",
            "اطلاعاتی که ذخیره می‌شود" to "اطلاعاتی که خودتان وارد می‌کنید (پروفایل حیوانات، سوابق سلامت، واکسن، دارو، مراجعات، وزن، یادآورها، تصاویر و اسناد و نام شما) فقط در حافظه خصوصی همین گوشی ذخیره می‌شود و برنامه‌های دیگر به آن دسترسی ندارند.",
            "مجوزها" to "اعلان: برای نمایش یادآورها. هشدار دقیق: برای ارسال یادآور سر وقت. اجرا پس از روشن شدن گوشی: برای بازیابی زمان‌بندی یادآورها. برنامه به دوربین و حافظه مستقیماً دسترسی ندارد؛ تصاویر و فایل‌ها فقط از طریق انتخابگر سیستم و با انتخاب خود شما وارد می‌شوند.",
            "نسخه پشتیبان" to "نسخه پشتیبان فقط با درخواست شما و در محلی که خودتان انتخاب می‌کنید ساخته می‌شود و با رمز شما (رمزنگاری قوی ۲۵۶ بیتی) رمزنگاری می‌شود. پشتیبان‌گیری خودکار ابری سیستم اندروید برای این برنامه غیرفعال است.",
            "حذف اطلاعات" to "از «تنظیمات › مدیریت داده‌ها» می‌توانید همه اطلاعات را حذف کنید. حذف برنامه نیز همه اطلاعات ذخیره‌شده در آن را پاک می‌کند.",
            "توصیه پزشکی" to "این برنامه ابزار ثبت و یادآوری است و تشخیص، درمان، دوز دارو یا برنامه واکسن پیشنهاد نمی‌دهد. همیشه از دامپزشک خود پیروی کنید.",
        )
    }
}

/** درباره برنامه */
class AboutScreen(host: Host, route: Route) : Screen(host, route) {
    override fun build(): View {
        val sc = Scaffold(ctx, "درباره برنامه", { host.pop() })
        val (vName, vCode) = appVersion(ctx)
        val head = vertical(ctx).apply { gravity = Gravity.CENTER_HORIZONTAL; setPaddingRelative(0, dp(12), 0, dp(12)) }
        head.add(brandMark(ctx, 72), w = ctx.dp(72), h = ctx.dp(72))
        head.add(text(ctx, ctx.getString(R.string.app_name), TextStyle.Headline, center = true), top = 12)
        head.add(text(ctx, ctx.getString(R.string.app_tagline), TextStyle.Body, Theme.c.textSecondary, center = true), top = 2)
        head.add(text(ctx, "نسخه ${Fa.digitsOnly(vName)} · ساخت ${Fa.num(vCode)}", TextStyle.Caption, Theme.c.textTertiary, center = true), top = 6)
        sc.content.add(head)
        sc.content.add(card(ctx).apply {
            add(text(ctx, "«${ctx.getString(R.string.app_name)}» به شما کمک می‌کند سلامت، واکسن‌ها، داروها، مراجعات دامپزشکی، وزن و مدارک حیوانات خانگی‌تان را منظم نگه دارید و به‌موقع یادآوری بگیرید. همه اطلاعات فقط روی گوشی خودتان ذخیره می‌شود.", TextStyle.Body))
        }, top = 8)
        sc.content.add(card(ctx).apply {
            add(text(ctx, "منابع متن‌باز", TextStyle.TitleSmall))
            add(text(ctx, "فونت وزیرمتن — مجوز آزاد فونت «اُ اِف اِل» نسخه ۱٫۱\nطراحی آیکون‌ها بر پایه مجموعه آیکون متن‌باز «لوسید» — مجوز «آی‌اس‌سی»", TextStyle.BodySmall, Theme.c.textSecondary), top = 6)
        }, top = 12)
        return sc.root
    }
}
