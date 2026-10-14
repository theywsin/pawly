package ir.panjeh.petcare.ui

import android.view.View
import android.widget.EditText
import android.widget.TextView
import ir.panjeh.petcare.Graph
import ir.panjeh.petcare.MainActivity
import ir.panjeh.petcare.TestEnv
import ir.panjeh.petcare.allViews
import ir.panjeh.petcare.clickText
import ir.panjeh.petcare.data.Species
import ir.panjeh.petcare.hasText
import ir.panjeh.petcare.idle
import ir.panjeh.petcare.texts
import ir.panjeh.petcare.ui.nav.Route
import ir.panjeh.petcare.ui.nav.Tab
import ir.panjeh.petcare.ui.screens.Screens
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w393dp-h852dp-xxhdpi")
class UiFlowTest {
    private lateinit var controller: ActivityController<MainActivity>
    private val activity get() = controller.get()
    private val root: View get() = activity.window.decorView

    @Before
    fun setUp() = TestEnv.reset()

    private fun launch() {
        controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        idle()
    }

    private fun edit(hint: String): EditText =
        root.allViews().filterIsInstance<EditText>().firstOrNull { it.hint?.toString() == hint } ?: error("فیلد پیدا نشد: $hint")

    /** هیچ متن انگلیسی در رابط نباید دیده شود */
    private fun assertNoLatin(where: String) {
        val latin = root.texts().filter { t -> t.any { it in 'A'..'Z' || it in 'a'..'z' } }
        assertTrue("متن لاتین در $where: $latin", latin.isEmpty())
    }

    @Test
    fun firstRunOnboardingAddPetAndRecordWeight() {
        launch()
        assertTrue(root.hasText("شروع کنیم"))
        assertNoLatin("صفحه شروع")
        assertEquals(View.LAYOUT_DIRECTION_RTL, root.allViews()[1].layoutDirection)
        root.clickText("شروع کنیم")
        assertTrue(root.hasText("مدیریت سلامت در یک نگاه"))
        root.clickText("بعدی")
        assertTrue(root.hasText("یادآور واکسن و دارو"))
        root.clickText("بعدی")
        root.clickText("شروع استفاده")
        assertTrue(Graph.prefs.onboardingDone)
        assertTrue(root.hasText("افزودن اولین حیوان"))
        assertNoLatin("فرم افزودن حیوان")

        // اعتبارسنجی: ذخیره بدون نام
        root.clickText("ذخیره بدون تکمیل جزئیات")
        assertTrue(root.hasText("نام حیوان را وارد کنید"))
        assertTrue(root.hasText("نوع حیوان را انتخاب کنید"))
        assertEquals(0, Graph.repo.petCount())

        edit("مثلاً: پیشی").setText("مِلو")
        root.clickText("گربه")
        root.clickText("مرحله بعد")
        assertTrue(root.hasText("جنسیت"))
        edit("مثلاً: ۴٫۲").setText("۳٫۸")
        root.clickText("مرحله بعد")
        assertTrue(root.hasText("دامپزشک"))
        root.clickText("ذخیره")
        val pet = Graph.repo.pets().single()
        assertEquals("مِلو", pet.name)
        assertEquals(Species.CAT, pet.species)
        assertEquals(3800.0, Graph.repo.latestWeight(pet.id)!!.grams, 0.01)
        assertTrue(root.hasText("برنامه امروز"))
        assertTrue(root.hasText("مِلو"))
        assertNoLatin("داشبورد")

        // میان‌بر ثبت وزن
        root.clickText("ثبت وزن")
        edit("مثلاً: ۴٫۲").setText("abc")
        root.clickText("ذخیره")
        assertTrue(root.hasText("وزن را به عدد وارد کنید"))
        edit("مثلاً: ۴٫۲").setText("۴٫۱")
        root.clickText("ذخیره")
        assertEquals(4100.0, Graph.repo.latestWeight(pet.id)!!.grams, 0.01)
        assertTrue(root.hasText("۴٫۱ کیلوگرم"))
    }

    @Test
    fun backNavigationAndStateRestore() {
        DemoData.seed()
        launch()
        val pet = Graph.repo.pets().first()
        activity.push(Route.of(Screens.PET_PROFILE, "id" to pet.id))
        idle()
        assertTrue(root.hasText("واکسیناسیون"))
        root.clickText("واکسیناسیون")
        assertTrue(root.hasText("یادآور سه‌گانه"))
        root.clickText("یادآور سه‌گانه")
        assertTrue(root.hasText("جزئیات واکسن"))
        // بازسازی Activity (مانند چرخش یا توقف توسط سیستم) پشته را حفظ می‌کند
        controller.recreate()
        idle()
        assertTrue(root.hasText("جزئیات واکسن"))
        @Suppress("DEPRECATION") activity.onBackPressed()
        idle()
        assertTrue(root.hasText("پیشی"))
        @Suppress("DEPRECATION") activity.onBackPressed()
        idle()
        assertTrue(root.hasText("برنامه امروز"))
        // از زبانه دیگر، بازگشت به خانه می‌رود
        activity.switchTab(Tab.SETTINGS)
        idle()
        assertTrue(root.hasText("قالب نمایش"))
        @Suppress("DEPRECATION") activity.onBackPressed()
        idle()
        assertTrue(root.hasText("برنامه امروز"))
    }

