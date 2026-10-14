package ir.panjeh.petcare

import android.content.Context
import ir.panjeh.petcare.core.Fa
import ir.panjeh.petcare.data.AppDatabase
import ir.panjeh.petcare.data.Prefs
import ir.panjeh.petcare.data.Repository
import ir.panjeh.petcare.data.files.FileStore

/** نگهدارنده وابستگی‌های سراسری برنامه (Service Locator ساده). */
object Graph {
    lateinit var app: Context
        private set
    lateinit var db: AppDatabase
        private set
    lateinit var repo: Repository
        private set
    lateinit var prefs: Prefs
        private set
    lateinit var files: FileStore
        private set

    @Volatile
    private var initialized = false

    @Synchronized
    fun init(context: Context, dbName: String? = AppDatabase.DB_NAME) {
        if (initialized) return
        app = context.applicationContext
        db = AppDatabase(app, dbName)
        repo = Repository(db)
        prefs = Prefs(app)
        files = FileStore(app)
        Fa.dateStyle = prefs.dateStyle
        initialized = true
    }

    /** فقط برای تست‌ها */
    @Synchronized
    fun resetForTests() {
        if (initialized) runCatching { db.close() }
        initialized = false
    }
}
