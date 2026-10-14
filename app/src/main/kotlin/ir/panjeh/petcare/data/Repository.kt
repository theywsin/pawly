package ir.panjeh.petcare.data

import android.content.ContentValues
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import java.time.LocalDate
import java.time.LocalTime

/**
 * لایه دسترسی به داده. همه متدها هم‌زمان (blocking) هستند و باید خارج از رشته اصلی
 * (از طریق [ir.panjeh.petcare.core.Async]) فراخوانی شوند.
 */
class Repository(private val helper: AppDatabase) {

    val db: SQLiteDatabase get() = helper.writableDatabase

    fun <T> transaction(block: () -> T): T {
        db.beginTransaction()
        try {
            val r = block()
            db.setTransactionSuccessful()
            return r
        } finally {
            db.endTransaction()
        }
    }

    // ================================================================= حیوانات
    fun pets(): List<Pet> = query("SELECT * FROM pets ORDER BY created_at ASC", ::pet)

    fun pet(id: Long): Pet? = query("SELECT * FROM pets WHERE id=?", ::pet, id).firstOrNull()

    fun petCount(): Int = scalarLong("SELECT COUNT(*) FROM pets").toInt()

    fun savePet(p: Pet): Long {
        val v = ContentValues().apply {
            put("name", p.name.trim())
            put("species", p.species.name)
            putOrNull("species_other", p.speciesOther)
            putOrNull("breed", p.breed)
            put("sex", p.sex.name)
            put("birth_date", p.birthDate?.toEpochDay())
            putOrNull("color", p.color)
            put("neutered", p.neutered?.let { if (it) 1 else 0 })
            putOrNull("allergies", p.allergies)
            putOrNull("conditions", p.conditions)
            put("photo", p.photo)
            putOrNull("notes", p.notes)
            putOrNull("microchip", p.microchip)
            putOrNull("food_type", p.foodType)
            put("meals_per_day", p.mealsPerDay)
            putOrNull("feeding_notes", p.feedingNotes)
            putOrNull("vet_name", p.vetName)
            putOrNull("vet_clinic", p.vetClinic)
            putOrNull("vet_phone", p.vetPhone)
            put("created_at", p.createdAt)
        }
        return upsert("pets", p.id, v)
    }

    fun deletePet(id: Long) {
        db.delete("pets", "id=?", arrayOf(id.toString()))
    }

    private fun pet(c: Cursor) = Pet(
        id = c.long("id"),
        name = c.str("name")!!,
        species = Species.of(c.str("species")),
        speciesOther = c.str("species_other"),
        breed = c.str("breed"),
        sex = Sex.of(c.str("sex")),
        birthDate = c.longOrNull("birth_date")?.let(LocalDate::ofEpochDay),
        color = c.str("color"),
        neutered = c.longOrNull("neutered")?.let { it == 1L },
        allergies = c.str("allergies"),
        conditions = c.str("conditions"),
        photo = c.str("photo"),
        notes = c.str("notes"),
        microchip = c.str("microchip"),
        foodType = c.str("food_type"),
        mealsPerDay = c.longOrNull("meals_per_day")?.toInt(),
        feedingNotes = c.str("feeding_notes"),
        vetName = c.str("vet_name"),
        vetClinic = c.str("vet_clinic"),
        vetPhone = c.str("vet_phone"),
        createdAt = c.long("created_at"),
    )

    // ================================================================= وزن
    fun weights(petId: Long): List<WeightEntry> =
        query("SELECT * FROM weights WHERE pet_id=? ORDER BY measured_at DESC, id DESC", ::weight, petId)

    fun latestWeight(petId: Long): WeightEntry? =
        query("SELECT * FROM weights WHERE pet_id=? ORDER BY measured_at DESC, id DESC LIMIT 1", ::weight, petId).firstOrNull()

    fun weight(id: Long): WeightEntry? = query("SELECT * FROM weights WHERE id=?", ::weight, id).firstOrNull()

