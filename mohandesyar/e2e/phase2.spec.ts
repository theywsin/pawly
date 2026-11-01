import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { totp } from './totp.js';

/**
 * Phase-2 exit checks through the real UI against the real clustered server:
 * prerendered public pages (readable without JS), console-managed plans/FAQ/contact shown on the site,
 * contact form → lead in the console, Dot-Web credits, signup → onboarding wizard, signup approval mode,
 * accessibility (axe, light and dark) and no horizontal overflow on a phone viewport.
 */

const ADMIN = { email: 'sales@platform.test', password: 'Sales-Passw0rd-e2e' };
const stamp = Date.now();
const PUBLIC_PAGES = ['/', '/pricing', '/modules', '/modules/projects', '/download', '/contact', '/terms', '/privacy', '/about'];
let admin: Page;
let secret = '';
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

test.describe('public site without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('pages are prerendered with title, description, canonical and content', async ({ page }) => {
    for (const path of ['/', '/pricing', '/modules/finance', '/download']) {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.locator('h1').first()).toBeVisible();
      expect(await page.locator('meta[name="description"]').getAttribute('content')).toBeTruthy();
      expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe(`http://127.0.0.1:3200${path === '/' ? '/' : path}`);
    }
    await page.goto('/');
    expect(await page.locator('script[type="application/ld+json"]').count()).toBe(1);
  });

  test('sitemap, robots and noindex app shell', async ({ request }) => {
    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).toContain('<loc>http://127.0.0.1:3200/pricing</loc>');
    expect(sitemap).not.toContain('/app');
    expect(await (await request.get('/robots.txt')).text()).toContain('Sitemap: http://127.0.0.1:3200/sitemap.xml');
    expect(await (await request.get('/app')).text()).toContain('<meta name="robots" content="noindex"');
    const page404 = await request.get('/no-such-page');
    expect(await page404.text()).toContain('noindex');
  });
});

