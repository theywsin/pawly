package ir.panjeh.petcare.ui.screens

import android.Manifest
import android.os.Build
import android.view.View
import android.widget.LinearLayout
import ir.panjeh.petcare.Graph
import ir.panjeh.petcare.R
import ir.panjeh.petcare.core.Async
import ir.panjeh.petcare.core.Fa
import ir.panjeh.petcare.data.CareKind
import ir.panjeh.petcare.data.CareLog
import ir.panjeh.petcare.data.DocCategory
import ir.panjeh.petcare.data.DoseStatus
import ir.panjeh.petcare.data.HealthKind
import ir.panjeh.petcare.data.HealthRecord
import ir.panjeh.petcare.data.Medication
import ir.panjeh.petcare.data.MedicationStatus
import ir.panjeh.petcare.data.Pet
import ir.panjeh.petcare.data.Reminder
import ir.panjeh.petcare.data.ReminderType
import ir.panjeh.petcare.data.Repeat
import ir.panjeh.petcare.data.Vaccine
import ir.panjeh.petcare.data.VaccineStatus
import ir.panjeh.petcare.data.VetVisit
import ir.panjeh.petcare.data.VisitStatus
import ir.panjeh.petcare.data.WeightEntry
import ir.panjeh.petcare.reminders.AgendaBuilder
import ir.panjeh.petcare.reminders.Notifications
import ir.panjeh.petcare.reminders.Occurrences
import ir.panjeh.petcare.ui.components.ButtonKind
import ir.panjeh.petcare.ui.components.ChoiceField
import ir.panjeh.petcare.ui.components.DateField
import ir.panjeh.petcare.ui.components.Dialogs
import ir.panjeh.petcare.ui.components.InputKind
import ir.panjeh.petcare.ui.components.JalaliDatePicker
import ir.panjeh.petcare.ui.components.Scaffold
import ir.panjeh.petcare.ui.components.SwitchRow
import ir.panjeh.petcare.ui.components.TextField
import ir.panjeh.petcare.ui.components.TimeField
import ir.panjeh.petcare.ui.components.Tone
import ir.panjeh.petcare.ui.components.WRAP
import ir.panjeh.petcare.ui.components.add
import ir.panjeh.petcare.ui.components.badge
import ir.panjeh.petcare.ui.components.button
import ir.panjeh.petcare.ui.components.card
import ir.panjeh.petcare.ui.components.dp
import ir.panjeh.petcare.ui.components.errorState
import ir.panjeh.petcare.ui.components.horizontal
import ir.panjeh.petcare.ui.components.iconButton
import ir.panjeh.petcare.ui.components.listRow
import ir.panjeh.petcare.ui.components.loadingState
import ir.panjeh.petcare.ui.components.notice
import ir.panjeh.petcare.ui.components.sectionHeader
import ir.panjeh.petcare.ui.components.text
import ir.panjeh.petcare.ui.components.vertical
import ir.panjeh.petcare.ui.nav.Host
import ir.panjeh.petcare.ui.nav.Route
import ir.panjeh.petcare.ui.nav.Screen
import ir.panjeh.petcare.ui.theme.TextStyle
import ir.panjeh.petcare.ui.theme.Theme
import java.time.LocalDate
import java.time.LocalTime

// ============================================================================ کمکی‌های فرم
/**
 * درخواست مجوز اعلان در «زمان مناسب»: فقط وقتی کاربر اولین یادآور/دارو/نوبت را ذخیره می‌کند،
 * و پیش از درخواست سیستمی، دلیل آن به فارسی توضیح داده می‌شود.
 */
fun askNotificationsIfNeeded(host: Host) {
    if (Build.VERSION.SDK_INT < 33) return
    val prefs = Graph.prefs
    if (!prefs.notificationsEnabled || Notifications.canPost(host.context) || prefs.notificationPermissionAsked) return
    prefs.notificationPermissionAsked = true
    Dialogs.confirm(
        host.context, "اجازه نمایش اعلان",
        "برای اینکه زمان واکسن، دارو و کارهای مراقبتی را حتی وقتی برنامه بسته است یادآوری کنیم، اجازه نمایش اعلان لازم است. اگر اجازه ندهید، یادآورها فقط داخل برنامه دیده می‌شوند.",
        "اجازه می‌دهم", cancelLabel = "بعداً",
    ) {
        host.requestPermission(Manifest.permission.POST_NOTIFICATIONS) { ok ->
            if (!ok) host.toast("یادآورها فقط داخل برنامه نمایش داده می‌شوند", Tone.WARNING)
        }
    }
}

private fun deleteButton(host: Host, what: String, message: String, onDelete: () -> Unit) =
    iconButton(host.context, R.drawable.ic_trash, "حذف $what", Theme.c.error) {
        Dialogs.confirm(host.context, "حذف $what", message, "حذف", destructive = true, onConfirm = onDelete)
    }

private fun Screen.deleteThenPop(work: () -> Unit, message: String) {
    Async.run(work, onError = { host.toast("حذف انجام نشد", Tone.ERROR) }) {
        host.dataChanged()
        host.toast(message)
        host.pop()
    }
}

private val remindDayOptions = listOf(-1 to "بدون یادآور", 0 to "همان روز", 1 to "۱ روز قبل", 3 to "۳ روز قبل", 7 to "۱ هفته قبل")
private val remindMinuteOptions = listOf(-1 to "بدون یادآور", 60 to "۱ ساعت قبل", 180 to "۳ ساعت قبل", 1440 to "۱ روز قبل")

/** عنوان کوچک داخل فرم */
private fun formSection(host: Host, title: String) = text(host.context, title, TextStyle.TitleSmall).apply { setPaddingRelative(0, dp(8), 0, 0) }

// ============================================================================ واکسن
class VaccineEditScreen(host: Host, route: Route) : Screen(host, route) {
    private val id = route.long("id")
    private val petId = route.long("petId")
    private var original: Vaccine? = null
    private lateinit var name: TextField
    private lateinit var status: ChoiceField<VaccineStatus>
    private lateinit var given: DateField
    private lateinit var scheduled: DateField
    private lateinit var next: DateField
    private lateinit var remind: ChoiceField<Int>
    private lateinit var clinic: TextField
    private lateinit var vet: TextField
    private lateinit var note: TextField
    private lateinit var dynamicBox: LinearLayout

