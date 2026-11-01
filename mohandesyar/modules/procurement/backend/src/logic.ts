import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, ModuleEventContext, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { compareQuotes, lineAmount, qty, threeWayMatch } from './calc.js';
import { conflict, forbidden, invalid, notFound } from './errors.js';
import type {
  awardInput, categoryInput, invoiceDecisionInput, invoiceInput, orderInput, orderQuery, quoteInput, ratingInput, receiptInput, reportQuery, requestInput, requestQuery, rfqInput, supplierInput,
} from './inputs.js';

type Row = Record<string, unknown>;
const rows = async <T = Row>(tx: Db, q: SQL) => (await tx.execute(q)).rows as T[];
const one = async <T = Row>(tx: Db, q: SQL) => (await rows<T>(tx, q))[0];
const fa = (v: bigint | string) => BigInt(v).toLocaleString('fa-IR');

type Projects = { memberOf(u: string): Promise<string[]>; get(id: string): Promise<{ id: string; code: string; title: string } | null>; search(q: string, l: number): Promise<{ id: string; code: string; title: string }[]> };
const projectsOf = (ctx: { services: ModuleRequestContext['services'] }) => ctx.services.get<Projects>('projects.projects', '^1');

/** null = all projects (company scope); otherwise the user's projects (project scope); [] = none. */
async function projectScope(ctx: ModuleRequestContext, permission: string): Promise<string[] | null> {
  if (ctx.can(permission, 'company')) return null;
  if (!ctx.can(permission, 'project')) return [];
  return (await projectsOf(ctx)?.memberOf(ctx.userId)) ?? [];
}
async function assertProject(ctx: ModuleRequestContext, permission: string, projectId: string | null) {
  const s = await projectScope(ctx, permission);
  if (s !== null && (!projectId || !s.includes(projectId))) throw forbidden('فقط برای پروژه‌هایی که عضو آن هستید ممکن است');
}
async function checkProject(ctx: ModuleRequestContext, projectId: string | null) {
  if (!projectId) return;
  const svc = projectsOf(ctx);
  if (svc && !(await svc.get(projectId))) throw invalid('PROJECT', 'پروژه یافت نشد');
}

async function nextNumber(tx: Db, table: 'procurement_requests' | 'procurement_rfqs' | 'procurement_orders', companyId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${table}:${companyId}`}))`);
  return (await one<{ n: number }>(tx, sql`SELECT coalesce(max(number), 0)::int + 1 AS n FROM ${sql.raw(table)} WHERE company_id = ${companyId}`))!.n;
}

// ---------------------------------------------------------------- suppliers

export const Suppliers = {
  list: (ctx: ModuleRequestContext, q?: string) =>
    ctx.db.transaction((tx) => {
      const like = q ? `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null;
      return rows(tx, sql`SELECT s.id, s.name, s.national_id, s.economic_code, s.phone, s.email, s.address, s.iban, s.status, s.block_reason, s.notes,
          coalesce((SELECT array_agg(c.name ORDER BY c.name) FROM procurement_supplier_categories sc JOIN procurement_categories c ON c.id = sc.category_id WHERE sc.supplier_id = s.id), '{}') AS categories,
          coalesce((SELECT array_agg(sc.category_id) FROM procurement_supplier_categories sc WHERE sc.supplier_id = s.id), '{}') AS category_ids,
          (SELECT round(avg((r.quality + r.delivery + r.price) / 3.0), 2)::float FROM procurement_ratings r WHERE r.supplier_id = s.id) AS rating,
          (SELECT count(*)::int FROM procurement_ratings r WHERE r.supplier_id = s.id) AS ratings,
          (SELECT count(*)::int FROM procurement_orders o WHERE o.supplier_id = s.id AND o.status IN ('approved', 'closed')) AS orders
        FROM procurement_suppliers s WHERE ${like ? sql`s.name ILIKE ${like}` : sql`TRUE`} ORDER BY s.status, s.name LIMIT 1000`);
    }),

  async save(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof supplierInput>) {
    return ctx.db.transaction(async (tx) => {
      const f = sql`name = ${input.name}, national_id = ${input.nationalId}, economic_code = ${input.economicCode}, phone = ${input.phone}, email = ${input.email}, address = ${input.address},
        iban = ${input.iban}, status = ${input.status}, block_reason = ${input.status === 'blocked' ? input.blockReason : ''}, notes = ${input.notes}`;
      if (id) {
        if (!(await rows(tx, sql`UPDATE procurement_suppliers SET ${f} WHERE id = ${id} RETURNING id`)).length) throw notFound('تأمین‌کننده');
        await tx.execute(sql`DELETE FROM procurement_supplier_categories WHERE supplier_id = ${id}`);
      } else {
        id = randomUUID();
        await tx.execute(sql`INSERT INTO procurement_suppliers (id, tenant_id, company_id, name, created_by) VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.name}, ${ctx.userId})`);
        await tx.execute(sql`UPDATE procurement_suppliers SET ${f} WHERE id = ${id}`);
      }
      for (const c of new Set(input.categoryIds)) {
        if (!(await one(tx, sql`SELECT 1 FROM procurement_categories WHERE id = ${c}`))) throw invalid('CATEGORY', 'دسته معتبر نیست');
        await tx.execute(sql`INSERT INTO procurement_supplier_categories (id, tenant_id, company_id, supplier_id, category_id) VALUES (${randomUUID()}, ${ctx.tenantId}, ${ctx.companyId}, ${id}, ${c})`);
      }
      await ctx.audit({ action: 'procurement.supplier.saved', entityType: 'supplier', entityId: id, after: { name: input.name, status: input.status } }, tx);
      return { id };
    });
  },

  categories: (ctx: ModuleRequestContext) => ctx.db.transaction((tx) => rows(tx, sql`SELECT id, name FROM procurement_categories ORDER BY name`)),

  async addCategory(ctx: ModuleRequestContext, input: z.infer<typeof categoryInput>) {
    return ctx.db.transaction(async (tx) => {
      if (await one(tx, sql`SELECT 1 FROM procurement_categories WHERE company_id = ${ctx.companyId} AND name = ${input.name}`)) throw conflict('DUPLICATE', 'این دسته وجود دارد');
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO procurement_categories (id, tenant_id, company_id, name) VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.name})`);
      return { id };
    });
  },

  async rate(ctx: ModuleRequestContext, orderId: string, input: z.infer<typeof ratingInput>) {
    await ctx.db.transaction(async (tx) => {
      const o = await one<{ supplier_id: string; company_id: string; received: boolean }>(
        tx,
        sql`SELECT o.supplier_id, o.company_id, EXISTS (SELECT 1 FROM procurement_receipts r WHERE r.order_id = o.id) AS received FROM procurement_orders o WHERE o.id = ${orderId}`,
      );
      if (!o) throw notFound('سفارش');
      if (!o.received) throw conflict('NOT_RECEIVED', 'امتیازدهی پس از دست‌کم یک تحویل ممکن است');
      await tx.execute(sql`INSERT INTO procurement_ratings (id, tenant_id, company_id, supplier_id, order_id, quality, delivery, price, comment, rated_by)
        VALUES (${randomUUID()}, ${ctx.tenantId}, ${o.company_id}, ${o.supplier_id}, ${orderId}, ${input.quality}, ${input.delivery}, ${input.price}, ${input.comment}, ${ctx.userId})
        ON CONFLICT (order_id) DO UPDATE SET quality = EXCLUDED.quality, delivery = EXCLUDED.delivery, price = EXCLUDED.price, comment = EXCLUDED.comment, rated_by = EXCLUDED.rated_by, rated_at = now()`);
    });
  },
};

