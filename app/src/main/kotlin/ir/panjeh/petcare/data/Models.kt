package ir.panjeh.petcare.data

import java.time.LocalDate
import java.time.LocalTime

/*
 * مدل‌های داده. شناسه هر رکورد مستقل است (INTEGER PRIMARY KEY) و همه سوابق از طریق
 * petId به یک حیوان مشخص تعلق دارند؛ با حذف حیوان، سوابق او نیز (CASCADE) حذف می‌شوند.
 */

enum class Species(val label: String) {
    DOG("سگ"), CAT("گربه"), BIRD("پرنده"), RABBIT("خرگوش"), OTHER("سایر");

    companion object {
        fun of(key: String?): Species = entries.firstOrNull { it.name == key } ?: OTHER
    }
}

enum class Sex(val label: String) {
    MALE("نر"), FEMALE("ماده"), UNKNOWN("نامشخص");

    companion object {
        fun of(key: String?): Sex = entries.firstOrNull { it.name == key } ?: UNKNOWN
    }
}

data class Pet(
    val id: Long = 0,
    val name: String,
    val species: Species,
    val speciesOther: String? = null,
    val breed: String? = null,
    val sex: Sex = Sex.UNKNOWN,
    val birthDate: LocalDate? = null,
    val color: String? = null,
    /** null یعنی نامشخص */
    val neutered: Boolean? = null,
    val allergies: String? = null,
    val conditions: String? = null,
    val photo: String? = null,
    val notes: String? = null,
    val microchip: String? = null,
    val foodType: String? = null,
    val mealsPerDay: Int? = null,
    val feedingNotes: String? = null,
    val vetName: String? = null,
    val vetClinic: String? = null,
    val vetPhone: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
) {
    val speciesLabel: String
        get() = if (species == Species.OTHER && !speciesOther.isNullOrBlank()) speciesOther else species.label
}

data class WeightEntry(
    val id: Long = 0,
    val petId: Long,
    val grams: Double,
    val measuredAt: Long,
    val note: String? = null,
)

enum class VaccineStatus { PLANNED, DONE }

data class Vaccine(
    val id: Long = 0,
    val petId: Long,
    val name: String,
    val status: VaccineStatus,
    /** تاریخ نوبت برنامه‌ریزی‌شده (برای PLANNED) */
    val scheduledOn: LocalDate? = null,
    /** تاریخ تزریق (برای DONE) */
    val givenOn: LocalDate? = null,
    val clinic: String? = null,
    val vet: String? = null,
    val note: String? = null,
    /** چند روز قبل از نوبت یادآوری شود؛ null یعنی بدون یادآور */
    val remindDaysBefore: Int? = 0,
    val createdAt: Long = System.currentTimeMillis(),
) {
    fun isOverdue(today: LocalDate = LocalDate.now()) =
        status == VaccineStatus.PLANNED && scheduledOn != null && scheduledOn.isBefore(today)
}

enum class MedicationStatus { ACTIVE, STOPPED }

data class Medication(
    val id: Long = 0,
    val petId: Long,
    val name: String,
    /** مقدار تجویزشده دقیقاً همان‌طور که دامپزشک نوشته است (متن آزاد) */
    val dosage: String,
    val times: List<LocalTime>,
    val everyNDays: Int = 1,
    val startOn: LocalDate,
    val endOn: LocalDate? = null,
    val prescriber: String? = null,
    val note: String? = null,
    val status: MedicationStatus = MedicationStatus.ACTIVE,
    val remindersEnabled: Boolean = true,
    val createdAt: Long = System.currentTimeMillis(),
) {
    fun isActiveOn(day: LocalDate): Boolean =
        status == MedicationStatus.ACTIVE && !day.isBefore(startOn) && (endOn == null || !day.isAfter(endOn)) &&
            (java.time.temporal.ChronoUnit.DAYS.between(startOn, day) % everyNDays == 0L)
}

enum class DoseStatus(val label: String) { TAKEN("مصرف شد"), SKIPPED("داده نشد") }

data class DoseLog(
    val id: Long = 0,
    val medicationId: Long,
    val petId: Long,
    val scheduledAt: Long,
    val status: DoseStatus,
    val loggedAt: Long = System.currentTimeMillis(),
)

enum class VisitStatus { SCHEDULED, DONE }

