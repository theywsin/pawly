import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { migrateCore } from '../../src/core/migrations/runner.js';
import { apiRoot } from '../../src/infra/paths.js';
import { CORE_VERSION } from '../../src/config.js';

export const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? 'postgres://postgres@127.0.0.1:54329/postgres';
const OWNER_PW = 'owner_test_pw';
const APP_PW = 'app_test_pw';

export interface TestDatabase {
  name: string;
  appUrl: string;
  migratorUrl: string;
  drop(): Promise<void>;
}

function withDb(url: string, db: string, user?: string, pw?: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  if (user) {
    u.username = user;
    u.password = pw ?? '';
  }
  return u.toString();
}

/** Creates an isolated database with the production role layout and the core schema migrated. */
export async function createTestDatabase(opts: { migrate?: boolean } = {}): Promise<TestDatabase> {
  const name = `my_test_${randomBytes(5).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mohandesyar_owner') THEN CREATE ROLE mohandesyar_owner LOGIN PASSWORD '${OWNER_PW}'; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mohandesyar_app') THEN CREATE ROLE mohandesyar_app LOGIN NOBYPASSRLS PASSWORD '${APP_PW}'; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mohandesyar_definer') THEN CREATE ROLE mohandesyar_definer NOLOGIN BYPASSRLS; END IF;
    END $$`);
    await admin.query('GRANT mohandesyar_definer TO mohandesyar_owner');
    await admin.query(`CREATE DATABASE ${name} OWNER mohandesyar_owner`);
  } finally {
    await admin.end();
  }
  const dbAdmin = new pg.Client({ connectionString: withDb(ADMIN_URL, name) });
  await dbAdmin.connect();
  try {
    await dbAdmin.query(`REVOKE ALL ON SCHEMA public FROM PUBLIC;
      ALTER SCHEMA public OWNER TO mohandesyar_owner;
      GRANT USAGE ON SCHEMA public TO mohandesyar_app, mohandesyar_definer;
      GRANT CREATE ON SCHEMA public TO mohandesyar_definer;
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
      CREATE EXTENSION IF NOT EXISTS ltree;`);
  } finally {
    await dbAdmin.end();
  }
  const appUrl = withDb(ADMIN_URL, name, 'mohandesyar_app', APP_PW);
  const migratorUrl = withDb(ADMIN_URL, name, 'mohandesyar_owner', OWNER_PW);
  if (opts.migrate !== false) {
    const pool = new pg.Pool({ connectionString: migratorUrl, max: 1 });
    try {
      await migrateCore(pool, join(apiRoot(), 'migrations', 'core'), CORE_VERSION);
    } finally {
      await pool.end();
    }
  }
  return {
    name,
    appUrl,
    migratorUrl,
    async drop() {
      const c = new pg.Client({ connectionString: ADMIN_URL });
      await c.connect();
      try {
        await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await c.end();
      }
    },
  };
}

/** Drizzle wraps driver errors; returns the underlying PostgreSQL message. */
export function pgMessage(err: unknown): string {
  const e = err as { message?: string; cause?: { message?: string } };
  return `${e.message ?? ''} ${e.cause?.message ?? ''}`;
}
