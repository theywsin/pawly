import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { ModuleEventContext, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { isoToJalali, jalaliMonthLength, toGregorian, toLatinDigits } from '@mohandesyar/persian';
import { autoMatch, parseStatement } from './calc.js';
import { one, rows, SIGNED } from './db.js';
import { conflict, invalid, notFound } from './errors.js';
import type { cashflowQuery, forecastInput, reportQuery, statementInput } from './inputs.js';
import { balances } from './setup.js';

const jparts = (iso: string) => toLatinDigits(isoToJalali(iso) ?? '').split('/').map(Number) as [number, number, number];
const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

// ---------------------------------------------------------------- cash-flow forecast

export interface FlowItem {
  date: string;
  direction: 'in' | 'out';
  amount: string;
  certainty: 'firm' | 'estimate';
  source: string;
  description: string;
  overdue: boolean;
}

/**
 * Forecast by Jalali month from today's cash. Firm: open receivables/payables (remaining), approved but unpaid
 * payment requests not tied to a payable, pending cheques not tied to an obligation. Estimate: manual entries.
 * Items already past due are placed in the first month and flagged.
 */
export async function cashflow(ctx: ModuleRequestContext, f: z.infer<typeof cashflowQuery>) {
  return ctx.db.transaction(async (tx) => {
    const accounts = (await balances(tx)).filter((a) => !a.archived);
    const opening = accounts.reduce((s, a) => s + BigInt(a.balance), 0n);
    const [ys, ms] = jparts(f.from);
    const months: { key: string; label: string; from: string; to: string }[] = [];
    for (let i = 0; i < f.months; i++) {
      const y = ys + Math.floor((ms - 1 + i) / 12);
      const m = ((ms - 1 + i) % 12) + 1;
      const g1 = toGregorian(y, m, 1);
      const g2 = toGregorian(y, m, jalaliMonthLength(y, m));
      const iso = (g: { gy: number; gm: number; gd: number }) => `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
      months.push({ key: `${y}-${String(m).padStart(2, '0')}`, label: `${MONTHS[m - 1]} ${y.toLocaleString('fa-IR', { useGrouping: false })}`, from: iso(g1), to: iso(g2) });
    }
    const end = months[months.length - 1]!.to;
    const items: FlowItem[] = [];
    const obligations = await rows<{ kind: string; due_on: string; description: string; name: string; remaining: string }>(
      tx,
      sql`SELECT o.kind, o.due_on::text, o.description, c.name,
          (o.amount - coalesce((SELECT sum(CASE WHEN t.direction = (CASE o.kind WHEN 'receivable' THEN 'in' ELSE 'out' END) THEN t.amount ELSE -t.amount END) FROM finance_transactions t WHERE t.obligation_id = o.id), 0))::text AS remaining
        FROM finance_obligations o JOIN finance_counterparties c ON c.id = o.counterparty_id WHERE o.status = 'open' AND o.due_on <= ${end}::date`,
    );
    for (const o of obligations) {
      if (BigInt(o.remaining) <= 0n) continue;
      items.push({ date: o.due_on, direction: o.kind === 'receivable' ? 'in' : 'out', amount: o.remaining, certainty: 'firm', source: o.kind === 'receivable' ? 'مطالبه' : 'بدهی', description: `${o.name}: ${o.description}`, overdue: o.due_on < f.from });
    }
    for (const p of await rows<{ due_on: string; amount: string; description: string }>(tx, sql`SELECT due_on::text, amount::text, description FROM finance_payment_requests WHERE status = 'approved' AND obligation_id IS NULL AND due_on <= ${end}::date`)) {
      items.push({ date: p.due_on, direction: 'out', amount: p.amount, certainty: 'firm', source: 'درخواست پرداخت تأییدشده', description: p.description, overdue: p.due_on < f.from });
    }
    for (const q of await rows<{ direction: string; due_on: string; amount: string; number: string; name: string }>(
      tx,
      sql`SELECT q.direction, q.due_on::text, q.amount::text, q.number, c.name FROM finance_cheques q JOIN finance_counterparties c ON c.id = q.counterparty_id
        WHERE q.status = 'pending' AND q.obligation_id IS NULL AND q.due_on <= ${end}::date`,
    )) {
      items.push({ date: q.due_on, direction: q.direction === 'received' ? 'in' : 'out', amount: q.amount, certainty: 'firm', source: q.direction === 'received' ? 'چک دریافتی' : 'چک صادره', description: `${q.name} — ${q.number}`, overdue: q.due_on < f.from });
    }
    for (const e of await rows<{ direction: 'in' | 'out'; expected_on: string; amount: string; description: string }>(tx, sql`SELECT direction, expected_on::text, amount::text, description FROM finance_forecasts WHERE expected_on BETWEEN ${f.from}::date AND ${end}::date`)) {
      items.push({ date: e.expected_on, direction: e.direction, amount: e.amount, certainty: 'estimate', source: 'پیش‌بینی', description: e.description, overdue: false });
    }
    let firmBal = opening;
    let allBal = opening;
    const rowsOut = months.map((m, i) => {
      const inMonth = items.filter((x) => (i === 0 ? x.date <= m.to : x.date >= m.from && x.date <= m.to));
      const sum = (c: 'firm' | 'estimate', d: 'in' | 'out') => inMonth.filter((x) => x.certainty === c && x.direction === d).reduce((s, x) => s + BigInt(x.amount), 0n);
      const fi = sum('firm', 'in'), fo = sum('firm', 'out'), ei = sum('estimate', 'in'), eo = sum('estimate', 'out');
      firmBal += fi - fo;
      allBal += fi - fo + ei - eo;
      return { ...m, firmIn: fi.toString(), firmOut: fo.toString(), estimateIn: ei.toString(), estimateOut: eo.toString(), firmBalance: firmBal.toString(), balance: allBal.toString() };
    });
    return { opening: opening.toString(), months: rowsOut, items: items.sort((a, b) => a.date.localeCompare(b.date)) };
  });
}

export const Forecasts = {
  list: (ctx: ModuleRequestContext) => ctx.db.transaction((tx) => rows(tx, sql`SELECT id, direction, amount::text, expected_on::text, description, projects_project_id, created_by FROM finance_forecasts ORDER BY expected_on`)),
  async add(ctx: ModuleRequestContext, input: z.infer<typeof forecastInput>) {
    const id = randomUUID();
    await ctx.db.transaction((tx) => tx.execute(sql`INSERT INTO finance_forecasts (id, tenant_id, company_id, direction, amount, expected_on, description, projects_project_id, created_by)
      VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.direction}, ${input.amount}, ${input.expectedOn}, ${input.description}, ${input.projectId}, ${ctx.userId})`));
    return { id };
  },
  async remove(ctx: ModuleRequestContext, id: string) {
    await ctx.db.transaction(async (tx) => {
      if (!(await rows(tx, sql`DELETE FROM finance_forecasts WHERE id = ${id} RETURNING id`)).length) throw notFound('پیش‌بینی');
    });
  },
};

// ---------------------------------------------------------------- bank reconciliation

export const Reconcile = {
  async import(ctx: ModuleRequestContext, input: z.infer<typeof statementInput>) {
    const parsed = parseStatement(input.csv);
    if (!parsed.rows.length) throw invalid('EMPTY', parsed.errors[0]?.message ?? 'سطر معتبری یافت نشد');
    return ctx.db.transaction(async (tx) => {
      const a = await one<{ kind: string }>(tx, sql`SELECT kind FROM finance_accounts WHERE id = ${input.accountId}`);
      if (!a) throw notFound('حساب');
      if (a.kind !== 'bank') throw invalid('NOT_BANK', 'مغایرت‌گیری فقط برای حساب بانکی است');
      const batch = randomUUID();
      for (const r of parsed.rows) {
        await tx.execute(sql`INSERT INTO finance_statement_lines (id, tenant_id, company_id, account_id, occurred_on, amount, reference, description, batch_id, created_by)
          VALUES (${randomUUID()}, ${ctx.tenantId}, ${ctx.companyId}, ${input.accountId}, ${r.occurredOn}, ${r.amount.toString()}, ${r.reference}, ${r.description}, ${batch}, ${ctx.userId})`);
      }
      const matched = await runAutoMatch(tx, ctx, input.accountId);
      await ctx.audit({ action: 'finance.statement.imported', entityType: 'finance_account', entityId: input.accountId, after: { lines: parsed.rows.length, matched } }, tx);
      return { imported: parsed.rows.length, matched, errors: parsed.errors };
    });
  },

  async view(ctx: ModuleRequestContext, accountId: string) {
    return ctx.db.transaction(async (tx) => {
      const acc = (await balances(tx)).find((x) => x.id === accountId);
      if (!acc) throw notFound('حساب');
      const lines = await rows<{ id: string; occurred_on: string; amount: string; reference: string; description: string; transaction_id: string | null }>(
        tx,
        sql`SELECT id, occurred_on::text, amount::text, reference, description, transaction_id FROM finance_statement_lines WHERE account_id = ${accountId} ORDER BY occurred_on, created_at`,
      );
      const first = lines[0]?.occurred_on;
      const txs = first
        ? await rows<{ id: string; occurred_on: string; signed: string; description: string; reference: string; matched: boolean }>(
            tx,
            sql`SELECT t.id, t.occurred_on::text, (${SIGNED})::text AS signed, t.description, t.reference, EXISTS (SELECT 1 FROM finance_statement_lines s WHERE s.transaction_id = t.id) AS matched
              FROM finance_transactions t WHERE t.account_id = ${accountId} AND t.occurred_on >= ${first}::date - 3 ORDER BY t.occurred_on`,
          )
        : [];
      const statementTotal = lines.reduce((s, l) => s + BigInt(l.amount), 0n);
      return {
        account: acc,
        lines,
        transactions: txs,
        unmatchedLines: lines.filter((l) => !l.transaction_id).length,
        unmatchedTransactions: txs.filter((t) => !t.matched).length,
        statementTotal: statementTotal.toString(),
        bookTotal: txs.reduce((s, t) => s + BigInt(t.signed), 0n).toString(),
      };
    });
  },

  async match(ctx: ModuleRequestContext, lineId: string, transactionId: string | null) {
    await ctx.db.transaction(async (tx) => {
      const l = await one<{ account_id: string; amount: string }>(tx, sql`SELECT account_id, amount::text FROM finance_statement_lines WHERE id = ${lineId} FOR UPDATE`);
      if (!l) throw notFound('سطر صورت‌حساب');
      if (transactionId) {
        const t = await one<{ account_id: string; signed: string }>(tx, sql`SELECT t.account_id, (${SIGNED})::text AS signed FROM finance_transactions t WHERE t.id = ${transactionId}`);
        if (!t || t.account_id !== l.account_id) throw invalid('ACCOUNT', 'تراکنش متعلق به همین حساب نیست');
        if (t.signed !== l.amount) throw invalid('AMOUNT', 'مبلغ و جهت تراکنش با سطر صورت‌حساب یکی نیست');
        if (await one(tx, sql`SELECT 1 FROM finance_statement_lines WHERE transaction_id = ${transactionId} AND id <> ${lineId}`)) throw conflict('MATCHED', 'این تراکنش با سطر دیگری تطبیق داده شده است');
      }
      await tx.execute(sql`UPDATE finance_statement_lines SET transaction_id = ${transactionId}, matched_by = ${transactionId ? ctx.userId : null}, matched_at = ${transactionId ? sql`now()` : sql`NULL`} WHERE id = ${lineId}`);
    });
  },

  async auto(ctx: ModuleRequestContext, accountId: string) {
    return { matched: await ctx.db.transaction((tx) => runAutoMatch(tx, ctx, accountId)) };
  },
};

async function runAutoMatch(tx: Parameters<Parameters<ModuleRequestContext['db']['transaction']>[0]>[0], ctx: ModuleRequestContext, accountId: string) {
  const lines = await rows<{ id: string; occurred_on: string; amount: string; reference: string }>(tx, sql`SELECT id, occurred_on::text, amount::text, reference FROM finance_statement_lines WHERE account_id = ${accountId} AND transaction_id IS NULL`);
  if (!lines.length) return 0;
  const txs = await rows<{ id: string; occurred_on: string; signed: string; reference: string }>(
    tx,
    sql`SELECT t.id, t.occurred_on::text, (${SIGNED})::text AS signed, t.reference FROM finance_transactions t WHERE t.account_id = ${accountId}
      AND NOT EXISTS (SELECT 1 FROM finance_statement_lines s WHERE s.transaction_id = t.id)`,
  );
  const pairs = autoMatch(
    lines.map((l) => ({ id: l.id, occurredOn: l.occurred_on, amount: BigInt(l.amount), reference: l.reference })),
    txs.map((t) => ({ id: t.id, occurredOn: t.occurred_on, signed: BigInt(t.signed), reference: t.reference })),
  );
  for (const p of pairs) await tx.execute(sql`UPDATE finance_statement_lines SET transaction_id = ${p.txId}, matched_by = ${ctx.userId}, matched_at = now() WHERE id = ${p.lineId}`);
  return pairs.length;
}

// ---------------------------------------------------------------- reports

/** Income and expense by category; transfers are excluded structurally (type), reversals net out. */
export async function incomeExpense(ctx: ModuleRequestContext, f: z.infer<typeof reportQuery>) {
  if (f.from > f.to) throw invalid('RANGE', 'ابتدای بازه باید قبل از انتهای آن باشد');
  return ctx.db.transaction(async (tx) => {
    const byCat = await rows<{ kind: string; category_id: string; name: string; amount: string }>(
      tx,
      sql`SELECT k.kind, k.id AS category_id, k.name, sum(CASE WHEN (k.kind = 'income') = (t.direction = 'in') THEN t.amount ELSE -t.amount END)::text AS amount
        FROM finance_transactions t JOIN finance_categories k ON k.id = t.category_id
        WHERE t.type <> 'transfer' AND t.occurred_on BETWEEN ${f.from}::date AND ${f.to}::date ${f.projectId ? sql`AND t.projects_project_id = ${f.projectId}` : sql``}
        GROUP BY k.kind, k.id, k.name ORDER BY k.kind DESC, 4 DESC`,
    );
    const total = (kind: string) => byCat.filter((c) => c.kind === kind).reduce((s, c) => s + BigInt(c.amount), 0n);
    const transfers = await one<{ n: number; amount: string }>(tx, sql`SELECT count(*)::int / 2 AS n, coalesce(sum(amount) FILTER (WHERE direction = 'out' AND reverses_id IS NULL AND voided_at IS NULL), 0)::text AS amount
      FROM finance_transactions WHERE type = 'transfer' AND occurred_on BETWEEN ${f.from}::date AND ${f.to}::date`);
    const byProject = await rows<{ projects_project_id: string; income: string; expense: string }>(
      tx,
      sql`SELECT t.projects_project_id, sum(CASE WHEN t.type = 'receipt' THEN (CASE WHEN t.direction = 'in' THEN t.amount ELSE -t.amount END) ELSE 0 END)::text AS income,
          sum(CASE WHEN t.type = 'payment' THEN (CASE WHEN t.direction = 'out' THEN t.amount ELSE -t.amount END) ELSE 0 END)::text AS expense
        FROM finance_transactions t WHERE t.type <> 'transfer' AND t.projects_project_id IS NOT NULL AND t.occurred_on BETWEEN ${f.from}::date AND ${f.to}::date GROUP BY 1`,
    );
    const income = total('income');
    const expense = total('expense');
    return { byCategory: byCat, income: income.toString(), expense: expense.toString(), net: (income - expense).toString(), transfers, byProject };
  });
}

// ---------------------------------------------------------------- widgets, alerts, KPI, events, service

export async function cashWidget(ctx: ModuleRequestContext) {
  return ctx.db.transaction(async (tx) => {
    const acc = (await balances(tx)).filter((a) => !a.archived);
    return { total: acc.reduce((s, a) => s + BigInt(a.balance), 0n).toString(), accounts: acc.map((a) => ({ id: a.id, name: a.name, kind: a.kind, balance: a.balance })) };
  });
}

export async function dueWidget(ctx: ModuleRequestContext, today: string) {
  return ctx.db.transaction(async (tx) => {
    const r = await rows<{ kind: string; overdue: string; week: string }>(
      tx,
      sql`SELECT kind, coalesce(sum(rem) FILTER (WHERE due_on < ${today}::date), 0)::text AS overdue, coalesce(sum(rem) FILTER (WHERE due_on BETWEEN ${today}::date AND ${today}::date + 7), 0)::text AS week
        FROM (SELECT o.kind, o.due_on, o.amount - coalesce((SELECT sum(CASE WHEN t.direction = (CASE o.kind WHEN 'receivable' THEN 'in' ELSE 'out' END) THEN t.amount ELSE -t.amount END) FROM finance_transactions t WHERE t.obligation_id = o.id), 0) AS rem
          FROM finance_obligations o WHERE o.status = 'open') x WHERE rem > 0 GROUP BY kind`,
    );
    const cheques = await one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM finance_cheques WHERE status = 'pending' AND due_on <= ${today}::date + 7`);
    const get = (k: string) => r.find((x) => x.kind === k) ?? { overdue: '0', week: '0' };
    return { receivable: get('receivable'), payable: get('payable'), chequesWeek: cheques!.n };
  });
}

