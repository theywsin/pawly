import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ معتبر نیست');
const text = (max: number) => z.string().trim().max(max, `حداکثر ${max} نویسه`);
const rial = z.union([z.string(), z.number()]).transform((v, c) => {
  const s = String(v).trim();
  if (!/^-?\d{1,19}$/.test(s)) {
    c.addIssue({ code: 'custom', message: 'مبلغ باید عدد صحیح ریالی باشد' });
    return z.NEVER;
  }
  return s;
});

export const PROJECT_TYPES = ['building', 'infrastructure', 'industrial', 'road', 'water', 'energy', 'consulting', 'other'] as const;
export const STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled'] as const;

export const projectInput = z
  .object({
    code: z.string().trim().min(1, 'کد پروژه الزامی است').max(40),
    title: z.string().trim().min(2, 'عنوان پروژه الزامی است').max(200),
    projectType: z.enum(PROJECT_TYPES).default('building'),
    employerName: text(200).default(''),
    crmAccountId: z.uuid().nullable().default(null),
    contractId: z.uuid().nullable().default(null),
    managerId: z.uuid().nullable().default(null),
    province: text(60).default(''),
    city: text(60).default(''),
    location: text(500).default(''),
    specs: text(5000).default(''),
    description: text(5000).default(''),
    plannedStart: isoDate.nullable().default(null),
    plannedFinish: isoDate.nullable().default(null),
    budgetAmount: rial.nullable().default(null),
    status: z.enum(STATUSES).default('planning'),
  })
  .refine((v) => !v.plannedStart || !v.plannedFinish || v.plannedFinish >= v.plannedStart, { message: 'تاریخ پایان نباید قبل از تاریخ شروع باشد', path: ['plannedFinish'] })
  .refine((v) => v.budgetAmount === null || !v.budgetAmount.startsWith('-'), { message: 'بودجه نمی‌تواند منفی باشد', path: ['budgetAmount'] });

export const memberInput = z.object({ userId: z.uuid('کاربر را انتخاب کنید'), role: z.enum(['manager', 'engineer', 'supervisor', 'site', 'member']).default('member') });

export const activityInput = z.object({
  name: z.string().trim().min(1, 'نام فعالیت الزامی است').max(200),
  parentId: z.uuid().nullable().default(null),
  durationDays: z.coerce.number({ message: 'مدت باید عدد باشد' }).int('مدت باید عدد صحیح روز باشد').min(0).max(3650),
  weight: z.coerce.number({ message: 'وزن باید عدد باشد' }).min(0).max(100000).default(1),
  assigneeId: z.uuid().nullable().default(null),
  sort: z.coerce.number().int().optional(),
});

export const dependencyInput = z.object({
  predecessorId: z.uuid('فعالیت پیش‌نیاز را انتخاب کنید'),
  successorId: z.uuid(),
  type: z.enum(['FS', 'SS', 'FF', 'SF']).default('FS'),
  lagDays: z.coerce.number().int().min(-3650).max(3650).default(0),
});

export const progressInput = z.object({
  date: isoDate,
  percent: z.coerce.number({ message: 'درصد باید عدد باشد' }).min(0, 'درصد بین ۰ تا ۱۰۰ است').max(100, 'درصد بین ۰ تا ۱۰۰ است'),
  note: text(1000).default(''),
});

export const phaseInput = z.object({
  kind: z.enum(['phase', 'temporary_handover', 'final_handover']).default('phase'),
  name: z.string().trim().min(2, 'نام مرحله الزامی است').max(200),
  plannedDate: isoDate.nullable().default(null),
  notes: text(2000).default(''),
});
export const phaseStatusInput = z.object({ deliveredOn: isoDate.nullable(), clientApprovedOn: isoDate.nullable() }).refine((v) => !v.clientApprovedOn || v.deliveredOn, { message: 'تأیید کارفرما پس از ثبت تحویل ممکن است', path: ['clientApprovedOn'] });

export const issueInput = z.object({
  kind: z.enum(['delay', 'obstacle', 'issue']),
  title: z.string().trim().min(2, 'عنوان الزامی است').max(200),
  description: text(5000).default(''),
  cause: text(2000).default(''),
  impactDays: z.coerce.number().int().min(0).max(3650).default(0),
  ownerId: z.uuid().nullable().default(null),
  dueOn: isoDate.nullable().default(null),
});

export const riskInput = z.object({
  title: z.string().trim().min(2, 'عنوان ریسک الزامی است').max(200),
  probability: z.coerce.number().int().min(1, 'احتمال بین ۱ تا ۵').max(5, 'احتمال بین ۱ تا ۵'),
  impact: z.coerce.number().int().min(1, 'اثر بین ۱ تا ۵').max(5, 'اثر بین ۱ تا ۵'),
  response: text(2000).default(''),
  ownerId: z.uuid().nullable().default(null),
});

export const dailyReportInput = z.object({
  reportDate: isoDate,
  weather: text(100).default(''),
  workforce: z.coerce.number().int().min(0).max(100000).default(0),
  equipment: text(2000).default(''),
  workDone: z.string().trim().min(2, 'شرح کارهای انجام‌شده الزامی است').max(10000),
  problems: text(5000).default(''),
});

export const changeRequestInput = z.object({
  title: z.string().trim().min(2, 'عنوان الزامی است').max(200),
  description: text(5000).default(''),
  costImpact: rial.default('0'),
  timeImpactDays: z.coerce.number().int().min(-3650).max(3650).default(0),
});

export const listQuery = z.object({ status: z.enum(STATUSES).optional(), q: z.string().trim().max(100).optional() });
