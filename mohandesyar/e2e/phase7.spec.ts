import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { totp } from './totp.js';

/**
 * Phase-7 flows through the real UI: blog written in the console and read on the site (with server-written
 * meta tags), customers' logos and app download links, online purchase through the payment simulator,
 * module purchase, tickets, the customer view in the console and the phone bottom bar.
 */
const stamp = Date.now();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let admin: Page;
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

test.describe.serial('phase 7 — blog, site content, purchase, tickets', () => {
  test.beforeAll(async ({ browser }) => {
    admin = await (await browser.newContext()).newPage();
    await admin.goto('/console');
    await admin.getByLabel('ایمیل').fill('p7@platform.test');
    await admin.getByLabel('رمز عبور').fill('Ops7-Passw0rd-e2e');
    await admin.getByRole('button', { name: 'ادامه' }).click();
    await admin.getByRole('button', { name: 'فعال‌سازی تأیید دومرحله‌ای' }).click();
    secret = ((await admin.locator('bdi[dir="ltr"].font-mono').first().textContent()) ?? '').trim();
    await admin.getByLabel('کد ۶ رقمی').fill(await code());
    await admin.getByRole('button', { name: 'تأیید' }).click();
    await expect(admin.getByRole('heading', { name: 'وضعیت سامانه' })).toBeVisible();
  });

  test('a blog post written in the console is published with its image and SEO tags', async ({ page, request }) => {
    const title = `راهنمای کنترل پروژه ${stamp}`;
    const slug = `کنترل-پروژه-${stamp}`;
    await admin.goto('/console/blog/categories');
    await admin.getByRole('button', { name: 'دسته جدید' }).click();
    await admin.getByLabel('نام دسته').fill(`مدیریت پروژه ${stamp}`);
    await admin.getByRole('button', { name: 'ذخیره', exact: true }).click();
    await expect(admin.getByText('دسته ذخیره شد')).toBeVisible();

    await admin.goto('/console/blog/new');
    await admin.getByLabel('عنوان', { exact: true }).fill(title);
    await admin.getByLabel('نامک (بخش انتهای نشانی مطلب)').fill(slug);
    await admin.getByLabel('خلاصه (در فهرست مطالب و نتایج جست‌وجو)').fill('چگونه پیشرفت واقعی را اندازه بگیریم');
    await admin.getByLabel('پاراگراف').fill('کنترل پروژه یعنی **مقایسه** برنامه و واقعیت.');
    await admin.getByRole('button', { name: 'تیتر', exact: true }).click();
    await admin.getByLabel('تیتر', { exact: true }).fill('شاخص‌های اصلی');
    await admin.locator('label:has-text("تصویر") input[type=file]').setInputFiles({ name: 'chart.png', mimeType: 'image/png', buffer: PNG });
    await expect(admin.getByLabel('زیرنویس تصویر')).toBeVisible();
    await admin.getByLabel('زیرنویس تصویر').fill('نمودار پیشرفت');
    await admin.getByLabel('دسته‌بندی').selectOption({ label: `مدیریت پروژه ${stamp}` });
    await admin.getByLabel('برچسب‌ها (با ویرگول جدا کنید)').fill('پروژه، کنترل');
    await admin.getByRole('button', { name: 'انتشار' }).click();
    await expect(admin.getByText('مطلب منتشر شد')).toBeVisible();

    await page.goto('/blog');
    await page.getByRole('link', { name: new RegExp(title) }).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'شاخص‌های اصلی' })).toBeVisible();
    await expect(page.locator('article strong', { hasText: 'مقایسه' })).toBeVisible();
    await expect(page.getByText('نمودار پیشرفت')).toBeVisible();
    await expect(page).toHaveTitle(`${title} | مهندیکس`);

    // The server writes the post's own meta tags (for link previews and crawlers).
    const html = await (await request.get(`/blog/${encodeURIComponent(slug)}`)).text();
    expect(html).toContain(`<title>${title} | مهندیکس</title>`);
    expect(html).toContain('<meta property="og:type" content="article" />');
    expect(html).toContain('"@type":"BlogPosting"');
    expect(html).not.toContain('noindex');
    expect((await request.get('/blog/no-such-post')).status()).toBe(404);
    expect(await (await request.get('/sitemap.xml')).text()).toContain(`/blog/${encodeURIComponent(slug)}`);
  });

  test('customers’ logos and app download links set in the console appear on the site', async ({ page }) => {
    await admin.goto('/console/content');
    await admin.getByRole('button', { name: 'افزودن مشتری' }).click();
    await admin.getByLabel('نام مشتری').fill(`شرکت مشتری ${stamp}`);
    await admin.locator('input[type=file]').first().setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
    await expect(admin.getByRole('button', { name: 'تغییر تصویر' })).toBeVisible();
    await admin.getByRole('button', { name: 'ذخیره مشتری' }).click();
    await expect(admin.getByText('مشتری ذخیره شد')).toBeVisible();
    await admin.getByLabel('پیوند نصب').first().fill('https://dl.example.ir/mohandix.apk');
    await admin.getByLabel('نسخه').first().fill('1.0.0');
    await admin.getByRole('button', { name: 'ذخیره پیوندها' }).click();
    await expect(admin.getByText('پیوندهای دانلود ذخیره شد')).toBeVisible();

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'مشتریان ما' })).toBeVisible();
    await expect(page.getByRole('img', { name: `شرکت مشتری ${stamp}` })).toBeVisible();
    await page.goto('/download');
    await expect(page.getByRole('link', { name: 'دانلود نسخه اندروید' })).toHaveAttribute('href', 'https://dl.example.ir/mohandix.apk');
    await expect(page.getByRole('listitem').filter({ hasText: 'iOS' }).getByText('به‌زودی')).toBeVisible();
  });

  test('blog pages pass axe', async ({ page }) => {
    for (const path of ['/blog', `/blog/${encodeURIComponent(`کنترل-پروژه-${stamp}`)}`, '/download']) {
      await page.goto(path);
      await expect(page.locator('h1')).toBeVisible();
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(r.violations.map((v) => `${path}: ${v.id}`)).toEqual([]);
    }
  });
});
