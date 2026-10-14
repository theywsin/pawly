package ir.panjeh.petcare.ui.screens

import ir.panjeh.petcare.ui.nav.Host
import ir.panjeh.petcare.ui.nav.Route
import ir.panjeh.petcare.ui.nav.Screen
import ir.panjeh.petcare.ui.nav.Tab

/** فهرست همه صفحه‌ها و سازنده آن‌ها */
object Screens {
    const val WELCOME = "welcome"
    const val ONBOARDING = "onboarding"
    const val HOME = "home"
    const val PETS = "pets"
    const val HEALTH = "health"
    const val REMINDERS = "reminders"
    const val SETTINGS = "settings"
    const val INBOX = "inbox"
    const val PET_EDIT = "pet_edit"
    const val PET_PROFILE = "pet_profile"
    const val VACCINE_EDIT = "vaccine_edit"
    const val VACCINE_DETAIL = "vaccine_detail"
    const val MED_EDIT = "med_edit"
    const val MED_DETAIL = "med_detail"
    const val VISIT_EDIT = "visit_edit"
    const val VISIT_DETAIL = "visit_detail"
    const val WEIGHT_EDIT = "weight_edit"
    const val WEIGHT = "weight"
    const val REMINDER_EDIT = "reminder_edit"
    const val HEALTH_EDIT = "health_edit"
    const val CARE_EDIT = "care_edit"
    const val FEEDING_EDIT = "feeding_edit"
    const val DOC_EDIT = "doc_edit"
    const val DOC_VIEW = "doc_view"
    const val BACKUP = "backup"
    const val DATA = "data"
    const val PROFILE = "profile"
    const val HELP = "help"
    const val PRIVACY = "privacy"
    const val ABOUT = "about"
    const val NOTIF_SETTINGS = "notif_settings"

    fun rootOf(tab: Tab): String = when (tab) {
        Tab.HOME -> HOME
        Tab.PETS -> PETS
        Tab.HEALTH -> HEALTH
        Tab.REMINDERS -> REMINDERS
        Tab.SETTINGS -> SETTINGS
    }

    fun create(host: Host, route: Route): Screen = when (route.name) {
        WELCOME -> WelcomeScreen(host, route)
        ONBOARDING -> OnboardingScreen(host, route)
        HOME -> HomeScreen(host, route)
        PETS -> PetsScreen(host, route)
        HEALTH -> HealthScreen(host, route)
        REMINDERS -> RemindersScreen(host, route)
        SETTINGS -> SettingsScreen(host, route)
        INBOX -> InboxScreen(host, route)
        PET_EDIT -> PetEditScreen(host, route)
        PET_PROFILE -> PetProfileScreen(host, route)
        VACCINE_EDIT -> VaccineEditScreen(host, route)
        VACCINE_DETAIL -> VaccineDetailScreen(host, route)
        MED_EDIT -> MedicationEditScreen(host, route)
        MED_DETAIL -> MedicationDetailScreen(host, route)
        VISIT_EDIT -> VisitEditScreen(host, route)
        VISIT_DETAIL -> VisitDetailScreen(host, route)
        WEIGHT_EDIT -> WeightEditScreen(host, route)
        WEIGHT -> WeightScreen(host, route)
        REMINDER_EDIT -> ReminderEditScreen(host, route)
        HEALTH_EDIT -> HealthRecordEditScreen(host, route)
        CARE_EDIT -> CareEditScreen(host, route)
        FEEDING_EDIT -> FeedingEditScreen(host, route)
        DOC_EDIT -> DocumentEditScreen(host, route)
        DOC_VIEW -> DocumentViewScreen(host, route)
        BACKUP -> BackupScreen(host, route)
        DATA -> DataScreen(host, route)
        PROFILE -> ProfileScreen(host, route)
        HELP -> InfoScreen(host, route, InfoScreen.Kind.HELP)
        PRIVACY -> InfoScreen(host, route, InfoScreen.Kind.PRIVACY)
        ABOUT -> AboutScreen(host, route)
        NOTIF_SETTINGS -> NotificationSettingsScreen(host, route)
        else -> HomeScreen(host, Route.of(HOME))
    }
}
