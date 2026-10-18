import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ModuleManifest, SettingsProperty } from '@mohandesyar/module-sdk';
import type { Database } from '../../infra/db.js';
import { badRequest } from '../http/errors.js';

function propertySchema(p: SettingsProperty): z.ZodType {
  let s: z.ZodType;
  switch (p.type) {
    case 'string': {
      let x = z.string();
      if (p.maxLength) x = x.max(p.maxLength);
      s = p.enum ? z.enum(p.enum.map(String) as [string, ...string[]]) : x;
      break;
    }
    case 'number':
    case 'integer': {
      let x = p.type === 'integer' ? z.number().int() : z.number();
      if (p.minimum !== undefined) x = x.min(p.minimum);
      if (p.maximum !== undefined) x = x.max(p.maximum);
      s = x;
      break;
    }
    case 'boolean':
      s = z.boolean();
      break;
    case 'array':
      s = z.array(p.items ? propertySchema(p.items) : z.unknown());
      break;
  }
  return s;
}

/** Builds a strict validator from a manifest's restricted settings schema. */
export function settingsValidator(manifest: Pick<ModuleManifest, 'settings'>): z.ZodType<Record<string, unknown>> {
  const props = manifest.settings?.schema.properties ?? {};
  return z.object(Object.fromEntries(Object.entries(props).map(([k, p]) => [k, propertySchema(p).optional()]))).strict();
}

export function settingsDefaults(manifest: Pick<ModuleManifest, 'settings'>): Record<string, unknown> {
  const props = manifest.settings?.schema.properties ?? {};
  return Object.fromEntries(Object.entries(props).filter(([, p]) => p.default !== undefined).map(([k, p]) => [k, p.default]));
}

export class SettingsService {
  constructor(private readonly db: Database) {}

  async getModuleSettings(tenantId: string, manifest: ModuleManifest): Promise<Record<string, unknown>> {
    const r = await this.db.tx({ tenantId }, (tx) =>
      tx.execute(sql`SELECT value FROM core_settings WHERE scope = 'tenant' AND scope_id = ${tenantId} AND module_id = ${manifest.id}`),
    );
    return { ...settingsDefaults(manifest), ...((r.rows[0] as { value: Record<string, unknown> } | undefined)?.value ?? {}) };
  }

  async setModuleSettings(tenantId: string, manifest: ModuleManifest, value: unknown, actorId: string): Promise<Record<string, unknown>> {
    const r = settingsValidator(manifest).safeParse(value);
    if (!r.success) throw badRequest('INVALID_SETTINGS', 'مقادیر تنظیمات معتبر نیست', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    await this.db.tx({ tenantId }, (tx) =>
      tx.execute(sql`INSERT INTO core_settings (tenant_id, scope, scope_id, module_id, value, updated_by)
        VALUES (${tenantId}, 'tenant', ${tenantId}, ${manifest.id}, ${JSON.stringify(r.data)}::jsonb, ${actorId})
        ON CONFLICT (tenant_id, scope, scope_id, module_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`),
    );
    return this.getModuleSettings(tenantId, manifest);
  }
}