    fun saveWeight(w: WeightEntry): Long {
        require(w.grams > 0)
        val v = ContentValues().apply {
            put("pet_id", w.petId)
            put("grams", w.grams)
            put("measured_at", w.measuredAt)
            putOrNull("note", w.note)
        }
        return upsert("weights", w.id, v)
    }

    fun deleteWeight(id: Long) = delete("weights", id)

    private fun weight(c: Cursor) = WeightEntry(
        id = c.long("id"), petId = c.long("pet_id"), grams = c.double("grams"),
        measuredAt = c.long("measured_at"), note = c.str("note"),
    )

    // ================================================================= واکسن
    fun vaccines(petId: Long?): List<Vaccine> = if (petId == null) {
        query("SELECT * FROM vaccines ORDER BY COALESCE(given_on, scheduled_on) DESC, id DESC", ::vaccine)
    } else {
        query("SELECT * FROM vaccines WHERE pet_id=? ORDER BY COALESCE(given_on, scheduled_on) DESC, id DESC", ::vaccine, petId)
    }

    fun vaccine(id: Long): Vaccine? = query("SELECT * FROM vaccines WHERE id=?", ::vaccine, id).firstOrNull()

    fun plannedVaccines(): List<Vaccine> =
        query("SELECT * FROM vaccines WHERE status='PLANNED' AND scheduled_on IS NOT NULL ORDER BY scheduled_on ASC", ::vaccine)

    fun saveVaccine(x: Vaccine): Long {
        val v = ContentValues().apply {
            put("pet_id", x.petId)
            put("name", x.name.trim())
            put("status", x.status.name)
            put("scheduled_on", x.scheduledOn?.toEpochDay())
            put("given_on", x.givenOn?.toEpochDay())
            putOrNull("clinic", x.clinic)
            putOrNull("vet", x.vet)
            putOrNull("note", x.note)
            put("remind_days_before", x.remindDaysBefore)
            put("created_at", x.createdAt)
        }
        return upsert("vaccines", x.id, v)
    }

    fun deleteVaccine(id: Long) {
        transaction {
            deleteRelatedDocsRows("vaccine", id)
            delete("vaccines", id)
        }
    }

    private fun vaccine(c: Cursor) = Vaccine(
        id = c.long("id"), petId = c.long("pet_id"), name = c.str("name")!!,
        status = if (c.str("status") == "DONE") VaccineStatus.DONE else VaccineStatus.PLANNED,
        scheduledOn = c.longOrNull("scheduled_on")?.let(LocalDate::ofEpochDay),
        givenOn = c.longOrNull("given_on")?.let(LocalDate::ofEpochDay),
        clinic = c.str("clinic"), vet = c.str("vet"), note = c.str("note"),
        remindDaysBefore = c.longOrNull("remind_days_before")?.toInt(),
        createdAt = c.long("created_at"),
    )

    // ================================================================= دارو
    fun medications(petId: Long?): List<Medication> = if (petId == null) {
        query("SELECT * FROM medications ORDER BY status ASC, start_on DESC", ::medication)
    } else {
        query("SELECT * FROM medications WHERE pet_id=? ORDER BY status ASC, start_on DESC", ::medication, petId)
    }

    fun activeMedications(): List<Medication> =
        query("SELECT * FROM medications WHERE status='ACTIVE'", ::medication)

    fun medication(id: Long): Medication? = query("SELECT * FROM medications WHERE id=?", ::medication, id).firstOrNull()

    fun saveMedication(m: Medication): Long {
        require(m.times.isNotEmpty())
        val v = ContentValues().apply {
            put("pet_id", m.petId)
            put("name", m.name.trim())
            put("dosage", m.dosage.trim())
            put("times", m.times.sorted().joinToString(",") { "%02d:%02d".format(java.util.Locale.US, it.hour, it.minute) })
            put("every_n_days", m.everyNDays)
            put("start_on", m.startOn.toEpochDay())
            put("end_on", m.endOn?.toEpochDay())
            putOrNull("prescriber", m.prescriber)
            putOrNull("note", m.note)
            put("status", m.status.name)
            put("reminders_enabled", if (m.remindersEnabled) 1 else 0)
            put("created_at", m.createdAt)
        }
        return upsert("medications", m.id, v)
    }

