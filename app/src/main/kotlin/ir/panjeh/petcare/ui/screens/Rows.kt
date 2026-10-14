package ir.panjeh.petcare.ui.screens

import android.content.Context
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import ir.panjeh.petcare.Graph
import ir.panjeh.petcare.R
import ir.panjeh.petcare.core.Async
import ir.panjeh.petcare.core.Fa
import ir.panjeh.petcare.data.CareLog
import ir.panjeh.petcare.data.CareKind
import ir.panjeh.petcare.data.DoseLog
import ir.panjeh.petcare.data.DoseStatus
import ir.panjeh.petcare.data.HealthKind
import ir.panjeh.petcare.data.HealthRecord
import ir.panjeh.petcare.data.Medication
import ir.panjeh.petcare.data.MedicationStatus
import ir.panjeh.petcare.data.OccurrenceStatus
import ir.panjeh.petcare.data.Pet
import ir.panjeh.petcare.data.PetDocument
import ir.panjeh.petcare.data.Reminder
import ir.panjeh.petcare.data.ReminderType
import ir.panjeh.petcare.data.Repeat
import ir.panjeh.petcare.data.Vaccine
import ir.panjeh.petcare.data.VaccineStatus
import ir.panjeh.petcare.data.VetVisit
import ir.panjeh.petcare.data.VisitStatus
import ir.panjeh.petcare.data.WeightEntry
import ir.panjeh.petcare.reminders.AgendaItem
import ir.panjeh.petcare.ui.components.ButtonKind
import ir.panjeh.petcare.ui.components.Dialogs
import ir.panjeh.petcare.ui.components.PetAvatar
import ir.panjeh.petcare.ui.components.Tone
import ir.panjeh.petcare.ui.components.WRAP
import ir.panjeh.petcare.ui.components.add
import ir.panjeh.petcare.ui.components.badge
import ir.panjeh.petcare.ui.components.button
import ir.panjeh.petcare.ui.components.card
import ir.panjeh.petcare.ui.components.clickable
import ir.panjeh.petcare.ui.components.divider
import ir.panjeh.petcare.ui.components.dp
import ir.panjeh.petcare.ui.components.horizontal
import ir.panjeh.petcare.ui.components.iconBadge
import ir.panjeh.petcare.ui.components.iconView
import ir.panjeh.petcare.ui.components.listRow
import ir.panjeh.petcare.ui.components.ripple
import ir.panjeh.petcare.ui.components.rounded
import ir.panjeh.petcare.ui.components.text
import ir.panjeh.petcare.ui.components.vertical
import ir.panjeh.petcare.ui.nav.Host
import ir.panjeh.petcare.ui.nav.Route
import ir.panjeh.petcare.ui.theme.TextStyle
import ir.panjeh.petcare.ui.theme.Theme
import java.time.LocalDate

/** آیکون و رنگ‌مایه هر نوع یادآور */
fun typeVisual(t: ReminderType): Pair<Int, Tone> = when (t) {
    ReminderType.VACCINE -> R.drawable.ic_syringe to Tone.INFO
    ReminderType.MEDICATION -> R.drawable.ic_pill to Tone.PRIMARY
    ReminderType.VET -> R.drawable.ic_stethoscope to Tone.INFO
    ReminderType.WEIGHT -> R.drawable.ic_weight to Tone.PRIMARY
    ReminderType.GROOMING -> R.drawable.ic_scissors to Tone.PRIMARY
    ReminderType.FEEDING -> R.drawable.ic_utensils to Tone.WARNING
    ReminderType.CARE -> R.drawable.ic_heart_pulse to Tone.PRIMARY
    ReminderType.OTHER -> R.drawable.ic_bell to Tone.NEUTRAL
}

/** کارتی که فرزندانش را با خط جداکننده نمایش می‌دهد */
fun listCard(ctx: Context, rows: List<View>): LinearLayout = card(ctx, paddingDp = 4).apply {
    rows.forEachIndexed { i, v ->
        if (i > 0) add(divider(ctx, 68))
        add(v)
    }
}

