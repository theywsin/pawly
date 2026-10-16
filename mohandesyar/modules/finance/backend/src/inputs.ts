import { z } from 'zod';
import { toLatinDigits } from '@mohandesyar/persian';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ معتبر نیست');
const text = (max: number) => z.string().trim().max(max, `حداکثر ${max} نویسه`);
/** Rial amounts travel as digit strings (numeric(20,0)); never floats. */
export const amount = z
  .union([z.string(), z.number().int()])
  .transform((v) => toLatinDigits(String(v)).replace(/[,٬\s]/g, ''))
  .refine((v) => /^\d{1,18}$/.test(v) && BigInt(v) > 0n, 'مبلغ باید عددی بزرگ‌تر از صفر باشد (ریال)');
const amountOrZero = z
  .union([z.string(), z.number().int()])
  .transform((v) => toLatinDigits(String(v)).replace(/[,٬\s]/g, '') || '0')
  .refine((v) => /^\d{1,18}$/.test(v), 'مبلغ معتبر نیست');
const optUuid = z.uuid().nullable().default(null);

/** Iranian IBAN (شبا): IR + 24 digits with a valid ISO 13616 mod-97 check. */
export function isValidIban(v: string): boolean {
  if (!/^IR\d{24}$/.test(v)) return false;
  const re = `${v.slice(4)}1827${v.slice(2, 4)}`; // I=18, R=27
  let r = 0;
  for (const ch of re) r = (r * 10 + Number(ch)) % 97;
  return r === 1;
}
const iban = z
  .string()
  .trim()
  .default('')
  .transform((v, c) => {
    const s = toLatinDigits(v).replace(/[\s-]/g, '').toUpperCase();
    if (!s) return null;
    const full = /^\d{24}$/.test(s) ? `IR${s}` : s;
    if (!isValidIban(full)) c.addIssue({ code: 'custom', message: 'شماره شبا معتبر نیست' });
    return full;
  });

export const accountInput = z.object({
  kind: z.enum(['bank', 'petty_cash', 'cash']),
  name: z.string().trim().min(2, 'نام حساب الزامی است').max(120),
  bankName: text(120).default(''),
  number: text(40).default(''),
  iban,
  custodianId: optUuid,
  openingBalance: amountOrZero.default('0'),
  openingOn: isoDate,
  archived: z.boolean().default(false),
});
export const categoryInput = z.object({ kind: z.enum(['income', 'expense']), name: z.string().trim().min(2, 'نام سرفصل الزامی است').max(120), parentId: optUuid, archived: z.boolean().default(false) });
export const costCenterInput = z.object({ code: z.string().trim().min(1, 'کد الزامی است').max(30), name: z.string().trim().min(2, 'نام الزامی است').max(120), archived: z.boolean().default(false) });
export const counterpartyInput = z.object({
  kind: z.enum(['person', 'company']).default('company'),
  name: z.string().trim().min(2, 'نام طرف‌حساب الزامی است').max(160),
  nationalId: text(20).default(''),
  phone: text(30).default(''),
  iban,
  notes: text(2000).default(''),
  archived: z.boolean().default(false),
});

const links = { projectId: optUuid, contractId: optUuid, costCenterId: optUuid };

export const receiptInput = z.object({
  accountId: z.uuid('حساب را انتخاب کنید'),
  amount,
  occurredOn: isoDate,
  counterpartyId: optUuid,
  categoryId: z.uuid('سرفصل درآمد را انتخاب کنید'),
  obligationId: optUuid,
  description: text(1000).default(''),
  reference: text(100).default(''),
  ...links,
});
export const transferInput = z
  .object({ fromAccountId: z.uuid('حساب مبدأ را انتخاب کنید'), toAccountId: z.uuid('حساب مقصد را انتخاب کنید'), amount, occurredOn: isoDate, description: text(1000).default(''), reference: text(100).default('') })
  .refine((v) => v.fromAccountId !== v.toAccountId, { message: 'حساب مبدأ و مقصد نباید یکی باشند', path: ['toAccountId'] });
export const voidInput = z.object({ reason: z.string().trim().min(3, 'دلیل ابطال را بنویسید').max(500), occurredOn: isoDate });
export const txQuery = z.object({ accountId: z.uuid().optional(), from: isoDate.optional(), to: isoDate.optional(), type: z.enum(['receipt', 'payment', 'transfer']).optional(), projectId: z.uuid().optional() });

