import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Phase 8: roles and permissions managed by the organisation, through the real UI. */
const stamp = Date.now();
let owner: Page;

test.describe.serial('phase 8 — roles and permissions', () => {
  test.beforeAll(async ({ browser }) => {
    owner = await (await browser.newContext()).newPage();
    await owner.goto('/auth/signup');
    await owner.getByLabel('نام و نام خانوادگی').fill('مدیر سازمان');
    await owner.getByLabel('نام سازمان یا شرکت').fill(`شرکت نقش ${stamp}`);
    await owner.getByLabel('ایمیل').fill(`p8-${stamp}@example.test`);
    await owner.getByLabel(/^رمز عبور/).fill('Passw0rd-strong');
    await owner.getByLabel('تکرار رمز عبور').fill('Passw0rd-strong');
    await owner.getByRole('button', { name: 'ساخت فضای کاری' }).click();
    await owner.getByRole('button', { name: 'فعلاً رد شو' }).click();
    await expect(owner).toHaveURL(/\/app$/);
  });

  test('the owner creates a role, gives it to an employee, and the employee gets exactly that access', async ({ browser }) => {
    await owner.goto('/app/settings/members');
    await owner.getByRole('button', { name: 'افزودن کاربر' }).click();
    const add = owner.getByRole('dialog');
    await add.getByLabel('نام و نام خانوادگی').fill('کارمند نمونه');
    await add.getByLabel('ایمیل').fill(`staff-${stamp}@example.test`);
    await add.getByLabel('نقش').selectOption('employee');
    await add.getByLabel(/رمز/).fill('Staff-Passw0rd-1');
    await add.getByRole('button', { name: /افزودن|ثبت|ذخیره/ }).click();
    await expect(owner.getByRole('cell', { name: 'کارمند نمونه', exact: true })).toBeVisible();

    await owner.getByRole('link', { name: 'تعریف نقش‌ها' }).click();
    await owner.getByRole('button', { name: 'نقش جدید' }).click();
    const editor = owner.getByRole('dialog');
    await editor.getByLabel('نام نقش').fill('مسئول کاربران');
    await editor.getByLabel('مشاهده کاربران').check();
    await editor.getByRole('button', { name: 'ذخیره نقش' }).click();
    await expect(owner.getByRole('heading', { name: 'مسئول کاربران' })).toBeVisible();

    await owner.goto('/app/settings/members');
    await owner.getByRole('button', { name: 'نقش‌ها و وضعیت کارمند نمونه' }).click();
    const dlg = owner.getByRole('dialog');
    await dlg.getByRole('button', { name: 'افزودن نقش' }).click();
    await dlg.getByLabel('نقش', { exact: true }).last().selectOption({ label: 'مسئول کاربران' });
    await dlg.getByRole('button', { name: 'ذخیره نقش‌ها' }).click();
    await expect(owner.getByText('مسئول کاربران · همه شرکت‌ها')).toBeVisible();

    const staff = await (await browser.newContext()).newPage();
    await staff.goto('/auth/login');
    await staff.getByLabel('ایمیل').fill(`staff-${stamp}@example.test`);
    await staff.getByLabel('رمز عبور').fill('Staff-Passw0rd-1');
    await staff.getByRole('button', { name: 'ورود' }).click();
    await expect(staff).toHaveURL(/\/app/);
    const nav = staff.getByRole('navigation', { name: 'منوی اصلی' });
    await expect(nav.getByRole('link', { name: 'کاربران و نقش‌ها' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'گزارش رویدادها' })).toHaveCount(0);
    await staff.goto('/app/settings/members');
    await expect(staff.getByRole('cell', { name: 'کارمند نمونه', exact: true })).toBeVisible();
    await expect(staff.getByRole('button', { name: 'افزودن کاربر' })).toHaveCount(0);
  });

  test('roles pages pass axe', async () => {
    await owner.goto('/app/settings/roles');
    await expect(owner.getByRole('heading', { name: 'نقش‌ها و دسترسی‌ها' })).toBeVisible();
    const r = await new AxeBuilder({ page: owner }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});
