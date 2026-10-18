import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestApp } from '../helpers/app.js';

let t: TestApp;
let admin: { token: string; otp: () => string };

const oldToken = () => t.services.site.formToken(Date.now() - 10_000);

beforeAll(async () => {
  t = await TestApp.start();
  admin = await t.consoleAdmin(['super_admin', 'sales_admin']);
});
afterAll(async () => t?.stop());
beforeEach(async () => {
  const keys = await t.services.redis.keys('rl:lead:*');
  if (keys.length) await t.services.redis.del(...keys);
});

describe('public site data', () => {
  it('returns no plans, FAQ or contact until the platform publishes them (no placeholder content)', async () => {
    expect((await t.req('GET', '/api/public/plans')).body).toEqual([]);
    const site = await t.req('GET', '/api/public/site');
    expect(site.body).toMatchObject({ faq: [], contact: null, pages: { about: false, terms: false, privacy: false }, signupMode: 'open' });
    expect((await t.req('GET', '/api/public/pages/terms')).status).toBe(404);
  });

  it('lists only public, active plans, read from the database', async () => {
    const put = (key: string, body: object) => t.req('PUT', `/api/console/plans/${key}`, { token: admin.token, body });
    expect((await put('pro', { name: 'حرفه‌ای', priceMonthly: 12_000_000, userLimit: 50, sort: 2, modules: [{ moduleId: 'projects' }] })).status).toBe(200);
    await put('basic', { name: 'پایه', priceMonthly: null, userLimit: 5, sort: 1 });
    await put('internal', { name: 'داخلی', isPublic: false });
    const plans = (await t.req('GET', '/api/public/plans')).body;
    expect(plans.map((p: { key: string }) => p.key)).toEqual(['basic', 'pro']);
    expect(plans[1]).toMatchObject({ name: 'حرفه‌ای', price_monthly: '12000000', user_limit: 50 });
    expect(plans[1].modules[0]).toMatchObject({ moduleId: 'projects', installed: null });
    await t.req('POST', '/api/console/plans/basic/archive', { token: admin.token, body: { archived: true } });
    expect((await t.req('GET', '/api/public/plans')).body.map((p: { key: string }) => p.key)).toEqual(['pro']);
  });

  it('publishes FAQ, contact info and legal pages managed from the console', async () => {
    const f = await t.req('PUT', '/api/console/faq/new', { token: admin.token, body: { question: 'آیا داده‌ها روی سرور خودمان می‌ماند؟', answer: 'بله، سامانه خودمیزبان است.' } });
    expect(f.status).toBe(200);
    await t.req('PUT', '/api/console/faq/new', { token: admin.token, body: { question: 'پرسش منتشرنشده', answer: 'x', published: false } });
    expect((await t.req('PUT', '/api/console/faq/new', { token: admin.token, body: { question: 'ab', answer: '' } })).status).toBe(400);
    await t.req('PUT', '/api/console/content/contact', { token: admin.token, body: { phone: '021-88000000', email: 'info@example.ir' } });
    expect((await t.req('PUT', '/api/console/content/terms', { token: admin.token, body: { title: 'x', body: 'کوتاه' } })).status).toBe(400);
    await t.req('PUT', '/api/console/content/terms', { token: admin.token, body: { title: 'شرایط استفاده', body: 'متن کامل شرایط استفاده از سامانه.\n\nبند دوم.' } });
    const site = (await t.req('GET', '/api/public/site')).body;
    expect(site.faq.map((x: { question: string }) => x.question)).toEqual(['آیا داده‌ها روی سرور خودمان می‌ماند؟']);
    expect(site.contact).toEqual({ phone: '021-88000000', email: 'info@example.ir' });
    expect(site.pages.terms).toBe(true);
    expect((await t.req('GET', '/api/public/pages/terms')).body.title).toBe('شرایط استفاده');
    expect((await t.req('GET', '/api/public/pages/secrets')).status).toBe(404);
    // Tenant users cannot manage platform content.
    const user = await t.signup('content');
    expect((await t.req('PUT', '/api/console/faq/new', { token: user.token, body: { question: 'سؤال', answer: 'جواب' } })).status).toBe(401);
  });
});