fun timesSummary(m: Medication): String {
    val times = m.times.sorted().joinToString("، ") { Fa.time(it) }
    val freq = if (m.everyNDays == 1) "روزی ${Fa.num(m.times.size)} نوبت" else "هر ${Fa.num(m.everyNDays)} روز، ${Fa.num(m.times.size)} نوبت"
    return "$freq: $times"
}

fun repeatSummary(r: Reminder): String = when (r.repeat) {
    Repeat.NONE -> "یک‌بار"
    Repeat.DAILY -> "هر روز"
    Repeat.EVERY_N_DAYS -> "هر ${Fa.num(r.interval)} روز"
    Repeat.WEEKLY -> if (r.interval == 1) "هر هفته" else "هر ${Fa.num(r.interval)} هفته"
    Repeat.MONTHLY -> if (r.interval == 1) "هر ماه" else "هر ${Fa.num(r.interval)} ماه"
    Repeat.YEARLY -> "هر سال"
}

// ============================================================================ برنامه روز
/**
 * ردیف یک مورد برنامه (یادآور/دارو/واکسن/مراجعه) با دکمه علامت‌گذاری انجام.
 */
fun agendaRow(host: Host, item: AgendaItem, pets: Map<Long, Pet>, showDay: Boolean, onChanged: () -> Unit): LinearLayout {
    val ctx = host.context
    val c = Theme.c
    val overdue = item.state == AgendaItem.State.PENDING &&
        (if (item.allDay) Fa.dateOfMillis(item.at).isBefore(LocalDate.now()) else item.at < System.currentTimeMillis() - 30 * 60_000)
    val (icon, baseTone) = typeVisual(item.type)
    val tone = if (overdue) Tone.WARNING else baseTone
    val row = horizontal(ctx).apply {
        minimumHeight = dp(68)
        setPaddingRelative(dp(12), dp(10), dp(8), dp(10))
    }
    row.add(iconBadge(ctx, icon, tone), w = ctx.dp(44), h = ctx.dp(44), end = 12)
    val col = vertical(ctx)
    val titleText = text(ctx, item.title, TextStyle.BodyMedium, if (item.state == AgendaItem.State.PENDING) c.textPrimary else c.textSecondary, maxLines = 2)
    if (item.state == AgendaItem.State.DONE) titleText.paintFlags = titleText.paintFlags or android.graphics.Paint.STRIKE_THRU_TEXT_FLAG
    col.add(titleText)
    val parts = ArrayList<String>()
    val day = Fa.dateOfMillis(item.at)
    if (showDay) parts += Fa.friendlyDate(day)
    parts += if (item.allDay) "تمام روز" else "ساعت ${Fa.time(item.at)}"
    item.petId?.let { pets[it]?.name }?.let { parts += it }
    col.add(text(ctx, parts.joinToString(" · "), TextStyle.BodySmall, c.textSecondary, maxLines = 1), top = 2)
    if (!item.detail.isNullOrBlank()) col.add(text(ctx, item.detail, TextStyle.Caption, if (overdue) c.warning else c.textTertiary, maxLines = 2), top = 2)
    row.add(col, w = 0, weight = 1f)
    when {
        item.state == AgendaItem.State.SKIPPED -> row.add(badge(ctx, if (item.kind == AgendaItem.Kind.DOSE) "داده نشد" else "رد شد", Tone.NEUTRAL), w = WRAP, start = 6)
        overdue && item.kind == AgendaItem.Kind.VACCINE -> row.add(badge(ctx, "عقب‌افتاده", Tone.WARNING), w = WRAP, start = 6)
    }
    if (item.checkable) {
        val done = item.state == AgendaItem.State.DONE
        val check = FrameLayout(ctx).apply {
            contentDescription = if (done) "لغو علامت انجام" else if (item.kind == AgendaItem.Kind.DOSE) "علامت‌گذاری مصرف‌شده" else "علامت‌گذاری انجام‌شده"
            background = ripple(ctx, null, 24)
            val ic = iconView(ctx, if (done) R.drawable.ic_check_circle else R.drawable.ic_circle, if (done) c.success else c.textTertiary, 28)
            addView(ic, FrameLayout.LayoutParams(ctx.dp(28), ctx.dp(28), Gravity.CENTER))
            isClickable = true
            setOnClickListener { toggleAgenda(host, item, onChanged) }
        }
        row.add(check, w = ctx.dp(48), h = ctx.dp(48), start = 4)
        row.clickable(16) { agendaOptions(host, item, onChanged) }
    } else {
        row.add(iconView(ctx, R.drawable.ic_chevron, c.textTertiary, 20), w = ctx.dp(20), h = ctx.dp(20), start = 4, end = 8)
        row.clickable(16) {
            when (item.kind) {
                AgendaItem.Kind.VACCINE -> host.push(Route.of(Screens.VACCINE_DETAIL, "id" to item.sourceId))
                AgendaItem.Kind.VISIT -> host.push(Route.of(Screens.VISIT_DETAIL, "id" to item.sourceId))
                else -> {}
            }
        }
    }
    return row
}