    fun deleteMedication(id: Long) = delete("medications", id)

    private fun medication(c: Cursor) = Medication(
        id = c.long("id"), petId = c.long("pet_id"), name = c.str("name")!!, dosage = c.str("dosage")!!,
        times = c.str("times")!!.split(',').filter { it.isNotBlank() }.map { LocalTime.parse(it) },
        everyNDays = c.long("every_n_days").toInt(),
        startOn = LocalDate.ofEpochDay(c.long("start_on")),
        endOn = c.longOrNull("end_on")?.let(LocalDate::ofEpochDay),
        prescriber = c.str("prescriber"), note = c.str("note"),
        status = if (c.str("status") == "STOPPED") MedicationStatus.STOPPED else MedicationStatus.ACTIVE,
        remindersEnabled = c.long("reminders_enabled") == 1L,
        createdAt = c.long("created_at"),
    )

    fun logDose(d: DoseLog) {
        val v = ContentValues().apply {
            put("medication_id", d.medicationId)
            put("pet_id", d.petId)
            put("scheduled_at", d.scheduledAt)
            put("status", d.status.name)
            put("logged_at", d.loggedAt)
        }
        db.insertOrThrow("dose_logs", null, v)
    }

    fun undoDose(medicationId: Long, scheduledAt: Long) {
        db.delete("dose_logs", "medication_id=? AND scheduled_at=?", arrayOf(medicationId.toString(), scheduledAt.toString()))
    }

    fun doseLogs(medicationId: Long): List<DoseLog> =
        query("SELECT * FROM dose_logs WHERE medication_id=? ORDER BY scheduled_at DESC", ::doseLog, medicationId)

    fun doseLogsBetween(from: Long, to: Long): List<DoseLog> =
        query("SELECT * FROM dose_logs WHERE scheduled_at>=? AND scheduled_at<?", ::doseLog, from, to)

    private fun doseLog(c: Cursor) = DoseLog(
        id = c.long("id"), medicationId = c.long("medication_id"), petId = c.long("pet_id"),
        scheduledAt = c.long("scheduled_at"),
        status = if (c.str("status") == "SKIPPED") DoseStatus.SKIPPED else DoseStatus.TAKEN,
        loggedAt = c.long("logged_at"),
    )

    // ================================================================= مراجعات
    fun visits(petId: Long?): List<VetVisit> = if (petId == null) {
        query("SELECT * FROM vet_visits ORDER BY visit_at DESC", ::visit)
    } else {
        query("SELECT * FROM vet_visits WHERE pet_id=? ORDER BY visit_at DESC", ::visit, petId)
    }

    fun scheduledVisits(): List<VetVisit> =
        query("SELECT * FROM vet_visits WHERE status='SCHEDULED' ORDER BY visit_at ASC", ::visit)

    fun visit(id: Long): VetVisit? = query("SELECT * FROM vet_visits WHERE id=?", ::visit, id).firstOrNull()

    fun lastDoneVisit(petId: Long): VetVisit? =
        query("SELECT * FROM vet_visits WHERE pet_id=? AND status='DONE' ORDER BY visit_at DESC LIMIT 1", ::visit, petId).firstOrNull()

    fun saveVisit(x: VetVisit): Long {
        val v = ContentValues().apply {
            put("pet_id", x.petId)
            put("status", x.status.name)
            put("visit_at", x.visitAt)
            putOrNull("clinic", x.clinic)
            putOrNull("vet", x.vet)
            putOrNull("reason", x.reason)
            putOrNull("symptoms", x.symptoms)
            putOrNull("diagnosis", x.diagnosis)
            putOrNull("prescriptions", x.prescriptions)
            put("cost_toman", x.costToman)
            putOrNull("note", x.note)
            put("remind_minutes_before", x.remindMinutesBefore)
            put("created_at", x.createdAt)
        }
        return upsert("vet_visits", x.id, v)
    }

    fun deleteVisit(id: Long) {
        transaction {
            deleteRelatedDocsRows("visit", id)
            delete("vet_visits", id)
        }
    }

