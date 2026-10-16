import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, ModuleEventContext, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { assertProject, checkProject, one, rows, SIGNED } from './db.js';
import { conflict, forbidden, invalid, notFound } from './errors.js';
import type { chequeActionInput, chequeInput, executeInput, obligationInput, obligationQuery, paymentRequestInput, prQuery, receiptInput, transferInput, txQuery, voidInput } from './inputs.js';
import { categoriesOf } from './setup.js';

const fa = (v: bigint | string) => BigInt(v).toLocaleString('fa-IR');

async function accountFor(tx: Db, id: string) {
  const a = await one<{ id: string; kind: string; name: string; archived: boolean; balance: string }>(
    tx,
    sql`SELECT a.id, a.kind, a.name, a.archived, (a.opening_balance + coalesce((SELECT sum(${SIGNED}) FROM finance_transactions t WHERE t.account_id = a.id), 0))::text AS balance
      FROM finance_accounts a WHERE a.id = ${id} FOR UPDATE`,
  );
  if (!a) throw notFound('حساب');
  if (a.archived) throw conflict('ARCHIVED', 'حساب بایگانی شده است');
  return a;
}

/** Money never leaves an account it is not in. */
async function assertFunds(tx: Db, accountId: string, amount: string) {
  const a = await accountFor(tx, accountId);
  if (BigInt(a.balance) < BigInt(amount)) throw conflict('INSUFFICIENT_FUNDS', `موجودی «${a.name}» (${fa(a.balance)} ریال) کافی نیست`);
  return a;
}

async function category(tx: Db, ctx: { tenantId: string; companyId: string }, id: string, kind: 'income' | 'expense') {
  const c = (await categoriesOf(tx, ctx.tenantId, ctx.companyId)).find((x) => x.id === id);
  if (!c || c.kind !== kind || c.archived) throw invalid('CATEGORY', kind === 'income' ? 'سرفصل درآمد معتبر نیست' : 'سرفصل هزینه معتبر نیست');
}

/** Paid so far on an obligation (net of reversals) and what remains. */
async function obligationState(tx: Db, id: string) {
  const o = await one<{ id: string; kind: string; amount: string; status: string; counterparty_id: string; paid: string }>(
    tx,
    sql`SELECT o.id, o.kind, o.amount::text, o.status, o.counterparty_id,
        coalesce((SELECT sum(CASE WHEN t.direction = (CASE o.kind WHEN 'receivable' THEN 'in' ELSE 'out' END) THEN t.amount ELSE -t.amount END) FROM finance_transactions t WHERE t.obligation_id = o.id), 0)::text AS paid
      FROM finance_obligations o WHERE o.id = ${id} FOR UPDATE OF o`,
  );
  if (!o) throw notFound('مطالبه/بدهی');
  return { ...o, remaining: BigInt(o.amount) - BigInt(o.paid) };
}

interface TxRow {
  type: 'receipt' | 'payment' | 'transfer';
  direction: 'in' | 'out';
  accountId: string;
  amount: string;
  occurredOn: string;
  counterpartyId?: string | null;
  categoryId?: string | null;
  costCenterId?: string | null;
  projectId?: string | null;
  contractId?: string | null;
  obligationId?: string | null;
  commitmentId?: string | null;
  paymentRequestId?: string | null;
  chequeId?: string | null;
  transferGroupId?: string | null;
  reversesId?: string | null;
  description?: string;
  reference?: string;
}

async function insertTx(tx: Db, ctx: { tenantId: string; companyId: string; userId: string | null }, companyId: string, r: TxRow): Promise<string> {
  const id = randomUUID();
  await tx.execute(sql`INSERT INTO finance_transactions (id, tenant_id, company_id, type, direction, account_id, amount, occurred_on, counterparty_id, category_id, cost_center_id,
      projects_project_id, contracts_contract_id, obligation_id, commitment_id, payment_request_id, cheque_id, transfer_group_id, reverses_id, description, reference, created_by)
    VALUES (${id}, ${ctx.tenantId}, ${companyId}, ${r.type}, ${r.direction}, ${r.accountId}, ${r.amount}, ${r.occurredOn}, ${r.counterpartyId ?? null}, ${r.categoryId ?? null}, ${r.costCenterId ?? null},
      ${r.projectId ?? null}, ${r.contractId ?? null}, ${r.obligationId ?? null}, ${r.commitmentId ?? null}, ${r.paymentRequestId ?? null}, ${r.chequeId ?? null}, ${r.transferGroupId ?? null},
      ${r.reversesId ?? null}, ${r.description ?? ''}, ${r.reference ?? ''}, ${ctx.userId})`);
  return id;
}