// ---------------------------------------------------------------- purchase requests

const LINE_TOTAL = sql`round(l.quantity * coalesce(l.estimated_unit_price, 0))`;

export const Requests = {
  async list(ctx: ModuleRequestContext, f: z.infer<typeof requestQuery>) {
    const scope = await projectScope(ctx, 'procurement.request.view');
    const own = !ctx.can('procurement.request.view', 'company') && !ctx.can('procurement.request.view', 'project');
    return ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT r.id, r.number, r.title, r.projects_project_id, r.cost_center, r.needed_by::text, r.status, r.requested_by, r.requested_at,
          (SELECT count(*)::int FROM procurement_request_lines l WHERE l.request_id = r.id) AS lines,
          (SELECT coalesce(sum(${LINE_TOTAL}), 0)::text FROM procurement_request_lines l WHERE l.request_id = r.id) AS estimate,
          (SELECT o.number FROM procurement_orders o WHERE o.request_id = r.id AND o.status <> 'cancelled' ORDER BY o.number DESC LIMIT 1) AS order_number
        FROM procurement_requests r
        WHERE ${own ? sql`r.requested_by = ${ctx.userId}` : scope === null ? sql`TRUE` : scope.length ? sql`(r.projects_project_id IN (${sql.join(scope.map((p) => sql`${p}::uuid`), sql`, `)}) OR r.requested_by = ${ctx.userId})` : sql`r.requested_by = ${ctx.userId}`}
          ${f.status ? sql`AND r.status = ${f.status}` : sql``} ${f.projectId ? sql`AND r.projects_project_id = ${f.projectId}` : sql``}
        ORDER BY r.number DESC LIMIT 500`),
    );
  },

  async get(ctx: ModuleRequestContext, id: string) {
    const r = await ctx.db.transaction(async (tx) => {
      const req = await one<{ projects_project_id: string | null; requested_by: string }>(tx, sql`SELECT r.*, r.needed_by::text FROM procurement_requests r WHERE r.id = ${id}`);
      if (!req) throw notFound('درخواست خرید');
      const lines = await rows(tx, sql`SELECT l.id, l.line_no, l.description, l.unit, l.quantity::text, l.estimated_unit_price::text, l.category_id, ${LINE_TOTAL}::text AS estimate FROM procurement_request_lines l WHERE l.request_id = ${id} ORDER BY l.line_no`);
      const rfqs = await rows(tx, sql`SELECT id, number, due_on::text, status FROM procurement_rfqs WHERE request_id = ${id} ORDER BY number`);
      const orders = await rows(tx, sql`SELECT id, number, status FROM procurement_orders WHERE request_id = ${id} ORDER BY number`);
      return { request: req, lines, rfqs, orders };
    });
    if (r.request.requested_by !== ctx.userId) {
      const scope = await projectScope(ctx, 'procurement.request.view');
      if (scope !== null && (!r.request.projects_project_id || !scope.includes(r.request.projects_project_id))) throw notFound('درخواست خرید');
    }
    return { ...r, budget: await budgetCheck(ctx, r.request.projects_project_id, r.lines.reduce((s, l) => s + BigInt((l as { estimate: string }).estimate), 0n)) };
  },

  async create(ctx: ModuleRequestContext, input: z.infer<typeof requestInput>) {
    await assertProject(ctx, 'procurement.request.create', input.projectId);
    await checkProject(ctx, input.projectId);
    const r = await ctx.db.transaction(async (tx) => {
      const n = await nextNumber(tx, 'procurement_requests', ctx.companyId);
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO procurement_requests (id, tenant_id, company_id, number, title, projects_project_id, contracts_contract_id, cost_center, needed_by, justification, requested_by)
        VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${n}, ${input.title}, ${input.projectId}, ${input.contractId}, ${input.costCenter}, ${input.neededBy}, ${input.justification}, ${ctx.userId})`);
      let i = 0;
      let estimate = 0n;
      for (const l of input.lines) {
        estimate += l.estimatedUnitPrice ? lineAmount(l.quantity, l.estimatedUnitPrice) : 0n;
        await tx.execute(sql`INSERT INTO procurement_request_lines (id, tenant_id, company_id, request_id, line_no, description, unit, quantity, estimated_unit_price, category_id)
          VALUES (${randomUUID()}, ${ctx.tenantId}, ${ctx.companyId}, ${id}, ${++i}, ${l.description}, ${l.unit}, ${l.quantity}, ${l.estimatedUnitPrice}, ${l.categoryId})`);
      }
      const wf = await ctx.startWorkflow({ key: 'procurement.request', entityType: 'purchase_request', entityId: id, title: `درخواست خرید ${n.toLocaleString('fa-IR')}: ${input.title}`, amount: Number(estimate) }, tx);
      await tx.execute(sql`UPDATE procurement_requests SET workflow_instance_id = ${wf.instanceId} WHERE id = ${id}`);
      await ctx.audit({ action: 'procurement.request.created', entityType: 'purchase_request', entityId: id, after: { number: n, estimate: estimate.toString() } }, tx);
      return { id, number: n, estimate };
    });
    return { id: r.id, number: r.number, budget: await budgetCheck(ctx, input.projectId, r.estimate) };
  },

  async cancel(ctx: ModuleRequestContext, id: string) {
    await ctx.db.transaction(async (tx) => {
      const r = await one<{ status: string; requested_by: string; workflow_instance_id: string | null }>(tx, sql`SELECT status, requested_by, workflow_instance_id FROM procurement_requests WHERE id = ${id} FOR UPDATE`);
      if (!r || (r.requested_by !== ctx.userId && !ctx.can('procurement.order.manage', 'company'))) throw notFound('درخواست خرید');
      if (r.status !== 'pending' && r.status !== 'approved') throw conflict('FINISHED', 'این درخواست قابل لغو نیست');
      if (await one(tx, sql`SELECT 1 FROM procurement_orders WHERE request_id = ${id} AND status IN ('pending', 'approved')`)) throw conflict('HAS_ORDER', 'برای این درخواست سفارش در جریان است');
      if (r.status === 'pending' && r.workflow_instance_id) await ctx.cancelWorkflow(r.workflow_instance_id, tx);
      await tx.execute(sql`UPDATE procurement_requests SET status = 'cancelled', decided_at = now() WHERE id = ${id}`);
    });
  },
};