describe('demo / contact leads with anti-spam', () => {
  const lead = (extra: object = {}) => ({ kind: 'demo', fullName: 'علی رضایی', company: 'شرکت ساختمانی نمونه', companySize: '11-50', phone: '۰۹۱۲ ۱۲۳ ۴۵۶۷', message: 'درخواست دمو', ...extra });

  it('accepts a valid request, normalises the phone and shows it in the console', async () => {
    const r = await t.req('POST', '/api/public/leads', { body: lead({ formToken: oldToken() }) });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const list = (await t.req('GET', '/api/console/leads', { token: admin.token })).body;
    expect(list[0]).toMatchObject({ full_name: 'علی رضایی', phone: '09121234567', status: 'new', kind: 'demo' });
    expect(list[0].ip_hash).toMatch(/^[0-9a-f]{32}$/);
    const id = list[0].id;
    await t.req('POST', `/api/console/leads/${id}`, { token: admin.token, body: { status: 'contacted', note: 'تماس گرفته شد؛ جلسه هفته بعد' } });
    const detail = (await t.req('GET', `/api/console/leads/${id}`, { token: admin.token })).body;
    expect(detail.status).toBe('contacted');
    expect(detail.notes[0].body).toBe('تماس گرفته شد؛ جلسه هفته بعد');
  });

  it('validates input in Persian', async () => {
    const r = await t.req('POST', '/api/public/leads', { body: { kind: 'demo', fullName: 'ع', formToken: oldToken() } });
    expect(r.status).toBe(400);
    expect(r.body.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['fullName', 'phone']));
    const badPhone = await t.req('POST', '/api/public/leads', { body: lead({ phone: '123', formToken: oldToken() }) });
    expect(badPhone.body.message).toBe('شماره تلفن معتبر نیست');
  });

  it('rejects forged, reused and expired tokens', async () => {
    expect((await t.req('POST', '/api/public/leads', { body: lead({ formToken: 'x.y.z-forged-token' }) })).body.code).toBe('FORM_TOKEN');
    const tok = oldToken();
    expect((await t.req('POST', '/api/public/leads', { body: lead({ formToken: tok }) })).status).toBe(201);
    expect((await t.req('POST', '/api/public/leads', { body: lead({ formToken: tok }) })).body.message).toBe('این فرم قبلاً ارسال شده است');
    const expired = t.services.site.formToken(Date.now() - 3 * 60 * 60 * 1000);
    expect((await t.req('POST', '/api/public/leads', { body: lead({ formToken: expired }) })).body.code).toBe('FORM_TOKEN');
  });

  it('stores bot-like submissions as spam with the same response, hidden from the default list', async () => {
    const fresh = (await t.req('GET', '/api/public/form-token')).body.token as string;
    const tooFast = await t.req('POST', '/api/public/leads', { body: lead({ fullName: 'ربات سریع', formToken: fresh }) });
    expect(tooFast.status).toBe(201);
    const honeypot = await t.req('POST', '/api/public/leads', { body: lead({ fullName: 'ربات تله', website: 'http://spam', formToken: oldToken() }) });
    expect(honeypot.status).toBe(201);
    const links = await t.req('POST', '/api/public/leads', { body: lead({ fullName: 'ربات لینک', message: 'http://a http://b http://c', formToken: oldToken() }) });
    expect(links.status).toBe(201);
    const normal = (await t.req('GET', '/api/console/leads', { token: admin.token })).body.map((l: { full_name: string }) => l.full_name);
    expect(normal).not.toContain('ربات سریع');
    const spam = (await t.req('GET', '/api/console/leads?status=spam', { token: admin.token })).body;
    expect(spam.map((l: { full_name: string }) => l.full_name).sort()).toEqual(['ربات تله', 'ربات سریع', 'ربات لینک'].sort());
  });

  it('rate-limits submissions per IP', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await t.req('POST', '/api/public/leads', { body: lead({ formToken: oldToken() }) })).status);
    expect(codes.slice(0, 5).every((c) => c === 201)).toBe(true);
    expect(codes[5]).toBe(429);
  });

  it('uses X-Forwarded-For only from a trusted proxy peer (TRUST_PROXY, default loopback/private)', async () => {
    const from = (ip: string) => t.req('POST', '/api/public/leads', { body: lead({ formToken: oldToken() }), headers: { 'x-forwarded-for': ip } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await from('203.0.113.1')).status);
    codes.push((await from('203.0.113.2')).status);
    expect(codes).toEqual([201, 201, 201, 201, 201, 201]);
    expect((await from('203.0.113.1')).status).toBe(429);
  });
});

