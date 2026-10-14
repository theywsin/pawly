package ir.panjeh.petcare.data.files

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File
import java.io.FileNotFoundException

/**
 * ارائه‌دهنده محتوای غیرعمومی (exported=false) برای:
 *  - ارسال مسیر خروجی به برنامه دوربین سیستم (فقط فایل‌های پوشه camera در cache)
 *  - باز کردن یک سند در برنامه دیگر با مجوز خواندن موقت
 * دسترسی فقط با مجوز URI موقتی که خود برنامه صادر می‌کند امکان‌پذیر است.
 */
class PrivateFileProvider : ContentProvider() {

    override fun onCreate(): Boolean = true

    private fun fileFor(uri: Uri): File {
        val ctx = context ?: throw FileNotFoundException()
        val segments = uri.pathSegments
        if (segments.size < 2) throw FileNotFoundException()
        val root = when (segments[0]) {
            ROOT_MEDIA -> File(ctx.filesDir, FileStore.MEDIA_DIR)
            ROOT_CAMERA -> File(ctx.cacheDir, FileStore.CAMERA_DIR)
            else -> throw FileNotFoundException()
        }.canonicalFile
        val file = File(root, segments.drop(1).joinToString("/")).canonicalFile
        if (!file.path.startsWith(root.path + File.separator)) throw SecurityException("path traversal")
        return file
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        val file = fileFor(uri)
        val isCamera = uri.pathSegments.firstOrNull() == ROOT_CAMERA
        val pfdMode = if (isCamera && mode.contains('w')) {
            ParcelFileDescriptor.MODE_READ_WRITE or ParcelFileDescriptor.MODE_CREATE or ParcelFileDescriptor.MODE_TRUNCATE
        } else {
            if (mode != "r") throw SecurityException("read-only")
            ParcelFileDescriptor.MODE_READ_ONLY
        }
        return ParcelFileDescriptor.open(file, pfdMode)
    }

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor {
        val file = fileFor(uri)
        val cols = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        val row: List<Any?> = cols.map { c ->
            when (c) {
                OpenableColumns.DISPLAY_NAME -> file.name
                OpenableColumns.SIZE -> file.length()
                else -> null
            }
        }
        return MatrixCursor(cols).apply { addRow(row.toTypedArray()) }
    }

    override fun getType(uri: Uri): String = FileStore.guessMime(uri.lastPathSegment ?: "")

    override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException()
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = throw UnsupportedOperationException()
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int =
        throw UnsupportedOperationException()

    companion object {
        private const val ROOT_MEDIA = "media"
        private const val ROOT_CAMERA = "camera"

        fun authority(context: Context) = "${context.packageName}.files"

        /** [relative] مسیری مانند media/docs/x.pdf */
        fun uriForMedia(context: Context, relative: String): Uri =
            Uri.Builder().scheme("content").authority(authority(context))
                .appendPath(ROOT_MEDIA).apply { relative.removePrefix("${FileStore.MEDIA_DIR}/").split('/').forEach { appendPath(it) } }
                .build()

        fun uriForCamera(context: Context, file: File): Uri =
            Uri.Builder().scheme("content").authority(authority(context)).appendPath(ROOT_CAMERA).appendPath(file.name).build()
    }
}
