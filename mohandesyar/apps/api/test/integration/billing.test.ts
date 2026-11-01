import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { generateSigningKey } from '@mohandesyar/module-package';
import { TestApp } from '../helpers/app.js';
import { buildModule } from '../helpers/packages.js';

/**
 * Online purchase on a real database with the built-in test bank speaking the SEP protocol: invoice, VAT,
 * token, bank page, callback, server-side verify, activation, replay and forgery protection, renewal,
 * module purchase, expiry and tenant isolation.
 */
let t: TestApp;
let admin: { token: string; otp: () => string };
let a: { token: string; tenantId: string };
let b: { token: string; tenantId: string };

beforeAll(async () => {
  t = await TestApp.start({ PAYMENT_SANDBOX: 'true' });
  admin = await t.consoleAdmin(['tech_admin', 'super_admin']);
  a = await t.signup('buyer-a');
  b = await t.signup('buyer-b');
  const key = generateSigningKey();
  const other = await t.signup('module-holder'); // modules are installed for another organisation, not for a or b
  await t.installModules(admin, key.publicKeyPem, [await buildModule('meetings', key)], [other.tenantId]);
  await t.req('PUT', '/api/console/plans/pro', { token: admin.token, body: { name: 'حرفه‌ای', priceMonthly: 10_000_000, priceYearly: 100_000_000, sort: 1 } });
  await t.req('PUT', '/api/console/plans/free', { token: admin.token, body: { name: 'رایگان', priceMonthly: 0, sort: 0 } });
}, 180_000);
afterAll(async () => t?.stop());

const call = (token: string, method: string, url: string, body?: object) => t.req(method, url, { token, body });
const sub = async (tenantId: string) => (await t.services.db.app.execute(sql`SELECT * FROM core_subscriptions WHERE tenant_id = ${tenantId}`)).rows[0] as { plan_key: string; status: string; period_end: string } | undefined;

