import { SetMetadata, createParamDecorator, type ExecutionContext, type Type } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { ModuleManifest, PermissionScope } from './manifest.js';

/**
 * Server-side SDK for module authors. Everything a module needs from the core is reached through
 * `ModuleRequestContext` (per request) or `ModuleEventContext` (per consumed event); modules never
 * import core internals. See docs/03-module-system.md §9.
 *
 * Module backends are bundled with esbuild, which does not emit decorator metadata, so every
 * constructor injection must use an explicit `@Inject(Token)`.
 */

export const META_PERMISSION = 'mohandesyar:permission';
export const META_PUBLIC = 'mohandesyar:public';
export const META_ALLOW_READ_ONLY = 'mohandesyar:allow-read-only';
export const REQUEST_CONTEXT_KEY = 'mohandesyarContext';

export interface PermissionRequirement {
  key: string;
  /** Narrowest scope the caller must hold; omitted = any scope. */
  scope?: PermissionScope;
}

/** Every module route must declare a permission (or be explicitly public). */
export const RequirePermission = (key: string, scope?: PermissionScope) =>
  SetMetadata(META_PERMISSION, { key, scope } satisfies PermissionRequirement);

/** Allows a mutating route (e.g. export) while the tenant's subscription is read-only. */
export const AllowInReadOnly = () => SetMetadata(META_ALLOW_READ_ONLY, true);

/** Marks a route as not requiring authentication. Rarely appropriate inside modules. */
export const Public = () => SetMetadata(META_PUBLIC, true);

export type Db = NodePgDatabase<Record<string, never>>;