/** Budget position of the project in finance (when active): approved budget, actual, open commitments. */
async function budgetCheck(ctx: ModuleRequestContext, projectId: string | null, estimate: bigint) {
  if (!projectId) return null;
  const svc = ctx.services.get<{ projectCost(id: string): Promise<{ bac: string | null; actual: string; committed: string }> }>('finance.ledger', '^1');
  if (!svc) return null;
  const c = await svc.projectCost(projectId);
  if (c.bac === null) return { ...c, available: null, exceeds: false, message: 'برای این پروژه بودجه مصوب ثبت نشده است' };
  const available = BigInt(c.bac) - BigInt(c.actual) - BigInt(c.committed);
  return { ...c, available: available.toString(), exceeds: estimate > available, message: estimate > available ? `برآورد این درخواست (${fa(estimate)} ریال) بیش از مانده بودجه پروژه (${fa(available)} ریال) است` : null };
}

// ---------------------------------------------------------------- RFQs and quotes

export const Rfqs = {
  list: (ctx: ModuleRequestContext) =>
    ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT q.id, q.number, q.title, q.due_on::text, q.status, q.request_id, r.number AS request_number,
          (SELECT count(*)::int FROM procurement_quotes x WHERE x.rfq_id = q.id) AS quotes
        FROM procurement_rfqs q JOIN procurement_requests r ON r.id = q.request_id ORDER BY q.number DESC LIMIT 500`),
    ),

  async create(ctx: ModuleRequestContext, input: z.infer<typeof rfqInput>) {
    return ctx.db.transaction(async (tx) => {
      const r = await one<{ status: string; title: string; company_id: string }>(tx, sql`SELECT status, title, company_id FROM procurement_requests WHERE id = ${input.requestId}`);
      if (!r) throw notFound('درخواست خرید');
      if (r.status !== 'approved') throw conflict('NOT_APPROVED', 'استعلام فقط برای درخواست تأییدشده');
      const n = await nextNumber(tx, 'procurement_rfqs', r.company_id);
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO procurement_rfqs (id, tenant_id, company_id, number, request_id, title, due_on, created_by)
        VALUES (${id}, ${ctx.tenantId}, ${r.company_id}, ${n}, ${input.requestId}, ${input.title || r.title}, ${input.dueOn}, ${ctx.userId})`);
      return { id, number: n };
    });
  },

  async get(ctx: ModuleRequestContext, id: string) {
    return ctx.db.transaction(async (tx) => {
      const q = await one<{ request_id: string }>(tx, sql`SELECT q.*, q.due_on::text FROM procurement_rfqs q WHERE q.id = ${id}`);
      if (!q) throw notFound('استعلام');
      const lines = await rows<{ id: string; description: string; unit: string; quantity: string }>(tx, sql`SELECT id, description, unit, quantity::text FROM procurement_request_lines WHERE request_id = ${q.request_id} ORDER BY line_no`);
      const quotes = await rows<{ id: string; supplier_id: string; supplier_name: string; delivery_days: number | null; valid_until: string | null; payment_terms: string; notes: string; received_on: string }>(
        tx,
        sql`SELECT x.id, x.supplier_id, s.name AS supplier_name, x.delivery_days, x.valid_until::text, x.payment_terms, x.notes, x.received_on::text FROM procurement_quotes x JOIN procurement_suppliers s ON s.id = x.supplier_id WHERE x.rfq_id = ${id} ORDER BY s.name`,
      );
      const prices = quotes.length
        ? await rows<{ quote_id: string; request_line_id: string; unit_price: string }>(tx, sql`SELECT quote_id, request_line_id, unit_price::text FROM procurement_quote_lines WHERE quote_id IN (${sql.join(quotes.map((x) => sql`${x.id}::uuid`), sql`, `)})`)
        : [];
      const rowsQ = quotes.map((x) => ({ ...x, prices: Object.fromEntries(lines.map((l) => [l.id, prices.find((p) => p.quote_id === x.id && p.request_line_id === l.id)?.unit_price ?? null])) }));
      const comparison = compareQuotes(lines, rowsQ.map((x) => ({ supplierId: x.supplier_id, supplierName: x.supplier_name, deliveryDays: x.delivery_days, prices: x.prices })));
      return { rfq: q, lines, quotes: rowsQ, comparison };
    });
  },

  async addQuote(ctx: ModuleRequestContext, id: string, input: z.infer<typeof quoteInput>) {
    return ctx.db.transaction(async (tx) => {
      const q = await one<{ status: string; request_id: string; company_id: string }>(tx, sql`SELECT status, request_id, company_id FROM procurement_rfqs WHERE id = ${id} FOR UPDATE`);
      if (!q) throw notFound('استعلام');
      if (q.status !== 'open') throw conflict('CLOSED', 'استعلام بسته شده است');
      const s = await one<{ status: string }>(tx, sql`SELECT status FROM procurement_suppliers WHERE id = ${input.supplierId}`);
      if (!s) throw invalid('SUPPLIER', 'تأمین‌کننده معتبر نیست');
      if (s.status === 'blocked') throw conflict('BLOCKED', 'این تأمین‌کننده مسدود است');
      const lineIds = (await rows<{ id: string }>(tx, sql`SELECT id FROM procurement_request_lines WHERE request_id = ${q.request_id}`)).map((l) => l.id);
      if (input.prices.some((p) => !lineIds.includes(p.requestLineId))) throw invalid('LINE', 'ردیف قیمت متعلق به این درخواست نیست');
      await tx.execute(sql`DELETE FROM procurement_quotes WHERE rfq_id = ${id} AND supplier_id = ${input.supplierId}`);
      const qid = randomUUID();
      await tx.execute(sql`INSERT INTO procurement_quotes (id, tenant_id, company_id, rfq_id, supplier_id, received_on, valid_until, delivery_days, payment_terms, notes, created_by)
        VALUES (${qid}, ${ctx.tenantId}, ${q.company_id}, ${id}, ${input.supplierId}, ${input.receivedOn}, ${input.validUntil}, ${input.deliveryDays}, ${input.paymentTerms}, ${input.notes}, ${ctx.userId})`);
      for (const p of input.prices) {
        await tx.execute(sql`INSERT INTO procurement_quote_lines (id, tenant_id, company_id, quote_id, request_line_id, unit_price) VALUES (${randomUUID()}, ${ctx.tenantId}, ${q.company_id}, ${qid}, ${p.requestLineId}, ${p.unitPrice})`);
      }
      return { id: qid };
    });
  },

  /** Award: choosing other than the lowest complete quote needs a written reason; a pending order is created. */
  async award(ctx: ModuleRequestContext, id: string, input: z.infer<typeof awardInput>, today: string) {
    const d = await Rfqs.get(ctx, id);
    if ((d.rfq as unknown as { status: string }).status !== 'open') throw conflict('CLOSED', 'استعلام بسته شده است');
    const quote = d.quotes.find((x) => x.id === input.quoteId);
    if (!quote) throw notFound('پیشنهاد');
    const priced = d.lines.filter((l) => quote.prices[l.id]);
    if (!priced.length) throw invalid('EMPTY', 'این پیشنهاد قیمتی ندارد');
    if (d.comparison.lowest && d.comparison.lowest !== quote.supplier_id && input.reason.trim().length < 5) throw invalid('REASON', 'انتخاب پیشنهادی غیر از ارزان‌ترین پیشنهاد کامل نیاز به دلیل مکتوب دارد');
    const req = await ctx.db.transaction((tx) => one<{ projects_project_id: string | null; contracts_contract_id: string | null }>(tx, sql`SELECT projects_project_id, contracts_contract_id FROM procurement_requests WHERE id = ${d.rfq.request_id}`));
    const lineInfo = await ctx.db.transaction((tx) => rows<{ id: string; category_id: string | null }>(tx, sql`SELECT id, category_id FROM procurement_request_lines WHERE request_id = ${d.rfq.request_id}`));
    const order = await Orders.create(ctx, {
      supplierId: quote.supplier_id, requestId: d.rfq.request_id, projectId: req!.projects_project_id, contractId: req!.contracts_contract_id, orderedOn: today, expectedOn: input.expectedOn,
      deliveryAddress: input.deliveryAddress, terms: quote.payment_terms,
      lines: priced.map((l) => ({ description: l.description, unit: l.unit, quantity: l.quantity, unitPrice: quote.prices[l.id]!, requestLineId: l.id, categoryId: lineInfo.find((x) => x.id === l.id)?.category_id ?? null })),
    }, id);
    await ctx.db.transaction((tx) => tx.execute(sql`UPDATE procurement_rfqs SET status = 'awarded', awarded_quote_id = ${input.quoteId}, award_reason = ${input.reason} WHERE id = ${id}`));
    return order;
  },
};

