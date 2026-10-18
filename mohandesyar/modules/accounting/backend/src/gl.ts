import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import { checkLines, ensureBooks, fiscalYearFor, insertLines, nextDetailCode, one, postNow, reverseVoucher, rows, settingsOf, type Books } from './books.js';
import { conflict, forbidden, invalid, notFound } from './errors.js';
import type { accountInput, accountUpdate, detailInput, fiscalYearInput, ledgerQuery, trialQuery, voucherInput, voucherQuery } from './inputs.js';

export const booksOf = (ctx: ModuleRequestContext): Books => ({ tenantId: ctx.tenantId, companyId: ctx.companyId });

/** Runs `fn` in one transaction after making sure the company's books exist. */
export function withBooks<T>(ctx: ModuleRequestContext, fn: (tx: Db, b: Books) => Promise<T>): Promise<T> {
  const b = booksOf(ctx);
  return ctx.db.transaction(async (tx) => {
    await ensureBooks(tx, b, todayIso());
    return fn(tx, b);
  });
}

/** Postgres check_violation raised by the ledger triggers → a clear conflict instead of a 500. */
export function guardDb<T>(p: Promise<T>): Promise<T> {
  return p.catch((e: unknown) => {
    const err = e as { code?: string; cause?: { code?: string; message?: string }; message?: string };
    const code = err.code ?? err.cause?.code;
    const msg = err.message ?? err.cause?.message ?? '';
    if (code === '23514' && msg.includes('accounting:')) throw conflict('LEDGER_RULE', msg.includes('unbalanced') ? 'سند تراز نیست' : 'سند قطعی قابل تغییر نیست');
    if (code === '23505') throw conflict('DUPLICATE', 'کد یا شماره تکراری است');
    throw e;
  });
}

// ---------------------------------------------------------------- chart, details, fiscal years

