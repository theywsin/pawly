package ir.panjeh.petcare.ui.screens

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.widget.ImageView
import ir.panjeh.petcare.Graph
import ir.panjeh.petcare.R
import ir.panjeh.petcare.core.Async
import ir.panjeh.petcare.core.Fa
import ir.panjeh.petcare.data.DocCategory
import ir.panjeh.petcare.data.PetDocument
import ir.panjeh.petcare.data.files.FileStore
import ir.panjeh.petcare.data.files.PrivateFileProvider
import ir.panjeh.petcare.ui.components.ButtonKind
import ir.panjeh.petcare.ui.components.ChoiceField
import ir.panjeh.petcare.ui.components.Dialogs
import ir.panjeh.petcare.ui.components.InputKind
import ir.panjeh.petcare.ui.components.Scaffold
import ir.panjeh.petcare.ui.components.TextField
import ir.panjeh.petcare.ui.components.Tone
import ir.panjeh.petcare.ui.components.add
import ir.panjeh.petcare.ui.components.button
import ir.panjeh.petcare.ui.components.dp
import ir.panjeh.petcare.ui.components.emptyState
import ir.panjeh.petcare.ui.components.errorState
import ir.panjeh.petcare.ui.components.iconButton
import ir.panjeh.petcare.ui.components.loadingState
import ir.panjeh.petcare.ui.components.notice
import ir.panjeh.petcare.ui.components.text
import ir.panjeh.petcare.ui.nav.Host
import ir.panjeh.petcare.ui.nav.Route
import ir.panjeh.petcare.ui.nav.Screen
import ir.panjeh.petcare.ui.theme.TextStyle
import ir.panjeh.petcare.ui.theme.Theme