// ---------------------------------------------------------------- orders

const ORDER_TOTAL = sql`(SELECT coalesce(sum(round(l.quantity * l.unit_price)), 0) FROM procurement_order_lines l WHERE l.order_id = o.id)`;

async function orderLines(tx: Db, orderId: string) {
  return rows<{ id: string; line_no: number; description: string; unit: string; quantity: string; unit_price: string; category_id: string | null; accepted: string; rejected: string; invoiced: string; amount: string }>(
    tx,
    sql`SELECT l.id, l.line_no, l.description, l.unit, l.quantity::text, l.unit_price::text, l.category_id, round(l.quantity * l.unit_price)::text AS amount,
        coalesce((SELECT sum(r.accepted) FROM procurement_receipt_lines r WHERE r.order_line_id = l.id), 0)::text AS accepted,
        coalesce((SELECT sum(r.rejected) FROM procurement_receipt_lines r WHERE r.order_line_id = l.id), 0)::text AS rejected,
        coalesce((SELECT sum(il.quantity) FROM procurement_invoice_lines il JOIN procurement_invoices i ON i.id = il.invoice_id WHERE il.order_line_id = l.id AND i.status = 'approved'), 0)::text AS invoiced
      FROM procurement_order_lines l WHERE l.order_id = ${orderId} ORDER BY l.line_no`,
  );
}

