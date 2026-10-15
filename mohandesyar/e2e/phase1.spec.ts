import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { totp } from './totp.js';

/**
 * Phase-1 exit criteria through the real UI (console + company app) against the real clustered server:
 *  (a) two independent tenants, data isolated
 *  (b) hello-module installed from the panel, enabled for one tenant, disabled, re-enabled — data preserved
 *  (c) an unsigned package is rejected
 *  (d) a failing migration is rolled back
 */

const PKGS = join(import.meta.dirname, '../.local/e2e/pkgs');
const ADMIN = { email: 'tech@platform.test', password: 'Admin-Passw0rd-e2e' };
let secret = '';
let admin: Page;
let tenantA: Page;
let tenantB: Page;
const stamp = Date.now();
const A = { name: `شرکت عمران الف ${stamp}`, email: `a-${stamp}@example.test` };
const B = { name: `مشاور سازه ب ${stamp}`, email: `b-${stamp}@example.test` };

/** A fresh code: wait for the next 30-second window if this one was already used. */
let lastCode = '';
async function freshCode(): Promise<string> {
  let c = totp(secret);
  while (c === lastCode) {
    await new Promise((r) => setTimeout(r, 1000));
    c = totp(secret);
  }
  lastCode = c;
  return c;
}

async function signup(browser: Browser, t: { name: string; email: string }): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/auth/signup');
  await page.getByLabel('نام و نام خانوادگی').fill('مدیر سازمان');
  await page.getByLabel('نام سازمان یا شرکت').fill(t.name);
  await page.getByLabel('ایمیل').fill(t.email);
  await page.getByLabel(/^رمز عبور/).fill('Passw0rd-strong');
  await page.getByLabel('تکرار رمز عبور').fill('Passw0rd-strong');
  await page.getByRole('button', { name: 'ساخت فضای کاری' }).click();
  // A new organisation lands on the first-run wizard (phase 2); skipping it opens the dashboard.
  await expect(page).toHaveURL(/\/app\/onboarding$/);
  await page.getByRole('button', { name: 'فعلاً رد شو' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'داشبورد' })).toBeVisible();
  return page;
}

async function uploadPackage(file: string) {
  await admin.goto('/console/modules/install');
  await admin.getByTestId('package-input').setInputFiles(join(PKGS, file));
  await admin.getByRole('button', { name: 'بارگذاری و بررسی' }).click();
}

async function confirmInstall() {
  await admin.getByRole('button', { name: 'ادامه' }).click();
  await admin.getByLabel('کد تأیید دومرحله‌ای').fill(await freshCode());
  await admin.getByRole('button', { name: 'نصب', exact: true }).click();
}

async function setTenant(tenantName: string, enable: boolean) {
  await admin.goto('/console/modules/hello-module');
  const label = `${enable ? 'فعال‌سازی' : 'غیرفعال‌سازی'} برای ${tenantName}`;
  // Right after an install the new code may still be rolling out to the second worker; retry briefly.
  await expect(async () => {
    await admin.getByRole('button', { name: label }).click();
    await expect(admin.getByRole('row', { name: new RegExp(tenantName) }).getByText(enable ? 'فعال' : 'غیرفعال', { exact: true })).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });
}

