import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DomainEvent } from '@mohandesyar/module-sdk/server';
import type { Database } from '../../infra/db.js';
import { uuidv7 } from '../../infra/ids.js';
import type { Redis } from '../../infra/redis.js';
import type { AuditService } from '../audit/audit.service.js';
import { decryptSecret, encryptSecret } from '../auth/crypto.js';
import type { Identity } from '../http/context.js';
import { badRequest, forbidden, notFound, unauthorized, ApiError } from '../http/errors.js';
import { buildIdentity, type IdentityDeps } from '../http/identity.js';
import type { ModuleRegistry } from '../modules/registry.js';
import { PermissionSet, type Grant } from '../rbac/permissions.js';
import { assertPublicTarget } from './net.js';

const KEY_RE = /^mk_([a-z0-9]{10})_([A-Za-z0-9_-]{32,64})$/;
export const RATE_PER_MINUTE = 600;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export const apiKeyInput = z.object({
  name: z.string().trim().min(2, 'نام کلید الزامی است').max(120),
  scopes: z.array(z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z0-9_*-]+)+$/)).min(1, 'دست‌کم یک مجوز انتخاب کنید').max(200),
  expiresInDays: z.number().int().min(1).max(730).nullable().default(365),
});
export const webhookInput = z.object({
  name: z.string().trim().min(2, 'نام الزامی است').max(120),
  url: z.string().trim().url('نشانی معتبر نیست').max(500),
  events: z.array(z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z0-9_-]+)+$/)).min(1, 'دست‌کم یک رویداد انتخاب کنید').max(100),
});

/** Signature header value for a delivery body: `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`. */
export function signature(secret: string, body: string, t: number) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

export interface IntegrationDeps extends IdentityDeps {
  redis: Redis;
  audit: AuditService;
  registry: ModuleRegistry;
}

/**
 * API keys (module REST APIs on behalf of a member, narrowed to explicit scopes) and webhooks (signed
 * event deliveries with retries). See migrations/core/0007_integrations.sql.
 */
export class IntegrationService {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;

  constructor(
    private readonly s: IntegrationDeps,
    private readonly opts: { encryptionKey: string; allowPrivate: boolean; onError: (err: unknown, ctx: Record<string, unknown>) => void },
  ) {}

  private get db(): Database {
    return this.s.db;
  }

  // ---------------------------------------------------------------- API keys

  async createKey(id: Identity, input: z.infer<typeof apiKeyInput>) {
    const scopes = [...new Set(input.scopes)];
    const missing = scopes.filter((k) => k.includes('*') || !id.permissions.can(k));
    if (missing.length) throw forbidden('SCOPE_NOT_HELD', `این مجوزها را خودتان ندارید یا مجاز نیستند: ${missing.join('، ')}`);
    const prefix = randomBytes(16).toString('base64url').replace(/[^a-z0-9]/g, '').padEnd(10, '0').slice(0, 10).toLowerCase();
    const secret = randomBytes(32).toString('base64url');
    const keyId = uuidv7();
    const expires = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString() : null;
    await this.db.tx({ tenantId: id.tenantId, companyIds: [id.companyId], userId: id.userId }, async (tx) => {
      await tx.execute(sql`INSERT INTO core_api_keys (id, tenant_id, company_id, user_id, name, prefix, secret_hash, scopes, expires_at)
        VALUES (${keyId}, ${id.tenantId}, ${id.companyId}, ${id.userId}, ${input.name}, ${prefix}, ${sha256(secret)}, ${`{${scopes.join(',')}}`}::text[], ${expires})`);
      await this.s.audit.append({ tenantId: id.tenantId, actorType: 'user', actorId: id.userId, action: 'core.api_key.created', entityType: 'api_key', entityId: keyId, after: { name: input.name, scopes, expires } }, tx);
    });
    return { id: keyId, key: `mk_${prefix}_${secret}`, expiresAt: expires };
  }

  listKeys(id: Identity) {
    return this.db.tx({ tenantId: id.tenantId, companyIds: [id.companyId] }, async (tx) =>
      (await tx.execute(sql`SELECT id, name, prefix, user_id, scopes, expires_at, last_used_at, revoked_at, created_at FROM core_api_keys
        WHERE company_id = ${id.companyId} ORDER BY revoked_at NULLS FIRST, created_at DESC`)).rows,
    );
  }

  async revokeKey(id: Identity, keyId: string) {
    await this.db.tx({ tenantId: id.tenantId, companyIds: [id.companyId] }, async (tx) => {
      const r = await tx.execute(sql`UPDATE core_api_keys SET revoked_at = now() WHERE id = ${keyId} AND revoked_at IS NULL RETURNING id`);
      if (!r.rows.length) throw notFound('کلید');
      await this.s.audit.append({ tenantId: id.tenantId, actorType: 'user', actorId: id.userId, action: 'core.api_key.revoked', entityType: 'api_key', entityId: keyId }, tx);
    });
  }