    override fun build(): View {
        val planned = route.args.getBoolean("planned", false)
        val actions = if (id != 0L) listOf(deleteButton(host, "واکسن", "این سابقه واکسن و مدارک پیوست آن حذف می‌شود.") {
            deleteThenPop({ deleteVaccineWithDocs(id) }, "واکسن حذف شد")
        }) else emptyList()
        val sc = Scaffold(ctx, if (id == 0L) "ثبت واکسن" else "ویرایش واکسن", { host.pop() }, actions)
        name = TextField(ctx, "نام واکسن", "نام واکسن طبق کارت واکسیناسیون", required = true, maxLength = 80)
        route.string("name")?.let { name.value = it }
        status = ChoiceField(ctx, "وضعیت", listOf(VaccineStatus.DONE to "تزریق شده", VaccineStatus.PLANNED to "نوبت آینده"),
            if (planned) VaccineStatus.PLANNED else VaccineStatus.DONE, required = true, wrap = false)
        given = DateField(ctx, "تاریخ تزریق", required = true, maxDate = LocalDate.now()).apply { date = LocalDate.now() }
        scheduled = DateField(ctx, "تاریخ نوبت", required = true)
        next = DateField(ctx, "تاریخ نوبت بعدی", minDate = LocalDate.now().plusDays(1), placeholder = "اگر دامپزشک تعیین کرده است")
        remind = ChoiceField(ctx, "یادآوری", remindDayOptions, 1)
        clinic = TextField(ctx, "مرکز درمانی", "", maxLength = 80)
        vet = TextField(ctx, "نام دامپزشک", "", kind = InputKind.NAME, maxLength = 60)
        note = TextField(ctx, "توضیحات", "مثلاً شماره سری واکسن", kind = InputKind.MULTILINE, maxLength = 500)
        dynamicBox = vertical(ctx)
        sc.content.add(notice(ctx, R.drawable.ic_info, "زمان‌بندی واکسن را برنامه تعیین نمی‌کند؛ تاریخ نوبت بعدی را طبق نظر دامپزشک وارد کنید.", Tone.INFO), bottom = 16)
        sc.content.add(name.view)
        sc.content.add(status.view, top = 16)
        sc.content.add(dynamicBox)
        sc.content.add(clinic.view, top = 16)
        sc.content.add(vet.view, top = 16)
        sc.content.add(note.view, top = 16)
        status.onChanged = { renderDynamic() }
        sc.bottomActions(button(ctx, "ذخیره", ButtonKind.PRIMARY) { save() })
        if (id != 0L) {
            load({ Graph.repo.vaccine(id) }) { v ->
                if (v == null) { host.pop(); return@load }
                original = v
                name.value = v.name
                status.select(v.status)
                given.date = v.givenOn
                scheduled.date = v.scheduledOn
                remind.select(v.remindDaysBefore ?: -1)
                clinic.value = v.clinic ?: ""
                vet.value = v.vet ?: ""
                note.value = v.note ?: ""
            }
        } else {
            load({ Graph.repo.pet(petId) }) { p -> if (p != null && clinic.value.isBlank()) { clinic.value = p.vetClinic ?: ""; vet.value = p.vetName ?: "" } }
        }
        renderDynamic()
        return sc.root
    }

    private fun renderDynamic() {
        dynamicBox.removeAllViews()
        if (status.selected == VaccineStatus.DONE) {
            dynamicBox.add(given.view, top = 8)
            if (id == 0L) {
                dynamicBox.add(next.view, top = 8)
                dynamicBox.add(remind.view, top = 8)
            }
        } else {
            dynamicBox.add(scheduled.view, top = 8)
            dynamicBox.add(remind.view, top = 8)
        }
    }

    private fun save() {
        var ok = name.requireNotBlank("نام واکسن را وارد کنید")
        val st = status.selected ?: VaccineStatus.DONE
        if (st == VaccineStatus.DONE && given.date == null) { given.error("تاریخ تزریق را انتخاب کنید"); ok = false }
        if (st == VaccineStatus.PLANNED && scheduled.date == null) { scheduled.error("تاریخ نوبت را انتخاب کنید"); ok = false }
        if (!ok) return
        val remindDays = remind.selected?.takeIf { it >= 0 }
        val base = Vaccine(
            id = id, petId = original?.petId ?: petId, name = name.value, status = st,
            scheduledOn = if (st == VaccineStatus.PLANNED) scheduled.date else original?.scheduledOn,
            givenOn = if (st == VaccineStatus.DONE) given.date else null,
            clinic = clinic.value, vet = vet.value, note = note.value,
            remindDaysBefore = if (st == VaccineStatus.PLANNED) remindDays else original?.remindDaysBefore,
            createdAt = original?.createdAt ?: System.currentTimeMillis(),
        )
        val nextDate = if (id == 0L && st == VaccineStatus.DONE) next.date else null
        save({
            Graph.repo.transaction {
                Graph.repo.saveVaccine(base)
                if (nextDate != null) {
                    Graph.repo.saveVaccine(Vaccine(petId = base.petId, name = base.name, status = VaccineStatus.PLANNED, scheduledOn = nextDate,
                        clinic = base.clinic, vet = base.vet, remindDaysBefore = remindDays))
                }
            }
        }, if (nextDate != null) "واکسن و نوبت بعدی ثبت شد" else "واکسن ذخیره شد") {
            host.pop()
            if (st == VaccineStatus.PLANNED || nextDate != null) askNotificationsIfNeeded(host)
        }
    }
}

private fun deleteVaccineWithDocs(id: Long) {
    val docs = Graph.repo.relatedDocuments("vaccine", id)
    Graph.repo.deleteVaccine(id)
    docs.forEach { Graph.files.delete(it.filePath) }
}

/** جزئیات واکسن، ثبت انجام شدن و پیوست گواهی */
class VaccineDetailScreen(host: Host, route: Route) : Screen(host, route) {
    private val id = route.long("id")
    private lateinit var sc: Scaffold

    override fun build(): View {
        sc = Scaffold(ctx, "جزئیات واکسن", { host.pop() }, listOf(
            iconButton(ctx, R.drawable.ic_edit, "ویرایش") { host.push(Route.of(Screens.VACCINE_EDIT, "id" to id)) },
            deleteButton(host, "واکسن", "این سابقه واکسن و مدارک پیوست آن حذف می‌شود.") { deleteThenPop({ deleteVaccineWithDocs(id) }, "واکسن حذف شد") },
        ))
        sc.setBody(loadingState(ctx))
        return sc.root
    }

    override fun onShown() {
        load({ Graph.repo.vaccine(id)?.let { v -> Triple(v, Graph.repo.pet(v.petId), Graph.repo.relatedDocuments("vaccine", id)) } },
            onError = { sc.setBody(errorState(ctx, "اطلاعات واکسن خوانده نشد.") { onShown() }) }) { data ->
            if (data == null) { host.pop(); return@load }
            val (v, pet, docs) = data
            val (label, tone) = vaccineStatus(v)
            sc.content.removeAllViews()
            val head = horizontal(ctx)
            head.add(text(ctx, v.name, TextStyle.Headline), w = 0, weight = 1f)
            head.add(badge(ctx, label, tone), w = WRAP)
            sc.content.add(head)
            sc.content.add(detailCard(ctx, listOf(
                infoLine(ctx, "حیوان", pet?.name),
                infoLine(ctx, "تاریخ تزریق", v.givenOn?.let { Fa.date(it, true) }),
                infoLine(ctx, "تاریخ نوبت", if (v.status == VaccineStatus.PLANNED) v.scheduledOn?.let { "${Fa.date(it, true)} (${Fa.relativeDay(it)})" } else null),
                infoLine(ctx, "یادآوری", if (v.status == VaccineStatus.PLANNED) (remindDayOptions.firstOrNull { it.first == (v.remindDaysBefore ?: -1) }?.second) else null),
                infoLine(ctx, "مرکز درمانی", v.clinic),
                infoLine(ctx, "دامپزشک", v.vet),
                infoLine(ctx, "توضیحات", v.note),
            )), top = 14)
            if (v.status == VaccineStatus.PLANNED) {
                sc.content.add(button(ctx, "ثبت انجام شدن واکسن", ButtonKind.PRIMARY, R.drawable.ic_check) { markDone(v) }, top = 16)
            } else {
                sc.content.add(button(ctx, "برنامه‌ریزی نوبت بعدی", ButtonKind.TONAL, R.drawable.ic_calendar) {
                    host.push(Route.of(Screens.VACCINE_EDIT, "petId" to v.petId, "planned" to true, "name" to v.name))
                }, top = 16)
            }
            sc.content.add(sectionHeader(ctx, "مدارک و گواهی", "افزودن") {
                DocumentPicker.start(host, v.petId, "vaccine", v.id, DocCategory.VACCINE_CERT)
            }, top = 24, bottom = 8)
            if (docs.isEmpty()) sc.content.add(text(ctx, "تصویر کارت یا گواهی واکسن را می‌توانید پیوست کنید.", TextStyle.BodySmall, Theme.c.textSecondary))
            else sc.content.add(listCard(ctx, docs.map { documentRow(host, it) }))
        }
    }

