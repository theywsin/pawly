import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import { createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { compareVersions, isCoreCompatible, satisfiesRange, type ModuleManifest } from '@mohandesyar/module-sdk';
import { keyIdOf, PackageError, verifyPackage, type TrustedKey } from '@mohandesyar/module-package';
import type { Database, Db } from '../../infra/db.js';
import { uuidv7 } from '../../infra/ids.js';
import { apiRoot } from '../../infra/paths.js';
import type { AuditService } from '../audit/audit.service.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { LIFECYCLE_LOCK, applyMigrations, grantModuleAccess, readMigrationDir, verifyModuleTables, MigrationError } from '../migrations/runner.js';
import type { RbacService } from '../rbac/rbac.service.js';
import type { ModuleContextFactory } from './context.js';
import { versionDir } from './loader.js';
import type { ModuleRegistry } from './registry.js';

export interface Actor {
  type: 'admin' | 'user' | 'system';
  id: string | null;
  ip?: string | null;
}

export interface CheckResult {
  key: string;
  ok: boolean;
  message: string;
}

export interface UploadPreview {
  uploadId: string;
  ok: boolean;
  checks: CheckResult[];
  manifest: ModuleManifest | null;
  signerKeyId: string | null;
  packageSha256: string | null;
  kind: 'install' | 'upgrade' | 'reinstall' | 'downgrade' | null;
  currentVersion: string | null;
  migrations: { file: string; kind: string; pending: boolean }[];
  tables: string[];
}

export interface LifecycleOptions {
  storeDir: string;
  uploadDir: string;
  backupDir: string;
  coreVersion: string;
  /** Called after a committed change to module code (install/upgrade/rollback/uninstall). */
  requestReload: (reason: string) => Promise<void>;
  /** Fan-out invalidation of module state caches to every instance. */
  broadcastInvalidate: (tenantId?: string) => Promise<void>;
  dryLoad?: (storeDir: string, id: string, version: string) => Promise<void>;
}

/** Spawns the dry-load child process (production: dist/dry-load.js; dev/test: tsx on the source). */
export async function dryLoadInChild(storeDir: string, id: string, version: string): Promise<void> {
  const root = apiRoot();
  const built = join(root, 'dist', 'dry-load.js');
  const [cmd, args] = existsSync(built)
    ? [process.execPath, [built, storeDir, id, version]]
    : [process.execPath, ['--import', 'tsx', join(root, 'src', 'dry-load.ts'), storeDir, id, version]];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '' } });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const last = out.trim().split('\n').pop() ?? '';
      let msg = err.trim().split('\n').slice(-3).join(' ');
      try {
        msg = (JSON.parse(last) as { error?: string }).error ?? msg;
      } catch {
        /* keep stderr */
      }
      reject(new Error(`بارگذاری آزمایشی کد ماژول شکست خورد: ${msg || `exit ${code}`}`));
    });
  });
}

/**
 * Module lifecycle (docs/03-module-system.md §8): upload & verify → install/upgrade (dry-load, then
 * migrations + registry in one transaction, then graceful reload) → enable/disable (global, per tenant;
 * never deletes data) → rollback → uninstall (keep data by default, backup first). Every operation is
 * recorded in core_module_operations and the audit log.
 */
export class ModuleLifecycleService {
  constructor(
    private readonly db: Database,
    private readonly registry: ModuleRegistry,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly contexts: ModuleContextFactory,
    private readonly opts: LifecycleOptions,
  ) {}

  // ------------------------------------------------------------------ trusted keys

  async trustedKeys(): Promise<TrustedKey[]> {
    const r = await this.db.app.execute(sql`SELECT key_id, public_key FROM core_trusted_keys WHERE status = 'active'`);
    return (r.rows as { key_id: string; public_key: string }[]).map((k) => ({ keyId: k.key_id, publicKeyPem: k.public_key }));
  }

  async addTrustedKey(publicKeyPem: string, label: string, actor: Actor): Promise<string> {
    let keyId: string;
    try {
      keyId = keyIdOf(publicKeyPem);
    } catch {
      throw badRequest('INVALID_KEY', 'کلید عمومی معتبر نیست (PEM از نوع Ed25519 لازم است)');
    }
    await this.db.app.execute(sql`INSERT INTO core_trusted_keys (key_id, public_key, label) VALUES (${keyId}, ${publicKeyPem}, ${label})
      ON CONFLICT (key_id) DO UPDATE SET status = 'active', label = EXCLUDED.label, revoked_at = NULL`);
    await this.audit.append({ tenantId: null, actorType: actor.type === 'admin' ? 'admin' : 'system', actorId: actor.id, action: 'module.key_trusted', entityType: 'trusted_key', entityId: keyId, after: { label }, ip: actor.ip });
    return keyId;
  }

  async revokeTrustedKey(keyId: string, actor: Actor): Promise<void> {
    await this.db.app.execute(sql`UPDATE core_trusted_keys SET status = 'revoked', revoked_at = now() WHERE key_id = ${keyId}`);
    await this.audit.append({ tenantId: null, actorType: 'admin', actorId: actor.id, action: 'module.key_revoked', entityType: 'trusted_key', entityId: keyId, ip: actor.ip });
  }