export const Orders = {
  /** `scoped`: a site user with project-scoped receipt rights sees only the orders of their projects. */
  list: async (ctx: ModuleRequestContext, f: z.infer<typeof orderQuery>, today: string, scoped = false) => {
    const companyWide = ['procurement.order.manage', 'procurement.invoice.manage', 'procurement.invoice.approve'].some((p) => ctx.can(p, 'company'));
    const scope = scoped && !companyWide ? await projectScope(ctx, 'procurement.receipt.record') : null;
    return ctx.db.transaction(async (tx) => {
      const list = await rows<{ id: string; status: string; expected_on: string; received_pct: number } & Row>(
        tx,
        sql`SELECT o.id, o.number, o.supplier_id, s.name AS supplier_name, o.projects_project_id, o.ordered_on::text, o.expected_on::text, o.status, o.created_by, ${ORDER_TOTAL}::text AS total,
            coalesce((SELECT round(100 * sum(least(coalesce((SELECT sum(r.accepted) FROM procurement_receipt_lines r WHERE r.order_line_id = l.id), 0), l.quantity)) / nullif(sum(l.quantity), 0), 1)
              FROM procurement_order_lines l WHERE l.order_id = o.id), 0)::float AS received_pct
          FROM procurement_orders o JOIN procurement_suppliers s ON s.id = o.supplier_id
          WHERE ${scope === null ? sql`TRUE` : scope.length ? sql`o.projects_project_id IN (${sql.join(scope.map((p) => sql`${p}::uuid`), sql`, `)})` : sql`FALSE`}
            ${f.status ? sql`AND o.status = ${f.status}` : sql``} ${f.supplierId ? sql`AND o.supplier_id = ${f.supplierId}` : sql``}
          ORDER BY o.number DESC LIMIT 1000`,
      );
      const withLate = list.map((o) => ({ ...o, late: o.status === 'approved' && o.expected_on < today && o.received_pct < 100 }));
      return f.late ? withLate.filter((o) => o.late) : withLate;
    });
  },

  async get(ctx: ModuleRequestContext, id: string, today: string) {
    return ctx.db.transaction(async (tx) => {
      const o = await one<{ projects_project_id: string | null; status: string; expected_on: string }>(tx, sql`SELECT o.*, o.ordered_on::text, o.expected_on::text, s.name AS supplier_name, s.iban AS supplier_iban, ${ORDER_TOTAL}::text AS total
        FROM procurement_orders o JOIN procurement_suppliers s ON s.id = o.supplier_id WHERE o.id = ${id}`);
      if (!o) throw notFound('سفارش');
      const scope = await projectScope(ctx, 'procurement.receipt.record');
      if (!ctx.can('procurement.order.manage', 'company') && !ctx.can('procurement.invoice.manage', 'company') && !ctx.can('procurement.invoice.approve', 'company') && (scope === null ? false : !o.projects_project_id || !scope.includes(o.projects_project_id))) {
        throw notFound('سفارش');
      }
      const [lines, receipts, invoices, rating] = await Promise.all([
        orderLines(tx, id),
        rows(tx, sql`SELECT r.id, r.received_on::text, r.document_no, r.notes, r.created_by, json_agg(json_build_object('order_line_id', l.order_line_id, 'accepted', l.accepted::text, 'rejected', l.rejected::text, 'note', l.note)) AS lines
          FROM procurement_receipts r JOIN procurement_receipt_lines l ON l.receipt_id = r.id WHERE r.order_id = ${id} GROUP BY r.id ORDER BY r.received_on`),
        rows(tx, sql`SELECT id, number, issued_on::text, due_on::text, amount::text, status, match, override_reason, decided_by, decision_note, created_by FROM procurement_invoices WHERE order_id = ${id} ORDER BY created_at`),
        one(tx, sql`SELECT quality, delivery, price, comment, rated_by FROM procurement_ratings WHERE order_id = ${id}`),
      ]);
      const receivedPct = lines.length ? Math.round((lines.reduce((s, l) => s + Math.min(Number(l.accepted), Number(l.quantity)), 0) / lines.reduce((s, l) => s + Number(l.quantity), 0)) * 1000) / 10 : 0;
      return { order: { ...o, late: o.status === 'approved' && o.expected_on < today && receivedPct < 100, receivedPct }, lines, receipts, invoices, rating: rating ?? null };
    });
  },

  async create(ctx: ModuleRequestContext, input: z.infer<typeof orderInput>, rfqId: string | null = null) {
    await checkProject(ctx, input.projectId);
    return ctx.db.transaction(async (tx) => {
      const s = await one<{ status: string; name: string }>(tx, sql`SELECT status, name FROM procurement_suppliers WHERE id = ${input.supplierId}`);
      if (!s) throw invalid('SUPPLIER', 'تأمین‌کننده معتبر نیست');
      if (s.status === 'blocked') throw conflict('BLOCKED', 'این تأمین‌کننده مسدود است');
      if (input.requestId) {
        const r = await one<{ status: string }>(tx, sql`SELECT status FROM procurement_requests WHERE id = ${input.requestId} FOR UPDATE`);
        if (!r || r.status !== 'approved') throw conflict('NOT_APPROVED', 'سفارش فقط برای درخواست خرید تأییدشده');
      }
      const n = await nextNumber(tx, 'procurement_orders', ctx.companyId);
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO procurement_orders (id, tenant_id, company_id, number, supplier_id, request_id, rfq_id, projects_project_id, contracts_contract_id, ordered_on, expected_on, delivery_address, terms, created_by)
        VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${n}, ${input.supplierId}, ${input.requestId}, ${rfqId}, ${input.projectId}, ${input.contractId}, ${input.orderedOn}, ${input.expectedOn}, ${input.deliveryAddress}, ${input.terms}, ${ctx.userId})`);
      let total = 0n;
      let i = 0;
      for (const l of input.lines) {
        total += lineAmount(l.quantity, l.unitPrice);
        await tx.execute(sql`INSERT INTO procurement_order_lines (id, tenant_id, company_id, order_id, line_no, request_line_id, description, unit, quantity, unit_price, category_id)
          VALUES (${randomUUID()}, ${ctx.tenantId}, ${ctx.companyId}, ${id}, ${++i}, ${l.requestLineId}, ${l.description}, ${l.unit}, ${l.quantity}, ${l.unitPrice}, ${l.categoryId})`);
      }
      const wf = await ctx.startWorkflow({ key: 'procurement.order', entityType: 'purchase_order', entityId: id, title: `سفارش خرید ${n.toLocaleString('fa-IR')} — ${s.name}`, amount: Number(total) }, tx);
      await tx.execute(sql`UPDATE procurement_orders SET workflow_instance_id = ${wf.instanceId} WHERE id = ${id}`);
      await ctx.audit({ action: 'procurement.order.created', entityType: 'purchase_order', entityId: id, after: { number: n, total: total.toString() } }, tx);
      return { id, number: n, total: total.toString() };
    });
  },

  async cancel(ctx: ModuleRequestContext, id: string) {
    await ctx.db.transaction(async (tx) => {
      const o = await one<{ status: string; workflow_instance_id: string | null }>(tx, sql`SELECT status, workflow_instance_id FROM procurement_orders WHERE id = ${id} FOR UPDATE`);
      if (!o) throw notFound('سفارش');
      if (o.status !== 'pending' && o.status !== 'approved') throw conflict('FINISHED', 'این سفارش قابل لغو نیست');
      if (await one(tx, sql`SELECT 1 FROM procurement_receipts WHERE order_id = ${id}`)) throw conflict('HAS_RECEIPTS', 'برای این سفارش تحویل ثبت شده است؛ آن را ببندید');
      if (o.status === 'pending' && o.workflow_instance_id) await ctx.cancelWorkflow(o.workflow_instance_id, tx);
      await tx.execute(sql`UPDATE procurement_orders SET status = 'cancelled' WHERE id = ${id}`);
      await ctx.audit({ action: 'procurement.order.cancelled', entityType: 'purchase_order', entityId: id }, tx);
    });
  },

  async close(ctx: ModuleRequestContext, id: string) {
    await ctx.db.transaction(async (tx) => {
      const r = await rows(tx, sql`UPDATE procurement_orders SET status = 'closed' WHERE id = ${id} AND status = 'approved' RETURNING request_id`);
      if (!r.length) throw conflict('NOT_APPROVED', 'فقط سفارش تأییدشده بسته می‌شود');
      const reqId = (r[0] as { request_id: string | null }).request_id;
      if (reqId) await tx.execute(sql`UPDATE procurement_requests SET status = 'closed' WHERE id = ${reqId} AND status = 'approved'`);
    });
  },

  /** Site receipt: accepted and rejected quantities; accepted may never exceed what was ordered. */
  async receive(ctx: ModuleRequestContext, id: string, input: z.infer<typeof receiptInput>) {
    return ctx.db.transaction(async (tx) => {
      const o = await one<{ status: string; company_id: string; projects_project_id: string | null; ordered_on: string }>(tx, sql`SELECT status, company_id, projects_project_id, ordered_on::text FROM procurement_orders WHERE id = ${id} FOR UPDATE`);
      if (!o) throw notFound('سفارش');
      await assertProject(ctx, 'procurement.receipt.record', o.projects_project_id);
      if (o.status !== 'approved') throw conflict('NOT_APPROVED', 'تحویل فقط برای سفارش تأییدشده و باز ثبت می‌شود');
      if (input.receivedOn < o.ordered_on) throw invalid('DATE', 'تاریخ تحویل قبل از تاریخ سفارش است');
      const lines = await orderLines(tx, id);
      for (const l of input.lines) {
        const ol = lines.find((x) => x.id === l.orderLineId);
        if (!ol) throw invalid('LINE', 'ردیف متعلق به این سفارش نیست');
        if (qty(l.accepted) + qty(ol.accepted) > qty(ol.quantity)) throw conflict('OVER_RECEIPT', `${ol.description}: پذیرش بیش از مقدار سفارش (${Number(ol.quantity).toLocaleString('fa-IR')}) ممکن نیست`);
      }
      const rid = randomUUID();
      await tx.execute(sql`INSERT INTO procurement_receipts (id, tenant_id, company_id, order_id, received_on, document_no, notes, created_by) VALUES (${rid}, ${ctx.tenantId}, ${o.company_id}, ${id}, ${input.receivedOn}, ${input.documentNo}, ${input.notes}, ${ctx.userId})`);
      for (const l of input.lines) {
        if (qty(l.accepted) + qty(l.rejected) === 0n) continue;
        await tx.execute(sql`INSERT INTO procurement_receipt_lines (id, tenant_id, company_id, receipt_id, order_line_id, accepted, rejected, note) VALUES (${randomUUID()}, ${ctx.tenantId}, ${o.company_id}, ${rid}, ${l.orderLineId}, ${l.accepted}, ${l.rejected}, ${l.note})`);
      }
      await ctx.audit({ action: 'procurement.receipt.recorded', entityType: 'purchase_order', entityId: id, after: { receipt: rid, lines: input.lines } }, tx);
      return { id: rid };
    });
  },
};

// ---------------------------------------------------------------- invoices (three-way match)

export const Invoices = {
  list: (ctx: ModuleRequestContext) =>
    ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT i.id, i.number, i.order_id, o.number AS order_number, i.supplier_id, s.name AS supplier_name, i.issued_on::text, i.due_on::text, i.amount::text, i.status, (i.match->>'ok')::boolean AS matched, i.match, i.override_reason, i.decision_note,
          i.created_by, i.decided_by FROM procurement_invoices i JOIN procurement_orders o ON o.id = i.order_id JOIN procurement_suppliers s ON s.id = i.supplier_id ORDER BY (i.status = 'pending') DESC, i.created_at DESC LIMIT 1000`),
    ),

  async create(ctx: ModuleRequestContext, input: z.infer<typeof invoiceInput>) {
    return ctx.db.transaction(async (tx) => {
      const o = await one<{ status: string; supplier_id: string; company_id: string }>(tx, sql`SELECT status, supplier_id, company_id FROM procurement_orders WHERE id = ${input.orderId} FOR UPDATE`);
      if (!o) throw notFound('سفارش');
      if (o.status !== 'approved' && o.status !== 'closed') throw conflict('NOT_APPROVED', 'فاکتور فقط برای سفارش تأییدشده');
      const lines = await orderLines(tx, input.orderId);
      const match = threeWayMatch(lines.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, unitPrice: l.unit_price, accepted: l.accepted, invoiced: l.invoiced })), input.lines, input.amount);
      const id = randomUUID();
      try {
        await tx.execute(sql`INSERT INTO procurement_invoices (id, tenant_id, company_id, supplier_id, order_id, number, issued_on, due_on, amount, match, created_by)
          VALUES (${id}, ${ctx.tenantId}, ${o.company_id}, ${o.supplier_id}, ${input.orderId}, ${input.number}, ${input.issuedOn}, ${input.dueOn}, ${input.amount}, ${JSON.stringify(match)}::jsonb, ${ctx.userId})`);
      } catch (e) {
        if ((e as { cause?: { code?: string } }).cause?.code === '23505') throw conflict('DUPLICATE', 'این شماره فاکتور برای همین تأمین‌کننده قبلاً ثبت شده است');
        throw e;
      }
      for (const l of input.lines) {
        if (!lines.some((x) => x.id === l.orderLineId)) continue;
        await tx.execute(sql`INSERT INTO procurement_invoice_lines (id, tenant_id, company_id, invoice_id, order_line_id, quantity, unit_price) VALUES (${randomUUID()}, ${ctx.tenantId}, ${o.company_id}, ${id}, ${l.orderLineId}, ${l.quantity}, ${l.unitPrice})`);
      }
      await ctx.audit({ action: 'procurement.invoice.recorded', entityType: 'invoice', entityId: id, after: { number: input.number, amount: input.amount, match: match.ok } }, tx);
      return { id, match };
    });
  },

  /**
   * Approval by someone other than the person who recorded it, re-checking the match against the current
   * receipts and approved invoices. A mismatch can only be approved with a written override reason.
   */
  async decide(ctx: ModuleRequestContext, id: string, input: z.infer<typeof invoiceDecisionInput>) {
    return ctx.db.transaction(async (tx) => {
      const inv = await one<{ id: string; status: string; created_by: string; order_id: string; supplier_id: string; company_id: string; number: string; amount: string; issued_on: string; due_on: string }>(
        tx,
        sql`SELECT id, status, created_by, order_id, supplier_id, company_id, number, amount::text, issued_on::text, due_on::text FROM procurement_invoices WHERE id = ${id} FOR UPDATE`,
      );
      if (!inv) throw notFound('فاکتور');
      if (inv.status !== 'pending') throw conflict('DECIDED', 'این فاکتور قبلاً بررسی شده است');
      if (inv.created_by === ctx.userId) throw forbidden('ثبت‌کننده فاکتور نمی‌تواند آن را تأیید یا رد کند');
      await tx.execute(sql`SELECT id FROM procurement_orders WHERE id = ${inv.order_id} FOR UPDATE`);
      const lines = await orderLines(tx, inv.order_id);
      const invLines = await rows<{ order_line_id: string; quantity: string; unit_price: string }>(tx, sql`SELECT order_line_id, quantity::text, unit_price::text FROM procurement_invoice_lines WHERE invoice_id = ${id}`);
      const match = threeWayMatch(
        lines.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, unitPrice: l.unit_price, accepted: l.accepted, invoiced: l.invoiced })),
        invLines.map((l) => ({ orderLineId: l.order_line_id, quantity: l.quantity, unitPrice: l.unit_price })),
        inv.amount,
      );
      if (input.decision === 'approve' && !match.ok && input.overrideReason.trim().length < 10) {
        throw conflict('MATCH_FAILED', `کنترل سه‌طرفه برقرار نیست: ${match.issues.map((i) => i.message).join('؛ ')}`);
      }
      const status = input.decision === 'approve' ? 'approved' : 'rejected';
      await tx.execute(sql`UPDATE procurement_invoices SET status = ${status}, match = ${JSON.stringify(match)}::jsonb, override_reason = ${match.ok ? '' : input.overrideReason}, decided_by = ${ctx.userId}, decided_at = now(),
        decision_note = ${input.note} WHERE id = ${id}`);
      if (status === 'approved') {
        const meta = await one<{ name: string; order_number: number; project: string | null }>(tx, sql`SELECT s.name, o.number AS order_number, o.projects_project_id AS project FROM procurement_suppliers s, procurement_orders o WHERE s.id = ${inv.supplier_id} AND o.id = ${inv.order_id}`);
        await ctx.publish('procurement.invoice.approved', {
          invoiceId: id, number: inv.number, companyId: inv.company_id, supplier: { id: inv.supplier_id, name: meta!.name }, amount: inv.amount, issuedOn: inv.issued_on, dueOn: inv.due_on,
          projectId: meta!.project, orderNumber: String(meta!.order_number),
        }, tx);
      }
      await ctx.audit({ action: `procurement.invoice.${status}`, entityType: 'invoice', entityId: id, after: { match: match.ok, override: match.ok ? null : input.overrideReason } }, tx);
      return { status, match };
    });
  },
};

