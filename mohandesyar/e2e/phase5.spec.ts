import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { totp } from './totp.js';

/**
 * Phase-5 key flows through the real UI with finance, procurement and documents pre-installed: a bank
 * account with an opening balance, a supplier and a purchase order sent for approval, a document with an
 * uploaded first version found by search, suppliers imported from a CSV after a dry run, axe and
 * phone-width checks.
 */
const stamp = Date.now();
const ORG = `پیمانکار فاز۵ ${stamp}`;
let admin: Page;
let app: Page;
let secret = '';
let last = '';
let orderUrl = '';
let documentUrl = '';
async function code() {
  let c = totp(secret);
  while (c === last) {
    await new Promise((r) => setTimeout(r, 1000));
    c = totp(secret);
  }
  return (last = c);
}
const dialog = (p: Page) => p.getByRole('dialog');

test.describe.serial('phase 5 — finance and operations', () => {
  test.beforeAll(async ({ browser }) => {
    app = await (await browser.newContext()).newPage();
    await app.goto('/auth/signup');
    await app.getByLabel('نام و نام خانوادگی').fill('مدیر پیمانکار');
    await app.getByLabel('نام سازمان یا شرکت').fill(ORG);
    await app.getByLabel('ایمیل').fill(`p5-${stamp}@example.test`);
    await app.getByLabel(/^رمز عبور/).fill('Passw0rd-strong');
    await app.getByLabel('تکرار رمز عبور').fill('Passw0rd-strong');
    await app.getByRole('button', { name: 'ساخت فضای کاری' }).click();
    await app.getByRole('button', { name: 'فعلاً رد شو' }).click();
    await expect(app).toHaveURL(/\/app$/);

    admin = await (await browser.newContext()).newPage();
    await admin.goto('/console');
    await admin.getByLabel('ایمیل').fill('fin@platform.test');
    await admin.getByLabel('رمز عبور').fill('Fin-Passw0rd-e2e');
    await admin.getByRole('button', { name: 'ادامه' }).click();
    await admin.getByRole('button', { name: 'فعال‌سازی تأیید دومرحله‌ای' }).click();
    secret = ((await admin.locator('bdi[dir="ltr"].font-mono').first().textContent()) ?? '').trim();
    await admin.getByLabel('کد ۶ رقمی').fill(await code());
    await admin.getByRole('button', { name: 'تأیید' }).click();
    await expect(admin.getByRole('heading', { name: 'وضعیت سامانه' })).toBeVisible();
  });

  test('finance, procurement and documents are enabled for the organisation', async () => {
    for (const id of ['finance', 'procurement', 'documents']) {
      await admin.goto(`/console/modules/${id}`);
      await expect(async () => {
        await admin.getByRole('button', { name: `فعال‌سازی برای ${ORG}` }).click();
        await expect(admin.getByRole('row', { name: new RegExp(ORG) }).getByText('فعال', { exact: true })).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 30_000 });
    }
    await app.goto('/app');
    for (const name of ['مالی', 'تدارکات', 'اسناد']) await expect(app.getByRole('link', { name, exact: true })).toBeVisible();
  });

  test('a bank account with an opening balance', async () => {
    await app.goto('/app/finance/accounts');
    await app.getByRole('button', { name: 'حساب جدید' }).click();
    const d = dialog(app);
    await d.getByLabel(/^نام حساب/).fill('جاری ملت مرکزی');
    await d.getByLabel('شماره شبا').fill('IR12');
    await d.getByLabel('مانده افتتاحیه (ریال)').fill('500000000');
    await d.getByRole('button', { name: 'ذخیره' }).click();
    await expect(d.getByText('شماره شبا معتبر نیست', { exact: true })).toBeVisible();
    await d.getByLabel('شماره شبا').fill('IR062960000000100324200001');
    await d.getByRole('button', { name: 'ذخیره' }).click();
    await expect(app.getByRole('button', { name: /^جاری ملت مرکزی ·/ })).toContainText('۵۰۰٬۰۰۰٬۰۰۰');
  });

  test('suppliers come in from a CSV file after a dry run', async () => {
    await app.goto('/app/settings/imports');
    await app.getByRole('button', { name: /تأمین‌کنندگان/ }).click();
    await expect(app.getByRole('cell', { name: /^نام/ }).first()).toBeVisible();
    const download = app.waitForEvent('download');
    await app.getByRole('button', { name: 'دانلود قالب' }).click();
    expect((await download).suggestedFilename()).toBe('procurement.suppliers.xlsx');
    const csv = (body: string) => ({ name: 'suppliers.csv', mimeType: 'text/csv', buffer: Buffer.from(`﻿${body}`, 'utf8') });
    await app.getByLabel('فایل پرشده').setInputFiles(csv('نام,شماره شبا\nفولاد البرز,123\n'));
    await app.getByRole('button', { name: 'بررسی فایل' }).click();
    await expect(app.getByText('۱ خطا پیدا شد؛ هیچ ردیفی وارد نشد')).toBeVisible();
    await expect(app.getByRole('row', { name: /شماره شبا معتبر نیست/ })).toContainText('۲');
    await app.getByLabel('فایل پرشده').setInputFiles(csv('نام,شماره شبا,تلفن\nفولاد البرز,IR062960000000100324200001,02144556677\nسیمان تهران,,\n'));
    await app.getByRole('button', { name: 'بررسی فایل' }).click();
    await app.getByRole('button', { name: 'ورود ۲ ردیف' }).click();
    await expect(app.getByText('۲ ردیف وارد شد.')).toBeVisible();
    await app.goto('/app/procurement/suppliers');
    for (const name of ['فولاد البرز', 'سیمان تهران']) await expect(app.getByRole('cell', { name, exact: true })).toBeVisible();
  });

  test('a direct purchase order goes to the approval inbox', async () => {
    await app.goto('/app/procurement/orders');
    await app.getByRole('button', { name: 'سفارش مستقیم' }).click();
    const d = dialog(app);
    await d.getByLabel(/^تأمین‌کننده/).selectOption({ label: 'فولاد البرز' });
    await d.getByLabel(/^شرح/).fill('میلگرد ۱۶');
    await d.getByLabel(/^مقدار/).fill('2500');
    await d.getByLabel(/^قیمت واحد/).fill('95000');
    await d.getByRole('button', { name: 'ارسال برای تأیید' }).click();
    await expect(app.getByText(/سفارش PO-۱ ثبت و برای تأیید ارسال شد/)).toBeVisible();
    await app.getByRole('link', { name: 'PO-۱' }).click();
    await expect(app.getByRole('heading', { level: 1, name: /PO-۱ — فولاد البرز/ })).toBeVisible();
    orderUrl = app.url();
    await expect(app.getByText('در انتظار تأیید').first()).toBeVisible();
    await expect(app.getByRole('cell', { name: '۲۳۷٬۵۰۰٬۰۰۰' })).toBeVisible();
    await expect(app.getByRole('button', { name: 'ثبت تحویل' })).toHaveCount(0); // not before approval
  });

  test('a document with its first version, found by Persian search', async () => {
    await app.goto('/app/documents/settings');
    await app.getByRole('button', { name: 'دسته جدید' }).click();
    await dialog(app).getByLabel(/^نام/).fill('صورت‌جلسات');
    await dialog(app).getByLabel(/تأیید لازم دارد/).uncheck();
    await dialog(app).getByRole('button', { name: 'ذخیره' }).click();
    await expect(app.getByRole('cell', { name: 'صورت‌جلسات' })).toBeVisible();

    await app.goto('/app/documents/list');
    await app.getByRole('button', { name: 'سند جدید' }).click();
    const d = dialog(app);
    await d.getByLabel(/^شماره سند/).fill('MOM-014');
    await d.getByLabel(/^عنوان/).fill('صورت‌جلسه تحویل موقت');
    await d.getByLabel(/^دسته/).selectOption({ label: 'صورت‌جلسات (بدون تأیید)' });
    await d.getByLabel(/^برچسب‌ها/).fill('تحویل، کارفرما');
    await d.getByLabel(/^فایل نسخه ۱/).setInputFiles({ name: 'mom-014.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 mom') });
    await d.getByRole('button', { name: 'ثبت' }).click();
    await expect(app.getByRole('heading', { level: 1, name: 'MOM-014 — صورت‌جلسه تحویل موقت' })).toBeVisible();
    documentUrl = app.url();
    await expect(app.getByText('نسخه جاری')).toBeVisible();
    const download = app.waitForEvent('download');
    await app.getByRole('button', { name: 'دانلود نسخه ۱' }).click();
    expect((await download).suggestedFilename()).toBe('mom-014.pdf');

    await app.goto('/app/documents/list');
    await app.getByLabel(/^جست‌وجو در شماره/).fill('صورت‌جلسه تحويل'); // Arabic yeh, normalised to Persian
    await app.getByRole('button', { name: 'جست‌وجو', exact: true }).click();
    await expect(app.getByRole('link', { name: 'MOM-014' })).toBeVisible();
    await app.getByLabel(/^جست‌وجو در شماره/).fill('قرارداد پیمانکاری');
    await app.getByRole('button', { name: 'جست‌وجو', exact: true }).click();
    await expect(app.getByText('سندی با این جست‌وجو یافت نشد')).toBeVisible();
  });

  test('module pages pass axe (WCAG 2.1 AA)', async () => {
    const paths = ['/app/finance/accounts', '/app/finance/payments', '/app/finance/budgets', '/app/finance/cashflow', '/app/finance/reconciliation', '/app/finance/reports', '/app/finance/settings',
      '/app/procurement/requests', '/app/procurement/rfqs', '/app/procurement/orders', orderUrl, '/app/procurement/invoices', '/app/procurement/suppliers', '/app/procurement/reports',
      '/app/documents/list', documentUrl, '/app/documents/settings', '/app/settings/imports', '/app/settings/approvals'];
    for (const path of paths) {
      await app.goto(path);
      await expect(app.locator('main h1').first()).toBeVisible();
      await app.waitForTimeout(500);
      const r = await new AxeBuilder({ page: app }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(r.violations.map((v) => `${path}: ${v.id} ${v.nodes.map((n) => `${n.target.join(' ')} ${n.html.slice(0, 120)} ${n.failureSummary ?? ''}`).slice(0, 3).join(' | ')}`)).toEqual([]);
    }
  });

  test('detail pages fit a phone screen without horizontal scrolling', async () => {
    await app.setViewportSize({ width: 390, height: 800 });
    for (const path of [orderUrl, documentUrl, '/app/finance/accounts', '/app/procurement/suppliers', '/app/documents/list', '/app/settings/imports']) {
      await app.goto(path);
      await expect(app.locator('main h1').first()).toBeVisible();
      await app.waitForTimeout(300);
      const overflow = await app.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
