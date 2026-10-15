import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, ModuleEventContext, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { computeStatement } from './calc.js';
import { conflict, forbidden, invalid, notFound } from './errors.js';
import type { activeContractUpdate, amendmentInput, contractInput, guaranteeInput, guaranteeStatusInput, listQuery, obligationInput, paymentTermInput, statementInput } from './inputs.js';

type Row = Record<string, unknown>;
const rows = async <T = Row>(tx: Db, q: SQL) => (await tx.execute(q)).rows as T[];
const one = async <T = Row>(tx: Db, q: SQL) => (await rows<T>(tx, q))[0];

export interface ContractRow {
  id: string;
  company_id: string;
  code: string;
  title: string;
  kind: string;
  direction: 'income' | 'expense';
  counterparty_name: string;
  crm_account_id: string | null;
  projects_project_id: string | null;
  owner_id: string | null;
  initial_amount: string;
  prepayment_amount: string;
  signed_on: string | null;
  start_on: string | null;
  end_on: string | null;
  status: 'draft' | 'active' | 'completed' | 'terminated';
  good_performance_pct: string;
  insurance_pct: string;
  tax_pct: string;
  vat_pct: string;
  prepayment_recovery_pct: string;
  description: string;
  created_by: string;
  created_at: string;
  version: number;
  current_amount: string;
  approved_gross: string;
}

// Dates leave PostgreSQL as text so they never shift through a JS Date in another time zone.
const CONTRACT_COLUMNS = sql`c.id, c.company_id, c.code, c.title, c.kind, c.direction, c.counterparty_name, c.crm_account_id, c.projects_project_id, c.owner_id,
  c.initial_amount::text, c.prepayment_amount::text, c.signed_on::text, c.start_on::text, c.end_on::text, c.status,
  c.good_performance_pct::text, c.insurance_pct::text, c.tax_pct::text, c.vat_pct::text, c.prepayment_recovery_pct::text,
  c.description, c.created_by, c.created_at, c.version,
  (c.initial_amount + coalesce((SELECT sum(a.amount_delta) FROM contracts_amendments a WHERE a.contract_id = c.id), 0))::text AS current_amount,
  coalesce((SELECT max(s.cumulative_gross) FROM contracts_statements s WHERE s.contract_id = c.id AND s.status = 'approved' AND s.deleted_at IS NULL), 0)::text AS approved_gross`;

/** "own" scope: contracts the user is responsible for or registered. */
function visibility(ctx: ModuleRequestContext, permission: string): SQL {
  return ctx.can(permission, 'company') ? sql`TRUE` : sql`(c.owner_id = ${ctx.userId} OR c.created_by = ${ctx.userId})`;
}

async function history(tx: Db, ctx: ModuleRequestContext, c: { id: string; company_id: string }, action: string, summary: string, changes: Record<string, unknown> = {}) {
  await tx.execute(sql`INSERT INTO contracts_history (id, tenant_id, company_id, contract_id, action, summary, changes, actor_id)
    VALUES (${randomUUID()}, ${ctx.tenantId}, ${c.company_id}, ${c.id}, ${action}, ${summary}, ${JSON.stringify(changes)}::jsonb, ${ctx.userId})`);
  await ctx.audit({ action: `contracts.${action}`, entityType: 'contract', entityId: c.id, after: changes }, tx);
}

async function validateUser(ctx: ModuleRequestContext, id: string | null) {
  if (id && !(await ctx.directory([id])).length) throw invalid('UNKNOWN_USER', 'کاربر انتخاب‌شده عضو فعال سازمان نیست');
}

/** Contract visible to the caller with the given permission, locked for update when `lock`. */
async function loadContract(tx: Db, ctx: ModuleRequestContext, id: string, permission: string, lock = false): Promise<ContractRow> {
  const c = await one<ContractRow>(tx, sql`SELECT ${CONTRACT_COLUMNS} FROM contracts_contracts c
    WHERE c.id = ${id} AND c.deleted_at IS NULL AND ${visibility(ctx, permission)} ${lock ? sql`FOR UPDATE OF c` : sql``}`);
  if (!c) throw notFound();
  return c;
}

const ACTIVE_ONLY = 'این عملیات فقط برای قرارداد امضاشده (جاری) ممکن است';