// ---------------------------------------------------------------- workflow results

export async function onWorkflowCompleted(ctx: ModuleEventContext, p: { moduleId: string; entityType: string; entityId: string; state: 'approved' | 'rejected'; deciders?: string[] }) {
  if (p.moduleId !== 'procurement') return;
  if (p.entityType === 'purchase_request') {
    const r = await ctx.db.transaction((tx) => one<{ requested_by: string; number: number }>(tx, sql`UPDATE procurement_requests SET status = ${p.state}, decided_at = now() WHERE id = ${p.entityId} AND status = 'pending' RETURNING requested_by, number`));
    if (r) await ctx.notify({ userIds: [r.requested_by], type: 'procurement.request.decided', title: `درخواست خرید ${r.number.toLocaleString('fa-IR')} ${p.state === 'approved' ? 'تأیید شد' : 'رد شد'}`, link: `/app/procurement/requests/${p.entityId}` });
  } else if (p.entityType === 'purchase_order') {
    await ctx.db.transaction(async (tx) => {
      const o = await one<{ id: string; number: number; company_id: string; supplier_id: string; name: string; projects_project_id: string | null; total: string }>(
        tx,
        sql`UPDATE procurement_orders o SET status = ${p.state}, decided_at = now(), approvers = ${`{${(p.deciders ?? []).join(',')}}`}::uuid[] FROM procurement_suppliers s
          WHERE o.id = ${p.entityId} AND o.status = 'pending' AND s.id = o.supplier_id RETURNING o.id, o.number, o.company_id, o.supplier_id, s.name, o.projects_project_id, ${ORDER_TOTAL}::text AS total`,
      );
      if (o && p.state === 'approved') {
        await ctx.publish('procurement.order.approved', { orderId: o.id, number: `PO-${o.number}`, companyId: o.company_id, supplier: { id: o.supplier_id, name: o.name }, amount: o.total, projectId: o.projects_project_id }, tx);
      }
    });
  }
}