    private fun visit(c: Cursor) = VetVisit(
        id = c.long("id"), petId = c.long("pet_id"),
        status = if (c.str("status") == "SCHEDULED") VisitStatus.SCHEDULED else VisitStatus.DONE,
        visitAt = c.long("visit_at"), clinic = c.str("clinic"), vet = c.str("vet"), reason = c.str("reason"),
        symptoms = c.str("symptoms"), diagnosis = c.str("diagnosis"), prescriptions = c.str("prescriptions"),
        costToman = c.longOrNull("cost_toman"), note = c.str("note"),
        remindMinutesBefore = c.longOrNull("remind_minutes_before")?.toInt(),
        createdAt = c.long("created_at"),
    )

    // ================================================================= یادآورها
    fun reminders(petId: Long? = null): List<Reminder> = if (petId == null) {
        query("SELECT * FROM reminders ORDER BY enabled DESC, start_at ASC", ::reminder)
    } else {
        query("SELECT * FROM reminders WHERE pet_id=? ORDER BY enabled DESC, start_at ASC", ::reminder, petId)
    }

    fun enabledReminders(): List<Reminder> = query("SELECT * FROM reminders WHERE enabled=1", ::reminder)

    fun reminder(id: Long): Reminder? = query("SELECT * FROM reminders WHERE id=?", ::reminder, id).firstOrNull()

    fun saveReminder(r: Reminder): Long {
        val v = ContentValues().apply {
            put("pet_id", r.petId)
            put("type", r.type.name)
            put("title", r.title.trim())
            putOrNull("note", r.note)
            put("start_at", r.startAt)
            put("repeat", r.repeat.name)
            put("interval", r.interval.coerceAtLeast(1))
            put("end_on", r.endOn?.toEpochDay())
            put("enabled", if (r.enabled) 1 else 0)
            put("created_at", r.createdAt)
        }
        return upsert("reminders", r.id, v)
    }

    fun setReminderEnabled(id: Long, enabled: Boolean) {
        db.update("reminders", ContentValues().apply { put("enabled", if (enabled) 1 else 0) }, "id=?", arrayOf(id.toString()))
    }

    fun deleteReminder(id: Long) = delete("reminders", id)

    fun logOccurrence(reminderId: Long, occurrenceAt: Long, status: OccurrenceStatus) {
        val v = ContentValues().apply {
            put("reminder_id", reminderId)
            put("occurrence_at", occurrenceAt)
            put("status", status.name)
            put("logged_at", System.currentTimeMillis())
        }
        db.insertOrThrow("reminder_logs", null, v)
    }

    fun undoOccurrence(reminderId: Long, occurrenceAt: Long) {
        db.delete("reminder_logs", "reminder_id=? AND occurrence_at=?", arrayOf(reminderId.toString(), occurrenceAt.toString()))
    }

    /** نقشه (شناسه یادآور، زمان وقوع) ← وضعیت */
    fun occurrenceLogsBetween(from: Long, to: Long): Map<Pair<Long, Long>, OccurrenceStatus> {
        val out = HashMap<Pair<Long, Long>, OccurrenceStatus>()
        db.rawQuery(
            "SELECT reminder_id, occurrence_at, status FROM reminder_logs WHERE occurrence_at>=? AND occurrence_at<?",
            arrayOf(from.toString(), to.toString()),
        ).use { c ->
            while (c.moveToNext()) {
                out[c.getLong(0) to c.getLong(1)] = if (c.getString(2) == "SKIPPED") OccurrenceStatus.SKIPPED else OccurrenceStatus.DONE
            }
        }
        return out
    }

    fun occurrenceLogs(reminderId: Long, limit: Int = 30): List<Pair<Long, OccurrenceStatus>> {
        val out = ArrayList<Pair<Long, OccurrenceStatus>>()
        db.rawQuery(
            "SELECT occurrence_at, status FROM reminder_logs WHERE reminder_id=? ORDER BY occurrence_at DESC LIMIT $limit",
            arrayOf(reminderId.toString()),
        ).use { c ->
            while (c.moveToNext()) out += c.getLong(0) to (if (c.getString(1) == "SKIPPED") OccurrenceStatus.SKIPPED else OccurrenceStatus.DONE)
        }
        return out
    }