/** انتخاب و وارد کردن سند از گالری، دوربین یا فایل‌ها */
object DocumentPicker {
    fun start(host: Host, petId: Long, relatedType: String? = null, relatedId: Long? = null, category: DocCategory? = null) {
        val ctx = host.context
        fun onImported(imp: FileStore.Imported) {
            host.push(
                Route.of(
                    Screens.DOC_EDIT, "petId" to petId, "path" to imp.relativePath, "mime" to imp.mime, "size" to imp.size,
                    "name" to imp.displayName, "relatedType" to relatedType, "relatedId" to relatedId, "category" to category?.name,
                ),
            )
        }
        fun import(uri: Uri, temp: java.io.File?) {
            val progress = Dialogs.progress(ctx, "در حال ذخیره فایل…")
            Async.run({ Graph.files.importDocument(uri) }, onError = {
                progress.dismiss()
                temp?.delete()
                host.toast(
                    when (it) {
                        is FileStore.TooLargeException -> "حجم فایل بیش از ۲۵ مگابایت است"
                        is FileStore.UnsupportedException -> "این فایل قابل خواندن نیست"
                        else -> "فایل ذخیره نشد"
                    },
                    Tone.ERROR,
                )
            }) {
                progress.dismiss()
                temp?.delete()
                onImported(it)
            }
        }
        Dialogs.options(ctx, "افزودن سند", listOf(
            Dialogs.Option("انتخاب تصویر از گالری", R.drawable.ic_image) {
                val intent = if (Build.VERSION.SDK_INT >= 33) Intent(MediaStore.ACTION_PICK_IMAGES).setType("image/*")
                else Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE)
                if (!host.startForResult(intent) { code, data -> if (code == Activity.RESULT_OK) data?.data?.let { import(it, null) } }) {
                    host.toast("برنامه‌ای برای انتخاب تصویر پیدا نشد", Tone.ERROR)
                }
            },
            Dialogs.Option("عکس گرفتن از سند", R.drawable.ic_camera) {
                val file = Graph.files.newCameraFile()
                val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                    putExtra(MediaStore.EXTRA_OUTPUT, PrivateFileProvider.uriForCamera(ctx, file))
                    addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                val ok = host.startForResult(intent) { code, _ ->
                    if (code == Activity.RESULT_OK && file.length() > 0) import(Uri.fromFile(file), file) else file.delete()
                }
                if (!ok) {
                    file.delete()
                    host.toast("برنامه دوربین در دسترس نیست", Tone.ERROR)
                }
            },
            Dialogs.Option("انتخاب فایل (PDF و ...)", R.drawable.ic_file) {
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/pdf", "image/*", "text/plain"))
                }
                if (!host.startForResult(intent) { code, data -> if (code == Activity.RESULT_OK) data?.data?.let { import(it, null) } }) {
                    host.toast("برنامه مدیریت فایل پیدا نشد", Tone.ERROR)
                }
            },
        ))
    }
}

/** ثبت عنوان و نوع سند پس از انتخاب فایل؛ یا ویرایش سند موجود */
class DocumentEditScreen(host: Host, route: Route) : Screen(host, route) {
    private val docId = route.long("id")
    private var saved = false
    private var existing: PetDocument? = null
    private lateinit var title: TextField
    private lateinit var category: ChoiceField<DocCategory>
    private lateinit var note: TextField

    override fun build(): View {
        val sc = Scaffold(ctx, if (docId == 0L) "افزودن سند" else "ویرایش سند", { host.pop() })
        val defaultTitle = route.string("name")?.substringBeforeLast('.')?.take(60) ?: ""
        title = TextField(ctx, "عنوان سند", "مثلاً: گواهی واکسن هاری", required = true, maxLength = 80)
        category = ChoiceField(ctx, "نوع سند", DocCategory.entries.map { it to it.label },
            route.string("category")?.let { DocCategory.of(it) } ?: DocCategory.OTHER, required = true)
        note = TextField(ctx, "توضیحات", "", kind = InputKind.MULTILINE, maxLength = 500)
        if (docId == 0L) {
            title.value = defaultTitle
            sc.content.add(notice(ctx, R.drawable.ic_lock, "فایل در حافظه خصوصی برنامه ذخیره شده و برای برنامه‌های دیگر قابل دسترسی نیست.", Tone.INFO), bottom = 16)
        }
        sc.content.add(title.view)
        sc.content.add(category.view, top = 16)
        sc.content.add(note.view, top = 8)
        sc.bottomActions(button(ctx, "ذخیره سند", ButtonKind.PRIMARY) { save() })
        if (docId != 0L) {
            load({ Graph.repo.document(docId) }) { d ->
                if (d == null) { host.pop(); return@load }
                existing = d
                title.value = d.title
                category.select(d.category)
                note.value = d.note ?: ""
            }
        }
        return sc.root
    }

    private fun save() {
        if (!title.requireNotBlank("عنوان سند را وارد کنید")) return
        val d = existing?.copy(title = title.value, category = category.selected ?: DocCategory.OTHER, note = note.value)
            ?: PetDocument(
                petId = route.long("petId"),
                title = title.value,
                category = category.selected ?: DocCategory.OTHER,
                filePath = route.string("path") ?: return,
                mime = route.string("mime") ?: "application/octet-stream",
                sizeBytes = route.long("size"),
                note = note.value,
                relatedType = route.string("relatedType"),
                relatedId = route.longOrNull("relatedId"),
            )
        saved = true
        save({ Graph.repo.saveDocument(d) }, "سند ذخیره شد")
    }

    override fun onDestroy() {
        super.onDestroy()
        // اگر کاربر بدون ذخیره خارج شد، فایل واردشده حذف می‌شود
        if (docId == 0L && !saved) route.string("path")?.let { p -> Async.background { Graph.files.delete(p) } }
    }
}

/** نمایش سند: تصویر (با بزرگ‌نمایی)، PDF (صفحه‌به‌صفحه) یا باز کردن با برنامه دیگر */
class DocumentViewScreen(host: Host, route: Route) : Screen(host, route) {
    private val id = route.long("id")
    private lateinit var sc: Scaffold
    private var pdf: PdfRenderer? = null
    private var pfd: ParcelFileDescriptor? = null

    override fun build(): View {
        sc = Scaffold(ctx, "سند", { host.pop() }, listOf(
            iconButton(ctx, R.drawable.ic_edit, "ویرایش سند") { host.push(Route.of(Screens.DOC_EDIT, "id" to id)) },
            iconButton(ctx, R.drawable.ic_trash, "حذف سند", Theme.c.error) { confirmDelete() },
        ))
        sc.setBody(loadingState(ctx))
        return sc.root
    }

    override fun onShown() {
        load({ Graph.repo.document(id) }, onError = { sc.setBody(errorState(ctx, "سند خوانده نشد.", null)) }) { d ->
            if (d == null) { host.pop(); return@load }
            render(d)
        }
    }

    private fun render(d: PetDocument) {
        sc.content.removeAllViews()
        sc.content.add(text(ctx, d.title, TextStyle.Title))
        sc.content.add(text(ctx, "${d.category.label} · ${Fa.date(Fa.dateOfMillis(d.createdAt))}", TextStyle.BodySmall, Theme.c.textSecondary), top = 2)
        if (!d.note.isNullOrBlank()) sc.content.add(text(ctx, d.note, TextStyle.Body), top = 10)
        val file = runCatching { Graph.files.resolve(d.filePath) }.getOrNull()
        if (file == null || !file.exists()) {
            sc.content.add(notice(ctx, R.drawable.ic_alert, "فایل این سند پیدا نشد.", Tone.ERROR), top = 16)
            return
        }
        when {
            d.isImage -> {
                val img = ZoomImageView(ctx)
                sc.content.add(img, h = ctx.dp(460), top = 16)
                sc.content.add(text(ctx, "برای بزرگ‌نمایی با دو انگشت باز کنید.", TextStyle.Caption, Theme.c.textTertiary, center = true), top = 6)
                Async.run({ decodeScaled(file.path, 2048) }, alive = { alive }) { bmp -> if (bmp != null) img.setImageBitmap(bmp) }
            }
            d.isPdf -> renderPdf(file)
            else -> sc.content.add(notice(ctx, R.drawable.ic_info, "پیش‌نمایش این نوع فایل در برنامه ممکن نیست؛ می‌توانید آن را با برنامه دیگری باز کنید.", Tone.INFO), top = 16)
        }
        sc.content.add(button(ctx, "باز کردن با برنامه دیگر", ButtonKind.OUTLINE, R.drawable.ic_external) { openExternal(d) }, top = 16)
    }

    private fun renderPdf(file: java.io.File) {
        try {
            closePdf()
            val fd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
            pfd = fd
            val r = PdfRenderer(fd)
            pdf = r
            val count = minOf(r.pageCount, 20)
            sc.content.add(text(ctx, "${Fa.num(r.pageCount)} صفحه", TextStyle.Caption, Theme.c.textSecondary), top = 12)
            val width = ctx.resources.displayMetrics.widthPixels - ctx.dp(40)
            for (i in 0 until count) {
                val page = r.openPage(i)
                val h = (width.toFloat() * page.height / page.width).toInt()
                val bmp = Bitmap.createBitmap(width, h, Bitmap.Config.ARGB_8888)
                bmp.eraseColor(0xFFFFFFFF.toInt())
                page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                page.close()
                sc.content.add(ImageView(ctx).apply {
                    setImageBitmap(bmp)
                    adjustViewBounds = true
                    contentDescription = "صفحه ${Fa.num(i + 1)}"
                }, top = 10)
            }
            if (r.pageCount > count) sc.content.add(text(ctx, "برای دیدن بقیه صفحات، فایل را با برنامه دیگر باز کنید.", TextStyle.Caption, Theme.c.textSecondary), top = 8)
        } catch (e: Exception) {
            sc.content.add(notice(ctx, R.drawable.ic_alert, "این فایل PDF قابل نمایش نیست.", Tone.WARNING), top = 16)
        }
    }

    private fun openExternal(d: PetDocument) {
        val uri = PrivateFileProvider.uriForMedia(ctx, d.filePath)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, d.mime)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
            ctx.startActivity(Intent.createChooser(intent, "باز کردن با"))
        } catch (e: Exception) {
            host.toast("برنامه‌ای برای باز کردن این فایل پیدا نشد", Tone.ERROR)
        }
    }

    private fun confirmDelete() {
        Dialogs.confirm(ctx, "حذف سند", "این سند و فایل آن برای همیشه حذف می‌شود.", "حذف", destructive = true) {
            Async.run({
                val d = Graph.repo.document(id)
                Graph.repo.deleteDocument(id)
                d?.let { Graph.files.delete(it.filePath) }
            }, onError = { host.toast("حذف انجام نشد", Tone.ERROR) }) {
                host.toast("سند حذف شد")
                host.pop()
            }
        }
    }

    private fun closePdf() {
        runCatching { pdf?.close() }
        runCatching { pfd?.close() }
        pdf = null
        pfd = null
    }

    override fun onDestroy() {
        super.onDestroy()
        closePdf()
    }

    private fun decodeScaled(path: String, max: Int): Bitmap? {
        val b = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, b)
        var s = 1
        while (b.outWidth / (s * 2) >= max || b.outHeight / (s * 2) >= max) s *= 2
        return BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = s })
    }
}