    private fun markDone(v: Vaccine) {
        JalaliDatePicker.show(ctx, LocalDate.now(), null, LocalDate.now(), false) { d ->
            val date = d ?: return@show
            Async.run({ Graph.repo.saveVaccine(v.copy(status = VaccineStatus.DONE, givenOn = date)) }, onError = { host.toast("ثبت نشد", Tone.ERROR) }) {
                host.dataChanged()
                host.toast("تزریق واکسن ثبت شد")
                Dialogs.confirm(ctx, "نوبت بعدی", "اگر دامپزشک تاریخ نوبت بعدی این واکسن را تعیین کرده، همین حالا ثبت کنید.", "ثبت نوبت بعدی", cancelLabel = "بعداً") {
                    host.push(Route.of(Screens.VACCINE_EDIT, "petId" to v.petId, "planned" to true, "name" to v.name))
                }
                onShown()
            }
        }
    }
}

// ============================================================================ دارو
class MedicationEditScreen(host: Host, route: Route) : Screen(host, route) {
    private val id = route.long("id")
    private val petId = route.long("petId")
    private var original: Medication? = null
    private lateinit var name: TextField
    private lateinit var dosage: TextField
    private lateinit var freq: ChoiceField<Int>
    private lateinit var start: DateField
    private lateinit var end: DateField
    private lateinit var prescriber: TextField
    private lateinit var note: TextField
    private lateinit var remindersSwitch: SwitchRow
    private lateinit var timesBox: LinearLayout
    private lateinit var timesError: android.widget.TextView
    private val times = ArrayList<TimeField>()

    override fun build(): View {
        val sc = Scaffold(ctx, if (id == 0L) "افزودن دارو" else "ویرایش دارو", { host.pop() })
        name = TextField(ctx, "نام دارو", "طبق نسخه", required = true, maxLength = 80)
        dosage = TextField(ctx, "مقدار تجویزشده", "مثلاً: نصف قرص — دقیقاً طبق نسخه", required = true, maxLength = 120,
            helper = "برنامه هیچ دوزی پیشنهاد نمی‌دهد؛ مقدار را فقط از نسخه دامپزشک وارد کنید.")
        freq = ChoiceField(ctx, "تکرار", listOf(1 to "هر روز", 2 to "یک روز در میان", 3 to "هر ۳ روز", 7 to "هفته‌ای یک‌بار"), 1)
        start = DateField(ctx, "تاریخ شروع", required = true).apply { date = LocalDate.now() }
        end = DateField(ctx, "تاریخ پایان", placeholder = "در صورت مشخص بودن دوره درمان")
        start.onChanged = { s -> if (s != null && end.date?.isBefore(s) == true) end.date = null }
        prescriber = TextField(ctx, "دامپزشک تجویزکننده", "", kind = InputKind.NAME, maxLength = 60)
        note = TextField(ctx, "توضیحات", "مثلاً: همراه غذا داده شود", kind = InputKind.MULTILINE, maxLength = 500)
        remindersSwitch = SwitchRow(ctx, "یادآوری نوبت‌ها", "در زمان هر نوبت اعلان دریافت کنید", true) {}
        timesBox = vertical(ctx)
        timesError = text(ctx, "", TextStyle.Caption, Theme.c.error).apply { visibility = View.GONE }

        sc.content.add(notice(ctx, R.drawable.ic_alert, "اگر نوبتی فراموش شد، نوبت بعدی را دوبرابر نکنید و با دامپزشک مشورت کنید.", Tone.WARNING), bottom = 16)
        sc.content.add(name.view)
        sc.content.add(dosage.view, top = 16)
        sc.content.add(formSection(host, "زمان مصرف"), top = 20)
        sc.content.add(timesBox, top = 8)
        sc.content.add(timesError, top = 4)
        sc.content.add(button(ctx, "افزودن ساعت مصرف", ButtonKind.TONAL, R.drawable.ic_plus, compact = true) { addTime(null) }, w = WRAP, top = 8)
        sc.content.add(freq.view, top = 16)
        sc.content.add(start.view, top = 8)
        sc.content.add(end.view, top = 12)
        sc.content.add(prescriber.view, top = 16)
        sc.content.add(note.view, top = 16)
        sc.content.add(remindersSwitch.view, top = 8)
        sc.bottomActions(button(ctx, "ذخیره", ButtonKind.PRIMARY) { save() })

        if (id != 0L) {
            load({ Graph.repo.medication(id) }) { m ->
                if (m == null) { host.pop(); return@load }
                original = m
                name.value = m.name
                dosage.value = m.dosage
                timesBox.removeAllViews(); times.clear()
                m.times.sorted().forEach { addTime(it) }
                freq.select(m.everyNDays.takeIf { it in setOf(1, 2, 3, 7) } ?: 1)
                start.date = m.startOn
                end.date = m.endOn
                prescriber.value = m.prescriber ?: ""
                note.value = m.note ?: ""
                remindersSwitch.switch.isChecked = m.remindersEnabled
            }
        } else {
            addTime(LocalTime.of(8, 0))
            load({ Graph.repo.pet(petId) }) { p -> if (p != null && prescriber.value.isBlank()) prescriber.value = p.vetName ?: "" }
        }
        return sc.root
    }

    private fun addTime(t: LocalTime?) {
        if (times.size >= 8) { host.toast("حداکثر ۸ نوبت در روز", Tone.WARNING); return }
        val f = TimeField(ctx, "نوبت ${Fa.num(times.size + 1)}")
        f.time = t ?: LocalTime.of(20, 0)
        val row = horizontal(ctx)
        row.add(f.view, w = 0, weight = 1f)
        row.add(iconButton(ctx, R.drawable.ic_close, "حذف این نوبت", Theme.c.textSecondary) {
            if (times.size > 1) {
                times.remove(f)
                timesBox.removeView(row)
            } else host.toast("حداقل یک نوبت لازم است", Tone.WARNING)
        }, w = ctx.dp(48), h = ctx.dp(48), start = 4, top = 18)
        times += f
        timesBox.add(row, bottom = 8)
        timesError.visibility = View.GONE
    }

    private fun save() {
        var ok = name.requireNotBlank("نام دارو را وارد کنید")
        ok = dosage.requireNotBlank("مقدار تجویزشده را وارد کنید") && ok
        val ts = times.mapNotNull { it.time }.distinct().sorted()
        if (ts.isEmpty()) { timesError.text = "حداقل یک ساعت مصرف لازم است"; timesError.visibility = View.VISIBLE; ok = false }
        if (start.date == null) { start.error("تاریخ شروع را انتخاب کنید"); ok = false }
        val s = start.date
        val e = end.date
        if (s != null && e != null && e.isBefore(s)) { end.error("تاریخ پایان نمی‌تواند قبل از شروع باشد"); ok = false }
        if (!ok) return
        val m = Medication(
            id = id, petId = original?.petId ?: petId, name = name.value, dosage = dosage.value, times = ts,
            everyNDays = freq.selected ?: 1, startOn = s!!, endOn = e, prescriber = prescriber.value, note = note.value,
            status = original?.status ?: MedicationStatus.ACTIVE, remindersEnabled = remindersSwitch.switch.isChecked,
            createdAt = original?.createdAt ?: System.currentTimeMillis(),
        )
        save({ Graph.repo.saveMedication(m) }, "برنامه دارو ذخیره شد") {
            host.pop()
            if (m.remindersEnabled) askNotificationsIfNeeded(host)
        }
    }
}

class MedicationDetailScreen(host: Host, route: Route) : Screen(host, route) {
    private val id = route.long("id")
    private lateinit var sc: Scaffold

