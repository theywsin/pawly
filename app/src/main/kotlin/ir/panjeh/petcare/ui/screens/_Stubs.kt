package ir.panjeh.petcare.ui.screens
import ir.panjeh.petcare.ui.nav.*
import android.view.View
private abstract class StubBase(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class HealthScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class RemindersScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class SettingsScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class InboxScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class PetProfileScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class VaccineEditScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class VaccineDetailScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class MedicationEditScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class MedicationDetailScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class VisitEditScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class VisitDetailScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class WeightEditScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class WeightScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class ReminderEditScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class HealthRecordEditScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class CareEditScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class FeedingEditScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class DocumentEditScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class DocumentViewScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class BackupScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class DataScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class ProfileScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class AboutScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class NotificationSettingsScreen(h: Host, r: Route) : Screen(h, r) { override fun build(): View = View(ctx) }
class InfoScreen(h: Host, r: Route, val k: Kind) : Screen(h, r) { enum class Kind { HELP, PRIVACY }; override fun build(): View = View(ctx) }