export const Contracts = {
  async list(ctx: ModuleRequestContext, f: z.infer<typeof listQuery>) {
    const q = f.q ? `%${f.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null;
    return ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT ${CONTRACT_COLUMNS} FROM contracts_contracts c
        WHERE c.deleted_at IS NULL AND ${visibility(ctx, 'contracts.contract.view')}
          ${f.status ? sql`AND c.status = ${f.status}` : sql``}
          ${f.direction ? sql`AND c.direction = ${f.direction}` : sql``}
          ${f.projectId ? sql`AND c.projects_project_id = ${f.projectId}` : sql``}
          ${q ? sql`AND (c.code ILIKE ${q} OR c.title ILIKE ${q} OR c.counterparty_name ILIKE ${q})` : sql``}
        ORDER BY CASE c.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, c.end_on NULLS LAST, c.created_at DESC
        LIMIT 500`),
    );
  },

  async summary(ctx: ModuleRequestContext) {
    return ctx.db.transaction(async (tx) => {
      const r = await one<{ active: number; draft: number; income: string; expense: string }>(tx, sql`
        WITH cur AS (SELECT c.status, c.direction, c.initial_amount + coalesce((SELECT sum(a.amount_delta) FROM contracts_amendments a WHERE a.contract_id = c.id), 0) AS amount
                       FROM contracts_contracts c WHERE c.deleted_at IS NULL AND ${visibility(ctx, 'contracts.contract.view')})
        SELECT count(*) FILTER (WHERE status = 'active')::int AS active, count(*) FILTER (WHERE status = 'draft')::int AS draft,
               coalesce(sum(amount) FILTER (WHERE status = 'active' AND direction = 'income'), 0)::text AS income,
               coalesce(sum(amount) FILTER (WHERE status = 'active' AND direction = 'expense'), 0)::text AS expense FROM cur`);
      return r!;
    });
  },

  async get(ctx: ModuleRequestContext, id: string) {
    return ctx.db.transaction(async (tx) => {
      const c = await loadContract(tx, ctx, id, 'contracts.contract.view');
      const [amendments, guarantees, paymentTerms, obligations, statements, hist] = await Promise.all([
        rows(tx, sql`SELECT id, number, kind, title, amount_delta::text, new_end_on::text, signed_on::text, description, created_by, created_at FROM contracts_amendments WHERE contract_id = ${id} ORDER BY number`),
        rows(tx, sql`SELECT id, kind, number, issuer, amount::text, issued_on::text, expires_on::text, status, status_changed_on::text FROM contracts_guarantees WHERE contract_id = ${id} AND deleted_at IS NULL ORDER BY expires_on NULLS LAST`),
        rows(tx, sql`SELECT id, title, amount::text, percent::text, due_on::text, condition FROM contracts_payment_terms WHERE contract_id = ${id} AND deleted_at IS NULL ORDER BY sort, due_on NULLS LAST, created_at`),
        rows(tx, sql`SELECT id, party, description, due_on::text, done_on::text FROM contracts_obligations WHERE contract_id = ${id} AND deleted_at IS NULL ORDER BY done_on NULLS FIRST, due_on NULLS LAST`),
        rows(tx, sql`SELECT id, number, period_from::text, period_to::text, cumulative_gross::text, period_gross::text, good_performance::text, insurance::text, tax::text,
                       prepayment_recovery::text, other_deductions::text, vat::text, net_payable::text, status, workflow_instance_id, note, created_by, created_at, decided_at
                       FROM contracts_statements WHERE contract_id = ${id} AND deleted_at IS NULL ORDER BY number DESC`),
        rows(tx, sql`SELECT id, action, summary, changes, actor_id, created_at FROM contracts_history WHERE contract_id = ${id} ORDER BY created_at DESC LIMIT 200`),
      ]);
      // Sensitive record: every view is written to the audit log (prompt §7).
      await ctx.audit({ action: 'contracts.contract.viewed', entityType: 'contract', entityId: id }, tx);
      return { contract: c, amendments, guarantees, paymentTerms, obligations, statements, history: hist };
    });
  },

  async create(ctx: ModuleRequestContext, input: z.infer<typeof contractInput>) {
    await validateUser(ctx, input.ownerId);
    const s = await ctx.settings<{ defaultGoodPerformancePct: number; defaultInsurancePct: number; defaultTaxPct: number; defaultVatPct: number }>();
    const id = randomUUID();
    await ctx.db.transaction(async (tx) => {
      const dup = await one(tx, sql`SELECT 1 FROM contracts_contracts WHERE company_id = ${ctx.companyId} AND code = ${input.code} AND deleted_at IS NULL`);
      if (dup) throw conflict('DUPLICATE_CODE', 'قراردادی با این شماره در این شرکت ثبت شده است');
      await tx.execute(sql`INSERT INTO contracts_contracts (id, tenant_id, company_id, code, title, kind, direction, counterparty_name, crm_account_id, projects_project_id, owner_id,
          initial_amount, prepayment_amount, start_on, end_on, good_performance_pct, insurance_pct, tax_pct, vat_pct, prepayment_recovery_pct, description, created_by)
        VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.code}, ${input.title}, ${input.kind}, ${input.direction}, ${input.counterpartyName}, ${input.crmAccountId}, ${input.projectId},
          ${input.ownerId ?? ctx.userId}, ${input.initialAmount}, ${input.prepaymentAmount}, ${input.startOn}, ${input.endOn},
          ${input.goodPerformancePct ?? String(s.defaultGoodPerformancePct)}, ${input.insurancePct ?? String(s.defaultInsurancePct)}, ${input.taxPct ?? String(s.defaultTaxPct)},
          ${input.vatPct ?? String(s.defaultVatPct)}, ${input.prepaymentRecoveryPct}, ${input.description}, ${ctx.userId})`);
      await history(tx, ctx, { id, company_id: ctx.companyId }, 'contract.created', `ثبت قرارداد ${input.code}`, { code: input.code, initialAmount: input.initialAmount });
      await ctx.publish('contracts.contract.created', { contractId: id, code: input.code, projectId: input.projectId, crmAccountId: input.crmAccountId }, tx);
    });
    return { id };
  },

  /** Draft: every field. Signed: descriptive fields only; amount and dates change through amendments. */
  async update(ctx: ModuleRequestContext, id: string, expectedVersion: number, input: z.infer<typeof contractInput> | z.infer<typeof activeContractUpdate>) {
    await validateUser(ctx, input.ownerId);
    await ctx.db.transaction(async (tx) => {
      const c = await loadContract(tx, ctx, id, 'contracts.contract.update', true);
      if (c.version !== expectedVersion) throw conflict('STALE', 'این قرارداد هم‌زمان توسط کاربر دیگری تغییر کرده است؛ صفحه را تازه کنید');
      if (c.status === 'completed' || c.status === 'terminated') throw conflict('CLOSED', 'قرارداد بسته‌شده قابل ویرایش نیست');
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const track = (k: string, from: unknown, to: unknown) => {
        if (String(from ?? '') !== String(to ?? '')) changes[k] = { from, to };
      };
      track('title', c.title, input.title);
      track('counterpartyName', c.counterparty_name, input.counterpartyName);
      track('ownerId', c.owner_id, input.ownerId);
      track('projectId', c.projects_project_id, input.projectId);
      track('crmAccountId', c.crm_account_id, input.crmAccountId);
      track('description', c.description, input.description);
      if (c.status === 'draft') {
        if (!('code' in input)) throw invalid('VALIDATION_FAILED', 'اطلاعات کامل قرارداد لازم است');
        if (input.code !== c.code) {
          const dup = await one(tx, sql`SELECT 1 FROM contracts_contracts WHERE company_id = ${c.company_id} AND code = ${input.code} AND deleted_at IS NULL AND id <> ${id}`);
          if (dup) throw conflict('DUPLICATE_CODE', 'قراردادی با این شماره در این شرکت ثبت شده است');
        }
        track('code', c.code, input.code);
        track('kind', c.kind, input.kind);
        track('direction', c.direction, input.direction);
        track('initialAmount', c.initial_amount, input.initialAmount);
        track('prepaymentAmount', c.prepayment_amount, input.prepaymentAmount);
        track('startOn', c.start_on, input.startOn);
        track('endOn', c.end_on, input.endOn);
        for (const [k, col] of [['goodPerformancePct', 'good_performance_pct'], ['insurancePct', 'insurance_pct'], ['taxPct', 'tax_pct'], ['vatPct', 'vat_pct'], ['prepaymentRecoveryPct', 'prepayment_recovery_pct']] as const) {
          const v = input[k];
          if (v !== undefined && Number(v) !== Number(c[col])) changes[k] = { from: c[col], to: v };
        }
        await tx.execute(sql`UPDATE contracts_contracts SET code = ${input.code}, title = ${input.title}, kind = ${input.kind}, direction = ${input.direction}, counterparty_name = ${input.counterpartyName},
            crm_account_id = ${input.crmAccountId}, projects_project_id = ${input.projectId}, owner_id = ${input.ownerId}, initial_amount = ${input.initialAmount}, prepayment_amount = ${input.prepaymentAmount},
            start_on = ${input.startOn}, end_on = ${input.endOn}, good_performance_pct = ${input.goodPerformancePct ?? c.good_performance_pct}, insurance_pct = ${input.insurancePct ?? c.insurance_pct},
            tax_pct = ${input.taxPct ?? c.tax_pct}, vat_pct = ${input.vatPct ?? c.vat_pct}, prepayment_recovery_pct = ${input.prepaymentRecoveryPct ?? c.prepayment_recovery_pct},
            description = ${input.description}, updated_at = now(), updated_by = ${ctx.userId}, version = version + 1 WHERE id = ${id}`);
      } else {
        await tx.execute(sql`UPDATE contracts_contracts SET title = ${input.title}, counterparty_name = ${input.counterpartyName}, crm_account_id = ${input.crmAccountId},
            projects_project_id = ${input.projectId}, owner_id = ${input.ownerId}, description = ${input.description}, updated_at = now(), updated_by = ${ctx.userId}, version = version + 1 WHERE id = ${id}`);
      }
      if (Object.keys(changes).length) await history(tx, ctx, c, 'contract.updated', 'ویرایش مشخصات قرارداد', changes);
    });
  },

  async activate(ctx: ModuleRequestContext, id: string, signedOn: string) {
    await ctx.db.transaction(async (tx) => {
      const c = await loadContract(tx, ctx, id, 'contracts.contract.update', true);
      if (c.status !== 'draft') throw conflict('NOT_DRAFT', 'فقط قرارداد پیش‌نویس قابل ثبت امضا است');
      await tx.execute(sql`UPDATE contracts_contracts SET status = 'active', signed_on = ${signedOn}, start_on = coalesce(start_on, ${signedOn}::date), updated_at = now(), updated_by = ${ctx.userId}, version = version + 1 WHERE id = ${id}`);
      await history(tx, ctx, c, 'contract.activated', 'ثبت امضای قرارداد؛ از این پس مبلغ و مدت فقط با الحاقیه تغییر می‌کند', { signedOn });
      await ctx.publish('contracts.contract.activated', { contractId: id, code: c.code, projectId: c.projects_project_id }, tx);
    });
  },

  async close(ctx: ModuleRequestContext, id: string, status: 'completed' | 'terminated', note: string) {
    await ctx.db.transaction(async (tx) => {
      const c = await loadContract(tx, ctx, id, 'contracts.contract.update', true);
      if (c.status !== 'active') throw conflict('NOT_ACTIVE', ACTIVE_ONLY);
      const open = await one(tx, sql`SELECT 1 FROM contracts_statements WHERE contract_id = ${id} AND status = 'submitted' AND deleted_at IS NULL`);
      if (open) throw conflict('STATEMENT_PENDING', 'صورت‌وضعیتی در انتظار تأیید است؛ ابتدا تکلیف آن را روشن کنید');
      await tx.execute(sql`UPDATE contracts_contracts SET status = ${status}, updated_at = now(), updated_by = ${ctx.userId}, version = version + 1 WHERE id = ${id}`);
      await history(tx, ctx, c, `contract.${status}`, status === 'completed' ? 'پایان قرارداد' : 'فسخ قرارداد', { note });
    });
  },

  async remove(ctx: ModuleRequestContext, id: string) {
    await ctx.db.transaction(async (tx) => {
      const c = await loadContract(tx, ctx, id, 'contracts.contract.delete', true);
      if (c.status !== 'draft') throw conflict('NOT_DRAFT', 'فقط قرارداد پیش‌نویس قابل حذف است؛ قرارداد امضاشده را پایان دهید یا فسخ کنید');
      await tx.execute(sql`UPDATE contracts_contracts SET deleted_at = now(), updated_by = ${ctx.userId} WHERE id = ${id}`);
      await ctx.audit({ action: 'contracts.contract.deleted', entityType: 'contract', entityId: id, before: { code: c.code } }, tx);
    });
  },

  // ------------------------------------------------------------- amendments

  async addAmendment(ctx: ModuleRequestContext, id: string, input: z.infer<typeof amendmentInput>) {
    return ctx.db.transaction(async (tx) => {
      const c = await loadContract(tx, ctx, id, 'contracts.contract.update', true);
      if (c.status !== 'active') throw conflict('NOT_ACTIVE', ACTIVE_ONLY);
      if (BigInt(c.current_amount) + BigInt(input.amountDelta) < 0n) throw invalid('NEGATIVE_AMOUNT', 'مبلغ قرارداد پس از الحاقیه منفی می‌شود');
      if (input.newEndOn && c.start_on && input.newEndOn < c.start_on) throw invalid('BAD_END', 'تاریخ پایان جدید قبل از شروع قرارداد است');
      const n = await one<{ n: number }>(tx, sql`SELECT coalesce(max(number), 0)::int + 1 AS n FROM contracts_amendments WHERE contract_id = ${id}`);
      const amendmentId = randomUUID();
      await tx.execute(sql`INSERT INTO contracts_amendments (id, tenant_id, company_id, contract_id, number, kind, title, amount_delta, new_end_on, signed_on, description, created_by)
        VALUES (${amendmentId}, ${ctx.tenantId}, ${c.company_id}, ${id}, ${n!.n}, ${input.kind}, ${input.title}, ${input.amountDelta}, ${input.newEndOn}, ${input.signedOn}, ${input.description}, ${ctx.userId})`);
      if (input.newEndOn) await tx.execute(sql`UPDATE contracts_contracts SET end_on = ${input.newEndOn}, updated_at = now(), version = version + 1 WHERE id = ${id}`);
      else await tx.execute(sql`UPDATE contracts_contracts SET updated_at = now(), version = version + 1 WHERE id = ${id}`);
      await history(tx, ctx, c, 'amendment.added', `الحاقیه شماره ${n!.n}: ${input.title}`, {
        amountDelta: input.amountDelta,
        newAmount: (BigInt(c.current_amount) + BigInt(input.amountDelta)).toString(),
        ...(input.newEndOn ? { endOn: { from: c.end_on, to: input.newEndOn } } : {}),
      });
      return { id: amendmentId, number: n!.n };
    });
  },

  // ------------------------------------------------------------- guarantees, payment terms, obligations

  async addGuarantee(ctx: ModuleRequestContext, id: string, input: z.infer<typeof guaranteeInput>) {
    return ctx.db.transaction(async (tx) => {
      const c = await loadContract(tx, ctx, id, 'contracts.contract.update');
      if (c.status === 'completed' || c.status === 'terminated') throw conflict('CLOSED', 'قرارداد بسته شده است');
      const gid = randomUUID();
      await tx.execute(sql`INSERT INTO contracts_guarantees (id, tenant_id, company_id, contract_id, kind, number, issuer, amount, issued_on, expires_on, created_by)
        VALUES (${gid}, ${ctx.tenantId}, ${c.company_id}, ${id}, ${input.kind}, ${input.number}, ${input.issuer}, ${input.amount}, ${input.issuedOn}, ${input.expiresOn}, ${ctx.userId})`);
      await history(tx, ctx, c, 'guarantee.added', `ثبت ضمانت‌نامه ${input.number || ''}`.trim(), { kind: input.kind, amount: input.amount, expiresOn: input.expiresOn });
      return { id: gid };
    });
  },

  async setGuaranteeStatus(ctx: ModuleRequestContext, id: string, gid: string, input: z.infer<typeof guaranteeStatusInput>) {
    await ctx.db.transaction(async (tx) => {
      const c = await loadContract(tx, ctx, id, 'contracts.contract.update');
      const g = await one<{ status: string; number: string }>(tx, sql`SELECT status, number FROM contracts_guarantees WHERE id = ${gid} AND contract_id = ${id} AND deleted_at IS NULL FOR UPDATE`);
      if (!g) throw notFound('ضمانت‌نامه');
      await tx.execute(sql`UPDATE contracts_guarantees SET status = ${input.status}, status_changed_on = ${input.on}, updated_at = now() WHERE id = ${gid}`);
      await history(tx, ctx, c, 'guarantee.status', `تغییر وضعیت ضمانت‌نامه ${g.number}`.trim(), { status: { from: g.status, to: input.status }, on: input.on });
    });
  },

  async addPaymentTerm(ctx: ModuleRequestContext, id: string, input: z.infer<typeof paymentTermInput>) {
    return ctx.db.transaction(async (tx) => {
      const c = await loadContract(tx, ctx, id, 'contracts.contract.update');
      const pid = randomUUID();
      await tx.execute(sql`INSERT INTO contracts_payment_terms (id, tenant_id, company_id, contract_id, title, amount, percent, due_on, condition, sort, created_by)
        VALUES (${pid}, ${ctx.tenantId}, ${c.company_id}, ${id}, ${input.title}, ${input.amount}, ${input.percent}, ${input.dueOn}, ${input.condition},
          (SELECT coalesce(max(sort), 0) + 1 FROM contracts_payment_terms WHERE contract_id = ${id}), ${ctx.userId})`);
      await history(tx, ctx, c, 'payment_term.added', `افزودن شرط پرداخت: ${input.title}`, { amount: input.amount, percent: input.percent, dueOn: input.dueOn });
      return { id: pid };
    });
  },

  async addObligation(ctx: ModuleRequestContext, id: string, input: z.infer<typeof obligationInput>) {
    return ctx.db.transaction(async (tx) => {
      const c = await loadContract(tx, ctx, id, 'contracts.contract.update');
      const oid = randomUUID();
      await tx.execute(sql`INSERT INTO contracts_obligations (id, tenant_id, company_id, contract_id, party, description, due_on, created_by)
        VALUES (${oid}, ${ctx.tenantId}, ${c.company_id}, ${id}, ${input.party}, ${input.description}, ${input.dueOn}, ${ctx.userId})`);
      await history(tx, ctx, c, 'obligation.added', `افزودن تعهد: ${input.description.slice(0, 80)}`, { party: input.party, dueOn: input.dueOn });
      return { id: oid };
    });
  },

  async setObligationDone(ctx: ModuleRequestContext, id: string, oid: string, doneOn: string | null) {
    await ctx.db.transaction(async (tx) => {
      const c = await loadContract(tx, ctx, id, 'contracts.contract.update');
      const r = await rows(tx, sql`UPDATE contracts_obligations SET done_on = ${doneOn} WHERE id = ${oid} AND contract_id = ${id} AND deleted_at IS NULL RETURNING description`);
      if (!r.length) throw notFound('تعهد');
      await history(tx, ctx, c, 'obligation.done', `${doneOn ? 'انجام' : 'بازگشایی'} تعهد: ${String(r[0]!.description).slice(0, 80)}`, { doneOn });
    });
  },

  /** Removes a payment term, obligation or guarantee (soft delete, recorded in history). */
  async removeItem(ctx: ModuleRequestContext, id: string, kind: 'guarantee' | 'payment-term' | 'obligation', itemId: string) {
    const table = { guarantee: sql`contracts_guarantees`, 'payment-term': sql`contracts_payment_terms`, obligation: sql`contracts_obligations` }[kind];
    const label = { guarantee: 'ضمانت‌نامه', 'payment-term': 'شرط پرداخت', obligation: 'تعهد' }[kind];
    await ctx.db.transaction(async (tx) => {
      const c = await loadContract(tx, ctx, id, 'contracts.contract.update');
      const r = await rows(tx, sql`UPDATE ${table} SET deleted_at = now() WHERE id = ${itemId} AND contract_id = ${id} AND deleted_at IS NULL RETURNING id`);
      if (!r.length) throw notFound(label);
      await history(tx, ctx, c, `${kind}.removed`, `حذف ${label}`, { id: itemId });
    });
  },

  // ------------------------------------------------------------- progress statements

  async previewStatement(ctx: ModuleRequestContext, id: string, input: z.infer<typeof statementInput>, excludeId?: string) {
    return ctx.db.transaction(async (tx) => {
      const c = await loadContract(tx, ctx, id, 'contracts.contract.view');
      return statementAmounts(tx, c, input, excludeId);
    });
  },

  async createStatement(ctx: ModuleRequestContext, id: string, input: z.infer<typeof statementInput>) {
    return ctx.db.transaction(async (tx) => {
      const c = await loadContract(tx, ctx, id, 'contracts.contract.view', true);
      if (!ctx.can('contracts.statement.create', 'company') && c.owner_id !== ctx.userId && c.created_by !== ctx.userId) throw forbidden('اجازه ثبت صورت‌وضعیت برای این قرارداد را ندارید');
      if (c.status !== 'active') throw conflict('NOT_ACTIVE', ACTIVE_ONLY);
      const open = await one(tx, sql`SELECT number FROM contracts_statements WHERE contract_id = ${id} AND status IN ('draft', 'submitted') AND deleted_at IS NULL`);
      if (open) throw conflict('STATEMENT_OPEN', `صورت‌وضعیت شماره ${open.number} هنوز باز است؛ ابتدا آن را ارسال یا تکلیفش را مشخص کنید`);
      const a = await statementAmounts(tx, c, input);
      const n = await one<{ n: number }>(tx, sql`SELECT coalesce(max(number), 0)::int + 1 AS n FROM contracts_statements WHERE contract_id = ${id}`);
      const sid = randomUUID();
      await tx.execute(sql`INSERT INTO contracts_statements (id, tenant_id, company_id, contract_id, number, period_from, period_to, cumulative_gross, period_gross, good_performance, insurance, tax,
          prepayment_recovery, other_deductions, vat, net_payable, note, created_by)
        VALUES (${sid}, ${ctx.tenantId}, ${c.company_id}, ${id}, ${n!.n}, ${input.periodFrom}, ${input.periodTo}, ${input.cumulativeGross}, ${a.periodGross}, ${a.goodPerformance}, ${a.insurance}, ${a.tax},
          ${a.prepaymentRecovery}, ${a.otherDeductions}, ${a.vat}, ${a.netPayable}, ${input.note}, ${ctx.userId})`);
      await history(tx, ctx, c, 'statement.created', `ثبت صورت‌وضعیت شماره ${n!.n}`, { cumulativeGross: input.cumulativeGross, netPayable: a.netPayable });
      return { id: sid, number: n!.n };
    });
  },

  async updateStatement(ctx: ModuleRequestContext, id: string, sid: string, input: z.infer<typeof statementInput>) {
    await ctx.db.transaction(async (tx) => {
      const c = await loadContract(tx, ctx, id, 'contracts.contract.view', true);
      const s = await editableStatement(tx, ctx, c, id, sid);
      const a = await statementAmounts(tx, c, input, sid);
      await tx.execute(sql`UPDATE contracts_statements SET period_from = ${input.periodFrom}, period_to = ${input.periodTo}, cumulative_gross = ${input.cumulativeGross}, period_gross = ${a.periodGross},
          good_performance = ${a.goodPerformance}, insurance = ${a.insurance}, tax = ${a.tax}, prepayment_recovery = ${a.prepaymentRecovery}, other_deductions = ${a.otherDeductions},
          vat = ${a.vat}, net_payable = ${a.netPayable}, note = ${input.note}, updated_at = now() WHERE id = ${sid}`);
      await history(tx, ctx, c, 'statement.updated', `ویرایش صورت‌وضعیت شماره ${s.number}`, { cumulativeGross: input.cumulativeGross, netPayable: a.netPayable });
    });
  },

  async deleteStatement(ctx: ModuleRequestContext, id: string, sid: string) {
    await ctx.db.transaction(async (tx) => {
      const c = await loadContract(tx, ctx, id, 'contracts.contract.view', true);
      const s = await editableStatement(tx, ctx, c, id, sid);
      await tx.execute(sql`UPDATE contracts_statements SET deleted_at = now() WHERE id = ${sid}`);
      await history(tx, ctx, c, 'statement.deleted', `حذف پیش‌نویس صورت‌وضعیت شماره ${s.number}`);
    });
  },

  /** Sends a draft statement into the organisation's approval workflow (contracts.statement). */
  async submitStatement(ctx: ModuleRequestContext, id: string, sid: string) {
    return ctx.db.transaction(async (tx) => {
      const c = await loadContract(tx, ctx, id, 'contracts.contract.view', true);
      const s = await editableStatement(tx, ctx, c, id, sid);
      const wf = await ctx.startWorkflow(
        { key: 'contracts.statement', entityType: 'statement', entityId: sid, title: `صورت‌وضعیت شماره ${s.number} قرارداد ${c.code}`, amount: Number(s.net_payable) },
        tx,
      );
      await tx.execute(sql`UPDATE contracts_statements SET status = 'submitted', workflow_instance_id = ${wf.instanceId}, updated_at = now() WHERE id = ${sid}`);
      await history(tx, ctx, c, 'statement.submitted', `ارسال صورت‌وضعیت شماره ${s.number} برای تأیید`, { netPayable: s.net_payable });
      return { state: wf.state };
    });
  },

  // ------------------------------------------------------------- lookups via other modules' public APIs

  async lookup(ctx: ModuleRequestContext, kind: 'projects' | 'accounts', q: string) {
    const svc =
      kind === 'projects'
        ? ctx.services.get<{ search(q: string, limit: number): Promise<{ id: string; title: string; code?: string }[]> }>('projects.projects', '^1')
        : ctx.services.get<{ search(q: string, limit: number): Promise<{ id: string; title: string; code?: string }[]> }>('crm.accounts', '^1');
    return svc ? svc.search(q, 20) : [];
  },

  async linkedNames(ctx: ModuleRequestContext, c: { projects_project_id: string | null; crm_account_id: string | null }) {
    const projects = ctx.services.get<{ get(id: string): Promise<{ id: string; title: string } | null> }>('projects.projects', '^1');
    const accounts = ctx.services.get<{ get(id: string): Promise<{ id: string; title: string } | null> }>('crm.accounts', '^1');
    return {
      project: c.projects_project_id && projects ? await projects.get(c.projects_project_id) : null,
      account: c.crm_account_id && accounts ? await accounts.get(c.crm_account_id) : null,
    };
  },
};