test.describe.serial('phase 1 — module system through the panel', () => {
  test.beforeAll(async ({ browser }) => {
    admin = await (await browser.newContext()).newPage();
  });

  test('platform admin must enrol TOTP before entering the console', async () => {
    await admin.goto('/console');
    await expect(admin).toHaveURL(/\/console\/login$/);
    await admin.getByLabel('ایمیل').fill(ADMIN.email);
    await admin.getByLabel('رمز عبور').fill(ADMIN.password);
    await admin.getByRole('button', { name: 'ادامه' }).click();
    await expect(admin.getByRole('heading', { name: 'فعال‌سازی تأیید دومرحله‌ای' })).toBeVisible();
    await admin.getByRole('button', { name: 'فعال‌سازی تأیید دومرحله‌ای' }).click();
    await expect(admin.getByRole('img', { name: 'کد QR تأیید دومرحله‌ای' })).toBeVisible();
    secret = ((await admin.locator('bdi[dir="ltr"].font-mono').first().textContent()) ?? '').trim();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await admin.getByLabel('کد ۶ رقمی').fill(await freshCode());
    await admin.getByRole('button', { name: 'تأیید' }).click();
    await expect(admin.getByRole('heading', { name: 'وضعیت سامانه' })).toBeVisible();
  });

  test('(c) an unsigned package is rejected and nothing is executed', async () => {
    await uploadPackage('hello-module-unsigned.mypkg');
    await expect(admin.getByText('بسته رد شد؛ هیچ کدی از آن اجرا نشده است.')).toBeVisible();
    await expect(admin.getByTestId('checks')).toContainText('بسته امضا نشده است');
    await expect(admin.getByRole('button', { name: 'ادامه' })).toHaveCount(0);
  });

  test('(d) a migration failing half-way is rolled back completely', async () => {
    await uploadPackage('hello-module-bad-migration.mypkg');
    await expect(admin.getByText('بسته معتبر و قابل نصب است.')).toBeVisible();
    await confirmInstall();
    await expect(admin.getByText('نصب انجام نشد')).toBeVisible();
    await expect(admin.getByTestId('operation-log')).toContainText('همه تغییرات برگردانده شد');
    await admin.goto('/console/modules');
    await expect(admin.getByText('هنوز ماژولی نصب نشده است')).toBeVisible();
  });

  test('(b) installs hello-module from the panel', async () => {
    await uploadPackage('hello-module-1.0.0.mypkg');
    await expect(admin.getByText('بسته معتبر و قابل نصب است.')).toBeVisible();
    await expect(admin.getByText('ماژول نمونه (سلام) — نسخه 1.0.0')).toBeVisible();
    await confirmInstall();
    await expect(admin.getByText('نصب انجام شد')).toBeVisible();
    await expect(admin.getByTestId('operation-log')).toContainText('بارگذاری آزمایشی کد بک‌اند');
    await admin.screenshot({ path: join(import.meta.dirname, '../.local/e2e-results/screens/console-install-result.png'), fullPage: true });
    // Rolling restart: both workers must report the module as loaded.
    await expect(async () => {
      await admin.goto('/console');
      const rows = admin.getByRole('row', { name: /hello-module/ });
      await expect(rows).toHaveCount(2, { timeout: 2000 });
      await expect(rows.filter({ hasText: 'بارگذاری شد' })).toHaveCount(2, { timeout: 2000 });
    }).toPass({ timeout: 60_000 });
  });

  test('(a) two independent tenants sign up', async ({ browser }) => {
    tenantA = await signup(browser, A);
    tenantB = await signup(browser, B);
    // Not enabled yet for anyone: no menu entry, direct URL refused.
    await expect(tenantA.getByRole('link', { name: 'یادداشت‌ها' })).toHaveCount(0);
    await tenantA.goto('/app/hello');
    await expect(tenantA.getByText('صفحه یافت نشد')).toBeVisible();
  });

  test('(b) enabled for tenant A only; A stores data through the module UI', async () => {
    await setTenant(A.name, true);
    await tenantA.goto('/app');
    await tenantA.getByRole('link', { name: 'یادداشت‌ها' }).click();
    await expect(tenantA.getByRole('heading', { name: 'یادداشت‌ها' })).toBeVisible();
    await expect(tenantA.getByText('هنوز یادداشتی ثبت نشده است')).toBeVisible();
    await tenantA.getByLabel('عنوان').fill('صورت‌جلسه بازدید کارگاه');
    await tenantA.getByLabel('متن').fill('بازدید از فونداسیون بلوک ۲');
    await tenantA.getByRole('button', { name: 'ثبت یادداشت' }).click();
    await expect(tenantA.getByRole('list', { name: 'فهرست یادداشت‌ها' }).getByText('صورت‌جلسه بازدید کارگاه')).toBeVisible();
    await tenantA.screenshot({ path: join(import.meta.dirname, '../.local/e2e-results/screens/tenant-notes.png') });
    // Dashboard widget provided by the module
    await tenantA.goto('/app');
    await expect(tenantA.getByRole('heading', { name: 'تعداد یادداشت‌ها' })).toBeVisible();
    await expect(tenantA.getByText('۱')).toBeVisible();
    await tenantA.screenshot({ path: join(import.meta.dirname, '../.local/e2e-results/screens/tenant-dashboard.png') });
    // Tenant B still has nothing
    await tenantB.reload();
    await expect(tenantB.getByRole('link', { name: 'یادداشت‌ها' })).toHaveCount(0);
  });

  test('(b) disabling for tenant A closes UI and API but keeps the data', async () => {
    await setTenant(A.name, false);
    await tenantA.goto('/app');
    await expect(tenantA.getByRole('link', { name: 'یادداشت‌ها' })).toHaveCount(0);
    await tenantA.goto('/app/hello');
    await expect(tenantA.getByText('صفحه یافت نشد')).toBeVisible();
    // Same session token the SPA uses: the module API itself refuses the tenant.
    const res = await tenantA.evaluate(async () => {
      const t = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'x-requested-with': 'mohandesyar' } }).then((r) => r.json());
      const r = await fetch('/api/m/hello-module/v1/notes', { headers: { authorization: `Bearer ${t.accessToken}` } });
      return { status: r.status, body: await r.json() };
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MODULE_DISABLED');
  });

  test('(b) re-enabling restores everything', async () => {
    await setTenant(A.name, true);
    await tenantA.goto('/app/hello');
    await expect(tenantA.getByRole('list', { name: 'فهرست یادداشت‌ها' }).getByText('صورت‌جلسه بازدید کارگاه')).toBeVisible();
  });

  test('(a) tenant B with the module enabled sees none of tenant A’s data', async () => {
    await setTenant(B.name, true);
    await tenantB.goto('/app/hello');
    await expect(tenantB.getByRole('heading', { name: 'یادداشت‌ها' })).toBeVisible();
    await expect(tenantB.getByText('هنوز یادداشتی ثبت نشده است')).toBeVisible();
    await expect(tenantB.getByText('صورت‌جلسه بازدید کارگاه')).toHaveCount(0);
    await tenantB.goto(`/app/search?q=${encodeURIComponent('صورت‌جلسه')}`);
    await expect(tenantB.getByText(/نتیجه‌ای برای/)).toBeVisible();
  });

  test('operation history and audit chain are recorded', async () => {
    await admin.goto('/console/modules/hello-module');
    for (const op of ['نصب', 'فعال‌سازی برای سازمان', 'غیرفعال‌سازی برای سازمان']) {
      await expect(admin.getByRole('cell', { name: op, exact: true }).first()).toBeVisible();
    }
    await admin.screenshot({ path: join(import.meta.dirname, '../.local/e2e-results/screens/console-module-detail.png'), fullPage: true });
    await admin.goto('/console/audit');
    await expect(admin.getByText('زنجیره هش گزارش رویدادها سالم است.')).toBeVisible();
    await expect(admin.getByText('module.package_rejected')).toBeVisible();
  });
});
