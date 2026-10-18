import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { bookVoucher, nextDetailCode, nextNumber, one, reverseVoucher, rows, systemAccount, type Books, type LineSpec } from './books.js';
import { conflict, invalid, notFound } from './errors.js';
import { guardDb, withBooks } from './gl.js';
import type { chequeAction, transferInput, treasuryAccountInput, treasuryDocInput } from './inputs.js';

interface Treasury { id: string; kind: string; name: string; account_id: string; detail_id: string; active: boolean }

async function treasury(tx: Db, b: Books, id: string): Promise<Treasury> {
  const t = await one<Treasury>(tx, sql`SELECT id, kind, name, account_id, detail_id, active FROM accounting_treasury_accounts WHERE id = ${id} AND company_id = ${b.companyId}`);
  if (!t) throw notFound('صندوق یا حساب بانکی');
  if (!t.active) throw invalid('TREASURY_INACTIVE', 'این صندوق/حساب بانکی غیرفعال است');
  return t;
}
async function party(tx: Db, b: Books, id: string) {
  const d = await one<{ id: string; name: string }>(tx, sql`SELECT id, name FROM accounting_details WHERE id = ${id} AND company_id = ${b.companyId}`);
  if (!d) throw notFound('طرف حساب');
  return d;
}

const fa = (n: bigint | string) => BigInt(n).toLocaleString('fa-IR');

