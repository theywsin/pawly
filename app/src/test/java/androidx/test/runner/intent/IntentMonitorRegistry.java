/* جایگزین حداقلی androidx.test فقط برای اجرای Robolectric در تست‌ها (مخزن گوگل در محیط ساخت در دسترس نبود). */
package androidx.test.runner.intent;

public final class IntentMonitorRegistry {
    private static IntentMonitor instance;
    private IntentMonitorRegistry() {}
    public static synchronized IntentMonitor getInstance() { return instance; }
    public static synchronized void registerInstance(IntentMonitor m) { instance = m; }
}
