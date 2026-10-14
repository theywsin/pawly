package ir.panjeh.petcare.ui.screens

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.widget.LinearLayout
import ir.panjeh.petcare.Graph
import ir.panjeh.petcare.R
import ir.panjeh.petcare.core.Async
import ir.panjeh.petcare.core.Fa
import ir.panjeh.petcare.data.Pet
import ir.panjeh.petcare.data.VaccineStatus
import ir.panjeh.petcare.reminders.AgendaBuilder
import ir.panjeh.petcare.reminders.AgendaItem
import ir.panjeh.petcare.reminders.Notifications
import ir.panjeh.petcare.reminders.ReminderScheduler
import ir.panjeh.petcare.ui.components.InputKind
import ir.panjeh.petcare.ui.components.Scaffold
import ir.panjeh.petcare.ui.components.TextField
import ir.panjeh.petcare.ui.components.Tone
import ir.panjeh.petcare.ui.components.WRAP
import ir.panjeh.petcare.ui.components.add
import ir.panjeh.petcare.ui.components.chip
import ir.panjeh.petcare.ui.components.chipRow
import ir.panjeh.petcare.ui.components.emptyState
import ir.panjeh.petcare.ui.components.errorState
import ir.panjeh.petcare.ui.components.loadingState
import ir.panjeh.petcare.ui.components.notice
import ir.panjeh.petcare.ui.components.sectionHeader
import ir.panjeh.petcare.ui.components.text
import ir.panjeh.petcare.ui.components.vertical
import ir.panjeh.petcare.ui.nav.Host
import ir.panjeh.petcare.ui.nav.Route
import ir.panjeh.petcare.ui.nav.Screen
import ir.panjeh.petcare.ui.nav.Tab
import ir.panjeh.petcare.ui.theme.TextStyle
import ir.panjeh.petcare.ui.theme.Theme
import java.time.LocalDate

/** کادرهای هشدار مربوط به اعلان (مجوز رد شده / هشدار دقیق غیرفعال) */
fun notificationNotices(host: Host): List<View> {
    val ctx = host.context
    val out = ArrayList<View>()
    val prefs = Graph.prefs
    if (!prefs.notificationsEnabled) {
        out += notice(ctx, R.drawable.ic_bell, "اعلان یادآورها در تنظیمات برنامه خاموش است؛ یادآورها فقط اینجا نمایش داده می‌شوند.", Tone.NEUTRAL, "تنظیمات اعلان") {
            host.push(Route.of(Screens.NOTIF_SETTINGS))
        }
    } else if (!Notifications.canPost(ctx)) {
        out += notice(ctx, R.drawable.ic_bell, "اجازه نمایش اعلان داده نشده است؛ یادآورها فقط داخل برنامه دیده می‌شوند.", Tone.WARNING, "فعال‌سازی اعلان") {
            requestOrOpenNotificationSettings(host)
        }
    } else if (!ReminderScheduler.canScheduleExact(ctx)) {
        out += notice(ctx, R.drawable.ic_clock, "«هشدار دقیق» برای برنامه فعال نیست؛ ممکن است اعلان‌ها چند دقیقه دیرتر برسند.", Tone.INFO, "فعال‌سازی") {
            openExactAlarmSettings(host)
        }
    }
    return out
}

fun requestOrOpenNotificationSettings(host: Host) {
    val ctx = host.context
    if (Build.VERSION.SDK_INT >= 33 && !Graph.prefs.notificationPermissionAsked) {
        Graph.prefs.notificationPermissionAsked = true
        host.requestPermission(Manifest.permission.POST_NOTIFICATIONS) { ok ->
            host.toast(if (ok) "اعلان‌ها فعال شد" else "اجازه اعلان داده نشد", if (ok) Tone.SUCCESS else Tone.WARNING)
        }
        return
    }
    try {
        ctx.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName))
    } catch (e: Exception) {
        host.toast("صفحه تنظیمات اعلان باز نشد", Tone.ERROR)
    }
}

