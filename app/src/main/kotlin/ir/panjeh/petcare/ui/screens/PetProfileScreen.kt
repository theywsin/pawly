package ir.panjeh.petcare.ui.screens

import android.content.Intent
import android.net.Uri
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import ir.panjeh.petcare.Graph
import ir.panjeh.petcare.R
import ir.panjeh.petcare.core.Async
import ir.panjeh.petcare.core.Fa
import ir.panjeh.petcare.data.CareKind
import ir.panjeh.petcare.data.MedicationStatus
import ir.panjeh.petcare.data.Pet
import ir.panjeh.petcare.data.ReminderType
import ir.panjeh.petcare.data.Sex
import ir.panjeh.petcare.data.VaccineStatus
import ir.panjeh.petcare.data.VisitStatus
import ir.panjeh.petcare.reminders.AgendaBuilder
import ir.panjeh.petcare.ui.components.ButtonKind
import ir.panjeh.petcare.ui.components.Dialogs
import ir.panjeh.petcare.ui.components.PetAvatar
import ir.panjeh.petcare.ui.components.Tone
import ir.panjeh.petcare.ui.components.WRAP
import ir.panjeh.petcare.ui.components.WeightChart
import ir.panjeh.petcare.ui.components.add
import ir.panjeh.petcare.ui.components.badge
import ir.panjeh.petcare.ui.components.button
import ir.panjeh.petcare.ui.components.card
import ir.panjeh.petcare.ui.components.chip
import ir.panjeh.petcare.ui.components.chipRow
import ir.panjeh.petcare.ui.components.dp
import ir.panjeh.petcare.ui.components.emptyState
import ir.panjeh.petcare.ui.components.errorState
import ir.panjeh.petcare.ui.components.horizontal
import ir.panjeh.petcare.ui.components.iconButton
import ir.panjeh.petcare.ui.components.loadingState
import ir.panjeh.petcare.ui.components.notice
import ir.panjeh.petcare.ui.components.sectionHeader
import ir.panjeh.petcare.ui.components.text
import ir.panjeh.petcare.ui.components.topBar
import ir.panjeh.petcare.ui.components.vertical
import ir.panjeh.petcare.ui.nav.Host
import ir.panjeh.petcare.ui.nav.Route
import ir.panjeh.petcare.ui.nav.Screen
import ir.panjeh.petcare.ui.theme.Dimens
import ir.panjeh.petcare.ui.theme.TextStyle
import ir.panjeh.petcare.ui.theme.Theme
import java.time.LocalDate

/** پروفایل اختصاصی هر حیوان با نُه بخش */
class PetProfileScreen(host: Host, route: Route) : Screen(host, route) {
    private val petId = route.long("id")
    private var tabKey = route.string("tab") ?: "overview"
    private var pet: Pet? = null

    private lateinit var header: LinearLayout
    private lateinit var heroBox: LinearLayout
    private lateinit var tabsRow: LinearLayout
    private lateinit var body: LinearLayout
    private lateinit var scroll: android.widget.ScrollView

    private val tabs = listOf(
        "overview" to "نمای کلی", "health" to "سلامت", "vaccines" to "واکسیناسیون", "meds" to "داروها",
        "visits" to "مراجعات", "weight" to "وزن و رشد", "docs" to "اسناد", "reminders" to "یادآورها", "care" to "تغذیه و مراقبت",
    )

