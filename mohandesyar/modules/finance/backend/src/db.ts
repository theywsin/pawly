import { sql, type SQL } from 'drizzle-orm';
import type { Db, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { forbidden } from './errors.js';

export type Row = Record<string, unknown>;
export const rows = async <T = Row>(tx: Db, q: SQL) => (await tx.execute(q)).rows as T[];
export const one = async <T = Row>(tx: Db, q: SQL) => (await rows<T>(tx, q))[0];
export const uuids = (ids: string[]) => sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);

/** Signed amount of a transaction row: in = +, out = −. */
export const SIGNED = sql`CASE WHEN t.direction = 'in' THEN t.amount ELSE -t.amount END`;

type ProjectsService = { memberOf(userId: string): Promise<string[]>; get(id: string): Promise<{ id: string; code: string; title: string } | null>; search(q: string, limit: number): Promise<{ id: string; code: string; title: string }[]>; progress?(id: string, today: string): Promise<{ planned: number | null; actual: number | null } | null> };
export const projectsOf = (ctx: ModuleRequestContext | { services: ModuleRequestContext['services'] }) => ctx.services.get<ProjectsService>('projects.projects', '^1');

/**
 * Projects the user may act on with `permission`: null = all (company scope); otherwise the projects they
 * manage or belong to (project scope, through the projects module). Empty when neither applies.
 */
export async function projectScope(ctx: ModuleRequestContext, permission: string): Promise<string[] | null> {
  if (ctx.can(permission, 'company')) return null;
  if (!ctx.can(permission, 'project')) return [];
  const svc = projectsOf(ctx);
  return svc ? svc.memberOf(ctx.userId) : [];
}

export async function assertProject(ctx: ModuleRequestContext, permission: string, projectId: string | null) {
  const scope = await projectScope(ctx, permission);
  if (scope === null) return;
  if (!projectId || !scope.includes(projectId)) throw forbidden('این کار فقط برای پروژه‌هایی که عضو آن هستید ممکن است');
}

/** Validates soft links to other modules: the project must exist when the projects module is active. */
export async function checkProject(ctx: ModuleRequestContext, projectId: string | null) {
  if (!projectId) return null;
  const svc = projectsOf(ctx);
  if (!svc) return null;
  const p = await svc.get(projectId);
  if (!p) throw forbidden('پروژه یافت نشد');
  return p;
}
