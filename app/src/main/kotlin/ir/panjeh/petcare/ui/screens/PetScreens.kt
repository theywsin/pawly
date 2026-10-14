package ir.panjeh.petcare.ui.screens

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import ir.panjeh.petcare.Graph
import ir.panjeh.petcare.R
import ir.panjeh.petcare.core.Async
import ir.panjeh.petcare.core.Fa
import ir.panjeh.petcare.data.Pet
import ir.panjeh.petcare.data.Sex
import ir.panjeh.petcare.data.Species
import ir.panjeh.petcare.data.WeightEntry
import ir.panjeh.petcare.data.files.FileStore
import ir.panjeh.petcare.data.files.PrivateFileProvider
import ir.panjeh.petcare.ui.components.ButtonKind
import ir.panjeh.petcare.ui.components.ChoiceField
import ir.panjeh.petcare.ui.components.DateField
import ir.panjeh.petcare.ui.components.Dialogs
import ir.panjeh.petcare.ui.components.InputKind
import ir.panjeh.petcare.ui.components.PetAvatar
import ir.panjeh.petcare.ui.components.Scaffold
import ir.panjeh.petcare.ui.components.TextField
import ir.panjeh.petcare.ui.components.Tone
import ir.panjeh.petcare.ui.components.WRAP
import ir.panjeh.petcare.ui.components.add
import ir.panjeh.petcare.ui.components.badge
import ir.panjeh.petcare.ui.components.button
import ir.panjeh.petcare.ui.components.card
import ir.panjeh.petcare.ui.components.clickable
import ir.panjeh.petcare.ui.components.dp
import ir.panjeh.petcare.ui.components.emptyState
import ir.panjeh.petcare.ui.components.errorState
import ir.panjeh.petcare.ui.components.horizontal
import ir.panjeh.petcare.ui.components.iconView
import ir.panjeh.petcare.ui.components.loadingState
import ir.panjeh.petcare.ui.components.oval
import ir.panjeh.petcare.ui.components.rounded
import ir.panjeh.petcare.ui.components.text
import ir.panjeh.petcare.ui.components.vertical
import ir.panjeh.petcare.ui.nav.Host
import ir.panjeh.petcare.ui.nav.Route
import ir.panjeh.petcare.ui.nav.Screen
import ir.panjeh.petcare.ui.nav.Tab
import ir.panjeh.petcare.ui.theme.TextStyle
import ir.panjeh.petcare.ui.theme.Theme
import java.time.LocalDate
import java.time.LocalTime

/** فهرست «حیوانات من» */
class PetsScreen(host: Host, route: Route) : Screen(host, route) {
    override val tab = Tab.PETS
    private lateinit var sc: Scaffold

    override fun build(): View {
        sc = Scaffold(ctx, "حیوانات من", null)
        sc.fab("افزودن حیوان") { host.push(Route.of(Screens.PET_EDIT)) }
        sc.setBody(loadingState(ctx))
        return sc.root
    }

    override fun onShown() {
        load({
            val repo = Graph.repo
            repo.pets().map { it to repo.latestWeight(it.id) }
        }, onError = { sc.setBody(errorState(ctx, "فهرست حیوانات خوانده نشد.") { onShown() }) }) { list ->
            if (list.isEmpty()) {
                sc.setBody(
                    emptyState(
                        ctx, R.drawable.ill_cat, "هنوز حیوانی ثبت نشده",
                        "برای هر حیوان خانگی یک پروفایل جداگانه بسازید؛ اطلاعات هر حیوان از بقیه جداست.",
                        "افزودن حیوان", illustration = true,
                    ) { host.push(Route.of(Screens.PET_EDIT)) },
                )
                return@load
            }
            sc.content.removeAllViews()
            sc.content.add(text(ctx, "${Fa.num(list.size)} حیوان خانگی", TextStyle.BodySmall, Theme.c.textSecondary), bottom = 12)
            list.forEach { (p, w) -> sc.content.add(petCard(p, w), bottom = 12) }
        }
    }

