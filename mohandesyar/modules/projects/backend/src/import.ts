import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { ImportResult, ImportRow, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { projectInput } from './inputs.js';
import { insertProject } from './logic.js';

/** Spreadsheet import of projects (template `projects.projects`); the importing user becomes manager. */
export async function importProjects(ctx: ModuleRequestContext, rows: ImportRow[], opts: { dryRun: boolean }): Promise<ImportResult> {
  const { ok, errors } = validateRows(projectInput, rows);
  errors.push(...duplicatesInFile(ok, (x) => x.code.toLowerCase(), 'code', 'کد پروژه'));
  return ctx.db.transaction(async (tx) => {
    const codes = ok.map((x) => x.input.code);
    if (codes.length) {
      const taken = (await tx.execute(sql`SELECT code FROM projects_projects WHERE company_id = ${ctx.companyId} AND deleted_at IS NULL AND code = ANY (${`{${codes.map((c) => JSON.stringify(c)).join(',')}}`}::text[])`)).rows as { code: string }[];
      for (const x of ok) if (taken.some((t) => t.code === x.input.code)) errors.push({ row: x.row, column: 'code', message: `پروژه‌ای با کد «${x.input.code}» از قبل وجود دارد` });
    }
    if (errors.length || opts.dryRun) return { errors, created: ok.length };
    for (const x of ok) await insertProject(ctx, tx, randomUUID(), x.input, ctx.userId);
    return { errors: [], created: ok.length };
  });
}

// ---- spreadsheet import helpers (same in every module that declares importTemplates)
type Issue = ImportResult['errors'][number];
/** Drops empty cells so schema defaults apply, then validates each row; issues carry the column key. */
function validateRows<S extends z.ZodType>(schema: S, rows: ImportRow[], extra: (v: Record<string, string>) => Record<string, unknown> = () => ({})) {
  const ok: { row: number; input: z.infer<S> }[] = [];
  const errors: Issue[] = [];
  for (const r of rows) {
    const v = Object.fromEntries(Object.entries(r.values).filter((e): e is [string, string] => e[1] !== null));
    const p = schema.safeParse({ ...v, ...extra(v) });
    if (p.success) ok.push({ row: r.row, input: p.data });
    else for (const i of p.error.issues) errors.push({ row: r.row, column: String(i.path[0] ?? ''), message: i.message });
  }
  return { ok, errors };
}
/** Rows whose key repeats an earlier row of the same file. */
function duplicatesInFile<T>(ok: { row: number; input: T }[], key: (x: T) => string | null, column: string, label: string): Issue[] {
  const seen = new Map<string, number>();
  const out: Issue[] = [];
  for (const x of ok) {
    const k = key(x.input);
    if (!k) continue;
    const first = seen.get(k);
    if (first !== undefined) out.push({ row: x.row, column, message: `${label} تکراری است (همان ردیف ${first.toLocaleString('fa-IR')})` });
    else seen.set(k, x.row);
  }
  return out;
}
