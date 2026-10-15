import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Database } from '../../infra/db.js';
import type { ModuleContextFactory } from './context.js';
import type { ModuleRegistry } from './registry.js';

/**
 * Runs modules' `schedules` (docs/03 §9): every minute each worker looks for due jobs; a Redis
 * `SET NX` on (module, job, tenant, period) makes exactly one worker in the cluster run each period.
 */
export class ModuleScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly db: Database,
    private readonly redis: Redis,
    private readonly registry: ModuleRegistry,
    private readonly contexts: ModuleContextFactory,
    private readonly onError: (err: unknown, ctx: Record<string, unknown>) => void,
  ) {}

  /** One pass over all due jobs. Returns the number of jobs run (for tests). */
  async tick(now = Date.now()): Promise<number> {
    const jobs = [...this.registry.loaded.values()].flatMap((m) => Object.entries(m.definition.schedules ?? {}).map(([key, job]) => ({ m, key, job })));
    if (!jobs.length) return 0;
    const tenants = (await this.db.app.execute(sql`SELECT id FROM core_tenants WHERE status IN ('active', 'trial', 'suspended')`)).rows as { id: string }[];
    let ran = 0;
    for (const t of tenants) {
      const active = new Set((await this.registry.effectiveFor(t.id)).filter((e) => e.mode === 'full' || e.mode === 'read-only').map((e) => e.id));
      for (const { m, key, job } of jobs) {
        if (!active.has(m.id)) continue;
        const periodMs = Math.max(1, job.everyMinutes) * 60_000;
        const slot = Math.floor(now / periodMs);
        const lock = await this.redis.set(`sched:${m.id}:${key}:${t.id}:${slot}`, '1', 'PX', periodMs * 2, 'NX');
        if (lock !== 'OK') continue;
        try {
          await job.run(await this.contexts.forTenant(m, t.id));
          ran++;
        } catch (err) {
          this.onError(err, { module: m.id, job: key, tenantId: t.id });
        }
      }
    }
    return ran;
  }

  start(intervalMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.tick()
        .then(() => undefined)
        .catch((err) => this.onError(err, { phase: 'scheduler' }))
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
