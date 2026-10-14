package ir.panjeh.petcare.data

import ir.panjeh.petcare.Graph
import ir.panjeh.petcare.TestEnv
import ir.panjeh.petcare.data.backup.BackupCrypto
import ir.panjeh.petcare.data.backup.BackupManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.time.LocalDate
import java.time.LocalTime

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RepositoryTest {
    @Before
    fun setUp() = TestEnv.reset()

    @Test
    fun petCrudAndPersistenceAcrossReopen() {
        val repo = Graph.repo
        val id = repo.savePet(TestEnv.samplePet())
        repo.saveWeight(WeightEntry(petId = id, grams = 4200.0, measuredAt = TestEnv.at(0, 9)))
        // بستن و باز کردن مجدد پایگاه داده (شبیه بستن و اجرای دوباره برنامه)
        Graph.resetForTests()
        Graph.init(RuntimeEnvironment.getApplication())
        val again = Graph.repo.pet(id)
        assertNotNull(again)
        assertEquals("پیشی", again!!.name)
        assertEquals(Species.CAT, again.species)
        assertEquals(4200.0, Graph.repo.latestWeight(id)!!.grams, 0.01)
        Graph.repo.savePet(again.copy(name = "پیشی‌جان"))
        assertEquals("پیشی‌جان", Graph.repo.pet(id)!!.name)
    }

    @Test
    fun petsAreIsolatedAndDeleteCascades() {
        val repo = Graph.repo
        val a = repo.savePet(TestEnv.samplePet("الف"))
        val b = repo.savePet(TestEnv.samplePet("ب", Species.DOG))
        repo.saveVaccine(Vaccine(petId = a, name = "هاری", status = VaccineStatus.DONE, givenOn = LocalDate.now()))
        repo.saveVaccine(Vaccine(petId = b, name = "چندگانه", status = VaccineStatus.PLANNED, scheduledOn = LocalDate.now().plusDays(10)))
        repo.saveMedication(Medication(petId = a, name = "دارو", dosage = "۱ قرص", times = listOf(LocalTime.of(8, 0)), startOn = LocalDate.now()))
        repo.saveVisit(VetVisit(petId = a, status = VisitStatus.DONE, visitAt = TestEnv.at(-3, 10), reason = "معاینه"))
        repo.saveReminder(Reminder(petId = a, type = ReminderType.FEEDING, title = "غذا", startAt = TestEnv.at(0, 8), repeat = Repeat.DAILY))
        repo.saveHealthRecord(HealthRecord(petId = a, kind = HealthKind.SYMPTOM, title = "عطسه", date = LocalDate.now()))
        repo.saveCareLog(CareLog(petId = a, kind = CareKind.FEEDING, title = "غذا", loggedAt = TestEnv.at(0, 8)))
        assertEquals(1, repo.vaccines(a).size)
        assertEquals(1, repo.vaccines(b).size)
        assertEquals("هاری", repo.vaccines(a).single().name)

        repo.deletePet(a)
        assertNull(repo.pet(a))
        assertTrue(repo.vaccines(a).isEmpty())
        assertTrue(repo.medications(a).isEmpty())
        assertTrue(repo.visits(a).isEmpty())
        assertTrue(repo.reminders(a).isEmpty())
        assertTrue(repo.healthRecords(a).isEmpty())
        assertTrue(repo.careLogs(a).isEmpty())
        assertEquals(1, repo.vaccines(b).size)
    }

    @Test(expected = android.database.sqlite.SQLiteConstraintException::class)
    fun rejectsIncompleteData() {
        Graph.repo.savePet(Pet(name = "   ", species = Species.DOG))
    }

    @Test
    fun visitSearch() {
        val repo = Graph.repo
        val a = repo.savePet(TestEnv.samplePet())
        repo.saveVisit(VetVisit(petId = a, status = VisitStatus.DONE, visitAt = TestEnv.at(-30, 10), clinic = "کلینیک آرامش", diagnosis = "سالم"))
        repo.saveVisit(VetVisit(petId = a, status = VisitStatus.DONE, visitAt = TestEnv.at(-3, 10), reason = "واکسن"))
        assertEquals(1, repo.searchVisits(a, "آرامش").size)
        assertEquals(0, repo.searchVisits(a, "ناموجود").size)
    }

    @Test
    fun backupRoundTripRestoresEverything() {
        val ctx = RuntimeEnvironment.getApplication()
        val repo = Graph.repo
        val a = repo.savePet(TestEnv.samplePet())
        repo.saveWeight(WeightEntry(petId = a, grams = 3900.0, measuredAt = TestEnv.at(-10, 9)))
        repo.saveVaccine(Vaccine(petId = a, name = "هاری", status = VaccineStatus.PLANNED, scheduledOn = LocalDate.now().plusDays(5), remindDaysBefore = 1))
        // یک سند واقعی
        val rel = "media/docs/test.pdf"
        File(ctx.filesDir, rel).apply { parentFile!!.mkdirs(); writeText("%PDF-1.4 test") }
        repo.saveDocument(PetDocument(petId = a, title = "نسخه", category = DocCategory.PRESCRIPTION, filePath = rel, mime = "application/pdf", sizeBytes = 13))
        Graph.prefs.ownerName = "مریم"

        val mgr = BackupManager(ctx, repo, Graph.prefs, Graph.files, "1.0.0")
        val file = File(ctx.cacheDir, "b.panjeh")
        val s = mgr.exportToFile(file, "pass1234".toCharArray())
        assertEquals(1, s.pets)
        assertEquals(1, s.files)

        // پاک کردن کامل و بازیابی
        repo.wipeAll(); Graph.files.wipe(); Graph.prefs.clear()
        assertEquals(0, repo.petCount())
        try {
            mgr.restoreFromFile(file, "wrong-pass".toCharArray())
            error("should fail")
        } catch (e: BackupCrypto.WrongPasswordOrCorrupt) {
            assertEquals(0, repo.petCount())
        }
        val r = mgr.restoreFromFile(file, "pass1234".toCharArray())
        assertEquals(1, r.pets)
        val p = repo.pets().single()
        assertEquals("پیشی", p.name)
        assertEquals(3900.0, repo.latestWeight(p.id)!!.grams, 0.01)
        assertEquals("هاری", repo.vaccines(p.id).single().name)
        val doc = repo.documents(p.id).single()
        assertEquals("%PDF-1.4 test", Graph.files.resolve(doc.filePath).readText())
        assertEquals("مریم", Graph.prefs.ownerName)
        assertTrue(Graph.prefs.onboardingDone)
    }
}