async function editableStatement(tx: Db, ctx: ModuleRequestContext, c: ContractRow, id: string, sid: string) {
  const s = await one<{ number: number; status: string; created_by: string; net_payable: string }>(tx, sql`SELECT number, status, created_by, net_payable::text FROM contracts_statements WHERE id = ${sid} AND contract_id = ${id} AND deleted_at IS NULL FOR UPDATE`);
  if (!s) throw notFound('صورت‌وضعیت');
  if (s.status !== 'draft') throw conflict('STATEMENT_LOCKED', 'صورت‌وضعیت ارسال‌شده یا تأییدشده قابل تغییر نیست');
  if (!ctx.can('contracts.statement.create', 'company') && s.created_by !== ctx.userId && c.owner_id !== ctx.userId) throw forbidden('اجازه تغییر این صورت‌وضعیت را ندارید');
  return s;
}

async function statementAmounts(tx: Db, c: ContractRow, input: z.infer<typeof statementInput>, excludeId?: string) {
  const prev = await one<{ cum: string; recovered: string }>(tx, sql`SELECT coalesce(max(cumulative_gross), 0)::text AS cum, coalesce(sum(prepayment_recovery), 0)::text AS recovered
    FROM contracts_statements WHERE contract_id = ${c.id} AND status <> 'rejected' AND deleted_at IS NULL ${excludeId ? sql`AND id <> ${excludeId}` : sql``}`);
  if (input.periodFrom && input.periodFrom > input.periodTo) throw invalid('BAD_PERIOD', 'ابتدای دوره نباید بعد از انتهای آن باشد');
  try {
    const a = computeStatement(
      {
        cumulativeGross: BigInt(input.cumulativeGross),
        previousCumulative: BigInt(prev!.cum),
        prepaymentRemaining: BigInt(c.prepayment_amount) - BigInt(prev!.recovered) > 0n ? BigInt(c.prepayment_amount) - BigInt(prev!.recovered) : 0n,
        otherDeductions: BigInt(input.otherDeductions),
      },
      { goodPerformancePct: c.good_performance_pct, insurancePct: c.insurance_pct, taxPct: c.tax_pct, vatPct: c.vat_pct, prepaymentRecoveryPct: c.prepayment_recovery_pct },
    );
    return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.toString()])) as Record<keyof typeof a, string>;
  } catch (err) {
    if ((err as Error).message === 'CUMULATIVE_DECREASED') throw invalid('CUMULATIVE_DECREASED', `کارکرد تجمعی نباید از صورت‌وضعیت قبلی (${prev!.cum} ریال) کمتر باشد`);
    throw err;
  }
}