  // ------------------------------------------------------------------ operations log

  private async startOp(moduleId: string, op: string, actor: Actor, extra: { version?: string; tenantId?: string; uploadId?: string } = {}): Promise<string> {
    const id = uuidv7();
    await this.db.app.execute(sql`INSERT INTO core_module_operations (id, module_id, op, target_tenant_id, version, status, actor_admin_id, actor_user_id, upload_id)
      VALUES (${id}, ${moduleId}, ${op}, ${extra.tenantId ?? null}, ${extra.version ?? null}, 'running',
              ${actor.type === 'admin' ? actor.id : null}, ${actor.type === 'user' ? actor.id : null}, ${extra.uploadId ?? null})`);
    return id;
  }

  private async log(opId: string, line: string): Promise<void> {
    await this.db.app.execute(sql`UPDATE core_module_operations SET log = log || ${JSON.stringify([{ at: new Date().toISOString(), line }])}::jsonb WHERE id = ${opId}`);
  }

  private async finishOp(opId: string, ok: boolean, error?: string, details?: unknown): Promise<void> {
    await this.db.app.execute(sql`UPDATE core_module_operations SET status = ${ok ? 'succeeded' : 'failed'}, error = ${error ?? null}, finished_at = now(),
      details = CASE WHEN ${details === undefined} THEN details ELSE ${JSON.stringify(details ?? {})}::jsonb END WHERE id = ${opId}`);
  }

  async operations(moduleId?: string, limit = 50) {
    const r = await this.db.app.execute(sql`SELECT id, module_id, op, target_tenant_id, version, status, error, log, details, actor_admin_id, actor_user_id, started_at, finished_at
      FROM core_module_operations ${moduleId ? sql`WHERE module_id = ${moduleId}` : sql``} ORDER BY started_at DESC LIMIT ${limit}`);
    return r.rows;
  }

  async operation(id: string) {
    const r = await this.db.app.execute(sql`SELECT * FROM core_module_operations WHERE id = ${id}`);
    if (!r.rows[0]) throw notFound();
    return r.rows[0];
  }

  // ------------------------------------------------------------------ upload & verification

  /**
   * Verifies an uploaded package (already written to disk by the controller) and returns a preview.
   * Nothing from the package is executed. Rejections are audited.
   */
  async upload(packagePath: string, actor: Actor): Promise<UploadPreview> {
    const uploadId = uuidv7();
    const dir = join(this.opts.uploadDir, uploadId);
    await mkdir(dir, { recursive: true });
    const pkgFile = join(dir, 'package.mypkg');
    await rename(packagePath, pkgFile).catch(async () => {
      await cp(packagePath, pkgFile);
      await rm(packagePath, { force: true });
    });
    const checks: CheckResult[] = [];
    const preview: UploadPreview = { uploadId, ok: false, checks, manifest: null, signerKeyId: null, packageSha256: null, kind: null, currentVersion: null, migrations: [], tables: [] };
    const opId = await this.startOp('-', 'upload', actor, { uploadId });
    try {
      const v = await verifyPackage(pkgFile, join(dir, 'extracted'), await this.trustedKeys());
      checks.push({ key: 'archive', ok: true, message: 'ساختار بسته سالم و امن است' });
      checks.push({ key: 'signature', ok: true, message: `امضای بسته با کلید مورد اعتماد ${v.keyId} تأیید شد` });
      checks.push({ key: 'checksums', ok: true, message: 'checksum همه فایل‌ها تأیید شد' });
      checks.push({ key: 'manifest', ok: true, message: 'manifest معتبر است' });
      preview.manifest = v.manifest;
      preview.signerKeyId = v.keyId;
      preview.packageSha256 = v.packageSha256;
      await this.analyse(preview, join(dir, 'extracted'));
      preview.ok = checks.every((c) => c.ok);
      await this.db.app.execute(sql`UPDATE core_module_operations SET module_id = ${v.manifest.id}, version = ${v.manifest.version} WHERE id = ${opId}`);
      await this.finishOp(opId, preview.ok, preview.ok ? undefined : checks.filter((c) => !c.ok).map((c) => c.message).join('؛ '), preview);
      await this.audit.append({ tenantId: null, actorType: 'admin', actorId: actor.id, action: preview.ok ? 'module.package_verified' : 'module.package_incompatible', moduleId: v.manifest.id, entityType: 'module_package', entityId: uploadId, after: { version: v.manifest.version, sha256: v.packageSha256, signer: v.keyId }, ip: actor.ip });
      return preview;
    } catch (err) {
      const message = err instanceof PackageError ? err.message : `بسته قابل پردازش نیست: ${(err as Error).message}`;
      checks.push({ key: err instanceof PackageError ? err.code : 'error', ok: false, message });
      await rm(dir, { recursive: true, force: true });
      await this.finishOp(opId, false, message, preview);
      await this.audit.append({ tenantId: null, actorType: 'admin', actorId: actor.id, action: 'module.package_rejected', entityType: 'module_package', entityId: uploadId, after: { reason: message, code: err instanceof PackageError ? err.code : 'error' }, ip: actor.ip });
      return preview;
    }
  }

