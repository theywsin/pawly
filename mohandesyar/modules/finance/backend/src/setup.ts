import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { conflict, invalid, notFound } from './errors.js';
import { one, rows, SIGNED } from './db.js';
import type { accountInput, categoryInput, costCenterInput, counterpartyInput } from './inputs.js';

export const DEFAULT_CATEGORIES: { kind: 'income' | 'expense'; name: string }[] = [
  { kind: 'income', name: 'درآمد پیمان و صورت‌وضعیت' },
  { kind: 'income', name: 'پیش‌دریافت' },
  { kind: 'income', name: 'سایر درآمدها' },
  { kind: 'expense', name: 'مصالح و تجهیزات' },
  { kind: 'expense', name: 'پیمانکار جزء و دستمزد' },
  { kind: 'expense', name: 'ماشین‌آلات' },
  { kind: 'expense', name: 'حقوق و مزایای کارکنان' },
  { kind: 'expense', name: 'اداری و عمومی' },
  { kind: 'expense', name: 'مالیات، عوارض و بیمه' },
  { kind: 'expense', name: 'سایر هزینه‌ها' },
];

/** Categories of a company; the default chart is created the first time the company uses finance. */
export async function categoriesOf(tx: Db, tenantId: string, companyId: string) {
  const q = sql`SELECT id, kind, name, parent_id, archived FROM finance_categories WHERE company_id = ${companyId} ORDER BY kind, created_at, name`;
  let c = await rows<{ id: string; kind: string; name: string; parent_id: string | null; archived: boolean }>(tx, q);
  if (!c.length) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`finance-categories:${companyId}`}))`);
    c = await rows(tx, q);
    if (!c.length) {
      for (const d of DEFAULT_CATEGORIES) {
        await tx.execute(sql`INSERT INTO finance_categories (id, tenant_id, company_id, kind, name, created_at) VALUES (${randomUUID()}, ${tenantId}, ${companyId}, ${d.kind}, ${d.name}, clock_timestamp())`);
      }
      c = await rows(tx, q);
    }
  }
  return c;
}

/** Balance of each account = opening balance + all movements (a voided entry and its reversal cancel out). */
export async function balances(tx: Db, asOf?: string) {
  return rows<{ id: string; kind: string; name: string; bank_name: string; number: string; iban: string | null; custodian_id: string | null; archived: boolean; opening_balance: string; opening_on: string; balance: string }>(
    tx,
    sql`SELECT a.id, a.kind, a.name, a.bank_name, a.number, a.iban, a.custodian_id, a.archived, a.opening_balance::text, a.opening_on::text,
        (a.opening_balance + coalesce((SELECT sum(${SIGNED}) FROM finance_transactions t WHERE t.account_id = a.id ${asOf ? sql`AND t.occurred_on <= ${asOf}::date` : sql``}), 0))::text AS balance
      FROM finance_accounts a ORDER BY a.archived, a.kind, a.name`,
  );
}

export const Setup = {
  accounts: (ctx: ModuleRequestContext) => ctx.db.transaction((tx) => balances(tx)),

  async saveAccount(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof accountInput>) {
    if (input.custodianId && !(await ctx.directory([input.custodianId])).length) throw invalid('UNKNOWN_USER', 'متصدی حساب عضو فعال سازمان نیست');
    return ctx.db.transaction(async (tx) => {
      if (id) {
        const used = await one(tx, sql`SELECT 1 FROM finance_transactions WHERE account_id = ${id} LIMIT 1`);
        const cur = await one<{ opening_balance: string; opening_on: string; kind: string }>(tx, sql`SELECT opening_balance::text, opening_on::text, kind FROM finance_accounts WHERE id = ${id} FOR UPDATE`);
        if (!cur) throw notFound('حساب');
        if (used && (cur.opening_balance !== input.openingBalance || cur.opening_on !== input.openingOn || cur.kind !== input.kind)) {
          throw conflict('ACCOUNT_IN_USE', 'نوع، مانده افتتاحیه و تاریخ آن برای حسابی که تراکنش دارد قابل تغییر نیست');
        }
        await tx.execute(sql`UPDATE finance_accounts SET kind = ${input.kind}, name = ${input.name}, bank_name = ${input.bankName}, number = ${input.number}, iban = ${input.iban},
          custodian_id = ${input.custodianId}, opening_balance = ${input.openingBalance}, opening_on = ${input.openingOn}, archived = ${input.archived} WHERE id = ${id}`);
      } else {
        id = randomUUID();
        await tx.execute(sql`INSERT INTO finance_accounts (id, tenant_id, company_id, kind, name, bank_name, number, iban, custodian_id, opening_balance, opening_on, archived, created_by)
          VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.kind}, ${input.name}, ${input.bankName}, ${input.number}, ${input.iban}, ${input.custodianId}, ${input.openingBalance}, ${input.openingOn}, ${input.archived}, ${ctx.userId})`);
      }
      await ctx.audit({ action: 'finance.account.saved', entityType: 'finance_account', entityId: id, after: input }, tx);
      return { id };
    });
  },

  categories: (ctx: ModuleRequestContext) => ctx.db.transaction((tx) => categoriesOf(tx, ctx.tenantId, ctx.companyId)),

  async saveCategory(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof categoryInput>) {
    return ctx.db.transaction(async (tx) => {
      await categoriesOf(tx, ctx.tenantId, ctx.companyId);
      if (input.parentId) {
        const p = await one<{ kind: string }>(tx, sql`SELECT kind FROM finance_categories WHERE id = ${input.parentId}`);
        if (!p || p.kind !== input.kind || input.parentId === id) throw invalid('PARENT', 'سرفصل والد باید از همان نوع باشد');
      }
      const dup = await one(tx, sql`SELECT 1 FROM finance_categories WHERE company_id = ${ctx.companyId} AND kind = ${input.kind} AND name = ${input.name} ${id ? sql`AND id <> ${id}` : sql``}`);
      if (dup) throw conflict('DUPLICATE', 'سرفصلی با این نام وجود دارد');
      if (id) {
        const cur = await one<{ kind: string }>(tx, sql`SELECT kind FROM finance_categories WHERE id = ${id}`);
        if (!cur) throw notFound('سرفصل');
        if (cur.kind !== input.kind && (await one(tx, sql`SELECT 1 FROM finance_transactions WHERE category_id = ${id} LIMIT 1`))) throw conflict('IN_USE', 'نوع سرفصلی که تراکنش دارد قابل تغییر نیست');
        await tx.execute(sql`UPDATE finance_categories SET kind = ${input.kind}, name = ${input.name}, parent_id = ${input.parentId}, archived = ${input.archived} WHERE id = ${id}`);
      } else {
        id = randomUUID();
        await tx.execute(sql`INSERT INTO finance_categories (id, tenant_id, company_id, kind, name, parent_id, archived) VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.kind}, ${input.name}, ${input.parentId}, ${input.archived})`);
      }
      return { id };
    });
  },

  costCenters: (ctx: ModuleRequestContext) => ctx.db.transaction((tx) => rows(tx, sql`SELECT id, code, name, archived FROM finance_cost_centers ORDER BY archived, code`)),

  async saveCostCenter(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof costCenterInput>) {
    return ctx.db.transaction(async (tx) => {
      if (await one(tx, sql`SELECT 1 FROM finance_cost_centers WHERE company_id = ${ctx.companyId} AND code = ${input.code} ${id ? sql`AND id <> ${id}` : sql``}`)) throw conflict('DUPLICATE', 'این کد استفاده شده است');
      if (id) {
        const r = await rows(tx, sql`UPDATE finance_cost_centers SET code = ${input.code}, name = ${input.name}, archived = ${input.archived} WHERE id = ${id} RETURNING id`);
        if (!r.length) throw notFound('مرکز هزینه');
      } else {
        id = randomUUID();
        await tx.execute(sql`INSERT INTO finance_cost_centers (id, tenant_id, company_id, code, name, archived) VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.code}, ${input.name}, ${input.archived})`);
      }
      return { id };
    });
  },

  counterparties: (ctx: ModuleRequestContext, q?: string) =>
    ctx.db.transaction((tx) => {
      const like = q ? `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null;
      return rows(tx, sql`SELECT c.id, c.kind, c.name, c.national_id, c.phone, c.iban, c.notes, c.archived, c.procurement_supplier_id,
          (SELECT coalesce(sum(o.amount), 0)::text FROM finance_obligations o WHERE o.counterparty_id = c.id AND o.kind = 'receivable' AND o.status = 'open') AS receivable,
          (SELECT coalesce(sum(o.amount), 0)::text FROM finance_obligations o WHERE o.counterparty_id = c.id AND o.kind = 'payable' AND o.status = 'open') AS payable
        FROM finance_counterparties c WHERE ${like ? sql`c.name ILIKE ${like}` : sql`TRUE`} ORDER BY c.archived, c.name LIMIT 1000`);
    }),

  async saveCounterparty(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof counterpartyInput>) {
    return ctx.db.transaction(async (tx) => {
      if (id) {
        const r = await rows(tx, sql`UPDATE finance_counterparties SET kind = ${input.kind}, name = ${input.name}, national_id = ${input.nationalId}, phone = ${input.phone}, iban = ${input.iban},
          notes = ${input.notes}, archived = ${input.archived} WHERE id = ${id} RETURNING id`);
        if (!r.length) throw notFound('طرف‌حساب');
      } else {
        id = randomUUID();
        await tx.execute(sql`INSERT INTO finance_counterparties (id, tenant_id, company_id, kind, name, national_id, phone, iban, notes, archived)
          VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.kind}, ${input.name}, ${input.nationalId}, ${input.phone}, ${input.iban}, ${input.notes}, ${input.archived})`);
      }
      await ctx.audit({ action: 'finance.counterparty.saved', entityType: 'finance_counterparty', entityId: id }, tx);
      return { id };
    });
  },
};