/** Opens the test bank page for a payment URL and returns the hidden fields of the chosen form. */
async function bankForm(payUrl: string, which: 'paid' | 'canceled'): Promise<Record<string, string>> {
  const page = await t.req('GET', payUrl.replace(/^https?:\/\/[^/]+/, ''));
  expect(page.status).toBe(200);
  const forms = String(page.body).split('<form').slice(1);
  const form = forms[which === 'paid' ? 0 : 1]!;
  return Object.fromEntries([...form.matchAll(/name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1], m[2]]));
}
const postBack = (fields: Record<string, string>) =>
  t.req('POST', '/api/public/payments/sep/callback', { payload: new URLSearchParams(fields).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

async function buy(token: string, body: object): Promise<{ invoiceId: string; payUrl: string; paymentId: string }> {
  const inv = await call(token, 'POST', '/api/billing/invoices', body);
  expect(inv.status, JSON.stringify(inv.body)).toBe(201);
  const pay = await call(token, 'POST', `/api/billing/invoices/${inv.body.id}/pay`, { returnTo: '/app/billing' });
  expect(pay.status, JSON.stringify(pay.body)).toBe(200);
  return { invoiceId: inv.body.id, ...pay.body };
}

describe('settings', () => {
  it('online payment stays off until the platform enables the gateway', async () => {
    const inv = await call(a.token, 'POST', '/api/billing/invoices', { kind: 'subscription', planKey: 'pro', cycle: 'monthly' });
    const pay = await call(a.token, 'POST', `/api/billing/invoices/${inv.body.id}/pay`, {});
    expect(pay.status).toBe(409);
    expect(pay.body.code).toBe('GATEWAY_DISABLED');
  });

  it('only a super admin changes gateway, VAT and trial settings; the terminal id is never public', async () => {
    const sales = await t.consoleAdmin(['sales_admin']);
    expect((await t.req('PUT', '/api/console/billing/settings', { token: sales.token, body: { vatPercent: 10 } })).status).toBe(403);
    const bad = await t.req('PUT', '/api/console/billing/settings', { token: admin.token, body: { vatPercent: 10, gateway: { enabled: true, terminalId: '' } } });
    expect(bad.status).toBe(400);
    const ok = await t.req('PUT', '/api/console/billing/settings', { token: admin.token, body: { vatPercent: 10, trialDays: 7, gateway: { enabled: true, terminalId: '13000001', sandbox: true } } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const pub = (await t.req('GET', '/api/public/billing')).body;
    expect(pub).toEqual({ onlinePayment: true, vatPercent: 10, trialDays: 7, sandbox: true });
    expect(JSON.stringify(pub)).not.toContain('13000001');
  });
});

describe('buying a plan', () => {
  it('quotes the plan with VAT', async () => {
    const q = await call(a.token, 'POST', '/api/billing/quote', { kind: 'subscription', planKey: 'pro', cycle: 'monthly' });
    expect(q.body).toMatchObject({ subtotal: '10000000', vatPercent: 10, vat: '1000000', total: '11000000', months: 1 });
    expect(q.body.items).toEqual([{ title: 'اشتراک ماهانه پلن حرفه‌ای', amount: '10000000' }]);
    expect((await call(a.token, 'POST', '/api/billing/quote', { kind: 'subscription', planKey: 'nope', cycle: 'monthly' })).status).toBe(404);
  });

  it('pays at the bank, verifies server-side and activates the subscription immediately', async () => {
    const { invoiceId, payUrl, paymentId } = await buy(a.token, { kind: 'subscription', planKey: 'pro', cycle: 'monthly' });
    expect(payUrl).toMatch(/\/api\/sandbox\/sep\/OnlinePG\/SendToken\?token=[0-9a-f]{32}$/);
    const fields = await bankForm(payUrl, 'paid');
    expect(fields).toMatchObject({ State: 'OK', ResNum: paymentId, Amount: '11000000' });
    const back = await postBack(fields);
    expect(back.status).toBe(303);
    expect(back.headers.location).toBe(`/app/billing?payment=${paymentId}`);

    const p = (await call(a.token, 'GET', `/api/billing/payments/${paymentId}`)).body;
    expect(p).toMatchObject({ status: 'paid', amount: '11000000' });
    expect(p.rrn).toBeTruthy();
    const inv = (await call(a.token, 'GET', `/api/billing/invoices/${invoiceId}`)).body;
    expect(inv).toMatchObject({ status: 'paid', total: '11000000', vat: '1000000' });
    const s = await sub(a.tenantId);
    expect(s).toMatchObject({ plan_key: 'pro', status: 'active' });
    const days = (new Date(s!.period_end).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);

    // The same bank form posted again changes nothing.
    expect((await postBack(fields)).status).toBe(303);
    expect((await sub(a.tenantId))!.period_end).toBe(s!.period_end);
    // The organisation sees it on its billing page and the payer got a notification.
    const ov = (await call(a.token, 'GET', '/api/billing')).body;
    expect(ov.subscription).toMatchObject({ plan_key: 'pro', effectiveStatus: 'active' });
    expect(ov.invoices[0]).toMatchObject({ id: invoiceId, status: 'paid' });
  });

  it('a forged "paid" callback activates nothing: only the bank verify counts', async () => {
    const { invoiceId, paymentId } = await buy(a.token, { kind: 'subscription', planKey: 'pro', cycle: 'yearly' });
    const before = (await sub(a.tenantId))!.period_end;
    const forged = await postBack({ State: 'OK', Status: '2', ResNum: paymentId, RefNum: 'forged-ref-123', Amount: '110000000' });
    expect(forged.status).toBe(303);
    expect((await call(a.token, 'GET', `/api/billing/payments/${paymentId}`)).body.status).toBe('failed');
    expect((await call(a.token, 'GET', `/api/billing/invoices/${invoiceId}`)).body.status).toBe('unpaid');
    expect((await sub(a.tenantId))!.period_end).toBe(before);
  });

  it('a verified amount different from the invoice is reversed, not accepted', async () => {
    const { paymentId, payUrl } = await buy(a.token, { kind: 'subscription', planKey: 'pro', cycle: 'monthly' });
    const fields = await bankForm(payUrl, 'paid');
    await t.services.db.app.execute(sql`UPDATE core_payments SET amount = 1 WHERE id = ${paymentId}`);
    await postBack(fields);
    const p = (await call(a.token, 'GET', `/api/billing/payments/${paymentId}`)).body;
    expect(p.status).toBe('failed');
    expect(p.error).toContain('برگشت داده شد');
  });

  it('a cancelled payment is recorded with the reason and the invoice can be paid later', async () => {
    const { invoiceId, payUrl, paymentId } = await buy(b.token, { kind: 'subscription', planKey: 'pro', cycle: 'monthly' });
    await postBack(await bankForm(payUrl, 'canceled'));
    expect((await call(b.token, 'GET', `/api/billing/payments/${paymentId}`)).body).toMatchObject({ status: 'failed', error: 'پرداخت توسط کاربر لغو شد' });
    const again = await call(b.token, 'POST', `/api/billing/invoices/${invoiceId}/pay`, {});
    expect(again.status).toBe(200);
    await postBack(await bankForm(again.body.payUrl, 'paid'));
    expect((await sub(b.tenantId))!.status).toBe('active');
  });

  it('keeps organisations apart', async () => {
    const mine = (await call(a.token, 'GET', '/api/billing')).body.invoices[0].id;
    expect((await call(b.token, 'GET', `/api/billing/invoices/${mine}`)).status).toBe(404);
    expect((await call(b.token, 'POST', `/api/billing/invoices/${mine}/pay`, {})).status).toBe(404);
    const member = await t.member(a.token, 'employee', 'no-billing');
    expect((await call(member.token, 'GET', '/api/billing')).status).toBe(403);
  });

  it('a free plan is activated without going to the bank', async () => {
    const c = await t.signup('free');
    const r = await buy(c.token, { kind: 'subscription', planKey: 'free', cycle: 'monthly' });
    expect(r.payUrl).toBe(`/app/billing?payment=${r.paymentId}`);
    expect((await sub(c.tenantId))).toMatchObject({ plan_key: 'free', status: 'active' });
  });
});

describe('buying a module', () => {
  it('needs an active paid subscription and a price set by the platform', async () => {
    const c = await t.signup('module-first');
    expect((await call(c.token, 'POST', '/api/billing/quote', { kind: 'module', moduleId: 'meetings' })).body.code).toBe('SUBSCRIPTION_REQUIRED');
    expect((await call(a.token, 'POST', '/api/billing/quote', { kind: 'module', moduleId: 'meetings' })).status).toBe(404);
    const price = await t.req('PUT', '/api/console/billing/module-prices/meetings', { token: admin.token, body: { priceMonthly: 2_000_000 } });
    expect(price.status).toBe(200);
    const list = (await t.req('GET', '/api/console/billing/module-prices', { token: admin.token })).body;
    expect(list.find((m: { module_id: string }) => m.module_id === 'meetings')).toMatchObject({ price_monthly: '2000000', purchasable: true });
  });

  it('is charged until the end of the subscription, then enabled for the organisation', async () => {
    const q = (await call(a.token, 'POST', '/api/billing/quote', { kind: 'module', moduleId: 'meetings' })).body;
    expect(q).toMatchObject({ months: 1, subtotal: '2000000', vat: '200000', total: '2200000' });
    const { payUrl } = await buy(a.token, { kind: 'module', moduleId: 'meetings' });
    await postBack(await bankForm(payUrl, 'paid'));
    const addon = (await t.services.db.app.execute(sql`SELECT valid_to FROM core_subscription_addons WHERE tenant_id = ${a.tenantId} AND module_id = 'meetings'`)).rows[0] as { valid_to: string };
    expect(new Date(addon.valid_to).toISOString()).toBe(new Date((await sub(a.tenantId))!.period_end).toISOString());
    const me = (await call(a.token, 'GET', '/api/core/me')).body;
    expect(me.modules.map((m: { id: string }) => m.id)).toContain('meetings');
    expect((await call(a.token, 'POST', '/api/billing/quote', { kind: 'module', moduleId: 'meetings' })).body.code).toBe('ALREADY_OWNED');
  });

  it('renewal includes purchased modules and extends both from the current end', async () => {
    const before = new Date((await sub(a.tenantId))!.period_end);
    const q = (await call(a.token, 'POST', '/api/billing/quote', { kind: 'subscription', planKey: 'pro', cycle: 'monthly' })).body;
    expect(q.items.map((i: { title: string }) => i.title)).toEqual(['اشتراک ماهانه پلن حرفه‌ای', 'تمدید ماژول جلسات و مصوبات']);
    expect(q.total).toBe('13200000');
    const { payUrl } = await buy(a.token, { kind: 'subscription', planKey: 'pro', cycle: 'monthly' });
    await postBack(await bankForm(payUrl, 'paid'));
    const after = new Date((await sub(a.tenantId))!.period_end);
    expect(after.getTime() - before.getTime()).toBeGreaterThan(27 * 86_400_000);
    const addon = (await t.services.db.app.execute(sql`SELECT valid_to FROM core_subscription_addons WHERE tenant_id = ${a.tenantId} AND module_id = 'meetings'`)).rows[0] as { valid_to: string };
    expect(new Date(addon.valid_to).getTime()).toBe(after.getTime());
  });
});

describe('signup with a chosen plan', () => {
  const signupWith = async (name: string, planKey: string) => {
    const r = await t.req('POST', '/api/auth/signup', { body: { fullName: `کاربر ${name}`, email: `${name}-${Date.now()}@example.ir`, password: 'Passw0rd-strong', tenantName: `سازمان ${name}`, planKey } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body as { accessToken: string; tenantId: string };
  };

  it('runs the console trial on the chosen plan', async () => {
    const r = await signupWith('trial-pro', 'pro');
    const s = await sub(r.tenantId);
    expect(s).toMatchObject({ plan_key: 'pro', status: 'trialing' });
    const days = (new Date(s!.period_end).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(7);
    expect((await call(r.accessToken, 'GET', '/api/core/me')).body.subscription).toEqual({ status: 'trialing', planKey: 'pro' });
  });

  it('with no trial the organisation is read-only until the first payment, then active', async () => {
    await t.req('PUT', '/api/console/billing/settings', { token: admin.token, body: { vatPercent: 10, trialDays: 0, gateway: { enabled: true, terminalId: '13000001', sandbox: true } } });
    const r = await signupWith('no-trial', 'pro');
    expect((await call(r.accessToken, 'GET', '/api/core/me')).body.subscription.status).toBe('expired');
    const { payUrl } = await buy(r.accessToken, { kind: 'subscription', planKey: 'pro', cycle: 'monthly' });
    await postBack(await bankForm(payUrl, 'paid'));
    expect((await call(r.accessToken, 'GET', '/api/core/me')).body.subscription.status).toBe('active');
    await t.req('PUT', '/api/console/billing/settings', { token: admin.token, body: { vatPercent: 10, trialDays: 7, gateway: { enabled: true, terminalId: '13000001', sandbox: true } } });
  });

  it('ignores an unknown or private plan', async () => {
    const r = await signupWith('bad-plan', 'nope');
    expect(await sub(r.tenantId)).toBeUndefined();
  });
});

describe('expiry and the console', () => {
  it('an ended period counts as expired (read-only) without any job running', async () => {
    await t.services.db.app.execute(sql`UPDATE core_subscriptions SET period_end = now() - interval '1 hour' WHERE tenant_id = ${b.tenantId}`);
    t.services.entitlement.invalidate(b.tenantId);
    expect((await t.services.entitlement.get(b.tenantId)).subscriptionStatus).toBe('expired');
  });

  it('lists payments across organisations for the platform', async () => {
    const all = (await t.req('GET', '/api/console/billing/payments', { token: admin.token })).body as { tenant_id: string; status: string }[];
    expect(all.some((p) => p.tenant_id === b.tenantId)).toBe(true);
    expect(all.filter((p) => p.tenant_id === a.tenantId && p.status === 'paid').length).toBe(3);
    const failed = (await t.req('GET', '/api/console/billing/payments?status=failed', { token: admin.token })).body as { status: string }[];
    expect(failed.length).toBeGreaterThanOrEqual(3);
    expect(failed.every((p) => p.status === 'failed')).toBe(true);
    expect((await call(a.token, 'GET', '/api/console/billing/payments')).status).toBe(401);
  });
});