private fun toggleAgenda(host: Host, item: AgendaItem, onChanged: () -> Unit) {
    val repo = Graph.repo
    val done = item.state == AgendaItem.State.DONE
    Async.run({
        when (item.kind) {
            AgendaItem.Kind.REMINDER ->
                if (done) repo.undoOccurrence(item.sourceId, item.at) else repo.logOccurrence(item.sourceId, item.at, OccurrenceStatus.DONE)
            AgendaItem.Kind.DOSE ->
                if (done) repo.undoDose(item.sourceId, item.at)
                else repo.logDose(DoseLog(medicationId = item.sourceId, petId = item.petId ?: 0, scheduledAt = item.at, status = DoseStatus.TAKEN))
            else -> {}
        }
    }, onError = { host.toast("ثبت انجام نشد", Tone.ERROR) }) {
        host.dataChanged()
        host.toast(
            if (done) "علامت انجام برداشته شد"
            else if (item.kind == AgendaItem.Kind.DOSE) "مصرف دارو ثبت شد" else "انجام شد",
        )
        onChanged()
    }
}

private fun agendaOptions(host: Host, item: AgendaItem, onChanged: () -> Unit) {
    val repo = Graph.repo
    val isDose = item.kind == AgendaItem.Kind.DOSE
    val opts = ArrayList<Dialogs.Option>()
    if (item.state != AgendaItem.State.DONE) {
        opts += Dialogs.Option(if (isDose) "مصرف شد" else "انجام شد", R.drawable.ic_check_circle, Tone.SUCCESS) { toggleAgenda(host, item, onChanged) }
    }
    if (item.state == AgendaItem.State.PENDING) {
        opts += Dialogs.Option(
            if (isDose) "این نوبت داده نشد" else "رد کردن این نوبت", R.drawable.ic_skip_circle, Tone.NEUTRAL,
            if (isDose) "نوبت بعدی را دوبرابر نکنید؛ در صورت نیاز با دامپزشک مشورت کنید." else null,
        ) {
            Async.run({
                if (isDose) repo.logDose(DoseLog(medicationId = item.sourceId, petId = item.petId ?: 0, scheduledAt = item.at, status = DoseStatus.SKIPPED))
                else repo.logOccurrence(item.sourceId, item.at, OccurrenceStatus.SKIPPED)
            }) {
                host.dataChanged()
                host.toast("ثبت شد", Tone.SUCCESS)
                onChanged()
            }
        }
    } else {
        opts += Dialogs.Option("بازگرداندن به حالت انجام‌نشده", R.drawable.ic_repeat, Tone.NEUTRAL) {
            Async.run({ if (isDose) repo.undoDose(item.sourceId, item.at) else repo.undoOccurrence(item.sourceId, item.at) }) {
                host.dataChanged()
                onChanged()
            }
        }
    }
    opts += Dialogs.Option(if (isDose) "مشاهده برنامه دارو" else "ویرایش یادآور", R.drawable.ic_edit, Tone.PRIMARY) {
        if (isDose) host.push(Route.of(Screens.MED_DETAIL, "id" to item.sourceId))
        else host.push(Route.of(Screens.REMINDER_EDIT, "id" to item.sourceId))
    }
    Dialogs.options(host.context, item.title, opts)
}