    private fun petCard(p: Pet, w: WeightEntry?): View = card(ctx, paddingDp = 12).apply {
        val row = horizontal(ctx)
        val av = PetAvatar(ctx, 76, 20)
        av.bind(p)
        row.add(av, w = ctx.dp(76), h = ctx.dp(76), end = 14)
        val col = vertical(ctx)
        val titleRow = horizontal(ctx)
        titleRow.add(text(ctx, p.name, TextStyle.Title, maxLines = 1), w = 0, weight = 1f)
        if (p.id == Graph.prefs.activePetId) titleRow.add(badge(ctx, "فعال در داشبورد", Tone.PRIMARY), w = WRAP)
        col.add(titleRow)
        col.add(text(ctx, listOfNotNull(p.speciesLabel, p.breed, p.sex.takeIf { it != Sex.UNKNOWN }?.label).joinToString(" · "), TextStyle.BodySmall, Theme.c.textSecondary, maxLines = 1), top = 2)
        val meta = listOfNotNull(p.birthDate?.let { Fa.age(it) }, w?.let { Fa.weight(it.grams) }).joinToString(" · ")
        if (meta.isNotBlank()) col.add(text(ctx, meta, TextStyle.BodySmall, Theme.c.textSecondary, maxLines = 1), top = 2)
        row.add(col, w = 0, weight = 1f)
        row.add(iconView(ctx, R.drawable.ic_chevron, Theme.c.textTertiary, 20), w = ctx.dp(20), h = ctx.dp(20))
        add(row)
        contentDescription = "پروفایل ${p.name}"
        clickable(20) { host.push(Route.of(Screens.PET_PROFILE, "id" to p.id)) }
    }
}

/**
 * افزودن/ویرایش حیوان در سه مرحله کوتاه. فقط «نام» و «نوع» ضروری است؛
 * کاربر می‌تواند از همان مرحله اول ذخیره کند.
 */
class PetEditScreen(host: Host, route: Route) : Screen(host, route) {
    private val editId = route.long("id")
    private val first = route.args.getBoolean("first", false)
    private var original: Pet? = null
    private var step = 0
    private var photo: String? = null
    private val newPhotos = ArrayList<String>()

    private lateinit var sc: Scaffold
    private lateinit var stepHost: LinearLayout
    private lateinit var stepper: LinearLayout
    private lateinit var nextBtn: android.widget.TextView
    private lateinit var backBtn: android.widget.TextView
    private lateinit var avatar: PetAvatar

    private lateinit var name: TextField
    private lateinit var species: ChoiceField<Species>
    private lateinit var speciesOther: TextField
    private lateinit var breed: TextField
    private lateinit var sex: ChoiceField<Sex>
    private lateinit var birth: DateField
    private lateinit var weight: TextField
    private lateinit var weightUnit: ChoiceField<String>
    private lateinit var color: TextField
    private lateinit var neutered: ChoiceField<String>
    private lateinit var microchip: TextField
    private lateinit var allergies: TextField
    private lateinit var conditions: TextField
    private lateinit var notes: TextField
    private lateinit var vetName: TextField
    private lateinit var vetClinic: TextField
    private lateinit var vetPhone: TextField

    private val steps = listOf("اطلاعات پایه", "جزئیات", "سلامت و دامپزشک")

    override fun build(): View {
        val title = if (editId != 0L) "ویرایش اطلاعات حیوان" else if (first) "افزودن اولین حیوان" else "افزودن حیوان"
        val actions = if (first) listOf(button(ctx, "بعداً", ButtonKind.TEXT, compact = true) { host.replace(Route.of(Screens.HOME)) }) else emptyList()
        sc = Scaffold(ctx, title, if (first) null else ({ host.pop() }), actions)
        stepper = horizontal(ctx)
        stepHost = vertical(ctx)
        sc.content.add(stepper, bottom = 18)
        sc.content.add(stepHost)
        backBtn = button(ctx, "مرحله قبل", ButtonKind.OUTLINE) { goTo(step - 1) }
        nextBtn = button(ctx, "مرحله بعد", ButtonKind.PRIMARY) { onNext() }
        sc.bottomActions(backBtn, nextBtn)
        avatar = PetAvatar(ctx, 112)
        createFields()
        if (editId != 0L) {
            sc.setBody(loadingState(ctx))
            load({ Graph.repo.pet(editId) to Graph.repo.latestWeight(editId) }) { (p, w) ->
                if (p == null) {
                    host.toast("این حیوان پیدا نشد", Tone.ERROR)
                    host.pop()
                    return@load
                }
                original = p
                fill(p, w)
                sc.setBody(stepper, stepHost)
                goTo(0)
            }
        } else {
            goTo(0)
        }
        return sc.root
    }

