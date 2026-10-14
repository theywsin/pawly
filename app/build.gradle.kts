/*
 * ساخت اپلیکیشن اندروید «پنجه» بدون Android Gradle Plugin.
 *
 * چرا؟ در محیط ساخت این پروژه دسترسی به مخزن Maven گوگل (AGP/AndroidX) وجود نداشت؛
 * بنابراین برنامه فقط بر APIهای خود فریم‌ورک اندروید تکیه دارد و زنجیره ساخت به‌صورت
 * صریح در همین فایل تعریف شده است:
 *
 *   android-all (Maven Central) ──► android.jar  (کلاس‌های API 35 + جدول منابع API 34)
 *   aapt        ──► R.java + بسته منابع (resources.ap_)
 *   kotlinc     ──► کلاس‌های JVM 1.8
 *   ProGuard    ──► کوچک‌سازی (فقط نسخه انتشار)
 *   dx          ──► classes.dex
 *   zipalign + apksigner ──► APK امضاشده
 *
 * ابزارهای خط فرمان لازم (در اوبونتو/دبیان):
 *   sudo apt-get install aapt dalvik-exchange zipalign apksigner
 * در صورت نیاز می‌توان مسیر هر ابزار را با ویژگی‌های gradle تغییر داد (tool.aapt و ...).
 */

import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

plugins {
    kotlin("jvm")
}

// ------------------------------------------------------------------ پیکربندی
val appId: String = providers.gradleProperty("app.id").get()
val appVersionCode: String = providers.gradleProperty("app.versionCode").get()
val appVersionName: String = providers.gradleProperty("app.versionName").get()
val minSdk: String = providers.gradleProperty("app.minSdk").get()
val targetSdk: String = providers.gradleProperty("app.targetSdk").get()

/** فضای نام ثابت کد (کلاس R). مستقل از شناسه بسته است تا تغییر شناسه، کد را نشکند. */
val codeNamespace = "ir.panjeh.petcare"

fun tool(name: String, default: String): String =
    providers.gradleProperty("tool.$name").getOrElse(default)

val aapt = tool("aapt", "aapt")
val dx = tool("dx", "dalvik-exchange")
val zipalign = tool("zipalign", "zipalign")
val apksigner = tool("apksigner", "apksigner")

val androidAll35 by configurations.creating { isTransitive = false }
val androidAll34 by configurations.creating { isTransitive = false }
val proguardTool by configurations.creating

val platformJar = layout.buildDirectory.file("android-platform/android.jar")

// ------------------------------------------------------------------ پلتفرم اندروید
val prepareAndroidPlatform by tasks.registering(Zip::class) {
    description = "ساخت android.jar از android-all (Maven Central)"
    group = "android"
    destinationDirectory.set(layout.buildDirectory.dir("android-platform"))
    archiveFileName.set("android.jar")
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    // کلاس‌های API 35
    from({ androidAll35.map { zipTree(it) } }) {
        include(
            "android/**", "java/**", "javax/**", "dalvik/**", "org/json/**", "org/xml/**",
            "org/w3c/**", "org/xmlpull/**", "org/apache/http/**", "com/android/internal/annotations/**",
        )
        exclude("**/*.uau", "**/*_compat_config.xml")
    }
    // جدول منابع API 34 (aapt نسخه ۱ قالب فشرده API 35 را نمی‌شناسد)
    from({ androidAll34.map { zipTree(it) } }) {
        include("resources.arsc", "AndroidManifest.xml")
    }
}

