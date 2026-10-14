/* جایگزین حداقلی androidx.test فقط برای اجرای Robolectric در تست‌ها (مخزن گوگل در محیط ساخت در دسترس نبود). */
package androidx.test.espresso;

public interface IdlingResource {
    String getName();
    boolean isIdleNow();
    void registerIdleTransitionCallback(ResourceCallback callback);

    interface ResourceCallback {
        void onTransitionToIdle();
    }
}