// ---------------------------------------------------------------- tenant-wide (events, jobs, providers)

/** Applies the outcome of the approval workflow to a submitted statement. */
export async function onWorkflowCompleted(ctx: ModuleEventContext, p: { moduleId: string; entityType: string; entityId: string; state: 'approved' | 'rejected' }) {
  if (p.moduleId !== 'contracts' || p.entityType !== 'statement') return;
  await ctx.db.transaction(async (tx) => {
    const s = await one<{ id: string; contract_id: string; company_id: string; number: number; status: string; net_payable: string; created_by: string }>(
      tx,
      sql`UPDATE contracts_statements SET status = ${p.state}, decided_at = now(), updated_at = now() WHERE id = ${p.entityId} AND status = 'submitted'
          RETURNING id, contract_id, company_id, number, status, net_payable::text, created_by`,
    );
    if (!s) return; // already applied (at-least-once delivery)
    await tx.execute(sql`INSERT INTO contracts_history (id, tenant_id, company_id, contract_id, action, summary, changes)
      VALUES (${randomUUID()}, ${ctx.tenantId}, ${s.company_id}, ${s.contract_id}, ${`statement.${p.state}`}, ${`صورت‌وضعیت شماره ${s.number} ${p.state === 'approved' ? 'تأیید' : 'رد'} شد`}, ${JSON.stringify({ netPayable: s.net_payable })}::jsonb)`);
    if (p.state === 'approved') await ctx.publish('contracts.statement.approved', { contractId: s.contract_id, statementId: s.id, number: s.number, netPayable: s.net_payable }, tx);
  });
}

