package ir.panjeh.petcare.data.backup

import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * رمزنگاری نسخه پشتیبان.
 *
 * تصمیم امنیتی: هر نسخه پشتیبان «همیشه» با رمزی که کاربر انتخاب می‌کند رمزنگاری می‌شود.
 *  - کلید: PBKDF2-HMAC-SHA256 با نمک تصادفی ۱۶ بایتی و ۱۲۰٬۰۰۰ تکرار → کلید ۲۵۶ بیتی
 *  - رمزنگاری: AES-256-GCM در قطعه‌های ۲۵۶ کیلوبایتی (برای مصرف حافظه کم)؛
 *    nonce هر قطعه = پیشوند تصادفی ۸ بایتی + شماره قطعه، و سربرگ فایل + شماره قطعه + پرچم «آخرین قطعه»
 *    به‌عنوان داده تأییدشده (AAD) استفاده می‌شوند تا جابه‌جایی، حذف یا کوتاه‌کردن قطعه‌ها شناسایی شود.
 * رمز در هیچ‌جا ذخیره نمی‌شود؛ بدون رمز امکان بازیابی وجود ندارد.
 */
object BackupCrypto {
    private val MAGIC = "PANJEHBK".toByteArray(Charsets.US_ASCII)
    private const val VERSION: Byte = 1
    const val ITERATIONS = 120_000
    private const val CHUNK = 256 * 1024
    private const val TAG_BITS = 128

    class WrongPasswordOrCorrupt : IOException("wrong password or corrupt file")
    class NotABackup : IOException("not a backup file")

    private fun deriveKey(password: CharArray, salt: ByteArray, iterations: Int): SecretKeySpec {
        val spec = PBEKeySpec(password, salt, iterations, 256)
        try {
            val bytes = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
            return SecretKeySpec(bytes, "AES")
        } finally {
            spec.clearPassword()
        }
    }

    fun encrypt(input: InputStream, output: OutputStream, password: CharArray, iterations: Int = ITERATIONS) {
        val rnd = SecureRandom()
        val salt = ByteArray(16).also(rnd::nextBytes)
        val prefix = ByteArray(8).also(rnd::nextBytes)
        val header = ByteBuffer.allocate(MAGIC.size + 1 + 4 + 16 + 8)
            .put(MAGIC).put(VERSION).putInt(iterations).put(salt).put(prefix).array()
        val key = deriveKey(password, salt, iterations)
        val out = DataOutputStream(output)
        out.write(header)

        val buf = ByteArray(CHUNK)
        var counter = 0
        var pending = readFully(input, buf)
        while (true) {
            val nextBuf = ByteArray(CHUNK)
            val nextLen = if (pending == CHUNK) readFully(input, nextBuf) else 0
            val last = nextLen <= 0
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, nonce(prefix, counter)))
            cipher.updateAAD(aad(header, counter, last))
            val ct = cipher.doFinal(buf, 0, maxOf(pending, 0))
            out.writeInt(ct.size)
            out.write(ct)
            if (last) break
            System.arraycopy(nextBuf, 0, buf, 0, nextLen)
            pending = nextLen
            counter++
        }
        out.flush()
    }

    fun decrypt(input: InputStream, output: OutputStream, password: CharArray) {
        val inp = DataInputStream(input)
        val header = ByteArray(MAGIC.size + 1 + 4 + 16 + 8)
        try {
            inp.readFully(header)
        } catch (e: EOFException) {
            throw NotABackup()
        }
        if (!header.copyOfRange(0, MAGIC.size).contentEquals(MAGIC)) throw NotABackup()
        val bb = ByteBuffer.wrap(header, MAGIC.size, header.size - MAGIC.size)
        if (bb.get() != VERSION) throw NotABackup()
        val iterations = bb.int
        if (iterations !in 10_000..10_000_000) throw NotABackup()
        val salt = ByteArray(16).also { bb.get(it) }
        val prefix = ByteArray(8).also { bb.get(it) }
        val key = deriveKey(password, salt, iterations)

        var counter = 0
        while (true) {
            val len = try {
                inp.readInt()
            } catch (e: EOFException) {
                throw WrongPasswordOrCorrupt() // پایان نابهنگام: فایل کوتاه شده است
            }
            if (len < 16 || len > CHUNK + 16) throw WrongPasswordOrCorrupt()
            val ct = ByteArray(len)
            try {
                inp.readFully(ct)
            } catch (e: EOFException) {
                throw WrongPasswordOrCorrupt()
            }
            // ابتدا با فرض «قطعه آخر نیست» و در صورت شکست با «قطعه آخر است» بررسی می‌شود
            val plain = tryDecrypt(key, prefix, header, counter, ct, false)
            if (plain != null) {
                output.write(plain)
                counter++
                continue
            }
            val lastPlain = tryDecrypt(key, prefix, header, counter, ct, true) ?: throw WrongPasswordOrCorrupt()
            output.write(lastPlain)
            if (inp.read() != -1) throw WrongPasswordOrCorrupt()
            break
        }
        output.flush()
    }

    private fun tryDecrypt(key: SecretKeySpec, prefix: ByteArray, header: ByteArray, counter: Int, ct: ByteArray, last: Boolean): ByteArray? =
        try {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, nonce(prefix, counter)))
            c.updateAAD(aad(header, counter, last))
            c.doFinal(ct)
        } catch (e: javax.crypto.AEADBadTagException) {
            null
        } catch (e: javax.crypto.BadPaddingException) {
            null
        }

    private fun nonce(prefix: ByteArray, counter: Int): ByteArray =
        ByteBuffer.allocate(12).put(prefix).putInt(counter).array()

    private fun aad(header: ByteArray, counter: Int, last: Boolean): ByteArray =
        ByteBuffer.allocate(header.size + 5).put(header).putInt(counter).put(if (last) 1.toByte() else 0.toByte()).array()

    private fun readFully(input: InputStream, buf: ByteArray): Int {
        var total = 0
        while (total < buf.size) {
            val n = input.read(buf, total, buf.size - total)
            if (n < 0) break
            total += n
        }
        return total
    }
}