    override fun build(): View {
        sc = Scaffold(ctx, "برنامه دارو", { host.pop() }, listOf(
            iconButton(ctx, R.drawable.ic_edit, "ویرایش") { host.push(Route.of(Screens.MED_EDIT, "id" to id)) },
            deleteButton(host, "دارو", "این دارو و سابقه مصرف آن حذف می‌شود.") { deleteThenPop({ Graph.repo.deleteMedication(id) }, "دارو حذف شد") },
        ))
        sc.setBody(loadingState(ctx))
        return sc.root
    }

    override fun onShown() {
        load({
            val repo = Graph.repo
            val m = repo.medication(id) ?: return@load null
            val today = LocalDate.now()
            val agenda = AgendaBuilder.build(repo, today, today, includeOverdue = false, petId = m.petId).filter { it.kind == ir.panjeh.petcare.reminders.AgendaItem.Kind.DOSE && it.sourceId == id }
            Data(m, repo.pet(m.petId), agenda, repo.doseLogs(id).take(40), Occurrences.nextDose(m, System.currentTimeMillis()))
        }, onError = { sc.setBody(errorState(ctx, "اطلاعات دارو خوانده نشد.") { onShown() }) }) { d ->
            if (d == null) { host.pop(); return@load }
            render(d)
        }
    }

    private data class Data(val m: Medication, val pet: Pet?, val today: List<ir.panjeh.petcare.reminders.AgendaItem>, val logs: List<ir.panjeh.petcare.data.DoseLog>, val next: Long?)

    private fun render(d: Data) {
        val m = d.m
        val ended = m.status == MedicationStatus.STOPPED || (m.endOn != null && m.endOn.isBefore(LocalDate.now()))
        sc.content.removeAllViews()
        val head = horizontal(ctx)
        head.add(text(ctx, m.name, TextStyle.Headline), w = 0, weight = 1f)
        head.add(badge(ctx, if (ended) "پایان‌یافته" else "فعال", if (ended) Tone.NEUTRAL else Tone.SUCCESS), w = WRAP)
        sc.content.add(head)
        sc.content.add(detailCard(ctx, listOf(
            infoLine(ctx, "حیوان", d.pet?.name),
            infoLine(ctx, "مقدار تجویزشده", m.dosage),
            infoLine(ctx, "زمان مصرف", timesSummary(m)),
            infoLine(ctx, "دوره درمان", "از ${Fa.date(m.startOn)}" + (m.endOn?.let { " تا ${Fa.date(it)}" } ?: " (بدون تاریخ پایان)")),
            infoLine(ctx, "نوبت بعدی", if (!ended) d.next?.let { Fa.friendlyDate(Fa.dateOfMillis(it)) + "، ساعت " + Fa.time(it) } else null),
            infoLine(ctx, "تجویزکننده", m.prescriber),
            infoLine(ctx, "یادآوری", if (m.remindersEnabled) "فعال" else "غیرفعال"),
            infoLine(ctx, "توضیحات", m.note),
        )), top = 14)
        sc.content.add(notice(ctx, R.drawable.ic_alert, "در صورت فراموشی یک نوبت، دوز بعدی را دوبرابر نکنید؛ برای تصمیم با دامپزشک مشورت کنید.", Tone.WARNING), top = 12)
        if (d.today.isNotEmpty()) {
            sc.content.add(sectionHeader(ctx, "نوبت‌های امروز"), top = 20, bottom = 8)
            sc.content.add(listCard(ctx, d.today.map { agendaRow(host, it, emptyMap(), showDay = false) { onShown() } }))
        }
        val actionRow = horizontal(ctx)
        if (m.status == MedicationStatus.ACTIVE) {
            actionRow.add(button(ctx, "پایان یا توقف برنامه", ButtonKind.OUTLINE, R.drawable.ic_skip_circle, compact = true) {
                Dialogs.confirm(ctx, "پایان برنامه دارو", "یادآوری‌های این دارو متوقف می‌شود. سابقه مصرف حفظ می‌شود.", "پایان برنامه") {
                    Async.run({ Graph.repo.saveMedication(m.copy(status = MedicationStatus.STOPPED, endOn = m.endOn?.takeIf { !it.isAfter(LocalDate.now()) } ?: LocalDate.now())) }) {
                        host.dataChanged(); host.toast("برنامه دارو پایان یافت"); onShown()
                    }
                }
            }, w = 0, weight = 1f)
        } else {
            actionRow.add(button(ctx, "ادامه برنامه", ButtonKind.TONAL, R.drawable.ic_repeat, compact = true) {
                Async.run({ Graph.repo.saveMedication(m.copy(status = MedicationStatus.ACTIVE, endOn = null)) }) {
                    host.dataChanged(); host.toast("برنامه دارو دوباره فعال شد"); onShown()
                }
            }, w = 0, weight = 1f)
        }
        sc.content.add(actionRow, top = 16)
        sc.content.add(sectionHeader(ctx, "سابقه مصرف"), top = 24, bottom = 8)
        if (d.logs.isEmpty()) {
            sc.content.add(text(ctx, "هنوز نوبتی ثبت نشده است. نوبت‌ها را از «برنامه امروز» یا اعلان علامت بزنید.", TextStyle.BodySmall, Theme.c.textSecondary))
        } else {
            sc.content.add(listCard(ctx, d.logs.map { l ->
                val taken = l.status == DoseStatus.TAKEN
                listRow(ctx, if (taken) R.drawable.ic_check_circle else R.drawable.ic_skip_circle, if (taken) Tone.SUCCESS else Tone.NEUTRAL,
                    "${Fa.date(Fa.dateOfMillis(l.scheduledAt))}، ساعت ${Fa.time(l.scheduledAt)}", l.status.label)
            }))
        }
    }
}

// ============================================================================ مراجعه دامپزشکی
class VisitEditScreen(host: Host, route: Route) : Screen(host, route) {
    private val id = route.long("id")
    private val petId = route.long("petId")
    private var original: VetVisit? = null
    private lateinit var status: ChoiceField<VisitStatus>
    private lateinit var date: DateField
    private lateinit var time: TimeField
    private lateinit var clinic: TextField
    private lateinit var vet: TextField
    private lateinit var reason: TextField
    private lateinit var symptoms: TextField
    private lateinit var diagnosis: TextField
    private lateinit var prescriptions: TextField
    private lateinit var cost: TextField
    private lateinit var remind: ChoiceField<Int>
    private lateinit var note: TextField
    private lateinit var resultBox: LinearLayout
    private lateinit var remindBox: LinearLayout