/** Daily: notifies the responsible person once per contract end date and guarantee expiry within the alert window. */
export async function expiryAlerts(ctx: ModuleEventContext, today: string) {
  const s = await ctx.settings<{ alertDays: number }>();
  const due = await ctx.db.transaction(async (tx) => {
    const contracts = await rows<{ id: string; company_id: string; code: string; title: string; end_on: string; who: string }>(tx, sql`
      SELECT id, company_id, code, title, end_on::text, coalesce(owner_id, created_by) AS who FROM contracts_contracts
       WHERE deleted_at IS NULL AND status = 'active' AND end_on IS NOT NULL AND end_on <= ${today}::date + ${s.alertDays}::int`);
    const guarantees = await rows<{ id: string; contract_id: string; company_id: string; number: string; code: string; expires_on: string; who: string }>(tx, sql`
      SELECT g.id, g.contract_id, g.company_id, g.number, c.code, g.expires_on::text, coalesce(c.owner_id, c.created_by) AS who
        FROM contracts_guarantees g JOIN contracts_contracts c ON c.id = g.contract_id
       WHERE g.deleted_at IS NULL AND g.status = 'active' AND g.expires_on IS NOT NULL AND g.expires_on <= ${today}::date + ${s.alertDays}::int AND c.deleted_at IS NULL`);
    const out: { key: string; company: string; who: string; title: string; link: string }[] = [];
    for (const c of contracts) {
      const past = c.end_on < today;
      out.push({ key: `contract:${c.id}:${c.end_on}:${past ? 'past' : 'soon'}`, company: c.company_id, who: c.who, link: `/app/contracts/${c.id}`, title: past ? `مدت قرارداد ${c.code} به پایان رسیده ولی قرارداد هنوز باز است` : `قرارداد ${c.code} (${c.title}) به‌زودی به پایان می‌رسد` });
    }
    for (const g of guarantees) {
      const past = g.expires_on < today;
      out.push({ key: `guarantee:${g.id}:${g.expires_on}:${past ? 'past' : 'soon'}`, company: g.company_id, who: g.who, link: `/app/contracts/${g.contract_id}?tab=guarantees`, title: past ? `ضمانت‌نامه ${g.number} قرارداد ${g.code} منقضی شده است` : `ضمانت‌نامه ${g.number} قرارداد ${g.code} به‌زودی منقضی می‌شود` });
    }
    const fresh: typeof out = [];
    for (const a of out) {
      const r = await tx.execute(sql`INSERT INTO contracts_alerts (id, tenant_id, company_id, alert_key) VALUES (${randomUUID()}, ${ctx.tenantId}, ${a.company}, ${a.key}) ON CONFLICT DO NOTHING RETURNING id`);
      if (r.rows.length) fresh.push(a);
    }
    return fresh;
  });
  for (const a of due) await ctx.notify({ userIds: [a.who], type: 'contracts.expiry', title: a.title, link: a.link });
  return due.length;
}