export async function paymentsWidget(ctx: ModuleRequestContext) {
  return ctx.db.transaction(async (tx) => {
    const all = ctx.can('finance.transaction.view', 'company') || ctx.can('finance.payment.execute', 'company');
    const r = await rows<{ status: string; n: number; amount: string }>(
      tx,
      sql`SELECT status, count(*)::int AS n, sum(amount)::text AS amount FROM finance_payment_requests WHERE status IN ('requested', 'approved') ${all ? sql`` : sql`AND requested_by = ${ctx.userId}`} GROUP BY status`,
    );
    const get = (s: string) => r.find((x) => x.status === s) ?? { n: 0, amount: '0' };
    return { requested: get('requested'), approved: get('approved') };
  });
}

/** Daily: reminds once before a receivable, payable or cheque falls due, and once when it is overdue. */
export async function dueAlerts(ctx: ModuleEventContext, today: string) {
  const s = await ctx.settings<{ dueAlertDays: number }>();
  const due = await ctx.db.transaction(async (tx) => {
    const list = await rows<{ key: string; company_id: string; who: string; title: string }>(
      tx,
      sql`SELECT 'ob:' || o.id || ':' || CASE WHEN o.due_on < ${today}::date THEN 'over' ELSE 'soon' END AS key, o.company_id, o.created_by AS who,
          CASE o.kind WHEN 'receivable' THEN 'سررسید مطالبه' ELSE 'سررسید بدهی' END || ' ' || c.name || ': ' || o.description AS title
        FROM finance_obligations o JOIN finance_counterparties c ON c.id = o.counterparty_id
        WHERE o.status = 'open' AND o.due_on <= ${today}::date + ${s.dueAlertDays}::int
          AND o.amount > coalesce((SELECT sum(CASE WHEN t.direction = (CASE o.kind WHEN 'receivable' THEN 'in' ELSE 'out' END) THEN t.amount ELSE -t.amount END) FROM finance_transactions t WHERE t.obligation_id = o.id), 0)
        UNION ALL
        SELECT 'chq:' || q.id || ':' || CASE WHEN q.due_on < ${today}::date THEN 'over' ELSE 'soon' END, q.company_id, q.created_by,
          'سررسید چک ' || CASE q.direction WHEN 'received' THEN 'دریافتی ' ELSE 'صادره ' END || q.number
        FROM finance_cheques q WHERE q.status = 'pending' AND q.due_on <= ${today}::date + ${s.dueAlertDays}::int`,
    );
    const fresh = [];
    for (const a of list) {
      const ins = await tx.execute(sql`INSERT INTO finance_alerts (id, tenant_id, company_id, alert_key) VALUES (${randomUUID()}, ${ctx.tenantId}, ${a.company_id}, ${a.key}) ON CONFLICT DO NOTHING RETURNING id`);
      if (ins.rows.length) fresh.push(a);
    }
    return fresh;
  });
  for (const a of due.filter((x) => x.who)) await ctx.notify({ userIds: [a.who], type: 'finance.due', title: a.title, link: a.key.startsWith('chq') ? '/app/finance/cheques' : '/app/finance/obligations' });
  return due.length;
}

