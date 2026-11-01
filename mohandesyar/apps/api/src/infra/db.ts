import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';

export type Db = NodePgDatabase<Record<string, never>>;

export interface DbContext {
  tenantId: string | null;
  companyIds?: readonly string[];
  userId?: string | null;
}

/**
 * Two pools: `app` (mohandesyar_app, RLS-bound, used for every request) and `migrator`
 * (mohandesyar_owner, used only by the migration runner and module lifecycle).
 */
export class Database {
  readonly appPool: pg.Pool;
  readonly migratorPool: pg.Pool;
  readonly app: Db;

  constructor(appUrl: string, migratorUrl: string) {
    this.appPool = new pg.Pool({ connectionString: appUrl, max: 20 });
    this.migratorPool = new pg.Pool({ connectionString: migratorUrl, max: 2 });
    this.app = drizzle(this.appPool);
  }

  /**
   * Runs `fn` in a transaction with the RLS context set via `set_config(..., true)` (transaction-local,
   * equivalent to SET LOCAL and safe with transaction pooling). With `tenantId: null` no tenant rows are visible.
   */
  async tx<T>(ctx: DbContext, fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.app.transaction(async (tx) => {
      await tx.execute(sql`select
        set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true),
        set_config('app.company_ids', ${toPgArray(ctx.companyIds ?? [])}, true),
        set_config('app.user_id', ${ctx.userId ?? ''}, true)`);
      return fn(tx as unknown as Db);
    });
  }

  async close(): Promise<void> {
    await Promise.all([this.appPool.end(), this.migratorPool.end()]);
  }
}

export function toPgArray(values: readonly string[]): string {
  for (const v of values) if (!/^[0-9a-f-]{36}$/i.test(v)) throw new Error('invalid uuid in company scope');
  return `{${values.join(',')}}`;
}

/** Rows of a raw `execute` result. */
export function rows<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}
