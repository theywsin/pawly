package ir.panjeh.petcare.reminders

import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Intent
import ir.panjeh.petcare.Graph
import ir.panjeh.petcare.TestEnv
import ir.panjeh.petcare.data.Medication
import ir.panjeh.petcare.data.Reminder
import ir.panjeh.petcare.data.ReminderType
import ir.panjeh.petcare.data.Repeat
import ir.panjeh.petcare.data.Vaccine
import ir.panjeh.petcare.data.VaccineStatus
import ir.panjeh.petcare.data.VetVisit
import ir.panjeh.petcare.data.VisitStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowAlarmManager
import java.time.LocalDate
import java.time.LocalTime

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ReminderSystemTest {
    private val ctx get() = RuntimeEnvironment.getApplication()
    private val am get() = ctx.getSystemService(AlarmManager::class.java)
    private val nm get() = ctx.getSystemService(NotificationManager::class.java)

    @Before
    fun setUp() {
        TestEnv.reset()
        ShadowAlarmManager.setCanScheduleExactAlarms(true)
        shadowOf(ctx).grantPermissions(android.Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun seed(): Long {
        val repo = Graph.repo
        val pet = repo.savePet(TestEnv.samplePet())
        repo.saveReminder(Reminder(petId = pet, type = ReminderType.FEEDING, title = "غذای صبح", startAt = TestEnv.at(-5, 8), repeat = Repeat.DAILY))
        repo.saveMedication(Medication(petId = pet, name = "آموکسی‌سیلین", dosage = "نصف قرص", times = listOf(LocalTime.of(9, 0), LocalTime.of(21, 0)), startOn = LocalDate.now()))
        repo.saveVaccine(Vaccine(petId = pet, name = "هاری", status = VaccineStatus.PLANNED, scheduledOn = LocalDate.now().plusDays(10), remindDaysBefore = 1))
        repo.saveVisit(VetVisit(petId = pet, status = VisitStatus.SCHEDULED, visitAt = TestEnv.at(3, 17), remindMinutesBefore = 60))
        return pet
    }

    @Test
    fun syncSchedulesOneAlarmPerSourceAndCancelsStale() {
        seed()
        ReminderScheduler.sync(ctx)
        val keys = ReminderScheduler.scheduledKeys(ctx)
        assertEquals(setOf("reminder/1", "dose/1", "vaccine/1", "visit/1"), keys)
        assertEquals(4, shadowOf(am).scheduledAlarms.size)
        // زمان یادآور واکسن: یک روز قبل، ساعت پیش‌فرض ۹
        val vacAt = Occurrences.vaccineAlarmAt(Graph.repo.vaccine(1)!!, LocalTime.of(9, 0))!!
        assertEquals(TestEnv.at(9, 9), vacAt)
        assertTrue(shadowOf(am).scheduledAlarms.any { it.triggerAtTime == vacAt })

        // حذف یادآور → لغو هشدار
        Graph.repo.deleteReminder(1)
        ReminderScheduler.sync(ctx)
        assertFalse("reminder/1" in ReminderScheduler.scheduledKeys(ctx))
        assertEquals(3, shadowOf(am).scheduledAlarms.size)

        // خاموش کردن اعلان‌ها در تنظیمات برنامه → هیچ هشداری
        Graph.prefs.notificationsEnabled = false
        ReminderScheduler.sync(ctx)
        assertEquals(0, shadowOf(am).scheduledAlarms.size)
    }

    @Test
    fun fallsBackToInexactWhenExactDenied() {
        seed()
        ShadowAlarmManager.setCanScheduleExactAlarms(false)
        ReminderScheduler.sync(ctx)
        assertEquals(4, shadowOf(am).scheduledAlarms.size)
        assertFalse(ReminderScheduler.canScheduleExact(ctx))
    }

    @Test
    fun firingPostsPersianNotificationAndDoneActionLogs() {
        seed()
        val at = TestEnv.at(0, 21)
        val fire = Intent(ctx, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_FIRE
            data = android.net.Uri.parse("panjeh://alarm/dose/1")
            putExtra(ReminderReceiver.EXTRA_AT, at)
        }
        ReminderReceiver().onReceive(ctx, fire)
        Thread.sleep(300)
        org.robolectric.shadows.ShadowLooper.idleMainLooper()
        val posted = shadowOf(nm).allNotifications
        assertEquals(1, posted.size)
        val n = posted.single()
        assertEquals("نوبت دارو: آموکسی‌سیلین", n.extras.getString("android.title"))
        assertTrue(n.extras.getCharSequence("android.text").toString().contains("نصف قرص"))
        assertEquals("مصرف شد", n.actions.single().title.toString())

        // اقدام «مصرف شد» از داخل اعلان
        val done = Intent(ctx, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_DONE
            data = android.net.Uri.parse("panjeh://done/dose/1/$at")
            putExtra(ReminderReceiver.EXTRA_AT, at)
        }
        ReminderReceiver().onReceive(ctx, done)
        Thread.sleep(300)
        assertEquals(1, Graph.repo.doseLogs(1).size)
        assertEquals(0, shadowOf(nm).allNotifications.size)
    }

    @Test
    fun noNotificationWithoutPermissionButAgendaStillWorks() {
        seed()
        shadowOf(ctx).denyPermissions(android.Manifest.permission.POST_NOTIFICATIONS)
        val fire = Intent(ctx, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_FIRE
            data = android.net.Uri.parse("panjeh://alarm/reminder/1")
            putExtra(ReminderReceiver.EXTRA_AT, TestEnv.at(1, 8))
        }
        ReminderReceiver().onReceive(ctx, fire)
        Thread.sleep(300)
        assertEquals(0, shadowOf(nm).allNotifications.size)
        val today = LocalDate.now()
        val agenda = AgendaBuilder.build(Graph.repo, today, today, includeOverdue = true)
        assertTrue(agenda.any { it.title == "غذای صبح" })
        assertTrue(agenda.any { it.title == "آموکسی‌سیلین" })
    }

    @Test
    fun bootCompletedReschedules() {
        seed()
        assertEquals(0, shadowOf(am).scheduledAlarms.size)
        SystemEventsReceiver().onReceive(ctx, Intent(Intent.ACTION_BOOT_COMPLETED))
        Thread.sleep(500)
        assertEquals(4, shadowOf(am).scheduledAlarms.size)
    }
}