// ---------------------------------------------------------------- transactions

export const Transactions = {
  list: (ctx: ModuleRequestContext, f: z.infer<typeof txQuery>) =>
    ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT t.id, t.type, t.direction, t.account_id, a.name AS account_name, t.amount::text, t.occurred_on::text, t.counterparty_id, c.name AS counterparty_name,
          t.category_id, k.name AS category_name, t.projects_project_id, t.obligation_id, t.payment_request_id, t.transfer_group_id, t.reverses_id, t.description, t.reference,
          t.created_by, t.created_at, t.voided_at, t.void_reason
        FROM finance_transactions t JOIN finance_accounts a ON a.id = t.account_id LEFT JOIN finance_counterparties c ON c.id = t.counterparty_id LEFT JOIN finance_categories k ON k.id = t.category_id
        WHERE TRUE ${f.accountId ? sql`AND t.account_id = ${f.accountId}` : sql``} ${f.from ? sql`AND t.occurred_on >= ${f.from}::date` : sql``} ${f.to ? sql`AND t.occurred_on <= ${f.to}::date` : sql``}
          ${f.type ? sql`AND t.type = ${f.type}` : sql``} ${f.projectId ? sql`AND t.projects_project_id = ${f.projectId}` : sql``}
        ORDER BY t.occurred_on DESC, t.created_at DESC LIMIT 2000`),
    ),

  async receipt(ctx: ModuleRequestContext, input: z.infer<typeof receiptInput>) {
    await checkProject(ctx, input.projectId);
    return ctx.db.transaction(async (tx) => {
      await accountFor(tx, input.accountId);
      await category(tx, ctx, input.categoryId, 'income');
      let counterpartyId = input.counterpartyId;
      if (input.obligationId) {
        const o = await obligationState(tx, input.obligationId);
        if (o.kind !== 'receivable' || o.status !== 'open') throw invalid('OBLIGATION', 'مطالبه باز انتخاب کنید');
        if (BigInt(input.amount) > o.remaining) throw conflict('OVER_SETTLE', `مانده این مطالبه ${fa(o.remaining)} ریال است`);
        if (counterpartyId && counterpartyId !== o.counterparty_id) throw invalid('COUNTERPARTY', 'طرف‌حساب با مطالبه یکی نیست');
        counterpartyId = o.counterparty_id;
      }
      const id = await insertTx(tx, ctx, ctx.companyId, { type: 'receipt', direction: 'in', ...input, counterpartyId });
      await ctx.audit({ action: 'finance.receipt.recorded', entityType: 'finance_transaction', entityId: id, after: { amount: input.amount, accountId: input.accountId } }, tx);
      return { id };
    });
  },

  /** Two linked rows of type "transfer" (no category): never income, never expense. */
  async transfer(ctx: ModuleRequestContext, input: z.infer<typeof transferInput>) {
    return ctx.db.transaction(async (tx) => {
      const [first, second] = [input.fromAccountId, input.toAccountId].sort();
      await accountFor(tx, first!); // lock in a fixed order
      await accountFor(tx, second!);
      await assertFunds(tx, input.fromAccountId, input.amount);
      const group = randomUUID();
      const base = { type: 'transfer' as const, amount: input.amount, occurredOn: input.occurredOn, transferGroupId: group, description: input.description, reference: input.reference };
      await insertTx(tx, ctx, ctx.companyId, { ...base, direction: 'out', accountId: input.fromAccountId });
      await insertTx(tx, ctx, ctx.companyId, { ...base, direction: 'in', accountId: input.toAccountId });
      await ctx.audit({ action: 'finance.transfer.recorded', entityType: 'finance_transfer', entityId: group, after: input }, tx);
      return { transferGroupId: group };
    });
  },

  /** Voiding records a reversal (the original row only notes that it was voided); a transfer is voided as a whole. */
  async void(ctx: ModuleRequestContext, id: string, input: z.infer<typeof voidInput>) {
    return ctx.db.transaction(async (tx) => {
      const t = await one<{ transfer_group_id: string | null }>(tx, sql`SELECT transfer_group_id FROM finance_transactions WHERE id = ${id}`);
      if (!t) throw notFound('تراکنش');
      const originals = await rows<Record<string, string | null> & { id: string; direction: 'in' | 'out'; amount: string; account_id: string; company_id: string; voided_at: string | null; reverses_id: string | null; type: 'receipt' | 'payment' | 'transfer'; occurred_on: string }>(
        tx,
        sql`SELECT id, company_id, type, direction, account_id, amount::text, occurred_on::text, counterparty_id, category_id, cost_center_id, projects_project_id, contracts_contract_id, obligation_id,
            commitment_id, payment_request_id, cheque_id, transfer_group_id, reverses_id, description, voided_at
          FROM finance_transactions WHERE ${t.transfer_group_id ? sql`transfer_group_id = ${t.transfer_group_id}` : sql`id = ${id}`} ORDER BY direction FOR UPDATE`,
      );
      if (originals.some((o) => o.voided_at)) throw conflict('ALREADY_VOIDED', 'این تراکنش قبلاً ابطال شده است');
      if (originals.some((o) => o.reverses_id)) throw conflict('IS_REVERSAL', 'سند معکوس خودش ابطال نمی‌شود');
      if (originals.some((o) => input.occurredOn < o.occurred_on)) throw invalid('DATE', 'تاریخ ابطال نمی‌تواند قبل از تاریخ تراکنش باشد');
      // Undoing money that came in must not overdraw the account.
      for (const o of originals.filter((x) => x.direction === 'in')) await assertFunds(tx, o.account_id, o.amount);
      const group = t.transfer_group_id ? randomUUID() : null;
      const out: string[] = [];
      for (const o of originals) {
        out.push(
          await insertTx(tx, ctx, o.company_id, {
            type: o.type, direction: o.direction === 'in' ? 'out' : 'in', accountId: o.account_id, amount: o.amount, occurredOn: input.occurredOn, counterpartyId: o.counterparty_id, categoryId: o.category_id,
            costCenterId: o.cost_center_id, projectId: o.projects_project_id, contractId: o.contracts_contract_id, obligationId: o.obligation_id, commitmentId: o.commitment_id,
            paymentRequestId: o.payment_request_id, chequeId: o.cheque_id, transferGroupId: group, reversesId: o.id, description: `ابطال: ${input.reason}`,
          }),
        );
        await tx.execute(sql`UPDATE finance_transactions SET voided_at = now(), voided_by = ${ctx.userId}, void_reason = ${input.reason} WHERE id = ${o.id}`);
      }
      await ctx.audit({ action: 'finance.transaction.voided', entityType: 'finance_transaction', entityId: id, after: { reason: input.reason, reversals: out } }, tx);
      return { reversals: out };
    });
  },
};

// ---------------------------------------------------------------- payment requests

export const Payments = {
  list: async (ctx: ModuleRequestContext, f: z.infer<typeof prQuery>) => {
    const all = ctx.can('finance.transaction.view', 'company') || ctx.can('finance.payment.execute', 'company');
    return ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT p.id, p.number, p.counterparty_id, c.name AS counterparty_name, c.iban AS counterparty_iban, p.amount::text, p.due_on::text, p.description, p.category_id, k.name AS category_name,
          p.projects_project_id, p.obligation_id, p.status, p.requested_by, p.requested_at, p.approvers, p.decided_at, p.method, p.executed_by, p.executed_at, p.bank_reference, p.transaction_id
        FROM finance_payment_requests p JOIN finance_counterparties c ON c.id = p.counterparty_id JOIN finance_categories k ON k.id = p.category_id
        WHERE ${all && !f.mine ? sql`TRUE` : sql`p.requested_by = ${ctx.userId}`} ${f.status ? sql`AND p.status = ${f.status}` : sql``}
        ORDER BY (p.status IN ('requested', 'approved')) DESC, p.due_on, p.number DESC LIMIT 1000`),
    );
  },

  async create(ctx: ModuleRequestContext, input: z.infer<typeof paymentRequestInput>) {
    await assertProject(ctx, 'finance.payment.request', input.projectId);
    await checkProject(ctx, input.projectId);
    return ctx.db.transaction(async (tx) => {
      await category(tx, ctx, input.categoryId, 'expense');
      if (!(await one(tx, sql`SELECT 1 FROM finance_counterparties WHERE id = ${input.counterpartyId} AND NOT archived`))) throw invalid('COUNTERPARTY', 'ذی‌نفع معتبر نیست');
      if (input.obligationId) {
        const o = await obligationState(tx, input.obligationId);
        if (o.kind !== 'payable' || o.status !== 'open' || o.counterparty_id !== input.counterpartyId) throw invalid('OBLIGATION', 'بدهی باز همین ذی‌نفع را انتخاب کنید');
        const pending = await one<{ s: string }>(tx, sql`SELECT coalesce(sum(amount), 0)::text AS s FROM finance_payment_requests WHERE obligation_id = ${input.obligationId} AND status IN ('requested', 'approved')`);
        if (BigInt(input.amount) + BigInt(pending!.s) > o.remaining) throw conflict('OVER_SETTLE', `مانده این بدهی (با درخواست‌های در جریان) ${fa(o.remaining - BigInt(pending!.s))} ریال است`);
      }
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`finance-pr:${ctx.companyId}`}))`);
      const n = (await one<{ n: number }>(tx, sql`SELECT coalesce(max(number), 0)::int + 1 AS n FROM finance_payment_requests WHERE company_id = ${ctx.companyId}`))!.n;
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO finance_payment_requests (id, tenant_id, company_id, number, counterparty_id, amount, due_on, description, category_id, cost_center_id, projects_project_id,
          contracts_contract_id, obligation_id, commitment_id, requested_by)
        VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${n}, ${input.counterpartyId}, ${input.amount}, ${input.dueOn}, ${input.description}, ${input.categoryId}, ${input.costCenterId},
          ${input.projectId}, ${input.contractId}, ${input.obligationId}, ${input.commitmentId}, ${ctx.userId})`);
      const wf = await ctx.startWorkflow({ key: 'finance.payment', entityType: 'payment_request', entityId: id, title: `درخواست پرداخت ${n.toLocaleString('fa-IR')}: ${input.description.slice(0, 80)}`, amount: Number(input.amount) }, tx);
      await tx.execute(sql`UPDATE finance_payment_requests SET workflow_instance_id = ${wf.instanceId} WHERE id = ${id}`);
      await ctx.audit({ action: 'finance.payment.requested', entityType: 'payment_request', entityId: id, after: { amount: input.amount, number: n } }, tx);
      return { id, number: n, state: wf.state };
    });
  },

  async cancel(ctx: ModuleRequestContext, id: string) {
    await ctx.db.transaction(async (tx) => {
      const p = await one<{ status: string; requested_by: string; workflow_instance_id: string | null }>(tx, sql`SELECT status, requested_by, workflow_instance_id FROM finance_payment_requests WHERE id = ${id} FOR UPDATE`);
      if (!p || (p.requested_by !== ctx.userId && !ctx.can('finance.transaction.view', 'company'))) throw notFound('درخواست پرداخت');
      if (p.status !== 'requested' && p.status !== 'approved') throw conflict('FINISHED', 'این درخواست قابل لغو نیست');
      if (p.status === 'requested' && p.workflow_instance_id) await ctx.cancelWorkflow(p.workflow_instance_id, tx);
      await tx.execute(sql`UPDATE finance_payment_requests SET status = 'cancelled', decided_at = now() WHERE id = ${id}`);
      await ctx.audit({ action: 'finance.payment.cancelled', entityType: 'payment_request', entityId: id }, tx);
    });
  },

  /**
   * Execution by a third person: not the requester and not any approver (also a database constraint).
   * Transfer/cash moves money now; a cheque is issued and moves money when it clears.
   */
  async execute(ctx: ModuleRequestContext, id: string, input: z.infer<typeof executeInput>) {
    const r = await ctx.db.transaction(async (tx) => {
      const p = await one<{ id: string; company_id: string; number: number; status: string; requested_by: string; approvers: string[]; amount: string; counterparty_id: string; category_id: string; cost_center_id: string | null;
        projects_project_id: string | null; contracts_contract_id: string | null; obligation_id: string | null; commitment_id: string | null; description: string }>(
        tx,
        sql`SELECT id, company_id, number, status, requested_by, approvers, amount::text, counterparty_id, category_id, cost_center_id, projects_project_id, contracts_contract_id, obligation_id, commitment_id, description
          FROM finance_payment_requests WHERE id = ${id} FOR UPDATE`,
      );
      if (!p) throw notFound('درخواست پرداخت');
      if (p.status !== 'approved') throw conflict('NOT_APPROVED', 'فقط درخواست تأییدشده اجرا می‌شود');
      if (p.requested_by === ctx.userId) throw forbidden('درخواست‌کننده نمی‌تواند پرداخت را اجرا کند');
      if (p.approvers.includes(ctx.userId)) throw forbidden('تأییدکننده نمی‌تواند همان پرداخت را اجرا کند');
      if (p.obligation_id) {
        const o = await obligationState(tx, p.obligation_id);
        if (BigInt(p.amount) > o.remaining) throw conflict('OVER_SETTLE', `مانده بدهی ${fa(o.remaining)} ریال است`);
      }
      let transactionId: string | null = null;
      let chequeId: string | null = null;
      if (input.method === 'cheque') {
        await accountFor(tx, input.accountId);
        chequeId = randomUUID();
        await tx.execute(sql`INSERT INTO finance_cheques (id, tenant_id, company_id, direction, number, bank_name, amount, due_on, counterparty_id, account_id, obligation_id, payment_request_id, category_id, projects_project_id, created_by)
          SELECT ${chequeId}, ${ctx.tenantId}, ${p.company_id}, 'issued', ${input.chequeNumber}, a.bank_name, ${p.amount}, ${input.chequeDueOn}, ${p.counterparty_id}, a.id, ${p.obligation_id}, ${p.id}, ${p.category_id}, ${p.projects_project_id}, ${ctx.userId}
          FROM finance_accounts a WHERE a.id = ${input.accountId}`);
      } else {
        await assertFunds(tx, input.accountId, p.amount);
        transactionId = await insertTx(tx, ctx, p.company_id, {
          type: 'payment', direction: 'out', accountId: input.accountId, amount: p.amount, occurredOn: input.occurredOn, counterpartyId: p.counterparty_id, categoryId: p.category_id,
          costCenterId: p.cost_center_id, projectId: p.projects_project_id, contractId: p.contracts_contract_id, obligationId: p.obligation_id, commitmentId: p.commitment_id, paymentRequestId: p.id,
          description: p.description, reference: input.bankReference,
        });
      }
      await tx.execute(sql`UPDATE finance_payment_requests SET status = 'executed', method = ${input.method}, executed_by = ${ctx.userId}, executed_at = now(), transaction_id = ${transactionId},
        cheque_id = ${chequeId}, bank_reference = ${input.bankReference} WHERE id = ${id}`);
      await ctx.publish('finance.payment.executed', { paymentRequestId: id, number: p.number, amount: p.amount, method: input.method, projectId: p.projects_project_id }, tx);
      await ctx.audit({ action: 'finance.payment.executed', entityType: 'payment_request', entityId: id, after: { method: input.method, accountId: input.accountId, transactionId, chequeId } }, tx);
      return p;
    });
    await ctx.notify({ userIds: [r.requested_by], type: 'finance.payment.executed', title: `درخواست پرداخت ${r.number.toLocaleString('fa-IR')} اجرا شد`, link: '/app/finance/payments' });
    return { ok: true };
  },
};