export const paymentRequestInput = z.object({
  counterpartyId: z.uuid('ذی‌نفع را انتخاب کنید'),
  amount,
  dueOn: isoDate,
  description: z.string().trim().min(2, 'شرح پرداخت الزامی است').max(1000),
  categoryId: z.uuid('سرفصل هزینه را انتخاب کنید'),
  obligationId: optUuid,
  commitmentId: optUuid,
  ...links,
});
export const executeInput = z.object({
  method: z.enum(['transfer', 'cash', 'cheque']),
  accountId: z.uuid('حساب پرداخت را انتخاب کنید'),
  occurredOn: isoDate,
  bankReference: text(100).default(''),
  chequeNumber: text(40).default(''),
  chequeDueOn: isoDate.nullable().default(null),
}).refine((v) => v.method !== 'cheque' || (v.chequeNumber && v.chequeDueOn), { message: 'شماره و تاریخ چک لازم است', path: ['chequeNumber'] })
  .refine((v) => v.method !== 'transfer' || v.bankReference, { message: 'شماره پیگیری بانکی را وارد کنید', path: ['bankReference'] });
export const prQuery = z.object({ status: z.enum(['requested', 'approved', 'rejected', 'cancelled', 'executed']).optional(), mine: z.enum(['1']).optional() });

export const obligationInput = z
  .object({
    kind: z.enum(['receivable', 'payable']),
    counterpartyId: z.uuid('طرف‌حساب را انتخاب کنید'),
    amount,
    issuedOn: isoDate,
    dueOn: isoDate,
    description: z.string().trim().min(2, 'شرح الزامی است').max(500),
    reference: text(100).default(''),
    projectId: optUuid,
    contractId: optUuid,
  })
  .refine((v) => v.dueOn >= v.issuedOn, { message: 'سررسید باید بعد از تاریخ صدور باشد', path: ['dueOn'] });
export const obligationQuery = z.object({ kind: z.enum(['receivable', 'payable']).optional(), state: z.enum(['open', 'overdue', 'settled', 'cancelled']).optional() });

export const chequeInput = z.object({
  number: z.string().trim().min(1, 'شماره چک الزامی است').max(40),
  bankName: text(120).default(''),
  amount,
  dueOn: isoDate,
  counterpartyId: z.uuid('صادرکننده را انتخاب کنید'),
  obligationId: optUuid,
  categoryId: z.uuid('سرفصل درآمد را انتخاب کنید'),
  projectId: optUuid,
});
export const chequeActionInput = z
  .object({ action: z.enum(['clear', 'bounce', 'cancel']), accountId: optUuid, occurredOn: isoDate, note: text(500).default('') })
  .refine((v) => v.action !== 'clear' || v.accountId, { message: 'حساب واریز/برداشت را انتخاب کنید', path: ['accountId'] });

export const budgetInput = z.object({
  note: text(1000).default(''),
  lines: z.array(z.object({ categoryId: z.uuid(), amount: amountOrZero, note: text(300).default('') })).min(1, 'دست‌کم یک سرفصل لازم است').max(200)
    .refine((l) => new Set(l.map((x) => x.categoryId)).size === l.length, { message: 'هر سرفصل یک بار' }),
});
export const commitmentInput = z.object({ projectId: optUuid, categoryId: optUuid, counterpartyId: optUuid, amount, description: z.string().trim().min(2, 'شرح الزامی است').max(500) });
export const eacMethodInput = z.object({ method: z.enum(['cpi', 'budget_rate', 'manual_etc']) });
export const etcInput = z.object({ amount: amountOrZero, note: text(1000).default('') });
export const noteInput = z.object({ note: z.string().trim().min(2, 'متن را بنویسید').max(2000) });

export const forecastInput = z.object({ direction: z.enum(['in', 'out']), amount, expectedOn: isoDate, description: z.string().trim().min(2, 'شرح الزامی است').max(500), projectId: optUuid });
export const cashflowQuery = z.object({ from: isoDate, months: z.coerce.number().int().min(1).max(24).default(6) });

/** Statement lines as CSV text: date (Jalali or ISO), amount (+ deposit / − withdrawal), reference, description. */
export const statementInput = z.object({ accountId: z.uuid('حساب را انتخاب کنید'), csv: z.string().min(3, 'محتوای صورت‌حساب خالی است').max(2_000_000) });
export const matchInput = z.object({ transactionId: z.uuid().nullable() });
export const reportQuery = z.object({ from: isoDate, to: isoDate, projectId: z.uuid().optional() });