    @Test
    fun allScreensRenderPersianWithoutLatinText() {
        DemoData.seed()
        launch()
        val repo = Graph.repo
        val pet = repo.pets().first()
        val routes = listOf(
            Route.of(Screens.HOME), Route.of(Screens.PETS), Route.of(Screens.HEALTH), Route.of(Screens.REMINDERS), Route.of(Screens.SETTINGS),
            Route.of(Screens.INBOX), Route.of(Screens.PET_PROFILE, "id" to pet.id), Route.of(Screens.PET_EDIT, "id" to pet.id),
            Route.of(Screens.VACCINE_EDIT, "petId" to pet.id), Route.of(Screens.VACCINE_DETAIL, "id" to 1L),
            Route.of(Screens.MED_EDIT, "petId" to pet.id), Route.of(Screens.MED_DETAIL, "id" to 1L),
            Route.of(Screens.VISIT_EDIT, "petId" to pet.id), Route.of(Screens.VISIT_DETAIL, "id" to 1L),
            Route.of(Screens.WEIGHT_EDIT, "petId" to pet.id), Route.of(Screens.WEIGHT, "petId" to pet.id),
            Route.of(Screens.REMINDER_EDIT, "petId" to pet.id), Route.of(Screens.REMINDER_EDIT, "id" to 1L),
            Route.of(Screens.HEALTH_EDIT, "petId" to pet.id), Route.of(Screens.CARE_EDIT, "petId" to pet.id),
            Route.of(Screens.FEEDING_EDIT, "petId" to pet.id), Route.of(Screens.BACKUP), Route.of(Screens.DATA),
            Route.of(Screens.PROFILE), Route.of(Screens.HELP), Route.of(Screens.PRIVACY), Route.of(Screens.ABOUT),
            Route.of(Screens.NOTIF_SETTINGS),
        )
        for (r in routes) {
            activity.push(r)
            idle()
            assertNoLatin(r.name)
            assertFalse("خطا در ${r.name}", root.hasText("مشکلی پیش آمد"))
        }
        // همه زبانه‌های پروفایل
        activity.push(Route.of(Screens.PET_PROFILE, "id" to pet.id))
        idle()
        for (tab in listOf("سلامت", "واکسیناسیون", "داروها", "مراجعات", "وزن و رشد", "اسناد", "یادآورها", "تغذیه و مراقبت", "نمای کلی")) {
            root.clickText(tab)
            assertNoLatin("پروفایل/$tab")
            assertFalse(root.hasText("مشکلی پیش آمد"))
        }
    }

    @Test
    fun markAgendaItemDoneFromDashboard() {
        DemoData.seed()
        launch()
        val checks = root.allViews().filter { it.contentDescription?.toString() == "علامت‌گذاری مصرف‌شده" || it.contentDescription?.toString() == "علامت‌گذاری انجام‌شده" }
        assertTrue(checks.isNotEmpty())
        val before = Graph.repo.doseLogs(1).size + Graph.repo.occurrenceLogs(1).size + Graph.repo.occurrenceLogs(3).size
        checks.first().performClick()
        idle()
        val after = Graph.repo.doseLogs(1).size + Graph.repo.occurrenceLogs(1).size + Graph.repo.occurrenceLogs(3).size
        assertEquals(before + 1, after)
    }

    @Test
    fun deletePetRequiresConfirmation() {
        DemoData.seed()
        launch()
        val pet = Graph.repo.pets().first { it.name == "رکس" }
        activity.push(Route.of(Screens.PET_PROFILE, "id" to pet.id))
        idle()
        root.allViews().first { it.contentDescription == "گزینه‌های بیشتر" }.performClick()
        idle()
        val sheet = org.robolectric.shadows.ShadowDialog.getLatestDialog()
        sheet.window!!.decorView.clickText("حذف این حیوان")
        assertEquals(3, Graph.repo.petCount()) // هنوز حذف نشده؛ پنجره تأیید باز است
        val confirm = org.robolectric.shadows.ShadowDialog.getLatestDialog()
        confirm.window!!.decorView.clickText("حذف کامل")
        assertEquals(2, Graph.repo.petCount())
        assertTrue(Graph.repo.pets().none { it.name == "رکس" })
    }

    @Suppress("unused")
    private fun TextView.s() = text.toString()
}
