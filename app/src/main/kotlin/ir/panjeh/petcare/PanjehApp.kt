package ir.panjeh.petcare

import android.app.Application
import ir.panjeh.petcare.reminders.Notifications

class PanjehApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Graph.init(this)
        Notifications.ensureChannels(this)
    }
}