export const kpi = {
  cashBalance: (ctx: ModuleEventContext, p: { companyId: string; to: string }) =>
    ctx.db.transaction(async (tx) => {
      const r = await one<{ n: string }>(tx, sql`SELECT coalesce(sum(a.opening_balance + coalesce((SELECT sum(${SIGNED}) FROM finance_transactions t WHERE t.account_id = a.id AND t.occurred_on <= ${p.to}::date), 0)), 0)::text AS n
        FROM finance_accounts a WHERE a.company_id = ${p.companyId} AND a.opening_on <= ${p.to}::date`);
      return Number(r!.n);
    }),
  flow: (kind: 'income' | 'expense') => (ctx: ModuleEventContext, p: { companyId: string; from: string; to: string }) =>
    ctx.db.transaction(async (tx) => {
      const r = await one<{ n: string }>(tx, sql`SELECT coalesce(sum(CASE WHEN (k.kind = 'income') = (t.direction = 'in') THEN t.amount ELSE -t.amount END), 0)::text AS n
        FROM finance_transactions t JOIN finance_categories k ON k.id = t.category_id WHERE t.company_id = ${p.companyId} AND t.type <> 'transfer' AND k.kind = ${kind}
          AND t.occurred_on BETWEEN ${p.from}::date AND ${p.to}::date`);
      return Number(r!.n);
    }),
  overdueReceivables: (ctx: ModuleEventContext, p: { companyId: string; to: string }) =>
    ctx.db.transaction(async (tx) => {
      const r = await one<{ n: string }>(tx, sql`SELECT coalesce(sum(greatest(o.amount - coalesce((SELECT sum(CASE WHEN t.direction = 'in' THEN t.amount ELSE -t.amount END) FROM finance_transactions t
          WHERE t.obligation_id = o.id AND t.occurred_on <= ${p.to}::date), 0), 0)), 0)::text AS n FROM finance_obligations o WHERE o.company_id = ${p.companyId} AND o.kind = 'receivable' AND o.status = 'open' AND o.due_on < ${p.to}::date`);
      return Number(r!.n);
    }),
};