    override fun build(): View {
        val scheduled = route.args.getBoolean("scheduled", false)
        val actions = if (id != 0L) listOf(deleteButton(host, "مراجعه", "این مراجعه و مدارک پیوست آن حذف می‌شود.") {
            deleteThenPop({ deleteVisitWithDocs(id) }, "مراجعه حذف شد")
        }) else emptyList()
        val sc = Scaffold(ctx, if (id == 0L) (if (scheduled) "ثبت نوبت دامپزشک" else "ثبت مراجعه") else "ویرایش مراجعه", { host.pop() }, actions)
        status = ChoiceField(ctx, "وضعیت", listOf(VisitStatus.DONE to "انجام شده", VisitStatus.SCHEDULED to "نوبت آینده"),
            if (scheduled) VisitStatus.SCHEDULED else VisitStatus.DONE, required = true, wrap = false)
        date = DateField(ctx, "تاریخ", required = true).apply { this.date = LocalDate.now() }
        time = TimeField(ctx, "ساعت").apply { this.time = LocalTime.now().withSecond(0).withNano(0).let { LocalTime.of(it.hour, it.minute) } }
        clinic = TextField(ctx, "نام مرکز درمانی", "", maxLength = 80)
        vet = TextField(ctx, "نام دامپزشک", "", kind = InputKind.NAME, maxLength = 60)
        reason = TextField(ctx, "علت مراجعه", "مثلاً: معاینه دوره‌ای", maxLength = 120)
        symptoms = TextField(ctx, "علائم گزارش‌شده", "", kind = InputKind.MULTILINE, maxLength = 1000)
        diagnosis = TextField(ctx, "نتیجه معاینه", "", kind = InputKind.MULTILINE, maxLength = 1000)
        prescriptions = TextField(ctx, "داروهای تجویزشده", "برای یادآوری مصرف، دارو را در بخش داروها هم ثبت کنید", kind = InputKind.MULTILINE, maxLength = 1000)
        cost = TextField(ctx, "هزینه (تومان)", "", kind = InputKind.NUMBER, maxLength = 14)
        remind = ChoiceField(ctx, "یادآوری نوبت", remindMinuteOptions, 60)
        note = TextField(ctx, "توضیحات", "", kind = InputKind.MULTILINE, maxLength = 1000)
        resultBox = vertical(ctx)
        remindBox = vertical(ctx)
        resultBox.add(formSection(host, "نتیجه مراجعه"), top = 16)
        resultBox.add(symptoms.view, top = 8)
        resultBox.add(diagnosis.view, top = 16)
        resultBox.add(prescriptions.view, top = 16)
        resultBox.add(cost.view, top = 16)
        remindBox.add(remind.view, top = 16)

        sc.content.add(status.view)
        val dt = horizontal(ctx).apply { gravity = android.view.Gravity.TOP }
        dt.add(date.view, w = 0, weight = 1.4f, end = 8)
        dt.add(time.view, w = 0, weight = 1f)
        sc.content.add(dt, top = 8)
        sc.content.add(reason.view, top = 16)
        sc.content.add(clinic.view, top = 16)
        sc.content.add(vet.view, top = 16)
        sc.content.add(remindBox)
        sc.content.add(resultBox)
        sc.content.add(note.view, top = 16)
        status.onChanged = { updateVisibility() }
        sc.bottomActions(button(ctx, "ذخیره", ButtonKind.PRIMARY) { save() })
        if (id != 0L) {
            load({ Graph.repo.visit(id) }) { v ->
                if (v == null) { host.pop(); return@load }
                original = v
                val dtv = Fa.toLocalDateTime(v.visitAt)
                status.select(if (route.args.getBoolean("complete", false)) VisitStatus.DONE else v.status)
                date.date = dtv.toLocalDate()
                time.time = dtv.toLocalTime()
                clinic.value = v.clinic ?: ""
                vet.value = v.vet ?: ""
                reason.value = v.reason ?: ""
                symptoms.value = v.symptoms ?: ""
                diagnosis.value = v.diagnosis ?: ""
                prescriptions.value = v.prescriptions ?: ""
                cost.value = v.costToman?.let { Fa.num(it) } ?: ""
                remind.select(v.remindMinutesBefore ?: -1)
                note.value = v.note ?: ""
            }
        } else {
            if (scheduled) { date.date = LocalDate.now().plusDays(1); time.time = LocalTime.of(10, 0) }
            load({ Graph.repo.pet(petId) }) { p -> if (p != null) { clinic.value = p.vetClinic ?: ""; vet.value = p.vetName ?: "" } }
        }
        updateVisibility()
        return sc.root
    }

    private fun updateVisibility() {
        val done = status.selected == VisitStatus.DONE
        resultBox.visibility = if (done) View.VISIBLE else View.GONE
        remindBox.visibility = if (done) View.GONE else View.VISIBLE
    }

    private fun save() {
        var ok = true
        val st = status.selected ?: VisitStatus.DONE
        val d = date.date
        val t = time.time
        if (d == null) { date.error("تاریخ را انتخاب کنید"); ok = false }
        if (t == null) { time.error("ساعت را انتخاب کنید"); ok = false }
        val costValue = if (cost.value.isBlank()) null else Fa.parseLong(cost.value)
        if (cost.value.isNotBlank() && (costValue == null || costValue < 0)) { cost.error("مبلغ معتبر نیست"); ok = false }
        if (!ok) return
        val at = Fa.millisOf(d!!, t!!)
        if (st == VisitStatus.DONE && d.isAfter(LocalDate.now())) { date.error("مراجعه انجام‌شده نمی‌تواند در آینده باشد"); return }
        val v = VetVisit(
            id = id, petId = original?.petId ?: petId, status = st, visitAt = at, clinic = clinic.value, vet = vet.value,
            reason = reason.value, symptoms = symptoms.value, diagnosis = diagnosis.value, prescriptions = prescriptions.value,
            costToman = if (st == VisitStatus.DONE) costValue else original?.costToman, note = note.value,
            remindMinutesBefore = remind.selected?.takeIf { it >= 0 },
            createdAt = original?.createdAt ?: System.currentTimeMillis(),
        )
        save({ Graph.repo.saveVisit(v) }, if (st == VisitStatus.SCHEDULED) "نوبت ثبت شد" else "مراجعه ذخیره شد") {
            host.pop()
            if (st == VisitStatus.SCHEDULED && v.remindMinutesBefore != null) askNotificationsIfNeeded(host)
        }
    }
}

private fun deleteVisitWithDocs(id: Long) {
    val docs = Graph.repo.relatedDocuments("visit", id)
    Graph.repo.deleteVisit(id)
    docs.forEach { Graph.files.delete(it.filePath) }
}

class VisitDetailScreen(host: Host, route: Route) : Screen(host, route) {
    private val id = route.long("id")
    private lateinit var sc: Scaffold

    override fun build(): View {
        sc = Scaffold(ctx, "جزئیات مراجعه", { host.pop() }, listOf(
            iconButton(ctx, R.drawable.ic_edit, "ویرایش") { host.push(Route.of(Screens.VISIT_EDIT, "id" to id)) },
            deleteButton(host, "مراجعه", "این مراجعه و مدارک پیوست آن حذف می‌شود.") { deleteThenPop({ deleteVisitWithDocs(id) }, "مراجعه حذف شد") },
        ))
        sc.setBody(loadingState(ctx))
        return sc.root
    }

    override fun onShown() {
        load({ Graph.repo.visit(id)?.let { v -> Triple(v, Graph.repo.pet(v.petId), Graph.repo.relatedDocuments("visit", id)) } },
            onError = { sc.setBody(errorState(ctx, "اطلاعات مراجعه خوانده نشد.") { onShown() }) }) { data ->
            if (data == null) { host.pop(); return@load }
            val (v, pet, docs) = data
            sc.content.removeAllViews()
            val upcoming = v.status == VisitStatus.SCHEDULED
            val head = horizontal(ctx)
            head.add(text(ctx, v.reason?.takeIf { it.isNotBlank() } ?: "مراجعه به دامپزشک", TextStyle.Headline), w = 0, weight = 1f)
            head.add(badge(ctx, if (upcoming) "نوبت آینده" else "انجام شده", if (upcoming) Tone.INFO else Tone.SUCCESS), w = WRAP)
            sc.content.add(head)
            sc.content.add(detailCard(ctx, listOf(
                infoLine(ctx, "حیوان", pet?.name),
                infoLine(ctx, "زمان", Fa.dateTime(v.visitAt)),
                infoLine(ctx, "مرکز درمانی", v.clinic),
                infoLine(ctx, "دامپزشک", v.vet),
                infoLine(ctx, "علائم گزارش‌شده", v.symptoms),
                infoLine(ctx, "نتیجه معاینه", v.diagnosis),
                infoLine(ctx, "داروهای تجویزشده", v.prescriptions),
                infoLine(ctx, "هزینه", v.costToman?.let { Fa.toman(it) }),
                infoLine(ctx, "یادآوری", if (upcoming) remindMinuteOptions.firstOrNull { it.first == (v.remindMinutesBefore ?: -1) }?.second else null),
                infoLine(ctx, "توضیحات", v.note),
            )), top = 14)
            if (upcoming && v.visitAt < System.currentTimeMillis()) {
                sc.content.add(button(ctx, "ثبت نتیجه مراجعه", ButtonKind.PRIMARY, R.drawable.ic_check) {
                    host.push(Route.of(Screens.VISIT_EDIT, "id" to id, "complete" to true))
                }, top = 16)
            }
            if (!v.prescriptions.isNullOrBlank()) {
                sc.content.add(button(ctx, "افزودن دارو به برنامه مصرف", ButtonKind.TONAL, R.drawable.ic_pill) {
                    host.push(Route.of(Screens.MED_EDIT, "petId" to v.petId))
                }, top = 12)
            }
            sc.content.add(sectionHeader(ctx, "مدارک و تصاویر", "افزودن") {
                DocumentPicker.start(host, v.petId, "visit", v.id, DocCategory.PRESCRIPTION)
            }, top = 24, bottom = 8)
            if (docs.isEmpty()) sc.content.add(text(ctx, "نسخه، نتیجه آزمایش یا تصویر پزشکی این مراجعه را پیوست کنید.", TextStyle.BodySmall, Theme.c.textSecondary))
            else sc.content.add(listCard(ctx, docs.map { documentRow(host, it) }))
        }
    }
}