data class VetVisit(
    val id: Long = 0,
    val petId: Long,
    val status: VisitStatus,
    val visitAt: Long,
    val clinic: String? = null,
    val vet: String? = null,
    val reason: String? = null,
    val symptoms: String? = null,
    val diagnosis: String? = null,
    val prescriptions: String? = null,
    val costToman: Long? = null,
    val note: String? = null,
    /** دقیقه قبل از نوبت برای یادآوری؛ null یعنی بدون یادآور */
    val remindMinutesBefore: Int? = 60,
    val createdAt: Long = System.currentTimeMillis(),
)

enum class ReminderType(val label: String) {
    VACCINE("واکسن"),
    MEDICATION("دارو"),
    VET("دامپزشک"),
    WEIGHT("ثبت وزن"),
    GROOMING("نظافت و آرایش"),
    FEEDING("تغذیه"),
    CARE("مراقبت"),
    OTHER("سایر");

    companion object {
        fun of(key: String?): ReminderType = entries.firstOrNull { it.name == key } ?: OTHER
        /** انواع قابل انتخاب توسط کاربر برای یادآور دستی */
        val userSelectable = listOf(WEIGHT, GROOMING, FEEDING, CARE, VET, VACCINE, MEDICATION, OTHER)
    }
}

enum class Repeat(val label: String) {
    NONE("بدون تکرار"),
    DAILY("هر روز"),
    EVERY_N_DAYS("هر چند روز"),
    WEEKLY("هر هفته"),
    MONTHLY("هر ماه"),
    YEARLY("هر سال");

    companion object {
        fun of(key: String?): Repeat = entries.firstOrNull { it.name == key } ?: NONE
    }
}

data class Reminder(
    val id: Long = 0,
    val petId: Long?,
    val type: ReminderType,
    val title: String,
    val note: String? = null,
    /** زمان اولین وقوع */
    val startAt: Long,
    val repeat: Repeat = Repeat.NONE,
    val interval: Int = 1,
    val endOn: LocalDate? = null,
    val enabled: Boolean = true,
    val createdAt: Long = System.currentTimeMillis(),
)

enum class OccurrenceStatus(val label: String) { DONE("انجام شد"), SKIPPED("رد شد") }

enum class HealthKind(val label: String) {
    SYMPTOM("علائم و مشاهدات"),
    ILLNESS("بیماری"),
    TEST("آزمایش"),
    SURGERY("جراحی و درمان"),
    ALLERGY("حساسیت"),
    NOTE("یادداشت");

    companion object {
        fun of(key: String?): HealthKind = entries.firstOrNull { it.name == key } ?: NOTE
    }
}

data class HealthRecord(
    val id: Long = 0,
    val petId: Long,
    val kind: HealthKind,
    val title: String,
    val date: LocalDate,
    val note: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
)

enum class CareKind(val label: String) {
    FEEDING("وعده غذایی"),
    ACTIVITY("فعالیت و بازی"),
    GROOMING("نظافت و آرایش"),
    OTHER("سایر");

    companion object {
        fun of(key: String?): CareKind = entries.firstOrNull { it.name == key } ?: OTHER
    }
}

data class CareLog(
    val id: Long = 0,
    val petId: Long,
    val kind: CareKind,
    val title: String,
    val amount: String? = null,
    val durationMinutes: Int? = null,
    val loggedAt: Long,
    val note: String? = null,
)

enum class DocCategory(val label: String) {
    VACCINE_CERT("گواهی واکسیناسیون"),
    PRESCRIPTION("نسخه دامپزشک"),
    LAB("نتایج آزمایش"),
    ID("مدارک شناسایی"),
    IMAGING("تصاویر پزشکی"),
    OTHER("سایر");

    companion object {
        fun of(key: String?): DocCategory = entries.firstOrNull { it.name == key } ?: OTHER
    }
}

data class PetDocument(
    val id: Long = 0,
    val petId: Long,
    val title: String,
    val category: DocCategory,
    /** مسیر نسبی داخل حافظه خصوصی برنامه */
    val filePath: String,
    val mime: String,
    val sizeBytes: Long,
    val note: String? = null,
    /** پیوند اختیاری به سابقه دیگر: vaccine / visit */
    val relatedType: String? = null,
    val relatedId: Long? = null,
    val createdAt: Long = System.currentTimeMillis(),
) {
    val isImage: Boolean get() = mime.startsWith("image/")
    val isPdf: Boolean get() = mime == "application/pdf"
}
