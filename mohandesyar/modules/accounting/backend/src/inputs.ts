import { z } from 'zod';
import { toLatinDigits } from '@mohandesyar/persian';

const date = z.iso.date({ message: 'تاریخ معتبر نیست' });
const text = (max: number) => z.string().trim().max(max, `حداکثر ${max} نویسه`).default('');
const latin = (v: unknown) => toLatinDigits(String(v ?? '')).replace(/[,٬\s]/g, '');
/** Rial amounts travel as digit strings (numeric(20,0)); never floats. */
export const amount = z.union([z.string(), z.number().int()]).transform(latin).refine((v) => /^\d{1,18}$/.test(v) && BigInt(v) > 0n, 'مبلغ باید عددی بزرگ‌تر از صفر باشد (ریال)');
export const amountOrZero = z.union([z.string(), z.number().int()]).default('0').transform((v) => latin(v) || '0').refine((v) => /^\d{1,18}$/.test(v), 'مبلغ معتبر نیست');
export const qty = z.union([z.string(), z.number()]).transform((v) => latin(v)).refine((v) => /^\d{1,12}(\.\d{1,3})?$/.test(v) && Number(v) > 0, 'مقدار باید عدد مثبت با حداکثر سه رقم اعشار باشد');
const uuid = z.uuid('انتخاب معتبر نیست');
const optUuid = z.uuid().nullable().default(null);

// ---------------------------------------------------------------- setup

export const accountInput = z.object({
  parentId: uuid,
  code: z.string().trim().regex(/^\d{1,8}$/, 'کد حساب فقط رقم (حداکثر ۸)'),
  name: z.string().trim().min(2, 'نام حساب را بنویسید').max(200),
  needsDetail: z.boolean().default(false),
});
export const accountUpdate = z.object({ name: z.string().trim().min(2, 'نام حساب را بنویسید').max(200), needsDetail: z.boolean(), active: z.boolean() });

export const detailInput = z.object({
  code: z.string().trim().regex(/^\d{1,10}$/, 'کد تفصیلی فقط رقم (حداکثر ۱۰)').optional(),
  name: z.string().trim().min(2, 'نام را بنویسید').max(200),
  kind: z.enum(['person', 'company', 'project', 'cost_center', 'bank', 'cash', 'employee', 'other']),
  nationalId: z.string().trim().regex(/^(\d{10}|\d{11})?$/, 'شناسه/کد ملی ۱۰ یا ۱۱ رقم').default(''),
  economicCode: z.string().trim().regex(/^(\d{12}|\d{14})?$/, 'کد اقتصادی ۱۲ یا ۱۴ رقم').default(''),
  postalCode: z.string().trim().regex(/^(\d{10})?$/, 'کد پستی ۱۰ رقم').default(''),
  address: text(500),
  phone: text(30),
  active: z.boolean().default(true),
});

export const fiscalYearInput = z
  .object({ title: z.string().trim().min(2, 'عنوان را بنویسید').max(100), startOn: date, endOn: date })
  .refine((f) => f.endOn > f.startOn, { path: ['endOn'], message: 'پایان سال باید بعد از شروع باشد' });

// ---------------------------------------------------------------- vouchers

export const voucherLine = z
  .object({
    accountId: uuid,
    detailId: optUuid,
    description: text(500),
    debit: amountOrZero,
    credit: amountOrZero,
  })
  .refine((l) => (BigInt(l.debit) > 0n) !== (BigInt(l.credit) > 0n), { path: ['debit'], message: 'هر ردیف فقط بدهکار یا فقط بستانکار است' });

export const voucherInput = z.object({
  date,
  description: text(1000),
  lines: z.array(voucherLine).min(2, 'سند دست‌کم دو ردیف دارد').max(500),
});

export const voucherQuery = z.object({
  from: date.optional(),
  to: date.optional(),
  status: z.enum(['draft', 'posted', 'reversed']).optional(),
  source: z.string().max(30).optional(),
  q: z.string().max(100).optional(),
});

// ---------------------------------------------------------------- treasury

export const treasuryAccountInput = z.object({
  kind: z.enum(['cash', 'bank']),
  name: z.string().trim().min(2, 'نام را بنویسید').max(200),
  bankName: text(100),
  accountNo: text(40),
  iban: z.string().trim().transform((v) => toLatinDigits(v).replace(/[\s-]/g, '').toUpperCase()).refine((v) => v === '' || /^IR\d{24}$/.test(v), 'شبا با IR و ۲۴ رقم').default(''),
});

const cheque = z.object({
  number: z.string().trim().min(1, 'شماره چک').max(30),
  sayadId: z.string().trim().transform((v) => toLatinDigits(v)).refine((v) => v === '' || /^\d{16}$/.test(v), 'شناسه صیاد ۱۶ رقم است').default(''),
  bankName: text(100),
  dueOn: date,
});