export async function expiringSoon(ctx: ModuleRequestContext, today: string) {
  const s = await ctx.settings<{ alertDays: number }>();
  return ctx.db.transaction(async (tx) => {
    const vis = visibility(ctx, 'contracts.contract.view');
    const contracts = await rows(tx, sql`SELECT c.id, c.code, c.title, c.end_on::text AS date, 'contract' AS type FROM contracts_contracts c
      WHERE c.deleted_at IS NULL AND c.status = 'active' AND c.end_on IS NOT NULL AND c.end_on <= ${today}::date + ${s.alertDays}::int AND ${vis}`);
    const guarantees = await rows(tx, sql`SELECT c.id, c.code, g.number AS title, g.expires_on::text AS date, 'guarantee' AS type FROM contracts_guarantees g JOIN contracts_contracts c ON c.id = g.contract_id
      WHERE g.deleted_at IS NULL AND g.status = 'active' AND g.expires_on IS NOT NULL AND g.expires_on <= ${today}::date + ${s.alertDays}::int AND c.deleted_at IS NULL AND ${vis}`);
    return { alertDays: s.alertDays, items: [...contracts, ...guarantees].sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 20) };
  });
}

export async function search(ctx: ModuleRequestContext, q: string, limit: number) {
  const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const r = await ctx.db.transaction((tx) =>
    rows<{ id: string; code: string; title: string; counterparty_name: string }>(tx, sql`SELECT c.id, c.code, c.title, c.counterparty_name FROM contracts_contracts c
      WHERE c.deleted_at IS NULL AND ${visibility(ctx, 'contracts.contract.view')} AND (c.code ILIKE ${like} OR c.title ILIKE ${like} OR c.counterparty_name ILIKE ${like}) LIMIT ${limit}`),
  );
  return r.map((x) => ({ entityType: 'contract', entityId: x.id, title: `${x.code} — ${x.title}`, snippet: x.counterparty_name, link: `/app/contracts/${x.id}` }));
}

