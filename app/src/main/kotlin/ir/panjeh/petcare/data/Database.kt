package ir.panjeh.petcare.data

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * پایگاه داده محلی SQLite (فریم‌ورک اندروید).
 * فایل پایگاه داده در حافظه خصوصی برنامه قرار دارد و برای سایر برنامه‌ها قابل دسترسی نیست.
 * مستندات کامل جداول: docs/DATABASE.md
 */
class AppDatabase(context: Context, name: String? = DB_NAME) :
    SQLiteOpenHelper(context, name, null, VERSION) {

    override fun onConfigure(db: SQLiteDatabase) {
        db.setForeignKeyConstraintsEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) {
        SCHEMA.forEach(db::execSQL)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // نسخه ۱ نخستین نسخه است؛ مهاجرت‌های آینده در اینجا به‌صورت گام‌به‌گام اضافه می‌شوند.
    }

    companion object {
        const val DB_NAME = "panjeh.db"
        const val VERSION = 1

        /** ترتیب جداول برای پشتیبان‌گیری/بازیابی (والد قبل از فرزند). */
        val TABLES = listOf(
            "pets", "weights", "vaccines", "medications", "dose_logs", "vet_visits",
            "reminders", "reminder_logs", "health_records", "care_logs", "documents",
        )

        val SCHEMA = listOf(
            """
            CREATE TABLE pets (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL CHECK(length(trim(name)) > 0),
              species TEXT NOT NULL,
              species_other TEXT,
              breed TEXT,
              sex TEXT NOT NULL DEFAULT 'UNKNOWN',
              birth_date INTEGER,
              color TEXT,
              neutered INTEGER,
              allergies TEXT,
              conditions TEXT,
              photo TEXT,
              notes TEXT,
              microchip TEXT,
              food_type TEXT,
              meals_per_day INTEGER,
              feeding_notes TEXT,
              vet_name TEXT,
              vet_clinic TEXT,
              vet_phone TEXT,
              created_at INTEGER NOT NULL
            )
            """,
            """
            CREATE TABLE weights (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
              grams REAL NOT NULL CHECK(grams > 0),
              measured_at INTEGER NOT NULL,
              note TEXT
            )
            """,
            "CREATE INDEX idx_weights_pet ON weights(pet_id, measured_at)",
            """
            CREATE TABLE vaccines (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              status TEXT NOT NULL,
              scheduled_on INTEGER,
              given_on INTEGER,
              clinic TEXT,
              vet TEXT,
              note TEXT,
              remind_days_before INTEGER,
              created_at INTEGER NOT NULL
            )
            """,
            "CREATE INDEX idx_vaccines_pet ON vaccines(pet_id)",
            """
            CREATE TABLE medications (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              dosage TEXT NOT NULL,
              times TEXT NOT NULL,
              every_n_days INTEGER NOT NULL DEFAULT 1 CHECK(every_n_days >= 1),
              start_on INTEGER NOT NULL,
              end_on INTEGER,
              prescriber TEXT,
              note TEXT,
              status TEXT NOT NULL,
              reminders_enabled INTEGER NOT NULL DEFAULT 1,
              created_at INTEGER NOT NULL
            )
            """,
            "CREATE INDEX idx_meds_pet ON medications(pet_id)",
            """
            CREATE TABLE dose_logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
              pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
              scheduled_at INTEGER NOT NULL,
              status TEXT NOT NULL,
              logged_at INTEGER NOT NULL,
              UNIQUE(medication_id, scheduled_at) ON CONFLICT REPLACE
            )
            """,
            """
            CREATE TABLE vet_visits (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
              status TEXT NOT NULL,
              visit_at INTEGER NOT NULL,
              clinic TEXT,
              vet TEXT,
              reason TEXT,
              symptoms TEXT,
              diagnosis TEXT,
              prescriptions TEXT,
              cost_toman INTEGER,
              note TEXT,
              remind_minutes_before INTEGER,
              created_at INTEGER NOT NULL
            )
            """,
            "CREATE INDEX idx_visits_pet ON vet_visits(pet_id, visit_at)",
            """
            CREATE TABLE reminders (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              pet_id INTEGER REFERENCES pets(id) ON DELETE CASCADE,
              type TEXT NOT NULL,
              title TEXT NOT NULL,
              note TEXT,
              start_at INTEGER NOT NULL,
              repeat TEXT NOT NULL,
              interval INTEGER NOT NULL DEFAULT 1 CHECK(interval >= 1),
              end_on INTEGER,
              enabled INTEGER NOT NULL DEFAULT 1,
              created_at INTEGER NOT NULL
            )
            """,
            """
            CREATE TABLE reminder_logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              reminder_id INTEGER NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
              occurrence_at INTEGER NOT NULL,
              status TEXT NOT NULL,
              logged_at INTEGER NOT NULL,
              UNIQUE(reminder_id, occurrence_at) ON CONFLICT REPLACE
            )
            """,
            """
            CREATE TABLE health_records (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
              kind TEXT NOT NULL,
              title TEXT NOT NULL,
              date INTEGER NOT NULL,
              note TEXT,
              created_at INTEGER NOT NULL
            )
            """,
            """
            CREATE TABLE care_logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
              kind TEXT NOT NULL,
              title TEXT NOT NULL,
              amount TEXT,
              duration_minutes INTEGER,
              logged_at INTEGER NOT NULL,
              note TEXT
            )
            """,
            "CREATE INDEX idx_care_pet ON care_logs(pet_id, logged_at)",
            """
            CREATE TABLE documents (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              pet_id INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
              title TEXT NOT NULL,
              category TEXT NOT NULL,
              file_path TEXT NOT NULL,
              mime TEXT NOT NULL,
              size_bytes INTEGER NOT NULL,
              note TEXT,
              related_type TEXT,
              related_id INTEGER,
              created_at INTEGER NOT NULL
            )
            """,
        ).map { it.trimIndent() }
    }
}
