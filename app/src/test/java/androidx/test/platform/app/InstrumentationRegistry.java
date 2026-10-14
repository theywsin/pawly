/* جایگزین حداقلی androidx.test فقط برای اجرای Robolectric در تست‌ها (مخزن گوگل در محیط ساخت در دسترس نبود). */
package androidx.test.platform.app;

import android.app.Instrumentation;
import android.os.Bundle;

public final class InstrumentationRegistry {
    private static Instrumentation instrumentation;
    private static Bundle arguments = new Bundle();

    private InstrumentationRegistry() {}

    public static synchronized void registerInstance(Instrumentation i, Bundle args) {
        instrumentation = i;
        arguments = args == null ? new Bundle() : new Bundle(args);
    }

    public static synchronized Instrumentation getInstrumentation() {
        if (instrumentation == null) throw new IllegalStateException("No instrumentation registered");
        return instrumentation;
    }

    public static synchronized Bundle getArguments() {
        return new Bundle(arguments);
    }
}