// ---------------------------------------------------------------- reports, widget, KPI

export async function reports(ctx: ModuleRequestContext, f: z.infer<typeof reportQuery>, today: string) {
  if (f.from > f.to) throw invalid('RANGE', 'ابتدای بازه باید قبل از انتهای آن باشد');
  return ctx.db.transaction(async (tx) => {
    const approved = sql`o.status IN ('approved', 'closed') AND o.ordered_on BETWEEN ${f.from}::date AND ${f.to}::date`;
    const [bySupplier, byProject, byCategory, late, performance] = await Promise.all([
      rows(tx, sql`SELECT s.id, s.name, count(DISTINCT o.id)::int AS orders, sum(round(l.quantity * l.unit_price))::text AS amount FROM procurement_orders o JOIN procurement_suppliers s ON s.id = o.supplier_id
        JOIN procurement_order_lines l ON l.order_id = o.id WHERE ${approved} GROUP BY s.id ORDER BY sum(round(l.quantity * l.unit_price)) DESC`),
      rows(tx, sql`SELECT o.projects_project_id, sum(round(l.quantity * l.unit_price))::text AS amount FROM procurement_orders o JOIN procurement_order_lines l ON l.order_id = o.id WHERE ${approved} GROUP BY 1`),
      rows(tx, sql`SELECT coalesce(c.name, 'بدون دسته') AS name, sum(round(l.quantity * l.unit_price))::text AS amount FROM procurement_orders o JOIN procurement_order_lines l ON l.order_id = o.id
        LEFT JOIN procurement_categories c ON c.id = l.category_id WHERE ${approved} GROUP BY 1 ORDER BY sum(round(l.quantity * l.unit_price)) DESC`),
      (await Orders.list(ctx, { late: '1' }, today)).map((o) => ({ ...o, days_late: Math.round((Date.parse(today) - Date.parse(o.expected_on)) / 86_400_000) })),
      rows(tx, sql`WITH done AS (
          SELECT o.id, o.supplier_id, o.expected_on,
            (SELECT min(r.received_on) FROM procurement_receipts r WHERE r.order_id = o.id
               AND NOT EXISTS (SELECT 1 FROM procurement_order_lines l WHERE l.order_id = o.id AND l.quantity > coalesce((SELECT sum(rl.accepted) FROM procurement_receipt_lines rl JOIN procurement_receipts r2 ON r2.id = rl.receipt_id
                 WHERE rl.order_line_id = l.id AND r2.received_on <= r.received_on), 0))) AS completed_on
          FROM procurement_orders o WHERE ${approved})
        SELECT s.id, s.name, count(d.id)::int AS orders, count(d.completed_on)::int AS completed,
          count(*) FILTER (WHERE d.completed_on IS NOT NULL AND d.completed_on <= d.expected_on)::int AS on_time,
          (SELECT round(avg((r.quality + r.delivery + r.price) / 3.0), 2)::float FROM procurement_ratings r WHERE r.supplier_id = s.id) AS rating
        FROM done d JOIN procurement_suppliers s ON s.id = d.supplier_id GROUP BY s.id ORDER BY s.name`),
    ]);
    return { bySupplier, byProject, byCategory, late, performance };
  });
}