export async function search(ctx: ModuleRequestContext, q: string, limit: number) {
  const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const r = await ctx.db.transaction((tx) => rows<{ id: string; name: string }>(tx, sql`SELECT id, name FROM finance_counterparties WHERE name ILIKE ${like} ORDER BY name LIMIT ${limit}`));
  return r.map((x) => ({ entityType: 'counterparty', entityId: x.id, title: x.name, link: `/app/finance/counterparties?q=${encodeURIComponent(x.name)}` }));
}

/** Counterparty for a procurement supplier, created on first use (soft link, no foreign key). */
async function supplierCounterparty(tx: Parameters<Parameters<ModuleEventContext['db']['transaction']>[0]>[0], ctx: ModuleEventContext, companyId: string, supplier: { id: string; name: string }) {
  const c = await one<{ id: string }>(tx, sql`SELECT id FROM finance_counterparties WHERE company_id = ${companyId} AND procurement_supplier_id = ${supplier.id}`);
  if (c) return c.id;
  const id = randomUUID();
  await tx.execute(sql`INSERT INTO finance_counterparties (id, tenant_id, company_id, kind, name, procurement_supplier_id) VALUES (${id}, ${ctx.tenantId}, ${companyId}, 'company', ${supplier.name}, ${supplier.id})`);
  return id;
}