// ============================================================================ وزن
class WeightEditScreen(host: Host, route: Route) : Screen(host, route) {
    private val id = route.long("id")
    private val petId = route.long("petId")
    private var original: WeightEntry? = null
    private lateinit var value: TextField
    private lateinit var unit: ChoiceField<String>
    private lateinit var date: DateField
    private lateinit var time: TimeField
    private lateinit var note: TextField

    override fun build(): View {
        val actions = if (id != 0L) listOf(deleteButton(host, "وزن", "این اندازه‌گیری حذف می‌شود.") {
            deleteThenPop({ Graph.repo.deleteWeight(id) }, "اندازه‌گیری حذف شد")
        }) else emptyList()
        val sc = Scaffold(ctx, if (id == 0L) "ثبت وزن" else "ویرایش وزن", { host.pop() }, actions)
        value = TextField(ctx, "وزن", "مثلاً: ۴٫۲", required = true, kind = InputKind.DECIMAL, maxLength = 8)
        unit = ChoiceField(ctx, "واحد", listOf("kg" to "کیلوگرم", "g" to "گرم"), "kg", wrap = false)
        date = DateField(ctx, "تاریخ اندازه‌گیری", required = true, maxDate = LocalDate.now()).apply { this.date = LocalDate.now() }
        time = TimeField(ctx, "ساعت").apply { this.time = LocalTime.now().let { LocalTime.of(it.hour, it.minute) } }
        note = TextField(ctx, "یادداشت", "مثلاً: قبل از غذا", maxLength = 200)
        sc.content.add(value.view)
        sc.content.add(unit.view, top = 8)
        val dt = horizontal(ctx).apply { gravity = android.view.Gravity.TOP }
        dt.add(date.view, w = 0, weight = 1.4f, end = 8)
        dt.add(time.view, w = 0, weight = 1f)
        sc.content.add(dt, top = 8)
        sc.content.add(note.view, top = 16)
        sc.bottomActions(button(ctx, "ذخیره", ButtonKind.PRIMARY) { save() })
        load({ Graph.repo.pet(petId) to (if (id != 0L) Graph.repo.weight(id) else null) }) { (p, w) ->
            if (p?.species == ir.panjeh.petcare.data.Species.BIRD && w == null) unit.select("g")
            if (w != null) {
                original = w
                if (w.grams < 1000) { unit.select("g"); value.value = Fa.decimal(w.grams, 0) } else { unit.select("kg"); value.value = Fa.decimal(w.grams / 1000, 3) }
                val dtv = Fa.toLocalDateTime(w.measuredAt)
                date.date = dtv.toLocalDate()
                time.time = dtv.toLocalTime()
                note.value = w.note ?: ""
            }
        }
        return sc.root
    }

    private fun save() {
        val v = Fa.parseDecimal(value.value)
        if (v == null) { value.error("وزن را به عدد وارد کنید"); return }
        val grams = if (unit.selected == "g") v else v * 1000
        if (grams <= 0 || grams > 200_000) { value.error("وزن واردشده معتبر نیست"); return }
        val d = date.date ?: run { date.error("تاریخ را انتخاب کنید"); return }
        val t = time.time ?: LocalTime.NOON
        val w = WeightEntry(id = id, petId = original?.petId ?: petId, grams = grams, measuredAt = Fa.millisOf(d, t), note = note.value.ifBlank { null })
        save({ Graph.repo.saveWeight(w) }, "وزن ${Fa.weight(grams)} ثبت شد")
    }
}

class WeightScreen(host: Host, route: Route) : Screen(host, route) {
    private val petId = route.long("petId")
    private lateinit var sc: Scaffold

    override fun build(): View {
        sc = Scaffold(ctx, "وزن و رشد", { host.pop() })
        sc.setBody(loadingState(ctx))
        return sc.root
    }

    override fun onShown() {
        load({ Graph.repo.pet(petId) to Graph.repo.weights(petId) }, onError = { sc.setBody(errorState(ctx, "اطلاعات وزن خوانده نشد.") { onShown() }) }) { (p, list) ->
            if (p == null) { host.pop(); return@load }
            sc.content.removeAllViews()
            sc.content.add(text(ctx, p.name, TextStyle.BodySmall, Theme.c.textSecondary), bottom = 8)
            weightSection(host, petId, list).forEach { sc.content.add(it, bottom = 12) }
        }
    }
}

// ============================================================================ یادآور
class ReminderEditScreen(host: Host, route: Route) : Screen(host, route) {
    private val id = route.long("id")
    private var original: Reminder? = null
    private var pets: List<Pet> = emptyList()
    private lateinit var petChoice: ChoiceField<Long>
    private lateinit var petBox: LinearLayout
    private lateinit var type: ChoiceField<ReminderType>
    private lateinit var title: TextField
    private lateinit var date: DateField
    private lateinit var time: TimeField
    private lateinit var repeat: ChoiceField<Repeat>
    private lateinit var interval: TextField
    private lateinit var end: DateField
    private lateinit var note: TextField
    private lateinit var enabled: SwitchRow
    private lateinit var historyBox: LinearLayout
    private var titleEdited = false