/** Public service contracts.contracts@1 for other modules (projects, crm). */
export function publicService(ctx: ModuleEventContext) {
  const list = (where: SQL) =>
    ctx.db.transaction((tx) =>
      rows<{ id: string; code: string; title: string; status: string; direction: string; current_amount: string; approved_gross: string; end_on: string | null }>(
        tx,
        sql`SELECT c.id, c.code, c.title, c.status, c.direction, c.end_on::text,
          (c.initial_amount + coalesce((SELECT sum(a.amount_delta) FROM contracts_amendments a WHERE a.contract_id = c.id), 0))::text AS current_amount,
          coalesce((SELECT max(s.cumulative_gross) FROM contracts_statements s WHERE s.contract_id = c.id AND s.status = 'approved' AND s.deleted_at IS NULL), 0)::text AS approved_gross
          FROM contracts_contracts c WHERE c.deleted_at IS NULL AND ${where} ORDER BY c.created_at`,
      ),
    );
  return {
    byProject: (projectId: string) => list(sql`c.projects_project_id = ${projectId}`),
    byAccount: (accountId: string) => list(sql`c.crm_account_id = ${accountId}`),
    get: async (id: string) => (await list(sql`c.id = ${id}`))[0] ?? null,
  };
}

export async function signedValue(ctx: ModuleEventContext, p: { companyId: string; from: string; to: string }) {
  const r = await ctx.db.transaction((tx) =>
    one<{ v: string }>(tx, sql`SELECT coalesce(sum(initial_amount), 0)::text AS v FROM contracts_contracts
      WHERE deleted_at IS NULL AND company_id = ${p.companyId} AND signed_on >= ${p.from.slice(0, 10)}::date AND signed_on < ${p.to.slice(0, 10)}::date`),
  );
  return Number(r!.v);
}