    override fun build(): View {
        val root = vertical(ctx)
        header = topBar(ctx, "پروفایل", { host.pop() }, listOf(
            iconButton(ctx, R.drawable.ic_edit, "ویرایش اطلاعات") { host.push(Route.of(Screens.PET_EDIT, "id" to petId)) },
            iconButton(ctx, R.drawable.ic_more, "گزینه‌های بیشتر") { moreOptions() },
        ))
        root.add(header)
        val content = vertical(ctx).apply { setPaddingRelative(0, 0, 0, dp(28)) }
        heroBox = vertical(ctx).apply { setPaddingRelative(dp(Dimens.screenPadding), 0, dp(Dimens.screenPadding), 0) }
        content.add(heroBox)
        val (tabScroll, row) = chipRow(ctx)
        tabsRow = row
        tabScroll.setPaddingRelative(ctx.dp(Dimens.screenPadding), 0, ctx.dp(Dimens.screenPadding), 0)
        content.add(tabScroll, top = 16)
        body = vertical(ctx).apply { setPaddingRelative(dp(Dimens.screenPadding), dp(16), dp(Dimens.screenPadding), 0) }
        content.add(body)
        scroll = android.widget.ScrollView(ctx).apply { addView(content) }
        root.add(scroll, h = 0, weight = 1f)
        heroBox.add(loadingState(ctx))
        return root
    }

    override fun onShown() {
        load({ Graph.repo.pet(petId) to Graph.repo.latestWeight(petId) }, onError = {
            heroBox.removeAllViews()
            heroBox.add(errorState(ctx, "اطلاعات این حیوان خوانده نشد.") { onShown() })
        }) { (p, w) ->
            if (p == null) {
                host.pop()
                return@load
            }
            pet = p
            renderHero(p, w?.grams)
            renderTabs()
            renderTab()
        }
    }

    private fun renderHero(p: Pet, grams: Double?) {
        heroBox.removeAllViews()
        val row = horizontal(ctx)
        val av = PetAvatar(ctx, 120, 28)
        av.bind(p)
        row.add(av, w = ctx.dp(120), h = ctx.dp(120), end = 16)
        val col = vertical(ctx)
        col.add(text(ctx, p.name, TextStyle.Display, maxLines = 1))
        col.add(text(ctx, listOfNotNull(p.speciesLabel, p.breed).joinToString(" · "), TextStyle.Body, Theme.c.textSecondary, maxLines = 2), top = 2)
        val chips = ir.panjeh.petcare.ui.components.FlowLayout(ctx)
        if (p.sex != Sex.UNKNOWN) chips.addView(badge(ctx, p.sex.label, Tone.NEUTRAL))
        chips.addView(badge(ctx, p.birthDate?.let { Fa.age(it) } ?: "سن نامشخص", Tone.PRIMARY))
        if (grams != null) chips.addView(badge(ctx, Fa.weight(grams), Tone.INFO))
        col.add(chips, top = 10)
        row.add(col, w = 0, weight = 1f)
        heroBox.add(row)
    }

    private fun renderTabs() {
        tabsRow.removeAllViews()
        tabs.forEach { (key, label) ->
            tabsRow.add(chip(ctx, label, key == tabKey) {
                tabKey = key
                renderTabs()
                renderTab()
            }, w = WRAP, end = 8)
        }
    }