// ============================================================================ واکسن
fun vaccineStatus(v: Vaccine): Pair<String, Tone> = when {
    v.status == VaccineStatus.DONE -> "انجام شده" to Tone.SUCCESS
    v.isOverdue() -> "عقب‌افتاده" to Tone.WARNING
    else -> "برنامه‌ریزی‌شده" to Tone.PRIMARY
}

fun vaccineRow(host: Host, v: Vaccine, petName: String?): View {
    val ctx = host.context
    val (label, tone) = vaccineStatus(v)
    val date = if (v.status == VaccineStatus.DONE) v.givenOn?.let { "تزریق: ${Fa.date(it)}" }
    else v.scheduledOn?.let { "نوبت: ${Fa.friendlyDate(it)}" }
    val sub = listOfNotNull(date, petName, v.clinic).joinToString(" · ")
    return listRow(ctx, R.drawable.ic_syringe, if (tone == Tone.SUCCESS) Tone.PRIMARY else tone, v.name, sub, badge(ctx, label, tone), chevron = false) {
        host.push(Route.of(Screens.VACCINE_DETAIL, "id" to v.id))
    }
}

// ============================================================================ دارو
fun medicationRow(host: Host, m: Medication, petName: String?): View {
    val ctx = host.context
    val ended = m.status == MedicationStatus.STOPPED || (m.endOn != null && m.endOn.isBefore(LocalDate.now()))
    val sub = listOfNotNull(m.dosage, timesSummary(m), petName).joinToString(" · ")
    return listRow(
        ctx, R.drawable.ic_pill, if (ended) Tone.NEUTRAL else Tone.PRIMARY, m.name, sub,
        badge(ctx, if (ended) "پایان‌یافته" else "فعال", if (ended) Tone.NEUTRAL else Tone.SUCCESS),
    ) { host.push(Route.of(Screens.MED_DETAIL, "id" to m.id)) }
}

// ============================================================================ مراجعه
fun visitRow(host: Host, v: VetVisit, petName: String?): View {
    val ctx = host.context
    val upcoming = v.status == VisitStatus.SCHEDULED
    val title = v.reason?.takeIf { it.isNotBlank() } ?: if (upcoming) "نوبت دامپزشک" else "مراجعه به دامپزشک"
    val sub = listOfNotNull(Fa.dateTime(v.visitAt), v.clinic ?: v.vet, petName).joinToString(" · ")
    val b = when {
        upcoming && v.visitAt < System.currentTimeMillis() -> badge(ctx, "نیاز به ثبت نتیجه", Tone.WARNING)
        upcoming -> badge(ctx, "نوبت آینده", Tone.INFO)
        v.costToman != null -> badge(ctx, Fa.toman(v.costToman), Tone.NEUTRAL)
        else -> null
    }
    return listRow(ctx, R.drawable.ic_stethoscope, if (upcoming) Tone.INFO else Tone.PRIMARY, title, sub, b) {
        host.push(Route.of(Screens.VISIT_DETAIL, "id" to v.id))
    }
}

// ============================================================================ وزن
fun weightRow(host: Host, w: WeightEntry, previous: WeightEntry?): View {
    val ctx = host.context
    val trailing = previous?.let {
        val d = w.grams - it.grams
        badge(ctx, if (d == 0.0) "بدون تغییر" else Fa.weightDelta(d), Tone.NEUTRAL)
    }
    val dt = Fa.toLocalDateTime(w.measuredAt)
    val sub = listOfNotNull(Fa.date(dt.toLocalDate(), true), w.note).joinToString(" · ")
    return listRow(ctx, R.drawable.ic_weight, Tone.PRIMARY, Fa.weight(w.grams), sub, trailing) {
        host.push(Route.of(Screens.WEIGHT_EDIT, "petId" to w.petId, "id" to w.id))
    }
}

