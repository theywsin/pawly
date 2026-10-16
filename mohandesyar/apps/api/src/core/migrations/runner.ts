import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type pg from 'pg';
import { lintMigration } from '@mohandesyar/module-package';

/**
 * Per-module migration runner (docs/03-module-system.md §7). All functions expect a client that is
 * already inside a transaction opened by the caller with the migrator (owner) role, so that a failure
 * anywhere — SQL, lint, RLS verification, registry writes — rolls everything back.
 */

export interface MigrationFile {
  file: string;
  sql: string;
  checksum: string;
  kind: 'expand' | 'contract';
  down: string | null;
}

export class MigrationError extends Error {
  constructor(message: string, readonly file?: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

export const LIFECYCLE_LOCK = 7710002;

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export async function readMigrationDir(dir: string): Promise<MigrationFile[]> {
  let meta: { file: string; kind?: 'expand' | 'contract'; down?: string | null }[] | undefined;
  try {
    meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'));
  } catch {
    meta = undefined;
  }
  const names = meta
    ? meta.map((m) => m.file)
    : (await readdir(dir)).filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql')).sort();
  const out: MigrationFile[] = [];
  for (const name of names) {
    const sql = await readFile(join(dir, name), 'utf8');
    const m = meta?.find((x) => x.file === name);
    out.push({ file: name, sql, checksum: sha256(sql), kind: m?.kind ?? 'expand', down: m?.down ?? null });
  }
  return out;
}

export interface ApplyOptions {
  moduleId: string;
  version: string;
  files: MigrationFile[];
  /** Module migrations are linted again server-side; core migrations are trusted. */
  tablePrefix?: string;
  actorId?: string | null;
  log?: (line: string) => void;
}

export async function appliedMigrations(client: pg.PoolClient, moduleId: string): Promise<Map<string, string>> {
  const r = await client.query<{ file: string; checksum: string }>('SELECT file, checksum FROM core_module_migrations WHERE module_id = $1', [moduleId]);
  return new Map(r.rows.map((x) => [x.file, x.checksum]));
}

async function ledgerExists(client: pg.PoolClient): Promise<boolean> {
  const r = await client.query(`SELECT to_regclass('public.core_module_migrations') AS t`);
  return r.rows[0]?.t !== null;
}

/** Applies pending migrations in order. Returns the files applied. */
export async function applyMigrations(client: pg.PoolClient, opts: ApplyOptions): Promise<string[]> {
  const log = opts.log ?? (() => {});
  const applied = (await ledgerExists(client)) ? await appliedMigrations(client, opts.moduleId) : new Map<string, string>();
  const done: string[] = [];
  await client.query(`SET LOCAL lock_timeout = '10s'`);
  await client.query(`SET LOCAL statement_timeout = '120s'`);
  for (const m of opts.files) {
    const prev = applied.get(m.file);
    if (prev !== undefined) {
      if (prev !== m.checksum) throw new MigrationError(`مهاجرت «${m.file}» پس از اجرا تغییر کرده است (checksum متفاوت)`, m.file);
      continue;
    }
    if (opts.tablePrefix) {
      const issues = await lintMigration(m.file, m.sql, opts.tablePrefix);
      if (issues.length) throw new MigrationError(`مهاجرت «${m.file}» مجاز نیست: ${issues.map((i) => i.message).join('؛ ')}`, m.file);
    }
    const started = Date.now();
    log(`اجرای مهاجرت ${opts.moduleId}/${m.file}`);
    try {
      await client.query(m.sql);
    } catch (err) {
      throw new MigrationError(`اجرای مهاجرت «${m.file}» شکست خورد: ${(err as Error).message}`, m.file);
    }
    await client.query(
      'INSERT INTO core_module_migrations (module_id, file, checksum, version, applied_by, duration_ms) VALUES ($1, $2, $3, $4, $5, $6)',
      [opts.moduleId, m.file, m.checksum, opts.version, opts.actorId ?? null, Date.now() - started],
    );
    done.push(m.file);
  }
  return done;
}

/**
 * Post-migration checks for a module (docs/03 §7): every table with the module prefix that has a
 * `tenant_id` column must have RLS enabled AND forced AND at least one policy; any other table must
 * be declared in `globalTables`. Tables outside the prefix created by the module are a failure too.
 */
export async function verifyModuleTables(client: pg.PoolClient, tablePrefix: string, globalTables: string[]): Promise<void> {
  const r = await client.query<{ relname: string; rls: boolean; forced: boolean; policies: number; has_tenant: boolean }>(
    `SELECT c.relname,
            c.relrowsecurity AS rls,
            c.relforcerowsecurity AS forced,
            (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
            EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped) AS has_tenant
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND starts_with(c.relname, $1)`,
    [tablePrefix],
  );
  for (const t of r.rows) {
    if (t.has_tenant) {
      if (!t.rls || !t.forced || t.policies === 0) {
        throw new MigrationError(`جدول «${t.relname}» ستون tenant_id دارد ولی RLS فعال و اجباری (FORCE) با policy ندارد`);
      }
    } else if (!globalTables.includes(t.relname)) {
      throw new MigrationError(`جدول «${t.relname}» ستون tenant_id ندارد و در globalTables اعلام نشده است`);
    }
  }
}

/** Grants DML on the module's tables and sequences to the RLS-bound app role. */
export async function grantModuleAccess(client: pg.PoolClient, tablePrefix: string): Promise<void> {
  const r = await client.query<{ relname: string; relkind: string }>(
    `SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'S') AND starts_with(c.relname, $1)`,
    [tablePrefix],
  );
  for (const t of r.rows) {
    const ident = `"${t.relname.replaceAll('"', '""')}"`;
    if (t.relkind === 'S') await client.query(`GRANT USAGE, SELECT ON SEQUENCE ${ident} TO mohandesyar_app`);
    else if (t.relkind === 'v') await client.query(`GRANT SELECT ON ${ident} TO mohandesyar_app`);
    else await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${ident} TO mohandesyar_app`);
  }
}

const CORE_READ_ONLY = new Set(['core_audit_log', 'core_module_migrations']);

export async function grantCoreAccess(client: pg.PoolClient): Promise<void> {
  const r = await client.query<{ relname: string; relkind: string }>(
    `SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S') AND (starts_with(c.relname, 'core_') OR starts_with(c.relname, 'platform_'))`,
  );
  for (const t of r.rows) {
    if (t.relkind === 'S') continue; // sequences are granted by their migration (the audit one stays definer-only)
    const priv = CORE_READ_ONLY.has(t.relname) ? 'SELECT' : 'SELECT, INSERT, UPDATE, DELETE';
    await client.query(`GRANT ${priv} ON "${t.relname}" TO mohandesyar_app`);
  }
}

/** Applies core migrations in a single transaction. */
export async function migrateCore(pool: pg.Pool, dir: string, version: string, log?: (l: string) => void): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [LIFECYCLE_LOCK]);
    const files = await readMigrationDir(dir);
    // The ledger table is created by the first core migration itself.
    const done = await applyMigrations(client, { moduleId: 'core', version, files, log });
    await grantCoreAccess(client);
    await client.query('COMMIT');
    return done;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
