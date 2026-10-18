import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { totp } from './totp.js';

/**
 * Task manager and accounting modules through the real UI: enabled for an organisation from the console,
 * a task assigned and ticked off with a daily report and check-in, a bank account, a party, a draft voucher
 * and a receipt that posts its voucher, a balanced trial balance; axe and phone-width checks.
 */
const stamp = Date.now();
const ORG = `شرکت فاز۹ ${stamp}`;
let admin: Page;
let app: Page;
let secret = '';
let last = '';
async function code() {
  let c = totp(secret);
  while (c === last) {
    await new Promise((r) => setTimeout(r, 1000));
    c = totp(secret);
  }
  return (last = c);
}
const dialog = (p: Page) => p.getByRole('dialog');

test.describe.serial('phase 9 — task manager and accounting', () => {
  test.beforeAll(async ({ browser }) => {
    app = await (await browser.newContext()).newPage();
    await app.goto('/auth/signup');
    await app.getByLabel('نام و نام خانوادگی').fill('مدیر شرکت');
    await app.getByLabel('نام سازمان یا شرکت').fill(ORG);
    await app.getByLabel('ایمیل').fill(`p9-${stamp}@example.test`);
    await app.getByLabel(/^رمز عبور/).fill('Passw0rd-strong');
    await app.getByLabel('تکرار رمز عبور').fill('Passw0rd-strong');
    await app.getByRole('button', { name: 'ساخت فضای کاری' }).click();
    await app.getByRole('button', { name: 'فعلاً رد شو' }).click();
    await expect(app).toHaveURL(/\/app$/);

    admin = await (await browser.newContext()).newPage();
    await admin.goto('/console');
    await admin.getByLabel('ایمیل').fill('p9@platform.test');
    await admin.getByLabel('رمز عبور').fill('Ops9-Passw0rd-e2e');
    await admin.getByRole('button', { name: 'ادامه' }).click();
    await admin.getByRole('button', { name: 'فعال‌سازی تأیید دومرحله‌ای' }).click();
    secret = ((await admin.locator('bdi[dir="ltr"].font-mono').first().textContent()) ?? '').trim();
    await admin.getByLabel('کد ۶ رقمی').fill(await code());
    await admin.getByRole('button', { name: 'تأیید' }).click();
    await expect(admin.getByRole('heading', { name: 'وضعیت سامانه' })).toBeVisible();
  });

  test('both modules are enabled for the organisation', async () => {
    for (const id of ['taskboard', 'accounting']) {
      await admin.goto(`/console/modules/${id}`);
      await expect(async () => {
        await admin.getByRole('button', { name: `فعال‌سازی برای ${ORG}` }).click();
        await expect(admin.getByRole('row', { name: new RegExp(ORG) }).getByText('فعال', { exact: true })).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 30_000 });
    }
    await app.goto('/app');
    for (const name of ['کارهای من و حضور', 'مدیریت کار کارکنان', 'حسابداری']) await expect(app.getByRole('link', { name, exact: true }).first()).toBeVisible();
  });

  test('a manager assigns a task; it is ticked off with a note; check-in and a daily report', async () => {
    await app.goto('/app/taskboard/team');
    await app.getByRole('button', { name: 'سپردن کار جدید' }).click();
    const d = dialog(app);
    await d.getByLabel('عنوان کار').fill('بررسی نقشه‌های سازه');
    await d.getByLabel('ساعت مهلت').fill('23:30');
    await d.getByLabel('مدیر شرکت').check();
    await d.getByRole('button', { name: 'ثبت و اعلان' }).click();
    await expect(dialog(app)).toHaveCount(0);

    await app.goto('/app/taskboard');
    await app.getByRole('button', { name: 'ثبت ورود (حضور)' }).click();
    await expect(app.getByRole('button', { name: 'ثبت خروج' })).toBeVisible();
    await app.getByLabel('بررسی نقشه‌های سازه').click(); // opens the "done" dialog; ticks once saved
    await dialog(app).getByLabel(/توضیح/).fill('نقشه‌ها بررسی و اصلاحات ارسال شد');
    await dialog(app).getByRole('button', { name: 'ثبت انجام' }).click();
    await expect(app.getByText('منتظر بازبینی')).toBeVisible();
    await app.getByLabel(/شرح کارهای انجام‌شده/).fill('بررسی نقشه‌های سازه بلوک الف و جلسه با مشاور');
    await app.getByLabel(/ساعت کار مفید/).fill('7.5');
    await app.getByRole('button', { name: 'ثبت گزارش' }).click();
    await expect(app.getByRole('button', { name: 'به‌روزرسانی گزارش' })).toBeVisible();

    await app.goto('/app/taskboard/team');
    await expect(app.getByRole('cell', { name: /بررسی نقشه‌های سازه/ })).toBeVisible();
    await app.getByRole('tab', { name: 'کارنامه و KPI' }).click();
    await expect(app.getByRole('cell', { name: /مدیر شرکت/ })).toBeVisible();
  });

  test('accounting: bank account, party, draft voucher and a receipt that posts its voucher', async () => {
    await app.goto('/app/accounting/treasury');
    await app.getByRole('button', { name: 'صندوق / حساب بانکی جدید' }).click();
    await dialog(app).getByLabel(/^نام/).first().fill('بانک ملت جاری');
    await dialog(app).getByRole('button', { name: 'ذخیره' }).click();
    await expect(app.getByRole('cell', { name: 'بانک ملت جاری' })).toBeVisible();

    await app.goto('/app/accounting/setup');
    await app.getByRole('tab', { name: 'تفصیلی‌ها (طرف حساب‌ها)' }).click();
    await app.getByRole('button', { name: 'تفصیلی جدید' }).click();
    await dialog(app).getByLabel(/^نام/).first().fill('شرکت ساختمانی البرز');
    await dialog(app).getByLabel('کد اقتصادی').fill('411111111111');
    await dialog(app).getByRole('button', { name: 'ذخیره' }).click();
    await expect(app.getByRole('cell', { name: 'شرکت ساختمانی البرز' })).toBeVisible();

    await app.goto('/app/accounting');
    await app.getByRole('button', { name: 'سند جدید' }).click();
    await app.getByLabel('شرح سند').fill('سند آزمایشی هزینه اجاره');
    await app.getByLabel('حساب ردیف ۱').selectOption({ label: '8103 — اجاره' });
    await app.getByLabel('بدهکار').first().fill('5000000');
    await app.getByLabel('حساب ردیف ۲').selectOption({ label: '1101 — صندوق' });
    await app.getByLabel('بستانکار').nth(1).fill('5000000');
    await expect(app.getByText('تراز', { exact: true })).toBeVisible();
    await app.getByRole('button', { name: 'ذخیره پیش‌نویس' }).click();
    await expect(app.getByRole('heading', { name: 'سند پیش‌نویس' })).toBeVisible();

    await app.goto('/app/accounting/treasury');
    await app.getByRole('tab', { name: 'دریافت و پرداخت' }).click();
    await app.getByRole('button', { name: 'دریافت وجه' }).click();
    const r = dialog(app);
    await r.getByLabel('دریافت از').selectOption({ label: ((await r.locator('option', { hasText: 'شرکت ساختمانی البرز' }).first().textContent()) ?? '').trim() });
    await r.getByLabel('صندوق / حساب بانکی').selectOption({ index: 1 });
    await r.getByLabel('مبلغ (ریال)').fill('12000000');
    await r.getByRole('button', { name: 'ثبت و صدور سند' }).click();
    await expect(dialog(app)).toHaveCount(0);
    await expect(app.getByRole('cell', { name: /دریافت ۱/ })).toBeVisible();

    await app.goto('/app/accounting/reports');
    await expect(app.getByText('تراز است')).toBeVisible();
    await app.goto('/app/accounting');
    await expect(app.getByRole('link', { name: 'پیش‌نویس' })).toBeVisible();
    await expect(app.getByRole('link', { name: '۱', exact: true })).toBeVisible();
  });

  test('module pages pass axe (WCAG 2.1 AA) and fit a phone screen', async () => {
    const paths = ['/app/taskboard', '/app/taskboard/history', '/app/taskboard/team', '/app/accounting', '/app/accounting/vouchers/new', '/app/accounting/reports', '/app/accounting/treasury',
      '/app/accounting/invoices', '/app/accounting/invoices/new/sale', '/app/accounting/inventory', '/app/accounting/assets', '/app/accounting/setup'];
    for (const path of paths) {
      await app.goto(path);
      await expect(app.locator('main h1').first()).toBeVisible();
      await app.waitForTimeout(500);
      const r = await new AxeBuilder({ page: app }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(r.violations.map((v) => `${path}: ${v.id} ${v.nodes.map((n) => `${n.target.join(' ')} ${n.html.slice(0, 120)} ${n.failureSummary ?? ''}`).slice(0, 3).join(' | ')}`)).toEqual([]);
    }
    await app.setViewportSize({ width: 390, height: 800 });
    for (const path of paths) {
      await app.goto(path);
      await expect(app.locator('main h1').first()).toBeVisible();
      await app.waitForTimeout(300);
      const overflow = await app.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
