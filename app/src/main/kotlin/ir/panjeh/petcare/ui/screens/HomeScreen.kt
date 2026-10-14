package ir.panjeh.petcare.ui.screens

import android.Manifest
import android.os.Build
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import ir.panjeh.petcare.Graph
import ir.panjeh.petcare.R
import ir.panjeh.petcare.core.Fa
import ir.panjeh.petcare.data.Pet
import ir.panjeh.petcare.data.Species
import ir.panjeh.petcare.data.Vaccine
import ir.panjeh.petcare.data.VetVisit
import ir.panjeh.petcare.data.WeightEntry
import ir.panjeh.petcare.reminders.AgendaBuilder
import ir.panjeh.petcare.reminders.AgendaItem
import ir.panjeh.petcare.reminders.Notifications
import ir.panjeh.petcare.ui.components.ButtonKind
import ir.panjeh.petcare.ui.components.MATCH
import ir.panjeh.petcare.ui.components.PetAvatar
import ir.panjeh.petcare.ui.components.Tone
import ir.panjeh.petcare.ui.components.WRAP
import ir.panjeh.petcare.ui.components.add
import ir.panjeh.petcare.ui.components.button
import ir.panjeh.petcare.ui.components.card
import ir.panjeh.petcare.ui.components.clickable
import ir.panjeh.petcare.ui.components.dp
import ir.panjeh.petcare.ui.components.emptyState
import ir.panjeh.petcare.ui.components.errorState
import ir.panjeh.petcare.ui.components.horizontal
import ir.panjeh.petcare.ui.components.iconBadge
import ir.panjeh.petcare.ui.components.iconButton
import ir.panjeh.petcare.ui.components.iconView
import ir.panjeh.petcare.ui.components.loadingState
import ir.panjeh.petcare.ui.components.notice
import ir.panjeh.petcare.ui.components.oval
import ir.panjeh.petcare.ui.components.rounded
import ir.panjeh.petcare.ui.components.sectionHeader
import ir.panjeh.petcare.ui.components.text
import ir.panjeh.petcare.ui.components.vertical
import ir.panjeh.petcare.ui.components.withAlpha
import ir.panjeh.petcare.ui.nav.Host
import ir.panjeh.petcare.ui.nav.Route
import ir.panjeh.petcare.ui.nav.Screen
import ir.panjeh.petcare.ui.nav.Tab
import ir.panjeh.petcare.ui.theme.Dimens
import ir.panjeh.petcare.ui.theme.TextStyle
import ir.panjeh.petcare.ui.theme.Theme
import java.time.LocalDate

/** داشبورد اصلی */
class HomeScreen(host: Host, route: Route) : Screen(host, route) {
    override val tab = Tab.HOME

    private data class Data(
        val pets: List<Pet>,
        val active: Pet?,
        val latestWeight: WeightEntry?,
        val lastVisit: VetVisit?,
        val nextVaccine: Vaccine?,
        val today: List<AgendaItem>,
        val overdueCount: Int,
    )

    private lateinit var body: LinearLayout
    private lateinit var bellDot: View