    override fun build(): View {
        val actions = if (id != 0L) listOf(deleteButton(host, "یادآور", "این یادآور و سابقه انجام آن حذف می‌شود.") {
            deleteThenPop({ Graph.repo.deleteReminder(id) }, "یادآور حذف شد")
        }) else emptyList()
        val sc = Scaffold(ctx, if (id == 0L) "یادآور جدید" else "ویرایش یادآور", { host.pop() }, actions)
        val initialType = route.string("type")?.let { ReminderType.of(it) } ?: ReminderType.CARE
        petBox = vertical(ctx)
        type = ChoiceField(ctx, "نوع یادآور", ReminderType.userSelectable.map { it to it.label }, initialType, required = true,
            icons = ReminderType.userSelectable.associateWith { typeVisual(it).first })
        title = TextField(ctx, "عنوان", "مثلاً: غذای صبح", required = true, maxLength = 80)
        title.value = defaultTitle(initialType)
        title.edit.setOnKeyListener { _, _, _ -> titleEdited = true; false }
        type.onChanged = { t -> if (!titleEdited && t != null) title.value = defaultTitle(t) }
        date = DateField(ctx, "تاریخ شروع", required = true).apply { this.date = LocalDate.now() }
        time = TimeField(ctx, "ساعت").apply { this.time = Graph.prefs.defaultReminderTime }
        repeat = ChoiceField(ctx, "تکرار", Repeat.entries.map { it to it.label }, Repeat.NONE, required = true)
        interval = TextField(ctx, "هر چند روز یک‌بار؟", "مثلاً: ۲", kind = InputKind.NUMBER, maxLength = 3)
        interval.value = Fa.num(2)
        end = DateField(ctx, "تاریخ پایان تکرار", placeholder = "بدون پایان")
        note = TextField(ctx, "یادداشت", "", kind = InputKind.MULTILINE, maxLength = 500)
        enabled = SwitchRow(ctx, "یادآور فعال باشد", null, true) {}
        historyBox = vertical(ctx)
        repeat.onChanged = { r ->
            interval.view.visibility = if (r == Repeat.EVERY_N_DAYS) View.VISIBLE else View.GONE
            end.view.visibility = if (r == Repeat.NONE || r == null) View.GONE else View.VISIBLE
        }
        repeat.select(Repeat.NONE)

        sc.content.add(petBox)
        sc.content.add(type.view)
        sc.content.add(title.view, top = 8)
        val dt = horizontal(ctx).apply { gravity = android.view.Gravity.TOP }
        dt.add(date.view, w = 0, weight = 1.4f, end = 8)
        dt.add(time.view, w = 0, weight = 1f)
        sc.content.add(dt, top = 16)
        sc.content.add(repeat.view, top = 8)
        sc.content.add(interval.view, top = 4)
        sc.content.add(end.view, top = 8)
        sc.content.add(note.view, top = 16)
        if (id != 0L) sc.content.add(enabled.view, top = 8)
        sc.content.add(historyBox)
        sc.bottomActions(button(ctx, "ذخیره یادآور", ButtonKind.PRIMARY) { save() })

        load({
            val repo = Graph.repo
            Triple(repo.pets(), if (id != 0L) repo.reminder(id) else null, if (id != 0L) repo.occurrenceLogs(id, 10) else emptyList())
        }) { (ps, r, logs) ->
            pets = ps
            val preset = r?.petId ?: route.longOrNull("petId") ?: ps.firstOrNull()?.id
            petBox.removeAllViews()
            if (ps.size > 1 || (r != null && r.petId == null)) {
                val opts = ps.map { it.id to it.name } + (0L to "عمومی")
                petChoice = ChoiceField(ctx, "برای", opts, preset ?: 0L)
                petBox.add(petChoice.view, bottom = 8)
            }
            if (r != null) {
                original = r
                titleEdited = true
                type.select(r.type)
                title.value = r.title
                val s = Fa.toLocalDateTime(r.startAt)
                date.date = s.toLocalDate()
                time.time = s.toLocalTime()
                repeat.select(r.repeat)
                interval.value = Fa.num(r.interval)
                end.date = r.endOn
                note.value = r.note ?: ""
                enabled.switch.isChecked = r.enabled
                if (logs.isNotEmpty()) {
                    historyBox.add(sectionHeader(ctx, "سابقه انجام"), top = 20, bottom = 8)
                    historyBox.add(listCard(ctx, logs.map { (at, st) ->
                        listRow(ctx, if (st == ir.panjeh.petcare.data.OccurrenceStatus.DONE) R.drawable.ic_check_circle else R.drawable.ic_skip_circle,
                            if (st == ir.panjeh.petcare.data.OccurrenceStatus.DONE) Tone.SUCCESS else Tone.NEUTRAL,
                            "${Fa.date(Fa.dateOfMillis(at))}، ساعت ${Fa.time(at)}", st.label)
                    }))
                }
            }
        }
        return sc.root
    }

    private fun defaultTitle(t: ReminderType) = when (t) {
        ReminderType.WEIGHT -> "ثبت وزن"
        ReminderType.GROOMING -> "نظافت و شانه کردن"
        ReminderType.FEEDING -> "وعده غذا"
        ReminderType.CARE -> "مراقبت روزانه"
        ReminderType.VET -> "تماس با دامپزشک"
        ReminderType.VACCINE -> "پیگیری واکسن"
        ReminderType.MEDICATION -> "دارو"
        ReminderType.OTHER -> ""
    }

    private fun save() {
        var ok = title.requireNotBlank("عنوان یادآور را وارد کنید")
        val d = date.date
        val t = time.time
        if (d == null) { date.error("تاریخ را انتخاب کنید"); ok = false }
        if (t == null) { time.error("ساعت را انتخاب کنید"); ok = false }
        val rep = repeat.selected ?: Repeat.NONE
        val n = if (rep == Repeat.EVERY_N_DAYS) Fa.parseLong(interval.value)?.toInt() else 1
        if (rep == Repeat.EVERY_N_DAYS && (n == null || n < 1 || n > 365)) { interval.error("عددی بین ۱ تا ۳۶۵ وارد کنید"); ok = false }
        if (!ok) return
        val start = Fa.millisOf(d!!, t!!)
        if (rep == Repeat.NONE && start < System.currentTimeMillis() && original == null) {
            date.error("زمان یادآور یک‌باره گذشته است")
            return
        }
        val e = end.date
        if (rep != Repeat.NONE && e != null && e.isBefore(d)) { end.error("پایان نمی‌تواند قبل از شروع باشد"); return }
        val petId = if (::petChoice.isInitialized) petChoice.selected?.takeIf { it != 0L } else (original?.petId ?: route.longOrNull("petId") ?: pets.firstOrNull()?.id)
        val r = Reminder(
            id = id, petId = petId, type = type.selected ?: ReminderType.OTHER, title = title.value, note = note.value,
            startAt = start, repeat = rep, interval = n ?: 1, endOn = if (rep == Repeat.NONE) null else e,
            enabled = if (id == 0L) true else enabled.switch.isChecked, createdAt = original?.createdAt ?: System.currentTimeMillis(),
        )
        save({ Graph.repo.saveReminder(r) }, "یادآور ذخیره شد") {
            host.pop()
            askNotificationsIfNeeded(host)
        }
    }
}

// ============================================================================ سابقه سلامت
class HealthRecordEditScreen(host: Host, route: Route) : Screen(host, route) {
    private val id = route.long("id")
    private val petId = route.long("petId")
    private var original: HealthRecord? = null

    override fun build(): View {
        val actions = if (id != 0L) listOf(deleteButton(host, "سابقه", "این سابقه سلامت حذف می‌شود.") {
            deleteThenPop({ Graph.repo.deleteHealthRecord(id) }, "سابقه حذف شد")
        }) else emptyList()
        val sc = Scaffold(ctx, if (id == 0L) "ثبت سابقه سلامت" else "ویرایش سابقه", { host.pop() }, actions)
        val kind = ChoiceField(ctx, "نوع سابقه", HealthKind.entries.map { it to it.label }, HealthKind.SYMPTOM, required = true)
        val title = TextField(ctx, "عنوان", "مثلاً: کاهش اشتها", required = true, maxLength = 100)
        val date = DateField(ctx, "تاریخ", required = true, maxDate = LocalDate.now()).apply { this.date = LocalDate.now() }
        val note = TextField(ctx, "شرح", "جزئیات، مدت، شدت و ...", kind = InputKind.MULTILINE, maxLength = 2000)
        sc.content.add(kind.view)
        sc.content.add(title.view, top = 8)
        sc.content.add(date.view, top = 16)
        sc.content.add(note.view, top = 8)
        sc.content.add(text(ctx, "این بخش فقط برای ثبت سوابق است و تشخیص یا توصیه درمانی ارائه نمی‌دهد.", TextStyle.Caption, Theme.c.textTertiary), top = 12)
        sc.bottomActions(button(ctx, "ذخیره", ButtonKind.PRIMARY) {
            var ok = title.requireNotBlank("عنوان را وارد کنید")
            if (date.date == null) { date.error("تاریخ را انتخاب کنید"); ok = false }
            if (ok) {
                val h = HealthRecord(id = id, petId = original?.petId ?: petId, kind = kind.selected ?: HealthKind.NOTE, title = title.value,
                    date = date.date!!, note = note.value.ifBlank { null }, createdAt = original?.createdAt ?: System.currentTimeMillis())
                save({ Graph.repo.saveHealthRecord(h) }, "سابقه سلامت ذخیره شد")
            }
        })
        if (id != 0L) load({ Graph.repo.healthRecord(id) }) { h ->
            if (h == null) { host.pop(); return@load }
            original = h
            kind.select(h.kind); title.value = h.title; date.date = h.date; note.value = h.note ?: ""
        }
        return sc.root
    }
}