export const treasuryDocInput = z
  .object({
    kind: z.enum(['receipt', 'payment']),
    date,
    detailId: uuid,
    // counter side: default receivable for receipts and payable for payments
    counterAccountId: optUuid,
    method: z.enum(['cash', 'transfer', 'cheque']),
    treasuryId: optUuid,
    amount,
    description: text(500),
    reference: text(100),
    cheque: cheque.nullable().default(null),
  })
  .refine((d) => d.method !== 'cheque' || d.cheque !== null, { path: ['cheque'], message: 'مشخصات چک را وارد کنید' })
  .refine((d) => d.method === 'cheque' || d.treasuryId !== null, { path: ['treasuryId'], message: 'صندوق یا حساب بانکی را انتخاب کنید' })
  .refine((d) => !(d.kind === 'payment' && d.method === 'cheque' && d.treasuryId === null), { path: ['treasuryId'], message: 'حساب بانکی صادرکننده چک را انتخاب کنید' });

export const transferInput = z
  .object({ date, fromId: uuid, toId: uuid, amount, description: text(500), reference: text(100) })
  .refine((t) => t.fromId !== t.toId, { path: ['toId'], message: 'مبدأ و مقصد یکی است' });

export const chequeAction = z.object({
  action: z.enum(['deposit', 'clear', 'bounce', 'return']),
  date,
  treasuryId: optUuid,
  note: text(500),
});

// ---------------------------------------------------------------- items, inventory, invoices

export const itemInput = z.object({
  code: z.string().trim().min(1, 'کد کالا').max(30),
  name: z.string().trim().min(2, 'نام کالا یا خدمت').max(200),
  kind: z.enum(['goods', 'service']),
  unit: z.string().trim().min(1).max(20).default('عدد'),
  salePrice: amountOrZero,
  vatExempt: z.boolean().default(false),
  expenseAccountId: optUuid,
  active: z.boolean().default(true),
});

export const warehouseInput = z.object({ name: z.string().trim().min(2, 'نام انبار').max(100) });

export const adjustmentInput = z.object({
  date,
  warehouseId: uuid,
  kind: z.enum(['opening', 'gain', 'loss']),
  description: text(500),
  lines: z
    .array(z.object({ itemId: uuid, qty, unitCost: amountOrZero }))
    .min(1, 'دست‌کم یک ردیف')
    .max(300),
});

export const invoiceLine = z.object({
  itemId: uuid,
  description: text(300),
  qty,
  unitPrice: amountOrZero,
  discount: amountOrZero,
  vatRate: z.number().min(0).max(100).multipleOf(0.01).nullable().default(null),
});

export const invoiceInput = z.object({
  kind: z.enum(['sale', 'purchase', 'sale_return', 'purchase_return']),
  date,
  detailId: uuid,
  warehouseId: optUuid,
  reference: text(100),
  description: text(1000),
  lines: z.array(invoiceLine).min(1, 'دست‌کم یک ردیف کالا یا خدمت').max(300),
});

export const invoiceQuery = z.object({ kind: z.enum(['sale', 'purchase', 'sale_return', 'purchase_return']).optional(), status: z.enum(['draft', 'approved', 'cancelled']).optional(), from: date.optional(), to: date.optional() });

// ---------------------------------------------------------------- fixed assets

export const assetInput = z
  .object({
    code: z.string().trim().min(1, 'کد دارایی').max(30),
    name: z.string().trim().min(2, 'نام دارایی').max(200),
    category: text(100),
    acquiredOn: date,
    cost: amount,
    salvage: amountOrZero,
    method: z.enum(['straight_line', 'declining']),
    usefulLifeMonths: z.number().int().min(1).max(1200).nullable().default(null),
    ratePercent: z.number().positive().max(100).multipleOf(0.01).nullable().default(null),
    openingDepreciation: amountOrZero,
    assetAccountId: optUuid,
    depreciationAccountId: optUuid,
    expenseAccountId: optUuid,
    // when set, the purchase is booked now: Dr asset / Cr this account (with detail)
    paidFromAccountId: optUuid,
    paidFromDetailId: optUuid,
  })
  .refine((a) => a.method !== 'straight_line' || a.usefulLifeMonths !== null, { path: ['usefulLifeMonths'], message: 'عمر مفید (ماه) را وارد کنید' })
  .refine((a) => a.method !== 'declining' || a.ratePercent !== null, { path: ['ratePercent'], message: 'نرخ استهلاک سالانه را وارد کنید' })
  .refine((a) => BigInt(a.salvage) + BigInt(a.openingDepreciation) <= BigInt(a.cost), { path: ['salvage'], message: 'ارزش اسقاط و استهلاک قبلی از بهای تمام‌شده بیشتر است' });

export const depreciationInput = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'دوره به شکل ۱۴۰۵-۰۷') });

export const disposalInput = z.object({
  date,
  proceeds: amountOrZero,
  // where the proceeds go (cash, bank or receivable), with its detail
  accountId: optUuid,
  detailId: optUuid,
  note: text(500),
});

// ---------------------------------------------------------------- reports

export const rangeQuery = z.object({ from: date, to: date }).refine((r) => r.from <= r.to, { path: ['to'], message: 'پایان بازه پیش از شروع است' });
export const trialQuery = z.object({ from: date, to: date, level: z.enum(['group', 'ledger', 'subsidiary', 'detail']).default('subsidiary') });
export const ledgerQuery = z.object({ from: date, to: date, accountId: uuid.optional(), detailId: uuid.optional() }).refine((q) => q.accountId || q.detailId, { path: ['accountId'], message: 'حساب یا تفصیلی را انتخاب کنید' });
export const vatQuery = z.object({ year: z.coerce.number().int().min(1390).max(1500), season: z.coerce.number().int().min(1).max(4) });