fun openExactAlarmSettings(host: Host) {
    val ctx = host.context
    if (Build.VERSION.SDK_INT < 31) return
    try {
        ctx.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${ctx.packageName}")))
    } catch (e: Exception) {
        host.toast("صفحه تنظیمات باز نشد", Tone.ERROR)
    }
}

/** گروه‌بندی موارد برنامه بر اساس روز */
fun agendaGrouped(host: Host, items: List<AgendaItem>, pets: Map<Long, Pet>, onChanged: () -> Unit): List<View> {
    val ctx = host.context
    val out = ArrayList<View>()
    val today = LocalDate.now()
    val overdue = items.filter { it.allDay && Fa.dateOfMillis(it.at).isBefore(today) }
    if (overdue.isNotEmpty()) {
        out += sectionHeader(ctx, "عقب‌افتاده")
        out += listCard(ctx, overdue.map { agendaRow(host, it, pets, showDay = false, onChanged = onChanged) })
    }
    items.filter { it !in overdue }.groupBy { Fa.dateOfMillis(it.at) }.toSortedMap().forEach { (day, list) ->
        val title = when (day) {
            today -> "امروز، ${Fa.dayMonth(day)}"
            today.plusDays(1) -> "فردا، ${Fa.dayMonth(day)}"
            else -> Fa.date(day, withWeekday = true)
        }
        out += sectionHeader(ctx, title)
        out += listCard(ctx, list.map { agendaRow(host, it, pets, showDay = false, onChanged = onChanged) })
    }
    return out
}

/** زبانه «یادآورها» */
class RemindersScreen(host: Host, route: Route) : Screen(host, route) {
    override val tab = Tab.REMINDERS
    private var mode = "upcoming"
    private lateinit var sc: Scaffold
    private lateinit var modeRow: LinearLayout
    private lateinit var body: LinearLayout

    override fun build(): View {
        sc = Scaffold(ctx, "یادآورها", null)
        sc.fab("یادآور جدید") { withPet(host, Graph.prefs.activePetId) { p -> host.push(Route.of(Screens.REMINDER_EDIT, "petId" to p.id)) } }
        val (scroll, row) = chipRow(ctx)
        modeRow = row
        body = vertical(ctx)
        sc.content.add(scroll, bottom = 12)
        sc.content.add(body)
        renderModes()
        return sc.root
    }

    private fun renderModes() {
        modeRow.removeAllViews()
        listOf("upcoming" to "هفت روز آینده", "all" to "همه یادآورها").forEach { (k, l) ->
            modeRow.add(chip(ctx, l, k == mode) { mode = k; renderModes(); onShown() }, w = WRAP, end = 8)
        }
    }

    override fun onShown() {
        body.removeAllViews()
        body.add(loadingState(ctx))
        val m = mode
        load({
            val repo = Graph.repo
            val pets = repo.pets().associateBy { it.id }
            val today = LocalDate.now()
            Triple(pets, if (m == "upcoming") AgendaBuilder.build(repo, today, today.plusDays(6), includeOverdue = true) else emptyList(), if (m == "all") repo.reminders() else emptyList())
        }, onError = { body.removeAllViews(); body.add(errorState(ctx, "یادآورها خوانده نشد.") { onShown() }) }) { (pets, agenda, all) ->
            if (m != mode) return@load
            body.removeAllViews()
            notificationNotices(host).forEach { body.add(it, bottom = 12) }
            if (m == "upcoming") {
                if (agenda.isEmpty()) {
                    body.add(emptyState(ctx, R.drawable.ic_bell, "برنامه‌ای برای هفت روز آینده نیست",
                        "یادآورهای تکرارشونده، نوبت داروها، واکسن‌ها و قرارهای دامپزشکی اینجا نمایش داده می‌شوند.", "یادآور جدید") {
                        withPet(host, Graph.prefs.activePetId) { p -> host.push(Route.of(Screens.REMINDER_EDIT, "petId" to p.id)) }
                    })
                } else {
                    agendaGrouped(host, agenda, pets) { onShown() }.forEach { body.add(it, bottom = 8) }
                }
            } else {
                if (all.isEmpty()) {
                    body.add(emptyState(ctx, R.drawable.ic_bell, "یادآوری ساخته نشده", "برای کارهایی مثل غذا، نظافت، ثبت وزن یا خرید دارو یادآور بسازید."))
                } else {
                    val active = all.filter { it.enabled }
                    val off = all.filter { !it.enabled }
                    if (active.isNotEmpty()) {
                        body.add(sectionHeader(ctx, "فعال"), bottom = 8)
                        body.add(listCard(ctx, active.map { r -> reminderRow(host, r, r.petId?.let { pets[it]?.name }) { on -> toggle(r.id, on) } }), bottom = 12)
                    }
                    if (off.isNotEmpty()) {
                        body.add(sectionHeader(ctx, "غیرفعال"), bottom = 8)
                        body.add(listCard(ctx, off.map { r -> reminderRow(host, r, r.petId?.let { pets[it]?.name }) { on -> toggle(r.id, on) } }))
                    }
                }
                body.add(text(ctx, "نوبت داروها، واکسن‌ها و قرارهای دامپزشکی از بخش «سلامت» مدیریت می‌شوند.", TextStyle.Caption, Theme.c.textTertiary), top = 12)
            }
        }
    }