    private fun renderTab() {
        val p = pet ?: return
        body.removeAllViews()
        body.add(loadingState(ctx))
        val key = tabKey
        val repo = Graph.repo
        val onErr: (Throwable) -> Unit = { body.removeAllViews(); body.add(errorState(ctx, "این بخش خوانده نشد.") { renderTab() }) }
        fun show(vararg v: View) {
            if (key != tabKey) return
            body.removeAllViews()
            v.forEach { body.add(it, bottom = 12) }
        }
        when (key) {
            "overview" -> load({
                val today = LocalDate.now()
                Triple(AgendaBuilder.build(repo, today, today.plusDays(7), includeOverdue = true, petId = p.id), repo.lastDoneVisit(p.id), repo.latestWeight(p.id))
            }, onErr) { (agenda, lastVisit, w) ->
                val views = ArrayList<View>()
                if (!p.allergies.isNullOrBlank()) views += notice(ctx, R.drawable.ic_alert, "حساسیت‌ها: ${p.allergies}", Tone.WARNING)
                if (!p.conditions.isNullOrBlank()) views += notice(ctx, R.drawable.ic_heart_pulse, "بیماری‌های شناخته‌شده: ${p.conditions}", Tone.INFO)
                views += detailCard(ctx, listOf(
                    infoLine(ctx, "تاریخ تولد", p.birthDate?.let { "${Fa.date(it)} (${Fa.age(it)})" }),
                    infoLine(ctx, "آخرین وزن", w?.let { "${Fa.weight(it.grams)} — ${Fa.friendlyDate(Fa.dateOfMillis(it.measuredAt))}" }),
                    infoLine(ctx, "آخرین مراجعه", lastVisit?.let { Fa.date(Fa.dateOfMillis(it.visitAt)) + (it.reason?.let { r -> " — $r" } ?: "") }),
                    infoLine(ctx, "رنگ", p.color),
                    infoLine(ctx, "عقیم‌سازی", when (p.neutered) { true -> "عقیم شده"; false -> "عقیم نشده"; null -> null }),
                    infoLine(ctx, "میکروچیپ / شناسه", p.microchip),
                    infoLine(ctx, "توضیحات", p.notes),
                ).ifEmptyAdd(text(ctx, "جزئیات بیشتری ثبت نشده است.", TextStyle.BodySmall, Theme.c.textSecondary)))
                views += vetCard(p)
                views += sectionHeader(ctx, "هفت روز آینده")
                views += if (agenda.isEmpty()) text(ctx, "برای هفت روز آینده موردی ثبت نشده است.", TextStyle.BodySmall, Theme.c.textSecondary)
                else listCard(ctx, agenda.take(8).map { agendaRow(host, it, mapOf(p.id to p), showDay = true) { renderTab() } })
                show(*views.toTypedArray())
            }
            "health" -> load({ repo.healthRecords(p.id) }, onErr) { list ->
                val views = ArrayList<View>()
                views += detailCard(ctx, listOf(
                    infoLine(ctx, "حساسیت‌ها", p.allergies ?: "ثبت نشده"),
                    infoLine(ctx, "بیماری‌های شناخته‌شده", p.conditions ?: "ثبت نشده"),
                ))
                views += sectionHeader(ctx, "سوابق سلامت", "افزودن") { host.push(Route.of(Screens.HEALTH_EDIT, "petId" to p.id)) }
                views += if (list.isEmpty()) emptyState(ctx, R.drawable.ic_clipboard, "سابقه‌ای ثبت نشده", "علائم مشاهده‌شده، نتایج آزمایش، جراحی‌ها و یادداشت‌های سلامت را اینجا ثبت کنید.", "ثبت سابقه") {
                    host.push(Route.of(Screens.HEALTH_EDIT, "petId" to p.id))
                } else listCard(ctx, list.map { healthRow(host, it) })
                show(*views.toTypedArray())
            }
            "vaccines" -> load({ repo.vaccines(p.id) }, onErr) { list ->
                val planned = list.filter { it.status == VaccineStatus.PLANNED }.sortedBy { it.scheduledOn }
                val done = list.filter { it.status == VaccineStatus.DONE }
                val views = ArrayList<View>()
                views += horizontal(ctx).apply {
                    add(button(ctx, "ثبت واکسن انجام‌شده", ButtonKind.PRIMARY, R.drawable.ic_plus, compact = true) {
                        host.push(Route.of(Screens.VACCINE_EDIT, "petId" to p.id))
                    }, w = 0, weight = 1f, end = 8)
                    add(button(ctx, "برنامه نوبت بعدی", ButtonKind.TONAL, R.drawable.ic_calendar, compact = true) {
                        host.push(Route.of(Screens.VACCINE_EDIT, "petId" to p.id, "planned" to true))
                    }, w = 0, weight = 1f)
                }
                if (list.isEmpty()) {
                    views += emptyState(ctx, R.drawable.ic_syringe, "واکسنی ثبت نشده", "تاریخ واکسن‌های تزریق‌شده و نوبت بعدی که دامپزشک تعیین کرده را ثبت کنید.")
                } else {
                    if (planned.isNotEmpty()) {
                        views += sectionHeader(ctx, "نوبت‌های پیش رو")
                        views += listCard(ctx, planned.map { vaccineRow(host, it, null) })
                    }
                    if (done.isNotEmpty()) {
                        views += sectionHeader(ctx, "سوابق واکسیناسیون")
                        views += listCard(ctx, done.map { vaccineRow(host, it, null) })
                    }
                }
                show(*views.toTypedArray())
            }
            "meds" -> load({ repo.medications(p.id) }, onErr) { list ->
                val today = LocalDate.now()
                val active = list.filter { it.status == MedicationStatus.ACTIVE && (it.endOn == null || !it.endOn.isBefore(today)) }
                val past = list - active.toSet()
                val views = ArrayList<View>()
                views += button(ctx, "افزودن دارو", ButtonKind.PRIMARY, R.drawable.ic_plus, compact = true) { host.push(Route.of(Screens.MED_EDIT, "petId" to p.id)) }
                if (list.isEmpty()) {
                    views += emptyState(ctx, R.drawable.ic_pill, "دارویی ثبت نشده", "داروهای تجویزشده را دقیقاً مطابق نسخه دامپزشک ثبت کنید تا نوبت‌ها را یادآوری کنیم.")
                } else {
                    if (active.isNotEmpty()) { views += sectionHeader(ctx, "داروهای فعال"); views += listCard(ctx, active.map { medicationRow(host, it, null) }) }
                    if (past.isNotEmpty()) { views += sectionHeader(ctx, "داروهای قبلی"); views += listCard(ctx, past.map { medicationRow(host, it, null) }) }
                }
                show(*views.toTypedArray())
            }
            "visits" -> load({ repo.visits(p.id) }, onErr) { list -> show(*visitsSection(host, p.id, list, null) { renderTab() }.toTypedArray()) }
            "weight" -> load({ repo.weights(p.id) }, onErr) { list -> show(*weightSection(host, p.id, list).toTypedArray()) }
            "docs" -> load({ repo.documents(p.id) }, onErr) { list ->
                val views = ArrayList<View>()
                if (list.isEmpty()) views += documentsEmpty(host, p.id)
                else {
                    views += button(ctx, "افزودن سند", ButtonKind.PRIMARY, R.drawable.ic_plus, compact = true) { DocumentPicker.start(host, p.id) }
                    views += listCard(ctx, list.map { documentRow(host, it) })
                }
                show(*views.toTypedArray())
            }
            "reminders" -> load({ repo.reminders(p.id) }, onErr) { list ->
                val views = ArrayList<View>()
                views += button(ctx, "افزودن یادآور", ButtonKind.PRIMARY, R.drawable.ic_plus, compact = true) { host.push(Route.of(Screens.REMINDER_EDIT, "petId" to p.id)) }
                views += if (list.isEmpty()) emptyState(ctx, R.drawable.ic_bell, "یادآوری تعریف نشده", "برای کارهایی مثل غذا، نظافت، ثبت وزن یا دارو یادآور بسازید.")
                else listCard(ctx, list.map { r -> reminderRow(host, r, null) { on -> toggleReminder(r.id, on) } })
                views += text(ctx, "یادآورهای واکسن، دارو و نوبت دامپزشک از بخش مربوط به خودشان مدیریت می‌شوند.", TextStyle.Caption, Theme.c.textTertiary)
                show(*views.toTypedArray())
            }
            "care" -> load({ repo.careLogs(p.id, 60) to repo.reminders(p.id).filter { it.type in setOf(ReminderType.FEEDING, ReminderType.GROOMING, ReminderType.CARE) } }, onErr) { (logs, routines) ->
                val views = ArrayList<View>()
                views += card(ctx).apply {
                    val top = horizontal(ctx)
                    top.add(text(ctx, "برنامه تغذیه", TextStyle.TitleSmall), w = 0, weight = 1f)
                    top.add(button(ctx, "ویرایش", ButtonKind.TEXT, R.drawable.ic_edit, compact = true) { host.push(Route.of(Screens.FEEDING_EDIT, "petId" to p.id)) }, w = WRAP)
                    add(top)
                    val has = !p.foodType.isNullOrBlank() || p.mealsPerDay != null || !p.feedingNotes.isNullOrBlank()
                    if (!has) add(text(ctx, "نوع غذا و تعداد وعده‌هایی که دامپزشک یا خودتان تعیین کرده‌اید را ثبت کنید.", TextStyle.BodySmall, Theme.c.textSecondary), top = 4)
                    infoLine(ctx, "نوع غذا", p.foodType)?.let { add(it) }
                    infoLine(ctx, "تعداد وعده در روز", p.mealsPerDay?.let { Fa.num(it) })?.let { add(it) }
                    infoLine(ctx, "توضیحات تغذیه", p.feedingNotes)?.let { add(it) }
                }
                views += sectionHeader(ctx, "کارهای تکرارشونده", "افزودن") {
                    host.push(Route.of(Screens.REMINDER_EDIT, "petId" to p.id, "type" to ReminderType.FEEDING.name))
                }
                views += if (routines.isEmpty()) text(ctx, "مثلاً «غذای صبح» هر روز ساعت ۰۸:۰۰ یا «شانه کردن» هر هفته.", TextStyle.BodySmall, Theme.c.textSecondary)
                else listCard(ctx, routines.map { r -> reminderRow(host, r, null) { on -> toggleReminder(r.id, on) } })
                views += sectionHeader(ctx, "ثبت روزانه", "ثبت جدید") { host.push(Route.of(Screens.CARE_EDIT, "petId" to p.id)) }
                val quick = horizontal(ctx)
                CareKind.entries.filter { it != CareKind.OTHER }.forEachIndexed { i, k ->
                    quick.add(chip(ctx, k.label, false, careVisual(k)) { host.push(Route.of(Screens.CARE_EDIT, "petId" to p.id, "kind" to k.name)) }, w = WRAP, end = if (i < 2) 8 else 0)
                }
                views += android.widget.HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; addView(quick) }
                views += if (logs.isEmpty()) emptyState(ctx, R.drawable.ic_utensils, "ثبتی وجود ندارد", "وعده‌های غذا، فعالیت‌ها و نظافت روزانه را ثبت کنید.")
                else listCard(ctx, logs.map { careRow(host, it) })
                show(*views.toTypedArray())
            }
        }
    }

    private fun List<View?>.ifEmptyAdd(v: View): List<View?> = if (filterNotNull().isEmpty()) listOf(v) else this

    private fun vetCard(p: Pet): View = card(ctx).apply {
        val row = horizontal(ctx)
        row.add(ir.panjeh.petcare.ui.components.iconBadge(ctx, R.drawable.ic_stethoscope, Tone.INFO), w = ctx.dp(44), h = ctx.dp(44), end = 12)
        val col = vertical(ctx)
        val has = !p.vetName.isNullOrBlank() || !p.vetClinic.isNullOrBlank() || !p.vetPhone.isNullOrBlank()
        col.add(text(ctx, if (has) (p.vetName ?: p.vetClinic ?: "دامپزشک") else "دامپزشک ثبت نشده", TextStyle.BodyMedium))
        val sub = if (has) listOfNotNull(p.vetClinic.takeIf { p.vetName != null }, p.vetPhone?.let { Fa.digitsOnly(it) }).joinToString(" · ")
        else "اطلاعات تماس دامپزشک را در ویرایش پروفایل وارد کنید."
        if (sub.isNotBlank()) col.add(text(ctx, sub, TextStyle.BodySmall, Theme.c.textSecondary), top = 2)
        row.add(col, w = 0, weight = 1f)
        if (!p.vetPhone.isNullOrBlank()) {
            row.add(iconButton(ctx, R.drawable.ic_phone, "تماس با دامپزشک", Theme.c.primary, filled = true) {
                val tel = Fa.normalizeDigits(p.vetPhone).replace(".", "")
                try {
                    ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$tel")))
                } catch (e: Exception) {
                    host.toast("برنامه تلفن در دسترس نیست", Tone.ERROR)
                }
            }, w = ctx.dp(48), h = ctx.dp(48))
        }
        add(row)
    }

    private fun toggleReminder(id: Long, on: Boolean) {
        Async.run({ Graph.repo.setReminderEnabled(id, on) }) {
            host.dataChanged()
            host.toast(if (on) "یادآور فعال شد" else "یادآور غیرفعال شد")
        }
    }

    private fun moreOptions() {
        val p = pet ?: return
        Dialogs.options(ctx, p.name, listOf(
            Dialogs.Option("نمایش در داشبورد", R.drawable.ic_home) {
                Graph.prefs.activePetId = p.id
                host.toast("${p.name} در داشبورد نمایش داده می‌شود")
            },
            Dialogs.Option("حذف این حیوان", R.drawable.ic_trash, Tone.ERROR, "همه سوابق، یادآورها و اسناد او حذف می‌شود") { confirmDelete(p) },
        ))
    }

    private fun confirmDelete(p: Pet) {
        Dialogs.confirm(
            ctx, "حذف ${p.name}؟",
            "پروفایل ${p.name} همراه با همه واکسن‌ها، داروها، مراجعات، وزن‌ها، یادآورها و اسناد او برای همیشه حذف می‌شود. این کار قابل بازگشت نیست.",
            "حذف کامل", destructive = true,
        ) {
            Async.run({
                val repo = Graph.repo
                val files = repo.documents(p.id).map { it.filePath } + listOfNotNull(p.photo)
                repo.deletePet(p.id)
                files.forEach { Graph.files.delete(it) }
                if (Graph.prefs.activePetId == p.id) Graph.prefs.activePetId = 0L
            }, onError = { host.toast("حذف انجام نشد", Tone.ERROR) }) {
                host.dataChanged()
                host.toast("${p.name} حذف شد")
                host.pop()
            }
        }
    }

    override fun onBack(): Boolean = false
}

