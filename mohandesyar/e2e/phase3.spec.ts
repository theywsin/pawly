import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { totp } from './totp.js';

/**
 * Phase-3 key flows through the real UI with the four business modules pre-installed:
 * enable modules for an organisation from the console, dashboard widgets, a contract with a progress
 * statement, a project schedule with the critical path, a lead converted to an opportunity, a meeting
 * with a resolution — and the modules invisible to an organisation that has not enabled them.
 */
const stamp = Date.now();
const ORG = `پیمانکاری فاز۳ ${stamp}`;
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

test.describe.serial('phase 3 — business modules', () => {
  test.beforeAll(async ({ browser }) => {
    app = await (await browser.newContext()).newPage();
    await app.goto('/auth/signup');
    await app.getByLabel('نام و نام خانوادگی').fill('مدیر پیمانکاری');
    await app.getByLabel('نام سازمان یا شرکت').fill(ORG);
    await app.getByLabel('ایمیل').fill(`p3-${stamp}@example.test`);
    await app.getByLabel(/^رمز عبور/).fill('Passw0rd-strong');
    await app.getByLabel('تکرار رمز عبور').fill('Passw0rd-strong');
    await app.getByRole('button', { name: 'ساخت فضای کاری' }).click();
    await app.getByRole('button', { name: 'فعلاً رد شو' }).click();
    await expect(app).toHaveURL(/\/app$/);

    admin = await (await browser.newContext()).newPage();
    await admin.goto('/console');
    await admin.getByLabel('ایمیل').fill('ops@platform.test');
    await admin.getByLabel('رمز عبور').fill('Ops-Passw0rd-e2e');
    await admin.getByRole('button', { name: 'ادامه' }).click();
    await admin.getByRole('button', { name: 'فعال‌سازی تأیید دومرحله‌ای' }).click();
    secret = ((await admin.locator('bdi[dir="ltr"].font-mono').first().textContent()) ?? '').trim();
    await admin.getByLabel('کد ۶ رقمی').fill(await code());
    await admin.getByRole('button', { name: 'تأیید' }).click();
    await expect(admin.getByRole('heading', { name: 'وضعیت سامانه' })).toBeVisible();
  });

  test('pre-installed modules are enabled for the organisation from the console', async () => {
    for (const id of ['contracts', 'projects', 'crm', 'meetings']) {
      await admin.goto(`/console/modules/${id}`);
      await expect(async () => {
        await admin.getByRole('button', { name: `فعال‌سازی برای ${ORG}` }).click();
        await expect(admin.getByRole('row', { name: new RegExp(ORG) }).getByText('فعال', { exact: true })).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 30_000 });
    }
    await app.goto('/app');
    for (const name of ['قراردادها', 'پروژه‌ها', 'فروش و مشتریان', 'جلسات و مصوبات']) await expect(app.getByRole('link', { name })).toBeVisible();
    await expect(app.getByRole('heading', { name: 'قراردادهای جاری' })).toBeVisible();
    await expect(app.getByText('داده کافی وجود ندارد — هنوز قراردادی ثبت نشده است.')).toBeVisible();
  });

  test('contract: create, sign and compute a progress statement', async () => {
    await app.goto('/app/contracts');
    await app.getByRole('button', { name: 'قرارداد جدید' }).click();
    await dialog(app).getByLabel(/^شماره قرارداد/).fill('ق-۱');
    await dialog(app).getByLabel(/^عنوان/).fill('اجرای سوله صنعتی');
    await dialog(app).getByLabel(/^طرف قرارداد/).fill('شرکت صنایع نمونه');
    await dialog(app).getByLabel(/^مبلغ اولیه/).fill('10000000000');
    await dialog(app).getByRole('button', { name: 'ذخیره' }).click();
    await app.getByRole('link', { name: 'ق-۱' }).click();
    await app.getByRole('button', { name: 'ثبت امضا' }).click();
    await dialog(app).getByRole('button', { name: 'ثبت امضا' }).click();
    await expect(app.getByText('جاری', { exact: true })).toBeVisible();
    await app.getByRole('tab', { name: /صورت‌وضعیت/ }).click();
    await app.getByRole('button', { name: 'صورت‌وضعیت جدید' }).click();
    await dialog(app).getByLabel(/^تا تاریخ/).fill('1405/01/31');
    await dialog(app).getByLabel(/^کارکرد تجمعی/).fill('2000000000');
    // Defaults 10% + 5% + 3% deducted, 10% VAT added: 2,000,000,000 → 1,840,000,000.
    await expect(dialog(app).getByText(/۱.۸۴۰.۰۰۰.۰۰۰/)).toBeVisible();
    await dialog(app).getByRole('button', { name: 'ذخیره' }).click();
    await expect(app.getByRole('button', { name: 'ارسال برای تأیید' })).toBeVisible();
  });

  test('project: schedule with a dependency; critical path and Gantt', async () => {
    await app.goto('/app/projects');
    await app.getByRole('button', { name: 'پروژه جدید' }).click();
    await dialog(app).getByLabel(/^کد پروژه/).fill('PR-1');
    await dialog(app).getByLabel(/^عنوان/).fill('سوله صنعتی');
    await dialog(app).getByLabel(/^شروع برنامه‌ای/).fill('1405/01/15');
    await dialog(app).getByRole('button', { name: 'ذخیره' }).click();
    await app.getByRole('link', { name: 'PR-1' }).click();
    await app.getByRole('tab', { name: /برنامه و فعالیت‌ها/ }).click();
    for (const [name, days] of [['فونداسیون', '20'], ['نصب سازه', '30'], ['محوطه‌سازی', '5']]) {
      await app.getByRole('button', { name: 'فعالیت', exact: true }).click();
      await dialog(app).getByLabel(/^نام فعالیت/).fill(name!);
      await dialog(app).getByLabel(/^مدت/).fill(days!);
      await dialog(app).getByRole('button', { name: 'ذخیره' }).click();
      await expect(dialog(app)).toHaveCount(0);
    }
    await app.getByRole('button', { name: 'وابستگی' }).click();
    await dialog(app).getByLabel(/^پیش‌نیاز/).selectOption({ label: 'فونداسیون' });
    await dialog(app).getByLabel(/^فعالیت وابسته/).selectOption({ label: 'نصب سازه' });
    await dialog(app).getByRole('button', { name: 'ذخیره' }).click();
    await expect(app.getByRole('row', { name: /نصب سازه/ })).toContainText('بحرانی');
    await expect(app.getByRole('row', { name: /محوطه‌سازی/ })).toContainText('۴۵ روز'); // float
    await expect(app.getByRole('row', { name: /نصب سازه/ })).toContainText('۱۴۰۵/۰۲/۰۷'); // 20 working days after Sat 15 Farvardin (three Fridays skipped)
    await app.getByRole('tab', { name: 'گانت' }).click();
    await expect(app.getByRole('img', { name: 'نمودار گانت برنامه زمان‌بندی' })).toBeVisible();
  });

  test('crm: lead converted to an opportunity, won on the board', async () => {
    await app.goto('/app/crm/leads');
    await app.getByRole('button', { name: 'سرنخ جدید' }).click();
    await dialog(app).getByLabel(/^عنوان/).fill('طراحی کارخانه');
    await dialog(app).getByLabel('سازمان').fill('صنایع غذایی نمونه');
    await dialog(app).getByLabel(/^منبع/).selectOption('tender');
    await dialog(app).getByLabel('بودجه تخمینی').fill('8000000000');
    await dialog(app).getByRole('button', { name: 'ذخیره' }).click();
    await app.getByRole('button', { name: 'تبدیل به فرصت' }).click();
    await dialog(app).getByRole('button', { name: 'ذخیره' }).click();
    await expect(app).toHaveURL(/opportunities\//);
    await app.getByLabel('تغییر مرحله').selectOption({ label: 'برنده' });
    await expect(app.getByText('برنده', { exact: true }).first()).toBeVisible();
    await app.goto('/app/crm/reports');
    await expect(app.getByText('فرصت‌های برنده')).toBeVisible();
  });

  test('meetings: meeting with a resolution; overdue resolutions widget', async () => {
    await app.goto('/app/meetings');
    await app.getByRole('button', { name: 'جلسه جدید' }).click();
    await dialog(app).getByLabel(/^موضوع/).fill('جلسه شروع پروژه سوله');
    await dialog(app).getByLabel('دستور جلسه').fill('معرفی تیم\nبرنامه زمان‌بندی');
    await dialog(app).getByRole('button', { name: 'ذخیره و ارسال دعوت' }).click();
    await expect(app.getByRole('heading', { name: /جلسه شروع پروژه سوله/ })).toBeVisible();
    await app.getByRole('button', { name: 'مصوبه' }).click();
    await dialog(app).getByLabel(/^متن مصوبه/).fill('تحویل نقشه‌های اجرایی');
    await dialog(app).getByLabel(/^مسئول اجرا/).selectOption({ label: 'مدیر پیمانکاری' });
    await dialog(app).getByLabel('مهلت').fill('1400/01/01');
    await dialog(app).getByRole('button', { name: 'ذخیره' }).click();
    await expect(app.getByRole('row', { name: /تحویل نقشه‌های اجرایی/ })).toContainText('معوق');
    await app.goto('/app');
    await expect(app.getByText('مصوبه معوق')).toBeVisible();
  });

  test('module pages pass axe (WCAG 2.1 AA)', async () => {
    for (const path of ['/app', '/app/contracts', '/app/projects', '/app/crm', '/app/crm/leads', '/app/crm/accounts', '/app/meetings', '/app/meetings/resolutions']) {
      await app.goto(path);
      await expect(app.locator('main h1').first()).toBeVisible();
      await app.waitForTimeout(500);
      const r = await new AxeBuilder({ page: app }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(r.violations.map((v) => `${path}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
    }
    await app.getByRole('link', { name: /جلسه شروع/ }).first().click();
    await expect(app.locator('main h1').first()).toBeVisible();
    expect((await new AxeBuilder({ page: app }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ') + ' ' + (n.any[0]?.message ?? '')).slice(0, 4).join(' | ')}`)).toEqual([]);
  });

  test('another organisation without the modules sees none of them', async ({ browser }) => {
    const other = await (await browser.newContext()).newPage();
    await other.goto('/auth/signup');
    await other.getByLabel('نام و نام خانوادگی').fill('مدیر دیگر');
    await other.getByLabel('نام سازمان یا شرکت').fill(`سازمان دیگر ${stamp}`);
    await other.getByLabel('ایمیل').fill(`p3-other-${stamp}@example.test`);
    await other.getByLabel(/^رمز عبور/).fill('Passw0rd-strong');
    await other.getByLabel('تکرار رمز عبور').fill('Passw0rd-strong');
    await other.getByRole('button', { name: 'ساخت فضای کاری' }).click();
    await other.getByRole('button', { name: 'فعلاً رد شو' }).click();
    await expect(other.getByRole('link', { name: 'قراردادها' })).toHaveCount(0);
    const r = await other.request.get('/api/m/contracts/v1/contracts');
    expect(r.status()).toBe(401); // no bearer token from a plain request; the API refuses
  });
});
