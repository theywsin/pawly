import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { totp } from './totp.js';

/**
 * Phase-6 key flows through the real UI with qhse and holding pre-installed: an incident report, the
 * incidents report run on screen, saved with a schedule and sent to the inbox as Excel, the holding
 * comparison, an API key shown once, axe and phone-width checks.
 */
const stamp = Date.now();
const ORG = `پیمانکار فاز۶ ${stamp}`;
let admin: Page;
let app: Page;
let secret = '';
let last = '';
let incidentUrl = '';
async function code() {
  let c = totp(secret);
  while (c === last) {
    await new Promise((r) => setTimeout(r, 1000));
    c = totp(secret);
  }
  return (last = c);
}
const dialog = (p: Page) => p.getByRole('dialog');

test.describe.serial('phase 6 — QHSE, holding, reports and integrations', () => {
  test.beforeAll(async ({ browser }) => {
    app = await (await browser.newContext()).newPage();
    await app.goto('/auth/signup');
    await app.getByLabel('نام و نام خانوادگی').fill('مدیر ایمنی');
    await app.getByLabel('نام سازمان یا شرکت').fill(ORG);
    await app.getByLabel('ایمیل').fill(`p6-${stamp}@example.test`);
    await app.getByLabel(/^رمز عبور/).fill('Passw0rd-strong');
    await app.getByLabel('تکرار رمز عبور').fill('Passw0rd-strong');
    await app.getByRole('button', { name: 'ساخت فضای کاری' }).click();
    await app.getByRole('button', { name: 'فعلاً رد شو' }).click();
    await expect(app).toHaveURL(/\/app$/);

    admin = await (await browser.newContext()).newPage();
    await admin.goto('/console');
    await admin.getByLabel('ایمیل').fill('p6@platform.test');
    await admin.getByLabel('رمز عبور').fill('Ops6-Passw0rd-e2e');
    await admin.getByRole('button', { name: 'ادامه' }).click();
    await admin.getByRole('button', { name: 'فعال‌سازی تأیید دومرحله‌ای' }).click();
    secret = ((await admin.locator('bdi[dir="ltr"].font-mono').first().textContent()) ?? '').trim();
    await admin.getByLabel('کد ۶ رقمی').fill(await code());
    await admin.getByRole('button', { name: 'تأیید' }).click();
    await expect(admin.getByRole('heading', { name: 'وضعیت سامانه' })).toBeVisible();
  });

  test('qhse and holding are enabled for the organisation', async () => {
    for (const id of ['qhse', 'holding']) {
      await admin.goto(`/console/modules/${id}`);
      await expect(async () => {
        await admin.getByRole('button', { name: `فعال‌سازی برای ${ORG}` }).click();
        await expect(admin.getByRole('row', { name: new RegExp(ORG) }).getByText('فعال', { exact: true })).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 30_000 });
    }
    await app.goto('/app');
    for (const name of ['QHSE', 'هلدینگ']) await expect(app.getByRole('link', { name, exact: true })).toBeVisible();
  });

  test('a near miss is reported and investigated', async () => {
    await app.goto('/app/qhse/incidents');
    await app.getByRole('button', { name: 'گزارش حادثه' }).click();
    const d = dialog(app);
    await d.getByLabel(/^عنوان/).fill('سقوط ابزار از طبقه سوم');
    await d.getByLabel(/^ساعت/).fill('25:00');
    await d.getByRole('button', { name: 'ثبت گزارش' }).click();
    await expect(d.getByText('ساعت را به شکل ۱۴:۳۰ وارد کنید', { exact: true })).toBeVisible();
    await d.getByLabel(/^ساعت/).fill('10:15');
    await d.getByRole('button', { name: 'ثبت گزارش' }).click();
    await expect(app.getByRole('heading', { level: 1, name: /حادثه ۱ — سقوط ابزار/ })).toBeVisible();
    incidentUrl = app.url();
    await app.getByRole('button', { name: 'بررسی و بستن' }).click();
    await dialog(app).getByLabel('وضعیت').selectOption('closed');
    await dialog(app).getByLabel('علت ریشه‌ای').fill('کوتاه');
    await dialog(app).getByRole('button', { name: 'ذخیره' }).click();
    await expect(dialog(app).getByText(/علت ریشه‌ای را/).first()).toBeVisible();
    await dialog(app).getByLabel('علت ریشه‌ای').fill('نبود پاخور و توری حفاظتی لبه طبقه');
    await dialog(app).getByRole('button', { name: 'ذخیره' }).click();
    await expect(app.getByText('بسته', { exact: true })).toBeVisible();
  });

  test('a report runs on screen, is saved with a schedule and arrives in the inbox as Excel', async () => {
    await app.goto('/app/reports');
    await app.getByLabel('گزارش', { exact: true }).selectOption({ label: 'فهرست حوادث — کیفیت، ایمنی، بهداشت و محیط‌زیست' });
    await app.getByLabel('بازه').selectOption('last_7_days');
    await app.getByRole('button', { name: 'اجرا' }).click();
    await expect(app.getByRole('cell', { name: 'سقوط ابزار از طبقه سوم' })).toBeVisible();
    await app.getByRole('button', { name: 'ذخیره و زمان‌بندی' }).click();
    await dialog(app).getByLabel(/^نام/).fill('حوادث هفتگی');
    await dialog(app).getByLabel('ارسال خودکار').selectOption('weekly');
    await dialog(app).getByRole('button', { name: 'ذخیره' }).click();
    await app.getByRole('tab', { name: 'گزارش‌های ذخیره‌شده' }).click();
    const row = app.getByRole('row', { name: /حوادث هفتگی/ });
    await expect(row).toContainText('هفتگی');
    await row.getByRole('button', { name: 'ارسال اکنون' }).click();
    await expect(app.getByText('برای ۱ گیرنده ارسال شد')).toBeVisible();
    await app.getByRole('tab', { name: 'گزارش‌های دریافتی' }).click();
    await expect(app.getByRole('row', { name: /حوادث هفتگی/ })).toContainText('۱ ردیف');
    const download = app.waitForEvent('download');
    await app.getByRole('button', { name: 'دانلود حوادث هفتگی' }).first().click();
    // Headless Chromium names any non-ASCII download "download", so the name is checked in the header the
    // server sends (RFC 6266 UTF-8 filename*, with an ASCII fallback).
    const dl = await download;
    const res = await app.request.get(dl.url());
    expect(res.status()).toBe(200);
    expect(res.headers()['content-disposition']).toContain(`filename*=UTF-8''${encodeURIComponent('حوادث هفتگی')}`);
    expect(res.headers()['content-disposition']).toMatch(/\.xlsx"?;|\.xlsx$/);
    expect((await res.body()).subarray(0, 2).toString()).toBe('PK');
  });

  test('holding compares the organisation\'s companies from live indicators', async () => {
    await app.goto('/app/holding');
    await app.getByLabel('تعداد شبه‌حوادث گزارش‌شده در دوره').check();
    await app.getByRole('button', { name: 'مقایسه' }).click();
    const total = app.getByRole('row', { name: /کل هلدینگ/ });
    await expect(total).toContainText('۱');
    await expect(total).toContainText('جمع');
  });

  test('an API key is created with chosen permissions and shown once', async () => {
    await app.goto('/app/settings/integrations');
    await app.getByRole('button', { name: 'کلید جدید' }).click();
    await dialog(app).getByLabel(/^نام \(سامانه/).fill('سامانه ایمنی پیمانکار');
    await dialog(app).getByLabel(/مشاهده QHSE/).check();
    await dialog(app).getByRole('button', { name: 'ساخت' }).click();
    await expect(dialog(app).getByText('این کلید فقط همین یک بار نمایش داده می‌شود؛ آن را در جای امن ذخیره کنید.')).toBeVisible();
    const key = (await dialog(app).locator('bdi.font-mono').textContent())!;
    expect(key).toMatch(/^mk_[a-z0-9]{10}_/);
    await dialog(app).getByRole('button', { name: 'بستم و ذخیره کردم' }).click();
    await expect(app.getByRole('row', { name: /سامانه ایمنی پیمانکار/ })).toContainText('qhse.view');
    // The key works against the module API, and only there.
    const ok = await app.request.get('/api/m/qhse/v1/risks', { headers: { authorization: `Bearer ${key}` } });
    const denied = await app.request.get('/api/m/qhse/v1/incidents', { headers: { authorization: `Bearer ${key}` } }); // needs qhse.incident.report, not granted
    expect(denied.status()).toBe(403);
    expect(ok.status()).toBe(200);
    const core = await app.request.get('/api/core/me', { headers: { authorization: `Bearer ${key}` } });
    expect(core.status()).toBe(403);
  });

  test('new pages pass axe (WCAG 2.1 AA)', async () => {
    const paths = ['/app/qhse/incidents', incidentUrl, '/app/qhse/actions', '/app/qhse/ncrs', '/app/qhse/inspections', '/app/qhse/risks', '/app/qhse/training', '/app/qhse/report', '/app/qhse/settings',
      '/app/holding/compare', '/app/reports', '/app/reports?tab=saved', '/app/reports?tab=inbox', '/app/settings/integrations'];
    for (const path of paths) {
      await app.goto(path);
      await expect(app.locator('main h1').first()).toBeVisible();
      await app.waitForTimeout(500);
      const r = await new AxeBuilder({ page: app }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(r.violations.map((v) => `${path}: ${v.id} ${v.nodes.map((n) => `${n.target.join(' ')} ${n.html.slice(0, 120)} ${n.failureSummary ?? ''}`).slice(0, 3).join(' | ')}`)).toEqual([]);
    }
  });

  test('pages fit a phone screen without horizontal scrolling', async () => {
    await app.setViewportSize({ width: 390, height: 800 });
    for (const path of [incidentUrl, '/app/qhse/report', '/app/holding/compare', '/app/reports?tab=saved', '/app/settings/integrations']) {
      await app.goto(path);
      await expect(app.locator('main h1').first()).toBeVisible();
      await app.waitForTimeout(300);
      const overflow = await app.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
