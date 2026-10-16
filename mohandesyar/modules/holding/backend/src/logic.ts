import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { aggregate, jalaliMonths } from './calc.js';
import { conflict, forbidden, invalid, notFound } from './errors.js';
import type { compareInput, trendInput, viewInput } from './inputs.js';

/** Companies whose data this user may see in holding reports: holding.view in that very company. */
export async function companies(ctx: ModuleRequestContext) {
  return (await ctx.companies()).filter((c) => ctx.canIn(c.id, 'holding.view'));
}

/** KPI providers of the active modules (the comparison's columns). */
export function providers(ctx: ModuleRequestContext) {
  return ctx.kpi.providers().map((p) => ({ key: p.key, moduleId: p.moduleId, title: p.title, unit: p.unit }));
}

async function pick(ctx: ModuleRequestContext, requested?: string[]) {
  const mine = await companies(ctx);
  if (!requested?.length) return mine;
  if (requested.some((id) => !mine.some((c) => c.id === id))) throw forbidden('به داده یکی از شرکت‌های انتخاب‌شده دسترسی ندارید');
  return mine.filter((c) => requested.includes(c.id));
}
function known(ctx: ModuleRequestContext, keys: string[]) {
  const all = providers(ctx);
  const missing = keys.filter((k) => !all.some((p) => p.key === k));
  if (missing.length) throw invalid('PROVIDER', `شاخص در ماژول‌های فعال یافت نشد: ${missing.join('، ')}`);
  return keys.map((k) => all.find((p) => p.key === k)!);
}

/**
 * Company × indicator matrix for a period. Each value comes from the owning module's provider for that
 * company; null means the provider has no data (not zero). Totals: sum for counts/amounts, average otherwise.
 */
export async function compare(ctx: ModuleRequestContext, input: z.infer<typeof compareInput>) {
  const cols = known(ctx, input.providers);
  const list = await pick(ctx, input.companyIds);
  const rows: { companyId: string; name: string; values: Record<string, number | null> }[] = [];
  for (const c of list) {
    const values: Record<string, number | null> = {};
    for (const p of cols) values[p.key] = await ctx.kpi.evaluate(p.key, { companyId: c.id, from: input.from, to: input.to });
    rows.push({ companyId: c.id, name: c.name, values });
  }
  const totals = Object.fromEntries(cols.map((p) => [p.key, aggregate(p.unit, rows.map((r) => r.values[p.key] ?? null))]));
  return { columns: cols, rows, totals, period: { from: input.from, to: input.to } };
}

/** One indicator per company per Jalali month (oldest first). */
export async function trend(ctx: ModuleRequestContext, input: z.infer<typeof trendInput>) {
  const [col] = known(ctx, [input.provider]);
  const months = jalaliMonths(input.to, input.months);
  const list = await pick(ctx, input.companyIds);
  const series: { companyId: string; name: string; points: (number | null)[] }[] = [];
  for (const c of list) {
    const points: (number | null)[] = [];
    for (const m of months) points.push(await ctx.kpi.evaluate(col!.key, { companyId: c.id, from: m.from, to: m.to }));
    series.push({ companyId: c.id, name: c.name, points });
  }
  return { provider: col, months: months.map((m) => m.label), series };
}

export const Views = {
  list: (ctx: ModuleRequestContext) =>
    ctx.db.transaction(async (tx) => (await tx.execute(sql`SELECT id, name, providers, created_by, created_at FROM holding_views WHERE company_id = ${ctx.companyId} ORDER BY name`)).rows),
  async save(ctx: ModuleRequestContext, input: z.infer<typeof viewInput>) {
    known(ctx, input.providers);
    return ctx.db.transaction(async (tx) => {
      const id = randomUUID();
      try {
        await tx.execute(sql`INSERT INTO holding_views (id, tenant_id, company_id, name, providers, created_by)
          VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.name}, ${`{${input.providers.join(',')}}`}::text[], ${ctx.userId})`);
      } catch (e) {
        if ((e as { cause?: { code?: string } }).cause?.code === '23505') throw conflict('DUPLICATE', 'نمایی با این نام وجود دارد');
        throw e;
      }
      await ctx.audit({ action: 'holding.view.saved', entityType: 'holding_view', entityId: id, after: input }, tx);
      return { id };
    });
  },
  async remove(ctx: ModuleRequestContext, id: string) {
    await ctx.db.transaction(async (tx) => {
      if (!(await tx.execute(sql`DELETE FROM holding_views WHERE id = ${id} AND company_id = ${ctx.companyId} RETURNING id`)).rows.length) throw notFound('نما');
    });
  },
};