export async function onWorkflowCompleted(ctx: ModuleEventContext, p: { moduleId: string; entityType: string; entityId: string; state: 'approved' | 'rejected'; deciders?: string[] }) {
  if (p.moduleId !== 'finance' || p.entityType !== 'payment_request') return;
  const r = await ctx.db.transaction((tx) =>
    one<{ requested_by: string; number: number }>(tx, sql`UPDATE finance_payment_requests SET status = ${p.state}, approvers = ${`{${(p.deciders ?? []).join(',')}}`}::uuid[], decided_at = now()
      WHERE id = ${p.entityId} AND status = 'requested' RETURNING requested_by, number`),
  );
  if (r) await ctx.notify({ userIds: [r.requested_by], type: 'finance.payment.decided', title: `درخواست پرداخت ${r.number.toLocaleString('fa-IR')} ${p.state === 'approved' ? 'تأیید شد و آماده اجراست' : 'رد شد'}`, link: '/app/finance/payments' });
}

// ---------------------------------------------------------------- receivables, payables, cheques

export const Obligations = {
  list: (ctx: ModuleRequestContext, f: z.infer<typeof obligationQuery>, today: string) =>
    ctx.db.transaction(async (tx) => {
      const list = await rows<{ id: string; kind: string; counterparty_id: string; counterparty_name: string; amount: string; issued_on: string; due_on: string; description: string; reference: string; projects_project_id: string | null; source: string; status: string; paid: string }>(
        tx,
        sql`SELECT o.id, o.kind, o.counterparty_id, c.name AS counterparty_name, o.amount::text, o.issued_on::text, o.due_on::text, o.description, o.reference, o.projects_project_id, o.source, o.status,
            coalesce((SELECT sum(CASE WHEN t.direction = (CASE o.kind WHEN 'receivable' THEN 'in' ELSE 'out' END) THEN t.amount ELSE -t.amount END) FROM finance_transactions t WHERE t.obligation_id = o.id), 0)::text AS paid
          FROM finance_obligations o JOIN finance_counterparties c ON c.id = o.counterparty_id WHERE TRUE ${f.kind ? sql`AND o.kind = ${f.kind}` : sql``} ORDER BY o.due_on LIMIT 2000`,
      );
      const withState = list.map((o) => {
        const remaining = BigInt(o.amount) - BigInt(o.paid);
        const state = o.status === 'cancelled' ? 'cancelled' : remaining <= 0n ? 'settled' : o.due_on < today ? 'overdue' : 'open';
        return { ...o, remaining: remaining.toString(), state };
      });
      return f.state ? withState.filter((o) => o.state === f.state || (f.state === 'open' && o.state === 'overdue')) : withState;
    }),

  async create(ctx: ModuleRequestContext, input: z.infer<typeof obligationInput>) {
    await checkProject(ctx, input.projectId);
    return ctx.db.transaction(async (tx) => {
      if (!(await one(tx, sql`SELECT 1 FROM finance_counterparties WHERE id = ${input.counterpartyId}`))) throw invalid('COUNTERPARTY', 'طرف‌حساب معتبر نیست');
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO finance_obligations (id, tenant_id, company_id, kind, counterparty_id, amount, issued_on, due_on, description, reference, projects_project_id, contracts_contract_id, created_by)
        VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.kind}, ${input.counterpartyId}, ${input.amount}, ${input.issuedOn}, ${input.dueOn}, ${input.description}, ${input.reference},
          ${input.projectId}, ${input.contractId}, ${ctx.userId})`);
      await ctx.audit({ action: 'finance.obligation.created', entityType: 'finance_obligation', entityId: id, after: { kind: input.kind, amount: input.amount } }, tx);
      return { id };
    });
  },

  async cancel(ctx: ModuleRequestContext, id: string) {
    await ctx.db.transaction(async (tx) => {
      const o = await obligationState(tx, id);
      if (o.status !== 'open') throw conflict('FINISHED', 'قبلاً لغو شده است');
      if (BigInt(o.paid) !== 0n) throw conflict('HAS_PAYMENTS', 'برای این مورد دریافت/پرداخت ثبت شده است؛ ابتدا آن را ابطال کنید');
      if (await one(tx, sql`SELECT 1 FROM finance_payment_requests WHERE obligation_id = ${id} AND status IN ('requested', 'approved')`)) throw conflict('HAS_REQUESTS', 'درخواست پرداخت در جریان دارد');
      await tx.execute(sql`UPDATE finance_obligations SET status = 'cancelled' WHERE id = ${id}`);
      await ctx.audit({ action: 'finance.obligation.cancelled', entityType: 'finance_obligation', entityId: id }, tx);
    });
  },
};

export const Cheques = {
  list: (ctx: ModuleRequestContext) =>
    ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT q.id, q.direction, q.number, q.bank_name, q.amount::text, q.due_on::text, q.counterparty_id, c.name AS counterparty_name, q.account_id, q.obligation_id, q.payment_request_id,
          q.status, q.status_note, q.transaction_id, q.created_at
        FROM finance_cheques q JOIN finance_counterparties c ON c.id = q.counterparty_id ORDER BY (q.status = 'pending') DESC, q.due_on LIMIT 2000`),
    ),

  async receive(ctx: ModuleRequestContext, input: z.infer<typeof chequeInput>) {
    await checkProject(ctx, input.projectId);
    return ctx.db.transaction(async (tx) => {
      await category(tx, ctx, input.categoryId, 'income');
      if (input.obligationId) {
        const o = await obligationState(tx, input.obligationId);
        if (o.kind !== 'receivable' || o.counterparty_id !== input.counterpartyId) throw invalid('OBLIGATION', 'مطالبه همین طرف‌حساب را انتخاب کنید');
      }
      const id = randomUUID();
      try {
        await tx.execute(sql`INSERT INTO finance_cheques (id, tenant_id, company_id, direction, number, bank_name, amount, due_on, counterparty_id, obligation_id, category_id, projects_project_id, created_by)
          VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, 'received', ${input.number}, ${input.bankName}, ${input.amount}, ${input.dueOn}, ${input.counterpartyId}, ${input.obligationId}, ${input.categoryId},
            ${input.projectId}, ${ctx.userId})`);
      } catch (e) {
        if ((e as { cause?: { code?: string } }).cause?.code === '23505') throw conflict('DUPLICATE', 'چکی با این شماره و بانک ثبت شده است');
        throw e;
      }
      return { id };
    });
  },

  /** Clearing moves the money (receipt into / payment out of the account); bouncing and cancelling do not. */
  async act(ctx: ModuleRequestContext, id: string, input: z.infer<typeof chequeActionInput>) {
    return ctx.db.transaction(async (tx) => {
      const q = await one<{ id: string; company_id: string; direction: 'received' | 'issued'; status: string; amount: string; account_id: string | null; counterparty_id: string; obligation_id: string | null;
        payment_request_id: string | null; category_id: string; projects_project_id: string | null; number: string }>(
        tx,
        sql`SELECT id, company_id, direction, status, amount::text, account_id, counterparty_id, obligation_id, payment_request_id, category_id, projects_project_id, number FROM finance_cheques WHERE id = ${id} FOR UPDATE`,
      );
      if (!q) throw notFound('چک');
      if (q.status !== 'pending') throw conflict('FINISHED', 'وضعیت این چک قبلاً تعیین شده است');
      let transactionId: string | null = null;
      if (input.action === 'clear') {
        const accountId = q.direction === 'issued' ? q.account_id! : input.accountId!;
        if (q.direction === 'issued') await assertFunds(tx, accountId, q.amount);
        else await accountFor(tx, accountId);
        if (q.obligation_id && q.direction === 'received') {
          const o = await obligationState(tx, q.obligation_id);
          if (BigInt(q.amount) > o.remaining) throw conflict('OVER_SETTLE', `مانده مطالبه ${fa(o.remaining)} ریال است`);
        }
        transactionId = await insertTx(tx, ctx, q.company_id, {
          type: q.direction === 'received' ? 'receipt' : 'payment', direction: q.direction === 'received' ? 'in' : 'out', accountId, amount: q.amount, occurredOn: input.occurredOn,
          counterpartyId: q.counterparty_id, categoryId: q.category_id, projectId: q.projects_project_id, obligationId: q.obligation_id, paymentRequestId: q.payment_request_id, chequeId: q.id,
          description: `وصول چک ${q.number}`, reference: q.number,
        });
      }
      const status = { clear: 'cleared', bounce: 'bounced', cancel: 'cancelled' }[input.action];
      await tx.execute(sql`UPDATE finance_cheques SET status = ${status}, transaction_id = ${transactionId}, account_id = coalesce(account_id, ${input.accountId}), status_note = ${input.note} WHERE id = ${id}`);
      await ctx.audit({ action: `finance.cheque.${status}`, entityType: 'finance_cheque', entityId: id, after: { transactionId, note: input.note } }, tx);
      return { transactionId };
    });
  },
};