    private fun reminder(c: Cursor) = Reminder(
        id = c.long("id"), petId = c.longOrNull("pet_id"), type = ReminderType.of(c.str("type")),
        title = c.str("title")!!, note = c.str("note"), startAt = c.long("start_at"),
        repeat = Repeat.of(c.str("repeat")), interval = c.long("interval").toInt(),
        endOn = c.longOrNull("end_on")?.let(LocalDate::ofEpochDay),
        enabled = c.long("enabled") == 1L, createdAt = c.long("created_at"),
    )

    // ================================================================= سوابق سلامت
    fun healthRecords(petId: Long): List<HealthRecord> =
        query("SELECT * FROM health_records WHERE pet_id=? ORDER BY date DESC, id DESC", ::health, petId)

    fun healthRecord(id: Long): HealthRecord? = query("SELECT * FROM health_records WHERE id=?", ::health, id).firstOrNull()

    fun saveHealthRecord(h: HealthRecord): Long {
        val v = ContentValues().apply {
            put("pet_id", h.petId)
            put("kind", h.kind.name)
            put("title", h.title.trim())
            put("date", h.date.toEpochDay())
            putOrNull("note", h.note)
            put("created_at", h.createdAt)
        }
        return upsert("health_records", h.id, v)
    }

    fun deleteHealthRecord(id: Long) = delete("health_records", id)

    private fun health(c: Cursor) = HealthRecord(
        id = c.long("id"), petId = c.long("pet_id"), kind = HealthKind.of(c.str("kind")), title = c.str("title")!!,
        date = LocalDate.ofEpochDay(c.long("date")), note = c.str("note"), createdAt = c.long("created_at"),
    )

    // ================================================================= مراقبت
    fun careLogs(petId: Long, limit: Int = 200): List<CareLog> =
        query("SELECT * FROM care_logs WHERE pet_id=? ORDER BY logged_at DESC LIMIT $limit", ::care, petId)

    fun careLog(id: Long): CareLog? = query("SELECT * FROM care_logs WHERE id=?", ::care, id).firstOrNull()

    fun saveCareLog(x: CareLog): Long {
        val v = ContentValues().apply {
            put("pet_id", x.petId)
            put("kind", x.kind.name)
            put("title", x.title.trim())
            putOrNull("amount", x.amount)
            put("duration_minutes", x.durationMinutes)
            put("logged_at", x.loggedAt)
            putOrNull("note", x.note)
        }
        return upsert("care_logs", x.id, v)
    }

    fun deleteCareLog(id: Long) = delete("care_logs", id)

    private fun care(c: Cursor) = CareLog(
        id = c.long("id"), petId = c.long("pet_id"), kind = CareKind.of(c.str("kind")), title = c.str("title")!!,
        amount = c.str("amount"), durationMinutes = c.longOrNull("duration_minutes")?.toInt(),
        loggedAt = c.long("logged_at"), note = c.str("note"),
    )

    // ================================================================= اسناد
    fun documents(petId: Long): List<PetDocument> =
        query("SELECT * FROM documents WHERE pet_id=? ORDER BY created_at DESC", ::document, petId)

    fun relatedDocuments(type: String, id: Long): List<PetDocument> =
        query("SELECT * FROM documents WHERE related_type=? AND related_id=? ORDER BY created_at ASC", ::document, type, id)

    fun document(id: Long): PetDocument? = query("SELECT * FROM documents WHERE id=?", ::document, id).firstOrNull()

    fun allDocumentPaths(): List<String> {
        val out = ArrayList<String>()
        db.rawQuery("SELECT file_path FROM documents", null).use { c -> while (c.moveToNext()) out += c.getString(0) }
        return out
    }

    fun allPhotoPaths(): List<String> {
        val out = ArrayList<String>()
        db.rawQuery("SELECT photo FROM pets WHERE photo IS NOT NULL", null).use { c -> while (c.moveToNext()) out += c.getString(0) }
        return out
    }

