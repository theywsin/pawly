/* جایگزین حداقلی androidx.test فقط برای اجرای Robolectric در تست‌ها (مخزن گوگل در محیط ساخت در دسترس نبود). */
package androidx.test.runner.lifecycle;

public final class ActivityLifecycleMonitorRegistry {
    private static ActivityLifecycleMonitor instance;
    private ActivityLifecycleMonitorRegistry() {}
    public static synchronized ActivityLifecycleMonitor getInstance() {
        if (instance == null) throw new IllegalStateException("No lifecycle monitor registered");
        return instance;
    }
    public static synchronized void registerInstance(ActivityLifecycleMonitor m) { instance = m; }
}