// ============================================================================ یادآور
fun reminderRow(host: Host, r: Reminder, petName: String?, onToggle: (Boolean) -> Unit): View {
    val ctx = host.context
    val (icon, tone) = typeVisual(r.type)
    val start = Fa.toLocalDateTime(r.startAt)
    val next = ir.panjeh.petcare.reminders.Occurrences.next(r, System.currentTimeMillis())
    val when_ = if (r.repeat == Repeat.NONE) Fa.dateTime(r.startAt) else "${repeatSummary(r)}، ساعت ${Fa.time(start.toLocalTime())}"
    val nextText = if (r.enabled && next != null && r.repeat != Repeat.NONE) "بعدی: ${Fa.friendlyDate(Fa.dateOfMillis(next))}" else null
    val ended = next == null
    val sub = listOfNotNull(when_, nextText, petName, if (ended) "به پایان رسیده" else null).joinToString(" · ")
    val sw = android.widget.Switch(ctx).apply {
        isChecked = r.enabled
        contentDescription = if (r.enabled) "غیرفعال کردن یادآور" else "فعال کردن یادآور"
        thumbTintList = android.content.res.ColorStateList(
            arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
            intArrayOf(Theme.c.primary, if (Theme.c.isDark) 0xFF9AA19C.toInt() else 0xFFFFFFFF.toInt()),
        )
        trackTintList = android.content.res.ColorStateList(
            arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
            intArrayOf(ir.panjeh.petcare.ui.components.withAlpha(Theme.c.primary, 0.45f), Theme.c.outline),
        )
        setOnCheckedChangeListener { _, b -> onToggle(b) }
    }
    return listRow(ctx, icon, if (r.enabled) tone else Tone.NEUTRAL, r.title, sub, sw) {
        host.push(Route.of(Screens.REMINDER_EDIT, "id" to r.id))
    }
}

// ============================================================================ سند
fun documentRow(host: Host, d: PetDocument): View {
    val ctx = host.context
    val icon = when {
        d.isImage -> R.drawable.ic_image
        else -> R.drawable.ic_file
    }
    val sizeKb = (d.sizeBytes / 1024).coerceAtLeast(1)
    val size = if (sizeKb > 1024) "${Fa.decimal(sizeKb / 1024.0, 1)} مگابایت" else "${Fa.num(sizeKb)} کیلوبایت"
    val sub = listOf(d.category.label, Fa.date(Fa.dateOfMillis(d.createdAt)), size).joinToString(" · ")
    return listRow(ctx, icon, Tone.PRIMARY, d.title, sub, null, chevron = true) {
        host.push(Route.of(Screens.DOC_VIEW, "id" to d.id))
    }
}

// ============================================================================ مراقبت و سلامت
fun careVisual(k: CareKind): Int = when (k) {
    CareKind.FEEDING -> R.drawable.ic_utensils
    CareKind.ACTIVITY -> R.drawable.ic_activity
    CareKind.GROOMING -> R.drawable.ic_scissors
    CareKind.OTHER -> R.drawable.ic_heart_pulse
}

fun careRow(host: Host, x: CareLog): View {
    val ctx = host.context
    val parts = listOfNotNull(
        Fa.friendlyDate(Fa.dateOfMillis(x.loggedAt)) + "، " + Fa.time(x.loggedAt),
        x.amount?.let { Fa.digitsOnly(it) },
        x.durationMinutes?.let { "${Fa.num(it)} دقیقه" },
    )
    return listRow(ctx, careVisual(x.kind), if (x.kind == CareKind.FEEDING) Tone.WARNING else Tone.PRIMARY, x.title, parts.joinToString(" · ") + (x.note?.let { "\n$it" } ?: "")) {
        host.push(Route.of(Screens.CARE_EDIT, "petId" to x.petId, "id" to x.id))
    }
}

fun healthVisual(k: HealthKind): Pair<Int, Tone> = when (k) {
    HealthKind.SYMPTOM -> R.drawable.ic_activity to Tone.WARNING
    HealthKind.ILLNESS -> R.drawable.ic_heart_pulse to Tone.ERROR
    HealthKind.TEST -> R.drawable.ic_clipboard to Tone.INFO
    HealthKind.SURGERY -> R.drawable.ic_stethoscope to Tone.INFO
    HealthKind.ALLERGY -> R.drawable.ic_alert to Tone.WARNING
    HealthKind.NOTE -> R.drawable.ic_file to Tone.NEUTRAL
}

