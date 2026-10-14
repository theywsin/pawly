package ir.panjeh.petcare.data.backup

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri
import ir.panjeh.petcare.data.AppDatabase
import ir.panjeh.petcare.data.Prefs
import ir.panjeh.petcare.data.Repository
import ir.panjeh.petcare.data.files.FileStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * تهیه و بازیابی نسخه پشتیبان کامل (پایگاه داده + تنظیمات + تصاویر و اسناد).
 *
 * قالب: یک فایل ZIP شامل data.json و پوشه media که به‌طور کامل با [BackupCrypto] رمزنگاری شده است.
 * محل ذخیره را خود کاربر از طریق Storage Access Framework انتخاب می‌کند؛ برنامه هیچ داده‌ای را
 * به اینترنت ارسال نمی‌کند.
 */
class BackupManager(
    private val context: Context,
    private val repo: Repository,
    private val prefs: Prefs,
    private val files: FileStore,
    private val appVersion: String,
) {
    class InvalidBackup : IOException("invalid backup content")
    class NewerBackup : IOException("backup created by a newer version")

    data class Summary(val pets: Int, val records: Int, val files: Int)

    fun export(target: Uri, password: CharArray): Summary {
        val tmp = File(context.cacheDir, "backup-${System.nanoTime()}.zip")
        try {
            val summary = writeZip(tmp)
            context.contentResolver.openOutputStream(target, "wt")?.use { out ->
                BufferedInputStream(FileInputStream(tmp)).use { ins -> BackupCrypto.encrypt(ins, BufferedOutputStream(out), password) }
            } ?: throw IOException("cannot open target")
            prefs.lastBackupAt = System.currentTimeMillis()
            return summary
        } finally {
            tmp.delete()
        }
    }

    /** نسخه آزمایشی برای تست: نوشتن مستقیم در فایل */
    fun exportToFile(target: File, password: CharArray): Summary {
        val tmp = File(context.cacheDir, "backup-${System.nanoTime()}.zip")
        try {
            val summary = writeZip(tmp)
            FileOutputStream(target).use { out ->
                BufferedInputStream(FileInputStream(tmp)).use { ins -> BackupCrypto.encrypt(ins, BufferedOutputStream(out), password) }
            }
            return summary
        } finally {
            tmp.delete()
        }
    }

    private fun writeZip(dest: File): Summary {
        val root = JSONObject()
        root.put("format", FORMAT)
        root.put("db_version", AppDatabase.VERSION)
        root.put("app_version", appVersion)
        root.put("created_at", System.currentTimeMillis())
        val tables = JSONObject()
        var records = 0
        for (t in AppDatabase.TABLES) {
            val arr = JSONArray()
            repo.db.rawQuery("SELECT * FROM $t", null).use { c ->
                while (c.moveToNext()) {
                    arr.put(rowToJson(c))
                    records++
                }
            }
            tables.put(t, arr)
        }
        root.put("tables", tables)
        root.put("prefs", JSONObject(prefs.exportMap()))

        val referenced = (repo.allDocumentPaths() + repo.allPhotoPaths()).toSet()
        var fileCount = 0
        ZipOutputStream(BufferedOutputStream(FileOutputStream(dest))).use { zip ->
            zip.putNextEntry(ZipEntry(DATA_ENTRY))
            zip.write(root.toString().toByteArray(Charsets.UTF_8))
            zip.closeEntry()
            for (rel in referenced) {
                val f = runCatching { files.resolve(rel) }.getOrNull() ?: continue
                if (!f.isFile) continue
                zip.putNextEntry(ZipEntry(rel))
                FileInputStream(f).use { it.copyTo(zip) }
                zip.closeEntry()
                fileCount++
            }
        }
        val pets = tables.getJSONArray("pets").length()
        return Summary(pets, records - pets, fileCount)
    }

    /**
     * بازیابی: پس از رمزگشایی و اعتبارسنجی کامل، همه داده‌های فعلی در یک تراکنش جایگزین می‌شوند.
     * اگر هر مرحله‌ای شکست بخورد، داده‌های فعلی دست‌نخورده باقی می‌مانند.
     */
    fun restore(source: Uri, password: CharArray): Summary {
        val input = context.contentResolver.openInputStream(source) ?: throw IOException("cannot open source")
        return input.use { restoreFrom(it, password) }
    }

    fun restoreFromFile(source: File, password: CharArray): Summary = FileInputStream(source).use { restoreFrom(it, password) }

    private fun restoreFrom(input: java.io.InputStream, password: CharArray): Summary {
        val tmpZip = File(context.cacheDir, "restore-${System.nanoTime()}.zip")
        val staging = File(context.filesDir, "media_restore").apply { deleteRecursively(); mkdirs() }
        try {
            BufferedOutputStream(FileOutputStream(tmpZip)).use { out -> BackupCrypto.decrypt(BufferedInputStream(input), out, password) }

            var data: JSONObject? = null
            var fileCount = 0
            ZipInputStream(BufferedInputStream(FileInputStream(tmpZip))).use { zip ->
                while (true) {
                    val e = zip.nextEntry ?: break
                    val name = e.name
                    if (e.isDirectory) continue
                    if (name == DATA_ENTRY) {
                        data = JSONObject(zip.readBytes().toString(Charsets.UTF_8))
                    } else if (name.startsWith("${FileStore.MEDIA_DIR}/") && !name.contains("..") && !name.startsWith("/")) {
                        val target = File(staging, name.removePrefix("${FileStore.MEDIA_DIR}/")).canonicalFile
                        if (!target.path.startsWith(staging.canonicalPath + File.separator)) throw InvalidBackup()
                        target.parentFile?.mkdirs()
                        FileOutputStream(target).use { zip.copyTo(it) }
                        fileCount++
                    }
                }
            }
            val root = data ?: throw InvalidBackup()
            if (root.optInt("format", -1) != FORMAT) throw InvalidBackup()
            if (root.optInt("db_version", 0) > AppDatabase.VERSION) throw NewerBackup()
            val tables = root.optJSONObject("tables") ?: throw InvalidBackup()

            var pets = 0
            var records = 0
            repo.transaction {
                AppDatabase.TABLES.asReversed().forEach { repo.db.delete(it, null, null) }
                for (t in AppDatabase.TABLES) {
                    val cols = columnsOf(t)
                    val arr = tables.optJSONArray(t) ?: continue
                    for (i in 0 until arr.length()) {
                        val row = arr.getJSONObject(i)
                        repo.db.insertOrThrow(t, null, jsonToValues(row, cols))
                        if (t == "pets") pets++ else records++
                    }
                }
            }
            // جایگزینی فایل‌ها پس از موفقیت تراکنش
            val media = File(context.filesDir, FileStore.MEDIA_DIR)
            media.deleteRecursively()
            if (!staging.renameTo(media)) {
                staging.copyRecursively(media, overwrite = true)
            }
            root.optJSONObject("prefs")?.let { p ->
                val map = HashMap<String, String>()
                p.keys().forEach { k -> map[k] = p.optString(k) }
                prefs.importMap(map)
            }
            prefs.activePetId = 0L
            prefs.onboardingDone = true
            return Summary(pets, records, fileCount)
        } finally {
            tmpZip.delete()
            staging.deleteRecursively()
        }
    }

    private fun columnsOf(table: String): Set<String> {
        val out = HashSet<String>()
        repo.db.rawQuery("PRAGMA table_info($table)", null).use { c -> while (c.moveToNext()) out += c.getString(1) }
        return out
    }

    private fun rowToJson(c: Cursor): JSONObject {
        val o = JSONObject()
        for (i in 0 until c.columnCount) {
            val name = c.getColumnName(i)
            when (c.getType(i)) {
                Cursor.FIELD_TYPE_NULL -> o.put(name, JSONObject.NULL)
                Cursor.FIELD_TYPE_INTEGER -> o.put(name, c.getLong(i))
                Cursor.FIELD_TYPE_FLOAT -> o.put(name, c.getDouble(i))
                Cursor.FIELD_TYPE_STRING -> o.put(name, c.getString(i))
                else -> {}
            }
        }
        return o
    }

    private fun jsonToValues(o: JSONObject, allowed: Set<String>): ContentValues {
        val v = ContentValues()
        o.keys().forEach { k ->
            if (k !in allowed) return@forEach
            when (val x = o.get(k)) {
                JSONObject.NULL -> v.putNull(k)
                is Int -> v.put(k, x.toLong())
                is Long -> v.put(k, x)
                is Double -> v.put(k, x)
                is Boolean -> v.put(k, if (x) 1 else 0)
                is String -> v.put(k, x)
                else -> v.put(k, x.toString())
            }
        }
        return v
    }

    companion object {
        const val FORMAT = 1
        const val DATA_ENTRY = "data.json"
        const val MIME = "application/octet-stream"
        const val EXTENSION = "panjeh"
    }
}