    private fun createFields() {
        name = TextField(ctx, "نام حیوان", "مثلاً: پیشی", required = true, kind = InputKind.NAME, maxLength = 40)
        species = ChoiceField(
            ctx, "نوع حیوان", Species.entries.map { it to it.label }, null, required = true,
        )
        speciesOther = TextField(ctx, "نام گونه", "مثلاً: همستر، لاک‌پشت", maxLength = 40)
        speciesOther.view.visibility = View.GONE
        species.onChanged = { s ->
            speciesOther.view.visibility = if (s == Species.OTHER) View.VISIBLE else View.GONE
            avatar.bind(Pet(name = "", species = s ?: Species.OTHER, photo = photo))
            updateWeightHint()
        }
        breed = TextField(ctx, "نژاد", "مثلاً: پرشین", maxLength = 60)
        sex = ChoiceField(ctx, "جنسیت", Sex.entries.map { it to it.label }, Sex.UNKNOWN)
        birth = DateField(ctx, "تاریخ تولد", maxDate = LocalDate.now(), placeholder = "در صورت اطلاع انتخاب کنید")
        weight = TextField(ctx, "وزن فعلی", "مثلاً: ۴٫۲", kind = InputKind.DECIMAL, maxLength = 8)
        weightUnit = ChoiceField(ctx, null, listOf("kg" to "کیلوگرم", "g" to "گرم"), "kg", wrap = false)
        color = TextField(ctx, "رنگ", "مثلاً: نارنجی و سفید", maxLength = 40)
        neutered = ChoiceField(ctx, "وضعیت عقیم‌سازی", listOf("yes" to "عقیم شده", "no" to "عقیم نشده", "unknown" to "نامشخص"), "unknown")
        microchip = TextField(ctx, "شماره میکروچیپ یا شناسه", "", maxLength = 40)
        allergies = TextField(ctx, "حساسیت‌ها", "مثلاً: حساسیت به مرغ", kind = InputKind.MULTILINE, maxLength = 500)
        conditions = TextField(ctx, "بیماری‌های شناخته‌شده", "در صورت وجود", kind = InputKind.MULTILINE, maxLength = 500)
        notes = TextField(ctx, "توضیحات تکمیلی", "", kind = InputKind.MULTILINE, maxLength = 1000)
        vetName = TextField(ctx, "نام دامپزشک", "", kind = InputKind.NAME, maxLength = 60)
        vetClinic = TextField(ctx, "مرکز درمانی", "", maxLength = 80)
        vetPhone = TextField(ctx, "شماره تماس دامپزشک", "", kind = InputKind.PHONE, maxLength = 20)
    }

    private fun updateWeightHint() {
        if (species.selected == Species.BIRD && weight.value.isBlank()) weightUnit.select("g")
    }

    private fun fill(p: Pet, w: WeightEntry?) {
        name.value = p.name
        species.select(p.species)
        speciesOther.value = p.speciesOther ?: ""
        breed.value = p.breed ?: ""
        sex.select(p.sex)
        birth.date = p.birthDate
        color.value = p.color ?: ""
        neutered.select(when (p.neutered) { true -> "yes"; false -> "no"; null -> "unknown" })
        microchip.value = p.microchip ?: ""
        allergies.value = p.allergies ?: ""
        conditions.value = p.conditions ?: ""
        notes.value = p.notes ?: ""
        vetName.value = p.vetName ?: ""
        vetClinic.value = p.vetClinic ?: ""
        vetPhone.value = p.vetPhone ?: ""
        photo = p.photo
        avatar.bind(p)
        // وزن در ویرایش از بخش «وزن و رشد» مدیریت می‌شود
        weight.view.visibility = View.GONE
        weightUnit.view.visibility = View.GONE
        if (w == null) {
            weight.view.visibility = View.VISIBLE
            weightUnit.view.visibility = View.VISIBLE
        }
    }

    private fun renderStepper() {
        stepper.removeAllViews()
        steps.forEachIndexed { i, label ->
            val active = i == step
            val done = i < step
            val col = vertical(ctx).apply { gravity = Gravity.CENTER_HORIZONTAL }
            val bar = View(ctx).apply { background = rounded(ctx, if (active || done) Theme.c.primary else Theme.c.outline, 3) }
            col.add(bar, h = ctx.dp(5))
            col.add(text(ctx, "${Fa.num(i + 1)}. $label", TextStyle.Caption, if (active) Theme.c.textPrimary else Theme.c.textTertiary, maxLines = 1, center = true), top = 6)
            stepper.add(col, w = 0, weight = 1f, start = if (i == 0) 0 else 6)
        }
    }