    private fun toggle(id: Long, on: Boolean) {
        Async.run({ Graph.repo.setReminderEnabled(id, on) }) {
            host.dataChanged()
            host.toast(if (on) "یادآور فعال شد" else "یادآور غیرفعال شد")
            onShown()
        }
    }
}

/** اعلان‌ها و موارد نیازمند توجه (از سربرگ داشبورد) */
class InboxScreen(host: Host, route: Route) : Screen(host, route) {
    private lateinit var sc: Scaffold

    override fun build(): View {
        sc = Scaffold(ctx, "اعلان‌ها و موارد پیش رو", { host.pop() })
        sc.setBody(loadingState(ctx))
        return sc.root
    }

    override fun onShown() {
        load({
            val repo = Graph.repo
            val today = LocalDate.now()
            val pets = repo.pets().associateBy { it.id }
            val agenda = AgendaBuilder.build(repo, today, today.plusDays(3), includeOverdue = true)
            val needResult = repo.scheduledVisits().filter { it.visitAt < System.currentTimeMillis() }
            Triple(pets, agenda, needResult)
        }, onError = { sc.setBody(errorState(ctx, "اطلاعات خوانده نشد.") { onShown() }) }) { (pets, agenda, needResult) ->
            sc.content.removeAllViews()
            notificationNotices(host).forEach { sc.content.add(it, bottom = 12) }
            if (needResult.isNotEmpty()) {
                sc.content.add(sectionHeader(ctx, "نیاز به ثبت نتیجه"), bottom = 8)
                sc.content.add(listCard(ctx, needResult.map { visitRow(host, it, pets[it.petId]?.name) }), bottom = 12)
            }
            if (agenda.isEmpty() && needResult.isEmpty()) {
                sc.content.add(emptyState(ctx, R.drawable.ic_check_circle, "همه چیز مرتب است", "برای سه روز آینده مورد عقب‌افتاده یا برنامه‌ای ثبت نشده است."))
            } else {
                agendaGrouped(host, agenda, pets) { onShown() }.forEach { sc.content.add(it, bottom = 8) }
            }
        }
    }
}

/** زبانه «سلامت»: واکسن، دارو، مراجعه و وزن همه حیوانات یا یک حیوان */
class HealthScreen(host: Host, route: Route) : Screen(host, route) {
    override val tab = Tab.HEALTH
    private var petFilter: Long? = null
    private var section = "vaccines"
    private var query = ""
    private lateinit var sc: Scaffold
    private lateinit var filters: LinearLayout
    private lateinit var sections: LinearLayout
    private lateinit var body: LinearLayout
    private var pets: List<Pet> = emptyList()

