package ir.panjeh.petcare.data

import ir.panjeh.petcare.data.backup.BackupCrypto
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import kotlin.random.Random

class BackupCryptoTest {
    private fun enc(data: ByteArray, pass: String): ByteArray {
        val out = ByteArrayOutputStream()
        BackupCrypto.encrypt(ByteArrayInputStream(data), out, pass.toCharArray(), iterations = 10_000)
        return out.toByteArray()
    }

    private fun dec(data: ByteArray, pass: String): ByteArray {
        val out = ByteArrayOutputStream()
        BackupCrypto.decrypt(ByteArrayInputStream(data), out, pass.toCharArray())
        return out.toByteArray()
    }

    @Test
    fun roundTripVariousSizes() {
        for (size in listOf(0, 1, 1000, 256 * 1024, 256 * 1024 + 1, 700_000)) {
            val data = Random(size).nextBytes(size)
            val e = enc(data, "رمز-امن-۱۲۳")
            assertFalse(size > 64 && e.toList().windowed(32).any { it == data.take(32) })
            assertArrayEquals(data, dec(e, "رمز-امن-۱۲۳"))
        }
    }

    @Test(expected = BackupCrypto.WrongPasswordOrCorrupt::class)
    fun wrongPassword() {
        dec(enc("salam".toByteArray(), "correct-pass"), "wrong-pass")
    }

    @Test(expected = BackupCrypto.WrongPasswordOrCorrupt::class)
    fun truncatedFileDetected() {
        val e = enc(Random(1).nextBytes(600_000), "pass1234")
        dec(e.copyOf(e.size - 300_000), "pass1234")
    }

    @Test(expected = BackupCrypto.WrongPasswordOrCorrupt::class)
    fun tamperedFileDetected() {
        val e = enc(Random(2).nextBytes(5000), "pass1234")
        e[e.size / 2] = (e[e.size / 2].toInt() xor 1).toByte()
        dec(e, "pass1234")
    }

    @Test(expected = BackupCrypto.NotABackup::class)
    fun notABackup() {
        dec("hello world, this is not a backup file at all....".toByteArray(), "x")
    }
}
