package ir.panjeh.petcare.ui

import ir.panjeh.petcare.Graph
import ir.panjeh.petcare.TestEnv
import ir.panjeh.petcare.data.CareKind
import ir.panjeh.petcare.data.CareLog
import ir.panjeh.petcare.data.DoseLog
import ir.panjeh.petcare.data.DoseStatus
import ir.panjeh.petcare.data.HealthKind
import ir.panjeh.petcare.data.HealthRecord
import ir.panjeh.petcare.data.Medication
import ir.panjeh.petcare.data.Pet
import ir.panjeh.petcare.data.Reminder
import ir.panjeh.petcare.data.ReminderType
import ir.panjeh.petcare.data.Repeat
import ir.panjeh.petcare.data.Sex
import ir.panjeh.petcare.data.Species
import ir.panjeh.petcare.data.Vaccine
import ir.panjeh.petcare.data.VaccineStatus
import ir.panjeh.petcare.data.VetVisit
import ir.panjeh.petcare.data.VisitStatus
import ir.panjeh.petcare.data.WeightEntry
import java.time.LocalDate
import java.time.LocalTime

/**
 * داده‌های نمایشی — فقط برای تست و تولید تصاویر صفحه.
 * هرگز در نسخه نصبی برنامه بارگذاری نمی‌شود (این فایل در مجموعه تست است).
 */
