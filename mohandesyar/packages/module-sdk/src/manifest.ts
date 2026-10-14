import { z } from 'zod';
import semver from 'semver';

/** Module manifest contract — see docs/03-module-system.md §2. */

const MODULE_ID = /^[a-z][a-z0-9-]{1,30}$/;
const KEY = /^[a-z][a-z0-9-]*(\.[a-z0-9_*-]+)+$/;

const localized = z.object({ fa: z.string().min(1), en: z.string().optional() });

const semverString = z.string().refine((v) => semver.valid(v) !== null, 'نسخه SemVer معتبر نیست');
const semverRange = z.string().refine((v) => semver.validRange(v) !== null, 'بازه نسخه معتبر نیست');

/** Relative path inside the package; no absolute paths and no `..` segments. */
const packagePath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/') && !p.includes('\\') && !p.split('/').includes('..'), 'مسیر باید نسبی و داخل بسته باشد');

export const permissionScopes = ['company', 'unit', 'project', 'own'] as const;
export type PermissionScope = (typeof permissionScopes)[number];

const permission = z.object({
  key: z.string().regex(KEY),
  fa: z.string().min(1),
  scopes: z.array(z.enum(permissionScopes)).min(1).default(['company']),
  sensitive: z.boolean().default(false),
});

const menuItem = z.object({
  key: z.string().min(1),
  label: localized,
  icon: z.string().optional(),
  path: z.string().startsWith('/app/'),
  permission: z.string().regex(KEY).optional(),
  order: z.number().int().default(100),
});

const route = z.object({
  path: z.string().startsWith('/app/'),
  entry: packagePath,
  export: z.string().default('routes'),
});

const widget = z.object({
  key: z.string().regex(KEY),
  title: localized,
  entry: packagePath,
  export: z.string(),
  permission: z.string().regex(KEY).optional(),
  sizes: z.array(z.enum(['sm', 'md', 'lg'])).default(['md']),
});

const provider = z.object({
  key: z.string().regex(KEY),
  title: localized,
  permission: z.string().regex(KEY).optional(),
});

const kpiProvider = provider.extend({
  unit: z.string().default('count'),
  dimensions: z.array(z.string()).default([]),
});

const eventRef = z.object({
  type: z.string().regex(KEY),
  version: z.number().int().positive().default(1),
  optional: z.boolean().default(false),
});

/** Restricted JSON-schema subset used to render settings forms automatically. */
const settingsProperty: z.ZodType<SettingsProperty> = z.lazy(() =>
  z.object({
    type: z.enum(['string', 'number', 'integer', 'boolean', 'array']),
    title: z.string(),
    description: z.string().optional(),
    default: z.unknown().optional(),
    enum: z.array(z.union([z.string(), z.number()])).optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    maxLength: z.number().int().optional(),
    items: settingsProperty.optional(),
  }),
);
export interface SettingsProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  title: string;
  description?: string;
  default?: unknown;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  items?: SettingsProperty;
}

