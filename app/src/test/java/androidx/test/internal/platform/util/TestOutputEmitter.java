/* جایگزین حداقلی androidx.test فقط برای اجرای Robolectric در تست‌ها (مخزن گوگل در محیط ساخت در دسترس نبود). */
package androidx.test.internal.platform.util;

public final class TestOutputEmitter {
    private TestOutputEmitter() {}
    public static void dumpThreadStates(String outputFileName) {}
}
