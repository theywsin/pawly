import type { PermissionScope } from '@mohandesyar/module-sdk';
import { satisfiesRange } from '@mohandesyar/module-sdk';
import type { AuditEntry, BaseModuleContext, KpiProviderInfo, KpiRegistry, Db, DirectoryUser, ModuleEventContext, ModuleRequestContext, NotificationInput, WorkflowDefinitionInput } from '@mohandesyar/module-sdk/server';
import type { Database } from '../../infra/db.js';
import type { AuditService } from '../audit/audit.service.js';
import type { EventBus } from '../events/event-bus.js';
import type { NotificationService } from '../notifications/notification.service.js';
import type { PermissionSet } from '../rbac/permissions.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { FileService } from '../files/file.service.js';
import type { WorkflowService } from '../workflow/workflow.service.js';
import type { LoadedModule } from './loader.js';
import type { EffectiveModule, ModuleRegistry } from './registry.js';

/** Active members of a tenant (id, name, email) — the only user data modules can read. */
export async function directoryOf(db: Database, tenantId: string, ids?: readonly string[]): Promise<DirectoryUser[]> {
  if (ids && ids.length === 0) return [];
  const { sql } = await import('drizzle-orm');
  return db.tx({ tenantId }, async (tx) => {
    const filter = ids ? sql`AND u.id = ANY(${`{${ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i)).join(',')}}`}::uuid[])` : sql``;
    const r = await tx.execute(sql`SELECT u.id, u.full_name AS "fullName", u.email FROM core_memberships m JOIN core_users u ON u.id = m.user_id
      WHERE m.status = 'active' ${filter} ORDER BY u.full_name`);
    return r.rows as unknown as DirectoryUser[];
  });
}

async function ensureWorkflow(workflow: WorkflowService, db: Database, tenantId: string, moduleId: string, key: string, definition: WorkflowDefinitionInput): Promise<void> {
  if (!key.startsWith(`${moduleId}.`)) throw new Error(`workflow key "${key}" must start with "${moduleId}."`);
  const { sql } = await import('drizzle-orm');
  const exists = await db.tx({ tenantId }, (tx) => tx.execute(sql`SELECT 1 FROM core_workflow_defs WHERE key = ${key} LIMIT 1`));
  if (!exists.rows.length) await workflow.define(tenantId, moduleId, key, definition, null);
}

/** Weekly days off and holidays entered by the organisation. */
export async function workCalendarOf(db: Database, tenantId: string): Promise<{ weeklyOff: number[]; holidays: string[] }> {
  const { sql } = await import('drizzle-orm');
  return db.tx({ tenantId }, async (tx) => {
    const t = await tx.execute(sql`SELECT weekly_off FROM core_tenants WHERE id = ${tenantId}`);
    const h = await tx.execute(sql`SELECT date::text AS date FROM core_holidays ORDER BY date`);
    return { weeklyOff: ((t.rows[0] as { weekly_off: number[] } | undefined)?.weekly_off ?? [5]).map(Number), holidays: (h.rows as { date: string }[]).map((r) => r.date) };
  });
}

export interface RequestIdentity {
  tenantId: string;
  userId: string;
  companyId: string;
  companyIds: readonly string[];
  permissions: PermissionSet;
}

/** Builds the only surface modules get from the core (docs/03 §9). */
export class ModuleContextFactory {
  constructor(
    private readonly db: Database,
    private readonly registry: ModuleRegistry,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly settings: SettingsService,
    private readonly workflow: WorkflowService,
    private readonly files: FileService,
  ) {}

  private async base(module: LoadedModule, tenantId: string, companyIds: readonly string[], userId: string | null, defaultCompany: string | null): Promise<BaseModuleContext> {
    const effective = await this.registry.effectiveFor(tenantId);
    const active = new Set(effective.map((m) => m.id));
    const { db, registry, events, audit, notifications, settings } = this;
    const moduleId = module.id;
    const tenantDb = {
      transaction: <T>(fn: (tx: Db) => Promise<T>) => db.tx({ tenantId, companyIds, userId }, fn as never) as Promise<T>,
    };
    const self: BaseModuleContext = {
      tenantId,
      moduleId,
      db: tenantDb,
      modules: { isActive: (id: string) => active.has(id) },
      services: {
        get: <T>(name: string, range: string): T | undefined => {
          for (const m of effective) {
            const decl = m.manifest.provides.services.find((s) => s.name === name);
            if (!decl || !satisfiesRange(decl.version, range)) continue;
            const provider = registry.loaded.get(m.id)?.definition.publicServices?.[name];
            if (!provider) continue;
            const providerModule = registry.loaded.get(m.id)!;
            // The provider runs with its own module identity but the caller's tenant scope.
            return provider(this.eventContextSync(providerModule, tenantId, companyIds, active, tenantDb)) as T;
          }
          return undefined;
        },
      },
      async publish(type: string, payload: unknown, tx?: Db) {
        if (!module.manifest.events.publishes.some((e) => e.type === type)) throw new Error(`event "${type}" is not declared in manifest.events.publishes`);
        const companyId = defaultCompany;
        if (tx) await events.publish(tx as never, { tenantId, companyId, moduleId, type, payload });
        else await tenantDb.transaction((t) => events.publish(t as never, { tenantId, companyId, moduleId, type, payload }));
      },
      async audit(entry: AuditEntry, tx?: Db) {
        await audit.append({ tenantId, actorType: userId ? 'user' : 'system', actorId: userId, moduleId, ...entry }, tx as never);
      },
      async notify(input: NotificationInput) {
        await notifications.notify({ tenantId, moduleId, ...input });
      },
      async settings<T extends Record<string, unknown>>() {
        return (await settings.getModuleSettings(tenantId, module.manifest)) as T;
      },
      directory: (ids) => directoryOf(db, tenantId, ids),
      workCalendar: () => workCalendarOf(db, tenantId),
      ensureWorkflow: (key, definition) => ensureWorkflow(this.workflow, db, tenantId, moduleId, key, definition),
      files: { remove: (fileId) => this.files.remove({ tenantId, companyIds, userId }, moduleId, fileId) },
      kpi: this.kpiRegistry(effective, tenantId, companyIds, active, tenantDb),
    };
    return self;
  }