test.describe.serial('phase 2 — console-managed site, leads, signup', () => {
  test.beforeAll(async ({ browser }) => {
    admin = await (await browser.newContext()).newPage();
    await admin.goto('/console');
    await admin.getByLabel('ایمیل').fill(ADMIN.email);
    await admin.getByLabel('رمز عبور').fill(ADMIN.password);
    await admin.getByRole('button', { name: 'ادامه' }).click();
    await admin.getByRole('button', { name: 'فعال‌سازی تأیید دومرحله‌ای' }).click();
    secret = ((await admin.locator('bdi[dir="ltr"].font-mono').first().textContent()) ?? '').trim();
    await admin.getByLabel('کد ۶ رقمی').fill(await freshCode());
    await admin.getByRole('button', { name: 'تأیید' }).click();
    await expect(admin.getByRole('heading', { name: 'وضعیت سامانه' })).toBeVisible();
  });

  test('without plans the pricing page sends visitors to the contact page (no invented prices)', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByText('پلن‌های اشتراک هنوز منتشر نشده‌اند.')).toBeVisible();
  });

  test('a plan, an FAQ entry and contact details created in the console appear on the site', async ({ page }) => {
    await admin.goto('/console/plans');
    await admin.getByRole('button', { name: 'پلن جدید' }).click();
    await admin.getByLabel('شناسه (لاتین)').fill('starter');
    await admin.getByLabel('نام', { exact: true }).fill(`پایه ${stamp}`);
    await admin.getByLabel('قیمت ماهانه (ریال)').fill('25000000');
    await admin.getByLabel('سقف کاربر').fill('10');
    await admin.getByRole('button', { name: 'ذخیره' }).click();
    await expect(admin.getByText('پلن ذخیره شد')).toBeVisible();

    await admin.goto('/console/content');
    await admin.getByRole('button', { name: 'پرسش جدید' }).click();
    await admin.getByLabel('پرسش', { exact: true }).fill(`آیا داده‌ها روی سرور خودمان نصب می‌شود؟ ${stamp}`);
    await admin.getByLabel('پاسخ', { exact: true }).fill('بله، امکان نصب روی سرور سازمان وجود دارد.');
    await admin.getByRole('button', { name: 'ذخیره' }).first().click();
    await admin.getByLabel('تلفن').fill('021-88001234');
    await admin.getByLabel('ساعات پاسخ‌گویی').fill('شنبه تا چهارشنبه ۹ تا ۱۷');
    await admin.getByRole('button', { name: 'ذخیره', exact: true }).last().click();
    await expect(admin.getByText('اطلاعات تماس ذخیره شد')).toBeVisible();

    await page.goto('/pricing');
    await expect(page.getByRole('heading', { name: `پایه ${stamp}` })).toBeVisible();
    await expect(page.getByText('۲٬۵۰۰٬۰۰۰ تومان').first()).toBeVisible();
    await page.goto('/');
    await expect(page.getByText(`آیا داده‌ها روی سرور خودمان نصب می‌شود؟ ${stamp}`)).toBeVisible();
    await page.goto('/contact');
    await expect(page.getByRole('main').getByText('021-88001234')).toBeVisible();
  });

  test('contact request: validation, then the lead reaches the console', async ({ page }) => {
    await page.goto('/contact');
    const form = page.getByRole('form', { name: 'فرم تماس' });
    await expect(form.getByRole('button', { name: 'ارسال پیام' })).toBeEnabled();
    await form.getByRole('button', { name: 'ارسال پیام' }).click();
    await expect(form.getByText(/نام/).filter({ hasText: /وارد|کوتاه|حداقل/ }).first()).toBeVisible();
    await form.getByLabel('نام و نام خانوادگی').fill(`متقاضی ${stamp}`);
    await form.getByLabel('شماره تماس').fill('۰۹۱۲۱۲۳۴۵۶۷');
    await form.getByLabel('پیام').fill('پرسش درباره پلن‌ها');
    await page.waitForTimeout(3500); // the server stores faster-than-human submissions as spam
    await form.getByRole('button', { name: 'ارسال پیام' }).click();
    await expect(page.getByText('درخواست شما ثبت شد.')).toBeVisible();

    await admin.goto('/console/leads');
    const row = admin.getByRole('row', { name: new RegExp(`متقاضی ${stamp}`) });
    await expect(row).toBeVisible();
    await expect(row).toContainText('09121234567');
  });

  test('home shows the Dot-Web credits instead of a demo request; old demo links go to the plans', async ({ page }) => {
    await page.goto('/');
    const credits = page.locator('#credits');
    await expect(credits.getByRole('link', { name: 'آژانس دات وب' })).toHaveAttribute('href', 'https://dot-web.ir/');
    await expect(credits.getByRole('link', { name: '۰۹۱۱۸۲۲۰۹۴۳' })).toHaveAttribute('href', 'tel:09118220943');
    await expect(page.getByRole('contentinfo')).toContainText('طراحی شده توسط شرکت دات وب');
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'dot-web.ir' })).toHaveAttribute('href', 'https://dot-web.ir/');
    await expect(page.getByText('درخواست دمو')).toHaveCount(0);
    await page.goto('/demo');
    await expect(page).toHaveURL(/\/pricing$/);
  });

  test('signup opens the onboarding wizard; finishing it lands on the dashboard', async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto('/auth/signup');
    await page.getByLabel('نام و نام خانوادگی').fill('مدیر سازمان');
    await page.getByLabel('نام سازمان یا شرکت').fill(`پیمانکاری ${stamp}`);
    await page.getByLabel('ایمیل').fill(`open-${stamp}@example.test`);
    await page.getByLabel(/^رمز عبور/).fill('Passw0rd-strong');
    await page.getByLabel('تکرار رمز عبور').fill('Passw0rd-strong');
    await page.getByRole('button', { name: 'ساخت فضای کاری' }).click();
    await expect(page).toHaveURL(/\/app\/onboarding$/);
    await page.getByLabel('شناسه ملی').fill('123');
    await page.getByRole('button', { name: 'ذخیره و ادامه' }).click();
    await expect(page.getByText(/۱۱ رقم/).first()).toBeVisible();
    await page.getByLabel('شناسه ملی').fill('');
    await page.getByLabel('تلفن').fill('021-44556677');
    await page.getByRole('button', { name: 'ذخیره و ادامه' }).click();
    await page.getByRole('button', { name: 'ذخیره و ادامه' }).click();
    await page.getByRole('button', { name: 'ادامه' }).click();
    await page.getByRole('button', { name: 'پایان و ورود به داشبورد' }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('heading', { name: 'داشبورد' })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/\/app$/);
  });

  test('approval mode: the organisation waits until a platform admin approves it', async ({ browser }) => {
    await admin.goto('/console/tenants');
    await admin.getByLabel('حالت').selectOption('approval');
    await expect(admin.getByLabel('حالت')).toHaveValue('approval');

    const page = await (await browser.newContext()).newPage();
    const name = `انبوه‌سازی ${stamp}`;
    const email = `approval-${stamp}@example.test`;
    await page.goto('/auth/signup');
    await page.getByLabel('نام و نام خانوادگی').fill('مدیر انبوه‌سازی');
    await page.getByLabel('نام سازمان یا شرکت').fill(name);
    await page.getByLabel('ایمیل').fill(email);
    await page.getByLabel(/^رمز عبور/).fill('Passw0rd-strong');
    await page.getByLabel('تکرار رمز عبور').fill('Passw0rd-strong');
    await page.getByRole('button', { name: 'ساخت فضای کاری' }).click();
    await expect(page.getByText(/پس از تأیید مدیر سامانه فعال می‌شود/)).toBeVisible();

    const login = async () => {
      await page.goto('/auth/login');
      await page.getByLabel('ایمیل').fill(email);
      await page.getByLabel('رمز عبور').fill('Passw0rd-strong');
      await page.getByRole('button', { name: 'ورود', exact: true }).click();
    };
    await login();
    await expect(page.getByText(/در انتظار تأیید/)).toBeVisible();

    await admin.reload();
    await admin.getByRole('button', { name: `تأیید ${name}` }).click();
    await expect(admin.getByRole('button', { name: `تأیید ${name}` })).toHaveCount(0);
    await login();
    await expect(page).toHaveURL(/\/app\/onboarding$/);

    await admin.getByLabel('حالت').selectOption('open');
    await expect(admin.getByLabel('حالت')).toHaveValue('open');
  });
});

test.describe('accessibility and responsive layout', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`axe finds no violations on public pages (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const path of [...PUBLIC_PAGES, '/auth/login', '/auth/signup']) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(r.violations.map((v) => `${path}: ${v.id} (${v.nodes.length})`)).toEqual([]);
      }
    });
  }

  test('no horizontal overflow at 360px; mobile menu opens and closes', async ({ browser }) => {
    const page = await (await browser.newContext({ viewport: { width: 360, height: 740 } })).newPage();
    for (const path of PUBLIC_PAGES) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
    await page.goto('/');
    await page.getByRole('button', { name: 'باز کردن منو' }).click();
    await expect(page.getByRole('navigation', { name: 'منوی موبایل' }).getByRole('link', { name: 'قیمت‌ها' })).toBeVisible();
    await page.getByRole('button', { name: 'بستن منو' }).click();
    await expect(page.getByRole('navigation', { name: 'منوی موبایل' })).toHaveCount(0);
  });
});
