import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ معتبر نیست');
const rial = z.union([z.string(), z.number()]).transform((v, c) => {
  const s = String(v).trim();
  if (!/^\d{1,19}$/.test(s)) {
    c.addIssue({ code: 'custom', message: 'مبلغ باید عدد صحیح ریالی باشد' });
    return z.NEVER;
  }
  return s;
});
const signedRial = z.union([z.string(), z.number()]).transform((v, c) => {
  const s = String(v).trim();
  if (!/^-?\d{1,19}$/.test(s)) {
    c.addIssue({ code: 'custom', message: 'مبلغ باید عدد صحیح ریالی باشد' });
    return z.NEVER;
  }
  return s;
});
const pct = z.union([z.string(), z.number()]).transform((v, c) => {
  const s = String(v).trim();
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(s) || Number(s) > 100) {
    c.addIssue({ code: 'custom', message: 'درصد باید بین ۰ تا ۱۰۰ باشد' });
    return z.NEVER;
  }
  return s;
});
const text = (max: number) => z.string().trim().max(max, `حداکثر ${max} نویسه`);

export const KINDS = ['employer', 'contractor', 'consulting', 'purchase', 'service', 'other'] as const;

export const contractInput = z
  .object({
    code: z.string().trim().min(1, 'شماره قرارداد الزامی است').max(40, 'شماره قرارداد حداکثر ۴۰ نویسه است'),
    title: z.string().trim().min(2, 'عنوان قرارداد الزامی است').max(200, 'عنوان حداکثر ۲۰۰ نویسه است'),
    kind: z.enum(KINDS, { message: 'نوع قرارداد را انتخاب کنید' }),
    direction: z.enum(['income', 'expense'], { message: 'جهت مالی قرارداد را انتخاب کنید' }),
    counterpartyName: z.string().trim().min(2, 'نام طرف قرارداد الزامی است').max(200),
    crmAccountId: z.uuid().nullable().default(null),
    projectId: z.uuid().nullable().default(null),
    ownerId: z.uuid().nullable().default(null),
    initialAmount: rial,
    prepaymentAmount: rial.default('0'),
    startOn: isoDate.nullable().default(null),
    endOn: isoDate.nullable().default(null),
    goodPerformancePct: pct.optional(),
    insurancePct: pct.optional(),
    taxPct: pct.optional(),
    vatPct: pct.optional(),
    prepaymentRecoveryPct: pct.default('0'),
    description: text(5000).default(''),
  })
  .refine((v) => !v.startOn || !v.endOn || v.endOn >= v.startOn, { message: 'تاریخ پایان نباید قبل از تاریخ شروع باشد', path: ['endOn'] })
  .refine((v) => BigInt(v.prepaymentAmount) <= BigInt(v.initialAmount), { message: 'پیش‌پرداخت نمی‌تواند از مبلغ قرارداد بیشتر باشد', path: ['prepaymentAmount'] });

/** Fields still editable after signing (amount and dates change only through amendments). */
export const activeContractUpdate = z.object({
  title: z.string().trim().min(2).max(200),
  counterpartyName: z.string().trim().min(2).max(200),
  crmAccountId: z.uuid().nullable(),
  projectId: z.uuid().nullable(),
  ownerId: z.uuid().nullable(),
  description: text(5000),
});

export const activateInput = z.object({ signedOn: isoDate });
export const closeInput = z.object({ status: z.enum(['completed', 'terminated']), note: text(1000).default('') });

export const amendmentInput = z
  .object({
    kind: z.enum(['amount', 'time', 'renewal', 'scope', 'other']),
    title: z.string().trim().min(2, 'عنوان الحاقیه الزامی است').max(200),
    amountDelta: signedRial.default('0'),
    newEndOn: isoDate.nullable().default(null),
    signedOn: isoDate,
    description: text(5000).default(''),
  })
  .refine((v) => (v.kind !== 'time' && v.kind !== 'renewal') || v.newEndOn, { message: 'برای تمدید یا تغییر مدت، تاریخ پایان جدید الزامی است', path: ['newEndOn'] })
  .refine((v) => v.kind !== 'amount' || v.amountDelta !== '0', { message: 'برای الحاقیه مبلغی، مبلغ تغییر را وارد کنید', path: ['amountDelta'] });

export const guaranteeInput = z.object({
  kind: z.enum(['bid', 'performance', 'prepayment', 'good_performance', 'other']),
  number: text(60).default(''),
  issuer: text(120).default(''),
  amount: rial.refine((v) => v !== '0', 'مبلغ ضمانت‌نامه الزامی است'),
  issuedOn: isoDate.nullable().default(null),
  expiresOn: isoDate.nullable().default(null),
});
export const guaranteeStatusInput = z.object({ status: z.enum(['active', 'released', 'seized', 'expired']), on: isoDate });

export const paymentTermInput = z
  .object({
    title: z.string().trim().min(2, 'عنوان الزامی است').max(200),
    amount: rial.nullable().default(null),
    percent: pct.nullable().default(null),
    dueOn: isoDate.nullable().default(null),
    condition: text(1000).default(''),
  })
  .refine((v) => v.amount !== null || v.percent !== null, { message: 'مبلغ یا درصد را وارد کنید', path: ['amount'] });

export const obligationInput = z.object({
  party: z.enum(['us', 'counterparty']),
  description: z.string().trim().min(2, 'شرح تعهد الزامی است').max(1000),
  dueOn: isoDate.nullable().default(null),
});
export const obligationDoneInput = z.object({ doneOn: isoDate.nullable() });

export const statementInput = z.object({
  periodFrom: isoDate.nullable().default(null),
  periodTo: isoDate,
  cumulativeGross: rial,
  otherDeductions: rial.default('0'),
  note: text(2000).default(''),
});

export const listQuery = z.object({
  status: z.enum(['draft', 'active', 'completed', 'terminated']).optional(),
  direction: z.enum(['income', 'expense']).optional(),
  q: z.string().trim().max(100).optional(),
  projectId: z.uuid().optional(),
});