    private fun goTo(s: Int) {
        if (s < 0) return
        step = s
        renderStepper()
        stepHost.removeAllViews()
        when (step) {
            0 -> {
                val photoRow = vertical(ctx).apply { gravity = Gravity.CENTER_HORIZONTAL }
                val frame = FrameLayout(ctx)
                (avatar.parent as? FrameLayout)?.removeView(avatar)
                frame.addView(avatar, FrameLayout.LayoutParams(ctx.dp(112), ctx.dp(112)))
                val cam = FrameLayout(ctx).apply {
                    background = oval(Theme.c.primary)
                    elevation = dp(2f)
                    addView(iconView(ctx, R.drawable.ic_camera, Theme.c.onPrimary, 18), FrameLayout.LayoutParams(ctx.dp(18), ctx.dp(18), Gravity.CENTER))
                }
                frame.addView(cam, FrameLayout.LayoutParams(ctx.dp(36), ctx.dp(36), Gravity.BOTTOM or Gravity.START))
                frame.contentDescription = "انتخاب تصویر حیوان"
                frame.clickable(56) { choosePhoto() }
                photoRow.add(frame, w = ctx.dp(112), h = ctx.dp(112))
                photoRow.add(text(ctx, if (photo == null) "افزودن تصویر (اختیاری)" else "تغییر تصویر", TextStyle.Label, Theme.c.primary).apply {
                    setPaddingRelative(dp(8), dp(8), dp(8), dp(8)); clickable(12) { choosePhoto() }
                }, w = WRAP, top = 6)
                stepHost.add(photoRow, bottom = 12)
                stepHost.add(name.view)
                stepHost.add(species.view, top = 16)
                stepHost.add(speciesOther.view, top = 4)
                avatar.bind(Pet(name = "", species = species.selected ?: Species.OTHER, photo = photo))
            }
            1 -> {
                stepHost.add(breed.view)
                stepHost.add(sex.view, top = 16)
                stepHost.add(birth.view, top = 12)
                if (weight.view.visibility == View.VISIBLE) {
                    stepHost.add(weight.view, top = 16)
                    stepHost.add(weightUnit.view, top = 4)
                }
                stepHost.add(color.view, top = 12)
                stepHost.add(neutered.view, top = 16)
            }
            2 -> {
                stepHost.add(allergies.view)
                stepHost.add(conditions.view, top = 16)
                stepHost.add(text(ctx, "دامپزشک", TextStyle.TitleSmall), top = 24)
                stepHost.add(vetName.view, top = 10)
                stepHost.add(vetClinic.view, top = 16)
                stepHost.add(vetPhone.view, top = 16)
                stepHost.add(microchip.view, top = 16)
                stepHost.add(notes.view, top = 16)
            }
        }
        backBtn.visibility = if (step == 0) View.GONE else View.VISIBLE
        nextBtn.text = if (step == steps.size - 1) "ذخیره" else "مرحله بعد"
        // امکان ذخیره سریع در مرحله اول با فیلدهای ضروری
        if (step == 0) {
            val quick = button(ctx, "ذخیره بدون تکمیل جزئیات", ButtonKind.TEXT, compact = true) { if (validateBasic()) save() }
            stepHost.add(quick, w = WRAP, top = 18, gravity = Gravity.CENTER_HORIZONTAL)
        }
        sc.scroll?.scrollTo(0, 0)
    }

    private fun validateBasic(): Boolean {
        var ok = name.requireNotBlank("نام حیوان را وارد کنید")
        if (species.selected == null) {
            species.error("نوع حیوان را انتخاب کنید")
            ok = false
        }
        if (!ok && step != 0) goTo(0)
        return ok
    }

    private fun validateDetails(): Boolean {
        if (weight.view.visibility == View.VISIBLE && weight.value.isNotBlank()) {
            val v = Fa.parseDecimal(weight.value)
            if (v == null || v <= 0 || v > 200_000) {
                weight.error("وزن معتبر نیست")
                if (step != 1) goTo(1)
                return false
            }
        }
        return true
    }

    private fun onNext() {
        when (step) {
            0 -> if (validateBasic()) goTo(1)
            1 -> if (validateDetails()) goTo(2)
            else -> if (validateBasic() && validateDetails()) save()
        }
    }

    private fun choosePhoto() {
        Dialogs.options(ctx, "تصویر حیوان", listOfNotNull(
            Dialogs.Option("انتخاب از گالری", R.drawable.ic_image) { pickFromGallery() },
            Dialogs.Option("گرفتن عکس با دوربین", R.drawable.ic_camera) { takePhoto() },
            if (photo != null) Dialogs.Option("حذف تصویر", R.drawable.ic_trash, Tone.ERROR) {
                photo = null
                avatar.bind(Pet(name = "", species = species.selected ?: Species.OTHER))
                goTo(0)
            } else null,
        ))
    }

