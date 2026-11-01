import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ معتبر نیست');
const text = (max: number) => z.string().trim().max(max, `حداکثر ${max} نویسه`);
const rial = z.union([z.string(), z.number()]).transform((v, c) => {
  const s = String(v).trim();
  if (!/^\d{1,19}$/.test(s)) {
    c.addIssue({ code: 'custom', message: 'مبلغ باید عدد صحیح ریالی باشد' });
    return z.NEVER;
  }
  return s;
});
const email = z.union([z.literal(''), z.email('ایمیل معتبر نیست')]).default('');

export const SOURCES = ['website', 'referral', 'tender', 'exhibition', 'call', 'social', 'existing_customer', 'other'] as const;

export const accountInput = z.object({
  kind: z.enum(['company', 'person']).default('company'),
  name: z.string().trim().min(2, 'نام الزامی است').max(200),
  nationalId: text(20).default(''),
  economicCode: text(20).default(''),
  industry: text(100).default(''),
  phone: text(40).default(''),
  email,
  city: text(60).default(''),
  address: text(500).default(''),
  source: text(60).default(''),
  notes: text(5000).default(''),
  ownerId: z.uuid().nullable().default(null),
});

export const contactInput = z.object({
  fullName: z.string().trim().min(2, 'نام مخاطب الزامی است').max(120),
  position: text(100).default(''),
  mobile: text(20).default(''),
  phone: text(40).default(''),
  email,
  notes: text(2000).default(''),
});

export const interactionInput = z
  .object({
    accountId: z.uuid().nullable().default(null),
    leadId: z.uuid().nullable().default(null),
    opportunityId: z.uuid().nullable().default(null),
    contactId: z.uuid().nullable().default(null),
    kind: z.enum(['call', 'meeting', 'visit', 'email', 'message', 'note']),
    occurredOn: isoDate,
    summary: z.string().trim().min(2, 'خلاصه ارتباط الزامی است').max(5000),
    nextContactOn: isoDate.nullable().default(null),
  })
  .refine((v) => v.accountId || v.leadId || v.opportunityId, { message: 'ارتباط باید به مشتری، سرنخ یا فرصت مربوط باشد', path: ['accountId'] });

export const leadInput = z.object({
  title: z.string().trim().min(2, 'عنوان سرنخ الزامی است').max(200),
  accountId: z.uuid().nullable().default(null),
  organizationName: text(200).default(''),
  contactName: text(120).default(''),
  mobile: text(20).default(''),
  email,
  source: z.enum(SOURCES, { message: 'منبع سرنخ را انتخاب کنید' }),
  need: text(5000).default(''),
  estimatedBudget: rial.nullable().default(null),
  score: z.coerce.number().int().min(0, 'امتیاز بین ۰ تا ۱۰۰').max(100, 'امتیاز بین ۰ تا ۱۰۰').default(0),
  ownerId: z.uuid().nullable().default(null),
  nextContactOn: isoDate.nullable().default(null),
  status: z.enum(['new', 'contacted', 'qualified']).default('new'),
});

export const leadLostInput = z.object({ reason: z.string().trim().min(2, 'دلیل از دست رفتن الزامی است').max(500) });

export const convertInput = z.object({
  accountId: z.uuid().nullable().default(null),
  opportunityTitle: z.string().trim().min(2).max(200).optional(),
  amount: rial.default('0'),
  expectedCloseOn: isoDate.nullable().default(null),
});

export const opportunityInput = z.object({
  title: z.string().trim().min(2, 'عنوان فرصت الزامی است').max(200),
  accountId: z.uuid('مشتری را انتخاب کنید'),
  contactId: z.uuid().nullable().default(null),
  stageId: z.uuid().optional(),
  amount: rial.default('0'),
  probability: z.coerce.number().int().min(0).max(100).nullable().default(null),
  expectedCloseOn: isoDate.nullable().default(null),
  ownerId: z.uuid().nullable().default(null),
  nextContactOn: isoDate.nullable().default(null),
  source: text(60).default(''),
  projectId: z.uuid().nullable().default(null),
  contractId: z.uuid().nullable().default(null),
});

export const moveInput = z.object({ stageId: z.uuid(), lostReason: text(500).default('') });

export const stageInput = z.object({
  name: z.string().trim().min(2, 'نام مرحله الزامی است').max(60),
  probability: z.coerce.number().int().min(0).max(100),
  kind: z.enum(['open', 'won', 'lost']).default('open'),
  sort: z.coerce.number().int().default(0),
});

export const proposalInput = z.object({
  title: z.string().trim().min(2, 'عنوان پیشنهاد الزامی است').max(200),
  kind: z.enum(['technical', 'financial', 'technical_financial']),
  amount: rial.nullable().default(null),
  validUntil: isoDate.nullable().default(null),
  content: text(20000).default(''),
});

export const proposalVersionInput = z.object({ amount: rial.nullable().default(null), validUntil: isoDate.nullable().default(null), content: text(20000).default('') });
export const proposalStatusInput = z.object({ status: z.enum(['sent', 'accepted', 'rejected']), on: isoDate });

export const reportQuery = z.object({ from: isoDate, to: isoDate }).refine((v) => v.from <= v.to, { message: 'بازه زمانی معتبر نیست', path: ['to'] });
