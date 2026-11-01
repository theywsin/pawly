import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { ImportResult, ImportRow, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { employeeInput } from './inputs.js';

/**
 * Spreadsheet import of employee files (template `hr.employees`): identity, contact, unit, position and hire
 * date only — contracts and salaries are entered per person. Existing personnel numbers or national IDs are rejected.
 */
export async function importEmployees(ctx: ModuleRequestContext, rows: ImportRow[], opts: { dryRun: boolean }): Promise<ImportResult> {
  const { ok, errors } = validateRows(employeeInput, rows);
  errors.push(...duplicatesInFile(ok, (x) => x.personnelNo, 'personnelNo', 'شماره پرسنلی'));
  errors.push(...duplicatesInFile(ok, (x) => x.nationalId, 'nationalId', 'کد ملی'));
  return ctx.db.transaction(async (tx) => {
    for (const x of ok) {
      const d = (await tx.execute(sql`SELECT personnel_no, national_id FROM hr_employees WHERE (company_id = ${ctx.companyId} AND personnel_no = ${x.input.personnelNo}) OR (${x.input.nationalId}::text IS NOT NULL AND national_id = ${x.input.nationalId}) LIMIT 1`)).rows[0] as
        | { personnel_no: string; national_id: string | null }
        | undefined;
      if (d) errors.push({ row: x.row, column: d.personnel_no === x.input.personnelNo ? 'personnelNo' : 'nationalId', message: d.personnel_no === x.input.personnelNo ? `شماره پرسنلی ${x.input.personnelNo} از قبل وجود دارد` : 'پرونده‌ای با این کد ملی از قبل وجود دارد' });
    }
    if (errors.length || opts.dryRun) return { errors, created: ok.length };
    for (const { input } of ok) {
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO hr_employees (id, tenant_id, company_id, personnel_no, full_name, national_id, mobile, email, department, position, hired_on, notes, created_by)
        VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.personnelNo}, ${input.fullName}, ${input.nationalId}, ${input.mobile}, ${input.email}, ${input.department}, ${input.position}, ${input.hiredOn}, ${input.notes}, ${ctx.userId})`);
      await tx.execute(sql`INSERT INTO hr_records (id, tenant_id, company_id, employee_id, kind, occurred_on, title, created_by)
        VALUES (${randomUUID()}, ${ctx.tenantId}, ${ctx.companyId}, ${id}, 'hire', ${input.hiredOn}, ${`شروع همکاری${input.position ? ` — ${input.position}` : ''}`}, ${ctx.userId})`);
      await ctx.audit({ action: 'hr.employee.created', entityType: 'employee', entityId: id, after: { imported: true } }, tx);
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