    private fun pickFromGallery() {
        // انتخابگر سیستمی تصویر؛ نیازی به مجوز دسترسی به حافظه نیست
        val intent = if (Build.VERSION.SDK_INT >= 33) Intent(MediaStore.ACTION_PICK_IMAGES).setType("image/*")
        else Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE)
        val ok = host.startForResult(intent) { code, data ->
            val uri = data?.data
            if (code == Activity.RESULT_OK && uri != null) importPhoto(uri, null)
        }
        if (!ok) host.toast("برنامه‌ای برای انتخاب تصویر پیدا نشد", Tone.ERROR)
    }

    private fun takePhoto() {
        // از برنامه دوربین سیستم استفاده می‌شود؛ مجوز CAMERA لازم نیست
        val file = Graph.files.newCameraFile()
        val uri = PrivateFileProvider.uriForCamera(ctx, file)
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val ok = host.startForResult(intent) { code, _ ->
            if (code == Activity.RESULT_OK && file.length() > 0) importPhoto(Uri.fromFile(file), file) else file.delete()
        }
        if (!ok) {
            file.delete()
            host.toast("برنامه دوربین در دسترس نیست", Tone.ERROR)
        }
    }

    private fun importPhoto(uri: Uri, temp: java.io.File?) {
        Async.run({ Graph.files.importPetPhoto(uri).relativePath }, onError = {
            temp?.delete()
            host.toast(if (it is FileStore.UnsupportedException) "این فایل تصویر قابل خواندن نیست" else "تصویر ذخیره نشد", Tone.ERROR)
        }) { rel ->
            temp?.delete()
            photo = rel
            newPhotos += rel
            if (alive) goTo(0)
        }
    }

    private fun save() {
        val sp = species.selected ?: return
        val pet = Pet(
            id = editId,
            name = name.value,
            species = sp,
            speciesOther = speciesOther.value.takeIf { sp == Species.OTHER },
            breed = breed.value,
            sex = sex.selected ?: Sex.UNKNOWN,
            birthDate = birth.date,
            color = color.value,
            neutered = when (neutered.selected) { "yes" -> true; "no" -> false; else -> null },
            allergies = allergies.value,
            conditions = conditions.value,
            photo = photo,
            notes = notes.value,
            microchip = microchip.value,
            foodType = original?.foodType,
            mealsPerDay = original?.mealsPerDay,
            feedingNotes = original?.feedingNotes,
            vetName = vetName.value,
            vetClinic = vetClinic.value,
            vetPhone = vetPhone.value,
            createdAt = original?.createdAt ?: System.currentTimeMillis(),
        )
        val grams = if (weight.view.visibility == View.VISIBLE) Fa.parseDecimal(weight.value)?.let { if (weightUnit.selected == "g") it else it * 1000 } else null
        val oldPhoto = original?.photo
        save({
            val repo = Graph.repo
            repo.transaction {
                val id = repo.savePet(pet)
                if (grams != null && grams > 0) {
                    repo.saveWeight(WeightEntry(petId = id, grams = grams, measuredAt = ir.panjeh.petcare.core.Fa.millisOf(LocalDate.now(), LocalTime.now().withSecond(0).withNano(0))))
                }
                if (editId == 0L) Graph.prefs.activePetId = id
            }
            // حذف تصاویر جایگزین‌شده
            if (oldPhoto != null && oldPhoto != photo) Graph.files.delete(oldPhoto)
            newPhotos.filter { it != photo }.forEach { Graph.files.delete(it) }
        }, if (editId == 0L) "${pet.name} اضافه شد" else "تغییرات ذخیره شد") {
            if (first) host.replace(Route.of(Screens.HOME)) else host.pop()
        }
    }

    override fun onBack(): Boolean {
        if (step > 0) {
            goTo(step - 1)
            return true
        }
        if (first) {
            host.replace(Route.of(Screens.HOME))
            return true
        }
        return false
    }

    override fun onDestroy() {
        super.onDestroy()
        // تصاویری که انتخاب شده ولی ذخیره نشده‌اند پاک می‌شوند
        if (newPhotos.isEmpty()) return
        Async.background {
            val referenced = Graph.repo.allPhotoPaths().toSet()
            newPhotos.filter { it !in referenced }.forEach { Graph.files.delete(it) }
        }
    }
}