/** بخش مراجعات (مشترک بین پروفایل و صفحه سلامت) */
fun visitsSection(host: Host, petId: Long?, list: List<ir.panjeh.petcare.data.VetVisit>, pets: Map<Long, Pet>?, onSearch: (() -> Unit)? = null): List<View> {
    val ctx = host.context
    val views = ArrayList<View>()
    views += horizontal(ctx).apply {
        add(button(ctx, "ثبت مراجعه", ButtonKind.PRIMARY, R.drawable.ic_plus, compact = true) {
            withPet(host, petId) { p -> host.push(Route.of(Screens.VISIT_EDIT, "petId" to p.id)) }
        }, w = 0, weight = 1f, end = 8)
        add(button(ctx, "نوبت آینده", ButtonKind.TONAL, R.drawable.ic_calendar, compact = true) {
            withPet(host, petId) { p -> host.push(Route.of(Screens.VISIT_EDIT, "petId" to p.id, "scheduled" to true)) }
        }, w = 0, weight = 1f)
    }
    if (list.isEmpty()) {
        views += emptyState(ctx, R.drawable.ic_stethoscope, "مراجعه‌ای ثبت نشده", "تاریخ، علت مراجعه، نتیجه معاینه و داروهای تجویزشده را ثبت کنید.")
        return views
    }
    val upcoming = list.filter { it.status == VisitStatus.SCHEDULED }.sortedBy { it.visitAt }
    val done = list.filter { it.status == VisitStatus.DONE }
    if (upcoming.isNotEmpty()) {
        views += sectionHeader(ctx, "نوبت‌های رزروشده")
        views += listCard(ctx, upcoming.map { visitRow(host, it, pets?.get(it.petId)?.name) })
    }
    if (done.isNotEmpty()) {
        views += sectionHeader(ctx, "تاریخچه مراجعات")
        views += listCard(ctx, done.map { visitRow(host, it, pets?.get(it.petId)?.name) })
        val total = done.mapNotNull { it.costToman }.sum()
        if (total > 0) views += text(ctx, "مجموع هزینه‌های ثبت‌شده: ${Fa.toman(total)}", TextStyle.Caption, Theme.c.textSecondary)
    }
    onSearch?.let { }
    return views
}

