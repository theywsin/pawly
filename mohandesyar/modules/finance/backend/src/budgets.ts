import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { computeEac, type EacMethod } from './calc.js';
import { assertProject, checkProject, one, projectScope, projectsOf, rows } from './db.js';
import { conflict, forbidden, invalid, notFound } from './errors.js';
import type { budgetInput, commitmentInput, eacMethodInput, etcInput } from './inputs.js';
import { categoriesOf } from './setup.js';

/** Actual cost of a project per expense category: executed payments net of reversals (transfers excluded by type). */
async function actualByCategory(tx: Db, projectId: string) {
  return rows<{ category_id: string; amount: string }>(
    tx,
    sql`SELECT category_id, sum(CASE WHEN direction = 'out' THEN amount ELSE -amount END)::text AS amount FROM finance_transactions
      WHERE projects_project_id = ${projectId} AND type = 'payment' GROUP BY category_id`,
  );
}

async function openCommitments(tx: Db, projectId: string) {
  return rows<{ id: string; category_id: string | null; counterparty_id: string | null; amount: string; consumed: string; description: string; source: string; source_ref: string | null; status: string; created_at: string }>(
    tx,
    sql`SELECT m.id, m.category_id, m.counterparty_id, m.amount::text, m.description, m.source, m.source_ref, m.status, m.created_at,
        coalesce((SELECT sum(CASE WHEN t.direction = 'out' THEN t.amount ELSE -t.amount END) FROM finance_transactions t WHERE t.commitment_id = m.id), 0)::text AS consumed
      FROM finance_commitments m WHERE m.projects_project_id = ${projectId} ORDER BY m.created_at DESC`,
  );
}

export async function currentMethod(tx: Db, companyId: string): Promise<{ method: EacMethod; version: number }> {
  const m = await one<{ method: EacMethod; version: number }>(tx, sql`SELECT method, version FROM finance_eac_methods WHERE company_id = ${companyId} ORDER BY version DESC LIMIT 1`);
  return m ?? { method: 'cpi', version: 0 };
}

