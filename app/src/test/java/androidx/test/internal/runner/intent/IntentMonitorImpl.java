/* جایگزین حداقلی androidx.test فقط برای اجرای Robolectric در تست‌ها (مخزن گوگل در محیط ساخت در دسترس نبود). */
package androidx.test.internal.runner.intent;

import android.content.Intent;
import androidx.test.runner.intent.IntentMonitor;

public final class IntentMonitorImpl implements IntentMonitor {
    public IntentMonitorImpl() {}
    public void signalIntent(Intent intent) {}
}