object DemoData {
    fun seed(): Long {
        val repo = Graph.repo
        val today = LocalDate.now()
        Graph.prefs.onboardingDone = true
        Graph.prefs.ownerName = "سارا"
        val cat = repo.savePet(Pet(name = "پیشی", species = Species.CAT, breed = "پرشین", sex = Sex.FEMALE, birthDate = today.minusMonths(27).minusDays(4),
            color = "کرم و سفید", neutered = true, allergies = "حساسیت به غذای حاوی مرغ", vetName = "دکتر نیک‌نام", vetClinic = "کلینیک دامپزشکی آرامش",
            vetPhone = "۰۲۱۸۸۰۰۱۲۳۴", foodType = "غذای خشک گربه بالغ", mealsPerDay = 2, feedingNotes = "طبق توصیه دامپزشک"))
        val dog = repo.savePet(Pet(name = "رکس", species = Species.DOG, breed = "ژرمن شپرد", sex = Sex.MALE, birthDate = today.minusYears(4).minusMonths(2)))
        repo.savePet(Pet(name = "کوکو", species = Species.BIRD, breed = "عروس هلندی", sex = Sex.UNKNOWN, birthDate = today.minusMonths(10)))
        Graph.prefs.activePetId = cat
        listOf(150L to 3600.0, 120L to 3750.0, 90L to 3820.0, 60L to 3900.0, 30L to 4050.0, 2L to 4200.0).forEach { (d, g) ->
            repo.saveWeight(WeightEntry(petId = cat, grams = g, measuredAt = TestEnv.at(-d, 9, 30)))
        }
        repo.saveWeight(WeightEntry(petId = dog, grams = 31500.0, measuredAt = TestEnv.at(-12, 18)))
        repo.saveVaccine(Vaccine(petId = cat, name = "واکسن سه‌گانه گربه", status = VaccineStatus.DONE, givenOn = today.minusDays(200), clinic = "کلینیک آرامش"))
        repo.saveVaccine(Vaccine(petId = cat, name = "واکسن هاری", status = VaccineStatus.DONE, givenOn = today.minusDays(165), clinic = "کلینیک آرامش"))
        repo.saveVaccine(Vaccine(petId = cat, name = "یادآور سه‌گانه", status = VaccineStatus.PLANNED, scheduledOn = today.plusDays(9), remindDaysBefore = 1, clinic = "کلینیک آرامش"))
        repo.saveVaccine(Vaccine(petId = dog, name = "واکسن هاری", status = VaccineStatus.PLANNED, scheduledOn = today.minusDays(4), remindDaysBefore = 1))
        val med = repo.saveMedication(Medication(petId = cat, name = "قطره چشمی", dosage = "یک قطره در هر چشم", times = listOf(LocalTime.of(8, 0), LocalTime.of(20, 0)),
            startOn = today.minusDays(3), endOn = today.plusDays(4), prescriber = "دکتر نیک‌نام"))
        repo.logDose(DoseLog(medicationId = med, petId = cat, scheduledAt = TestEnv.at(0, 8), status = DoseStatus.TAKEN))
        repo.logDose(DoseLog(medicationId = med, petId = cat, scheduledAt = TestEnv.at(-1, 20), status = DoseStatus.TAKEN))
        repo.logDose(DoseLog(medicationId = med, petId = cat, scheduledAt = TestEnv.at(-1, 8), status = DoseStatus.SKIPPED))
        repo.saveVisit(VetVisit(petId = cat, status = VisitStatus.DONE, visitAt = TestEnv.at(-20, 17, 30), clinic = "کلینیک دامپزشکی آرامش", vet = "دکتر نیک‌نام",
            reason = "التهاب چشم", symptoms = "قرمزی و اشک‌ریزش چشم راست", diagnosis = "التهاب خفیف ملتحمه", prescriptions = "قطره چشمی، روزی دو بار به مدت یک هفته", costToman = 850_000))
        repo.saveVisit(VetVisit(petId = cat, status = VisitStatus.DONE, visitAt = TestEnv.at(-165, 11), clinic = "کلینیک دامپزشکی آرامش", reason = "واکسن هاری", costToman = 450_000))
        repo.saveVisit(VetVisit(petId = dog, status = VisitStatus.SCHEDULED, visitAt = TestEnv.at(2, 18), clinic = "بیمارستان دامپزشکی شهر", reason = "معاینه دوره‌ای", remindMinutesBefore = 60))
        repo.saveReminder(Reminder(petId = cat, type = ReminderType.FEEDING, title = "غذای صبح", startAt = TestEnv.at(-30, 7, 30), repeat = Repeat.DAILY))
        repo.saveReminder(Reminder(petId = cat, type = ReminderType.GROOMING, title = "شانه کردن موها", startAt = TestEnv.at(-6, 19), repeat = Repeat.WEEKLY))
        repo.saveReminder(Reminder(petId = dog, type = ReminderType.CARE, title = "پیاده‌روی عصر", startAt = TestEnv.at(-10, 18, 30), repeat = Repeat.DAILY))
        repo.saveReminder(Reminder(petId = cat, type = ReminderType.WEIGHT, title = "ثبت وزن ماهانه", startAt = TestEnv.at(5, 9), repeat = Repeat.MONTHLY))
        repo.logOccurrence(1, TestEnv.at(0, 7, 30), ir.panjeh.petcare.data.OccurrenceStatus.DONE)
        repo.saveHealthRecord(HealthRecord(petId = cat, kind = HealthKind.SYMPTOM, title = "کاهش اشتها", date = today.minusDays(22), note = "دو روز کمتر از معمول غذا خورد"))
        repo.saveHealthRecord(HealthRecord(petId = cat, kind = HealthKind.TEST, title = "آزمایش خون دوره‌ای", date = today.minusDays(160), note = "نتیجه در بخش اسناد ذخیره شده است"))
        repo.saveCareLog(CareLog(petId = cat, kind = CareKind.FEEDING, title = "وعده صبح", amount = "۴۰ گرم غذای خشک", loggedAt = TestEnv.at(0, 7, 35)))
        repo.saveCareLog(CareLog(petId = cat, kind = CareKind.ACTIVITY, title = "بازی با توپ", durationMinutes = 20, loggedAt = TestEnv.at(-1, 17)))
        repo.saveCareLog(CareLog(petId = cat, kind = CareKind.GROOMING, title = "شانه کردن", durationMinutes = 10, loggedAt = TestEnv.at(-6, 19, 5)))
        return cat
    }
}
