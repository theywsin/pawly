import { z } from 'zod';
import { toLatinDigits } from '@mohandesyar/persian';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ معتبر نیست');
const text = (max: number) => z.string().trim().max(max, `حداکثر ${max} نویسه`);
const optUuid = z.uuid().nullable().default(null);
const price = z
  .union([z.string(), z.number().int()])
  .transform((v) => toLatinDigits(String(v)).replace(/[,٬\s]/g, ''))
  .refine((v) => /^\d{1,18}$/.test(v), 'قیمت باید عدد صحیح ریالی باشد');
export const quantity = z
  .union([z.string(), z.number()])
  .transform((v) => toLatinDigits(String(v)).replace(/[,٬\s]/g, '').replace('٫', '.'))
  .refine((v) => /^\d{1,11}(\.\d{1,3})?$/.test(v) && Number(v) > 0, 'مقدار باید عددی بزرگ‌تر از صفر با حداکثر سه رقم اعشار باشد');
const quantityOrZero = z
  .union([z.string(), z.number()])
  .transform((v) => toLatinDigits(String(v)).replace(/[,٬\s]/g, '').replace('٫', '.') || '0')
  .refine((v) => /^\d{1,11}(\.\d{1,3})?$/.test(v), 'مقدار معتبر نیست');

export const supplierInput = z.object({
  name: z.string().trim().min(2, 'نام تأمین‌کننده الزامی است').max(160),
  nationalId: text(20).default(''),
  economicCode: text(20).default(''),
  phone: text(30).default(''),
  email: z.union([z.literal(''), z.email('ایمیل معتبر نیست')]).default(''),
  address: text(500).default(''),
  iban: z.string().trim().default('').transform((v, c) => {
    const s = toLatinDigits(v).replace(/[\s-]/g, '').toUpperCase();
    if (!s) return null;
    const full = /^\d{24}$/.test(s) ? `IR${s}` : s;
    if (!/^IR\d{24}$/.test(full)) c.addIssue({ code: 'custom', message: 'شماره شبا معتبر نیست' });
    return full;
  }),
  categoryIds: z.array(z.uuid()).max(50).default([]),
  status: z.enum(['active', 'blocked']).default('active'),
  blockReason: text(500).default(''),
  notes: text(2000).default(''),
}).refine((v) => v.status === 'active' || v.blockReason, { message: 'دلیل مسدودسازی را بنویسید', path: ['blockReason'] });
export const categoryInput = z.object({ name: z.string().trim().min(2, 'نام دسته الزامی است').max(120) });

const requestLine = z.object({
  description: z.string().trim().min(2, 'شرح کالا/خدمت الزامی است').max(300),
  unit: z.string().trim().min(1, 'واحد را وارد کنید').max(30),
  quantity,
  estimatedUnitPrice: price.nullable().default(null),
  categoryId: optUuid,
});
export const requestInput = z.object({
  title: z.string().trim().min(2, 'عنوان درخواست الزامی است').max(200),
  projectId: optUuid,
  contractId: optUuid,
  costCenter: text(60).default(''),
  neededBy: isoDate.nullable().default(null),
  justification: text(2000).default(''),
  lines: z.array(requestLine).min(1, 'دست‌کم یک ردیف لازم است').max(200),
});
export const requestQuery = z.object({ status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'closed']).optional(), projectId: z.uuid().optional() });

export const rfqInput = z.object({ requestId: z.uuid(), dueOn: isoDate, title: text(200).default('') });
export const quoteInput = z.object({
  supplierId: z.uuid('تأمین‌کننده را انتخاب کنید'),
  receivedOn: isoDate,
  validUntil: isoDate.nullable().default(null),
  deliveryDays: z.number().int().min(0).max(3650).nullable().default(null),
  paymentTerms: text(300).default(''),
  notes: text(1000).default(''),
  prices: z.array(z.object({ requestLineId: z.uuid(), unitPrice: price })).min(1, 'دست‌کم قیمت یک ردیف لازم است'),
});
export const awardInput = z.object({ quoteId: z.uuid(), reason: text(1000).default(''), expectedOn: isoDate, deliveryAddress: text(500).default('') });

const orderLine = z.object({
  description: z.string().trim().min(2, 'شرح الزامی است').max(300),
  unit: z.string().trim().min(1).max(30),
  quantity,
  unitPrice: price,
  requestLineId: optUuid,
  categoryId: optUuid,
});
export const orderInput = z
  .object({
    supplierId: z.uuid('تأمین‌کننده را انتخاب کنید'),
    requestId: optUuid,
    projectId: optUuid,
    contractId: optUuid,
    orderedOn: isoDate,
    expectedOn: isoDate,
    deliveryAddress: text(500).default(''),
    terms: text(2000).default(''),
    lines: z.array(orderLine).min(1, 'دست‌کم یک ردیف لازم است').max(200),
  })
  .refine((v) => v.expectedOn >= v.orderedOn, { message: 'تاریخ تحویل باید بعد از تاریخ سفارش باشد', path: ['expectedOn'] });
export const orderQuery = z.object({ status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'closed']).optional(), supplierId: z.uuid().optional(), late: z.enum(['1']).optional() });

export const receiptInput = z.object({
  receivedOn: isoDate,
  documentNo: text(60).default(''),
  notes: text(1000).default(''),
  lines: z.array(z.object({ orderLineId: z.uuid(), accepted: quantityOrZero, rejected: quantityOrZero.default('0'), note: text(300).default('') })).min(1),
});

export const invoiceInput = z
  .object({
    orderId: z.uuid(),
    number: z.string().trim().min(1, 'شماره فاکتور الزامی است').max(60),
    issuedOn: isoDate,
    dueOn: isoDate,
    amount: price.refine((v) => BigInt(v) > 0n, 'مبلغ فاکتور الزامی است'),
    lines: z.array(z.object({ orderLineId: z.uuid(), quantity, unitPrice: price })).min(1, 'دست‌کم یک ردیف لازم است'),
  })
  .refine((v) => v.dueOn >= v.issuedOn, { message: 'سررسید باید بعد از تاریخ فاکتور باشد', path: ['dueOn'] });
export const invoiceDecisionInput = z
  .object({ decision: z.enum(['approve', 'reject']), note: text(1000).default(''), overrideReason: text(1000).default('') })
  .refine((v) => v.decision === 'approve' || v.note, { message: 'دلیل رد را بنویسید', path: ['note'] });

export const ratingInput = z.object({ quality: z.number().int().min(1).max(5), delivery: z.number().int().min(1).max(5), price: z.number().int().min(1).max(5), comment: text(1000).default('') });
export const reportQuery = z.object({ from: isoDate, to: isoDate });
