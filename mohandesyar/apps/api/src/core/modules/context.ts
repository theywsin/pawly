import type { PermissionScope } from '@mohandesyar/module-sdk';
import { satisfiesRange } from '@mohandesyar/module-sdk';
import type { AuditEntry, BaseModuleContext, Db, ModuleEventContext, ModuleRequestContext, NotificationInput } from '@mohandesyar/module-sdk/server';
import type { Database } from '../../infra/db.js';
import type { AuditService } from '../audit/audit.service.js';
import type { EventBus } from '../events/event-bus.js';
import type { NotificationService } from '../notifications/notification.service.js';
import type { PermissionSet } from '../rbac/permissions.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { WorkflowService } from '../workflow/workflow.service.js';
import type { LoadedModule } from './loader.js';
import type { ModuleRegistry } from './registry.js';

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
