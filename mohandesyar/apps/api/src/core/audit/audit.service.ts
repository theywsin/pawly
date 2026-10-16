import type { Database, Db } from '../../infra/db.js';
import { sql } from 'drizzle-orm';

export interface AuditInput {
  tenantId: string | null;
  actorType: 'user' | 'admin' | 'system' | 'support';
  actorId: string | null;
  action: string;
  moduleId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

const SENSITIVE_KEYS = /pass|secret|token|totp|national_?id|salary|iban|sheba|card/i;

/** Masks sensitive fields before they reach the audit log (docs/10 §4). */
export function maskSensitive(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(maskSensitive);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SENSITIVE_KEYS.test(k) ? '***' : maskSensitive(x)]));
  }
  return v;
}

export class AuditService {
  constructor(private readonly db: Database) {}

  /** Appends through the SECURITY DEFINER chain function; pass `tx` to make the entry part of a transaction. */
  async append(e: AuditInput, tx?: Db): Promise<void> {
    const runner = tx ?? this.db.app;
    const j = (x: unknown) => (x === undefined ? null : JSON.stringify(maskSensitive(x)));
    await runner.execute(sql`SELECT core_audit_append(${e.tenantId}::uuid, ${e.actorType}, ${e.actorId}::uuid, ${e.action}, ${e.moduleId ?? null},
      ${e.entityType ?? null}, ${e.entityId ?? null}, ${j(e.before)}::jsonb, ${j(e.after)}::jsonb, ${e.ip ?? null})`);
  }

  async listForTenant(tenantId: string, limit = 100, before?: number) {
    return this.db.tx({ tenantId }, async (tx) => {
      const r = await tx.execute(sql`SELECT id, actor_type, actor_id, action, module_id, entity_type, entity_id, before, after, ip, at
        FROM core_audit_log WHERE ${before ? sql`id < ${before}` : sql`true`} ORDER BY id DESC LIMIT ${limit}`);
      return r.rows;
    });
  }

  async verifyChain(): Promise<number | null> {
    const r = await this.db.app.execute(sql`SELECT core_audit_verify() AS broken`);
    return (r.rows[0] as { broken: number | null }).broken;
  }
}
