import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { totp } from './totp.js';

/**
 * Phase-4 key flows through the real UI with recruitment, hr and kpi pre-installed: a structured resume
 * with a confidential file, a job with transparent scoring, an employee file with a leave request counted
 * in working days, a KPI with target and value (from the user and from the hr provider), axe and
 * phone-width layout checks.
 */
const stamp = Date.now();
const ORG = `مشاور فاز۴ ${stamp}`;
let admin: Page;
let app: Page;
let secret = '';
let last = '';
let candidateUrl = '';
let employeeUrl = '';
async function code() {
  let c = totp(secret);
  while (c === last) {
    await new Promise((r) => setTimeout(r, 1000));
    c = totp(secret);
  }
  return (last = c);
}
const dialog = (p: Page) => p.getByRole('dialog');

test.describe.serial('phase 4 — HR and KPI modules', () => {
  test.beforeAll(async ({ browser }) => {
    app = await (await browser.newContext()).newPage();
    await app.goto('/auth/signup');
    await app.getByLabel('نام و نام خانوادگی').fill('مدیر مشاور');
    await app.getByLabel('نام سازمان یا شرکت').fill(ORG);
    await app.getByLabel('ایمیل').fill(`p4-${stamp}@example.test`);
    await app.getByLabel(/^رمز عبور/).fill('Passw0rd-strong');
    await app.getByLabel('تکرار رمز عبور').fill('Passw0rd-strong');
    await app.getByRole('button', { name: 'ساخت فضای کاری' }).click();
    await app.getByRole('button', { name: 'فعلاً رد شو' }).click();
    await expect(app).toHaveURL(/\/app$/);

    admin = await (await browser.newContext()).newPage();
    await admin.goto('/console');
    await admin.getByLabel('ایمیل').fill('hr@platform.test');
    await admin.getByLabel('رمز عبور').fill('Hr-Passw0rd-e2e');
    await admin.getByRole('button', { name: 'ادامه' }).click();
    await admin.getByRole('button', { name: 'فعال‌سازی تأیید دومرحله‌ای' }).click();
    secret = ((await admin.locator('bdi[dir="ltr"].font-mono').first().textContent()) ?? '').trim();
    await admin.getByLabel('کد ۶ رقمی').fill(await code());
    await admin.getByRole('button', { name: 'تأیید' }).click();
    await expect(admin.getByRole('heading', { name: 'وضعیت سامانه' })).toBeVisible();
  });

  test('recruitment, hr and kpi are enabled for the organisation', async () => {
    for (const id of ['recruitment', 'hr', 'kpi']) {
      await admin.goto(`/console/modules/${id}`);
      await expect(async () => {
        await admin.getByRole('button', { name: `فعال‌سازی برای ${ORG}` }).click();
        await expect(admin.getByRole('row', { name: new RegExp(ORG) }).getByText('فعال', { exact: true })).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 30_000 });
    }
    await app.goto('/app');
    for (const name of ['استخدام', 'کارکنان', 'شاخص‌های عملکرد']) await expect(app.getByRole('link', { name, exact: true })).toBeVisible();
  });

  test('a structured resume with a confidential file, found by full-text search', async () => {
    await app.goto('/app/recruitment');
    await expect(app).toHaveURL(/\/app\/recruitment\/candidates$/);
    await app.getByRole('button', { name: 'ثبت رزومه' }).click();
    const d = dialog(app);
    await expect(d.getByText('سن، جنسیت، وضعیت تأهل، قومیت، مذهب و سلامت ثبت نمی‌شوند')).toBeVisible();
    await d.getByLabel(/^نام و نام خانوادگی/).fill('سارا رضایی');
    await d.getByLabel('شماره همراه').fill('09121112233');
    await d.getByLabel('موقعیت مورد نظر').fill('کارشناس طراحی سازه');
    await d.getByRole('button', { name: 'افزودن سابقه' }).click();
    await d.getByLabel(/^سازمان/).fill('مهندسین مشاور الف');
    await d.getByLabel(/^عنوان شغل/).fill('طراح سازه');
    await d.getByLabel(/^از تاریخ/).fill('1397/01/01');
    await d.getByLabel('شرح وظایف و دستاوردها').fill('تحلیل لرزه‌ای ساختمان‌های بلند');
    await d.getByRole('button', { name: 'افزودن مورد' }).click();
    await d.getByRole('textbox', { name: 'نام', exact: true }).fill('ETABS');
    await d.getByRole('button', { name: 'ذخیره' }).click();
    await expect(app.getByRole('heading', { level: 1, name: 'سارا رضایی' })).toBeVisible();
    candidateUrl = app.url();
    await expect(app.getByText('طراح سازه — مهندسین مشاور الف')).toBeVisible();

    await app.getByRole('tab', { name: /فایل‌ها/ }).click();
    await app.locator('input[type=file]').setInputFiles({ name: 'resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 resume') });
    await expect(app.getByRole('row', { name: /resume\.pdf/ })).toBeVisible();
    const download = app.waitForEvent('download');
    await app.getByRole('button', { name: 'دانلود' }).click();
    expect((await download).suggestedFilename()).toBe('resume.pdf');

    await app.goto('/app/recruitment/candidates');
    await app.getByLabel('جست‌وجوی متنی').fill('تحلیل لرزه');
    await app.getByRole('button', { name: 'جست‌وجو', exact: true }).click();
    await expect(app.getByRole('link', { name: 'سارا رضایی' })).toBeVisible();
    await app.getByLabel('جست‌وجوی متنی').fill('معماری داخلی');
    await app.getByRole('button', { name: 'جست‌وجو', exact: true }).click();
    await expect(app.getByText('رزومه‌ای با این مشخصات یافت نشد')).toBeVisible();
  });

  test('a job scores candidates with the reason for every point', async () => {
    await app.goto('/app/recruitment/jobs');
    await app.getByRole('button', { name: 'موقعیت جدید' }).click();
    await dialog(app).getByLabel(/^عنوان موقعیت/).fill('کارشناس ارشد سازه');
    await dialog(app).getByRole('button', { name: 'ذخیره' }).click();
    await expect(app.getByRole('heading', { level: 1, name: 'کارشناس ارشد سازه' })).toBeVisible();
    await app.getByRole('tab', { name: /معیارهای امتیازدهی/ }).click();
    await app.getByRole('button', { name: 'افزودن معیار' }).click();
    await app.getByLabel('نام', { exact: true }).fill('etabs');
    await app.getByRole('button', { name: 'ذخیره و امتیازدهی دوباره' }).click();
    await expect(app.getByText(/نسخه ۲ معیارها ذخیره/)).toBeVisible();
    await app.getByRole('button', { name: 'افزودن متقاضی از بانک رزومه' }).click();
    await dialog(app).getByLabel(/سارا رضایی/).check();
    await dialog(app).getByRole('button', { name: /^افزودن ۱ نفر/ }).click();
    await app.getByRole('tab', { name: /رتبه‌بندی/ }).click();
    await expect(app.getByText('ثبت شده با سطح ۳ از ۵')).toBeVisible();
    await expect(app.getByText('امتیاز فقط کمکی است')).toBeVisible();
    const download = app.waitForEvent('download');
    await app.getByRole('button', { name: 'Excel' }).click();
    expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
  });

  test('an employee file, and a leave request counted in working days', async () => {
    await app.goto('/app/hr');
    await expect(app).toHaveURL(/\/app\/hr\/employees$/);
    await app.getByRole('button', { name: 'کارمند جدید' }).click();
    const d = dialog(app);
    await d.getByLabel(/^نام و نام خانوادگی/).fill('مدیر مشاور');
    await d.getByLabel(/^شماره پرسنلی/).fill('1001');
    await d.getByLabel(/^کد ملی/).fill('0013542418');
    await d.getByLabel('حساب کاربری در سامانه').selectOption({ index: 1 });
    await d.getByRole('button', { name: 'ذخیره' }).click();
    await expect(d.getByRole('alert').filter({ hasText: /^کد ملی معتبر نیست$/ })).toBeVisible();
    await d.getByLabel(/^کد ملی/).fill('0013542419');
    await d.getByRole('button', { name: 'ذخیره' }).click();
    await expect(app.getByRole('heading', { level: 1, name: 'مدیر مشاور' })).toBeVisible();
    employeeUrl = app.url();
    await app.getByRole('button', { name: 'درخواست مرخصی' }).click();
    // 16–22 Aban 1405 (Sat–Fri): Friday is the weekly day off → 6 working days.
    await dialog(app).getByLabel(/^از تاریخ/).fill('1405/08/16');
    await dialog(app).getByLabel(/^تا تاریخ/).fill('1405/08/22');
    await dialog(app).getByRole('button', { name: 'ارسال برای تأیید' }).click();
    await expect(app.getByText('درخواست ۶ روز کاری ثبت و برای تأیید ارسال شد')).toBeVisible();
    await app.getByRole('tab', { name: /مرخصی/ }).click();
    await expect(app.getByRole('row', { name: /استحقاقی/ })).toContainText('در انتظار تأیید');
    await expect(app.getByText('در انتظار ۶')).toBeVisible();
  });

  test('KPIs: a target and a manual value, and a value from the hr provider', async () => {
    await app.goto('/app/kpi');
    await expect(app).toHaveURL(/\/app\/kpi\/definitions$/);
    await app.getByRole('button', { name: 'شاخص جدید' }).click();
    await dialog(app).getByLabel(/^نام شاخص/).fill('رضایت کارفرما');
    await dialog(app).getByLabel(/^کد/).fill('client_satisfaction');
    await dialog(app).getByRole('button', { name: 'ذخیره' }).click();
    await expect(app.getByRole('heading', { level: 1, name: 'رضایت کارفرما' })).toBeVisible();
    await app.getByRole('button', { name: 'تعیین هدف' }).click();
    await dialog(app).getByLabel('هدف سازمان').fill('100');
    await dialog(app).getByRole('button', { name: 'ذخیره' }).click();
    await expect(app.getByText('هدف‌ها ذخیره شد')).toBeVisible();

    await app.goto('/app/kpi/definitions');
    await app.getByRole('button', { name: 'شاخص جدید' }).click();
    await dialog(app).getByLabel(/^نام شاخص/).fill('تعداد کارکنان');
    await dialog(app).getByLabel(/^کد/).fill('headcount');
    await dialog(app).getByLabel('منبع داده').selectOption('provider');
    await dialog(app).getByLabel(/^Provider/).selectOption({ label: 'تعداد کارکنان فعال (تعداد)' });
    await dialog(app).getByRole('button', { name: 'ذخیره' }).click();
    await expect(app.getByRole('heading', { level: 1, name: 'تعداد کارکنان' })).toBeVisible();

    await app.goto('/app/kpi/values');
    const manual = app.getByRole('row', { name: /رضایت کارفرما/ });
    await manual.getByRole('button', { name: 'ثبت مقدار' }).click();
    await dialog(app).getByLabel(/^مقدار/).fill('90');
    await dialog(app).getByRole('button', { name: 'ثبت' }).click();
    await expect(manual).toContainText('در انتظار تأیید');
    await expect(manual.getByRole('button', { name: 'تأیید' })).toHaveCount(0); // whoever entered it cannot approve
    const provider = app.getByRole('row', { name: /تعداد کارکنان/ });
    await provider.getByRole('button', { name: 'دریافت از ماژول' }).click();
    await expect(provider).toContainText('از تعداد کارکنان فعال');
    await expect(provider.getByRole('cell').nth(3)).toContainText('۱');
  });

  test('module pages pass axe (WCAG 2.1 AA)', async () => {
    const paths = ['/app', '/app/recruitment/candidates', candidateUrl, '/app/recruitment/jobs', '/app/recruitment/interviews', '/app/recruitment/duplicates', '/app/recruitment/reports', '/app/recruitment/settings',
      '/app/hr/employees', employeeUrl, '/app/hr/leave', '/app/hr/reviews', '/app/hr/settings', '/app/kpi/definitions', '/app/kpi/values', '/app/kpi/scorecards', '/app/kpi/rewards'];
    for (const path of paths) {
      await app.goto(path);
      await expect(app.locator('main h1').first()).toBeVisible();
      await app.waitForTimeout(500);
      const r = await new AxeBuilder({ page: app }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(r.violations.map((v) => `${path}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
    }
  });

  test('detail pages fit a phone screen without horizontal scrolling', async () => {
    await app.setViewportSize({ width: 390, height: 800 });
    for (const path of [candidateUrl, employeeUrl, '/app/kpi/values', '/app/recruitment/candidates']) {
      await app.goto(path);
      await expect(app.locator('main h1').first()).toBeVisible();
      await app.waitForTimeout(300);
      const overflow = await app.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
