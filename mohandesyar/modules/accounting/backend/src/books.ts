import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '@mohandesyar/module-sdk/server';
import { DEFAULT_CHART, naturalSide, type ChartAccount, type SystemKey } from './chart.js';
import { jalaliYearOf } from './calc.js';
import { conflict, invalid } from './errors.js';

export type Row = Record<string, unknown>;
export const rows = async <T = Row>(tx: Db, q: SQL) => (await tx.execute(q)).rows as T[];
export const one = async <T = Row>(tx: Db, q: SQL) => (await rows<T>(tx, q))[0];

export interface Books {
  tenantId: string;
  companyId: string;
}

export interface Settings {
  vatRate: number;
  separateDuties: boolean;
  allowNegativeStock: boolean;
}
export async function settingsOf(ctx: { settings<T extends Record<string, unknown>>(): Promise<T> }): Promise<Settings> {
  const s = await ctx.settings<Record<string, unknown>>();
  return {
    vatRate: typeof s.vatRate === 'number' && s.vatRate >= 0 && s.vatRate <= 100 ? s.vatRate : 10,
    separateDuties: s.separateDuties !== false,
    allowNegativeStock: s.allowNegativeStock === true,
  };
}

/**
 * Creates the company's books on first use: the default chart of accounts, a central warehouse and the
 * fiscal year containing `today`. Serialised per company with an advisory lock, so concurrent first
 * requests do not race.
 */
