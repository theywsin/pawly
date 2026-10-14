package ir.panjeh.petcare.data.files

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.provider.OpenableColumns
import android.util.LruCache
import android.webkit.MimeTypeMap
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID

/**
 * نگهداری فایل‌ها (تصویر حیوان و اسناد) در حافظه خصوصی و دائمی برنامه:
 *   filesDir/media/photos  و  filesDir/media/docs
 * این مسیرها موقت نیستند، توسط سیستم پاک نمی‌شوند و برای برنامه‌های دیگر قابل دسترسی نیستند.
 * اشتراک‌گذاری فقط با مجوز موقت و از طریق [PrivateFileProvider] انجام می‌شود.
 */
class FileStore(private val context: Context) {

    class TooLargeException : IOException("file too large")
    class UnsupportedException : IOException("unsupported file")

    val mediaRoot: File get() = File(context.filesDir, MEDIA_DIR).apply { mkdirs() }

    fun resolve(relative: String): File {
        val f = File(context.filesDir, relative).canonicalFile
        require(f.path.startsWith(mediaRoot.canonicalPath)) { "invalid path" }
        return f
    }

    data class Imported(val relativePath: String, val mime: String, val size: Long, val displayName: String?)

    /** وارد کردن تصویر حیوان؛ تصویر با جهت صحیح و حداکثر ۱۶۰۰ پیکسل ذخیره می‌شود. */
    fun importPetPhoto(uri: Uri): Imported = importImage(uri, "photos", 1600)

    /** وارد کردن سند؛ تصاویر بهینه می‌شوند و سایر فایل‌ها (PDF و ...) عیناً کپی می‌شوند. */
    fun importDocument(uri: Uri): Imported {
        val mime = context.contentResolver.getType(uri) ?: guessMime(uri.lastPathSegment ?: "")
        return if (mime.startsWith("image/") && mime != "image/gif") importImage(uri, "docs", 2400)
        else copyRaw(uri, "docs", mime)
    }

    private fun importImage(uri: Uri, dir: String, maxSide: Int): Imported {
        val resolver = context.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) } ?: throw IOException("cannot open")
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw UnsupportedException()
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= maxSide || bounds.outHeight / (sample * 2) >= maxSide) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        var bmp = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) } ?: throw UnsupportedException()
        val rotation = runCatching {
            resolver.openInputStream(uri)?.use {
                when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                    ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                    ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                    ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                    else -> 0f
                }
            } ?: 0f
        }.getOrDefault(0f)
        val scale = minOf(1f, maxSide.toFloat() / maxOf(bmp.width, bmp.height))
        if (rotation != 0f || scale < 1f) {
            val m = Matrix().apply { postScale(scale, scale); postRotate(rotation) }
            val out = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
            if (out !== bmp) bmp.recycle()
            bmp = out
        }
        val rel = "$MEDIA_DIR/$dir/${UUID.randomUUID()}.jpg"
        val file = File(context.filesDir, rel).apply { parentFile?.mkdirs() }
        FileOutputStream(file).use { bmp.compress(Bitmap.CompressFormat.JPEG, 88, it) }
        bmp.recycle()
        return Imported(rel, "image/jpeg", file.length(), displayName(uri))
    }

    private fun copyRaw(uri: Uri, dir: String, mime: String): Imported {
        val name = displayName(uri)
        val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)
            ?: name?.substringAfterLast('.', "")?.takeIf { it.length in 1..5 && it.all(Char::isLetterOrDigit) }
            ?: "bin"
        val rel = "$MEDIA_DIR/$dir/${UUID.randomUUID()}.$ext"
        val file = File(context.filesDir, rel).apply { parentFile?.mkdirs() }
        try {
            val input = context.contentResolver.openInputStream(uri) ?: throw IOException("cannot open")
            input.use { ins ->
                FileOutputStream(file).use { out ->
                    val buf = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        val n = ins.read(buf)
                        if (n < 0) break
                        total += n
                        if (total > MAX_DOC_BYTES) throw TooLargeException()
                        out.write(buf, 0, n)
                    }
                }
            }
        } catch (e: IOException) {
            file.delete()
            throw e
        }
        return Imported(rel, mime, file.length(), name)
    }

    fun displayName(uri: Uri): String? = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    }.getOrNull()

    fun delete(relative: String?) {
        if (relative.isNullOrBlank()) return
        runCatching { resolve(relative).delete() }
        thumbs.evictAll()
    }

    /** حذف فایل‌هایی که دیگر در پایگاه داده ارجاعی ندارند. */
    fun cleanupOrphans(referenced: Set<String>) {
        mediaRoot.walkTopDown().filter { it.isFile }.forEach { f ->
            val rel = f.relativeTo(context.filesDir).path
            if (rel !in referenced) f.delete()
        }
    }

    fun totalSizeBytes(): Long = mediaRoot.walkTopDown().filter { it.isFile }.sumOf { it.length() }

    fun wipe() {
        mediaRoot.deleteRecursively()
        File(context.cacheDir, CAMERA_DIR).deleteRecursively()
        thumbs.evictAll()
    }

    /** فایل موقت برای عکس دوربین (در cache؛ بلافاصله پس از عکاسی به حافظه دائمی منتقل می‌شود). */
    fun newCameraFile(): File = File(context.cacheDir, "$CAMERA_DIR/${UUID.randomUUID()}.jpg").apply { parentFile?.mkdirs() }

    // ---------------------------------------------------------------- تصاویر کوچک
    private val thumbs = object : LruCache<String, Bitmap>((Runtime.getRuntime().maxMemory() / 16).toInt()) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }

    fun cachedThumb(relative: String, size: Int): Bitmap? = thumbs.get("$relative@$size")

    /** رمزگشایی تصویر کوچک با حافظه کم (باید خارج از رشته اصلی فراخوانی شود). */
    fun loadThumb(relative: String, size: Int): Bitmap? {
        val key = "$relative@$size"
        thumbs.get(key)?.let { return it }
        val file = runCatching { resolve(relative) }.getOrNull() ?: return null
        if (!file.exists()) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= size && bounds.outHeight / (sample * 2) >= size) sample *= 2
        val bmp = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        thumbs.put(key, bmp)
        return bmp
    }

    companion object {
        const val MEDIA_DIR = "media"
        const val CAMERA_DIR = "camera"
        const val MAX_DOC_BYTES = 25L * 1024 * 1024

        fun guessMime(name: String): String {
            val ext = name.substringAfterLast('.', "").lowercase()
            return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: when (ext) {
                "pdf" -> "application/pdf"
                "jpg", "jpeg" -> "image/jpeg"
                "png" -> "image/png"
                else -> "application/octet-stream"
            }
        }
    }
}
