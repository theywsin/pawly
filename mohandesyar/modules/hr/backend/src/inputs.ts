import { z } from 'zod';
import { isValidNationalId, normalizeIranMobile, toLatinDigits } from '@mohandesyar/persian';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ معتبر نیست');
const text = (max: number) => z.string().trim().max(max, `حداکثر ${max} نویسه`);

export const skillInput = z.object({ kind: z.enum(['skill', 'software', 'certificate', 'language']), name: z.string().trim().min(1, 'نام را وارد کنید').max(120), level: z.number().int().min(1).max(5).default(3) });
export const recordInput = z.object({
  kind: z.enum(['hire', 'promotion', 'transfer', 'commendation', 'warning', 'education', 'prior_experience', 'other']),
  occurredOn: isoDate.nullable().default(null),
  title: z.string().trim().min(2, 'عنوان را وارد کنید').max(200),
  notes: text(4000).default(''),
});

export const employeeInput = z.object({
  personnelNo: z.string().trim().min(1, 'شماره پرسنلی الزامی است').max(30).transform(toLatinDigits),
  fullName: z.string().trim().min(2, 'نام و نام خانوادگی الزامی است').max(120),
  nationalId: z
    .string()
    .trim()
    .default('')
    .transform((v, c) => {
      if (!v) return null;
      const d = toLatinDigits(v);
      if (!isValidNationalId(d)) c.addIssue({ code: 'custom', message: 'کد ملی معتبر نیست' });
      return d;
    }),
  mobile: z
    .string()
    .trim()
    .default('')
    .transform((v, c) => {
      if (!v) return null;
      const m = normalizeIranMobile(v);
      if (!m) c.addIssue({ code: 'custom', message: 'شماره همراه معتبر نیست' });
      return m;
    }),
  email: z.union([z.literal(''), z.email('ایمیل معتبر نیست')]).default('').transform((v) => (v ? v.toLowerCase() : null)),
  userId: z.uuid().nullable().default(null),
  managerUserId: z.uuid().nullable().default(null),
  department: text(120).default(''),
  position: text(120).default(''),
  hiredOn: isoDate,
  notes: text(4000).default(''),
  /** Set only by the field-by-field transfer from recruitment; the selected items come with it. */
  recruitmentCandidateId: z.uuid().nullable().default(null),
  skills: z.array(skillInput).max(200).default([]),
  records: z.array(recordInput).max(100).default([]),
});

export const endInput = z.object({ endedOn: isoDate, reason: text(500).default('') });

export const contractInput = z
  .object({
    kind: z.enum(['permanent', 'fixed_term', 'project', 'hourly', 'internship']),
    startsOn: isoDate,
    endsOn: isoDate.nullable().default(null),
    monthlySalary: z.number().int().min(0).max(1e15).nullable().default(null),
    weeklyHours: z.number().min(1).max(80).nullable().default(44),
    notes: text(4000).default(''),
  })
  .refine((v) => !v.endsOn || v.endsOn >= v.startsOn, { message: 'پایان باید بعد از شروع باشد', path: ['endsOn'] })
  .refine((v) => v.kind === 'permanent' || v.endsOn, { message: 'برای قرارداد غیر دائم تاریخ پایان لازم است', path: ['endsOn'] });

export const trainingInput = z.object({
  title: z.string().trim().min(2, 'عنوان آموزش را وارد کنید').max(200),
  provider: text(160).default(''),
  completedOn: isoDate,
  hours: z.number().positive('ساعت آموزش باید بیشتر از صفر باشد').max(2000),
  certificate: text(200).default(''),
});
export const skillsInput = z.object({ skills: z.array(skillInput).max(200) });

export const leaveTypesInput = z.object({
  types: z
    .array(z.object({ id: z.uuid().nullable().default(null), name: z.string().trim().min(2, 'نام نوع مرخصی را وارد کنید').max(60), annualDays: z.number().min(0).max(366).nullable(), paid: z.boolean(), archived: z.boolean().default(false) }))
    .min(1)
    .max(20),
});
export const leaveInput = z
  .object({ employeeId: z.uuid().nullable().default(null), typeId: z.uuid('نوع مرخصی را انتخاب کنید'), startsOn: isoDate, endsOn: isoDate, reason: text(1000).default('') })
  .refine((v) => v.endsOn >= v.startsOn, { message: 'پایان مرخصی باید بعد از شروع آن باشد', path: ['endsOn'] });
export const leaveQuery = z.object({ status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(), employeeId: z.uuid().optional(), mine: z.enum(['1']).optional() });

export const reviewInput = z.object({
  employeeId: z.uuid(),
  period: z.string().trim().min(2, 'دوره ارزیابی را وارد کنید').max(60),
  criteria: z.array(z.object({ label: z.string().trim().min(2, 'عنوان معیار را وارد کنید').max(160), weight: z.number().int().min(1).max(10), score: z.number().int().min(1).max(5) })).min(1, 'دست‌کم یک معیار لازم است').max(30),
  strengths: text(4000).default(''),
  improvements: text(4000).default(''),
});
export const listQuery = z.object({ status: z.enum(['active', 'left', 'all']).default('active'), q: text(100).optional(), department: text(120).optional() });