    override fun build(): View {
        val root = vertical(ctx)
        val header = horizontal(ctx).apply { setPaddingRelative(dp(Dimens.screenPadding), dp(14), dp(10), dp(6)) }
        val greet = vertical(ctx)
        val name = Graph.prefs.ownerName
        greet.add(text(ctx, if (name.isBlank()) "سلام!" else "سلام، $name", TextStyle.Headline, maxLines = 1))
        greet.add(text(ctx, Fa.date(LocalDate.now(), withWeekday = true), TextStyle.BodySmall, Theme.c.textSecondary), top = 2)
        header.add(greet, w = 0, weight = 1f)
        val bell = FrameLayout(ctx)
        bell.addView(iconButton(ctx, R.drawable.ic_bell, "اعلان‌ها و موارد پیش رو", filled = true) { host.push(Route.of(Screens.INBOX)) })
        bellDot = View(ctx).apply {
            background = oval(Theme.c.warning)
            visibility = View.GONE
        }
        bell.addView(bellDot, FrameLayout.LayoutParams(ctx.dp(10), ctx.dp(10), Gravity.TOP or Gravity.END).apply { setMargins(0, ctx.dp(10), ctx.dp(10), 0) })
        header.add(bell, w = ctx.dp(48), h = ctx.dp(48))
        header.add(iconButton(ctx, R.drawable.ic_settings, "تنظیمات", filled = true) { host.switchTab(Tab.SETTINGS) }, w = ctx.dp(48), h = ctx.dp(48), start = 8)
        root.add(header)

        body = vertical(ctx).apply { setPaddingRelative(dp(Dimens.screenPadding), dp(8), dp(Dimens.screenPadding), dp(28)) }
        body.add(loadingState(ctx))
        root.add(ScrollView(ctx).apply { addView(body); isFillViewport = true }, h = 0, weight = 1f)
        return root
    }

    override fun onShown() = refresh()

    private fun refresh() {
        load({
            val repo = Graph.repo
            val pets = repo.pets()
            val activeId = Graph.prefs.activePetId
            val active = pets.firstOrNull { it.id == activeId } ?: pets.firstOrNull()
            val today = LocalDate.now()
            val agenda = AgendaBuilder.build(repo, today, today, includeOverdue = true)
            Data(
                pets, active,
                active?.let { repo.latestWeight(it.id) },
                active?.let { repo.lastDoneVisit(it.id) },
                active?.let { a -> repo.plannedVaccines().firstOrNull { it.petId == a.id } },
                agenda,
                agenda.count { it.kind == AgendaItem.Kind.VACCINE && Fa.dateOfMillis(it.at).isBefore(today) },
            )
        }, onError = {
            body.removeAllViews()
            body.add(errorState(ctx, "اطلاعات داشبورد خوانده نشد.") { refresh() })
        }) { render(it) }
    }