  private async analyse(p: UploadPreview, extracted: string): Promise<void> {
    const m = p.manifest!;
    const states = await this.registry.globalStates();
    const current = states.get(m.id);
    p.currentVersion = current?.state === 'installed' ? current.activeVersion : null;
    if (!p.currentVersion) p.kind = current?.state === 'uninstalled_data_retained' ? 'reinstall' : 'install';
    else {
      const c = compareVersions(m.version, p.currentVersion);
      p.kind = c > 0 ? 'upgrade' : c === 0 ? 'reinstall' : 'downgrade';
    }
    const push = (key: string, ok: boolean, message: string) => p.checks.push({ key, ok, message });

    push('core', isCoreCompatible(m, this.opts.coreVersion), isCoreCompatible(m, this.opts.coreVersion) ? `با نسخه هسته ${this.opts.coreVersion} سازگار است` : `به نسخه هسته ${m.coreVersionRange} نیاز دارد (هسته فعلی ${this.opts.coreVersion})`);
    if (p.kind === 'downgrade') push('version', false, `نسخه ${m.version} قدیمی‌تر از نسخه نصب‌شده ${p.currentVersion} است؛ برای بازگشت از «بازگشت نسخه» استفاده کنید`);
    if (p.kind === 'reinstall' && p.currentVersion) push('version', false, `نسخه ${m.version} هم‌اکنون نصب است`);

    for (const [dep, range] of Object.entries(m.dependencies)) {
      const s = states.get(dep);
      const ok = s?.state === 'installed' && !!s.activeVersion && satisfiesRange(s.activeVersion, range);
      push(`dep:${dep}`, ok, ok ? `وابستگی ${dep}@${s!.activeVersion} نصب است` : `وابستگی اجباری ${dep} (${range}) نصب نیست`);
    }
    // Upgrades must keep satisfying modules that depend on this one.
    if (p.kind === 'upgrade') {
      for (const s of states.values()) {
        if (s.state !== 'installed' || !s.manifest) continue;
        const range = s.manifest.dependencies[m.id] ?? s.manifest.optionalDependencies[m.id];
        if (range && !satisfiesRange(m.version, range)) push(`dependent:${s.id}`, false, `ماژول ${s.id} به ${m.id}@${range} نیاز دارد و با ${m.version} سازگار نیست`);
      }
    }
    // Key and prefix collisions with other modules.
    for (const s of states.values()) {
      if (s.id === m.id || !s.manifest || s.state === 'uninstalled') continue;
      if (s.manifest.tablePrefix === m.tablePrefix) push('prefix', false, `پیشوند جداول ${m.tablePrefix} متعلق به ماژول ${s.id} است`);
    }
    const files = await readMigrationDir(join(extracted, 'migrations'));
    const applied = new Map<string, string>();
    const r = await this.db.app.execute(sql`SELECT file, checksum FROM core_module_migrations WHERE module_id = ${m.id}`);
    for (const row of r.rows as { file: string; checksum: string }[]) applied.set(row.file, row.checksum);
    p.migrations = files.map((f) => ({ file: f.file, kind: f.kind, pending: !applied.has(f.file) }));
    const changed = files.filter((f) => applied.has(f.file) && applied.get(f.file) !== f.checksum);
    push('migrations', changed.length === 0, changed.length ? `مهاجرت‌های قبلاً اجراشده تغییر کرده‌اند: ${changed.map((f) => f.file).join('، ')}` : `${files.length} مهاجرت (${p.migrations.filter((x) => x.pending).length} جدید)`);
    const { lintMigration } = await import('@mohandesyar/module-package');
    const issues = (await Promise.all(files.map((f) => lintMigration(f.file, f.sql, m.tablePrefix)))).flat();
    push('migration-lint', issues.length === 0, issues.length ? issues.map((i) => `${i.file}: ${i.message}`).join('؛ ') : 'مهاجرت‌ها فقط جداول خود ماژول را تغییر می‌دهند');
    const tables = new Set<string>();
    for (const f of files) for (const mt of f.sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi)) tables.add(mt[1]!);
    p.tables = [...tables];
  }

  async getUpload(uploadId: string): Promise<UploadPreview> {
    const r = await this.db.app.execute(sql`SELECT details FROM core_module_operations WHERE upload_id = ${uploadId} AND op = 'upload' ORDER BY started_at DESC LIMIT 1`);
    const d = (r.rows[0] as { details: UploadPreview } | undefined)?.details;
    if (!d || !d.uploadId) throw notFound('بسته بارگذاری‌شده یافت نشد');
    return d;
  }

  // ------------------------------------------------------------------ install / upgrade

  /** Installs or upgrades from a verified upload. Returns the operation id; failures roll back completely. */
  async install(uploadId: string, actor: Actor): Promise<{ operationId: string; moduleId: string; version: string }> {
    const preview = await this.getUpload(uploadId);
    if (!preview.ok || !preview.manifest) throw badRequest('PACKAGE_NOT_INSTALLABLE', 'این بسته قابل نصب نیست؛ نتیجه بررسی‌ها را ببینید');
    const extracted = join(this.opts.uploadDir, uploadId, 'extracted');
    if (!existsSync(extracted)) throw conflict('UPLOAD_CONSUMED', 'این بسته قبلاً نصب یا منقضی شده است؛ دوباره بارگذاری کنید');
    // Re-verify from the original file: the extracted copy is trusted only through this check.
    const recheck = join(this.opts.uploadDir, uploadId, 'recheck');
    await rm(recheck, { recursive: true, force: true });
    const verified = await verifyPackage(join(this.opts.uploadDir, uploadId, 'package.mypkg'), recheck, await this.trustedKeys());
    const m = verified.manifest;
    const isUpgrade = preview.kind === 'upgrade';
    const opId = await this.startOp(m.id, isUpgrade ? 'upgrade' : 'install', actor, { version: m.version, uploadId });
    const target = versionDir(this.opts.storeDir, m.id, m.version);
    let createdTarget = false;
    try {
      // Re-run the compatibility analysis against current state (it may have changed since upload).
      const fresh: UploadPreview = { ...preview, checks: [], migrations: [], tables: [] };
      await this.analyse(fresh, recheck);
      const failed = fresh.checks.filter((c) => !c.ok);
      if (failed.length) throw new Error(failed.map((c) => c.message).join('؛ '));

      await this.log(opId, 'انتقال بسته به مخزن ماژول‌ها');
      await mkdir(dirname(target), { recursive: true });
      if (existsSync(target)) await rm(target, { recursive: true, force: true });
      await rename(recheck, target);
      createdTarget = true;

      await this.log(opId, 'بارگذاری آزمایشی کد بک‌اند در فرایند جدا');
      await (this.opts.dryLoad ?? dryLoadInChild)(this.opts.storeDir, m.id, m.version);

      if (isUpgrade && m.uninstallPolicy.requiresBackup) {
        await this.log(opId, 'پشتیبان‌گیری از جداول ماژول پیش از ارتقا');
        const file = await this.backupTables(m.id, m.tablePrefix, preview.currentVersion ?? 'unknown');
        await this.log(opId, `پشتیبان: ${file}`);
      }

      await this.withMigrator(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock($1)', [LIFECYCLE_LOCK]);
        const files = await readMigrationDir(join(target, 'migrations'));
        const done = await applyMigrations(client, { moduleId: m.id, version: m.version, files, tablePrefix: m.tablePrefix, actorId: actor.id, log: (l) => void this.log(opId, l) });
        await this.log(opId, `${done.length} مهاجرت اجرا شد؛ بررسی RLS جداول`);
        await verifyModuleTables(client, m.tablePrefix, m.globalTables);
        await grantModuleAccess(client, m.tablePrefix);
        await this.registerPermissions(client, m);
        await client.query(
          `INSERT INTO core_module_versions (module_id, version, manifest, package_sha256, signer_key_id, store_path, status, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)
           ON CONFLICT (module_id, version) DO UPDATE SET manifest = EXCLUDED.manifest, package_sha256 = EXCLUDED.package_sha256,
             signer_key_id = EXCLUDED.signer_key_id, store_path = EXCLUDED.store_path, status = 'active'`,
          [m.id, m.version, JSON.stringify(m), verified.packageSha256, verified.keyId, target, actor.type === 'admin' ? actor.id : null],
        );
        await client.query(`UPDATE core_module_versions SET status = 'superseded' WHERE module_id = $1 AND version <> $2 AND status = 'active'`, [m.id, m.version]);
        await client.query(
          `INSERT INTO core_modules (id, name, state, active_version, previous_version, globally_enabled, installed_at, installed_by)
           VALUES ($1, $2, 'installed', $3, NULL, false, now(), $4)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, state = 'installed', previous_version = core_modules.active_version,
             active_version = EXCLUDED.active_version, updated_at = now()`,
          [m.id, JSON.stringify(m.name), m.version, actor.type === 'admin' ? actor.id : null],
        );
        if (!isUpgrade) await client.query(`UPDATE core_modules SET previous_version = NULL WHERE id = $1`, [m.id]);
        await client.query(`SELECT core_audit_append(NULL, $1, $2, $3, $4, 'module', $4, NULL, $5, $6)`, [
          actor.type === 'admin' ? 'admin' : 'system',
          actor.id,
          isUpgrade ? 'module.upgraded' : 'module.installed',
          m.id,
          JSON.stringify({ version: m.version, from: preview.currentVersion, migrations: done, signer: verified.keyId }),
          actor.ip ?? null,
        ]);
      });
      await rm(join(this.opts.uploadDir, uploadId), { recursive: true, force: true });
      await this.finishOp(opId, true);
      await this.log(opId, 'نصب کامل شد؛ درخواست بارگذاری مجدد سرویس‌ها');
      await this.opts.broadcastInvalidate();
      await this.opts.requestReload(`${m.id}@${m.version}`);
      return { operationId: opId, moduleId: m.id, version: m.version };
    } catch (err) {
      const message = err instanceof MigrationError ? err.message : (err as Error).message;
      if (createdTarget) await rm(target, { recursive: true, force: true });
      await this.log(opId, `خطا: ${message} — همه تغییرات برگردانده شد`);
      await this.finishOp(opId, false, message);
      await this.audit.append({ tenantId: null, actorType: actor.type === 'admin' ? 'admin' : 'system', actorId: actor.id, action: isUpgrade ? 'module.upgrade_failed' : 'module.install_failed', moduleId: m.id, entityType: 'module', entityId: m.id, after: { version: m.version, error: message }, ip: actor.ip });
      throw conflict('INSTALL_FAILED', `نصب ماژول شکست خورد و همه تغییرات برگردانده شد: ${message}`, { operationId: opId });
    }
  }

  private async registerPermissions(client: pg.PoolClient, m: ModuleManifest): Promise<void> {
    for (const p of m.permissions) {
      await client.query(
        `INSERT INTO core_permissions (key, module_id, label_fa, scopes, sensitive) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (key) DO UPDATE SET label_fa = EXCLUDED.label_fa, scopes = EXCLUDED.scopes, sensitive = EXCLUDED.sensitive`,
        [p.key, m.id, p.fa, p.scopes, p.sensitive],
      );
    }
    await client.query(`DELETE FROM core_permissions WHERE module_id = $1 AND NOT (key = ANY($2::text[]))`, [m.id, m.permissions.map((p) => p.key)]);
  }

  private async withMigrator<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.migratorPool.connect();
    try {
      await client.query('BEGIN');
      const r = await fn(client);
      await client.query('COMMIT');
      return r;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Logical backup of all module tables (JSON lines, gzip). Reading through forced RLS requires the
   * owner to lift FORCE temporarily inside a transaction that is always rolled back.
   */
  async backupTables(moduleId: string, tablePrefix: string, version: string): Promise<string> {
    const dir = join(this.opts.backupDir, `${moduleId}-${version}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    await mkdir(dir, { recursive: true });
    const client = await this.db.migratorPool.connect();
    try {
      await client.query('BEGIN');
      const t = await client.query<{ relname: string }>(
        `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND starts_with(c.relname, $1) ORDER BY 1`,
        [tablePrefix],
      );
      const manifest: Record<string, number> = {};
      for (const { relname } of t.rows) {
        await client.query(`ALTER TABLE "${relname}" NO FORCE ROW LEVEL SECURITY`);
        const rowsRes = await client.query(`SELECT row_to_json(x)::text AS j FROM "${relname}" x`);
        const out = createWriteStream(join(dir, `${relname}.jsonl.gz`));
        const gz = createGzip();
        gz.pipe(out);
        for (const r of rowsRes.rows as { j: string }[]) gz.write(r.j + '\n');
        gz.end();
        await new Promise<void>((res, rej) => out.on('finish', res).on('error', rej));
        manifest[relname] = rowsRes.rowCount ?? 0;
      }
      await writeFile(join(dir, 'manifest.json'), JSON.stringify({ moduleId, version, tables: manifest, at: new Date().toISOString() }, null, 2));
      return dir;
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  async tableStats(tablePrefix: string): Promise<{ table: string; rows: number; bytes: number }[]> {
    const client = await this.db.migratorPool.connect();
    try {
      await client.query('BEGIN');
      const t = await client.query<{ relname: string; bytes: string }>(
        `SELECT c.relname, pg_total_relation_size(c.oid)::bigint AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND starts_with(c.relname, $1) ORDER BY 1`,
        [tablePrefix],
      );
      const out: { table: string; rows: number; bytes: number }[] = [];
      for (const r of t.rows) {
        await client.query(`ALTER TABLE "${r.relname}" NO FORCE ROW LEVEL SECURITY`);
        const c = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${r.relname}"`);
        out.push({ table: r.relname, rows: c.rows[0]!.n, bytes: Number(r.bytes) });
      }
      return out;
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  // ------------------------------------------------------------------ rollback

  async rollback(moduleId: string, actor: Actor): Promise<{ operationId: string; version: string }> {
    const s = (await this.registry.globalStates()).get(moduleId);
    if (!s || s.state !== 'installed' || !s.activeVersion) throw notFound('ماژول نصب‌شده یافت نشد');
    if (!s.previousVersion) throw badRequest('NO_PREVIOUS_VERSION', 'نسخه قبلی برای بازگشت وجود ندارد');
    const prev = s.previousVersion;
    const current = s.activeVersion;
    const opId = await this.startOp(moduleId, 'rollback', actor, { version: prev });
    try {
      const prevDir = versionDir(this.opts.storeDir, moduleId, prev);
      if (!existsSync(prevDir)) throw new Error(`فایل‌های نسخه ${prev} در مخزن وجود ندارد`);
      const currentFiles = await readMigrationDir(join(versionDir(this.opts.storeDir, moduleId, current), 'migrations'));
      await this.withMigrator(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock($1)', [LIFECYCLE_LOCK]);
        const r = await client.query<{ file: string }>(`SELECT file FROM core_module_migrations WHERE module_id = $1 AND version = $2 ORDER BY file DESC`, [moduleId, current]);
        for (const { file } of r.rows) {
          const meta = currentFiles.find((f) => f.file === file);
          if (meta?.kind === 'contract' || meta?.down) {
            if (!meta.down) throw new Error(`مهاجرت ${file} از نوع contract است و فایل down ندارد؛ بازگشت فقط با بازیابی پشتیبان ممکن است`);
            const { readFile } = await import('node:fs/promises');
            const downSql = await readFile(join(versionDir(this.opts.storeDir, moduleId, current), 'migrations', meta.down), 'utf8');
            await this.log(opId, `اجرای ${meta.down}`);
            await client.query(downSql);
            await client.query(`DELETE FROM core_module_migrations WHERE module_id = $1 AND file = $2`, [moduleId, file]);
          }
          // expand-only migrations stay applied: the previous code is compatible with them by contract.
        }
        await client.query(`UPDATE core_module_versions SET status = 'active' WHERE module_id = $1 AND version = $2`, [moduleId, prev]);
        await client.query(`UPDATE core_module_versions SET status = 'superseded' WHERE module_id = $1 AND version = $2`, [moduleId, current]);
        const pm = await client.query<{ manifest: ModuleManifest }>(`SELECT manifest FROM core_module_versions WHERE module_id = $1 AND version = $2`, [moduleId, prev]);
        if (pm.rows[0]) await this.registerPermissions(client, pm.rows[0].manifest);
        await client.query(`UPDATE core_modules SET active_version = $2, previous_version = NULL, updated_at = now() WHERE id = $1`, [moduleId, prev]);
        await client.query(`SELECT core_audit_append(NULL, 'admin', $1, 'module.rolled_back', $2, 'module', $2, NULL, $3, $4)`, [actor.id, moduleId, JSON.stringify({ from: current, to: prev }), actor.ip ?? null]);
      });
      await this.finishOp(opId, true);
      await this.opts.broadcastInvalidate();
      await this.opts.requestReload(`${moduleId} rollback to ${prev}`);
      return { operationId: opId, version: prev };
    } catch (err) {
      await this.finishOp(opId, false, (err as Error).message);
      throw conflict('ROLLBACK_FAILED', `بازگشت نسخه انجام نشد: ${(err as Error).message}`, { operationId: opId });
    }
  }

  // ------------------------------------------------------------------ enable / disable

  async setGlobal(moduleId: string, enabled: boolean, actor: Actor): Promise<void> {
    const states = await this.registry.globalStates();
    const s = states.get(moduleId);
    if (!s || s.state !== 'installed') throw notFound('ماژول نصب‌شده یافت نشد');
    if (!enabled) {
      const dependents = [...states.values()].filter((x) => x.state === 'installed' && x.globallyEnabled && x.manifest && moduleId in x.manifest.dependencies).map((x) => x.id);
      if (dependents.length) throw conflict('HAS_DEPENDENTS', `ماژول‌های ${dependents.join('، ')} به این ماژول وابسته‌اند؛ ابتدا آن‌ها را غیرفعال کنید`, { dependents });
    } else {
      const missing = Object.keys(s.manifest?.dependencies ?? {}).filter((d) => !states.get(d)?.globallyEnabled);
      if (missing.length) throw conflict('DEPENDENCY_DISABLED', `ابتدا وابستگی‌های ${missing.join('، ')} را فعال کنید`, { missing });
    }
    const opId = await this.startOp(moduleId, enabled ? 'enable_global' : 'disable_global', actor);
    await this.db.app.execute(sql`UPDATE core_modules SET globally_enabled = ${enabled}, updated_at = now() WHERE id = ${moduleId}`);
    await this.audit.append({ tenantId: null, actorType: 'admin', actorId: actor.id, action: enabled ? 'module.enabled_global' : 'module.disabled_global', moduleId, entityType: 'module', entityId: moduleId, ip: actor.ip });
    await this.finishOp(opId, true);
    await this.opts.broadcastInvalidate();
  }

  /**
   * Enables/disables a module for one tenant. Disabling never deletes data; re-enabling restores
   * everything. Platform admins implicitly grant entitlement (manual grant); tenant admins can only
   * toggle modules their plan entitles them to.
   */
  async setTenant(tenantId: string, moduleId: string, enabled: boolean, actor: Actor): Promise<void> {
    const states = await this.registry.globalStates();
    const s = states.get(moduleId);
    if (!s || s.state !== 'installed') throw notFound('ماژول نصب‌شده یافت نشد');
    const tenantRows = await this.db.app.execute(sql`SELECT module_id FROM core_tenant_modules WHERE tenant_id = ${tenantId} AND enabled`);
    const enabledSet = new Set((tenantRows.rows as { module_id: string }[]).map((r) => r.module_id));
    if (enabled) {
      if (!s.globallyEnabled) throw conflict('MODULE_GLOBALLY_DISABLED', 'این ماژول در سطح پلتفرم غیرفعال است');
      const missing = Object.keys(s.manifest?.dependencies ?? {}).filter((d) => !enabledSet.has(d));
      if (missing.length) throw conflict('DEPENDENCY_DISABLED', `ابتدا ماژول‌های ${missing.join('، ')} را برای این سازمان فعال کنید`, { missing });
      const loaded = this.registry.loaded.get(moduleId);
      if (!loaded || loaded.version !== s.activeVersion) throw conflict('MODULE_NOT_LOADED', 'کد ماژول هنوز روی این سرور بارگذاری نشده است؛ چند ثانیه بعد دوباره تلاش کنید');
      if (actor.type === 'user') {
        const ent = await this.registry.entitlement.get(tenantId);
        if (!ent.modules.has(moduleId)) throw conflict('NOT_ENTITLED', 'این ماژول در اشتراک شما نیست');
      }
    } else {
      const dependents = [...enabledSet].filter((id) => id !== moduleId && states.get(id)?.manifest && moduleId in states.get(id)!.manifest!.dependencies);
      if (dependents.length) throw conflict('HAS_DEPENDENTS', `ماژول‌های ${dependents.join('، ')} در این سازمان به این ماژول وابسته‌اند`, { dependents });
    }
    const opId = await this.startOp(moduleId, enabled ? 'enable_tenant' : 'disable_tenant', actor, { tenantId });
    try {
      await this.db.app.transaction(async (raw) => {
        const tx = raw as unknown as Db;
        if (enabled && actor.type !== 'user') {
          await tx.execute(sql`INSERT INTO core_tenant_grants (tenant_id, module_id, reason, created_by) VALUES (${tenantId}, ${moduleId}, 'platform', ${actor.id})
            ON CONFLICT DO NOTHING`);
        }
        await tx.execute(sql`INSERT INTO core_tenant_modules (tenant_id, module_id, enabled, source, enabled_at, disabled_at)
          VALUES (${tenantId}, ${moduleId}, ${enabled}, ${actor.type === 'user' ? 'plan' : 'manual'}, ${enabled ? sql`now()` : sql`NULL`}, ${enabled ? sql`NULL` : sql`now()`})
          ON CONFLICT (tenant_id, module_id) DO UPDATE SET enabled = EXCLUDED.enabled,
            enabled_at = CASE WHEN EXCLUDED.enabled THEN now() ELSE core_tenant_modules.enabled_at END,
            disabled_at = CASE WHEN EXCLUDED.enabled THEN core_tenant_modules.disabled_at ELSE now() END`);
        await this.audit.append({ tenantId, actorType: actor.type === 'admin' ? 'admin' : actor.type === 'user' ? 'user' : 'system', actorId: actor.id, action: enabled ? 'module.enabled_tenant' : 'module.disabled_tenant', moduleId, entityType: 'module', entityId: moduleId, ip: actor.ip }, tx);
      });
      if (enabled) await this.seedTenant(tenantId, moduleId);
      await this.finishOp(opId, true);
    } catch (err) {
      await this.finishOp(opId, false, (err as Error).message);
      throw err;
    }
    this.registry.invalidate(tenantId);
    await this.opts.broadcastInvalidate(tenantId);
  }

  /** Idempotent per-tenant seed: module default roles + the module's own seed hook. */
  private async seedTenant(tenantId: string, moduleId: string): Promise<void> {
    const loaded = this.registry.loaded.get(moduleId);
    if (!loaded) return;
    const r = await this.db.app.execute(sql`SELECT seeded_version FROM core_tenant_modules WHERE tenant_id = ${tenantId} AND module_id = ${moduleId}`);
    if ((r.rows[0] as { seeded_version: string | null } | undefined)?.seeded_version === loaded.version) return;
    await this.db.tx({ tenantId }, async (tx) => {
      for (const role of loaded.manifest.defaultRoles) {
        await this.rbac.ensureRole(tx, tenantId, { key: role.key, name: role.name?.fa ?? role.key, grants: role.grants.map(parseGrant) }, { system: false, moduleId });
      }
    });
    if (loaded.definition.seedTenant) {
      this.registry.invalidate(tenantId);
      await loaded.definition.seedTenant(await this.contexts.forTenant(loaded, tenantId));
    }
    await this.db.app.execute(sql`UPDATE core_tenant_modules SET seeded_version = ${loaded.version} WHERE tenant_id = ${tenantId} AND module_id = ${moduleId}`);
  }

  async tenantModules(tenantId: string) {
    const r = await this.db.app.execute(sql`SELECT m.id, m.name, m.state, m.active_version, m.globally_enabled,
        coalesce(tm.enabled, false) AS enabled, tm.enabled_at, tm.disabled_at, tm.source
      FROM core_modules m LEFT JOIN core_tenant_modules tm ON tm.module_id = m.id AND tm.tenant_id = ${tenantId}
      WHERE m.state = 'installed' ORDER BY m.id`);
    return r.rows;
  }

  // ------------------------------------------------------------------ uninstall

  async uninstallPreview(moduleId: string) {
    const states = await this.registry.globalStates();
    const s = states.get(moduleId);
    if (!s?.manifest || s.state !== 'installed') throw notFound('ماژول نصب‌شده یافت نشد');
    const tenants = await this.db.app.execute(sql`SELECT count(*)::int AS n FROM core_tenant_modules WHERE module_id = ${moduleId} AND enabled`);
    const dependents = [...states.values()].filter((x) => x.state === 'installed' && x.manifest && moduleId in x.manifest.dependencies).map((x) => x.id);
    return {
      moduleId,
      version: s.activeVersion,
      globallyEnabled: s.globallyEnabled,
      activeTenants: (tenants.rows[0] as { n: number }).n,
      dependents,
      tables: await this.tableStats(s.manifest.tablePrefix),
      policy: s.manifest.uninstallPolicy,
    };
  }

  async uninstall(moduleId: string, opts: { purgeData: boolean; confirmName: string }, actor: Actor): Promise<{ operationId: string; backup: string }> {
    const preview = await this.uninstallPreview(moduleId);
    if (opts.confirmName !== moduleId) throw badRequest('CONFIRMATION_MISMATCH', 'برای تأیید، شناسه ماژول را دقیقاً وارد کنید');
    if (preview.globallyEnabled || preview.activeTenants > 0) throw conflict('MODULE_IN_USE', 'ابتدا ماژول را در سطح پلتفرم و برای همه سازمان‌ها غیرفعال کنید', { activeTenants: preview.activeTenants });
    if (preview.dependents.length) throw conflict('HAS_DEPENDENTS', `ماژول‌های ${preview.dependents.join('، ')} به این ماژول وابسته‌اند`, { dependents: preview.dependents });
    const s = (await this.registry.globalStates()).get(moduleId)!;
    const m = s.manifest!;
    if (opts.purgeData && !m.uninstallPolicy.allowPurge) throw badRequest('PURGE_NOT_ALLOWED', 'سیاست این ماژول اجازه پاک‌سازی داده را نمی‌دهد');
    const opId = await this.startOp(moduleId, opts.purgeData ? 'purge' : 'uninstall', actor, { version: s.activeVersion ?? undefined });
    try {
      await this.log(opId, 'پشتیبان‌گیری از جداول ماژول');
      const backup = await this.backupTables(moduleId, m.tablePrefix, s.activeVersion ?? 'unknown');
      await this.log(opId, `پشتیبان: ${backup}`);
      await this.withMigrator(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock($1)', [LIFECYCLE_LOCK]);
        if (opts.purgeData) {
          const t = await client.query<{ relname: string }>(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v') AND starts_with(c.relname, $1)`, [m.tablePrefix]);
          for (const { relname } of t.rows) await client.query(`DROP TABLE IF EXISTS "${relname}" CASCADE`);
          await client.query(`DELETE FROM core_module_migrations WHERE module_id = $1`, [moduleId]);
          await client.query(`DELETE FROM core_permissions WHERE module_id = $1`, [moduleId]);
          await client.query(`DELETE FROM core_tenant_modules WHERE module_id = $1`, [moduleId]);
          await client.query(`DELETE FROM core_tenant_grants WHERE module_id = $1`, [moduleId]);
        }
        await client.query(`UPDATE core_module_versions SET status = 'removed' WHERE module_id = $1`, [moduleId]);
        await client.query(`UPDATE core_modules SET state = $2, active_version = NULL, previous_version = NULL, globally_enabled = false, updated_at = now() WHERE id = $1`, [
          moduleId,
          opts.purgeData ? 'uninstalled' : 'uninstalled_data_retained',
        ]);
        await client.query(`SELECT core_audit_append(NULL, 'admin', $1, $2, $3, 'module', $3, NULL, $4, $5)`, [
          actor.id,
          opts.purgeData ? 'module.purged' : 'module.uninstalled',
          moduleId,
          JSON.stringify({ version: s.activeVersion, backup, tables: preview.tables }),
          actor.ip ?? null,
        ]);
      });
      await rm(join(this.opts.storeDir, moduleId), { recursive: true, force: true });
      await this.finishOp(opId, true, undefined, { backup });
      await this.opts.broadcastInvalidate();
      await this.opts.requestReload(`${moduleId} uninstalled`);
      return { operationId: opId, backup };
    } catch (err) {
      await this.finishOp(opId, false, (err as Error).message);
      throw conflict('UNINSTALL_FAILED', `حذف نصب انجام نشد: ${(err as Error).message}`, { operationId: opId });
    }
  }

  /** Installs official packages shipped with the deployment image (same verification path; docs/03 §11). */
  async bootstrapPreinstalled(dir: string, actor: Actor, log: (l: string) => void): Promise<void> {
    const { readdir } = await import('node:fs/promises');
    if (!existsSync(dir)) return;
    for (const f of (await readdir(dir)).filter((x) => x.endsWith('.mypkg')).sort()) {
      const tmp = join(this.opts.uploadDir, `boot-${uuidv7()}.mypkg`);
      await mkdir(this.opts.uploadDir, { recursive: true });
      await cp(join(dir, f), tmp);
      const preview = await this.upload(tmp, actor);
      if (preview.kind === 'reinstall' && preview.currentVersion) {
        log(`${f}: already installed`);
        await rm(join(this.opts.uploadDir, preview.uploadId), { recursive: true, force: true });
        continue;
      }
      if (!preview.ok) {
        log(`${f}: rejected — ${preview.checks.filter((c) => !c.ok).map((c) => c.message).join('; ')}`);
        continue;
      }
      const r = await this.install(preview.uploadId, actor);
      await this.setGlobal(r.moduleId, true, actor).catch(() => undefined);
      log(`${f}: installed ${r.moduleId}@${r.version}`);
    }
  }
}

/** Manifest role grants: "key" (company scope) or "key@scope" (e.g. "projects.project.view@project"). */
export function parseGrant(g: string): { permission: string; scope: 'company' | 'unit' | 'project' | 'own' } {
  const [permission, scope] = g.split('@') as [string, string | undefined];
  if (scope === undefined) return { permission, scope: 'company' };
  if (scope !== 'company' && scope !== 'unit' && scope !== 'project' && scope !== 'own') throw new Error(`invalid grant scope in "${g}"`);
  return { permission, scope };
}
