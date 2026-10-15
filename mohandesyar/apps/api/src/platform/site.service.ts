import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { normalizePhone } from '@mohandesyar/persian';
import type { Database } from '../infra/db.js';
import { uuidv7 } from '../infra/ids.js';
import type { Redis } from '../infra/redis.js';
import { rateLimit } from '../infra/redis.js';
import type { AuditService } from '../core/audit/audit.service.js';
import { badRequest, notFound, tooMany } from '../core/http/errors.js';

export type SignupMode = 'open' | 'approval' | 'closed';

export const contactSchema = z.object({
  phone: z.string().trim().max(40).optional(),
  email: z.email().optional().or(z.literal('')),
  address: z.string().trim().max(400).optional(),
  hours: z.string().trim().max(200).optional(),
});

export const pageSchema = z.object({
  title: z.string().trim().min(2).max(120),
  /** Plain text, paragraphs separated by blank lines. Never rendered as HTML. */
  body: z.string().trim().min(10).max(50_000),
});

export const faqSchema = z.object({
  question: z.string().trim().min(3, 'پرسش کوتاه است').max(300),
  answer: z.string().trim().min(1, 'پاسخ را وارد کنید').max(4000),
  sort: z.number().int().default(0),
  published: z.boolean().default(true),
});

export const leadSchema = z
  .object({
    kind: z.enum(['demo', 'contact']),
    fullName: z.string().trim().min(2, 'نام را وارد کنید').max(120),
    company: z.string().trim().max(160).optional(),
    companySize: z.enum(['1-10', '11-50', '51-200', '201-500', '500+']).optional(),
    phone: z.string().trim().max(40).optional(),
    email: z.email('ایمیل معتبر نیست').optional().or(z.literal('')),
    message: z.string().trim().max(2000, 'پیام حداکثر ۲۰۰۰ نویسه است').optional(),
    /** Honeypot: hidden from humans, must stay empty. */
    website: z.string().max(200).optional(),
    formToken: z.string().min(10).max(300),
  })
  .refine((v) => !!v.phone || !!v.email, { path: ['phone'], message: 'تلفن یا ایمیل را وارد کنید' });

const MIN_FILL_MS = 3_000;
const MAX_FILL_MS = 2 * 60 * 60 * 1000;

/**
 * Public site data (plans, FAQ, contact, legal pages) and lead intake. Anti-spam without any external
 * service (docs/05 §13): honeypot field, signed single-use form token with minimum/maximum fill time,
 * per-IP and global rate limits, and link-count heuristics (suspicious leads are kept but flagged).
 */
export class SiteService {
  constructor(
    private readonly db: Database,
    private readonly redis: Redis,
    private readonly audit: AuditService,
    private readonly secret: string,
  ) {}

  // ------------------------------------------------------------------ settings

  async signupMode(): Promise<SignupMode> {
    const r = await this.db.app.execute(sql`SELECT value FROM platform_settings WHERE key = 'signup'`);
    const mode = (r.rows[0] as { value: { mode?: SignupMode } } | undefined)?.value.mode;
    return mode === 'approval' || mode === 'closed' ? mode : 'open';
  }

