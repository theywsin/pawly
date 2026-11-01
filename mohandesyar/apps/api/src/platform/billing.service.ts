import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@mohandesyar/module-sdk/server';
import type { Config } from '../config.js';
import type { Database } from '../infra/db.js';
import type { Redis } from '../infra/redis.js';
import type { AuditService } from '../core/audit/audit.service.js';
import type { EntitlementService } from '../core/entitlement/entitlement.service.js';
import type { ModuleRegistry } from '../core/modules/registry.js';
import type { ModuleLifecycleService } from '../core/modules/lifecycle.service.js';
import type { NotificationService } from '../core/notifications/notification.service.js';
import { uuidv7 } from '../infra/ids.js';
import { logger } from '../infra/logger.js';
import { badRequest, conflict, forbidden, notFound } from '../core/http/errors.js';
import { callbackPaid, SEP_LIVE_BASE, SepClient, type SepCallback } from './sep.js';
import { SepSandbox } from './sep-sandbox.js';

export const billingSettingsSchema = z.object({
  /** VAT percent shown as a separate invoice line (0 = none). */
  vatPercent: z.number().min(0).max(100).multipleOf(0.01).default(0),
  /** Free trial for new organisations, in days (0 = none; null = the plan's own setting). */
  trialDays: z.number().int().min(0).max(365).nullable().default(null),
  gateway: z
    .object({
      enabled: z.boolean().default(false),
      terminalId: z.string().trim().regex(/^\d{0,20}$/, 'شماره ترمینال فقط رقم است').default(''),
      sandbox: z.boolean().default(false),
    })
    .default({ enabled: false, terminalId: '', sandbox: false }),
});
export type BillingSettings = z.infer<typeof billingSettingsSchema>;

export const purchaseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('subscription'), planKey: z.string().min(1).max(40), cycle: z.enum(['monthly', 'yearly']) }),
  z.object({ kind: z.literal('module'), moduleId: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/) }),
]);
export type PurchaseInput = z.infer<typeof purchaseSchema>;

export const modulePriceSchema = z.object({
  priceMonthly: z.number().int().nonnegative(),
  priceYearly: z.number().int().nonnegative().nullable().default(null),
  purchasable: z.boolean().default(true),
});

export interface Line {
  title: string;
  amount: string;
  moduleId?: string;
}
export interface Quote {
  kind: 'subscription' | 'module';
  planKey: string | null;
  moduleId: string | null;
  cycle: 'monthly' | 'yearly' | null;
  months: number;
  items: Line[];
  subtotal: bigint;
  vatPercent: number;
  vat: bigint;
  total: bigint;
  periodEnd: string | null;
}

const DAY = 86_400_000;
const addMonths = (d: Date, n: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
};
/** Started calendar months from `from` to `to` (a day of slack, so a fresh one-month period is one month). */
export function monthsUntil(from: Date, to: Date): number {
  let m = 1;
  while (m < 36 && addMonths(from, m).getTime() < to.getTime() - DAY) m++;
  return m;
}

/** VAT rounded half-up to whole rials. */
export function vatOf(subtotal: bigint, percent: number): bigint {
  const bp = BigInt(Math.round(percent * 100));
  return (subtotal * bp + 5000n) / 10000n;
}

/** What billing needs from the application (kept narrow so the services container can own it). */
export interface BillingDeps {
  config: Config;
  db: Database;
  redis: Redis;
  audit: AuditService;
  entitlement: EntitlementService;
  registry: ModuleRegistry;
  lifecycle: ModuleLifecycleService;
  notifications: NotificationService;
}

interface Who {
  tenantId: string;
  userId: string;
  companyId: string;
  companyIds: readonly string[];
}

/**
 * Plans and modules bought online (docs/09): quote → invoice → SEP payment → server-side verify → activation.
 * Activation is immediate after a verified payment (owner's decision, A60).
 */
export class BillingService {
  readonly sandbox: SepSandbox;

  constructor(private readonly s: BillingDeps) {
    this.sandbox = new SepSandbox(s.redis);
  }

  // ------------------------------------------------------------------ settings

  async settings(): Promise<BillingSettings> {
    const r = await this.s.db.app.execute(sql`SELECT value FROM platform_settings WHERE key = 'billing'`);
    return billingSettingsSchema.parse((r.rows[0] as { value: unknown } | undefined)?.value ?? {});
  }

