/**
 * Quantities have three decimals; they are carried as bigint thousandths so that line amounts
 * (quantity × unit price, rounded to the rial) are exact.
 */
export function qty(v: string | number): bigint {
  const [i = '0', f = ''] = String(v).split('.');
  return BigInt(i) * 1000n + BigInt((f + '000').slice(0, 3));
}
export const qtyText = (q: bigint) => {
  const s = (q < 0n ? -q : q).toString().padStart(4, '0');
  const t = `${s.slice(0, -3)}.${s.slice(-3)}`.replace(/\.?0+$/, '');
  return (q < 0n ? '-' : '') + t;
};
/** Rounded half up to the rial. */
export const lineAmount = (quantity: string | number, unitPrice: string | number) => (qty(quantity) * BigInt(unitPrice) + 500n) / 1000n;

export interface MatchOrderLine {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  accepted: string; // accepted so far across receipts
  invoiced: string; // already invoiced on approved invoices
}
export interface MatchInvoiceLine {
  orderLineId: string;
  quantity: string;
  unitPrice: string;
}
export interface MatchIssue {
  orderLineId: string | null;
  kind: 'not_received' | 'over_order' | 'price' | 'unknown_line' | 'total';
  message: string;
}

/**
 * Three-way match: every invoiced quantity must already be accepted at the site (net of earlier invoices),
 * may not exceed the ordered quantity, and its price may not exceed the order price; the invoice total must
 * equal the sum of its lines. Returns the issues (empty = matched) and the computed total.
 */
export function threeWayMatch(order: MatchOrderLine[], lines: MatchInvoiceLine[], invoiceAmount: string): { ok: boolean; issues: MatchIssue[]; computed: string } {
  const issues: MatchIssue[] = [];
  let total = 0n;
  const fmt = (q: bigint) => Number(qtyText(q)).toLocaleString('fa-IR');
  for (const l of lines) {
    const o = order.find((x) => x.id === l.orderLineId);
    if (!o) {
      issues.push({ orderLineId: l.orderLineId, kind: 'unknown_line', message: 'ردیف فاکتور در سفارش وجود ندارد' });
      continue;
    }
    total += lineAmount(l.quantity, l.unitPrice);
    const q = qty(l.quantity);
    const receivable = qty(o.accepted) - qty(o.invoiced);
    const orderable = qty(o.quantity) - qty(o.invoiced);
    if (q > orderable) issues.push({ orderLineId: o.id, kind: 'over_order', message: `${o.description}: مقدار فاکتور (${fmt(q)}) بیش از مانده سفارش (${fmt(orderable)}) است` });
    else if (q > receivable) issues.push({ orderLineId: o.id, kind: 'not_received', message: `${o.description}: فقط ${fmt(receivable > 0n ? receivable : 0n)} تحویل و پذیرفته شده و فاکتور نشده است` });
    if (BigInt(l.unitPrice) > BigInt(o.unitPrice)) issues.push({ orderLineId: o.id, kind: 'price', message: `${o.description}: قیمت واحد فاکتور (${BigInt(l.unitPrice).toLocaleString('fa-IR')}) بیش از قیمت سفارش (${BigInt(o.unitPrice).toLocaleString('fa-IR')}) است` });
  }
  if (total !== BigInt(invoiceAmount)) issues.push({ orderLineId: null, kind: 'total', message: `مبلغ فاکتور (${BigInt(invoiceAmount).toLocaleString('fa-IR')}) با جمع ردیف‌ها (${total.toLocaleString('fa-IR')}) برابر نیست` });
  return { ok: issues.length === 0, issues, computed: total.toString() };
}

export interface QuoteRow {
  supplierId: string;
  supplierName: string;
  deliveryDays: number | null;
  prices: Record<string, string | null>; // request line id → unit price
}

/** Side-by-side comparison: total per quote (complete quotes only rank), lowest price per line. */
export function compareQuotes(lines: { id: string; quantity: string }[], quotes: QuoteRow[]) {
  const totals = quotes.map((q) => {
    const missing = lines.filter((l) => q.prices[l.id] === null || q.prices[l.id] === undefined).length;
    const total = lines.reduce((s, l) => (q.prices[l.id] ? s + lineAmount(l.quantity, q.prices[l.id]!) : s), 0n);
    return { supplierId: q.supplierId, supplierName: q.supplierName, deliveryDays: q.deliveryDays, total: total.toString(), complete: missing === 0, missing };
  });
  const ranked = totals.filter((t) => t.complete).sort((a, b) => (BigInt(a.total) < BigInt(b.total) ? -1 : BigInt(a.total) > BigInt(b.total) ? 1 : 0));
  const lowestPerLine = Object.fromEntries(
    lines.map((l) => {
      const offers = quotes.filter((q) => q.prices[l.id]).map((q) => ({ s: q.supplierId, p: BigInt(q.prices[l.id]!) }));
      const min = offers.reduce<bigint | null>((m, o) => (m === null || o.p < m ? o.p : m), null);
      return [l.id, offers.filter((o) => o.p === min).map((o) => o.s)];
    }),
  );
  return { totals, lowest: ranked[0]?.supplierId ?? null, lowestPerLine };
}