  async setSignupMode(mode: SignupMode, adminId: string): Promise<void> {
    await this.db.app.execute(sql`INSERT INTO platform_settings (key, value) VALUES ('signup', ${JSON.stringify({ mode })}::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
    await this.audit.append({ tenantId: null, actorType: 'admin', actorId: adminId, action: 'platform.signup_mode', after: { mode } });
  }

  // ------------------------------------------------------------------ public reads

  async publicPlans() {
    const r = await this.db.app.execute(sql`
      SELECT p.key, p.name, p.description, p.price_monthly, p.price_yearly, p.user_limit, p.storage_gb, p.features, p.sort,
             coalesce(json_agg(json_build_object('moduleId', pm.module_id, 'included', pm.included, 'addonPrice', pm.addon_price,
                                                 'name', m.name, 'installed', m.state = 'installed')
                       ORDER BY pm.module_id) FILTER (WHERE pm.module_id IS NOT NULL), '[]') AS modules
        FROM core_plans p
        LEFT JOIN core_plan_modules pm ON pm.plan_key = p.key
        LEFT JOIN core_modules m ON m.id = pm.module_id
       WHERE p.is_public AND p.status = 'active'
       GROUP BY p.key ORDER BY p.sort, p.key`);
    return r.rows;
  }

  async publicSite() {
    const [faq, content, mode, modules] = await Promise.all([
      this.db.app.execute(sql`SELECT id, question, answer FROM platform_faq WHERE published ORDER BY sort, updated_at`),
      this.db.app.execute(sql`SELECT key, value FROM platform_content`),
      this.signupMode(),
      this.db.app.execute(sql`SELECT id, name, active_version FROM core_modules WHERE state = 'installed' AND globally_enabled ORDER BY id`),
    ]);
    const c = new Map((content.rows as { key: string; value: Record<string, unknown> }[]).map((x) => [x.key, x.value]));
    return {
      faq: faq.rows,
      contact: c.get('contact') ?? null,
      pages: Object.fromEntries(['about', 'terms', 'privacy'].map((k) => [k, c.has(k)])),
      signupMode: mode,
      availableModules: modules.rows,
    };
  }

  async page(key: string) {
    if (!['about', 'terms', 'privacy'].includes(key)) throw notFound();
    const r = await this.db.app.execute(sql`SELECT value, updated_at FROM platform_content WHERE key = ${key}`);
    const row = r.rows[0] as { value: z.infer<typeof pageSchema>; updated_at: string } | undefined;
    if (!row) throw notFound('این صفحه هنوز منتشر نشده است');
    return { ...row.value, updatedAt: row.updated_at };
  }

  // ------------------------------------------------------------------ content management

  async setContent(key: 'contact' | 'about' | 'terms' | 'privacy', value: unknown, adminId: string) {
    const parsed = key === 'contact' ? contactSchema.parse(value) : pageSchema.parse(value);
    await this.db.app.execute(sql`INSERT INTO platform_content (key, value, updated_by) VALUES (${key}, ${JSON.stringify(parsed)}::jsonb, ${adminId})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`);
    await this.audit.append({ tenantId: null, actorType: 'admin', actorId: adminId, action: 'site.content_saved', entityType: 'content', entityId: key });
    return parsed;
  }

  async deleteContent(key: string, adminId: string) {
    await this.db.app.execute(sql`DELETE FROM platform_content WHERE key = ${key}`);
    await this.audit.append({ tenantId: null, actorType: 'admin', actorId: adminId, action: 'site.content_removed', entityType: 'content', entityId: key });
  }

  async allContent() {
    return (await this.db.app.execute(sql`SELECT key, value, updated_at FROM platform_content`)).rows;
  }

  async listFaq() {
    return (await this.db.app.execute(sql`SELECT * FROM platform_faq ORDER BY sort, updated_at`)).rows;
  }

  async saveFaq(id: string | null, input: z.infer<typeof faqSchema>, adminId: string): Promise<string> {
    const fid = id ?? uuidv7();
    const r = await this.db.app.execute(sql`INSERT INTO platform_faq (id, question, answer, sort, published) VALUES (${fid}, ${input.question}, ${input.answer}, ${input.sort}, ${input.published})
      ON CONFLICT (id) DO UPDATE SET question = EXCLUDED.question, answer = EXCLUDED.answer, sort = EXCLUDED.sort, published = EXCLUDED.published, updated_at = now() RETURNING id`);
    if (!r.rows.length) throw notFound();
    await this.audit.append({ tenantId: null, actorType: 'admin', actorId: adminId, action: 'site.faq_saved', entityType: 'faq', entityId: fid });
    return fid;
  }

  async deleteFaq(id: string, adminId: string) {
    await this.db.app.execute(sql`DELETE FROM platform_faq WHERE id = ${id}`);
    await this.audit.append({ tenantId: null, actorType: 'admin', actorId: adminId, action: 'site.faq_deleted', entityType: 'faq', entityId: id });
  }

  // ------------------------------------------------------------------ leads

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(`form:${payload}`).digest('base64url');
  }

  /** A signed token carrying the issue time; the submission must arrive between 3 s and 2 h later, once. */
  formToken(now = Date.now()): string {
    const nonce = uuidv7();
    const payload = `${now}.${nonce}`;
    return `${payload}.${this.sign(payload)}`;
  }

  private async checkToken(token: string, now: number): Promise<string | null> {
    const parts = token.split('.');
    if (parts.length !== 3) return 'توکن فرم نامعتبر است';
    const [ts, nonce, sig] = parts as [string, string, string];
    const expected = Buffer.from(this.sign(`${ts}.${nonce}`));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'توکن فرم نامعتبر است';
    const age = now - Number(ts);
    if (!(age >= MIN_FILL_MS)) return 'too_fast';
    if (age > MAX_FILL_MS) return 'مهلت فرم تمام شده است؛ صفحه را دوباره بارگذاری کنید';
    const fresh = await this.redis.set(`formtoken:${nonce}`, '1', 'PX', MAX_FILL_MS, 'NX');
    if (fresh !== 'OK') return 'این فرم قبلاً ارسال شده است';
    return null;
  }

  async submitLead(input: unknown, meta: { ip?: string | null; userAgent?: string | null }, now = Date.now()): Promise<{ ok: true }> {
    const ip = meta.ip ?? 'unknown';
    if (!(await rateLimit(this.redis, `lead:ip:${ip}`, 5, 3600))) throw tooMany();
    if (!(await rateLimit(this.redis, 'lead:global', 300, 3600))) throw tooMany();
    const r = leadSchema.safeParse(input);
    if (!r.success) {
      throw badRequest('VALIDATION_FAILED', 'اطلاعات فرم معتبر نیست', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    const v = r.data;
    const phone = v.phone ? normalizePhone(v.phone) : null;
    if (v.phone && !phone) throw badRequest('VALIDATION_FAILED', 'شماره تلفن معتبر نیست', [{ path: 'phone', message: 'شماره تلفن معتبر نیست' }]);
    const tokenProblem = await this.checkToken(v.formToken, now);
    let spam: string | null = null;
    if (tokenProblem === 'too_fast') spam = 'فرم سریع‌تر از حد انسانی پر شده است';
    else if (tokenProblem) throw badRequest('FORM_TOKEN', tokenProblem);
    if (v.website) spam = 'فیلد پنهان پر شده است';
    const links = (v.message?.match(/https?:\/\//gi) ?? []).length;
    if (links > 2) spam = 'پیام حاوی پیوندهای متعدد است';
    const id = uuidv7();
    const ipHash = createHash('sha256').update(`${this.secret}:${ip}`).digest('hex').slice(0, 32);
    await this.db.app.execute(sql`INSERT INTO platform_leads (id, kind, full_name, company, company_size, phone, email, message, status, spam_reason, ip_hash, user_agent)
      VALUES (${id}, ${v.kind}, ${v.fullName}, ${v.company || null}, ${v.companySize ?? null}, ${phone}, ${v.email || null}, ${v.message || null},
              ${spam ? 'spam' : 'new'}, ${spam}, ${ipHash}, ${meta.userAgent?.slice(0, 300) ?? null})`);
    // Spam is stored (for review) but the response is identical, so bots learn nothing.
    return { ok: true };
  }

  async listLeads(filter: { status?: string; kind?: string }) {
    const r = await this.db.app.execute(sql`SELECT l.*, (SELECT count(*)::int FROM platform_lead_notes n WHERE n.lead_id = l.id) AS notes
      FROM platform_leads l WHERE true
      ${filter.status ? sql`AND l.status = ${filter.status}` : sql`AND l.status <> 'spam'`}
      ${filter.kind ? sql`AND l.kind = ${filter.kind}` : sql``}
      ORDER BY l.created_at DESC LIMIT 500`);
    return r.rows;
  }

  async lead(id: string) {
    const r = await this.db.app.execute(sql`SELECT * FROM platform_leads WHERE id = ${id}`);
    if (!r.rows[0]) throw notFound();
    const notes = await this.db.app.execute(sql`SELECT n.*, a.full_name AS admin_name FROM platform_lead_notes n JOIN platform_admins a ON a.id = n.admin_id
      WHERE n.lead_id = ${id} ORDER BY n.created_at`);
    return { ...(r.rows[0] as object), notes: notes.rows };
  }

  async updateLead(id: string, patch: { status?: string; note?: string }, adminId: string) {
    if (patch.status) {
      const r = await this.db.app.execute(sql`UPDATE platform_leads SET status = ${patch.status}, updated_at = now() WHERE id = ${id} RETURNING id`);
      if (!r.rows.length) throw notFound();
    }
    if (patch.note) {
      await this.db.app.execute(sql`INSERT INTO platform_lead_notes (id, lead_id, admin_id, body) VALUES (${uuidv7()}, ${id}, ${adminId}, ${patch.note})`);
      await this.db.app.execute(sql`UPDATE platform_leads SET updated_at = now() WHERE id = ${id}`);
    }
    await this.audit.append({ tenantId: null, actorType: 'admin', actorId: adminId, action: 'lead.updated', entityType: 'lead', entityId: id, after: { status: patch.status, note: !!patch.note } });
  }
}