/** Account of a supplier: ordered, accepted (value at order price) and invoiced. */
export async function supplierStatement(ctx: ModuleRequestContext, supplierId: string) {
  return ctx.db.transaction(async (tx) => {
    const s = await one(tx, sql`SELECT id, name FROM procurement_suppliers WHERE id = ${supplierId}`);
    if (!s) throw notFound('تأمین‌کننده');
    const orders = await rows(tx, sql`SELECT o.id, o.number, o.ordered_on::text, o.status, ${ORDER_TOTAL}::text AS ordered,
        (SELECT coalesce(sum(round(least(coalesce((SELECT sum(r.accepted) FROM procurement_receipt_lines r WHERE r.order_line_id = l.id), 0), l.quantity) * l.unit_price)), 0) FROM procurement_order_lines l WHERE l.order_id = o.id)::text AS accepted,
        (SELECT coalesce(sum(i.amount), 0) FROM procurement_invoices i WHERE i.order_id = o.id AND i.status = 'approved')::text AS invoiced
      FROM procurement_orders o WHERE o.supplier_id = ${supplierId} AND o.status IN ('approved', 'closed') ORDER BY o.number`);
    return { supplier: s, orders };
  });
}

export async function statusWidget(ctx: ModuleRequestContext, today: string) {
  return ctx.db.transaction(async (tx) => {
    const r = await one(tx, sql`SELECT (SELECT count(*)::int FROM procurement_requests WHERE status = 'pending') AS pending_requests,
        (SELECT count(*)::int FROM procurement_requests r WHERE r.status = 'approved' AND NOT EXISTS (SELECT 1 FROM procurement_orders o WHERE o.request_id = r.id AND o.status <> 'cancelled')) AS to_order,
        (SELECT count(*)::int FROM procurement_orders WHERE status = 'pending') AS pending_orders,
        (SELECT count(*)::int FROM procurement_invoices WHERE status = 'pending') AS pending_invoices`);
    const late = (await Orders.list(ctx, { late: '1' }, today)).length;
    return { ...r, late };
  });
}

export const kpi = {
  spend: (ctx: ModuleEventContext, p: { companyId: string; from: string; to: string }) =>
    ctx.db.transaction(async (tx) => Number((await one<{ n: string }>(tx, sql`SELECT coalesce(sum(round(l.quantity * l.unit_price)), 0)::text AS n FROM procurement_orders o JOIN procurement_order_lines l ON l.order_id = o.id
      WHERE o.company_id = ${p.companyId} AND o.status IN ('approved', 'closed') AND o.ordered_on BETWEEN ${p.from}::date AND ${p.to}::date`))!.n)),
  lateOrders: (ctx: ModuleEventContext, p: { companyId: string; to: string }) =>
    ctx.db.transaction(async (tx) => (await one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM procurement_orders o WHERE o.company_id = ${p.companyId} AND o.status = 'approved' AND o.expected_on < ${p.to}::date
      AND EXISTS (SELECT 1 FROM procurement_order_lines l WHERE l.order_id = o.id AND l.quantity > coalesce((SELECT sum(r.accepted) FROM procurement_receipt_lines r JOIN procurement_receipts x ON x.id = r.receipt_id WHERE r.order_line_id = l.id AND x.received_on <= ${p.to}::date), 0))`))!.n),
  onTimeRate: (ctx: ModuleEventContext, p: { companyId: string; from: string; to: string }) =>
    ctx.db.transaction(async (tx) => {
      const r = await one<{ due: number; on_time: number }>(tx, sql`SELECT count(*)::int AS due, count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM procurement_order_lines l WHERE l.order_id = o.id
          AND l.quantity > coalesce((SELECT sum(r.accepted) FROM procurement_receipt_lines r JOIN procurement_receipts x ON x.id = r.receipt_id WHERE r.order_line_id = l.id AND x.received_on <= o.expected_on), 0)))::int AS on_time
        FROM procurement_orders o WHERE o.company_id = ${p.companyId} AND o.status IN ('approved', 'closed') AND o.expected_on BETWEEN ${p.from}::date AND ${p.to}::date`);
      return r!.due ? Math.round((r!.on_time / r!.due) * 1000) / 10 : null;
    }),
};

export async function search(ctx: ModuleRequestContext, q: string, limit: number) {
  const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const r = await ctx.db.transaction((tx) => rows<{ id: string; name: string }>(tx, sql`SELECT id, name FROM procurement_suppliers WHERE name ILIKE ${like} ORDER BY name LIMIT ${limit}`));
  return r.map((x) => ({ entityType: 'supplier', entityId: x.id, title: x.name, link: `/app/procurement/suppliers/${x.id}` }));
}


/** Projects the user may raise requests for (company scope: all, via the projects service search). */
export async function projectOptions(ctx: ModuleRequestContext) {
  const svc = projectsOf(ctx);
  if (!svc) return [];
  const scope = await projectScope(ctx, 'procurement.request.create');
  const all = await svc.search('', 500);
  return scope === null ? all : all.filter((p) => scope.includes(p.id));
}