export interface TenantDb {
  /**
   * Runs `fn` inside a transaction whose PostgreSQL settings (`app.tenant_id`, `app.company_ids`,
   * `app.user_id`) are set, so RLS policies apply. Events published in `fn` join the same transaction.
   */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

export interface NotificationInput {
  userIds: string[];
  type: string;
  title: string;
  body?: string;
  link?: string;
}

/** An active member of the tenant, for pickers and for showing names (no other personal data). */
export interface DirectoryUser {
  id: string;
  fullName: string;
  email: string;
}

export interface ModuleServices {
  /** Returns another module's registered public service, or undefined if it is not active for this tenant. */
  get<T>(name: string, range: string): T | undefined;
}

export interface BaseModuleContext {
  readonly tenantId: string;
  readonly moduleId: string;
  readonly db: TenantDb;
  readonly services: ModuleServices;
  readonly modules: { isActive(id: string): boolean };
  publish(type: string, payload: unknown, tx?: Db): Promise<void>;
  audit(entry: AuditEntry, tx?: Db): Promise<void>;
  notify(input: NotificationInput): Promise<void>;
  settings<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<T>;
  /**
   * Creates the tenant's approval workflow `key` (must start with the module id) when it does not exist
   * yet; an existing definition — possibly edited by the organisation — is never overwritten.
   */
  ensureWorkflow(key: string, definition: WorkflowDefinitionInput): Promise<void>;
  /**
   * The organisation's work calendar: weekly days off (JS weekday numbers, Friday = 5) and holidays it
   * entered (ISO dates). Fixed solar official holidays are added by `isWorkingDay` in @mohandesyar/persian.
   */
  workCalendar(): Promise<{ weeklyOff: number[]; holidays: string[] }>;
  /** Active members of the tenant; with `ids`, only those (unknown or inactive ids are left out). */
  directory(ids?: readonly string[]): Promise<DirectoryUser[]>;
  /** Files this module owns (uploaded for it through the host). */
  readonly files: ModuleFileStore;
}

export interface ModuleFileStore {
  /** Erases a file owned by this module (stored object included), e.g. for a retention purge. */
  remove(fileId: string): Promise<void>;
}

export interface WorkflowDefinitionInput {
  title: string;
  steps: { key: string; label: string; approverRole?: string; approverUserId?: string; minAmount?: number }[];
}

export interface StartWorkflowInput {
  /** Workflow definition key (defined per tenant through the core, e.g. by the module's seed). */
  key: string;
  entityType: string;
  entityId: string;
  title: string;
  /** Amount in rial, used for step thresholds and approval limits. */
  amount?: number | null;
}

export interface ModuleFiles extends ModuleFileStore {
  /** Attach a file the current user uploaded for this module (host `upload`) to a record; returns its metadata. */
  claim(fileId: string, entity: { type: string; id: string }, tx?: Db): Promise<{ id: string; name: string; mime: string; size: number }>;
  /** 5-minute download link; call only after the module's own permission check. Confidential files are audited. */
  url(fileId: string): Promise<{ url: string; name: string }>;
}

export interface ModuleRequestContext extends BaseModuleContext {
  readonly userId: string;
  readonly companyId: string;
  readonly companyIds: readonly string[];
  /** Whether the user holds `permission` for the active company (optionally at least `scope`). */
  can(permission: string, scope?: PermissionScope): boolean;
  /**
   * Starts an approval workflow for one of the module's entities. The outcome arrives as the
   * `core.workflow.completed` event (declare it in manifest.events.consumes).
   */
  startWorkflow(input: StartWorkflowInput, tx?: Db): Promise<{ instanceId: string; state: string }>;
  readonly files: ModuleFiles;
}

export interface ModuleEventContext extends BaseModuleContext {
  readonly companyIds: readonly string[];
}

/** Parameter decorator returning the `ModuleRequestContext` built by the core for this request. */
export const Ctx = createParamDecorator((_data: unknown, ctx: ExecutionContext): ModuleRequestContext => {
  const req = ctx.switchToHttp().getRequest<Record<string, unknown>>();
  const c = req[REQUEST_CONTEXT_KEY] as ModuleRequestContext | undefined;
  if (!c) throw new Error('Module request context missing — route is not mounted under the module router');
  return c;
});

export interface DomainEvent<P = unknown> {
  id: string;
  type: string;
  version: number;
  tenantId: string;
  companyId: string | null;
  occurredAt: string;
  payload: P;
}

export type EventHandler = (event: DomainEvent, ctx: ModuleEventContext) => Promise<void>;

export interface WidgetDataProvider {
  (ctx: ModuleRequestContext, params: Record<string, string>): Promise<unknown>;
}

export interface KpiProvider {
  (ctx: ModuleEventContext, params: { companyId: string; from: string; to: string; dimensions?: Record<string, string> }): Promise<number | null>;
}

export interface SearchHit {
  entityType: string;
  entityId: string;
  title: string;
  snippet?: string;
  link: string;
}

export interface SearchProvider {
  (ctx: ModuleRequestContext, query: string, limit: number): Promise<SearchHit[]>;
}

/**
 * Periodic job, run by the core once per period for every tenant where the module is active
 * (cluster-wide: exactly one worker runs each period). Keep it idempotent.
 */
export interface ScheduledJob {
  everyMinutes: number;
  run(ctx: ModuleEventContext): Promise<void>;
}

export interface ModuleDefinition {
  manifest: ModuleManifest | Record<string, unknown>;
  controllers?: Type[];
  providers?: unknown[];
  /** Public API exposed to other modules, keyed by the names declared in `manifest.provides.services`. */
  publicServices?: Record<string, (ctx: ModuleEventContext) => unknown>;
  eventHandlers?: Record<string, EventHandler>;
  widgetData?: Record<string, WidgetDataProvider>;
  kpiProviders?: Record<string, KpiProvider>;
  searchProviders?: Record<string, SearchProvider>;
  /** Idempotent per-tenant seed, run when the module is enabled for a tenant. */
  seedTenant?: (ctx: ModuleEventContext) => Promise<void>;
  schedules?: Record<string, ScheduledJob>;
}

/** Identity helper giving module authors type checking for their definition. */
export function defineModule(def: ModuleDefinition): ModuleDefinition {
  return def;
}

/**
 * Bare specifiers a module backend bundle may leave external; they resolve to the host's copies at
 * runtime. Anything else must be bundled into the module.
 */
export const SHARED_BACKEND_DEPENDENCIES = [
  '@mohandesyar/module-sdk',
  '@nestjs/common',
  '@nestjs/core',
  'drizzle-orm',
  'zod',
  'rxjs',
  'reflect-metadata',
] as const;

export function isSharedBackendSpecifier(spec: string): boolean {
  return SHARED_BACKEND_DEPENDENCIES.some((d) => spec === d || spec.startsWith(`${d}/`));
}
