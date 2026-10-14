package ir.panjeh.petcare.ui

import ir.panjeh.petcare.Graph
import ir.panjeh.petcare.MainActivity
import ir.panjeh.petcare.TestEnv
import ir.panjeh.petcare.allViews
import ir.panjeh.petcare.clickText
import ir.panjeh.petcare.data.Prefs
import ir.panjeh.petcare.idle
import ir.panjeh.petcare.ui.nav.Route
import ir.panjeh.petcare.ui.nav.Tab
import ir.panjeh.petcare.ui.screens.Screens
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** تولید تصاویر واقعی صفحه‌ها برای مستندات و فروشگاه (docs/screenshots) */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w360dp-h780dp-xxhdpi")
class ScreenshotTest {
    @Before
    fun setUp() = TestEnv.reset()

    private fun launch(): MainActivity = Robolectric.buildActivity(MainActivity::class.java).setup().get().also { idle() }

    @Test
    fun onboardingScreens() {
        val a = launch()
        Shots.capture(a, "01-welcome")
        a.window.decorView.clickText("شروع کنیم")
        Shots.capture(a, "02-onboarding-1")
        a.window.decorView.clickText("بعدی")
        Shots.capture(a, "03-onboarding-2")
        a.window.decorView.clickText("بعدی")
        a.window.decorView.clickText("شروع استفاده")
        Shots.capture(a, "04-add-first-pet")
    }

    @Test
    fun mainScreensLight() {
        DemoData.seed()
        val a = launch()
        val pet = Graph.repo.pets().first()
        Shots.capture(a, "05-dashboard")
        a.window.decorView.allViews().filterIsInstance<android.widget.ScrollView>().firstOrNull()?.scrollTo(0, 1500)
        Shots.capture(a, "06-dashboard-summary")
        a.push(Route.of(Screens.PET_PROFILE, "id" to pet.id)); idle()
        Shots.capture(a, "07-pet-profile")
        a.window.decorView.clickText("واکسیناسیون")
        Shots.capture(a, "08-vaccines")
        a.window.decorView.clickText("وزن و رشد")
        Shots.capture(a, "09-weight-chart")
        a.window.decorView.clickText("داروها")
        a.push(Route.of(Screens.MED_DETAIL, "id" to 1L)); idle()
        Shots.capture(a, "10-medication")
        a.push(Route.of(Screens.VISIT_DETAIL, "id" to 1L)); idle()
        Shots.capture(a, "11-vet-visit")
        a.switchTab(Tab.REMINDERS); idle()
        Shots.capture(a, "12-reminders")
        a.switchTab(Tab.HEALTH); idle()
        Shots.capture(a, "13-health")
        a.switchTab(Tab.PETS); idle()
        Shots.capture(a, "14-my-pets")
        a.switchTab(Tab.SETTINGS); idle()
        Shots.capture(a, "15-settings")
        a.push(Route.of(Screens.BACKUP)); idle()
        Shots.capture(a, "16-backup")
        a.push(Route.of(Screens.VACCINE_EDIT, "petId" to pet.id)); idle()
        Shots.capture(a, "17-vaccine-form")
        a.window.decorView.allViews().first { it.contentDescription == "تاریخ تزریق" }.performClick(); idle()
        Shots.capture(a, "18-jalali-date-picker")
        a.push(Route.of(Screens.REMINDER_EDIT, "petId" to pet.id)); idle()
        Shots.capture(a, "19-reminder-form", dialog = null)
    }

    @Test
    fun darkMode() {
        DemoData.seed()
        Graph.prefs.themeMode = Prefs.ThemeMode.DARK
        val a = launch()
        Shots.capture(a, "20-dashboard-dark")
        a.push(Route.of(Screens.PET_PROFILE, "id" to Graph.repo.pets().first().id)); idle()
        Shots.capture(a, "21-pet-profile-dark")
    }

    @Test
    @Config(qualifiers = "w320dp-h568dp-xhdpi")
    fun smallScreen() {
        DemoData.seed()
        val a = launch()
        Shots.capture(a, "22-small-screen-dashboard")
        a.push(Route.of(Screens.MED_EDIT, "petId" to Graph.repo.pets().first().id)); idle()
        Shots.capture(a, "23-small-screen-form")
    }

    @Test
    fun emptyStates() {
        Graph.prefs.onboardingDone = true
        val a = launch()
        Shots.capture(a, "24-empty-dashboard")
        a.switchTab(Tab.REMINDERS); idle()
        Shots.capture(a, "25-empty-reminders")
    }
}