/** بخش وزن و رشد (مشترک) */
fun weightSection(host: Host, petId: Long, list: List<ir.panjeh.petcare.data.WeightEntry>): List<View> {
    val ctx = host.context
    val views = ArrayList<View>()
    views += button(ctx, "ثبت وزن جدید", ButtonKind.PRIMARY, R.drawable.ic_plus, compact = true) { host.push(Route.of(Screens.WEIGHT_EDIT, "petId" to petId)) }
    if (list.isEmpty()) {
        views += emptyState(ctx, R.drawable.ic_weight, "وزنی ثبت نشده", "با ثبت منظم وزن، روند تغییرات را روی نمودار ببینید.")
        return views
    }
    val latest = list.first()
    val oldest = list.last()
    views += card(ctx).apply {
        val top = horizontal(ctx).apply { gravity = Gravity.BOTTOM }
        val col = vertical(ctx)
        col.add(text(ctx, "آخرین وزن ثبت‌شده", TextStyle.Caption, Theme.c.textSecondary))
        col.add(text(ctx, Fa.weight(latest.grams), TextStyle.Headline), top = 2)
        col.add(text(ctx, Fa.date(Fa.dateOfMillis(latest.measuredAt), true), TextStyle.Caption, Theme.c.textTertiary), top = 2)
        top.add(col, w = 0, weight = 1f)
        if (list.size > 1) {
            val diff = latest.grams - list[1].grams
            val trendCol = vertical(ctx).apply { gravity = Gravity.END }
            trendCol.add(text(ctx, "تغییر از قبل", TextStyle.Caption, Theme.c.textSecondary), w = WRAP)
            trendCol.add(badge(ctx, if (diff == 0.0) "بدون تغییر" else Fa.weightDelta(diff), Tone.NEUTRAL), w = WRAP, top = 4)
            top.add(trendCol, w = WRAP)
        }
        add(top)
        if (list.size >= 2) {
            val chart = WeightChart(ctx)
            chart.setData(list)
            add(chart, top = 12)
            val unit = if (list.maxOf { it.grams } >= 1000) "کیلوگرم" else "گرم"
            add(text(ctx, "محور عمودی: $unit · ${Fa.num(minOf(list.size, 24))} اندازه‌گیری اخیر", TextStyle.Caption, Theme.c.textTertiary), top = 4)
            val span = Fa.dateOfMillis(oldest.measuredAt)
            add(text(ctx, "روند کلی از ${Fa.date(span)}: ${Fa.weightDelta(latest.grams - oldest.grams)}", TextStyle.BodySmall, Theme.c.textSecondary), top = 6)
        } else {
            add(text(ctx, "برای نمایش نمودار، حداقل دو اندازه‌گیری لازم است.", TextStyle.BodySmall, Theme.c.textSecondary), top = 10)
        }
    }
    views += text(ctx, "این برنامه درباره سلامت یا بیماری بر اساس وزن قضاوت نمی‌کند؛ برای تفسیر تغییرات با دامپزشک مشورت کنید.", TextStyle.Caption, Theme.c.textTertiary)
    views += sectionHeader(ctx, "وزن‌های قبلی")
    views += listCard(ctx, list.mapIndexed { i, w -> weightRow(host, w, list.getOrNull(i + 1)) })
    return views
}