    private fun render(d: Data) {
        body.removeAllViews()
        bellDot.visibility = if (d.overdueCount > 0) View.VISIBLE else View.GONE
        if (d.active == null) {
            body.add(
                card(ctx, paddingDp = 8).apply {
                    add(
                        emptyState(
                            ctx, R.drawable.ill_dog, "اولین حیوان خانگی‌تان را اضافه کنید",
                            "با ساختن پروفایل، می‌توانید واکسن، دارو، وزن و مراجعات او را ثبت کنید.",
                            "افزودن حیوان", illustration = true,
                        ) { host.push(Route.of(Screens.PET_EDIT)) },
                    )
                },
                top = 8,
            )
            body.add(tipsCard(Species.OTHER), top = 20)
            return
        }
        if (d.pets.size > 1) body.add(petSwitcher(d.pets, d.active), bottom = 14)
        body.add(heroCard(d.active, d.latestWeight))
        body.add(quickActions(d.active), top = 20)

        val c = Theme.c
        val needsPermission = Build.VERSION.SDK_INT >= 33 && !Notifications.canPost(ctx) && Graph.prefs.notificationsEnabled
        if (needsPermission && d.today.isNotEmpty()) {
            body.add(
                notice(ctx, R.drawable.ic_bell, "اعلان‌ها خاموش است؛ یادآورها فقط داخل برنامه دیده می‌شوند.", Tone.WARNING, "فعال‌سازی اعلان") {
                    askNotificationPermission()
                },
                top = 20,
            )
        }

        body.add(sectionHeader(ctx, "برنامه امروز", "همه یادآورها") { host.switchTab(Tab.REMINDERS) }, top = 24, bottom = 8)
        if (d.today.isEmpty()) {
            body.add(
                card(ctx).apply {
                    val row = horizontal(ctx)
                    row.add(iconBadge(ctx, R.drawable.ic_sparkle, Tone.PRIMARY, 48, 24, 16), w = ctx.dp(48), h = ctx.dp(48), end = 14)
                    val col = vertical(ctx)
                    col.add(text(ctx, "برای امروز کاری ثبت نشده", TextStyle.TitleSmall))
                    col.add(text(ctx, "برای کارهای تکراری مثل غذا، نظافت یا ثبت وزن یک یادآور بسازید.", TextStyle.BodySmall, c.textSecondary), top = 2)
                    row.add(col, w = 0, weight = 1f)
                    add(row)
                    add(button(ctx, "افزودن یادآور", ButtonKind.TONAL, R.drawable.ic_plus, compact = true) {
                        host.push(Route.of(Screens.REMINDER_EDIT, "petId" to d.active.id))
                    }, w = WRAP, top = 12)
                },
            )
        } else {
            val pets = d.pets.associateBy { it.id }
            val rows = d.today.take(6).map { agendaRow(host, it, pets, showDay = false) { refresh() } }
            body.add(listCard(ctx, rows))
            if (d.today.size > 6) {
                body.add(button(ctx, "مشاهده ${Fa.num(d.today.size - 6)} مورد دیگر", ButtonKind.TEXT, compact = true) { host.switchTab(Tab.REMINDERS) }, w = WRAP, top = 4)
            }
        }

        body.add(sectionHeader(ctx, "خلاصه سلامت ${d.active.name}"), top = 24, bottom = 8)
        val pending = d.today.count { it.state == AgendaItem.State.PENDING }
        val r1 = horizontal(ctx)
        r1.add(
            statCard(R.drawable.ic_weight, "آخرین وزن", d.latestWeight?.let { Fa.weight(it.grams) } ?: "ثبت نشده",
                d.latestWeight?.let { Fa.friendlyDate(Fa.dateOfMillis(it.measuredAt)) }, Tone.PRIMARY) {
                host.push(Route.of(Screens.WEIGHT, "petId" to d.active.id))
            },
            w = 0, weight = 1f, end = 6,
        )
        r1.add(
            statCard(R.drawable.ic_stethoscope, "آخرین مراجعه", d.lastVisit?.let { Fa.friendlyDate(Fa.dateOfMillis(it.visitAt)) } ?: "ثبت نشده",
                d.lastVisit?.reason, Tone.INFO) {
                host.push(Route.of(Screens.PET_PROFILE, "id" to d.active.id, "tab" to "visits"))
            },
            w = 0, weight = 1f, start = 6,
        )
        body.add(r1)
        val r2 = horizontal(ctx)
        val vac = d.nextVaccine
        r2.add(
            statCard(R.drawable.ic_syringe, "نزدیک‌ترین واکسن", vac?.scheduledOn?.let { Fa.friendlyDate(it) } ?: "برنامه‌ای ندارد",
                vac?.name, if (vac?.isOverdue() == true) Tone.WARNING else Tone.INFO) {
                host.push(Route.of(Screens.PET_PROFILE, "id" to d.active.id, "tab" to "vaccines"))
            },
            w = 0, weight = 1f, end = 6,
        )
        r2.add(
            statCard(R.drawable.ic_clipboard, "کارهای باقی‌مانده", if (pending == 0) "همه انجام شد" else "${Fa.num(pending)} کار",
                "برای امروز", if (pending == 0) Tone.SUCCESS else Tone.PRIMARY) {
                host.switchTab(Tab.REMINDERS)
            },
            w = 0, weight = 1f, start = 6,
        )
        body.add(r2, top = 12)

        body.add(tipsCard(d.active.species), top = 24)
    }