export const Treasury = {
  accounts(ctx: ModuleRequestContext) {
    return withBooks(ctx, (tx, b) =>
      rows(tx, sql`SELECT t.id, t.kind, t.name, t.bank_name, t.account_no, t.iban, t.active, t.account_id, t.detail_id,
          coalesce((SELECT sum(l.debit - l.credit) FROM accounting_voucher_lines l JOIN accounting_vouchers v ON v.id = l.voucher_id
            WHERE l.account_id = t.account_id AND l.detail_id = t.detail_id AND v.status <> 'draft'), 0)::text AS balance
        FROM accounting_treasury_accounts t WHERE t.company_id = ${b.companyId} ORDER BY t.kind, t.name`),
    );
  },

  createAccount(ctx: ModuleRequestContext, input: z.infer<typeof treasuryAccountInput>) {
    return withBooks(ctx, async (tx, b) => {
      const accountId = await systemAccount(tx, b, input.kind);
      const detailId = randomUUID();
      await tx.execute(sql`INSERT INTO accounting_details (id, tenant_id, company_id, code, name, kind) VALUES (${detailId}, ${b.tenantId}, ${b.companyId}, ${await nextDetailCode(tx, b)}, ${input.name}, ${input.kind})`);
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO accounting_treasury_accounts (id, tenant_id, company_id, kind, name, bank_name, account_no, iban, account_id, detail_id)
        VALUES (${id}, ${b.tenantId}, ${b.companyId}, ${input.kind}, ${input.name}, ${input.bankName}, ${input.accountNo}, ${input.iban}, ${accountId}, ${detailId})`);
      await ctx.audit({ action: 'accounting.treasury.created', entityType: 'accounting_treasury_account', entityId: id, after: { kind: input.kind, name: input.name } }, tx);
      return { id };
    });
  },

  docs(ctx: ModuleRequestContext, from: string, to: string) {
    return withBooks(ctx, (tx, b) =>
      rows(tx, sql`SELECT d.id, d.number, d.kind, d.date::text, d.method, d.amount::text, d.description, d.reference, d.status, d.voucher_id,
          p.name AS party, t.name AS treasury, t2.name AS to_treasury, v.number AS voucher_number
        FROM accounting_treasury_docs d LEFT JOIN accounting_details p ON p.id = d.detail_id LEFT JOIN accounting_treasury_accounts t ON t.id = d.treasury_id
          LEFT JOIN accounting_treasury_accounts t2 ON t2.id = d.to_treasury_id LEFT JOIN accounting_vouchers v ON v.id = d.voucher_id
        WHERE d.company_id = ${b.companyId} AND d.date BETWEEN ${from}::date AND ${to}::date ORDER BY d.date DESC, d.number DESC LIMIT 2000`),
    );
  },

  /** Receipt from / payment to a party, in cash, by transfer or by cheque; booked as a posted voucher at once. */
  register(ctx: ModuleRequestContext, input: z.infer<typeof treasuryDocInput>) {
    return guardDb(withBooks(ctx, async (tx, b) => {
      const p = await party(tx, b, input.detailId);
      const counter = input.counterAccountId ?? (await systemAccount(tx, b, input.kind === 'receipt' ? 'receivable' : 'payable'));
      const amount = BigInt(input.amount);
      const t = input.treasuryId ? await treasury(tx, b, input.treasuryId) : null;
      if (input.method === 'cheque' && input.kind === 'payment' && t!.kind !== 'bank') throw invalid('TREASURY_KIND', 'چک فقط از حساب بانکی صادر می‌شود');
      const number = await nextNumber(tx, 'accounting_treasury_docs', b, input.kind);
      const docId = randomUUID();
      const title = `${input.kind === 'receipt' ? 'دریافت از' : 'پرداخت به'} ${p.name}${input.method === 'cheque' ? ` — چک ${input.cheque!.number}` : ''}${input.description ? ` — ${input.description}` : ''}`;
      const lines: LineSpec[] = [];
      if (input.kind === 'receipt') {
        if (input.method === 'cheque') lines.push({ key: 'cheques_receivable', detailId: p.id, debit: amount, description: `چک ${input.cheque!.number} سررسید ${input.cheque!.dueOn}` });
        else lines.push({ accountId: t!.account_id, detailId: t!.detail_id, debit: amount });
        lines.push({ accountId: counter, detailId: p.id, credit: amount });
      } else {
        lines.push({ accountId: counter, detailId: p.id, debit: amount });
        if (input.method === 'cheque') lines.push({ key: 'cheques_payable', detailId: p.id, credit: amount, description: `چک ${input.cheque!.number} سررسید ${input.cheque!.dueOn} از ${t!.name}` });
        else lines.push({ accountId: t!.account_id, detailId: t!.detail_id, credit: amount });
      }
      await tx.execute(sql`INSERT INTO accounting_treasury_docs (id, tenant_id, company_id, number, kind, date, detail_id, counter_account_id, method, treasury_id, amount, description, reference, created_by)
        VALUES (${docId}, ${b.tenantId}, ${b.companyId}, ${number}, ${input.kind}, ${input.date}, ${p.id}, ${counter}, ${input.method}, ${input.method === 'cheque' && input.kind === 'receipt' ? null : t!.id}, ${input.amount}, ${input.description}, ${input.reference}, ${ctx.userId})`);
      const v = await bookVoucher(tx, b, { date: input.date, description: title, source: 'treasury', sourceRef: docId, lines, post: true, userId: ctx.userId });
      await tx.execute(sql`UPDATE accounting_treasury_docs SET voucher_id = ${v!.id} WHERE id = ${docId}`);
      if (input.method === 'cheque') {
        const c = input.cheque!;
        const chequeId = randomUUID();
        const status = input.kind === 'receipt' ? 'in_hand' : 'issued';
        await tx.execute(sql`INSERT INTO accounting_cheques (id, tenant_id, company_id, direction, number, sayad_id, bank_name, due_on, amount, detail_id, treasury_id, doc_id, status, description)
          VALUES (${chequeId}, ${b.tenantId}, ${b.companyId}, ${input.kind === 'receipt' ? 'received' : 'issued'}, ${c.number}, ${c.sayadId}, ${c.bankName || (t?.name ?? '')}, ${c.dueOn}, ${input.amount}, ${p.id},
            ${input.kind === 'payment' ? t!.id : null}, ${docId}, ${status}, ${input.description})`);
        await tx.execute(sql`INSERT INTO accounting_cheque_events (id, tenant_id, company_id, cheque_id, date, from_status, to_status, voucher_id, created_by)
          VALUES (${randomUUID()}, ${b.tenantId}, ${b.companyId}, ${chequeId}, ${input.date}, NULL, ${status}, ${v!.id}, ${ctx.userId})`);
      }
      await ctx.audit({ action: `accounting.treasury.${input.kind}`, entityType: 'accounting_treasury_doc', entityId: docId, after: { number, amount: input.amount, method: input.method } }, tx);
      return { id: docId, number, voucherNumber: v!.number };
    }));
  },

  transfer(ctx: ModuleRequestContext, input: z.infer<typeof transferInput>) {
    return guardDb(withBooks(ctx, async (tx, b) => {
      const from = await treasury(tx, b, input.fromId);
      const to = await treasury(tx, b, input.toId);
      const amount = BigInt(input.amount);
      const number = await nextNumber(tx, 'accounting_treasury_docs', b, 'transfer');
      const docId = randomUUID();
      await tx.execute(sql`INSERT INTO accounting_treasury_docs (id, tenant_id, company_id, number, kind, date, method, treasury_id, to_treasury_id, amount, description, reference, created_by)
        VALUES (${docId}, ${b.tenantId}, ${b.companyId}, ${number}, 'transfer', ${input.date}, 'transfer', ${from.id}, ${to.id}, ${input.amount}, ${input.description}, ${input.reference}, ${ctx.userId})`);
      const v = await bookVoucher(tx, b, {
        date: input.date, description: `انتقال از ${from.name} به ${to.name}${input.description ? ` — ${input.description}` : ''}`, source: 'treasury', sourceRef: docId, post: true, userId: ctx.userId,
        lines: [{ accountId: to.account_id, detailId: to.detail_id, debit: amount }, { accountId: from.account_id, detailId: from.detail_id, credit: amount }],
      });
      await tx.execute(sql`UPDATE accounting_treasury_docs SET voucher_id = ${v!.id} WHERE id = ${docId}`);
      return { id: docId, number };
    }));
  },

  /** Cancels a treasury document with a reversal voucher; a cheque must not have moved on since. */
  cancel(ctx: ModuleRequestContext, id: string, date: string) {
    return guardDb(withBooks(ctx, async (tx, b) => {
      const d = await one<{ status: string; voucher_id: string }>(tx, sql`SELECT status, voucher_id FROM accounting_treasury_docs WHERE id = ${id} AND company_id = ${b.companyId} FOR UPDATE`);
      if (!d) throw notFound('سند خزانه');
      if (d.status !== 'registered') throw conflict('DOC_STATE', 'این سند قبلاً ابطال شده است');
      const c = await one<{ id: string; status: string }>(tx, sql`SELECT id, status FROM accounting_cheques WHERE doc_id = ${id} FOR UPDATE`);
      if (c && c.status !== 'in_hand' && c.status !== 'issued') throw conflict('CHEQUE_MOVED', 'چک این سند وصول، واگذار یا برگشت شده است؛ ابطال ممکن نیست');
      await reverseVoucher(tx, b, d.voucher_id, date, ctx.userId, 'ابطال سند خزانه');
      if (c) {
        await tx.execute(sql`UPDATE accounting_cheques SET status = 'returned' WHERE id = ${c.id}`);
        await tx.execute(sql`INSERT INTO accounting_cheque_events (id, tenant_id, company_id, cheque_id, date, from_status, to_status, note, created_by)
          VALUES (${randomUUID()}, ${b.tenantId}, ${b.companyId}, ${c.id}, ${date}, ${c.status}, 'returned', 'ابطال سند خزانه', ${ctx.userId})`);
      }
      await tx.execute(sql`UPDATE accounting_treasury_docs SET status = 'cancelled' WHERE id = ${id}`);
      await ctx.audit({ action: 'accounting.treasury.cancelled', entityType: 'accounting_treasury_doc', entityId: id }, tx);
      return { ok: true };
    }));
  },

  cheques(ctx: ModuleRequestContext, direction: 'received' | 'issued' | undefined, open: boolean) {
    return withBooks(ctx, (tx, b) =>
      rows(tx, sql`SELECT c.id, c.direction, c.number, c.sayad_id, c.bank_name, c.due_on::text, c.amount::text, c.status, c.description, p.name AS party, c.detail_id, t.name AS treasury, c.treasury_id
        FROM accounting_cheques c JOIN accounting_details p ON p.id = c.detail_id LEFT JOIN accounting_treasury_accounts t ON t.id = c.treasury_id
        WHERE c.company_id = ${b.companyId} ${direction ? sql`AND c.direction = ${direction}` : sql``} ${open ? sql`AND c.status IN ('in_hand', 'deposited', 'issued')` : sql``}
        ORDER BY c.due_on, c.number LIMIT 2000`),
    );
  },

  chequeHistory(ctx: ModuleRequestContext, id: string) {
    return withBooks(ctx, (tx, b) =>
      rows(tx, sql`SELECT e.id, e.date::text, e.from_status, e.to_status, e.note, e.created_by, v.number AS voucher_number, e.voucher_id
        FROM accounting_cheque_events e LEFT JOIN accounting_vouchers v ON v.id = e.voucher_id WHERE e.cheque_id = ${id} AND e.company_id = ${b.companyId} ORDER BY e.created_at`),
    );
  },

  /**
   * Cheque life cycle with its voucher:
   * received: deposit (Dr in collection / Cr cheques receivable), clear (Dr bank / Cr in collection or
   * receivable), bounce or return (Dr party receivable / Cr cheque account);
   * issued: clear (Dr cheques payable / Cr bank), bounce or return (Dr cheques payable / Cr party payable).
   */
  chequeAction(ctx: ModuleRequestContext, id: string, input: z.infer<typeof chequeAction>) {
    return guardDb(withBooks(ctx, async (tx, b) => {
      const c = await one<{ id: string; direction: string; number: string; status: string; amount: string; detail_id: string; treasury_id: string | null }>(tx,
        sql`SELECT id, direction, number, status, amount::text, detail_id, treasury_id FROM accounting_cheques WHERE id = ${id} AND company_id = ${b.companyId} FOR UPDATE`);
      if (!c) throw notFound('چک');
      const amount = BigInt(c.amount);
      const p = c.detail_id;
      const lines: LineSpec[] = [];
      let to: string;
      let treasuryId = c.treasury_id;
      const bad = () => conflict('CHEQUE_STATE', 'این عملیات در وضعیت فعلی چک ممکن نیست');
      if (c.direction === 'received') {
        const holding = c.status === 'deposited' ? 'cheques_in_collection' : 'cheques_receivable';
        if (input.action === 'deposit') {
          if (c.status !== 'in_hand') throw bad();
          if (!input.treasuryId) throw invalid('TREASURY_REQUIRED', 'حساب بانکی واگذاری را انتخاب کنید');
          const t = await treasury(tx, b, input.treasuryId);
          if (t.kind !== 'bank') throw invalid('TREASURY_KIND', 'چک فقط به حساب بانکی واگذار می‌شود');
          treasuryId = t.id;
          lines.push({ key: 'cheques_in_collection', detailId: p, debit: amount }, { key: 'cheques_receivable', detailId: p, credit: amount });
          to = 'deposited';
        } else if (input.action === 'clear') {
          if (c.status !== 'in_hand' && c.status !== 'deposited') throw bad();
          const tid = c.status === 'deposited' ? c.treasury_id : input.treasuryId;
          if (!tid) throw invalid('TREASURY_REQUIRED', 'حساب بانکی یا صندوق وصول را انتخاب کنید');
          const t = await treasury(tx, b, tid);
          treasuryId = t.id;
          lines.push({ accountId: t.account_id, detailId: t.detail_id, debit: amount }, { key: holding, detailId: p, credit: amount });
          to = 'cleared';
        } else {
          if (c.status !== 'in_hand' && !(input.action === 'bounce' && c.status === 'deposited')) throw bad();
          lines.push({ key: 'receivable', detailId: p, debit: amount }, { key: holding, detailId: p, credit: amount });
          to = input.action === 'bounce' ? 'bounced' : 'returned';
        }
      } else {
        if (c.status !== 'issued' || input.action === 'deposit') throw bad();
        if (input.action === 'clear') {
          const t = await treasury(tx, b, c.treasury_id!);
          lines.push({ key: 'cheques_payable', detailId: p, debit: amount }, { accountId: t.account_id, detailId: t.detail_id, credit: amount });
          to = 'cleared';
        } else {
          lines.push({ key: 'cheques_payable', detailId: p, debit: amount }, { key: 'payable', detailId: p, credit: amount });
          to = input.action === 'bounce' ? 'bounced' : 'returned';
        }
      }
      const label: Record<string, string> = { deposited: 'واگذاری به بانک', cleared: 'وصول', bounced: 'برگشت (عدم وصول)', returned: 'عودت' };
      const v = await bookVoucher(tx, b, {
        date: input.date, description: `${label[to]} چک ${c.number} — ${fa(amount)} ریال${input.note ? ` — ${input.note}` : ''}`, source: 'cheque', sourceRef: `${c.id}:${to}`, lines, post: true, userId: ctx.userId,
      });
      await tx.execute(sql`UPDATE accounting_cheques SET status = ${to}, treasury_id = ${treasuryId} WHERE id = ${id}`);
      await tx.execute(sql`INSERT INTO accounting_cheque_events (id, tenant_id, company_id, cheque_id, date, from_status, to_status, voucher_id, note, created_by)
        VALUES (${randomUUID()}, ${b.tenantId}, ${b.companyId}, ${id}, ${input.date}, ${c.status}, ${to}, ${v?.id ?? null}, ${input.note}, ${ctx.userId})`);
      await ctx.audit({ action: `accounting.cheque.${to}`, entityType: 'accounting_cheque', entityId: id }, tx);
      return { status: to, voucherNumber: v?.number ?? null };
    }));
  },
};

export async function dueChequesWidget(ctx: ModuleRequestContext, today: string) {
  return withBooks(ctx, async (tx, b) => {
    const items = await rows(tx, sql`SELECT c.id, c.direction, c.number, c.due_on::text, c.amount::text, p.name AS party FROM accounting_cheques c JOIN accounting_details p ON p.id = c.detail_id
      WHERE c.company_id = ${b.companyId} AND c.status IN ('in_hand', 'deposited', 'issued') AND c.due_on <= ${today}::date + 7 ORDER BY c.due_on LIMIT 10`);
    return { items };
  });
}
