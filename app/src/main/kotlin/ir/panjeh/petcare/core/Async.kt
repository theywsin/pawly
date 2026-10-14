package ir.panjeh.petcare.core

import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * اجرای کارهای ورودی/خروجی (پایگاه داده، فایل) خارج از رشته اصلی و برگرداندن نتیجه به رشته اصلی.
 * برای جلوگیری از نشت، نتیجه فقط وقتی تحویل داده می‌شود که [alive] هنوز true باشد.
 */
object Async {
    private val io: ExecutorService = Executors.newFixedThreadPool(2) { r ->
        Thread(r, "panjeh-io").apply { isDaemon = true }
    }
    val main = Handler(Looper.getMainLooper())

    /** در تست‌ها می‌توان اجرای هم‌زمان را فعال کرد. */
    @Volatile
    var synchronous = false

    fun <T> run(
        work: () -> T,
        alive: () -> Boolean = { true },
        onError: (Throwable) -> Unit = {},
        onResult: (T) -> Unit,
    ) {
        if (synchronous) {
            val r = runCatching(work)
            r.onSuccess { if (alive()) onResult(it) }.onFailure { logError(it); if (alive()) onError(it) }
            return
        }
        io.execute {
            val r = runCatching(work)
            main.post {
                if (!alive()) return@post
                r.onSuccess(onResult).onFailure { logError(it); onError(it) }
            }
        }
    }

    fun background(work: () -> Unit) {
        if (synchronous) {
            runCatching(work).onFailure(::logError)
        } else {
            io.execute { runCatching(work).onFailure(::logError) }
        }
    }

    private fun logError(t: Throwable) {
        // فقط نوع خطا ثبت می‌شود؛ هیچ داده کاربر در گزارش‌ها نوشته نمی‌شود.
        Log.w("Panjeh", "background task failed: ${t.javaClass.simpleName}")
    }
}