describe('signup policy and onboarding', () => {
  const body = (n: string) => ({ fullName: 'مدیر', email: `${n}-${Date.now()}@example.ir`, password: 'Passw0rd-strong', tenantName: `سازمان ${n}` });

  it('closed mode refuses signup', async () => {
    await t.req('PUT', '/api/console/settings/signup', { token: admin.token, body: { mode: 'closed' } });
    const r = await t.req('POST', '/api/auth/signup', { body: body('closed') });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('SIGNUP_CLOSED');
    expect((await t.req('GET', '/api/public/site')).body.signupMode).toBe('closed');
  });

  it('approval mode creates a pending tenant that cannot log in until approved', async () => {
    await t.req('PUT', '/api/console/settings/signup', { token: admin.token, body: { mode: 'approval' } });
    const b = body('approval');
    const r = await t.req('POST', '/api/auth/signup', { body: b });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ pendingApproval: true });
    expect(r.body.accessToken).toBeUndefined();
    const login = await t.req('POST', '/api/auth/login', { body: { email: b.email, password: b.password } });
    expect(login.body.code).toBe('TENANT_PENDING');
    const tenants = (await t.req('GET', '/api/console/tenants', { token: admin.token })).body;
    expect(tenants.find((x: { id: string }) => x.id === r.body.tenantId).status).toBe('pending');
    expect((await t.req('POST', `/api/console/tenants/${r.body.tenantId}/approve`, { token: admin.token })).status).toBe(200);
    const ok = await t.req('POST', '/api/auth/login', { body: { email: b.email, password: b.password } });
    expect(ok.body.accessToken).toBeTruthy();
    await t.req('PUT', '/api/console/settings/signup', { token: admin.token, body: { mode: 'open' } });
  });

  it('walks through onboarding: company profile, preferences, completion', async () => {
    const u = await t.signup('onboard');
    const ob = (await t.req('GET', '/api/core/onboarding', { token: u.token })).body;
    expect(ob.completedAt).toBeNull();
    const cid = ob.company.id;
    const bad = await t.req('PUT', `/api/core/companies/${cid}`, { token: u.token, body: { name: 'شرکت', nationalId: '123' } });
    expect(bad.status).toBe(400);
    expect(bad.body.details[0].message).toContain('۱۱ رقم');
    const good = await t.req('PUT', `/api/core/companies/${cid}`, { token: u.token, body: { name: 'شرکت عمران پایدار', legalName: 'شرکت عمران پایدار (سهامی خاص)', nationalId: '۱۰۱۰۱۲۳۴۵۶۷', phone: '02188776655' } });
    expect(good.status).toBe(200);
    expect((await t.req('PUT', '/api/core/tenant', { token: u.token, body: { name: 'گروه پایدار', timezone: 'Mars/Base', numberStyle: 'fa' } })).status).toBe(400);
    expect((await t.req('PUT', '/api/core/tenant', { token: u.token, body: { name: 'گروه پایدار', timezone: 'Asia/Tehran', numberStyle: 'latn' } })).status).toBe(200);
    expect((await t.req('POST', '/api/core/onboarding/complete', { token: u.token })).status).toBe(200);
    const after = (await t.req('GET', '/api/core/onboarding', { token: u.token })).body;
    expect(after.completedAt).not.toBeNull();
    expect(after.company).toMatchObject({ name: 'شرکت عمران پایدار', national_id: '10101234567' });
    expect(after.tenant).toMatchObject({ name: 'گروه پایدار', number_style: 'latn' });
  });
});