// ------------------------------------------------------------------ منابع
val manifestOut = layout.buildDirectory.file("intermediates/manifest/AndroidManifest.xml")
val processManifest by tasks.registering {
    group = "android"
    val src = file("src/main/AndroidManifest.xml")
    inputs.file(src)
    inputs.property("values", listOf(appId, appVersionCode, appVersionName, minSdk, targetSdk))
    outputs.file(manifestOut)
    doLast {
        val text = src.readText()
            .replace("\${applicationId}", appId)
            .replace("\${versionCode}", appVersionCode)
            .replace("\${versionName}", appVersionName)
            .replace("\${minSdk}", minSdk)
            .replace("\${targetSdk}", targetSdk)
        check(!text.contains("\${")) { "جای‌نگهدار حل‌نشده در مانیفست" }
        manifestOut.get().asFile.apply { parentFile.mkdirs(); writeText(text) }
    }
}

val genR = layout.buildDirectory.dir("generated/source/r")
val resourcesAp = layout.buildDirectory.file("intermediates/res/resources.ap_")

val aaptPackage by tasks.registering(Exec::class) {
    description = "کامپایل منابع با aapt و تولید R.java"
    group = "android"
    dependsOn(prepareAndroidPlatform, processManifest)
    inputs.dir("src/main/res")
    inputs.dir("src/main/assets")
    inputs.file(manifestOut)
    inputs.file(platformJar)
    outputs.dir(genR)
    outputs.file(resourcesAp)
    doFirst {
        genR.get().asFile.apply { deleteRecursively(); mkdirs() }
        resourcesAp.get().asFile.parentFile.mkdirs()
    }
    commandLine(
        aapt, "package", "-f", "--auto-add-overlay", "--no-version-vectors",
        "-m", "-J", genR.get().asFile.path,
        "--custom-package", codeNamespace,
        "-M", manifestOut.get().asFile.path,
        "-S", file("src/main/res").path,
        "-A", file("src/main/assets").path,
        "-I", platformJar.get().asFile.path,
        "--min-sdk-version", minSdk, "--target-sdk-version", targetSdk,
        "-F", resourcesAp.get().asFile.path,
    )
}

// ------------------------------------------------------------------ کاتلین
sourceSets {
    main {
        java.srcDir(genR)
    }
}

kotlin {
    jvmToolchain(21)
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_1_8)
        freeCompilerArgs.addAll(
            // فقط APIهای جاوا ۸ (زیرمجموعه موجود در اندروید ۸ به بعد) قابل استفاده‌اند
            "-Xjdk-release=1.8",
            "-Xno-param-assertions", "-Xno-call-assertions", "-Xno-receiver-assertions",
            "-Xlambdas=class", "-Xsam-conversions=class",
        )
    }
}

tasks.withType<JavaCompile>().configureEach {
    dependsOn(aaptPackage)
    options.release.set(8)
    options.encoding = "UTF-8"
}
tasks.named("compileKotlin") { dependsOn(aaptPackage) }

dependencies {
    androidAll35("org.robolectric:android-all:15-robolectric-13954326")
    androidAll34("org.robolectric:android-all:14-robolectric-10818077")
    proguardTool("com.guardsquare:proguard-base:7.7.0")

    compileOnly(files(platformJar).builtBy(prepareAndroidPlatform))

    testCompileOnly(files(platformJar).builtBy(prepareAndroidPlatform))
    // همانند AGP: کلاس‌های اندروید برای خواندن حاشیه‌نویسی‌ها بیرون از جعبه‌شن Robolectric لازم‌اند
    testRuntimeOnly(files(platformJar).builtBy(prepareAndroidPlatform))
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.16") {
        // androidx.test فقط در مخزن گوگل موجود است؛ جایگزین سبک آن در پوشه testshim قرار دارد
        exclude(group = "androidx.test")
        exclude(group = "androidx.test.espresso")
    }
}

