/* جایگزین حداقلی androidx.test فقط برای اجرای Robolectric در تست‌ها (مخزن گوگل در محیط ساخت در دسترس نبود). */
package androidx.test.runner.lifecycle;

public final class ApplicationLifecycleMonitorRegistry {
    private static ApplicationLifecycleMonitor instance;
    private ApplicationLifecycleMonitorRegistry() {}
    public static synchronized ApplicationLifecycleMonitor getInstance() { return instance; }
    public static synchronized void registerInstance(ApplicationLifecycleMonitor m) { instance = m; }
}