  /**
   * Authenticates `mk_…` bearer tokens: the creator's identity in the key's company, with permissions
   * reduced to the key's scopes (and each scope no wider than the creator holds it today).
   */
  async authenticate(token: string): Promise<Identity> {
    const m = KEY_RE.exec(token);
    if (!m) throw unauthorized('API_KEY_INVALID', 'کلید API معتبر نیست');
    const row = (await this.db.app.execute(sql`SELECT * FROM core_api_key_lookup(${m[1]!})`)).rows[0] as
      | { id: string; tenant_id: string; company_id: string; user_id: string; secret_hash: string; scopes: string[]; expires_at: string | null; revoked_at: string | null }
      | undefined;
    const given = Buffer.from(sha256(m[2]!), 'hex');
    if (!row || !timingSafeEqual(given, Buffer.from(row.secret_hash, 'hex'))) throw unauthorized('API_KEY_INVALID', 'کلید API معتبر نیست');
    if (row.revoked_at) throw unauthorized('API_KEY_REVOKED', 'این کلید API باطل شده است');
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) throw unauthorized('API_KEY_EXPIRED', 'مهلت این کلید API تمام شده است');
    const minute = Math.floor(Date.now() / 60_000);
    const n = await this.s.redis.incr(`apikey:${row.id}:${minute}`);
    if (n === 1) await this.s.redis.expire(`apikey:${row.id}:${minute}`, 120);
    if (n > RATE_PER_MINUTE) throw new ApiError(429, 'RATE_LIMITED', `حداکثر ${RATE_PER_MINUTE} درخواست در دقیقه برای هر کلید`);
    const base = await buildIdentity(this.s, { userId: row.user_id, tenantId: row.tenant_id, sessionId: `api-key:${row.id}`, amr: ['api_key'], companyHeader: row.company_id });
    const grants: Grant[] = [];
    for (const k of row.scopes) {
      const scope = base.permissions.bestScope(k);
      if (scope) grants.push({ permission: k, scope, companyId: row.company_id });
    }
    await this.db.app.execute(sql`SELECT core_api_key_touch(${row.id})`);
    return { ...base, companyIds: [row.company_id], allowedCompanyIds: [row.company_id], permissions: new PermissionSet(grants), grants };
  }

  // ---------------------------------------------------------------- webhooks

  /** Event types published by the tenant's active modules (what a webhook may subscribe to). */
  async eventTypes(tenantId: string) {
    const out: { type: string; moduleId: string }[] = [];
    for (const eff of await this.s.registry.effectiveFor(tenantId)) {
      const m = this.s.registry.loaded.get(eff.id);
      for (const e of m?.manifest.events.publishes ?? []) out.push({ type: e.type, moduleId: eff.id });
    }
    return out;
  }

  async createWebhook(id: Identity, input: z.infer<typeof webhookInput>) {
    try {
      await assertPublicTarget(input.url, this.opts.allowPrivate);
    } catch (e) {
      throw badRequest('WEBHOOK_URL', (e as Error).message);
    }
    const known = new Set((await this.eventTypes(id.tenantId)).map((e) => e.type));
    const unknown = input.events.filter((e) => !known.has(e));
    if (unknown.length) throw badRequest('WEBHOOK_EVENTS', `این رویدادها در ماژول‌های فعال نیستند: ${unknown.join('، ')}`);
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    const hookId = uuidv7();
    await this.db.tx({ tenantId: id.tenantId, companyIds: [id.companyId], userId: id.userId }, async (tx) => {
      await tx.execute(sql`INSERT INTO core_webhooks (id, tenant_id, company_id, name, url, events, secret_enc, created_by)
        VALUES (${hookId}, ${id.tenantId}, ${id.companyId}, ${input.name}, ${input.url}, ${`{${[...new Set(input.events)].join(',')}}`}::text[], ${encryptSecret(secret, this.opts.encryptionKey)}, ${id.userId})`);
      await this.s.audit.append({ tenantId: id.tenantId, actorType: 'user', actorId: id.userId, action: 'core.webhook.created', entityType: 'webhook', entityId: hookId, after: { name: input.name, url: input.url, events: input.events } }, tx);
    });
    return { id: hookId, secret };
  }

  listWebhooks(id: Identity) {
    return this.db.tx({ tenantId: id.tenantId, companyIds: [id.companyId] }, async (tx) =>
      (await tx.execute(sql`SELECT w.id, w.name, w.url, w.events, w.active, w.created_at,
          (SELECT count(*)::int FROM core_webhook_deliveries d WHERE d.webhook_id = w.id AND d.status = 'failed') AS failed,
          (SELECT max(d.delivered_at) FROM core_webhook_deliveries d WHERE d.webhook_id = w.id) AS last_delivered_at
        FROM core_webhooks w WHERE w.company_id = ${id.companyId} ORDER BY w.created_at DESC`)).rows,
    );
  }

  async setWebhookActive(id: Identity, hookId: string, active: boolean) {
    await this.db.tx({ tenantId: id.tenantId, companyIds: [id.companyId] }, async (tx) => {
      if (!(await tx.execute(sql`UPDATE core_webhooks SET active = ${active} WHERE id = ${hookId} RETURNING id`)).rows.length) throw notFound('وب‌هوک');
      await this.s.audit.append({ tenantId: id.tenantId, actorType: 'user', actorId: id.userId, action: active ? 'core.webhook.enabled' : 'core.webhook.disabled', entityType: 'webhook', entityId: hookId }, tx);
    });
  }

  async removeWebhook(id: Identity, hookId: string) {
    await this.db.tx({ tenantId: id.tenantId, companyIds: [id.companyId] }, async (tx) => {
      if (!(await tx.execute(sql`DELETE FROM core_webhooks WHERE id = ${hookId} RETURNING id`)).rows.length) throw notFound('وب‌هوک');
      await this.s.audit.append({ tenantId: id.tenantId, actorType: 'user', actorId: id.userId, action: 'core.webhook.deleted', entityType: 'webhook', entityId: hookId }, tx);
    });
  }

  deliveries(id: Identity, hookId: string) {
    return this.db.tx({ tenantId: id.tenantId, companyIds: [id.companyId] }, async (tx) =>
      (await tx.execute(sql`SELECT id, event_id, event_type, status, attempts, response_status, last_error, created_at, delivered_at FROM core_webhook_deliveries
        WHERE webhook_id = ${hookId} ORDER BY created_at DESC LIMIT 100`)).rows,
    );
  }

  /** Queues a `core.ping` delivery so the receiver can check the signature. */
  async ping(id: Identity, hookId: string) {
    await this.db.tx({ tenantId: id.tenantId, companyIds: [id.companyId] }, async (tx) => {
      if (!(await tx.execute(sql`SELECT 1 FROM core_webhooks WHERE id = ${hookId}`)).rows.length) throw notFound('وب‌هوک');
      const eventId = uuidv7();
      const body = JSON.stringify({ id: eventId, type: 'core.ping', occurredAt: new Date().toISOString(), companyId: id.companyId, data: {} });
      await tx.execute(sql`INSERT INTO core_webhook_deliveries (id, tenant_id, company_id, webhook_id, event_id, event_type, body) VALUES (${uuidv7()}, ${id.tenantId}, ${id.companyId}, ${hookId}, ${eventId}, 'core.ping', ${body})`);
    });
  }

  /** Event consumer: queues one delivery per active webhook of the event's company that subscribed to it. */
  async onEvent(event: DomainEvent): Promise<void> {
    if (!event.companyId) return;
    await this.db.tx({ tenantId: event.tenantId, companyIds: [event.companyId] }, async (tx) => {
      const hooks = (await tx.execute(sql`SELECT id FROM core_webhooks WHERE company_id = ${event.companyId} AND active AND ${event.type} = ANY (events)`)).rows as { id: string }[];
      const body = JSON.stringify({ id: event.id, type: event.type, version: event.version, occurredAt: event.occurredAt, companyId: event.companyId, data: event.payload });
      for (const h of hooks) {
        await tx.execute(sql`INSERT INTO core_webhook_deliveries (id, tenant_id, company_id, webhook_id, event_id, event_type, body)
          VALUES (${uuidv7()}, ${event.tenantId}, ${event.companyId}, ${h.id}, ${event.id}, ${event.type}, ${body}) ON CONFLICT (webhook_id, event_id) DO NOTHING`);
      }
    });
  }

  /** Sends due deliveries (10 s timeout; 2xx = success; up to 6 attempts with exponential backoff). */
  async sendOnce(limit = 20): Promise<number> {
    const due = (await this.db.app.execute(sql`SELECT * FROM core_webhook_claim(${limit})`)).rows as { id: string; event_id: string; event_type: string; body: string; url: string; secret_enc: string }[];
    for (const d of due) {
      let ok = false;
      let status: number | null = null;
      let error: string | null = null;
      try {
        await assertPublicTarget(d.url, this.opts.allowPrivate);
        const t = Math.floor(Date.now() / 1000);
        const res = await fetch(d.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'Mohandix-Webhook/1',
            'x-mohandix-event': d.event_type,
            'x-mohandix-delivery': d.id,
            'x-mohandix-signature': signature(decryptSecret(d.secret_enc, this.opts.encryptionKey), d.body, t),
          },
          body: d.body,
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        });
        status = res.status;
        ok = res.status >= 200 && res.status < 300;
        if (!ok) error = `HTTP ${res.status}`;
        await res.body?.cancel();
      } catch (e) {
        error = (e as Error).message;
      }
      await this.db.app.execute(sql`SELECT core_webhook_finish(${d.id}, ${ok}, ${status}, ${error})`);
    }
    return due.length;
  }

  start(intervalMs = 2000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.sendOnce()
        .catch((err) => this.opts.onError(err, { phase: 'webhooks' }))
        .finally(() => {
          this.running = null;
        });
    }, intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }
}