// ------------------------------------------------------------------ تست (Robolectric)
val robolectricConfig = layout.buildDirectory.dir("generated/robolectric")
val writeRobolectricConfig by tasks.registering {
    dependsOn(aaptPackage)
    outputs.dir(robolectricConfig)
    doLast {
        val dir = robolectricConfig.get().asFile.resolve("com/android/tools").apply { mkdirs() }
        dir.resolve("test_config.properties").writeText(
            """
            android_resource_apk=${resourcesAp.get().asFile.path}
            android_merged_manifest=${manifestOut.get().asFile.path}
            android_merged_assets=${file("src/main/assets").path}
            android_custom_package=$codeNamespace
            """.trimIndent(),
        )
    }
}
sourceSets { test { resources.srcDir(robolectricConfig) } }
tasks.named("processTestResources") { dependsOn(writeRobolectricConfig) }

tasks.test {
    // اجرای Robolectric با زمان‌اجرای واقعی اندروید روی JVM
    systemProperty("robolectric.dependency.repo.url", "https://maven-central.storage-download.googleapis.com/maven2")
    systemProperty("robolectric.logging", "stdout")
    systemProperty("screenshots.dir", rootProject.layout.projectDirectory.dir("docs/screenshots").asFile.path)
    systemProperty("store.dir", rootProject.layout.projectDirectory.dir("docs/store").asFile.path)
    maxHeapSize = "3g"
    testLogging { events("passed", "failed", "skipped"); showStandardStreams = false; exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}

// ------------------------------------------------------------------ بسته‌بندی APK
val stdlibJars = configurations.runtimeClasspath

fun registerVariant(variant: String, shrink: Boolean) {
    val cap = variant.replaceFirstChar { it.uppercase() }
    val work = layout.buildDirectory.dir("intermediates/$variant")

    val proguard = if (shrink) tasks.register<JavaExec>("proguard$cap") {
        group = "android"
        dependsOn("classes")
        val out = work.map { it.file("shrunk.jar") }
        val mapping = layout.buildDirectory.file("outputs/mapping/$variant/mapping.txt")
        inputs.files(sourceSets.main.get().output.classesDirs, stdlibJars)
        inputs.file("proguard-rules.pro")
        outputs.file(out)
        outputs.file(mapping)
        classpath = proguardTool
        mainClass.set("proguard.ProGuard")
        doFirst {
            mapping.get().asFile.parentFile.mkdirs()
            val injars = (sourceSets.main.get().output.classesDirs.files + stdlibJars.get().files)
                .filter { it.exists() }
                .flatMap { listOf("-injars", "${it.path}(!META-INF/**)") }
            args(
                injars + listOf(
                    "-outjars", out.get().asFile.path,
                    "-libraryjars", platformJar.get().asFile.path,
                    "-printmapping", mapping.get().asFile.path,
                    "@" + file("proguard-rules.pro").path,
                ),
            )
        }
    } else null

    val dexTask = tasks.register<Exec>("dex$cap") {
        group = "android"
        val out = work.map { it.file("dex/classes.dex") }
        if (proguard != null) {
            dependsOn(proguard)
            inputs.file(work.map { it.file("shrunk.jar") })
        } else {
            dependsOn("classes")
            inputs.files(sourceSets.main.get().output.classesDirs, stdlibJars)
        }
        outputs.file(out)
        doFirst {
            out.get().asFile.parentFile.mkdirs()
            val inputsList = if (proguard != null) {
                listOf(work.get().file("shrunk.jar").asFile.path)
            } else {
                // کتابخانه‌های بدون module-info (dx نسخه‌های جدید class را نمی‌پذیرد)
                val cleanDir = work.get().dir("clean-libs").asFile.apply { deleteRecursively(); mkdirs() }
                val libs = stdlibJars.get().files.map { jar ->
                    val target = cleanDir.resolve(jar.name)
                    ant.withGroovyBuilder {
                        "zip"("destfile" to target.path) {
                            "zipfileset"("src" to jar.path, "excludes" to "META-INF/**")
                        }
                    }
                    target.path
                }
                sourceSets.main.get().output.classesDirs.files.filter { it.exists() }.map { it.path } + libs
            }
            commandLine(listOf(dx, "--dex", "--min-sdk-version=$minSdk", "--output=${out.get().asFile.path}") + inputsList)
        }
    }

    val unsigned = work.map { it.file("app-unsigned.apk") }
    val aligned = work.map { it.file("app-aligned.apk") }
    val addDex = tasks.register<Exec>("packageUnsigned$cap") {
        group = "android"
        dependsOn(aaptPackage, dexTask)
        inputs.file(resourcesAp)
        inputs.file(work.map { it.file("dex/classes.dex") })
        outputs.file(unsigned)
        workingDir(work.map { it.dir("dex") })
        doFirst { resourcesAp.get().asFile.copyTo(unsigned.get().asFile, overwrite = true) }
        commandLine(aapt, "add", unsigned.get().asFile.path, "classes.dex")
    }
    val align = tasks.register<Exec>("zipalign$cap") {
        group = "android"
        dependsOn(addDex)
        inputs.file(unsigned)
        outputs.file(aligned)
        commandLine(zipalign, "-f", "-p", "4", unsigned.get().asFile.path, aligned.get().asFile.path)
    }

    tasks.register<Exec>("assemble$cap") {
        group = "android"
        description = "ساخت APK امضاشده ($variant)"
        dependsOn(align)
        val outFile = layout.buildDirectory.file("outputs/apk/$variant/panjeh-$appVersionName-$variant.apk")
        inputs.file(aligned)
        outputs.file(outFile)
        doFirst {
            outFile.get().asFile.parentFile.mkdirs()
            val signing = signingConfig(variant)
            commandLine(
                apksigner, "sign",
                "--ks", signing.getProperty("storeFile"),
                "--ks-pass", "pass:" + signing.getProperty("storePassword"),
                "--ks-key-alias", signing.getProperty("keyAlias"),
                "--key-pass", "pass:" + signing.getProperty("keyPassword"),
                "--min-sdk-version", minSdk,
                "--v1-signing-enabled", "true",
                "--v2-signing-enabled", "true",
                "--v3-signing-enabled", "true",
                "--out", outFile.get().asFile.path,
                aligned.get().asFile.path,
            )
        }
        doLast {
            exec { commandLine(apksigner, "verify", "--min-sdk-version", minSdk, outFile.get().asFile.path) }
            logger.lifecycle("APK: ${outFile.get().asFile} (${outFile.get().asFile.length() / 1024} KB)")
        }
    }
}

/**
 * اطلاعات امضا:
 *  - release: از فایل keystore.properties در ریشه پروژه (خارج از گیت) خوانده می‌شود.
 *  - debug: کلید اشکال‌زدایی محلی در ~/.android/panjeh-debug.jks به‌صورت خودکار ساخته می‌شود.
 */
fun signingConfig(variant: String): Properties {
    val props = Properties()
    if (variant == "release") {
        val f = rootProject.file("keystore.properties")
        check(f.exists()) {
            "برای ساخت نسخه انتشار فایل keystore.properties لازم است (راهنما: docs/BUILD.md)"
        }
        f.inputStream().use { props.load(it) }
        val store = rootProject.file(props.getProperty("storeFile"))
        props.setProperty("storeFile", store.path)
    } else {
        val store = File(System.getProperty("user.home"), ".android/panjeh-debug.jks")
        if (!store.exists()) {
            store.parentFile.mkdirs()
            exec {
                commandLine(
                    "keytool", "-genkeypair", "-keystore", store.path, "-storepass", "android",
                    "-keypass", "android", "-alias", "debug", "-keyalg", "RSA", "-keysize", "2048",
                    "-validity", "10000", "-dname", "CN=Panjeh Debug,O=Debug,C=IR",
                )
            }
        }
        props.setProperty("storeFile", store.path)
        props.setProperty("storePassword", "android")
        props.setProperty("keyAlias", "debug")
        props.setProperty("keyPassword", "android")
    }
    return props
}

registerVariant("debug", shrink = false)
registerVariant("release", shrink = true)
