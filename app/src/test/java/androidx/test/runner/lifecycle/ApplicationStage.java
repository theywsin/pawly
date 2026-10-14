/* جایگزین حداقلی androidx.test فقط برای اجرای Robolectric در تست‌ها (مخزن گوگل در محیط ساخت در دسترس نبود). */
package androidx.test.runner.lifecycle;

public enum ApplicationStage { PRE_ON_CREATE, CREATED }