export const Setup = {
  accounts(ctx: ModuleRequestContext) {
    return withBooks(ctx, (tx, b) =>
      rows(tx, sql`SELECT id, code, name, level, parent_id, type, nature, needs_detail, system_key, active FROM accounting_accounts WHERE company_id = ${b.companyId} ORDER BY code`),
    );
  },

  createAccount(ctx: ModuleRequestContext, input: z.infer<typeof accountInput>) {
    return guardDb(withBooks(ctx, async (tx, b) => {
      const p = await one<{ id: string; level: string; type: string; nature: string; code: string }>(tx, sql`SELECT id, level, type, nature, code FROM accounting_accounts WHERE id = ${input.parentId} AND company_id = ${b.companyId}`);
      if (!p) throw notFound('حساب بالاسری');
      if (p.level === 'subsidiary') throw invalid('ACCOUNT_LEVEL', 'زیر حساب معین نمی‌توان حساب ساخت؛ برای ریز حساب از «تفصیلی» استفاده کنید');
      if (!input.code.startsWith(p.code) || input.code.length <= p.code.length) throw invalid('ACCOUNT_CODE', `کد حساب باید با کد حساب بالاسری (${p.code}) شروع شود و بلندتر از آن باشد`);
      if (p.level === 'ledger') {
        const used = await one(tx, sql`SELECT 1 FROM accounting_voucher_lines WHERE account_id = ${p.id} LIMIT 1`);
        if (used) throw conflict('ACCOUNT_USED', 'حساب بالاسری سند خورده است');
      }
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO accounting_accounts (id, tenant_id, company_id, code, name, level, parent_id, type, nature, needs_detail)
        VALUES (${id}, ${b.tenantId}, ${b.companyId}, ${input.code}, ${input.name}, ${p.level === 'group' ? 'ledger' : 'subsidiary'}, ${p.id}, ${p.type}, ${p.nature}, ${input.needsDetail})`);
      await ctx.audit({ action: 'accounting.account.created', entityType: 'accounting_account', entityId: id, after: { code: input.code, name: input.name } }, tx);
      return { id };
    }));
  },

  updateAccount(ctx: ModuleRequestContext, id: string, input: z.infer<typeof accountUpdate>) {
    return withBooks(ctx, async (tx, b) => {
      const a = await one<{ system_key: string | null }>(tx, sql`SELECT system_key FROM accounting_accounts WHERE id = ${id} AND company_id = ${b.companyId}`);
      if (!a) throw notFound('حساب');
      if (a.system_key && !input.active) throw conflict('SYSTEM_ACCOUNT', 'حساب سیستمی (مورد استفاده اسناد خودکار) را نمی‌توان غیرفعال کرد');
      await tx.execute(sql`UPDATE accounting_accounts SET name = ${input.name}, needs_detail = ${input.needsDetail}, active = ${input.active} WHERE id = ${id}`);
      await ctx.audit({ action: 'accounting.account.updated', entityType: 'accounting_account', entityId: id, after: input }, tx);
      return { ok: true };
    });
  },

  details(ctx: ModuleRequestContext, q: string) {
    const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    return withBooks(ctx, (tx, b) =>
      rows(tx, sql`SELECT id, code, name, kind, national_id, economic_code, postal_code, address, phone, active, source_ref FROM accounting_details
        WHERE company_id = ${b.companyId} ${q ? sql`AND (name ILIKE ${like} OR code LIKE ${like})` : sql``} ORDER BY name LIMIT 2000`),
    );
  },

  saveDetail(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof detailInput>) {
    return guardDb(withBooks(ctx, async (tx, b) => {
      if (id) {
        const r = await tx.execute(sql`UPDATE accounting_details SET name = ${input.name}, kind = ${input.kind}, national_id = ${input.nationalId}, economic_code = ${input.economicCode},
          postal_code = ${input.postalCode}, address = ${input.address}, phone = ${input.phone}, active = ${input.active} ${input.code ? sql`, code = ${input.code}` : sql``}
          WHERE id = ${id} AND company_id = ${b.companyId} RETURNING id`);
        if (!r.rows.length) throw notFound('حساب تفصیلی');
        return { id };
      }
      const nid = randomUUID();
      await tx.execute(sql`INSERT INTO accounting_details (id, tenant_id, company_id, code, name, kind, national_id, economic_code, postal_code, address, phone, active)
        VALUES (${nid}, ${b.tenantId}, ${b.companyId}, ${input.code ?? (await nextDetailCode(tx, b))}, ${input.name}, ${input.kind}, ${input.nationalId}, ${input.economicCode}, ${input.postalCode}, ${input.address}, ${input.phone}, ${input.active})`);
      await ctx.audit({ action: 'accounting.detail.created', entityType: 'accounting_detail', entityId: nid, after: { name: input.name } }, tx);
      return { id: nid };
    }));
  },

  years(ctx: ModuleRequestContext) {
    return withBooks(ctx, (tx, b) =>
      rows(tx, sql`SELECT y.id, y.title, y.start_on::text, y.end_on::text, y.status, y.closed_at,
          (SELECT count(*)::int FROM accounting_vouchers v WHERE v.fiscal_year_id = y.id AND v.status = 'draft') AS drafts,
          (SELECT count(*)::int FROM accounting_vouchers v WHERE v.fiscal_year_id = y.id AND v.status <> 'draft') AS posted
        FROM accounting_fiscal_years y WHERE y.company_id = ${b.companyId} ORDER BY y.start_on DESC`),
    );
  },

  createYear(ctx: ModuleRequestContext, input: z.infer<typeof fiscalYearInput>) {
    return withBooks(ctx, async (tx, b) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`accounting-years:${b.companyId}`}))`);
      const overlap = await one(tx, sql`SELECT 1 FROM accounting_fiscal_years WHERE company_id = ${b.companyId} AND start_on <= ${input.endOn}::date AND end_on >= ${input.startOn}::date`);
      if (overlap) throw conflict('YEAR_OVERLAP', 'این بازه با سال مالی دیگری هم‌پوشانی دارد');
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO accounting_fiscal_years (id, tenant_id, company_id, title, start_on, end_on) VALUES (${id}, ${b.tenantId}, ${b.companyId}, ${input.title}, ${input.startOn}, ${input.endOn})`);
      await ctx.audit({ action: 'accounting.year.created', entityType: 'accounting_fiscal_year', entityId: id, after: input }, tx);
      return { id };
    });
  },
};

// ---------------------------------------------------------------- vouchers

const VOUCHER_COLS = sql`v.id, v.number, v.date::text, v.description, v.kind, v.status, v.source, v.source_ref, v.reverses_id, v.total::text, v.created_by, v.posted_by, v.posted_at, v.created_at,
  (SELECT coalesce(sum(l.debit), 0)::text FROM accounting_voucher_lines l WHERE l.voucher_id = v.id) AS debit,
  (SELECT coalesce(sum(l.credit), 0)::text FROM accounting_voucher_lines l WHERE l.voucher_id = v.id) AS credit`;

export const Vouchers = {
  list(ctx: ModuleRequestContext, f: z.infer<typeof voucherQuery>) {
    const like = f.q ? `%${f.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null;
    return withBooks(ctx, (tx, b) =>
      rows(tx, sql`SELECT ${VOUCHER_COLS} FROM accounting_vouchers v WHERE v.company_id = ${b.companyId}
        ${f.from ? sql`AND v.date >= ${f.from}::date` : sql``} ${f.to ? sql`AND v.date <= ${f.to}::date` : sql``}
        ${f.status ? sql`AND v.status = ${f.status}` : sql``} ${f.source ? sql`AND v.source = ${f.source}` : sql``}
        ${like ? sql`AND (v.description ILIKE ${like} OR v.number::text = ${f.q})` : sql``}
        ORDER BY v.date DESC, v.number DESC NULLS FIRST LIMIT 1000`),
    );
  },

  get(ctx: ModuleRequestContext, id: string) {
    return withBooks(ctx, async (tx, b) => {
      const v = await one(tx, sql`SELECT ${VOUCHER_COLS} FROM accounting_vouchers v WHERE v.id = ${id} AND v.company_id = ${b.companyId}`);
      if (!v) throw notFound('سند');
      const lines = await rows(tx, sql`SELECT l.id, l.line_no, l.account_id, a.code AS account_code, a.name AS account_name, l.detail_id, d.code AS detail_code, d.name AS detail_name,
          l.description, l.debit::text, l.credit::text
        FROM accounting_voucher_lines l JOIN accounting_accounts a ON a.id = l.account_id LEFT JOIN accounting_details d ON d.id = l.detail_id
        WHERE l.voucher_id = ${id} ORDER BY l.line_no`);
      return { voucher: v, lines };
    });
  },

  save(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof voucherInput>) {
    return guardDb(withBooks(ctx, async (tx, b) => {
      const year = await fiscalYearFor(tx, b, input.date);
      const lines = input.lines.map((l) => ({ accountId: l.accountId, detailId: l.detailId, debit: BigInt(l.debit), credit: BigInt(l.credit), description: l.description }));
      await checkLines(tx, b, lines, 'draft');
      if (id) {
        const cur = await one<{ status: string }>(tx, sql`SELECT status FROM accounting_vouchers WHERE id = ${id} AND company_id = ${b.companyId} FOR UPDATE`);
        if (!cur) throw notFound('سند');
        if (cur.status !== 'draft') throw conflict('VOUCHER_STATE', 'سند قطعی قابل ویرایش نیست؛ برای اصلاح، سند برگشت یا سند اصلاحی صادر کنید');
        await tx.execute(sql`DELETE FROM accounting_voucher_lines WHERE voucher_id = ${id}`);
        await tx.execute(sql`UPDATE accounting_vouchers SET date = ${input.date}, fiscal_year_id = ${year.id}, description = ${input.description}, updated_at = now() WHERE id = ${id}`);
        await insertLines(tx, b, id, lines);
        return { id };
      }
      const nid = randomUUID();
      await tx.execute(sql`INSERT INTO accounting_vouchers (id, tenant_id, company_id, fiscal_year_id, date, description, created_by)
        VALUES (${nid}, ${b.tenantId}, ${b.companyId}, ${year.id}, ${input.date}, ${input.description}, ${ctx.userId})`);
      await insertLines(tx, b, nid, lines);
      return { id: nid };
    }));
  },

  async post(ctx: ModuleRequestContext, id: string) {
    const s = await settingsOf(ctx);
    return guardDb(withBooks(ctx, async (tx, b) => {
      const v = await one<{ status: string; date: string; created_by: string | null }>(tx, sql`SELECT status, date::text, created_by FROM accounting_vouchers WHERE id = ${id} AND company_id = ${b.companyId} FOR UPDATE`);
      if (!v) throw notFound('سند');
      if (v.status !== 'draft') throw conflict('VOUCHER_STATE', 'سند قبلاً قطعی شده است');
      if (s.separateDuties && v.created_by === ctx.userId) throw forbidden('تفکیک وظایف: سندی را که خودتان ثبت کرده‌اید شخص دیگری باید قطعی کند');
      const year = await fiscalYearFor(tx, b, v.date);
      const lines = (await rows<{ account_id: string; detail_id: string | null; debit: string; credit: string }>(tx, sql`SELECT account_id, detail_id, debit::text, credit::text FROM accounting_voucher_lines WHERE voucher_id = ${id}`))
        .map((l) => ({ accountId: l.account_id, detailId: l.detail_id, debit: BigInt(l.debit), credit: BigInt(l.credit) }));
      await checkLines(tx, b, lines, 'post');
      const number = await postNow(tx, b, id, year.id, ctx.userId);
      await ctx.audit({ action: 'accounting.voucher.posted', entityType: 'accounting_voucher', entityId: id, after: { number } }, tx);
      return { number };
    }));
  },

  remove(ctx: ModuleRequestContext, id: string) {
    return withBooks(ctx, async (tx, b) => {
      const v = await one<{ status: string; source: string }>(tx, sql`SELECT status, source FROM accounting_vouchers WHERE id = ${id} AND company_id = ${b.companyId} FOR UPDATE`);
      if (!v) throw notFound('سند');
      if (v.status !== 'draft') throw conflict('VOUCHER_STATE', 'سند قطعی حذف نمی‌شود؛ آن را برگشت بزنید');
      await tx.execute(sql`DELETE FROM accounting_vouchers WHERE id = ${id}`);
      await ctx.audit({ action: 'accounting.voucher.deleted', entityType: 'accounting_voucher', entityId: id, before: { source: v.source } }, tx);
      return { ok: true };
    });
  },

  reverse(ctx: ModuleRequestContext, id: string, date: string, why: string) {
    return guardDb(withBooks(ctx, async (tx, b) => {
      const v = await one<{ source: string }>(tx, sql`SELECT source FROM accounting_vouchers WHERE id = ${id} AND company_id = ${b.companyId}`);
      if (!v) throw notFound('سند');
      if (!['manual', 'procurement', 'finance'].includes(v.source)) throw conflict('VOUCHER_SOURCE', 'سند خودکار فاکتور، خزانه، چک یا دارایی را از همان بخش ابطال کنید');
      const r = await reverseVoucher(tx, b, id, date, ctx.userId, why);
      await ctx.audit({ action: 'accounting.voucher.reversed', entityType: 'accounting_voucher', entityId: id, after: { reversal: r.id } }, tx);
      return r;
    }));
  },
};

// ---------------------------------------------------------------- reports

/**
 * Lines that count for balances in [from, to]. Closing vouchers dated inside the range are left out, so a
 * trial balance or statement of a closed year still shows the year's figures; closings before the range
 * stay in (they are netted by the next year's opening voucher).
 */
const counted = (from: string) => sql`v.status <> 'draft' AND NOT (v.kind IN ('closing', 'income_closing') AND v.date >= ${from}::date)`;

interface BalanceRow { account_id: string; detail_id: string | null; opening: string; debit: string; credit: string }

async function balances(tx: Db, b: Books, from: string, to: string, byDetail: boolean) {
  return rows<BalanceRow>(tx, sql`SELECT l.account_id, ${byDetail ? sql`l.detail_id` : sql`NULL::uuid AS detail_id`},
      coalesce(sum(l.debit - l.credit) FILTER (WHERE v.date < ${from}::date), 0)::text AS opening,
      coalesce(sum(l.debit) FILTER (WHERE v.date >= ${from}::date), 0)::text AS debit,
      coalesce(sum(l.credit) FILTER (WHERE v.date >= ${from}::date), 0)::text AS credit
    FROM accounting_voucher_lines l JOIN accounting_vouchers v ON v.id = l.voucher_id
    WHERE v.company_id = ${b.companyId} AND v.date <= ${to}::date AND ${counted(from)}
    GROUP BY l.account_id ${byDetail ? sql`, l.detail_id` : sql``}`);
}

interface AccountRow { id: string; code: string; name: string; level: 'group' | 'ledger' | 'subsidiary'; parent_id: string | null; type: string }

export interface TrialRow { id: string; code: string; name: string; level: string; type: string; detail?: { id: string; code: string; name: string } | null; opening: string; debit: string; credit: string; balance: string }

/** Trial balance (تراز آزمایشی) at a level: opening, turnover and closing balance (debit + / credit −). */
export function trialBalance(ctx: ModuleRequestContext, q: z.infer<typeof trialQuery>) {
  return withBooks(ctx, async (tx, b) => {
    const accounts = await rows<AccountRow>(tx, sql`SELECT id, code, name, level, parent_id, type FROM accounting_accounts WHERE company_id = ${b.companyId}`);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const bal = await balances(tx, b, q.from, q.to, q.level === 'detail');
    const up = (id: string, level: string): AccountRow => {
      let a = byId.get(id)!;
      while (a.level !== level && a.parent_id) a = byId.get(a.parent_id)!;
      return a;
    };
    const details = q.level === 'detail' ? new Map((await rows<{ id: string; code: string; name: string }>(tx, sql`SELECT id, code, name FROM accounting_details WHERE company_id = ${b.companyId}`)).map((d) => [d.id, d])) : null;
    const sums = new Map<string, { a: AccountRow; detail: { id: string; code: string; name: string } | null; opening: bigint; debit: bigint; credit: bigint }>();
    for (const r of bal) {
      const a = q.level === 'detail' ? byId.get(r.account_id)! : up(r.account_id, q.level);
      const key = `${a.id}:${r.detail_id ?? ''}`;
      const cur = sums.get(key) ?? { a, detail: r.detail_id && details ? (details.get(r.detail_id) ?? null) : null, opening: 0n, debit: 0n, credit: 0n };
      cur.opening += BigInt(r.opening);
      cur.debit += BigInt(r.debit);
      cur.credit += BigInt(r.credit);
      sums.set(key, cur);
    }
    const out: TrialRow[] = [...sums.values()]
      .filter((s) => s.opening !== 0n || s.debit !== 0n || s.credit !== 0n)
      .sort((x, y) => (x.a.code === y.a.code ? (x.detail?.code ?? '').localeCompare(y.detail?.code ?? '') : x.a.code.localeCompare(y.a.code)))
      .map((s) => ({ id: s.a.id, code: s.a.code, name: s.a.name, level: s.a.level, type: s.a.type, detail: s.detail, opening: s.opening.toString(), debit: s.debit.toString(), credit: s.credit.toString(), balance: (s.opening + s.debit - s.credit).toString() }));
    const total = out.reduce((t, r) => ({ opening: t.opening + BigInt(r.opening), debit: t.debit + BigInt(r.debit), credit: t.credit + BigInt(r.credit) }), { opening: 0n, debit: 0n, credit: 0n });
    return { rows: out, totals: { opening: total.opening.toString(), debit: total.debit.toString(), credit: total.credit.toString(), balance: (total.opening + total.debit - total.credit).toString() } };
  });
}

/** Account or detail ledger (دفتر کل/معین/تفصیلی) with running balance; an account includes its sub-accounts. */
export function ledger(ctx: ModuleRequestContext, q: z.infer<typeof ledgerQuery>) {
  return withBooks(ctx, async (tx, b) => {
    const accFilter: SQL = q.accountId
      ? sql`AND l.account_id IN (WITH RECURSIVE t AS (SELECT id FROM accounting_accounts WHERE id = ${q.accountId} AND company_id = ${b.companyId}
          UNION ALL SELECT a.id FROM accounting_accounts a JOIN t ON a.parent_id = t.id) SELECT id FROM t)`
      : sql``;
    const detFilter: SQL = q.detailId ? sql`AND l.detail_id = ${q.detailId}` : sql``;
    const open = await one<{ s: string }>(tx, sql`SELECT coalesce(sum(l.debit - l.credit), 0)::text AS s FROM accounting_voucher_lines l JOIN accounting_vouchers v ON v.id = l.voucher_id
      WHERE v.company_id = ${b.companyId} AND v.date < ${q.from}::date AND ${counted(q.from)} ${accFilter} ${detFilter}`);
    const lines = await rows<{ voucher_id: string; number: number; date: string; kind: string; voucher_description: string; account_code: string; account_name: string; detail_name: string | null; description: string; debit: string; credit: string }>(tx,
      sql`SELECT v.id AS voucher_id, v.number, v.date::text, v.kind, v.description AS voucher_description, a.code AS account_code, a.name AS account_name, d.name AS detail_name, l.description, l.debit::text, l.credit::text
        FROM accounting_voucher_lines l JOIN accounting_vouchers v ON v.id = l.voucher_id JOIN accounting_accounts a ON a.id = l.account_id LEFT JOIN accounting_details d ON d.id = l.detail_id
        WHERE v.company_id = ${b.companyId} AND v.status <> 'draft' AND v.date BETWEEN ${q.from}::date AND ${q.to}::date ${accFilter} ${detFilter}
        ORDER BY v.date, v.number, l.line_no LIMIT 20000`);
    let run = BigInt(open!.s);
    const out = lines.map((l) => {
      run += BigInt(l.debit) - BigInt(l.credit);
      return { ...l, balance: run.toString() };
    });
    return { opening: open!.s, lines: out, closing: run.toString() };
  });
}

export interface Section { code: string; name: string; amount: string }

/** Balance sheet (ترازنامه) as of `to`; the year's not-yet-closed result appears under equity. */
export function balanceSheet(ctx: ModuleRequestContext, to: string) {
  return withBooks(ctx, async (tx, b) => {
    const y = await one<{ start_on: string }>(tx, sql`SELECT start_on::text FROM accounting_fiscal_years WHERE company_id = ${b.companyId} AND ${to}::date BETWEEN start_on AND end_on`);
    const from = y?.start_on ?? to;
    const r = await rows<{ type: string; code: string; name: string; s: string }>(tx, sql`SELECT g.type, p.code, p.name, sum(l.debit - l.credit)::text AS s
      FROM accounting_voucher_lines l JOIN accounting_vouchers v ON v.id = l.voucher_id JOIN accounting_accounts a ON a.id = l.account_id JOIN accounting_accounts p ON p.id = a.parent_id JOIN accounting_accounts g ON g.id = p.parent_id
      WHERE v.company_id = ${b.companyId} AND v.date <= ${to}::date AND ${counted(from)} GROUP BY g.type, p.code, p.name ORDER BY p.code`);
    const pick = (type: string, sign: bigint): Section[] => r.filter((x) => x.type === type && BigInt(x.s) !== 0n).map((x) => ({ code: x.code, name: x.name, amount: (BigInt(x.s) * sign).toString() }));
    const sum = (s: Section[]) => s.reduce((t, x) => t + BigInt(x.amount), 0n);
    const assets = pick('asset', 1n);
    const liabilities = pick('liability', -1n);
    const equity = pick('equity', -1n);
    const result = -r.filter((x) => x.type === 'income' || x.type === 'expense').reduce((t, x) => t + BigInt(x.s), 0n);
    if (result !== 0n) equity.push({ code: '', name: 'سود (زیان) دوره بسته‌نشده', amount: result.toString() });
    return { asOf: to, assets, liabilities, equity, totals: { assets: sum(assets).toString(), liabilities: sum(liabilities).toString(), equity: sum(equity).toString() } };
  });
}

/** Income statement (صورت سود و زیان) over [from, to] by ledger account. */
export function incomeStatement(ctx: ModuleRequestContext, from: string, to: string) {
  return withBooks(ctx, async (tx, b) => {
    const r = await rows<{ type: string; code: string; name: string; s: string }>(tx, sql`SELECT g.type, p.code, p.name, sum(l.credit - l.debit)::text AS s
      FROM accounting_voucher_lines l JOIN accounting_vouchers v ON v.id = l.voucher_id JOIN accounting_accounts a ON a.id = l.account_id JOIN accounting_accounts p ON p.id = a.parent_id JOIN accounting_accounts g ON g.id = p.parent_id
      WHERE v.company_id = ${b.companyId} AND v.date BETWEEN ${from}::date AND ${to}::date AND ${counted(from)} AND g.type IN ('income', 'expense')
      GROUP BY g.type, g.code, p.code, p.name ORDER BY p.code`);
    const income = r.filter((x) => x.type === 'income' && BigInt(x.s) !== 0n).map((x) => ({ code: x.code, name: x.name, amount: x.s }));
    const expense = r.filter((x) => x.type === 'expense' && BigInt(x.s) !== 0n).map((x) => ({ code: x.code, name: x.name, amount: (-BigInt(x.s)).toString() }));
    const ti = income.reduce((t, x) => t + BigInt(x.amount), 0n);
    const te = expense.reduce((t, x) => t + BigInt(x.amount), 0n);
    return { from, to, income, expense, totals: { income: ti.toString(), expense: te.toString(), result: (ti - te).toString() } };
  });
}

/** Balances of each party on receivable / payable / cheque accounts (مانده طرف‌حساب‌ها). */
export function partyBalances(ctx: ModuleRequestContext, to: string) {
  return withBooks(ctx, async (tx, b) =>
    rows(tx, sql`SELECT * FROM (SELECT d.id, d.code, d.name,
        coalesce(sum(l.debit - l.credit) FILTER (WHERE a.system_key IN ('receivable', 'other_receivable')), 0)::text AS receivable,
        coalesce(sum(l.debit - l.credit) FILTER (WHERE a.system_key IN ('cheques_receivable', 'cheques_in_collection')), 0)::text AS cheques_receivable,
        coalesce(sum(l.credit - l.debit) FILTER (WHERE a.system_key IN ('payable', 'other_payable')), 0)::text AS payable,
        coalesce(sum(l.credit - l.debit) FILTER (WHERE a.system_key = 'cheques_payable'), 0)::text AS cheques_payable,
        coalesce(sum(l.debit - l.credit) FILTER (WHERE a.system_key IN ('prepayment')), 0)::text AS prepayment,
        coalesce(sum(l.credit - l.debit) FILTER (WHERE a.system_key IN ('customer_advance')), 0)::text AS advance
      FROM accounting_voucher_lines l JOIN accounting_vouchers v ON v.id = l.voucher_id JOIN accounting_accounts a ON a.id = l.account_id JOIN accounting_details d ON d.id = l.detail_id
      WHERE v.company_id = ${b.companyId} AND v.status <> 'draft' AND v.date <= ${to}::date
      GROUP BY d.id, d.code, d.name) x
      WHERE x.receivable::numeric <> 0 OR x.cheques_receivable::numeric <> 0 OR x.payable::numeric <> 0 OR x.cheques_payable::numeric <> 0 OR x.prepayment::numeric <> 0 OR x.advance::numeric <> 0
      ORDER BY x.name`),
  );
}