fun healthRow(host: Host, h: HealthRecord): View {
    val (icon, tone) = healthVisual(h.kind)
    val sub = listOfNotNull("${h.kind.label} · ${Fa.date(h.date)}", h.note).joinToString("\n")
    return listRow(host.context, icon, tone, h.title, sub) {
        host.push(Route.of(Screens.HEALTH_EDIT, "petId" to h.petId, "id" to h.id))
    }
}

// ============================================================================ انتخاب حیوان
/** انتخاب حیوان (در صورت وجود چند حیوان) پیش از ورود به فرم */
fun withPet(host: Host, preferred: Long?, block: (Pet) -> Unit) {
    Async.run({ Graph.repo.pets() }) { pets ->
        when {
            pets.isEmpty() -> Dialogs.confirm(
                host.context, "ابتدا یک حیوان اضافه کنید",
                "برای ثبت این مورد، اول پروفایل حیوان خانگی خود را بسازید.", "افزودن حیوان",
            ) { host.push(Route.of(Screens.PET_EDIT)) }
            pets.size == 1 -> block(pets[0])
            preferred != null && pets.any { it.id == preferred } -> block(pets.first { it.id == preferred })
            else -> Dialogs.options(host.context, "برای کدام حیوان؟", pets.map { p ->
                Dialogs.Option(p.name, R.drawable.ic_paw, Tone.PRIMARY, p.speciesLabel) { block(p) }
            })
        }
    }
}

/** تراشه‌های انتخاب حیوان در بالای صفحه‌های تجمیعی */
fun petFilterRow(ctx: Context, pets: List<Pet>, selected: Long?, includeAll: Boolean, onSelect: (Long?) -> Unit): View {
    val (scroll, row) = ir.panjeh.petcare.ui.components.chipRow(ctx)
    if (includeAll) row.add(ir.panjeh.petcare.ui.components.chip(ctx, "همه", selected == null) { onSelect(null) }, w = WRAP, end = 8)
    pets.forEach { p ->
        val chipView = horizontal(ctx).apply {
            val sel = p.id == selected
            background = ripple(ctx, if (sel) rounded(ctx, Theme.c.primary, 20) else rounded(ctx, Theme.c.surface, 20, Theme.c.outline), 20)
            setPaddingRelative(dp(4), dp(4), dp(14), dp(4))
            val av = PetAvatar(ctx, 30)
            av.bind(p)
            add(av, w = ctx.dp(30), h = ctx.dp(30), end = 8)
            add(text(ctx, p.name, TextStyle.Label, if (sel) Theme.c.onPrimary else Theme.c.textPrimary, maxLines = 1), w = WRAP)
            isClickable = true
            setOnClickListener { onSelect(p.id) }
            contentDescription = p.name
        }
        row.add(chipView, w = WRAP, end = 8)
    }
    return scroll
}

/** دکمه کوچک افزودن در سربرگ بخش‌ها */
fun smallAdd(ctx: Context, label: String, onClick: () -> Unit) = button(ctx, label, ButtonKind.TONAL, R.drawable.ic_plus, compact = true, onClick = onClick)

/** نمایش کلید-مقدار در صفحه‌های جزئیات */
fun infoLine(ctx: Context, label: String, value: String?): View? {
    if (value.isNullOrBlank()) return null
    return vertical(ctx).apply {
        setPaddingRelative(0, dp(8), 0, dp(8))
        add(text(ctx, label, TextStyle.Caption, Theme.c.textSecondary))
        add(text(ctx, value, TextStyle.Body), top = 2)
    }
}

fun detailCard(ctx: Context, lines: List<View?>): LinearLayout = card(ctx).apply {
    val items = lines.filterNotNull()
    items.forEachIndexed { i, v ->
        if (i > 0) add(divider(ctx))
        add(v)
    }
}
