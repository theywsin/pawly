import { sql } from 'drizzle-orm';
import type { DomainEvent } from '@mohandesyar/module-sdk/server';
import type { Database, Db } from '../../infra/db.js';
import { uuidv7 } from '../../infra/ids.js';

export interface PublishInput {
  tenantId: string;
  companyId?: string | null;
  moduleId: string;
  type: string;
  version?: number;
  payload: unknown;
}

export interface EventConsumer {
  /** Stable consumer id, e.g. "hello-module:hello-module.note.created" or "core:notifications". */
  id: string;
  moduleId: string | null;
  type: string;
  handle(event: DomainEvent): Promise<void>;
}

/**
 * Transactional outbox (docs/02 ADR-07). `publish` inserts in the caller's transaction, so an event
 * exists iff the business change committed. The dispatcher claims rows with SKIP LOCKED (safe with
 * several instances), records per-consumer completion for idempotency and retries with backoff.
 */
export class EventBus {
  private consumers: EventConsumer[] = [];
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: Database,
    /** Returns whether a module is effective for a tenant; consumers of inactive modules are skipped. */
    private readonly isModuleActive: (tenantId: string, moduleId: string) => Promise<boolean>,
    private readonly onError: (err: unknown, ctx: Record<string, unknown>) => void = () => {},
  ) {}

  setConsumers(consumers: EventConsumer[]): void {
    this.consumers = consumers;
  }

  async publish(tx: Db, e: PublishInput): Promise<string> {
    const id = uuidv7();
    await tx.execute(sql`INSERT INTO core_outbox (id, tenant_id, company_id, module_id, event_type, version, payload)
      VALUES (${id}, ${e.tenantId}, ${e.companyId ?? null}, ${e.moduleId}, ${e.type}, ${e.version ?? 1}, ${JSON.stringify(e.payload ?? null)}::jsonb)`);
    return id;
  }

  /** Processes one batch; returns the number of events handled. */
  async dispatchOnce(limit = 50): Promise<number> {
    const r = await this.db.app.execute(sql`SELECT * FROM core_outbox_claim(${limit})`);
    const rows = r.rows as { id: string; tenant_id: string; company_id: string | null; module_id: string; event_type: string; version: number; payload: unknown; created_at: Date }[];
    for (const row of rows) {
      const event: DomainEvent = {
        id: row.id,
        type: row.event_type,
        version: row.version,
        tenantId: row.tenant_id,
        companyId: row.company_id,
        occurredAt: new Date(row.created_at).toISOString(),
        payload: row.payload,
      };
      let error: string | null = null;
      for (const c of this.consumers.filter((x) => x.type === event.type)) {
        try {
          const done = await this.db.tx({ tenantId: event.tenantId }, (tx) =>
            tx.execute(sql`SELECT status FROM core_event_consumptions WHERE event_id = ${event.id} AND consumer = ${c.id}`),
          );
          if (done.rows.length) continue;
          const active = c.moduleId === null || (await this.isModuleActive(event.tenantId, c.moduleId));
          if (active) await c.handle(event);
          await this.db.tx({ tenantId: event.tenantId }, (tx) =>
            tx.execute(sql`INSERT INTO core_event_consumptions (event_id, consumer, tenant_id, status)
              VALUES (${event.id}, ${c.id}, ${event.tenantId}, ${active ? 'done' : 'skipped'}) ON CONFLICT DO NOTHING`),
          );
        } catch (err) {
          error = `${c.id}: ${(err as Error).message}`;
          this.onError(err, { event: event.type, consumer: c.id });
        }
      }
      await this.db.app.execute(sql`SELECT core_outbox_finish(${event.id}, ${error === null}, ${error})`);
    }
    return rows.length;
  }

  start(intervalMs = 500): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.dispatchOnce()
        .catch((err) => this.onError(err, { phase: 'dispatch' }))
        .finally(() => {
          this.running = false;
        });
    }, intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.running) await new Promise((r) => setTimeout(r, 20));
  }
}