/** procurement.order.approved → an open commitment on the project (idempotent per order). */
export async function onOrderApproved(ctx: ModuleEventContext, p: { orderId: string; number: string; companyId: string; supplier: { id: string; name: string }; amount: string; projectId: string | null }) {
  await ctx.db.transaction(async (tx) => {
    const cp = await supplierCounterparty(tx, ctx, p.companyId, p.supplier);
    await tx.execute(sql`INSERT INTO finance_commitments (id, tenant_id, company_id, projects_project_id, counterparty_id, amount, description, source, source_ref, created_by)
      VALUES (${randomUUID()}, ${ctx.tenantId}, ${p.companyId}, ${p.projectId}, ${cp}, ${p.amount}, ${`سفارش خرید ${p.number}`}, 'procurement', ${`order:${p.orderId}`}, NULL)
      ON CONFLICT (company_id, source, source_ref) WHERE source_ref IS NOT NULL DO NOTHING`);
  });
}

/** procurement.invoice.approved → a payable to the supplier (idempotent per invoice). */
export async function onInvoiceApproved(ctx: ModuleEventContext, p: { invoiceId: string; number: string; companyId: string; supplier: { id: string; name: string }; amount: string; issuedOn: string; dueOn: string; projectId: string | null; orderNumber: string }) {
  await ctx.db.transaction(async (tx) => {
    const cp = await supplierCounterparty(tx, ctx, p.companyId, p.supplier);
    await tx.execute(sql`INSERT INTO finance_obligations (id, tenant_id, company_id, kind, counterparty_id, amount, issued_on, due_on, description, reference, projects_project_id, source, source_ref, created_by)
      VALUES (${randomUUID()}, ${ctx.tenantId}, ${p.companyId}, 'payable', ${cp}, ${p.amount}, ${p.issuedOn}, ${p.dueOn}, ${`فاکتور ${p.number} (سفارش ${p.orderNumber})`}, ${p.number}, ${p.projectId}, 'procurement', ${`invoice:${p.invoiceId}`},
        NULL)
      ON CONFLICT (company_id, source, source_ref) WHERE source_ref IS NOT NULL DO NOTHING`);
  });
}

/** Public service finance.ledger@1: project cost figures for other modules (procurement budget checks). */
export function publicService(ctx: ModuleEventContext) {
  return {
    projectCost: (projectId: string) =>
      ctx.db.transaction(async (tx) => {
        const r = await one<{ bac: string | null; actual: string; committed: string }>(
          tx,
          sql`SELECT (SELECT sum(l.amount)::text FROM finance_budget_lines l WHERE l.budget_id = (SELECT b.id FROM finance_budgets b WHERE b.projects_project_id = ${projectId} AND b.status = 'approved' ORDER BY b.version DESC LIMIT 1)) AS bac,
              coalesce((SELECT sum(CASE WHEN direction = 'out' THEN amount ELSE -amount END) FROM finance_transactions WHERE projects_project_id = ${projectId} AND type = 'payment'), 0)::text AS actual,
              coalesce((SELECT sum(amount) FROM finance_commitments WHERE projects_project_id = ${projectId} AND status = 'open'), 0)::text AS committed`,
        );
        return r!;
      }),
  };
}

