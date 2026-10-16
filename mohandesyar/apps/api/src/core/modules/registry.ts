import { sql } from 'drizzle-orm';
import type { ModuleManifest } from '@mohandesyar/module-sdk';
import type { Database } from '../../infra/db.js';
import { EntitlementService, type AccessMode } from '../entitlement/entitlement.service.js';
import type { LoadedModule } from './loader.js';

export interface GlobalModuleState {
  id: string;
  state: string;
  activeVersion: string | null;
  previousVersion: string | null;
  globallyEnabled: boolean;
  manifest: ModuleManifest | null;
}

export interface EffectiveModule {
  id: string;
  version: string;
  mode: AccessMode;
  manifest: ModuleManifest;
}

export type ModuleCheck = { ok: true; mode: AccessMode; module: LoadedModule } | { ok: false; reason: 'NOT_LOADED' | 'DISABLED' | 'NOT_ENTITLED' | 'DEPENDENCY_INACTIVE' | 'BLOCKED' };

/**
 * Runtime view of modules for this process: which module code is loaded, and — per tenant — which
 * modules are *effective* (docs/03 §8): installed ∧ globally enabled ∧ enabled for tenant ∧ entitled
 * ∧ every required dependency effective. Cached briefly; invalidated on lifecycle changes (Redis pub/sub
 * fan-out across instances).
 */
export class ModuleRegistry {
  readonly loaded = new Map<string, LoadedModule>();
  readonly loadErrors = new Map<string, string>();
  private global: { at: number; value: Map<string, GlobalModuleState> } | null = null;
  private tenant = new Map<string, { at: number; value: EffectiveModule[] }>();

  constructor(
    private readonly db: Database,
    readonly entitlement: EntitlementService,
    private readonly ttlMs = 5_000,
  ) {}

  invalidate(tenantId?: string): void {
    this.global = null;
    if (tenantId) this.tenant.delete(tenantId);
    else this.tenant.clear();
    this.entitlement.invalidate(tenantId);
  }

  async globalStates(): Promise<Map<string, GlobalModuleState>> {
    if (this.global && Date.now() - this.global.at < this.ttlMs) return this.global.value;
    const r = await this.db.app.execute(sql`
      SELECT m.id, m.state, m.active_version, m.previous_version, m.globally_enabled, v.manifest
        FROM core_modules m LEFT JOIN core_module_versions v ON v.module_id = m.id AND v.version = m.active_version`);
    const value = new Map<string, GlobalModuleState>();
    for (const row of r.rows as { id: string; state: string; active_version: string | null; previous_version: string | null; globally_enabled: boolean; manifest: ModuleManifest | null }[]) {
      value.set(row.id, {
        id: row.id,
        state: row.state,
        activeVersion: row.active_version,
        previousVersion: row.previous_version,
        globallyEnabled: row.globally_enabled,
        manifest: row.manifest,
      });
    }
    this.global = { at: Date.now(), value };
    return value;
  }

  async effectiveFor(tenantId: string): Promise<EffectiveModule[]> {
    const hit = this.tenant.get(tenantId);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;
    const [states, ent, enabledRows] = await Promise.all([
      this.globalStates(),
      this.entitlement.get(tenantId),
      this.db.app.execute(sql`SELECT module_id FROM core_tenant_modules WHERE tenant_id = ${tenantId} AND enabled`),
    ]);
    const enabled = new Set((enabledRows.rows as { module_id: string }[]).map((r) => r.module_id));
    const candidates = new Map<string, EffectiveModule>();
    for (const id of enabled) {
      const s = states.get(id);
      const loaded = this.loaded.get(id);
      if (!s || s.state !== 'installed' || !s.globallyEnabled || !loaded || loaded.version !== s.activeVersion) continue;
      if (!ent.modules.has(id)) continue;
      const mode = EntitlementService.accessMode(ent, loaded.manifest.expiryPolicy.mode);
      if (mode === 'blocked') continue;
      candidates.set(id, { id, version: loaded.version, mode, manifest: loaded.manifest });
    }
    // Drop modules whose required dependencies are not effective, until stable.
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, m] of candidates) {
        if (Object.keys(m.manifest.dependencies).some((dep) => !candidates.has(dep))) {
          candidates.delete(id);
          changed = true;
        }
      }
    }
    const value = [...candidates.values()].sort((a, b) => a.id.localeCompare(b.id));
    this.tenant.set(tenantId, { at: Date.now(), value });
    return value;
  }

  async check(tenantId: string, moduleId: string): Promise<ModuleCheck> {
    const loaded = this.loaded.get(moduleId);
    if (!loaded) return { ok: false, reason: 'NOT_LOADED' };
    const eff = (await this.effectiveFor(tenantId)).find((m) => m.id === moduleId);
    if (eff) return { ok: true, mode: eff.mode, module: loaded };
    const ent = await this.entitlement.get(tenantId);
    if (!ent.modules.has(moduleId)) return { ok: false, reason: 'NOT_ENTITLED' };
    if (ent.tenantStatus === 'closed') return { ok: false, reason: 'BLOCKED' };
    const deps = Object.keys(loaded.manifest.dependencies);
    if (deps.length) {
      const effIds = new Set((await this.effectiveFor(tenantId)).map((m) => m.id));
      if (deps.some((d) => !effIds.has(d))) return { ok: false, reason: 'DEPENDENCY_INACTIVE' };
    }
    return { ok: false, reason: 'DISABLED' };
  }
}
