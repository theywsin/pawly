import { z } from 'zod';

/** Env booleans: z.coerce.boolean() would turn the string "false" into true. */
const envBool = (def: boolean) =>
  z.enum(['true', 'false', '1', '0', '']).default(def ? 'true' : 'false').transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  DATABASE_MIGRATOR_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  S3_ENDPOINT: z.string().optional(),
  /**
   * Address browsers use for download links when S3_ENDPOINT is internal (e.g. https://example.ir with the
   * reverse proxy forwarding /<bucket>/ to the storage, Host preserved). Empty = S3_ENDPOINT.
   */
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('mohandesyar'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: envBool(true),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  APP_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/, 'APP_ENCRYPTION_KEY must be 32 bytes hex'),
  MODULE_STORE_DIR: z.string().default('/var/lib/mohandesyar/modules'),
  MODULE_UPLOAD_DIR: z.string().default('/var/lib/mohandesyar/uploads'),
  MODULE_BACKUP_DIR: z.string().default('/var/lib/mohandesyar/module-backups'),
  /** Comma separated paths of PEM public keys trusted on first boot (added to core_trusted_keys). */
  MODULE_TRUSTED_KEYS: z.string().default(''),
  PREINSTALLED_MODULES_DIR: z.string().optional(),
  WEB_DIST_DIR: z.string().optional(),
  API_WORKERS: z.coerce.number().int().min(1).default(1),
  COOKIE_SECURE: envBool(true),
  PUBLIC_ORIGIN: z.string().default('http://localhost:3000'),
  /** SMTP server for email copies of notifications, e.g. smtp://user:pass@mail.example.ir:587 (empty = in-app only). */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('مهندیکس <no-reply@localhost>'),
  /**
   * Which peers may set X-Forwarded-For (client IP for rate limits and lead anti-spam): proxy-addr list
   * such as `loopback,uniquelocal` or `10.0.0.5`; `true` trusts everyone (only behind a proxy that overwrites it), `false` nobody.
   */
  TRUST_PROXY: z.string().default('loopback,uniquelocal'),
  /** Allow webhook URLs that resolve to private/loopback addresses (development and tests only). */
  WEBHOOK_ALLOW_PRIVATE: envBool(false),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = schema.safeParse(env);
  if (!r.success) {
    throw new Error(`Invalid configuration:\n${r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  return r.data;
}

export const CORE_VERSION = '1.0.0';
