import { hostname } from 'node:os';
import { CORE_VERSION, type Config } from '../config.js';
import { Database } from '../infra/db.js';
import { createRedis, type Redis } from '../infra/redis.js';
import { AuditService } from '../core/audit/audit.service.js';
import { AuthService } from '../core/auth/auth.service.js';
import { Jwt } from '../core/auth/jwt.js';
import { EntitlementService } from '../core/entitlement/entitlement.service.js';
import { EventBus } from '../core/events/event-bus.js';
import { ModuleContextFactory } from '../core/modules/context.js';
import { ModuleLifecycleService } from '../core/modules/lifecycle.service.js';
import { ModuleRegistry } from '../core/modules/registry.js';
import { NotificationService } from '../core/notifications/notification.service.js';
import { RbacService } from '../core/rbac/rbac.service.js';
import { SettingsService } from '../core/settings/settings.service.js';
import { TenancyService } from '../core/tenancy/tenancy.service.js';
import { TaskService } from '../core/tasks/task.service.js';
import { WorkflowService } from '../core/workflow/workflow.service.js';
import { FileService } from '../core/files/file.service.js';
import { ModuleScheduler } from '../core/modules/scheduler.js';
import { ReportService } from '../core/reports/report.service.js';
import { IntegrationService } from '../core/integrations/integration.service.js';
import { Mailer } from '../core/notifications/mailer.js';
import { logger } from '../infra/logger.js';
import { SiteService } from '../platform/site.service.js';
import { MediaService } from '../platform/media.service.js';
import { BlogService } from '../platform/blog.service.js';
import { BillingService } from '../platform/billing.service.js';

export const RELOAD_CHANNEL = 'mohandesyar:reload';
export const MODULE_STATE_CHANNEL = 'mohandesyar:module-state';

export interface ServiceOptions {
  /** Overrides the reload request (tests rebuild the app in-process instead of restarting workers). */
  requestReload?: (reason: string) => Promise<void>;
  dryLoad?: (storeDir: string, id: string, version: string) => Promise<void>;
}

export class Services {
  readonly instanceId = `${hostname()}:${process.pid}`;
  readonly bootedAt = new Date();
  readonly db: Database;
  readonly redis: Redis;
  readonly sub: Redis;
  readonly jwt: Jwt;
  readonly audit: AuditService;
  readonly rbac: RbacService;
  readonly tenancy: TenancyService;
  readonly auth: AuthService;
  readonly entitlement: EntitlementService;
  readonly registry: ModuleRegistry;
  readonly events: EventBus;
  readonly notifications: NotificationService;
  readonly settings: SettingsService;
  readonly contexts: ModuleContextFactory;
  readonly lifecycle: ModuleLifecycleService;
  readonly tasks: TaskService;
  readonly workflow: WorkflowService;
  readonly files: FileService;
  readonly site: SiteService;
  readonly media: MediaService;
  readonly blog: BlogService;
  readonly billing: BillingService;
  readonly scheduler: ModuleScheduler;
  readonly mailer: Mailer;
  readonly reports: ReportService;
  readonly integrations: IntegrationService;

  constructor(
    readonly config: Config,
    opts: ServiceOptions = {},
  ) {
    this.db = new Database(config.DATABASE_URL, config.DATABASE_MIGRATOR_URL);
    this.redis = createRedis(config.REDIS_URL);
    this.sub = createRedis(config.REDIS_URL);
    this.jwt = new Jwt(config.JWT_SECRET);
    this.audit = new AuditService(this.db);
    this.rbac = new RbacService(this.db);
    this.tenancy = new TenancyService(this.db, this.rbac, this.audit);
    this.auth = new AuthService(this.db, this.redis, this.jwt, this.audit, config.APP_ENCRYPTION_KEY);
    this.entitlement = new EntitlementService(this.db);
    this.registry = new ModuleRegistry(this.db, this.entitlement);
    this.mailer = new Mailer(this.db, config.SMTP_URL, config.MAIL_FROM, (err, ctx) => logger.warn({ err, ...ctx }, 'email delivery failed'));
    this.notifications = new NotificationService(this.db, this.redis, [], this.mailer.enabled ? { origin: config.PUBLIC_ORIGIN } : null);
    this.settings = new SettingsService(this.db);
    this.events = new EventBus(
      this.db,
      async (tenantId, moduleId) => (await this.registry.effectiveFor(tenantId)).some((m) => m.id === moduleId),
      (err, ctx) => logger.error({ err, ...ctx }, 'event dispatch failed'),
    );
    this.tasks = new TaskService(this.db, this.audit, this.notifications);
    this.workflow = new WorkflowService(this.db, this.audit, this.notifications, this.events);
    this.files = new FileService(this.db, this.audit, config);
    this.contexts = new ModuleContextFactory(this.db, this.registry, this.events, this.audit, this.notifications, this.settings, this.workflow, this.files);
    this.scheduler = new ModuleScheduler(this.db, this.redis, this.registry, this.contexts, (err, ctx) => logger.error({ err, ...ctx }, 'scheduled job failed'));
    this.reports = new ReportService(this);
    this.scheduler.extraJobs.push(() => this.reports.tick());
    this.integrations = new IntegrationService(this, {
      encryptionKey: config.APP_ENCRYPTION_KEY,
      allowPrivate: config.WEBHOOK_ALLOW_PRIVATE,
      onError: (err, ctx) => logger.warn({ err, ...ctx }, 'webhook delivery failed'),
    });
    this.site = new SiteService(this.db, this.redis, this.audit, config.JWT_SECRET);
    this.media = new MediaService(this.db, this.files, this.audit);
    this.blog = new BlogService(this.db, this.audit);
    this.lifecycle = new ModuleLifecycleService(this.db, this.registry, this.rbac, this.audit, this.contexts, {
      storeDir: config.MODULE_STORE_DIR,
      uploadDir: config.MODULE_UPLOAD_DIR,
      backupDir: config.MODULE_BACKUP_DIR,
      coreVersion: CORE_VERSION,
      requestReload: opts.requestReload ?? (async (reason) => void (await this.redis.publish(RELOAD_CHANNEL, JSON.stringify({ reason, from: this.instanceId })))),
      broadcastInvalidate: async (tenantId) => {
        this.registry.invalidate(tenantId);
        await this.redis.publish(MODULE_STATE_CHANNEL, JSON.stringify({ tenantId: tenantId ?? null, from: this.instanceId }));
      },
      dryLoad: opts.dryLoad,
    });
    this.billing = new BillingService(this);
    this.scheduler.extraJobs.push(async () => (await this.billing.reconcile(), 0));
    void this.sub.subscribe(MODULE_STATE_CHANNEL);
    this.sub.on('message', (channel, msg) => {
      if (channel !== MODULE_STATE_CHANNEL) return;
      const { tenantId } = JSON.parse(msg) as { tenantId: string | null };
      this.registry.invalidate(tenantId ?? undefined);
    });
  }

  async close(): Promise<void> {
    await this.events.stop();
    await this.integrations.stop();
    this.sub.disconnect();
    this.redis.disconnect();
    await this.db.close();
  }
}
