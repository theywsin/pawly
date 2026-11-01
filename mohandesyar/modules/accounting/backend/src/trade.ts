import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { bookVoucher, nextNumber, one, reverseVoucher, rows, settingsOf, type Books, type LineSpec } from './books.js';
import { fromMilli, issueCost, lineCalc, milli, roundDiv, seasonRange } from './calc.js';
import { conflict, forbidden, invalid, notFound } from './errors.js';
import { guardDb, withBooks } from './gl.js';
import type { adjustmentInput, invoiceInput, invoiceQuery, itemInput, vatQuery, warehouseInput } from './inputs.js';

export const KIND_FA: Record<string, string> = { sale: 'فروش', purchase: 'خرید', sale_return: 'برگشت از فروش', purchase_return: 'برگشت از خرید' };

// ---------------------------------------------------------------- items and warehouses

export const Items = {
  list(ctx: ModuleRequestContext) {
    return withBooks(ctx, (tx, b) =>
      rows(tx, sql`SELECT i.id, i.code, i.name, i.kind, i.unit, i.sale_price::text, i.vat_exempt, i.expense_account_id, i.active,
          coalesce(s.qty, 0)::text AS on_hand, coalesce(s.cost, 0)::text AS stock_value
        FROM accounting_items i LEFT JOIN (SELECT item_id, sum(qty) AS qty, sum(cost) AS cost FROM accounting_stock_moves WHERE company_id = ${b.companyId} GROUP BY item_id) s ON s.item_id = i.id
        WHERE i.company_id = ${b.companyId} ORDER BY i.code`),
    );
  },

  save(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof itemInput>) {
    return guardDb(withBooks(ctx, async (tx, b) => {
      if (input.expenseAccountId && !(await one(tx, sql`SELECT 1 FROM accounting_accounts WHERE id = ${input.expenseAccountId} AND company_id = ${b.companyId} AND level = 'subsidiary'`))) throw invalid('ACCOUNT', 'حساب هزینه باید حساب معین باشد');
      if (id) {
        const cur = await one<{ kind: string }>(tx, sql`SELECT kind FROM accounting_items WHERE id = ${id} AND company_id = ${b.companyId}`);
        if (!cur) throw notFound('کالا یا خدمت');
        if (cur.kind !== input.kind && (await one(tx, sql`SELECT 1 FROM accounting_stock_moves WHERE item_id = ${id} LIMIT 1`))) throw conflict('ITEM_USED', 'نوع کالای دارای گردش انبار را نمی‌توان تغییر داد');
        await tx.execute(sql`UPDATE accounting_items SET code = ${input.code}, name = ${input.name}, kind = ${input.kind}, unit = ${input.unit}, sale_price = ${input.salePrice}, vat_exempt = ${input.vatExempt},
          expense_account_id = ${input.expenseAccountId}, active = ${input.active} WHERE id = ${id}`);
        return { id };
      }
      const nid = randomUUID();
      await tx.execute(sql`INSERT INTO accounting_items (id, tenant_id, company_id, code, name, kind, unit, sale_price, vat_exempt, expense_account_id, active)
        VALUES (${nid}, ${b.tenantId}, ${b.companyId}, ${input.code}, ${input.name}, ${input.kind}, ${input.unit}, ${input.salePrice}, ${input.vatExempt}, ${input.expenseAccountId}, ${input.active})`);
      return { id: nid };
    }));
  },

  warehouses(ctx: ModuleRequestContext) {
    return withBooks(ctx, (tx, b) => rows(tx, sql`SELECT id, name, active FROM accounting_warehouses WHERE company_id = ${b.companyId} ORDER BY name`));
  },

  createWarehouse(ctx: ModuleRequestContext, input: z.infer<typeof warehouseInput>) {
    return guardDb(withBooks(ctx, async (tx, b) => {
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO accounting_warehouses (id, tenant_id, company_id, name) VALUES (${id}, ${b.tenantId}, ${b.companyId}, ${input.name})`);
      return { id };
    }));
  },

  /** Stock card (کاردکس) of an item: moves in entry order with running quantity and value. */
  card(ctx: ModuleRequestContext, itemId: string) {
    return withBooks(ctx, async (tx, b) => {
      const m = await rows<{ id: string; date: string; qty: string; cost: string; source: string; description: string; warehouse: string }>(tx, sql`SELECT m.id, m.date::text, m.qty::text, m.cost::text, m.source, m.description, w.name AS warehouse
        FROM accounting_stock_moves m JOIN accounting_warehouses w ON w.id = m.warehouse_id WHERE m.company_id = ${b.companyId} AND m.item_id = ${itemId} ORDER BY m.seq`);
      let q = 0n;
      let c = 0n;
      return m.map((x) => {
        q += milli(x.qty.replace('-', '')) * (x.qty.startsWith('-') ? -1n : 1n);
        c += BigInt(x.cost);
        return { ...x, onHand: fromMilli(q), value: c.toString() };
      });
    });
  },
};

// ---------------------------------------------------------------- stock moves

const signedMilli = (q: string) => (q.startsWith('-') ? -milli(q.slice(1)) : milli(q));

async function stockOf(tx: Db, b: Books, itemId: string, warehouseId: string) {
  const r = await one<{ qty: string; cost: string; wqty: string; last_unit: string | null }>(tx, sql`SELECT coalesce(sum(qty), 0)::text AS qty, coalesce(sum(cost), 0)::text AS cost,
      coalesce(sum(qty) FILTER (WHERE warehouse_id = ${warehouseId}), 0)::text AS wqty,
      (SELECT (cost / qty)::numeric(20,0)::text FROM accounting_stock_moves WHERE company_id = ${b.companyId} AND item_id = ${itemId} AND qty > 0 AND cost > 0 ORDER BY seq DESC LIMIT 1) AS last_unit
    FROM accounting_stock_moves WHERE company_id = ${b.companyId} AND item_id = ${itemId}`);
  return { qty: signedMilli(r!.qty), cost: BigInt(r!.cost), wqty: signedMilli(r!.wqty), lastUnit: BigInt(r!.last_unit ?? '0') };
}

/** Adds a receipt (positive qty, given cost) or an issue (negative qty, cost at moving average). Returns the move's cost. */
async function move(tx: Db, b: Books, m: { itemId: string; warehouseId: string; date: string; qtyMilli: bigint; cost?: bigint; source: string; sourceId: string; description: string; allowNegative: boolean; itemName: string }) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`accounting-stock:${m.itemId}`}))`);
  let cost: bigint;
  if (m.qtyMilli > 0n) cost = m.cost!;
  else {
    const s = await stockOf(tx, b, m.itemId, m.warehouseId);
    const out = -m.qtyMilli;
    if (!m.allowNegative && s.wqty < out) throw conflict('NEGATIVE_STOCK', `موجودی «${m.itemName}» در این انبار کافی نیست (موجود: ${fromMilli(s.wqty)})`);
    cost = m.cost !== undefined ? -m.cost : s.qty > 0n ? -issueCost(s.qty, s.cost > 0n ? s.cost : 0n, out) : -roundDiv(s.lastUnit * out, 1000n);
  }
  await tx.execute(sql`INSERT INTO accounting_stock_moves (id, tenant_id, company_id, item_id, warehouse_id, date, qty, cost, source, source_id, description)
    VALUES (${randomUUID()}, ${b.tenantId}, ${b.companyId}, ${m.itemId}, ${m.warehouseId}, ${m.date}, ${fromMilli(m.qtyMilli)}, ${cost.toString()}, ${m.source}, ${m.sourceId}, ${m.description})`);
  return cost;
}

/** Opening stock, count gain or count loss, booked against equity (opening) or inventory gain/loss accounts. */
export function adjustStock(ctx: ModuleRequestContext, input: z.infer<typeof adjustmentInput>) {
  return guardDb(withBooks(ctx, async (tx, b) => {
    const s = await settingsOf(ctx);
    if (!(await one(tx, sql`SELECT 1 FROM accounting_warehouses WHERE id = ${input.warehouseId} AND company_id = ${b.companyId}`))) throw notFound('انبار');
    const id = randomUUID();
    let total = 0n;
    for (const l of input.lines) {
      const item = await one<{ name: string; kind: string }>(tx, sql`SELECT name, kind FROM accounting_items WHERE id = ${l.itemId} AND company_id = ${b.companyId}`);
      if (!item) throw notFound('کالا');
      if (item.kind !== 'goods') throw invalid('ITEM_KIND', `«${item.name}» خدمت است و موجودی ندارد`);
      const q = milli(l.qty);
      if (input.kind === 'loss') total += -(await move(tx, b, { itemId: l.itemId, warehouseId: input.warehouseId, date: input.date, qtyMilli: -q, source: 'adjustment', sourceId: id, description: input.description || 'کسری انبار', allowNegative: s.allowNegativeStock, itemName: item.name }));
      else {
        const cost = roundDiv(q * BigInt(l.unitCost), 1000n);
        await move(tx, b, { itemId: l.itemId, warehouseId: input.warehouseId, date: input.date, qtyMilli: q, cost, source: input.kind === 'opening' ? 'opening' : 'adjustment', sourceId: id, description: input.description || (input.kind === 'opening' ? 'موجودی اول دوره' : 'اضافات انبار'), allowNegative: true, itemName: item.name });
        total += cost;
      }
    }
    const label = input.kind === 'opening' ? 'موجودی اول دوره کالا' : input.kind === 'gain' ? 'اضافات انبار' : 'کسری انبار';
    const lines: LineSpec[] =
      input.kind === 'loss'
        ? [{ key: 'inventory_loss', debit: total }, { key: 'inventory', credit: total }]
        : [{ key: 'inventory', debit: total }, input.kind === 'opening' ? { key: 'retained_earnings', credit: total, description: 'موجودی اول دوره' } : { key: 'inventory_gain', credit: total }];
    const v = total > 0n ? await bookVoucher(tx, b, { date: input.date, description: `${label}${input.description ? ` — ${input.description}` : ''}`, source: 'inventory', sourceRef: id, lines, post: true, userId: ctx.userId }) : null;
    await ctx.audit({ action: `accounting.stock.${input.kind}`, entityType: 'accounting_stock_adjustment', entityId: id, after: { total: total.toString() } }, tx);
    return { id, total: total.toString(), voucherNumber: v?.number ?? null };
  }));
}

// ---------------------------------------------------------------- invoices

interface InvoiceRow { id: string; kind: string; number: number; date: string; detail_id: string; warehouse_id: string | null; status: string; created_by: string; voucher_id: string | null; total: string; party: string }

export const Invoices = {
  list(ctx: ModuleRequestContext, f: z.infer<typeof invoiceQuery>) {
    return withBooks(ctx, (tx, b) =>
      rows(tx, sql`SELECT i.id, i.kind, i.number, i.date::text, i.status, i.reference, i.subtotal::text, i.discount::text, i.vat::text, i.total::text, d.name AS party, v.number AS voucher_number, i.created_by, i.approved_by
        FROM accounting_invoices i JOIN accounting_details d ON d.id = i.detail_id LEFT JOIN accounting_vouchers v ON v.id = i.voucher_id
        WHERE i.company_id = ${b.companyId} ${f.kind ? sql`AND i.kind = ${f.kind}` : sql``} ${f.status ? sql`AND i.status = ${f.status}` : sql``}
          ${f.from ? sql`AND i.date >= ${f.from}::date` : sql``} ${f.to ? sql`AND i.date <= ${f.to}::date` : sql``}
        ORDER BY i.date DESC, i.number DESC LIMIT 1000`),
    );
  },

  get(ctx: ModuleRequestContext, id: string) {
    return withBooks(ctx, async (tx, b) => {
      const inv = await one(tx, sql`SELECT i.*, i.date::text AS date, i.subtotal::text, i.discount::text, i.vat::text, i.total::text, d.name AS party, d.economic_code, d.national_id, d.address, d.postal_code, v.number AS voucher_number
        FROM accounting_invoices i JOIN accounting_details d ON d.id = i.detail_id LEFT JOIN accounting_vouchers v ON v.id = i.voucher_id WHERE i.id = ${id} AND i.company_id = ${b.companyId}`);
      if (!inv) throw notFound('فاکتور');
      const lines = await rows(tx, sql`SELECT l.id, l.line_no, l.item_id, it.code AS item_code, it.name AS item_name, it.unit, l.description, l.qty::text, l.unit_price::text, l.discount::text, l.vat_rate::float8 AS vat_rate, l.amount::text, l.vat::text
        FROM accounting_invoice_lines l JOIN accounting_items it ON it.id = l.item_id WHERE l.invoice_id = ${id} ORDER BY l.line_no`);
      return { invoice: inv, lines };
    });
  },

  async save(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof invoiceInput>) {
    const s = await settingsOf(ctx);
    return guardDb(withBooks(ctx, async (tx, b) => {
      if (!(await one(tx, sql`SELECT 1 FROM accounting_details WHERE id = ${input.detailId} AND company_id = ${b.companyId}`))) throw notFound('طرف حساب');
      const warehouseId = input.warehouseId ?? (await one<{ id: string }>(tx, sql`SELECT id FROM accounting_warehouses WHERE company_id = ${b.companyId} AND active ORDER BY created_at LIMIT 1`))?.id ?? null;
      const lines = [];
      let subtotal = 0n;
      let discount = 0n;
      let vat = 0n;
      for (const [i, l] of input.lines.entries()) {
        const item = await one<{ name: string; vat_exempt: boolean; active: boolean }>(tx, sql`SELECT name, vat_exempt, active FROM accounting_items WHERE id = ${l.itemId} AND company_id = ${b.companyId}`);
        if (!item) throw notFound('کالا یا خدمت');
        const rate = l.vatRate ?? (item.vat_exempt ? 0 : s.vatRate);
        const c = lineCalc(l.qty, BigInt(l.unitPrice), BigInt(l.discount), rate);
        if (c.amount < 0n) throw invalid('DISCOUNT', `ردیف ${(i + 1).toLocaleString('fa-IR')}: تخفیف از مبلغ ردیف بیشتر است`);
        subtotal += c.gross;
        discount += BigInt(l.discount);
        vat += c.vat;
        lines.push({ ...l, rate, amount: c.amount, vat: c.vat });
      }
      const total = subtotal - discount + vat;
      if (total <= 0n) throw invalid('TOTAL', 'جمع فاکتور باید بیشتر از صفر باشد');
      let invoiceId = id;
      if (id) {
        const cur = await one<{ status: string }>(tx, sql`SELECT status FROM accounting_invoices WHERE id = ${id} AND company_id = ${b.companyId} FOR UPDATE`);
        if (!cur) throw notFound('فاکتور');
        if (cur.status !== 'draft') throw conflict('INVOICE_STATE', 'فاکتور تأییدشده قابل ویرایش نیست؛ آن را ابطال و فاکتور تازه صادر کنید');
        await tx.execute(sql`DELETE FROM accounting_invoice_lines WHERE invoice_id = ${id}`);
        await tx.execute(sql`UPDATE accounting_invoices SET date = ${input.date}, detail_id = ${input.detailId}, warehouse_id = ${warehouseId}, reference = ${input.reference}, description = ${input.description},
          subtotal = ${subtotal.toString()}, discount = ${discount.toString()}, vat = ${vat.toString()}, total = ${total.toString()}, updated_at = now() WHERE id = ${id}`);
      } else {
        invoiceId = randomUUID();
        const number = await nextNumber(tx, 'accounting_invoices', b, input.kind);
        await tx.execute(sql`INSERT INTO accounting_invoices (id, tenant_id, company_id, kind, number, date, detail_id, warehouse_id, reference, description, subtotal, discount, vat, total, created_by)
          VALUES (${invoiceId}, ${b.tenantId}, ${b.companyId}, ${input.kind}, ${number}, ${input.date}, ${input.detailId}, ${warehouseId}, ${input.reference}, ${input.description},
            ${subtotal.toString()}, ${discount.toString()}, ${vat.toString()}, ${total.toString()}, ${ctx.userId})`);
      }
      let n = 0;
      for (const l of lines) {
        n++;
        await tx.execute(sql`INSERT INTO accounting_invoice_lines (id, tenant_id, company_id, invoice_id, line_no, item_id, description, qty, unit_price, discount, vat_rate, amount, vat)
          VALUES (${randomUUID()}, ${b.tenantId}, ${b.companyId}, ${invoiceId}, ${n}, ${l.itemId}, ${l.description}, ${l.qty}, ${l.unitPrice}, ${l.discount}, ${l.rate}, ${l.amount.toString()}, ${l.vat.toString()})`);
      }
      return { id: invoiceId!, total: total.toString() };
    }));
  },

  /** Approves an invoice: books its voucher and stock moves (cost of goods sold at moving average). */
  async approve(ctx: ModuleRequestContext, id: string) {
    const s = await settingsOf(ctx);
    return guardDb(withBooks(ctx, async (tx, b) => {
      const inv = await one<InvoiceRow>(tx, sql`SELECT i.id, i.kind, i.number, i.date::text, i.detail_id, i.warehouse_id, i.status, i.created_by, i.voucher_id, i.total::text, d.name AS party
        FROM accounting_invoices i JOIN accounting_details d ON d.id = i.detail_id WHERE i.id = ${id} AND i.company_id = ${b.companyId} FOR UPDATE OF i`);
      if (!inv) throw notFound('فاکتور');
      if (inv.status !== 'draft') throw conflict('INVOICE_STATE', 'فاکتور قبلاً تأیید یا ابطال شده است');
      if (s.separateDuties && inv.created_by === ctx.userId) throw forbidden('تفکیک وظایف: فاکتوری را که خودتان ثبت کرده‌اید شخص دیگری باید تأیید کند');
      const lines = await rows<{ item_id: string; kind: string; name: string; qty: string; amount: string; vat: string; expense_account_id: string | null }>(tx,
        sql`SELECT l.item_id, it.kind, it.name, l.qty::text, l.amount::text, l.vat::text, it.expense_account_id FROM accounting_invoice_lines l JOIN accounting_items it ON it.id = l.item_id WHERE l.invoice_id = ${id} ORDER BY l.line_no`);
      if (lines.some((l) => l.kind === 'goods') && !inv.warehouse_id) throw invalid('WAREHOUSE', 'انبار فاکتور را انتخاب کنید');
      const vl: LineSpec[] = [];
      const party = inv.detail_id;
      const total = BigInt(inv.total);
      let vat = 0n;
      const goods = new Map<string, bigint>();
      let cogs = 0n;
      const isSale = inv.kind === 'sale' || inv.kind === 'sale_return';
      const isReturn = inv.kind.endsWith('_return');
      for (const l of lines) {
        const amount = BigInt(l.amount);
        vat += BigInt(l.vat);
        const q = milli(l.qty);
        const desc = `${l.name} × ${l.qty}`;
        if (inv.kind === 'sale') {
          vl.push({ key: l.kind === 'goods' ? 'sales' : 'service_income', credit: amount, description: desc });
          if (l.kind === 'goods') cogs += -(await move(tx, b, { itemId: l.item_id, warehouseId: inv.warehouse_id!, date: inv.date, qtyMilli: -q, source: 'invoice', sourceId: id, description: `فروش ${inv.number}`, allowNegative: s.allowNegativeStock, itemName: l.name }));
        } else if (inv.kind === 'sale_return') {
          vl.push({ key: 'sales_returns', debit: amount, description: desc });
          if (l.kind === 'goods') {
            const st = await stockOf(tx, b, l.item_id, inv.warehouse_id!);
            const unit = st.qty > 0n && st.cost > 0n ? roundDiv(st.cost * 1000n, st.qty) : st.lastUnit;
            const c = roundDiv(unit * q, 1000n);
            await move(tx, b, { itemId: l.item_id, warehouseId: inv.warehouse_id!, date: inv.date, qtyMilli: q, cost: c, source: 'invoice', sourceId: id, description: `برگشت از فروش ${inv.number}`, allowNegative: true, itemName: l.name });
            cogs -= c;
          }
        } else if (inv.kind === 'purchase') {
          if (l.kind === 'goods') {
            goods.set('inventory', (goods.get('inventory') ?? 0n) + amount);
            await move(tx, b, { itemId: l.item_id, warehouseId: inv.warehouse_id!, date: inv.date, qtyMilli: q, cost: amount, source: 'invoice', sourceId: id, description: `خرید ${inv.number}`, allowNegative: true, itemName: l.name });
          } else vl.push(l.expense_account_id ? { accountId: l.expense_account_id, debit: amount, description: desc } : { key: 'purchase_expense', debit: amount, description: desc });
        } else {
          if (l.kind === 'goods') {
            goods.set('inventory', (goods.get('inventory') ?? 0n) - amount);
            await move(tx, b, { itemId: l.item_id, warehouseId: inv.warehouse_id!, date: inv.date, qtyMilli: -q, cost: amount, source: 'invoice', sourceId: id, description: `برگشت از خرید ${inv.number}`, allowNegative: s.allowNegativeStock, itemName: l.name });
          } else vl.push(l.expense_account_id ? { accountId: l.expense_account_id, credit: amount, description: desc } : { key: 'purchase_expense', credit: amount, description: desc });
        }
      }
      const inventory = goods.get('inventory') ?? 0n;
      if (inventory > 0n) vl.push({ key: 'inventory', debit: inventory, description: 'خرید کالا' });
      if (inventory < 0n) vl.push({ key: 'inventory', credit: -inventory, description: 'برگشت کالا' });
      if (isSale) {
        vl.push(isReturn ? { key: 'vat_out', debit: vat, description: 'مالیات بر ارزش افزوده برگشت از فروش' } : { key: 'vat_out', credit: vat, description: 'مالیات بر ارزش افزوده فروش' });
        vl.unshift(isReturn ? { key: 'receivable', detailId: party, credit: total } : { key: 'receivable', detailId: party, debit: total });
        if (cogs > 0n) vl.push({ key: 'cogs', debit: cogs, description: 'بهای تمام‌شده کالای فروش‌رفته' }, { key: 'inventory', credit: cogs });
        if (cogs < 0n) vl.push({ key: 'inventory', debit: -cogs, description: 'بازگشت کالا به انبار' }, { key: 'cogs', credit: -cogs });
      } else {
        vl.push(isReturn ? { key: 'vat_in', credit: vat, description: 'مالیات بر ارزش افزوده برگشت از خرید' } : { key: 'vat_in', debit: vat, description: 'مالیات بر ارزش افزوده خرید' });
        vl.push(isReturn ? { key: 'payable', detailId: party, debit: total } : { key: 'payable', detailId: party, credit: total });
      }
      const v = await bookVoucher(tx, b, { date: inv.date, description: `فاکتور ${KIND_FA[inv.kind]} شماره ${inv.number.toLocaleString('fa-IR')} — ${inv.party}`, source: 'invoice', sourceRef: id, lines: vl, post: true, userId: ctx.userId });
      await tx.execute(sql`UPDATE accounting_invoices SET status = 'approved', approved_by = ${ctx.userId}, approved_at = now(), voucher_id = ${v!.id}, updated_at = now() WHERE id = ${id}`);
      await ctx.audit({ action: 'accounting.invoice.approved', entityType: 'accounting_invoice', entityId: id, after: { kind: inv.kind, number: inv.number, total: inv.total } }, tx);
      return { voucherNumber: v!.number };
    }));
  },

  /** Cancels an invoice: a draft is simply cancelled; an approved one gets a reversal voucher and reverse stock moves. */
  async cancel(ctx: ModuleRequestContext, id: string, date: string) {
    const s = await settingsOf(ctx);
    return guardDb(withBooks(ctx, async (tx, b) => {
      const inv = await one<{ status: string; voucher_id: string | null; number: number }>(tx, sql`SELECT status, voucher_id, number FROM accounting_invoices WHERE id = ${id} AND company_id = ${b.companyId} FOR UPDATE`);
      if (!inv) throw notFound('فاکتور');
      if (inv.status === 'cancelled') throw conflict('INVOICE_STATE', 'فاکتور قبلاً ابطال شده است');
      if (inv.status === 'approved') {
        if (!ctx.can('accounting.invoice.approve', 'company')) throw forbidden('ابطال فاکتور تأییدشده با مجوز تأیید فاکتور ممکن است');
        const moves = await rows<{ item_id: string; warehouse_id: string; qty: string; cost: string; name: string }>(tx, sql`SELECT m.item_id, m.warehouse_id, m.qty::text, m.cost::text, it.name FROM accounting_stock_moves m JOIN accounting_items it ON it.id = m.item_id WHERE m.source = 'invoice' AND m.source_id = ${id}`);
        for (const m of moves) {
          const q = -signedMilli(m.qty);
          const cost = -BigInt(m.cost);
          await move(tx, b, { itemId: m.item_id, warehouseId: m.warehouse_id, date, qtyMilli: q, cost: q > 0n ? cost : -cost, source: 'reversal', sourceId: id, description: `ابطال فاکتور ${inv.number}`, allowNegative: s.allowNegativeStock, itemName: m.name });
        }
        await reverseVoucher(tx, b, inv.voucher_id!, date, ctx.userId, 'ابطال فاکتور');
      }
      await tx.execute(sql`UPDATE accounting_invoices SET status = 'cancelled', updated_at = now() WHERE id = ${id}`);
      await ctx.audit({ action: 'accounting.invoice.cancelled', entityType: 'accounting_invoice', entityId: id }, tx);
      return { ok: true };
    }));
  },
};

// ---------------------------------------------------------------- VAT

/**
 * Seasonal VAT report (گزارش فصلی ارزش افزوده و معاملات فصلی): approved invoices of the Jalali quarter,
 * returns netted against their kind; payable = output VAT − input VAT.
 */
export function vatReport(ctx: ModuleRequestContext, q: z.infer<typeof vatQuery>) {
  const r = seasonRange(q.year, q.season);
  return withBooks(ctx, async (tx, b) => {
    const parties = await rows<{ side: string; detail_id: string; name: string; national_id: string; economic_code: string; postal_code: string; address: string; invoices: number; amount: string; vat: string }>(tx,
      sql`SELECT CASE WHEN i.kind IN ('sale', 'sale_return') THEN 'sale' ELSE 'purchase' END AS side, d.id AS detail_id, d.name, d.national_id, d.economic_code, d.postal_code, d.address,
          count(*)::int AS invoices,
          sum(CASE WHEN i.kind LIKE '%_return' THEN -(i.subtotal - i.discount) ELSE i.subtotal - i.discount END)::text AS amount,
          sum(CASE WHEN i.kind LIKE '%_return' THEN -i.vat ELSE i.vat END)::text AS vat
        FROM accounting_invoices i JOIN accounting_details d ON d.id = i.detail_id
        WHERE i.company_id = ${b.companyId} AND i.status = 'approved' AND i.date BETWEEN ${r.start}::date AND ${r.end}::date
        GROUP BY 1, d.id, d.name, d.national_id, d.economic_code, d.postal_code, d.address ORDER BY 1 DESC, d.name`);
    const sum = (side: string, k: 'amount' | 'vat') => parties.filter((p) => p.side === side).reduce((t, p) => t + BigInt(p[k]), 0n);
    const out = sum('sale', 'vat');
    const inp = sum('purchase', 'vat');
    return {
      year: q.year, season: q.season, from: r.start, to: r.end,
      sales: { amount: sum('sale', 'amount').toString(), vat: out.toString() },
      purchases: { amount: sum('purchase', 'amount').toString(), vat: inp.toString() },
      payable: (out - inp).toString(),
      parties,
    };
  });
}