    private fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            Graph.prefs.notificationPermissionAsked = true
            host.requestPermission(Manifest.permission.POST_NOTIFICATIONS) { granted ->
                if (granted) host.toast("اعلان‌ها فعال شد") else host.toast("بدون اجازه اعلان، یادآورها فقط داخل برنامه نمایش داده می‌شوند.", Tone.WARNING)
                refresh()
            }
        }
    }

    private fun petSwitcher(pets: List<Pet>, active: Pet): View {
        val (scroll, row) = ir.panjeh.petcare.ui.components.chipRow(ctx)
        pets.forEach { p ->
            val sel = p.id == active.id
            val item = vertical(ctx).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                setPaddingRelative(dp(4), dp(4), dp(4), dp(4))
                contentDescription = "انتخاب ${p.name}"
            }
            val ring = FrameLayout(ctx).apply {
                background = if (sel) oval(Theme.c.primary) else oval(Theme.c.outline)
                setPadding(dp(if (sel) 3 else 1), dp(if (sel) 3 else 1), dp(if (sel) 3 else 1), dp(if (sel) 3 else 1))
            }
            val av = PetAvatar(ctx, 52)
            av.bind(p)
            ring.addView(av, FrameLayout.LayoutParams(MATCH, MATCH))
            item.add(ring, w = ctx.dp(58), h = ctx.dp(58))
            item.add(text(ctx, p.name, TextStyle.Label, if (sel) Theme.c.textPrimary else Theme.c.textSecondary, maxLines = 1, center = true), w = ctx.dp(72), top = 4)
            item.clickable(16) {
                Graph.prefs.activePetId = p.id
                refresh()
            }
            row.add(item, w = WRAP, end = 4)
        }
        val add = vertical(ctx).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            setPaddingRelative(dp(4), dp(4), dp(4), dp(4))
            contentDescription = "افزودن حیوان"
        }
        val plus = FrameLayout(ctx).apply {
            background = rounded(ctx, Theme.c.surface, 29, Theme.c.outline)
            addView(iconView(ctx, R.drawable.ic_plus, Theme.c.primary, 24), FrameLayout.LayoutParams(ctx.dp(24), ctx.dp(24), Gravity.CENTER))
        }
        add.add(plus, w = ctx.dp(58), h = ctx.dp(58))
        add.add(text(ctx, "افزودن", TextStyle.Label, Theme.c.textSecondary, center = true), w = ctx.dp(72), top = 4)
        add.clickable(16) { host.push(Route.of(Screens.PET_EDIT)) }
        row.add(add, w = WRAP)
        return scroll
    }

    /** کارت بزرگ حیوان فعال */
    private fun heroCard(p: Pet, weight: WeightEntry?): View {
        val c = Theme.c
        val heroBg = if (c.isDark) 0xFF1E4434.toInt() else c.secondary
        val onHero = 0xFFFFFFFF.toInt()
        val frame = FrameLayout(ctx).apply {
            background = rounded(ctx, heroBg, 26)
            clipToOutline = true
            outlineProvider = android.view.ViewOutlineProvider.BACKGROUND
            elevation = if (c.isDark) 0f else ctx.dp(3f)
        }
        // دایره‌های تزئینی ملایم
        frame.addView(View(ctx).apply { background = oval(withAlpha(onHero, 0.06f)) }, FrameLayout.LayoutParams(ctx.dp(180), ctx.dp(180), Gravity.BOTTOM or Gravity.END).apply { setMargins(0, 0, -ctx.dp(50), -ctx.dp(70)) })
        frame.addView(View(ctx).apply { background = oval(withAlpha(onHero, 0.05f)) }, FrameLayout.LayoutParams(ctx.dp(90), ctx.dp(90), Gravity.TOP or Gravity.END).apply { setMargins(0, -ctx.dp(30), ctx.dp(60), 0) })

        val row = horizontal(ctx).apply { setPaddingRelative(dp(16), dp(16), dp(16), dp(16)); gravity = Gravity.TOP }
        val av = PetAvatar(ctx, 104, 24)
        av.bind(p)
        row.add(av, w = ctx.dp(104), h = ctx.dp(118), end = 16)
        val col = vertical(ctx)
        col.add(text(ctx, p.name, TextStyle.Headline, onHero, maxLines = 1))
        val kind = listOfNotNull(p.speciesLabel, p.breed?.takeIf { it.isNotBlank() }).joinToString(" · ")
        col.add(text(ctx, kind, TextStyle.BodySmall, withAlpha(onHero, 0.8f), maxLines = 1), top = 2)
        val pills = ir.panjeh.petcare.ui.components.FlowLayout(ctx)
        val age = p.birthDate?.let { Fa.age(it) } ?: "سن نامشخص"
        pills.addView(heroPill(R.drawable.ic_calendar, age))
        pills.addView(heroPill(R.drawable.ic_weight, weight?.let { Fa.weight(it.grams) } ?: "وزن ثبت نشده"))
        col.add(pills, top = 12)
        val open = horizontal(ctx).apply {
            setPaddingRelative(0, dp(12), 0, dp(2))
        }
        open.add(text(ctx, "مشاهده پروفایل", TextStyle.Label, onHero), w = WRAP)
        open.add(iconView(ctx, R.drawable.ic_chevron, onHero, 18), w = ctx.dp(18), h = ctx.dp(18), start = 4)
        col.add(open)
        row.add(col, w = 0, weight = 1f)
        frame.addView(row, FrameLayout.LayoutParams(MATCH, WRAP))
        frame.contentDescription = "پروفایل ${p.name}، $kind، $age"
        frame.clickable(26) { host.push(Route.of(Screens.PET_PROFILE, "id" to p.id)) }
        return frame
    }

    private fun heroPill(icon: Int, label: String): View = horizontal(ctx).apply {
        background = rounded(ctx, withAlpha(0xFFFFFFFF.toInt(), 0.16f), 12)
        setPaddingRelative(dp(8), dp(5), dp(10), dp(5))
        add(iconView(ctx, icon, 0xFFFFFFFF.toInt(), 14), w = ctx.dp(14), h = ctx.dp(14), end = 5)
        add(text(ctx, label, TextStyle.Caption, 0xFFFFFFFF.toInt(), maxLines = 1), w = WRAP)
    }

    private fun quickActions(p: Pet): View {
        data class QA(val icon: Int, val label: String, val route: Route)
        val items = listOf(
            QA(R.drawable.ic_syringe, "ثبت واکسن", Route.of(Screens.VACCINE_EDIT, "petId" to p.id)),
            QA(R.drawable.ic_bell, "افزودن یادآور", Route.of(Screens.REMINDER_EDIT, "petId" to p.id)),
            QA(R.drawable.ic_weight, "ثبت وزن", Route.of(Screens.WEIGHT_EDIT, "petId" to p.id)),
            QA(R.drawable.ic_stethoscope, "ثبت مراجعه", Route.of(Screens.VISIT_EDIT, "petId" to p.id)),
            QA(R.drawable.ic_pill, "افزودن دارو", Route.of(Screens.MED_EDIT, "petId" to p.id)),
        )
        val row = horizontal(ctx).apply { gravity = Gravity.TOP }
        items.forEach { qa ->
            val col = vertical(ctx).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                setPaddingRelative(dp(2), dp(6), dp(2), dp(6))
                contentDescription = qa.label
            }
            val badge = FrameLayout(ctx).apply {
                background = rounded(ctx, Theme.c.surface, 18, Theme.c.outline)
                addView(iconView(ctx, qa.icon, Theme.c.primary, 24), FrameLayout.LayoutParams(ctx.dp(24), ctx.dp(24), Gravity.CENTER))
            }
            col.add(badge, w = ctx.dp(56), h = ctx.dp(56))
            col.add(text(ctx, qa.label, TextStyle.Caption, Theme.c.textPrimary, maxLines = 2, center = true), top = 6)
            col.clickable(16) { host.push(qa.route) }
            row.add(col, w = 0, weight = 1f)
        }
        return row
    }

    private fun statCard(icon: Int, label: String, value: String, sub: String?, tone: Tone, onClick: () -> Unit): View =
        card(ctx, paddingDp = 14).apply {
            minimumHeight = dp(124)
            add(iconBadge(ctx, icon, tone, 36, 18, 12), w = ctx.dp(36), h = ctx.dp(36))
            add(text(ctx, label, TextStyle.Caption, Theme.c.textSecondary), top = 10)
            add(text(ctx, value, TextStyle.TitleSmall, maxLines = 1), top = 2)
            if (!sub.isNullOrBlank()) add(text(ctx, sub, TextStyle.Caption, Theme.c.textTertiary, maxLines = 1), top = 2)
            contentDescription = "$label: $value"
            clickable(Dimens.radiusLg, onClick)
        }

    /** نکات عمومی نگهداری (غیرپزشکی). توصیه درمانی ارائه نمی‌شود. */
    private fun tipsCard(species: Species): View {
        val tips = Tips.forSpecies(species)
        val tip = tips[(LocalDate.now().dayOfYear) % tips.size]
        return card(ctx, color = Theme.c.primaryContainer, elevated = false).apply {
            val row = horizontal(ctx).apply { gravity = Gravity.TOP }
            row.add(iconView(ctx, R.drawable.ic_bulb, Theme.c.onPrimaryContainer, 22), w = ctx.dp(22), h = ctx.dp(22), end = 12)
            val col = vertical(ctx)
            col.add(text(ctx, "نکته مراقبتی امروز", TextStyle.Label, Theme.c.onPrimaryContainer))
            col.add(text(ctx, tip, TextStyle.Body, Theme.c.textPrimary), top = 4)
            col.add(text(ctx, "این نکته عمومی است و جایگزین نظر دامپزشک نیست.", TextStyle.Caption, Theme.c.textSecondary), top = 8)
            row.add(col, w = 0, weight = 1f)
            add(row)
        }
    }
}