/** نمایشگر تصویر با بزرگ‌نمایی دوانگشتی و جابه‌جایی */
class ZoomImageView(ctx: android.content.Context) : ImageView(ctx) {
    private val m = Matrix()
    private var scale = 1f
    private var lastX = 0f
    private var lastY = 0f
    private val detector = ScaleGestureDetector(ctx, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(d: ScaleGestureDetector): Boolean {
            val f = d.scaleFactor
            val next = (scale * f).coerceIn(1f, 5f)
            val applied = next / scale
            scale = next
            m.postScale(applied, applied, d.focusX, d.focusY)
            imageMatrix = m
            return true
        }
    })

    init {
        scaleType = ScaleType.FIT_CENTER
        setBackgroundColor(Theme.c.surfaceVariant)
        contentDescription = "تصویر سند"
    }

    override fun setImageBitmap(bm: Bitmap?) {
        super.setImageBitmap(bm)
        scaleType = ScaleType.FIT_CENTER
        scale = 1f
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (scaleType != ScaleType.MATRIX) {
            m.set(imageMatrix)
            scaleType = ScaleType.MATRIX
            imageMatrix = m
        }
        detector.onTouchEvent(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> { lastX = event.x; lastY = event.y; parent.requestDisallowInterceptTouchEvent(true) }
            MotionEvent.ACTION_MOVE -> if (!detector.isInProgress && scale > 1f) {
                m.postTranslate(event.x - lastX, event.y - lastY)
                imageMatrix = m
                lastX = event.x; lastY = event.y
            } else { lastX = event.x; lastY = event.y }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                parent.requestDisallowInterceptTouchEvent(false)
                if (scale <= 1.01f) { scaleType = ScaleType.FIT_CENTER; scale = 1f }
            }
        }
        return true
    }
}

/** صفحه‌ای کمکی: محتوای خالی برای فهرست اسناد */
fun documentsEmpty(host: Host, petId: Long): View = emptyState(
    host.context, R.drawable.ic_file, "سندی ذخیره نشده",
    "گواهی واکسن، نسخه دامپزشک یا نتیجه آزمایش را اینجا نگه دارید.", "افزودن سند",
) { DocumentPicker.start(host, petId) }