// ============================================================================ مراقبت روزانه
class CareEditScreen(host: Host, route: Route) : Screen(host, route) {
    private val id = route.long("id")
    private val petId = route.long("petId")
    private var original: CareLog? = null

    override fun build(): View {
        val actions = if (id != 0L) listOf(deleteButton(host, "ثبت", "این مورد حذف می‌شود.") {
            deleteThenPop({ Graph.repo.deleteCareLog(id) }, "حذف شد")
        }) else emptyList()
        val sc = Scaffold(ctx, if (id == 0L) "ثبت مراقبت روزانه" else "ویرایش ثبت", { host.pop() }, actions)
        val initial = route.string("kind")?.let { CareKind.of(it) } ?: CareKind.FEEDING
        val kind = ChoiceField(ctx, "نوع", CareKind.entries.map { it to it.label }, initial, required = true,
            icons = CareKind.entries.associateWith { careVisual(it) })
        val title = TextField(ctx, "عنوان", "", required = true, maxLength = 80)
        val amount = TextField(ctx, "مقدار یا نوع", "مثلاً: یک پیمانه غذای خشک", maxLength = 80)
        val duration = TextField(ctx, "مدت (دقیقه)", "", kind = InputKind.NUMBER, maxLength = 4)
        val date = DateField(ctx, "تاریخ", required = true, maxDate = LocalDate.now()).apply { this.date = LocalDate.now() }
        val time = TimeField(ctx, "ساعت").apply { this.time = LocalTime.now().let { LocalTime.of(it.hour, it.minute) } }
        val note = TextField(ctx, "یادداشت", "", kind = InputKind.MULTILINE, maxLength = 500)
        fun defaultTitle(k: CareKind) = when (k) {
            CareKind.FEEDING -> "وعده غذا"; CareKind.ACTIVITY -> "پیاده‌روی و بازی"; CareKind.GROOMING -> "نظافت"; CareKind.OTHER -> ""
        }
        title.value = defaultTitle(initial)
        kind.onChanged = { k ->
            if (k != null && (title.value.isBlank() || CareKind.entries.any { defaultTitle(it) == title.value })) title.value = defaultTitle(k)
            duration.view.visibility = if (k == CareKind.ACTIVITY || k == CareKind.GROOMING) View.VISIBLE else View.GONE
        }
        duration.view.visibility = if (initial == CareKind.ACTIVITY || initial == CareKind.GROOMING) View.VISIBLE else View.GONE
        sc.content.add(kind.view)
        sc.content.add(title.view, top = 8)
        sc.content.add(amount.view, top = 16)
        sc.content.add(duration.view, top = 16)
        val dt = horizontal(ctx).apply { gravity = android.view.Gravity.TOP }
        dt.add(date.view, w = 0, weight = 1.4f, end = 8)
        dt.add(time.view, w = 0, weight = 1f)
        sc.content.add(dt, top = 16)
        sc.content.add(note.view, top = 8)
        sc.bottomActions(button(ctx, "ذخیره", ButtonKind.PRIMARY) {
            var ok = title.requireNotBlank("عنوان را وارد کنید")
            val dur = if (duration.value.isBlank()) null else Fa.parseLong(duration.value)?.toInt()
            if (duration.value.isNotBlank() && (dur == null || dur <= 0 || dur > 1440)) { duration.error("مدت معتبر نیست"); ok = false }
            if (date.date == null) { date.error("تاریخ را انتخاب کنید"); ok = false }
            if (ok) {
                val c = CareLog(id = id, petId = original?.petId ?: petId, kind = kind.selected ?: CareKind.OTHER, title = title.value,
                    amount = amount.value.ifBlank { null }, durationMinutes = dur,
                    loggedAt = Fa.millisOf(date.date!!, time.time ?: LocalTime.NOON), note = note.value.ifBlank { null })
                save({ Graph.repo.saveCareLog(c) }, "ثبت شد")
            }
        })
        if (id != 0L) load({ Graph.repo.careLog(id) }) { c ->
            if (c == null) { host.pop(); return@load }
            original = c
            kind.select(c.kind); title.value = c.title; amount.value = c.amount ?: ""
            duration.value = c.durationMinutes?.let { Fa.num(it) } ?: ""
            val dtv = Fa.toLocalDateTime(c.loggedAt); date.date = dtv.toLocalDate(); time.time = dtv.toLocalTime()
            note.value = c.note ?: ""
        }
        return sc.root
    }
}

/** برنامه تغذیه (ذخیره در پروفایل حیوان) */
class FeedingEditScreen(host: Host, route: Route) : Screen(host, route) {
    private val petId = route.long("petId")

    override fun build(): View {
        val sc = Scaffold(ctx, "برنامه تغذیه", { host.pop() })
        val food = TextField(ctx, "نوع غذا", "مثلاً: غذای خشک بچه‌گربه", maxLength = 120)
        val meals = TextField(ctx, "تعداد وعده در روز", "", kind = InputKind.NUMBER, maxLength = 2)
        val notes = TextField(ctx, "توضیحات تغذیه", "مقدار هر وعده، غذاهای ممنوع و ...", kind = InputKind.MULTILINE, maxLength = 1000)
        sc.content.add(notice(ctx, R.drawable.ic_info, "برنامه مقدار غذا یا رژیم درمانی تعیین نمی‌کند؛ برنامه‌ای را که خودتان یا دامپزشک تعیین کرده‌اید ثبت کنید.", Tone.INFO), bottom = 16)
        sc.content.add(food.view)
        sc.content.add(meals.view, top = 16)
        sc.content.add(notes.view, top = 16)
        sc.content.add(text(ctx, "برای یادآوری وعده‌ها، در بخش «تغذیه و مراقبت» یک کار تکرارشونده بسازید.", TextStyle.Caption, Theme.c.textTertiary), top = 12)
        var pet: Pet? = null
        sc.bottomActions(button(ctx, "ذخیره", ButtonKind.PRIMARY) {
            val p = pet ?: return@button
            val m = if (meals.value.isBlank()) null else Fa.parseLong(meals.value)?.toInt()
            if (meals.value.isNotBlank() && (m == null || m !in 1..12)) { meals.error("عددی بین ۱ تا ۱۲ وارد کنید"); return@button }
            save({ Graph.repo.savePet(p.copy(foodType = food.value, mealsPerDay = m, feedingNotes = notes.value)) }, "برنامه تغذیه ذخیره شد")
        })
        load({ Graph.repo.pet(petId) }) { p ->
            if (p == null) { host.pop(); return@load }
            pet = p
            food.value = p.foodType ?: ""
            meals.value = p.mealsPerDay?.let { Fa.num(it) } ?: ""
            notes.value = p.feedingNotes ?: ""
        }
        return sc.root
    }
}