/**
 * نکات عمومی و غیردرمانی. عمداً هیچ دوز دارو، رژیم غذایی یا برنامه واکسن خاصی پیشنهاد نمی‌شود.
 */
object Tips {
    private val common = listOf(
        "تاریخ نوبت بعدی واکسن را همان روز مراجعه از دامپزشک بپرسید و در برنامه ثبت کنید.",
        "هنگام مراجعه به دامپزشک، سوابق واکسن و داروهای فعلی را همراه داشته باشید.",
        "اگر نوبتی از دارو فراموش شد، آن را دوبرابر نکنید و با دامپزشک مشورت کنید.",
        "وزن کردن منظم در یک ساعت مشخص از روز، مقایسه وزن‌ها را دقیق‌تر می‌کند.",
        "شماره تماس دامپزشک را در پروفایل حیوان ثبت کنید تا در مواقع لازم در دسترس باشد.",
        "از اطلاعات برنامه به‌صورت دوره‌ای نسخه پشتیبان رمزدار تهیه کنید.",
        "هر تغییر غیرعادی در اشتها، رفتار یا مدفوع را با تاریخ در «سوابق سلامت» یادداشت کنید.",
    )
    private val specific = mapOf(
        Species.DOG to listOf("زمان پیاده‌روی‌ها را در بخش مراقبت ثبت کنید تا روند فعالیت روزانه را ببینید."),
        Species.CAT to listOf("تمیز کردن ظرف خاک را می‌توانید به‌صورت یادآور تکرارشونده تعریف کنید."),
        Species.BIRD to listOf("برای پرندگان کوچک، ثبت وزن به گرم تغییرات جزئی را بهتر نشان می‌دهد."),
        Species.RABBIT to listOf("زمان تعویض بستر و نظافت قفس را با یادآور تکرارشونده مدیریت کنید."),
    )

    fun forSpecies(s: Species): List<String> = (specific[s] ?: emptyList()) + common
}