  async setSettings(input: unknown, adminId: string): Promise<BillingSettings> {
    const v = billingSettingsSchema.parse(input);
    if (v.gateway.sandbox && !this.s.config.PAYMENT_SANDBOX) throw badRequest('SANDBOX_DISABLED', 'درگاه آزمایشی روی این سرور فعال نیست (PAYMENT_SANDBOX)');
    if (v.gateway.enabled && !v.gateway.terminalId && !v.gateway.sandbox) throw badRequest('VALIDATION_FAILED', 'شماره ترمینال درگاه را وارد کنید', [{ path: 'gateway.terminalId', message: 'شماره ترمینال را وارد کنید' }]);
    await this.s.db.app.execute(sql`INSERT INTO platform_settings (key, value) VALUES ('billing', ${JSON.stringify(v)}::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
    await this.s.audit.append({ tenantId: null, actorType: 'admin', actorId: adminId, action: 'billing.settings_saved', after: { ...v, gateway: { ...v.gateway, terminalId: v.gateway.terminalId ? '***' : '' } } });
    return v;
  }

  /** Public view: whether online payment is possible and the trial length (no terminal id). */
  async publicInfo() {
    const v = await this.settings();
    return { onlinePayment: v.gateway.enabled, vatPercent: v.vatPercent, trialDays: v.trialDays, sandbox: v.gateway.enabled && v.gateway.sandbox };
  }

  private async client(): Promise<SepClient> {
    const v = await this.settings();
    if (!v.gateway.enabled) throw conflict('GATEWAY_DISABLED', 'پرداخت آنلاین هنوز توسط مدیر سامانه فعال نشده است');
    if (v.gateway.sandbox) {
      if (!this.s.config.PAYMENT_SANDBOX) throw conflict('GATEWAY_DISABLED', 'درگاه آزمایشی روی این سرور فعال نیست');
      return new SepClient(v.gateway.terminalId || '0', `${this.origin()}/api/sandbox/sep`, this.sandbox.fetch());
    }
    return new SepClient(v.gateway.terminalId, SEP_LIVE_BASE);
  }

  private origin() {
    return this.s.config.PUBLIC_ORIGIN.replace(/\/$/, '');
  }

  // ------------------------------------------------------------------ module prices

  async modulePrices() {
    const r = await this.s.db.app.execute(sql`SELECT m.id AS module_id, m.name, m.state, p.price_monthly, p.price_yearly, coalesce(p.purchasable, false) AS purchasable
      FROM core_modules m LEFT JOIN core_module_prices p ON p.module_id = m.id WHERE m.state = 'installed' ORDER BY m.id`);
    return r.rows;
  }

  async setModulePrice(moduleId: string, input: z.infer<typeof modulePriceSchema>, adminId: string) {
    await this.s.db.app.execute(sql`INSERT INTO core_module_prices (module_id, price_monthly, price_yearly, purchasable) VALUES (${moduleId}, ${input.priceMonthly}, ${input.priceYearly}, ${input.purchasable})
      ON CONFLICT (module_id) DO UPDATE SET price_monthly = EXCLUDED.price_monthly, price_yearly = EXCLUDED.price_yearly, purchasable = EXCLUDED.purchasable, updated_at = now()`);
    await this.s.audit.append({ tenantId: null, actorType: 'admin', actorId: adminId, action: 'billing.module_price_saved', entityType: 'module', entityId: moduleId, after: input });
  }

  // ------------------------------------------------------------------ quotes & invoices

  private async subscription(tenantId: string, tx: Db | null = null) {
    const r = await (tx ?? this.s.db.app).execute(sql`SELECT s.*, (s.period_end > now()) AS current, p.name AS plan_name FROM core_subscriptions s JOIN core_plans p ON p.key = s.plan_key
      WHERE s.tenant_id = ${tenantId} ${tx ? sql`FOR UPDATE OF s` : sql``}`);
    return r.rows[0] as { plan_key: string; plan_name: string; status: string; period_start: string; period_end: string; current: boolean } | undefined;
  }

  /** Purchased modules that renew together with the subscription. */
  private async addons(tenantId: string) {
    const r = await this.s.db.app.execute(sql`SELECT a.module_id, a.valid_to, m.name, p.price_monthly, p.price_yearly, coalesce(p.purchasable, false) AS purchasable
      FROM core_subscription_addons a LEFT JOIN core_modules m ON m.id = a.module_id LEFT JOIN core_module_prices p ON p.module_id = a.module_id
      WHERE a.tenant_id = ${tenantId} AND a.valid_to IS NOT NULL ORDER BY a.module_id`);
    return r.rows as { module_id: string; valid_to: string; name: { fa?: string } | null; price_monthly: string | null; price_yearly: string | null; purchasable: boolean }[];
  }

  async quote(tenantId: string, input: PurchaseInput): Promise<Quote> {
    const settings = await this.settings();
    const items: Line[] = [];
    let months: number;
    let periodEnd: Date;
    if (input.kind === 'subscription') {
      const pr = await this.s.db.app.execute(sql`SELECT key, name, price_monthly, price_yearly FROM core_plans WHERE key = ${input.planKey} AND status = 'active' AND is_public`);
      const plan = pr.rows[0] as { key: string; name: string; price_monthly: string | null; price_yearly: string | null } | undefined;
      if (!plan) throw notFound('این پلن برای خرید در دسترس نیست');
      const price = input.cycle === 'yearly' ? plan.price_yearly : plan.price_monthly;
      if (price === null) throw conflict('NOT_FOR_SALE', input.cycle === 'yearly' ? 'این پلن قیمت سالانه ندارد' : 'این پلن قیمت ماهانه ندارد؛ با ما تماس بگیرید');
      months = input.cycle === 'yearly' ? 12 : 1;
      const cur = await this.subscription(tenantId);
      const extend = cur && cur.status === 'active' && cur.current && cur.plan_key === plan.key;
      periodEnd = addMonths(extend ? new Date(cur.period_end) : new Date(), months);
      items.push({ title: `اشتراک ${input.cycle === 'yearly' ? 'سالانه' : 'ماهانه'} پلن ${plan.name}`, amount: price });
      const inPlan = await this.s.db.app.execute(sql`SELECT module_id FROM core_plan_modules WHERE plan_key = ${plan.key} AND included`);
      const included = new Set((inPlan.rows as { module_id: string }[]).map((x) => x.module_id));
      for (const a of await this.addons(tenantId)) {
        if (included.has(a.module_id) || !a.purchasable || a.price_monthly === null) continue;
        const p = input.cycle === 'yearly' ? (a.price_yearly ?? String(BigInt(a.price_monthly) * 12n)) : a.price_monthly;
        items.push({ title: `تمدید ماژول ${a.name?.fa ?? a.module_id}`, amount: p, moduleId: a.module_id });
      }
    } else {
      const cur = await this.subscription(tenantId);
      if (!cur || cur.status !== 'active' || !cur.current) throw conflict('SUBSCRIPTION_REQUIRED', 'برای خرید ماژول ابتدا یکی از پلن‌ها را خریداری یا تمدید کنید');
      const ent = await this.s.entitlement.get(tenantId);
      if (ent.modules.has(input.moduleId)) throw conflict('ALREADY_OWNED', 'این ماژول در اشتراک شما وجود دارد');
      const pr = await this.s.db.app.execute(sql`SELECT p.price_monthly, m.name FROM core_module_prices p JOIN core_modules m ON m.id = p.module_id
        WHERE p.module_id = ${input.moduleId} AND p.purchasable AND m.state = 'installed' AND m.globally_enabled`);
      const mod = pr.rows[0] as { price_monthly: string; name: { fa?: string } } | undefined;
      if (!mod) throw notFound('این ماژول برای خرید در دسترس نیست');
      // Charged per started calendar month until the subscription ends, so it renews together with the plan.
      periodEnd = new Date(cur.period_end);
      months = monthsUntil(new Date(), periodEnd);
      items.push({ title: `ماژول ${mod.name.fa ?? input.moduleId} — ${months} ماه (تا پایان اشتراک فعلی)`, amount: String(BigInt(mod.price_monthly) * BigInt(months)), moduleId: input.moduleId });
    }
    const subtotal = items.reduce((t, i) => t + BigInt(i.amount), 0n);
    const vat = vatOf(subtotal, settings.vatPercent);
    return {
      kind: input.kind,
      planKey: input.kind === 'subscription' ? input.planKey : null,
      moduleId: input.kind === 'module' ? input.moduleId : null,
      cycle: input.kind === 'subscription' ? input.cycle : null,
      months,
      items,
      subtotal,
      vatPercent: settings.vatPercent,
      vat,
      total: subtotal + vat,
      periodEnd: periodEnd.toISOString(),
    };
  }

  static quoteJson(q: Quote) {
    return { ...q, subtotal: String(q.subtotal), vat: String(q.vat), total: String(q.total) };
  }

  async createInvoice(who: Who, input: PurchaseInput): Promise<{ id: string; number: number; total: string }> {
    const q = await this.quote(who.tenantId, input);
    const buyer = await this.s.db.tx({ tenantId: who.tenantId, companyIds: who.companyIds }, async (tx) => {
      const r = await tx.execute(sql`SELECT name, legal_name, national_id, economic_code, phone, address FROM core_companies WHERE id = ${who.companyId}`);
      return r.rows[0] ?? {};
    });
    // An unpaid invoice for the same purchase is replaced, so the list does not fill with abandoned ones.
    await this.s.db.app.execute(sql`UPDATE core_invoices SET status = 'canceled' WHERE tenant_id = ${who.tenantId} AND status = 'unpaid' AND kind = ${q.kind}
      AND coalesce(plan_key, '') = ${q.planKey ?? ''} AND coalesce(module_id, '') = ${q.moduleId ?? ''}
      AND NOT EXISTS (SELECT 1 FROM core_payments p WHERE p.invoice_id = core_invoices.id AND p.status = 'verifying')`);
    const id = uuidv7();
    const r = await this.s.db.app.execute(sql`INSERT INTO core_invoices (id, tenant_id, kind, plan_key, module_id, cycle, months, items, subtotal, vat_percent, vat, total, buyer, created_by)
      VALUES (${id}, ${who.tenantId}, ${q.kind}, ${q.planKey}, ${q.moduleId}, ${q.cycle}, ${q.months}, ${JSON.stringify(q.items)}::jsonb, ${String(q.subtotal)}, ${q.vatPercent}, ${String(q.vat)}, ${String(q.total)},
              ${JSON.stringify(buyer)}::jsonb, ${who.userId}) RETURNING number`);
    await this.s.audit.append({ tenantId: who.tenantId, actorType: 'user', actorId: who.userId, action: 'billing.invoice_created', entityType: 'invoice', entityId: id, after: { kind: q.kind, total: String(q.total) } });
    return { id, number: Number((r.rows[0] as { number: string }).number), total: String(q.total) };
  }

  // ------------------------------------------------------------------ payment

  /** Starts a bank payment for an unpaid invoice of the caller's organisation; returns where to send the payer. */
  async pay(who: Who, invoiceId: string, returnTo = '/app/billing'): Promise<{ payUrl: string; paymentId: string }> {
    const inv = await this.s.db.app.execute(sql`SELECT id, total, status FROM core_invoices WHERE id = ${invoiceId} AND tenant_id = ${who.tenantId}`);
    const row = inv.rows[0] as { id: string; total: string; status: string } | undefined;
    if (!row) throw notFound('فاکتور یافت نشد');
    if (row.status !== 'unpaid') throw conflict('INVOICE_NOT_UNPAID', row.status === 'paid' ? 'این فاکتور قبلاً پرداخت شده است' : 'این فاکتور لغو شده است؛ دوباره خرید را شروع کنید');
    const safeReturn = /^\/(app|auth)(\/[\w\-/]*)?$/.test(returnTo) ? returnTo : '/app/billing';
    const paymentId = uuidv7();
    if (BigInt(row.total) === 0n) {
      // Free plan: nothing to collect at the bank.
      await this.s.db.app.execute(sql`INSERT INTO core_payments (id, invoice_id, tenant_id, gateway, amount, status, return_to, created_by) VALUES (${paymentId}, ${row.id}, ${who.tenantId}, 'sep', 0, 'verifying', ${safeReturn}, ${who.userId})`);
      await this.fulfil(paymentId, { refNum: null, rrn: null, maskedPan: null, traceNo: null });
      return { payUrl: `${safeReturn}?payment=${paymentId}`, paymentId };
    }
    const client = await this.client();
    await this.s.db.app.execute(sql`INSERT INTO core_payments (id, invoice_id, tenant_id, gateway, amount, return_to, created_by) VALUES (${paymentId}, ${row.id}, ${who.tenantId}, 'sep', ${row.total}, ${safeReturn}, ${who.userId})`);
    const t = await client.token({ amount: BigInt(row.total), resNum: paymentId, redirectUrl: `${this.origin()}/api/public/payments/sep/callback` }).catch((err: unknown) => {
      logger.warn({ err }, 'SEP token request failed');
      return { ok: false as const, message: 'ارتباط با درگاه بانک برقرار نشد؛ کمی بعد دوباره تلاش کنید' };
    });
    if (!t.ok) {
      await this.s.db.app.execute(sql`UPDATE core_payments SET status = 'failed', error = ${t.message}, completed_at = now() WHERE id = ${paymentId}`);
      throw conflict('GATEWAY_ERROR', t.message);
    }
    await this.s.db.app.execute(sql`UPDATE core_payments SET token = ${t.token} WHERE id = ${paymentId}`);
    return { payUrl: client.payUrl(t.token), paymentId };
  }

  /**
   * Bank callback. Never trusts the posted fields: the payment is claimed once (pending → verifying), then
   * verified server-to-server and the verified amount compared with the invoice before anything is activated.
   * Returns the page to send the payer to.
   */
  async callback(fields: SepCallback): Promise<string> {
    const resNum = String(fields.ResNum ?? '');
    if (!z.uuid().safeParse(resNum).success) return '/app/billing?payment=unknown';
    const pr = await this.s.db.app.execute(sql`SELECT id, return_to, status FROM core_payments WHERE id = ${resNum}`);
    const p = pr.rows[0] as { id: string; return_to: string; status: string } | undefined;
    if (!p) return '/app/billing?payment=unknown';
    const back = `${p.return_to}?payment=${p.id}`;
    if (!callbackPaid(fields) || !fields.RefNum) {
      await this.s.db.app.execute(sql`UPDATE core_payments SET status = 'failed', error = ${fields.State === 'CanceledByUser' ? 'پرداخت توسط کاربر لغو شد' : 'پرداخت ناموفق بود'}, completed_at = now()
        WHERE id = ${p.id} AND status = 'pending'`);
      return back;
    }
    const claimed = await this.s.db.app
      .execute(sql`UPDATE core_payments SET status = 'verifying', ref_num = ${String(fields.RefNum).slice(0, 100)} WHERE id = ${p.id} AND status = 'pending' RETURNING id`)
      .catch(() => ({ rows: [] })); // the same RefNum used for another payment (unique) is refused
    if (!claimed.rows.length) return back; // already handled (repeated callback)
    await this.verify(p.id);
    return back;
  }

  /** Verifies a claimed payment with the bank; on success activates what was bought, otherwise reverses. */
  async verify(paymentId: string): Promise<void> {
    const pr = await this.s.db.app.execute(sql`SELECT id, amount, ref_num, status FROM core_payments WHERE id = ${paymentId}`);
    const p = pr.rows[0] as { id: string; amount: string; ref_num: string; status: string } | undefined;
    if (!p || p.status !== 'verifying' || !p.ref_num) return;
    const client = await this.client();
    let v;
    try {
      v = await client.verify(p.ref_num);
    } catch {
      return; // network failure: stays "verifying" and the reconcile job retries
    }
    if (v.ok && v.amount === BigInt(p.amount)) {
      await this.fulfil(p.id, { refNum: p.ref_num, rrn: v.rrn, maskedPan: v.maskedPan, traceNo: v.traceNo });
      return;
    }
    if (v.ok) await client.reverse(p.ref_num).catch(() => false); // verified but with a different amount: give the money back
    await this.s.db.app.execute(sql`UPDATE core_payments SET status = 'failed', completed_at = now(),
      error = ${v.ok ? 'مبلغ تأییدشده با مبلغ فاکتور یکسان نیست؛ مبلغ به حساب پرداخت‌کننده برگشت داده شد' : `تأیید بانک ناموفق بود${v.message ? `: ${v.message}` : ''}`}
      WHERE id = ${p.id} AND status = 'verifying'`);
  }

  /** Retries verification of payments whose verify call did not complete (runs with the scheduler). */
  async reconcile(): Promise<void> {
    const r = await this.s.db.app.execute(sql`SELECT id FROM core_payments WHERE status = 'verifying' AND ref_num IS NOT NULL
      AND created_at > now() - interval '25 minutes' AND created_at < now() - interval '1 minute' LIMIT 20`);
    for (const { id } of r.rows as { id: string }[]) await this.verify(id).catch(() => undefined);
    await this.s.db.app.execute(sql`UPDATE core_payments SET status = 'failed', error = 'پرداخت در مهلت تکمیل نشد', completed_at = now()
      WHERE status = 'pending' AND created_at < now() - interval '2 hours'`);
  }

  private async fulfil(paymentId: string, bank: { refNum: string | null; rrn: string | null; maskedPan: string | null; traceNo: string | null }): Promise<void> {
    const done = await this.s.db.app.transaction(async (raw) => {
      const tx = raw as unknown as Db;
      const pr = await tx.execute(sql`UPDATE core_payments SET status = 'paid', rrn = ${bank.rrn}, masked_pan = ${bank.maskedPan}, trace_no = ${bank.traceNo}, completed_at = now()
        WHERE id = ${paymentId} AND status = 'verifying' RETURNING invoice_id, tenant_id, created_by`);
      const pay = pr.rows[0] as { invoice_id: string; tenant_id: string; created_by: string | null } | undefined;
      if (!pay) return null;
      const ir = await tx.execute(sql`UPDATE core_invoices SET status = 'paid', paid_at = now() WHERE id = ${pay.invoice_id} AND status <> 'paid' RETURNING *`);
      const inv = ir.rows[0] as { id: string; kind: string; plan_key: string | null; module_id: string | null; months: number; items: Line[]; number: string } | undefined;
      if (!inv) return null;
      const t = pay.tenant_id;
      if (inv.kind === 'subscription') {
        const cur = await this.subscription(t, tx);
        const extend = cur && cur.status === 'active' && cur.current && cur.plan_key === inv.plan_key;
        const start = extend ? new Date(cur.period_start) : new Date();
        const end = addMonths(extend ? new Date(cur.period_end) : new Date(), inv.months);
        await tx.execute(sql`INSERT INTO core_subscriptions (id, tenant_id, plan_key, status, period_start, period_end, trial_end)
          VALUES (${uuidv7()}, ${t}, ${inv.plan_key}, 'active', ${start.toISOString()}, ${end.toISOString()}, NULL)
          ON CONFLICT (tenant_id) DO UPDATE SET plan_key = EXCLUDED.plan_key, status = 'active', period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end, trial_end = NULL, updated_at = now()`);
        const renewed = inv.items.flatMap((i) => (i.moduleId ? [i.moduleId] : []));
        if (renewed.length) {
          await tx.execute(sql`UPDATE core_subscription_addons SET valid_to = ${end.toISOString()} WHERE tenant_id = ${t} AND module_id = ANY (${`{${renewed.join(',')}}`}::text[])`);
        }
        await tx.execute(sql`UPDATE core_tenants SET status = 'active', updated_at = now() WHERE id = ${t} AND status IN ('trial', 'pending')`);
      } else {
        const cur = await this.subscription(t, tx);
        const until = cur?.period_end ?? addMonths(new Date(), inv.months).toISOString();
        await tx.execute(sql`INSERT INTO core_subscription_addons (tenant_id, module_id, price, valid_to) VALUES (${t}, ${inv.module_id}, ${inv.items[0]?.amount ?? null}, ${until})
          ON CONFLICT (tenant_id, module_id) DO UPDATE SET price = EXCLUDED.price, valid_to = GREATEST(core_subscription_addons.valid_to, EXCLUDED.valid_to)`);
      }
      await this.s.audit.append({ tenantId: t, actorType: 'system', actorId: null, action: 'billing.payment_verified', entityType: 'invoice', entityId: inv.id, after: { refNum: bank.refNum, rrn: bank.rrn } }, tx);
      return { tenantId: t, userId: pay.created_by, kind: inv.kind, moduleId: inv.module_id, number: inv.number };
    });
    if (!done) return;
    this.s.entitlement.invalidate(done.tenantId);
    this.s.registry.invalidate(done.tenantId);
    if (done.kind === 'module' && done.moduleId && done.userId) {
      // Bought modules are switched on right away (a missing dependency is reported on the modules page).
      await this.s.lifecycle.setTenant(done.tenantId, done.moduleId, true, { type: 'user', id: done.userId }).catch(() => undefined);
    }
    if (done.userId) {
      await this.s.notifications
        .notify({ tenantId: done.tenantId, userIds: [done.userId], type: 'billing.paid', title: `پرداخت فاکتور ${done.number} انجام شد`, body: done.kind === 'module' ? 'ماژول خریداری‌شده فعال شد.' : 'اشتراک سازمان فعال شد.', link: '/app/billing' })
        .catch(() => undefined);
    }
  }

  // ------------------------------------------------------------------ views

  async overview(tenantId: string) {
    const [sub, addons, invoices, ent, info] = await Promise.all([
      this.subscription(tenantId),
      this.addons(tenantId),
      this.s.db.app.execute(sql`SELECT i.id, i.number, i.kind, i.plan_key, i.module_id, i.total, i.status, i.created_at, i.paid_at FROM core_invoices i
        WHERE i.tenant_id = ${tenantId} AND i.status <> 'canceled' ORDER BY i.created_at DESC LIMIT 100`),
      this.s.entitlement.get(tenantId),
      this.publicInfo(),
    ]);
    const prices = await this.s.db.app.execute(sql`SELECT p.module_id, p.price_monthly, m.name FROM core_module_prices p JOIN core_modules m ON m.id = p.module_id
      WHERE p.purchasable AND m.state = 'installed' AND m.globally_enabled ORDER BY m.id`);
    return {
      subscription: sub ? { ...sub, effectiveStatus: ent.subscriptionStatus } : null,
      addons,
      invoices: invoices.rows,
      buyableModules: (prices.rows as { module_id: string }[]).map((m) => ({ ...m, owned: ent.modules.has(m.module_id) })),
      ...info,
    };
  }

  async invoice(tenantId: string | null, id: string) {
    const r = await this.s.db.app.execute(sql`SELECT i.*, t.name AS tenant_name FROM core_invoices i JOIN core_tenants t ON t.id = i.tenant_id
      WHERE i.id = ${id} ${tenantId ? sql`AND i.tenant_id = ${tenantId}` : sql``}`);
    const inv = r.rows[0];
    if (!inv) throw notFound('فاکتور یافت نشد');
    const payments = await this.s.db.app.execute(sql`SELECT id, status, amount, ref_num, rrn, trace_no, masked_pan, error, created_at, completed_at FROM core_payments WHERE invoice_id = ${id} ORDER BY created_at DESC`);
    return { ...(inv as object), payments: payments.rows };
  }

  async payment(tenantId: string, id: string) {
    const r = await this.s.db.app.execute(sql`SELECT p.id, p.status, p.amount, p.error, p.rrn, p.trace_no, p.completed_at, p.invoice_id, i.number, i.kind, i.module_id
      FROM core_payments p JOIN core_invoices i ON i.id = p.invoice_id WHERE p.id = ${id} AND p.tenant_id = ${tenantId}`);
    if (!r.rows[0]) throw notFound('پرداخت یافت نشد');
    return r.rows[0];
  }

  async adminPayments(filter: { status?: string; tenantId?: string }) {
    const r = await this.s.db.app.execute(sql`SELECT p.id, p.status, p.amount, p.ref_num, p.rrn, p.trace_no, p.masked_pan, p.error, p.created_at, p.completed_at,
        i.id AS invoice_id, i.number, i.kind, i.plan_key, i.module_id, t.id AS tenant_id, t.name AS tenant_name
      FROM core_payments p JOIN core_invoices i ON i.id = p.invoice_id JOIN core_tenants t ON t.id = p.tenant_id
      WHERE true ${filter.status ? sql`AND p.status = ${filter.status}` : sql``} ${filter.tenantId ? sql`AND p.tenant_id = ${filter.tenantId}` : sql``}
      ORDER BY p.created_at DESC LIMIT 500`);
    return r.rows;
  }

  /** Tenant-side guard: billing is managed by members with core.billing.manage. */
  static assertCan(can: boolean) {
    if (!can) throw forbidden();
  }
}