    fun saveDocument(d: PetDocument): Long {
        val v = ContentValues().apply {
            put("pet_id", d.petId)
            put("title", d.title.trim())
            put("category", d.category.name)
            put("file_path", d.filePath)
            put("mime", d.mime)
            put("size_bytes", d.sizeBytes)
            putOrNull("note", d.note)
            put("related_type", d.relatedType)
            put("related_id", d.relatedId)
            put("created_at", d.createdAt)
        }
        return upsert("documents", d.id, v)
    }

    fun deleteDocument(id: Long) = delete("documents", id)

    /** فقط ردیف‌ها حذف می‌شوند؛ فایل‌های یتیم توسط FileStore.cleanupOrphans پاک می‌شوند. */
    private fun deleteRelatedDocsRows(type: String, id: Long) {
        db.delete("documents", "related_type=? AND related_id=?", arrayOf(type, id.toString()))
    }

    private fun document(c: Cursor) = PetDocument(
        id = c.long("id"), petId = c.long("pet_id"), title = c.str("title")!!, category = DocCategory.of(c.str("category")),
        filePath = c.str("file_path")!!, mime = c.str("mime")!!, sizeBytes = c.long("size_bytes"), note = c.str("note"),
        relatedType = c.str("related_type"), relatedId = c.longOrNull("related_id"), createdAt = c.long("created_at"),
    )

    // ================================================================= جست‌وجو و آمار
    fun searchVisits(petId: Long?, q: String): List<VetVisit> {
        val like = "%" + q.trim().replace("%", "").replace("_", "") + "%"
        val where = "(clinic LIKE ? OR vet LIKE ? OR reason LIKE ? OR symptoms LIKE ? OR diagnosis LIKE ? OR prescriptions LIKE ? OR note LIKE ?)"
        val args = MutableList(7) { like }
        return if (petId == null) query("SELECT * FROM vet_visits WHERE $where ORDER BY visit_at DESC", ::visit, *args.toTypedArray())
        else query("SELECT * FROM vet_visits WHERE pet_id=? AND $where ORDER BY visit_at DESC", ::visit, petId, *args.toTypedArray())
    }

    fun counts(): Map<String, Long> = AppDatabase.TABLES.associateWith { scalarLong("SELECT COUNT(*) FROM $it") }

    fun wipeAll() {
        transaction { AppDatabase.TABLES.asReversed().forEach { db.delete(it, null, null) } }
    }

    // ================================================================= کمکی‌ها
    private fun <T> query(sql: String, map: (Cursor) -> T, vararg args: Any): List<T> {
        val out = ArrayList<T>()
        db.rawQuery(sql, args.map { it.toString() }.toTypedArray()).use { c ->
            while (c.moveToNext()) out += map(c)
        }
        return out
    }

    private fun scalarLong(sql: String): Long = db.rawQuery(sql, null).use { c -> if (c.moveToFirst()) c.getLong(0) else 0L }

    private fun upsert(table: String, id: Long, v: ContentValues): Long = if (id == 0L) {
        db.insertOrThrow(table, null, v)
    } else {
        val n = db.update(table, v, "id=?", arrayOf(id.toString()))
        check(n == 1) { "record not found" }
        id
    }

    private fun delete(table: String, id: Long) {
        db.delete(table, "id=?", arrayOf(id.toString()))
    }
}

private fun ContentValues.putOrNull(key: String, value: String?) {
    val v = value?.trim()
    if (v.isNullOrEmpty()) putNull(key) else put(key, v)
}

internal fun Cursor.str(col: String): String? = getColumnIndexOrThrow(col).let { if (isNull(it)) null else getString(it) }
internal fun Cursor.long(col: String): Long = getLong(getColumnIndexOrThrow(col))
internal fun Cursor.double(col: String): Double = getDouble(getColumnIndexOrThrow(col))
internal fun Cursor.longOrNull(col: String): Long? = getColumnIndexOrThrow(col).let { if (isNull(it)) null else getLong(it) }
