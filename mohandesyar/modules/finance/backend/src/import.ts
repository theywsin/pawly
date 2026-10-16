import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { ImportResult, ImportRow, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { counterpartyInput } from './inputs.js';

/** Spreadsheet import of counterparties (template `finance.counterparties`); an existing name is rejected. */
export async function importCounterparties(ctx: ModuleRequestContext, rows: ImportRow[], opts: { dryRun: boolean }): Promise<ImportResult> {
  const { ok, errors } = validateRows(counterpartyInput, rows);
  errors.push(...duplicatesInFile(ok, (x) => x.name.toLowerCase(), 'name', 'نام'));
  return ctx.db.transaction(async (tx) => {
    for (const x of ok) {
      if ((await tx.execute(sql`SELECT 1 FROM finance_counterparties WHERE company_id = ${ctx.companyId} AND lower(name) = lower(${x.input.name})`)).rows.length) {
        errors.push({ row: x.row, column: 'name', message: `طرف‌حساب «${x.input.name}» از قبل وجود دارد` });
      }
    }
    if (errors.length || opts.dryRun) return { errors, created: ok.length };
    for (const { input } of ok) {
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO finance_counterparties (id, tenant_id, company_id, kind, name, national_id, phone, iban, notes, archived)
        VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.kind}, ${input.name}, ${input.nationalId}, ${input.phone}, ${input.iban}, ${input.notes}, false)`);
      await ctx.audit({ action: 'finance.counterparty.saved', entityType: 'finance_counterparty', entityId: id, after: { imported: true } }, tx);
    }
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
