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
const PLAN_KEY = `p7${stamp}`;
const PLAN_NAME = `پلن فاز۷ ${stamp}`;
const ORG = `شرکت خریدار ${stamp}`;
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

  test('the platform sets the test gateway, VAT and prices in the console', async () => {
    await admin.goto('/console/plans');
    await admin.getByRole('button', { name: 'پلن جدید' }).click();
    await admin.getByLabel('شناسه (لاتین)').fill(PLAN_KEY);
    await admin.getByLabel('نام', { exact: true }).fill(PLAN_NAME);
    await admin.getByLabel('قیمت ماهانه (ریال)').fill('10000000');
    await admin.getByRole('button', { name: 'ذخیره' }).click();
    await expect(admin.getByText('پلن ذخیره شد')).toBeVisible();

    await admin.goto('/console/billing');
    await admin.getByRole('tab', { name: 'درگاه و تنظیمات' }).click();
    await admin.getByLabel('پرداخت آنلاین فعال باشد').check();
    await admin.getByLabel('درگاه آزمایشی (بدون پول واقعی؛ فقط برای آزمایش)').check();
    await admin.getByLabel('مالیات بر ارزش افزوده (درصد)').fill('10');
    await admin.getByLabel('دوره آزمایشی رایگان (روز)').fill('14');
    await admin.getByRole('button', { name: 'ذخیره تنظیمات' }).click();
    await expect(admin.getByText('تنظیمات پرداخت ذخیره شد')).toBeVisible();
    await expect(admin.getByLabel('نشانی بازگشت (برای ثبت در پنل پذیرندگی بانک)')).toHaveValue('http://127.0.0.1:3200/api/public/payments/sep/callback');

    await admin.getByRole('tab', { name: 'قیمت ماژول‌ها' }).click();
    await admin.getByLabel('قیمت ماهانه جلسات و مصوبات (ریال)').fill('2000000');
    await admin.getByRole('row', { name: /جلسات و مصوبات/ }).getByRole('button', { name: 'ذخیره' }).click();
    await expect(admin.getByText('قیمت جلسات و مصوبات ذخیره شد')).toBeVisible();
  });

  test('a visitor picks a plan, signs up, pays at the bank and the organisation is active', async ({ browser }) => {
    app = await (await browser.newContext()).newPage();
    await app.goto('/pricing');
    await app.getByRole('listitem').filter({ has: app.getByRole('heading', { name: PLAN_NAME }) }).getByRole('link', { name: 'خرید این پلن' }).click();
    await expect(app.getByText(`پلن انتخاب‌شده: ${PLAN_NAME}`)).toBeVisible();
    await app.getByLabel('نام و نام خانوادگی').fill('خریدار فاز ۷');
    await app.getByLabel('نام سازمان یا شرکت').fill(ORG);
    await app.getByLabel('ایمیل').fill(`p7-${stamp}@example.test`);
    await app.getByLabel(/^رمز عبور/).fill('Passw0rd-strong');
    await app.getByLabel('تکرار رمز عبور').fill('Passw0rd-strong');
    await app.getByRole('button', { name: 'ساخت فضای کاری' }).click();

    await expect(app).toHaveURL(/\/app\/billing\/checkout\?plan=/);
    await expect(app.getByText(`اشتراک ماهانه پلن ${PLAN_NAME}`)).toBeVisible();
    await expect(app.getByText('مالیات بر ارزش افزوده (۱۰٪)')).toBeVisible();
    await expect(app.getByText('۱٬۱۰۰٬۰۰۰ تومان')).toBeVisible();
    await app.getByRole('button', { name: 'پرداخت آنلاین' }).click();

    await expect(app.getByRole('heading', { name: 'درگاه پرداخت آزمایشی' })).toBeVisible();
    await expect(app.getByText('۱۱٬۰۰۰٬۰۰۰ ریال')).toBeVisible();
    await app.getByRole('button', { name: 'پرداخت موفق' }).click();

    await expect(app).toHaveURL(/\/app\/billing\?payment=/);
    await expect(app.getByText(/با موفقیت انجام شد و اشتراک سازمان فعال شد/)).toBeVisible();
    await expect(app.getByText('فعال', { exact: true })).toBeVisible();
    await app.getByRole('link', { name: /^[۰-۹]+$/ }).first().click();
    await expect(app.getByRole('heading', { name: /فاکتور فروش شماره/ })).toBeVisible();
    await expect(app.getByText('پرداخت‌شده')).toBeVisible();
    await expect(app.locator('article').getByText(ORG)).toBeVisible();
  });

  test('the organisation buys a module from its modules page and can use it right away', async () => {
    await app.goto('/app/settings/modules');
    await expect(app.getByText(/۲۰۰.۰۰۰ تومان در ماه/)).toBeVisible();
    await app.getByRole('link', { name: 'خرید ماژول' }).click();
    await expect(app.getByText(/ماژول جلسات و مصوبات/)).toBeVisible();
    await app.getByRole('button', { name: 'پرداخت آنلاین' }).click();
    await app.getByRole('button', { name: 'پرداخت موفق' }).click();
    await expect(app.getByText(/و ماژول فعال شد/)).toBeVisible();
    await app.goto('/app/tasks'); // (/app opens the onboarding wizard for a new organisation)
    await expect(app.getByRole('navigation', { name: 'منوی اصلی' }).getByRole('link', { name: /جلسات/ }).first()).toBeVisible();
  });

  test('a cancelled payment is reported and nothing changes', async () => {
    await app.goto(`/app/billing/checkout?plan=${PLAN_KEY}&cycle=monthly`);
    await app.getByRole('button', { name: 'پرداخت آنلاین' }).click();
    await app.getByRole('button', { name: 'انصراف از پرداخت' }).click();
    await expect(app.getByText(/پرداخت انجام نشد: پرداخت توسط کاربر لغو شد/)).toBeVisible();
  });

  test('the payment shows up in the console ledger', async () => {
    await admin.goto('/console/billing');
    const rows = admin.getByRole('row', { name: new RegExp(ORG) });
    await expect(rows.filter({ has: admin.getByText('موفق', { exact: true }) })).toHaveCount(2);
    await expect(rows.filter({ has: admin.getByText('ناموفق', { exact: true }) })).toHaveCount(1);
  });

  test('a member opens a ticket with an attachment; support answers from the console; the member sees it', async () => {
    await app.goto('/app/support');
    await app.getByRole('link', { name: 'تیکت جدید' }).click();
    await app.getByLabel('موضوع').fill(`خطا در گزارش ${stamp}`);
    await app.getByLabel('اولویت').selectOption({ label: 'فوری' });
    await app.getByLabel('شرح درخواست').fill('گزارش ماهانه باز نمی‌شود.');
    await app.getByLabel('افزودن پیوست').setInputFiles({ name: 'screenshot.png', mimeType: 'image/png', buffer: PNG });
    await expect(app.getByRole('list', { name: 'پیوست‌ها' }).getByText('screenshot.png')).toBeVisible();
    await app.getByRole('button', { name: 'ثبت تیکت' }).click();
    await expect(app.getByRole('heading', { name: `خطا در گزارش ${stamp}` })).toBeVisible();
    await expect(app.getByText('در انتظار پاسخ')).toBeVisible();

    await admin.goto('/console/support');
    await admin.getByRole('link', { name: `خطا در گزارش ${stamp}` }).click();
    await expect(admin.getByRole('button', { name: /screenshot\.png/ })).toBeVisible();
    await admin.getByLabel('پاسخ', { exact: true }).fill('برطرف شد؛ صفحه را تازه کنید.');
    await admin.getByRole('button', { name: 'ارسال پاسخ' }).click();
    await expect(admin.getByText('پاسخ ارسال شد')).toBeVisible();

    await app.reload();
    await expect(app.getByText('برطرف شد؛ صفحه را تازه کنید.')).toBeVisible();
    await expect(app.getByText('پاسخ داده شد')).toBeVisible();
  });

  test('the console customer page shows the organisation, its people, payments and tickets', async () => {
    await admin.goto('/console/tenants');
    await admin.getByRole('link', { name: ORG }).click();
    await expect(admin.getByRole('heading', { level: 1, name: ORG })).toBeVisible();
    await expect(admin.getByText(`${PLAN_NAME} — فعال`)).toBeVisible();
    await admin.getByRole('tab', { name: /کاربران/ }).click();
    await expect(admin.getByRole('cell', { name: `p7-${stamp}@example.test` })).toBeVisible();
    await admin.getByRole('tab', { name: /فاکتور و پرداخت/ }).click();
    await expect(admin.getByText('پرداخت‌شده').first()).toBeVisible();
    await admin.getByRole('tab', { name: 'تیکت‌ها' }).click();
    await expect(admin.getByRole('link', { name: `خطا در گزارش ${stamp}` })).toBeVisible();
  });

  test('blog pages pass axe', async ({ page }) => {
    for (const path of ['/blog', `/blog/${encodeURIComponent(`کنترل-پروژه-${stamp}`)}`, '/download', '/pricing']) {
      await page.goto(path);
      await expect(page.locator('h1')).toBeVisible();
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(r.violations.map((v) => `${path}: ${v.id}`)).toEqual([]);
    }
  });
});
