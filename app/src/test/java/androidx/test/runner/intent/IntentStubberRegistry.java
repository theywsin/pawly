/* جایگزین حداقلی androidx.test فقط برای اجرای Robolectric در تست‌ها (مخزن گوگل در محیط ساخت در دسترس نبود). */
package androidx.test.runner.intent;

public final class IntentStubberRegistry {
    private IntentStubberRegistry() {}
    public static boolean isLoaded() { return false; }
    public static IntentStubber getInstance() { throw new IllegalStateException("No intent stubber"); }
}