  /** Synchronous variant used when handing a public service to another module. */
  private eventContextSync(module: LoadedModule, tenantId: string, companyIds: readonly string[], active: Set<string>, tenantDb: BaseModuleContext['db']): ModuleEventContext {
    const { audit, notifications, settings, events } = this;
    return {
      tenantId,
      moduleId: module.id,
      companyIds,
      db: tenantDb,
      modules: { isActive: (id) => active.has(id) },
      services: { get: () => undefined }, // no transitive service calls from inside a public service
      async publish(type, payload, tx) {
        if (!module.manifest.events.publishes.some((e) => e.type === type)) throw new Error(`event "${type}" is not declared`);
        const write = (t: Db) => events.publish(t as never, { tenantId, companyId: companyIds[0] ?? null, moduleId: module.id, type, payload });
        if (tx) await write(tx);
        else await tenantDb.transaction(write);
      },
      async audit(entry, tx) {
        await audit.append({ tenantId, actorType: 'system', actorId: null, moduleId: module.id, ...entry }, tx as never);
      },
      async notify(input) {
        await notifications.notify({ tenantId, moduleId: module.id, ...input });
      },
      async settings<T extends Record<string, unknown>>() {
        return (await settings.getModuleSettings(tenantId, module.manifest)) as T;
      },
      directory: (ids) => directoryOf(this.db, tenantId, ids),
      workCalendar: () => workCalendarOf(this.db, tenantId),
      ensureWorkflow: (key, definition) => ensureWorkflow(this.workflow, this.db, tenantId, module.id, key, definition),
      files: { remove: (fileId) => this.files.remove({ tenantId, companyIds, userId: null }, module.id, fileId) },
      kpi: { providers: () => [], evaluate: async () => null }, // no transitive provider calls from inside a public service
    };
  }

  private kpiRegistry(effective: EffectiveModule[], tenantId: string, companyIds: readonly string[], active: Set<string>, tenantDb: BaseModuleContext['db']): KpiRegistry {
    const providers = (): KpiProviderInfo[] =>
      effective.flatMap((m) => m.manifest.kpiProviders.map((p) => ({ key: p.key, moduleId: m.id, title: p.title.fa, unit: p.unit })));
    return {
      providers,
      evaluate: async (key, params) => {
        if (!companyIds.includes(params.companyId)) return null;
        const owner = effective.find((m) => m.manifest.kpiProviders.some((p) => p.key === key));
        const loaded = owner && this.registry.loaded.get(owner.id);
        const fn = loaded?.definition.kpiProviders?.[key];
        if (!loaded || !fn) return null;
        const v = await fn(this.eventContextSync(loaded, tenantId, companyIds, active, tenantDb), params);
        return v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
      },
    };
  }

  async forRequest(module: LoadedModule, id: RequestIdentity): Promise<ModuleRequestContext> {
    const base = await this.base(module, id.tenantId, id.companyIds, id.userId, id.companyId);
    return {
      ...base,
      userId: id.userId,
      companyId: id.companyId,
      companyIds: id.companyIds,
      can: (permission: string, scope?: PermissionScope) => id.permissions.can(permission, scope),
      startWorkflow: (input, tx) =>
        this.workflow.start({ tenantId: id.tenantId, companyId: id.companyId, companyIds: id.companyIds, userId: id.userId }, { moduleId: module.id, ...input }, tx as never),
      cancelWorkflow: (instanceId, tx) =>
        this.workflow.cancel({ tenantId: id.tenantId, companyId: id.companyId, companyIds: id.companyIds, userId: id.userId }, module.id, instanceId, tx as never),
      files: {
        remove: base.files.remove,
        claim: (fileId, entity, tx) => {
          return this.files.claim({ tenantId: id.tenantId, companyId: id.companyId, companyIds: id.companyIds, userId: id.userId }, module.id, fileId, entity, tx);
        },
        url: (fileId) => {
          return this.files.downloadUrl({ tenantId: id.tenantId, companyId: id.companyId, companyIds: id.companyIds, userId: id.userId }, fileId, module.id);
        },
      },
    };
  }

  /** Event handlers and seeds run across all companies of the tenant (RLS still pins the tenant). */
  async forTenant(module: LoadedModule, tenantId: string): Promise<ModuleEventContext> {
    const companies = await this.db.tx({ tenantId }, async (tx) => {
      const { sql } = await import('drizzle-orm');
      const r = await tx.execute(sql`SELECT id FROM core_companies`);
      return (r.rows as { id: string }[]).map((x) => x.id);
    });
    const base = await this.base(module, tenantId, companies, null, companies[0] ?? null);
    return { ...base, companyIds: companies };
  }
}