export const manifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    id: z.string().regex(MODULE_ID, 'شناسه ماژول نامعتبر است'),
    name: localized,
    version: semverString,
    description: localized,
    publisher: z.object({ id: z.string().min(1), name: z.string().min(1) }),
    coreVersionRange: semverRange,
    apiVersion: z.number().int().positive().default(1),
    dependencies: z.record(z.string().regex(MODULE_ID), semverRange).default({}),
    optionalDependencies: z.record(z.string().regex(MODULE_ID), semverRange).default({}),
    provides: z.object({ services: z.array(z.object({ name: z.string().regex(KEY), version: semverString })).default([]) }).default({ services: [] }),
    permissions: z.array(permission).default([]),
    defaultRoles: z
      .array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]*$/), name: localized.optional(), grants: z.array(z.string()).min(1) }))
      .default([]),
    menu: z.array(menuItem).default([]),
    routes: z.array(route).default([]),
    widgets: z.array(widget).default([]),
    settings: z
      .object({
        scope: z.array(z.enum(['tenant', 'company'])).default(['tenant']),
        schema: z.object({ type: z.literal('object'), properties: z.record(z.string(), settingsProperty) }),
      })
      .optional(),
    events: z
      .object({ publishes: z.array(eventRef).default([]), consumes: z.array(eventRef).default([]) })
      .default({ publishes: [], consumes: [] }),
    kpiProviders: z.array(kpiProvider).default([]),
    reportProviders: z.array(provider).default([]),
    searchProviders: z.array(provider).default([]),
    backend: z.object({ entry: packagePath }),
    frontend: z.object({ entry: packagePath.optional(), styles: z.array(packagePath).default([]) }).default({ styles: [] }),
    migrations: packagePath.default('migrations/'),
    seed: packagePath.default('seed/'),
    tablePrefix: z.string().regex(/^[a-z][a-z0-9_]*_$/),
    globalTables: z.array(z.string()).default([]),
    sharedDeps: z.record(z.string(), semverRange).default({}),
    disablePolicy: z.object({ keepData: z.literal(true).default(true), blockIfDependents: z.boolean().default(true) }).default({ keepData: true, blockIfDependents: true }),
    uninstallPolicy: z
      .object({ dataDefault: z.enum(['keep', 'purge']).default('keep'), allowPurge: z.boolean().default(true), requiresBackup: z.boolean().default(true) })
      .default({ dataDefault: 'keep', allowPurge: true, requiresBackup: true }),
    expiryPolicy: z.object({ mode: z.enum(['read-only', 'hidden-keep-data']).default('read-only') }).default({ mode: 'read-only' }),
    entitlement: z.object({ key: z.string().min(1), plans: z.array(z.string()).default([]) }),
  })
  .superRefine((m, ctx) => {
    const prefix = `${m.id}.`;
    const expectPrefixed = (keys: string[], path: string) => {
      for (const k of keys) {
        if (!k.startsWith(prefix)) ctx.addIssue({ code: 'custom', path: [path], message: `کلید «${k}» باید با «${prefix}» شروع شود` });
      }
    };
    expectPrefixed(m.permissions.map((p) => p.key), 'permissions');
    expectPrefixed(m.widgets.map((w) => w.key), 'widgets');
    expectPrefixed([...m.kpiProviders, ...m.reportProviders, ...m.searchProviders].map((p) => p.key), 'providers');
    expectPrefixed(m.events.publishes.map((e) => e.type), 'events');
    expectPrefixed(m.provides.services.map((s) => s.name), 'provides');
    const expectedPrefix = `${m.id.replaceAll('-', '_')}_`;
    if (m.tablePrefix !== expectedPrefix) {
      ctx.addIssue({ code: 'custom', path: ['tablePrefix'], message: `پیشوند جداول باید «${expectedPrefix}» باشد` });
    }
    if (m.id in m.dependencies || m.id in m.optionalDependencies) {
      ctx.addIssue({ code: 'custom', path: ['dependencies'], message: 'ماژول نمی‌تواند به خودش وابسته باشد' });
    }
    const permKeys = new Set(m.permissions.map((p) => p.key));
    for (const item of [...m.menu, ...m.widgets]) {
      if (item.permission?.startsWith(prefix) && !permKeys.has(item.permission)) {
        ctx.addIssue({ code: 'custom', path: ['menu'], message: `مجوز «${item.permission}» در فهرست مجوزها تعریف نشده است` });
      }
    }
  });

export type ModuleManifest = z.infer<typeof manifestSchema>;
export type ModuleManifestInput = z.input<typeof manifestSchema>;

export type ManifestResult = { ok: true; manifest: ModuleManifest } | { ok: false; errors: string[] };

export function parseManifest(input: unknown): ManifestResult {
  const r = manifestSchema.safeParse(input);
  if (r.success) return { ok: true, manifest: r.data };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
}

/** Checks the manifest's core version range against the running core. */
export function isCoreCompatible(manifest: Pick<ModuleManifest, 'coreVersionRange'>, coreVersion: string): boolean {
  return semver.satisfies(coreVersion, manifest.coreVersionRange, { includePrerelease: true });
}

export function satisfiesRange(version: string, range: string): boolean {
  return semver.satisfies(version, range, { includePrerelease: true });
}

export function compareVersions(a: string, b: string): number {
  return semver.compare(a, b);
}