    override fun build(): View {
        sc = Scaffold(ctx, "سلامت", null)
        filters = vertical(ctx)
        val (scroll, row) = chipRow(ctx)
        sections = row
        body = vertical(ctx)
        sc.content.add(filters, bottom = 10)
        sc.content.add(scroll, bottom = 14)
        sc.content.add(body)
        renderSections()
        return sc.root
    }

    private fun renderSections() {
        sections.removeAllViews()
        listOf("vaccines" to "واکسن‌ها", "meds" to "داروها", "visits" to "مراجعات", "weight" to "وزن", "records" to "سوابق").forEach { (k, l) ->
            sections.add(chip(ctx, l, k == section) { section = k; renderSections(); refresh() }, w = WRAP, end = 8)
        }
    }

    override fun onShown() {
        load({ Graph.repo.pets() }) { list ->
            pets = list
            if (petFilter != null && list.none { it.id == petFilter }) petFilter = null
            renderFilters()
            refresh()
        }
    }

    private fun renderFilters() {
        filters.removeAllViews()
        if (pets.size > 1) filters.add(petFilterRow(ctx, pets, petFilter, includeAll = true) { petFilter = it; renderFilters(); refresh() })
    }

    private fun refresh() {
        body.removeAllViews()
        if (pets.isEmpty()) {
            body.add(emptyState(ctx, R.drawable.ill_rabbit, "هنوز حیوانی ثبت نشده", "برای ثبت واکسن، دارو، مراجعه و وزن ابتدا یک حیوان اضافه کنید.", "افزودن حیوان", illustration = true) {
                host.push(Route.of(Screens.PET_EDIT))
            })
            return
        }
        body.add(loadingState(ctx))
        val sec = section
        val pf = petFilter ?: pets.singleOrNull()?.id
        val byId = pets.associateBy { it.id }
        val name: (Long) -> String? = { id -> if (pets.size > 1 && petFilter == null) byId[id]?.name else null }
        val onErr: (Throwable) -> Unit = { body.removeAllViews(); body.add(errorState(ctx, "اطلاعات خوانده نشد.") { refresh() }) }
        fun show(views: List<View>) {
            if (sec != section) return
            body.removeAllViews()
            views.forEach { body.add(it, bottom = 12) }
        }
        val repo = Graph.repo
        when (sec) {
            "vaccines" -> load({ repo.vaccines(pf) }, onErr) { list ->
                val views = ArrayList<View>()
                views += smallAdd(ctx, "ثبت واکسن") { withPet(host, pf) { p -> host.push(Route.of(Screens.VACCINE_EDIT, "petId" to p.id)) } }
                val overdue = list.filter { it.isOverdue() }.sortedBy { it.scheduledOn }
                val upcoming = list.filter { it.status == VaccineStatus.PLANNED && !it.isOverdue() }.sortedBy { it.scheduledOn }
                val done = list.filter { it.status == VaccineStatus.DONE }
                if (list.isEmpty()) views += emptyState(ctx, R.drawable.ic_syringe, "واکسنی ثبت نشده", "سوابق واکسن و نوبت‌های بعدی تعیین‌شده توسط دامپزشک را ثبت کنید.")
                if (overdue.isNotEmpty()) { views += sectionHeader(ctx, "عقب‌افتاده"); views += listCard(ctx, overdue.map { vaccineRow(host, it, name(it.petId)) }) }
                if (upcoming.isNotEmpty()) { views += sectionHeader(ctx, "نوبت‌های آینده"); views += listCard(ctx, upcoming.map { vaccineRow(host, it, name(it.petId)) }) }
                if (done.isNotEmpty()) { views += sectionHeader(ctx, "سوابق"); views += listCard(ctx, done.map { vaccineRow(host, it, name(it.petId)) }) }
                show(views)
            }
            "meds" -> load({ repo.medications(pf) }, onErr) { list ->
                val views = ArrayList<View>()
                views += smallAdd(ctx, "افزودن دارو") { withPet(host, pf) { p -> host.push(Route.of(Screens.MED_EDIT, "petId" to p.id)) } }
                val today = LocalDate.now()
                val active = list.filter { it.status == ir.panjeh.petcare.data.MedicationStatus.ACTIVE && (it.endOn == null || !it.endOn.isBefore(today)) }
                val past = list - active.toSet()
                if (list.isEmpty()) views += emptyState(ctx, R.drawable.ic_pill, "دارویی ثبت نشده", "داروهای تجویزشده را طبق نسخه ثبت کنید تا نوبت‌ها یادآوری شوند.")
                if (active.isNotEmpty()) { views += sectionHeader(ctx, "فعال"); views += listCard(ctx, active.map { medicationRow(host, it, name(it.petId)) }) }
                if (past.isNotEmpty()) { views += sectionHeader(ctx, "پایان‌یافته"); views += listCard(ctx, past.map { medicationRow(host, it, name(it.petId)) }) }
                show(views)
            }
            "visits" -> load({ if (query.isBlank()) repo.visits(pf) else repo.searchVisits(pf, query) }, onErr) { list ->
                val views = ArrayList<View>()
                val search = TextField(ctx, "جست‌وجو در مراجعات", "نام مرکز، دامپزشک، علت یا دارو", kind = InputKind.TEXT, maxLength = 60)
                search.value = query
                search.edit.addTextChangedListener(object : TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                    override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                    override fun afterTextChanged(s: Editable?) {
                        val q = s?.toString() ?: ""
                        search.edit.removeCallbacks(searchRunnable)
                        pendingQuery = q
                        search.edit.postDelayed(searchRunnable, 350)
                    }
                })
                views += search.view
                if (query.isNotBlank() && list.isEmpty()) {
                    views += text(ctx, "نتیجه‌ای برای «$query» پیدا نشد.", TextStyle.Body, Theme.c.textSecondary)
                } else {
                    views += visitsSection(host, pf, list, if (pets.size > 1 && petFilter == null) byId else null)
                }
                show(views)
                if (query.isNotBlank()) { search.edit.requestFocus(); search.edit.setSelection(search.edit.text.length) }
            }
            "weight" -> {
                if (pf != null) {
                    load({ repo.weights(pf) }, onErr) { list -> show(weightSection(host, pf, list)) }
                } else {
                    load({ pets.map { it to repo.latestWeight(it.id) } }, onErr) { list ->
                        show(listOf(
                            text(ctx, "برای دیدن نمودار، یک حیوان را از بالا انتخاب کنید.", TextStyle.BodySmall, Theme.c.textSecondary),
                            listCard(ctx, list.map { (p, w) ->
                                ir.panjeh.petcare.ui.components.listRow(ctx, R.drawable.ic_weight, Tone.PRIMARY, p.name,
                                    w?.let { "${Fa.weight(it.grams)} · ${Fa.friendlyDate(Fa.dateOfMillis(it.measuredAt))}" } ?: "وزنی ثبت نشده", chevron = true) {
                                    host.push(Route.of(Screens.WEIGHT, "petId" to p.id))
                                }
                            }),
                        ))
                    }
                }
            }
            "records" -> {
                val target = pf
                if (target == null) {
                    show(listOf(text(ctx, "برای دیدن سوابق سلامت، یک حیوان را از بالا انتخاب کنید.", TextStyle.BodySmall, Theme.c.textSecondary)))
                } else load({ repo.healthRecords(target) }, onErr) { list ->
                    val views = ArrayList<View>()
                    views += smallAdd(ctx, "ثبت سابقه") { host.push(Route.of(Screens.HEALTH_EDIT, "petId" to target)) }
                    views += if (list.isEmpty()) emptyState(ctx, R.drawable.ic_clipboard, "سابقه‌ای ثبت نشده", "علائم، بیماری‌ها، آزمایش‌ها و جراحی‌ها را با تاریخ ثبت کنید.")
                    else listCard(ctx, list.map { healthRow(host, it) })
                    show(views)
                }
            }
        }
    }

    private var pendingQuery = ""
    private val searchRunnable = Runnable {
        if (pendingQuery != query) {
            query = pendingQuery.trim()
            refresh()
        }
    }
}