export const Budgets = {
  /** Projects with a budget or cost, within the user's project scope. */
  async overview(ctx: ModuleRequestContext) {
    const scope = await projectScope(ctx, 'finance.budget.view');
    const svc = projectsOf(ctx);
    const list = await ctx.db.transaction((tx) =>
      rows<{ project_id: string; bac: string | null; actual: string; committed: string }>(
        tx,
        sql`WITH ids AS (SELECT projects_project_id AS id FROM finance_budgets UNION SELECT projects_project_id FROM finance_transactions WHERE projects_project_id IS NOT NULL
              UNION SELECT projects_project_id FROM finance_commitments WHERE projects_project_id IS NOT NULL)
          SELECT ids.id AS project_id,
            (SELECT sum(l.amount)::text FROM finance_budget_lines l WHERE l.budget_id = (SELECT b.id FROM finance_budgets b WHERE b.projects_project_id = ids.id AND b.status = 'approved' ORDER BY b.version DESC LIMIT 1)) AS bac,
            coalesce((SELECT sum(CASE WHEN direction = 'out' THEN amount ELSE -amount END) FROM finance_transactions t WHERE t.projects_project_id = ids.id AND t.type = 'payment'), 0)::text AS actual,
            coalesce((SELECT sum(m.amount) FROM finance_commitments m WHERE m.projects_project_id = ids.id AND m.status = 'open'), 0)::text AS committed
          FROM ids WHERE ids.id IS NOT NULL`,
      ),
    );
    const visible = scope === null ? list : list.filter((p) => scope.includes(p.project_id));
    const out = [];
    for (const p of visible) out.push({ ...p, project: svc ? await svc.get(p.project_id) : null });
    return out;
  },

  async project(ctx: ModuleRequestContext, projectId: string, today: string) {
    await assertProject(ctx, 'finance.budget.view', projectId);
    const project = await checkProject(ctx, projectId);
    const progress = await projectsOf(ctx)?.progress?.(projectId, today);
    return ctx.db.transaction(async (tx) => {
      const [budgets, lines, actual, commitments, etc, notes, cats] = await Promise.all([
        rows<{ id: string; version: number; kind: string; status: string; note: string; created_by: string; created_at: string; approved_by: string | null; approved_at: string | null; total: string }>(
          tx,
          sql`SELECT b.id, b.version, b.kind, b.status, b.note, b.created_by, b.created_at, b.approved_by, b.approved_at, coalesce((SELECT sum(amount) FROM finance_budget_lines l WHERE l.budget_id = b.id), 0)::text AS total
            FROM finance_budgets b WHERE b.projects_project_id = ${projectId} ORDER BY b.version DESC`,
        ),
        rows<{ budget_id: string; category_id: string; amount: string; note: string }>(tx, sql`SELECT l.budget_id, l.category_id, l.amount::text, l.note FROM finance_budget_lines l JOIN finance_budgets b ON b.id = l.budget_id WHERE b.projects_project_id = ${projectId}`),
        actualByCategory(tx, projectId),
        openCommitments(tx, projectId),
        one<{ amount: string; note: string; created_at: string }>(tx, sql`SELECT amount::text, note, created_at FROM finance_etc_estimates WHERE projects_project_id = ${projectId} ORDER BY created_at DESC LIMIT 1`),
        rows(tx, sql`SELECT id, note, created_at, created_by FROM finance_variance_notes WHERE projects_project_id = ${projectId} ORDER BY created_at DESC`),
        categoriesOf(tx, ctx.tenantId, ctx.companyId),
      ]);
      const approved = budgets.find((b) => b.status === 'approved') ?? null;
      const bac = approved ? BigInt(approved.total) : 0n;
      const ac = actual.reduce((s, a) => s + BigInt(a.amount), 0n);
      const committed = commitments.filter((c) => c.status === 'open').reduce((s, c) => s + (BigInt(c.amount) > BigInt(c.consumed) ? BigInt(c.amount) - BigInt(c.consumed) : 0n), 0n);
      const m = await currentMethod(tx, ctx.companyId);
      const eac = approved ? computeEac({ bac, ac, physicalPct: progress?.actual ?? null, method: m.method, manualEtc: etc ? BigInt(etc.amount) : null }) : null;
      const byCategory = cats
        .filter((c) => c.kind === 'expense')
        .map((c) => {
          const budget = approved ? BigInt(lines.find((l) => l.budget_id === approved.id && l.category_id === c.id)?.amount ?? '0') : 0n;
          const act = BigInt(actual.find((a) => a.category_id === c.id)?.amount ?? '0');
          const com = commitments.filter((x) => x.status === 'open' && x.category_id === c.id).reduce((s, x) => s + (BigInt(x.amount) > BigInt(x.consumed) ? BigInt(x.amount) - BigInt(x.consumed) : 0n), 0n);
          return { categoryId: c.id, name: c.name, budget: budget.toString(), actual: act.toString(), committed: com.toString(), remaining: (budget - act - com).toString() };
        })
        .filter((r) => r.budget !== '0' || r.actual !== '0' || r.committed !== '0');
      return {
        project,
        progress: progress ?? null,
        budgets: budgets.map((b) => ({ ...b, lines: lines.filter((l) => l.budget_id === b.id) })),
        summary: { bac: bac.toString(), actual: ac.toString(), committed: committed.toString(), available: (bac - ac - committed).toString() },
        eac: eac && { ...eac, ev: eac.ev?.toString() ?? null, eac: eac.eac?.toString() ?? null, vac: eac.vac?.toString() ?? null, method: m.method, methodVersion: m.version },
        byCategory,
        commitments,
        etc: etc ?? null,
        notes,
      };
    });
  },

  /** A new draft version (copying the last approved lines when no lines are sent is the UI's job). */
  async saveDraft(ctx: ModuleRequestContext, projectId: string, input: z.infer<typeof budgetInput>) {
    await checkProject(ctx, projectId);
    return ctx.db.transaction(async (tx) => {
      const cats = (await categoriesOf(tx, ctx.tenantId, ctx.companyId)).filter((c) => c.kind === 'expense');
      if (input.lines.some((l) => !cats.some((c) => c.id === l.categoryId))) throw invalid('CATEGORY', 'بودجه فقط روی سرفصل‌های هزینه');
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`finance-budget:${projectId}`}))`);
      let draft = await one<{ id: string; version: number }>(tx, sql`SELECT id, version FROM finance_budgets WHERE projects_project_id = ${projectId} AND status = 'draft'`);
      if (draft) {
        await tx.execute(sql`UPDATE finance_budgets SET note = ${input.note} WHERE id = ${draft.id}`);
        await tx.execute(sql`DELETE FROM finance_budget_lines WHERE budget_id = ${draft.id}`);
      } else {
        const v = (await one<{ v: number }>(tx, sql`SELECT coalesce(max(version), 0)::int AS v FROM finance_budgets WHERE projects_project_id = ${projectId}`))!.v;
        draft = { id: randomUUID(), version: v + 1 };
        await tx.execute(sql`INSERT INTO finance_budgets (id, tenant_id, company_id, projects_project_id, version, kind, note, created_by)
          VALUES (${draft.id}, ${ctx.tenantId}, ${ctx.companyId}, ${projectId}, ${draft.version}, ${v === 0 ? 'initial' : 'revision'}, ${input.note}, ${ctx.userId})`);
      }
      for (const l of input.lines) {
        await tx.execute(sql`INSERT INTO finance_budget_lines (id, tenant_id, company_id, budget_id, category_id, amount, note) VALUES (${randomUUID()}, ${ctx.tenantId}, ${ctx.companyId}, ${draft.id}, ${l.categoryId}, ${l.amount}, ${l.note})`);
      }
      return draft;
    });
  },

  /** Approval by someone other than the author; approved versions never change (a revision is a new version). */
  async approve(ctx: ModuleRequestContext, budgetId: string) {
    await ctx.db.transaction(async (tx) => {
      const b = await one<{ status: string; created_by: string; projects_project_id: string; version: number }>(tx, sql`SELECT status, created_by, projects_project_id, version FROM finance_budgets WHERE id = ${budgetId} FOR UPDATE`);
      if (!b) throw notFound('بودجه');
      if (b.status !== 'draft') throw conflict('APPROVED', 'این نسخه قبلاً تصویب شده است');
      if (b.created_by === ctx.userId) throw forbidden('تهیه‌کننده بودجه نمی‌تواند آن را تصویب کند');
      await tx.execute(sql`UPDATE finance_budgets SET status = 'approved', approved_by = ${ctx.userId}, approved_at = now() WHERE id = ${budgetId}`);
      await ctx.audit({ action: 'finance.budget.approved', entityType: 'finance_budget', entityId: budgetId, after: { project: b.projects_project_id, version: b.version } }, tx);
    });
  },

  async addCommitment(ctx: ModuleRequestContext, input: z.infer<typeof commitmentInput>) {
    await checkProject(ctx, input.projectId);
    return ctx.db.transaction(async (tx) => {
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO finance_commitments (id, tenant_id, company_id, projects_project_id, category_id, counterparty_id, amount, description, created_by)
        VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.projectId}, ${input.categoryId}, ${input.counterpartyId}, ${input.amount}, ${input.description}, ${ctx.userId})`);
      return { id };
    });
  },

  async closeCommitment(ctx: ModuleRequestContext, id: string) {
    await ctx.db.transaction(async (tx) => {
      const r = await rows(tx, sql`UPDATE finance_commitments SET status = 'closed' WHERE id = ${id} AND status = 'open' RETURNING id`);
      if (!r.length) throw notFound('تعهد باز');
    });
  },

  methods: (ctx: ModuleRequestContext) => ctx.db.transaction((tx) => rows(tx, sql`SELECT version, method, created_at, created_by FROM finance_eac_methods ORDER BY version DESC`)),

  async setMethod(ctx: ModuleRequestContext, input: z.infer<typeof eacMethodInput>) {
    return ctx.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`finance-eac:${ctx.companyId}`}))`);
      const v = (await currentMethod(tx, ctx.companyId)).version + 1;
      await tx.execute(sql`INSERT INTO finance_eac_methods (id, tenant_id, company_id, version, method, created_by) VALUES (${randomUUID()}, ${ctx.tenantId}, ${ctx.companyId}, ${v}, ${input.method}, ${ctx.userId})`);
      await ctx.audit({ action: 'finance.eac_method.saved', entityType: 'company', entityId: ctx.companyId, after: { version: v, method: input.method } }, tx);
      return { version: v };
    });
  },

  async addEtc(ctx: ModuleRequestContext, projectId: string, input: z.infer<typeof etcInput>) {
    await checkProject(ctx, projectId);
    await ctx.db.transaction((tx) => tx.execute(sql`INSERT INTO finance_etc_estimates (id, tenant_id, company_id, projects_project_id, amount, note, created_by) VALUES (${randomUUID()}, ${ctx.tenantId}, ${ctx.companyId}, ${projectId}, ${input.amount}, ${input.note}, ${ctx.userId})`));
  },

  async addNote(ctx: ModuleRequestContext, projectId: string, note: string) {
    await assertProject(ctx, 'finance.budget.view', projectId);
    await ctx.db.transaction((tx) => tx.execute(sql`INSERT INTO finance_variance_notes (id, tenant_id, company_id, projects_project_id, note, created_by) VALUES (${randomUUID()}, ${ctx.tenantId}, ${ctx.companyId}, ${projectId}, ${note}, ${ctx.userId})`));
  },
};