export async function ensureBooks(tx: Db, b: Books, today: string): Promise<void> {
  if (await one(tx, sql`SELECT 1 FROM accounting_accounts WHERE company_id = ${b.companyId} LIMIT 1`)) return;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`accounting:${b.companyId}`}))`);
  if (await one(tx, sql`SELECT 1 FROM accounting_accounts WHERE company_id = ${b.companyId} LIMIT 1`)) return;
  const insert = async (a: ChartAccount, level: 'group' | 'ledger' | 'subsidiary', parent: string | null, type: string) => {
    const id = randomUUID();
    const nature = a.nature ?? naturalSide(type as never);
    await tx.execute(sql`INSERT INTO accounting_accounts (id, tenant_id, company_id, code, name, level, parent_id, type, nature, needs_detail, system_key)
      VALUES (${id}, ${b.tenantId}, ${b.companyId}, ${a.code}, ${a.name}, ${level}, ${parent}, ${type}, ${nature}, ${a.detail ?? false}, ${a.key ?? null})`);
    return id;
  };
  for (const g of DEFAULT_CHART) {
    const gid = await insert(g, 'group', null, g.type);
    for (const l of g.children ?? []) {
      const lid = await insert(l, 'ledger', gid, g.type);
      for (const s of l.children ?? []) await insert(s, 'subsidiary', lid, g.type);
    }
  }
  await tx.execute(sql`INSERT INTO accounting_warehouses (id, tenant_id, company_id, name) VALUES (${randomUUID()}, ${b.tenantId}, ${b.companyId}, 'انبار مرکزی') ON CONFLICT DO NOTHING`);
  if (!(await one(tx, sql`SELECT 1 FROM accounting_fiscal_years WHERE company_id = ${b.companyId} LIMIT 1`))) {
    const y = jalaliYearOf(today);
    await tx.execute(sql`INSERT INTO accounting_fiscal_years (id, tenant_id, company_id, title, start_on, end_on) VALUES (${randomUUID()}, ${b.tenantId}, ${b.companyId}, ${y.title}, ${y.start}, ${y.end})`);
  }
}

export async function systemAccount(tx: Db, b: Books, key: SystemKey): Promise<string> {
  const r = await one<{ id: string; level: string; active: boolean }>(tx, sql`SELECT id, level, active FROM accounting_accounts WHERE company_id = ${b.companyId} AND system_key = ${key}`);
  if (!r || r.level !== 'subsidiary') throw conflict('SYSTEM_ACCOUNT', `حساب سیستمی «${key}» در سرفصل حساب‌ها یافت نشد`);
  return r.id;
}

/** Open fiscal year containing `date`; posting into a closed year or outside every year is refused. */
export async function fiscalYearFor(tx: Db, b: Books, date: string, lock = false): Promise<{ id: string; start_on: string; end_on: string }> {
  const y = await one<{ id: string; status: string; start_on: string; end_on: string }>(tx, sql`SELECT id, status, start_on::text, end_on::text FROM accounting_fiscal_years
    WHERE company_id = ${b.companyId} AND ${date}::date BETWEEN start_on AND end_on ${lock ? sql`FOR UPDATE` : sql``}`);
  if (!y) throw invalid('NO_FISCAL_YEAR', 'برای این تاریخ سال مالی تعریف نشده است');
  if (y.status !== 'open') throw conflict('YEAR_CLOSED', 'سال مالی این تاریخ بسته شده است');
  return y;
}

export interface LineSpec {
  accountId?: string;
  key?: SystemKey;
  detailId?: string | null;
  debit?: bigint;
  credit?: bigint;
  description?: string;
}
export interface VoucherSpec {
  date: string;
  description: string;
  kind?: 'normal' | 'opening' | 'closing' | 'income_closing' | 'reversal';
  source: string;
  sourceRef?: string | null;
  reversesId?: string | null;
  lines: LineSpec[];
  /** post at once (automatic vouchers of approved documents) or leave as a draft for review */
  post: boolean;
  /** closing/opening vouchers: skip the active-account and detail rules (balance is still enforced) */
  system?: boolean;
  userId: string | null;
}

interface AccountCheck { id: string; level: string; active: boolean; needs_detail: boolean; name: string; code: string }

/** Validates lines: postable active accounts of this company, details where the account needs one, balance. */
/** mode: 'draft' (accounts only), 'post' (all rules + balance), 'system' (balance only: closing vouchers may carry balances of since-deactivated accounts). */
export async function checkLines(tx: Db, b: Books, lines: { accountId: string; detailId: string | null; debit: bigint; credit: bigint }[], mode: 'draft' | 'post' | 'system') {
  const strict = mode === 'post';
  const accIds = [...new Set(lines.map((l) => l.accountId))];
  const accs = accIds.length
    ? await rows<AccountCheck>(tx, sql`SELECT id, level, active, needs_detail, name, code FROM accounting_accounts WHERE company_id = ${b.companyId} AND id IN (${sql.join(accIds.map((i) => sql`${i}::uuid`), sql`, `)})`)
    : [];
  const byId = new Map(accs.map((a) => [a.id, a]));
  const detIds = [...new Set(lines.map((l) => l.detailId).filter((x): x is string => !!x))];
  const dets = detIds.length ? await rows<{ id: string; active: boolean }>(tx, sql`SELECT id, active FROM accounting_details WHERE company_id = ${b.companyId} AND id IN (${sql.join(detIds.map((i) => sql`${i}::uuid`), sql`, `)})`) : [];
  const detOk = new Map(dets.map((d) => [d.id, d.active]));
  lines.forEach((l, i) => {
    const a = byId.get(l.accountId);
    const at = `ردیف ${(i + 1).toLocaleString('fa-IR')}: `;
    if (!a) throw invalid('ACCOUNT', `${at}حساب یافت نشد`);
    if (a.level !== 'subsidiary') throw invalid('ACCOUNT_LEVEL', `${at}فقط حساب معین سند می‌خورد (${a.code} ${a.name})`);
    if (strict && !a.active) throw invalid('ACCOUNT_INACTIVE', `${at}حساب ${a.code} ${a.name} غیرفعال است`);
    if (l.detailId && detOk.get(l.detailId) === undefined) throw invalid('DETAIL', `${at}حساب تفصیلی یافت نشد`);
    if (strict && l.detailId && detOk.get(l.detailId) === false) throw invalid('DETAIL_INACTIVE', `${at}حساب تفصیلی غیرفعال است`);
    if (strict && a.needs_detail && !l.detailId) throw invalid('DETAIL_REQUIRED', `${at}حساب ${a.code} ${a.name} حساب تفصیلی لازم دارد`);
  });
  if (mode !== 'draft') {
    const d = lines.reduce((s, l) => s + l.debit, 0n);
    const c = lines.reduce((s, l) => s + l.credit, 0n);
    if (lines.length < 2 || d !== c || d === 0n) throw invalid('UNBALANCED', `سند تراز نیست (بدهکار ${d.toLocaleString('fa-IR')} و بستانکار ${c.toLocaleString('fa-IR')} ریال)`);
  }
}

export async function insertLines(tx: Db, b: Books, voucherId: string, lines: { accountId: string; detailId: string | null; debit: bigint; credit: bigint; description: string }[]) {
  let n = 0;
  for (const l of lines) {
    n++;
    await tx.execute(sql`INSERT INTO accounting_voucher_lines (id, tenant_id, company_id, voucher_id, line_no, account_id, detail_id, description, debit, credit)
      VALUES (${randomUUID()}, ${b.tenantId}, ${b.companyId}, ${voucherId}, ${n}, ${l.accountId}, ${l.detailId}, ${l.description}, ${l.debit.toString()}, ${l.credit.toString()})`);
  }
}

/** Gives the next permanent number of the fiscal year and marks the voucher posted (the trigger re-checks balance). */
export async function postNow(tx: Db, b: Books, voucherId: string, fiscalYearId: string, userId: string | null) {
  await tx.execute(sql`SELECT id FROM accounting_fiscal_years WHERE id = ${fiscalYearId} FOR UPDATE`);
  const n = await one<{ n: number }>(tx, sql`SELECT coalesce(max(number), 0)::int + 1 AS n FROM accounting_vouchers WHERE fiscal_year_id = ${fiscalYearId}`);
  await tx.execute(sql`UPDATE accounting_vouchers SET status = 'posted', number = ${n!.n}, posted_by = ${userId}, posted_at = now(), updated_at = now() WHERE id = ${voucherId}`);
  return n!.n;
}

/**
 * Books a voucher from a specification. Lines with zero amount are dropped; lines may name a system account
 * by key. Returns null when a voucher with the same (source, sourceRef) already exists (idempotent).
 */
export async function bookVoucher(tx: Db, b: Books, spec: VoucherSpec): Promise<{ id: string; number: number | null } | null> {
  if (spec.sourceRef && (await one(tx, sql`SELECT 1 FROM accounting_vouchers WHERE company_id = ${b.companyId} AND source = ${spec.source} AND source_ref = ${spec.sourceRef}`))) return null;
  const year = await fiscalYearFor(tx, b, spec.date);
  const lines = [];
  for (const l of spec.lines) {
    const debit = l.debit ?? 0n;
    const credit = l.credit ?? 0n;
    if (debit === 0n && credit === 0n) continue;
    if (debit < 0n || credit < 0n) throw new Error('negative voucher line');
    lines.push({ accountId: l.accountId ?? (await systemAccount(tx, b, l.key!)), detailId: l.detailId ?? null, debit, credit, description: l.description ?? '' });
  }
  await checkLines(tx, b, lines, spec.system ? 'system' : spec.post ? 'post' : 'draft');
  const id = randomUUID();
  await tx.execute(sql`INSERT INTO accounting_vouchers (id, tenant_id, company_id, fiscal_year_id, date, description, kind, source, source_ref, reverses_id, created_by)
    VALUES (${id}, ${b.tenantId}, ${b.companyId}, ${year.id}, ${spec.date}, ${spec.description}, ${spec.kind ?? 'normal'}, ${spec.source}, ${spec.sourceRef ?? null}, ${spec.reversesId ?? null}, ${spec.userId})`);
  await insertLines(tx, b, id, lines);
  const number = spec.post ? await postNow(tx, b, id, year.id, spec.userId) : null;
  return { id, number };
}

/**
 * Reverses a posted voucher with a mirror voucher (debit ↔ credit) dated `date`, and marks the original
 * reversed. Posted vouchers are never edited.
 */
export async function reverseVoucher(tx: Db, b: Books, voucherId: string, date: string, userId: string | null, why: string): Promise<{ id: string; number: number | null }> {
  const v = await one<{ id: string; status: string; number: number; source: string }>(tx, sql`SELECT id, status, number, source FROM accounting_vouchers WHERE id = ${voucherId} AND company_id = ${b.companyId} FOR UPDATE`);
  if (!v) throw invalid('NOT_FOUND', 'سند یافت نشد');
  if (v.status !== 'posted') throw conflict('VOUCHER_STATE', 'فقط سند قطعی را می‌توان برگرداند');
  const lines = await rows<{ account_id: string; detail_id: string | null; debit: string; credit: string; description: string }>(tx, sql`SELECT account_id, detail_id, debit::text, credit::text, description FROM accounting_voucher_lines WHERE voucher_id = ${voucherId} ORDER BY line_no`);
  const r = await bookVoucher(tx, b, {
    date,
    description: `برگشت سند ${v.number.toLocaleString('fa-IR')}${why ? ` — ${why}` : ''}`,
    kind: 'reversal',
    source: 'reversal',
    sourceRef: voucherId,
    reversesId: voucherId,
    lines: lines.map((l) => ({ accountId: l.account_id, detailId: l.detail_id, debit: BigInt(l.credit), credit: BigInt(l.debit), description: l.description })),
    post: true,
    userId,
  });
  await tx.execute(sql`UPDATE accounting_vouchers SET status = 'reversed', updated_at = now() WHERE id = ${voucherId}`);
  return r!;
}

/** Detail account for a party coming from another module, created once per source reference. */
export async function detailFor(tx: Db, b: Books, sourceRef: string, name: string, kind: 'person' | 'company' | 'project' | 'other'): Promise<string> {
  const cur = await one<{ id: string }>(tx, sql`SELECT id FROM accounting_details WHERE company_id = ${b.companyId} AND source_ref = ${sourceRef}`);
  if (cur) return cur.id;
  const id = randomUUID();
  await tx.execute(sql`INSERT INTO accounting_details (id, tenant_id, company_id, code, name, kind, source_ref)
    VALUES (${id}, ${b.tenantId}, ${b.companyId}, ${await nextDetailCode(tx, b)}, ${name.slice(0, 200).padEnd(2, '.')}, ${kind}, ${sourceRef})`);
  return id;
}

export async function nextDetailCode(tx: Db, b: Books): Promise<string> {
  const r = await one<{ n: string }>(tx, sql`SELECT (coalesce(max(code::bigint), 100000) + 1)::text AS n FROM accounting_details WHERE company_id = ${b.companyId} AND length(code) <= 10`);
  return r!.n;
}

export async function nextNumber(tx: Db, table: 'accounting_treasury_docs' | 'accounting_invoices', b: Books, kind: string): Promise<number> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${table}:${b.companyId}:${kind}`}))`);
  const r = await one<{ n: number }>(tx, sql`SELECT coalesce(max(number), 0)::int + 1 AS n FROM ${sql.raw(table)} WHERE company_id = ${b.companyId} AND kind = ${kind}`);
  return r!.n;
}
