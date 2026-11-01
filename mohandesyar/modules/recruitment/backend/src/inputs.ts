import { z } from 'zod';
import { normalizeIranMobile } from '@mohandesyar/persian';
import { DEGREES, scoringSchema } from './scoring.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ معتبر نیست');
const text = (max: number) => z.string().trim().max(max, `حداکثر ${max} نویسه`);
const year = z.number().int().min(1300, 'سال شمسی معتبر نیست').max(1500, 'سال شمسی معتبر نیست').nullable().default(null);

export const educationInput = z.object({
  degree: z.enum([...DEGREES, 'other']),
  field: z.string().trim().min(2, 'رشته را وارد کنید').max(120),
  institution: text(160).default(''),
  endYear: year,
});
export const experienceInput = z
  .object({
    employer: z.string().trim().min(2, 'نام سازمان را وارد کنید').max(160),
    title: z.string().trim().min(2, 'عنوان شغل را وارد کنید').max(160),
    startedOn: isoDate,
    endedOn: isoDate.nullable().default(null),
    description: text(4000).default(''),
  })
  .refine((v) => !v.endedOn || v.endedOn >= v.startedOn, { message: 'پایان باید بعد از شروع باشد', path: ['endedOn'] });
export const projectInput = z.object({
  title: z.string().trim().min(2, 'عنوان پروژه را وارد کنید').max(200),
  role: text(120).default(''),
  client: text(160).default(''),
  year,
  description: text(4000).default(''),
});
export const skillInput = z.object({
  kind: z.enum(['skill', 'software', 'certificate', 'language']),
  name: z.string().trim().min(1, 'نام را وارد کنید').max(120),
  level: z.number().int().min(1).max(5).default(3),
  detail: text(300).default(''),
});

export const candidateInput = z
  .object({
    fullName: z.string().trim().min(2, 'نام و نام خانوادگی الزامی است').max(120),
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
    city: text(80).default(''),
    desiredPosition: text(160).default(''),
    expectedSalary: z.number().int().min(0).max(1e15).nullable().default(null),
    availableFrom: isoDate.nullable().default(null),
    referrer: text(160).default(''),
    source: z.enum(['manual', 'referral', 'website', 'job_board', 'university', 'other']).default('manual'),
    portfolioUrl: z.union([z.literal(''), z.url('نشانی نمونه‌کار معتبر نیست')]).default(''),
    summary: text(8000).default(''),
    consentOn: isoDate,
    consentNote: text(500).default(''),
    educations: z.array(educationInput).max(20).default([]),
    experiences: z.array(experienceInput).max(50).default([]),
    projects: z.array(projectInput).max(100).default([]),
    skills: z.array(skillInput).max(200).default([]),
  })
  .refine((v) => v.mobile || v.email, { message: 'دست‌کم یکی از شماره همراه یا ایمیل لازم است', path: ['mobile'] });

export const candidateQuery = z.object({
  q: text(200).optional(),
  status: z.enum(['active', 'hired', 'archived', 'all']).default('active'),
  skill: text(120).optional(),
  degree: z.enum(DEGREES).optional(),
  minYears: z.coerce.number().min(0).max(40).optional(),
  maxSalary: z.coerce.number().min(0).optional(),
  city: text(80).optional(),
  jobId: z.uuid().optional(),
});

export const fileInput = z.object({ fileId: z.uuid('فایل نامعتبر است'), kind: z.enum(['resume', 'portfolio', 'certificate', 'other']).default('resume') });
export const retentionInput = z.object({ consentOn: isoDate, consentNote: text(500).default('') });
export const statusInput = z.object({ status: z.enum(['active', 'archived']) });

export const jobInput = z.object({
  title: z.string().trim().min(2, 'عنوان موقعیت الزامی است').max(160),
  department: text(120).default(''),
  location: text(120).default(''),
  employment: z.enum(['full_time', 'part_time', 'contract', 'internship', 'project']).default('full_time'),
  openings: z.number().int().min(1).max(500).default(1),
  description: text(8000).default(''),
  status: z.enum(['open', 'on_hold', 'closed']).default('open'),
  interviewFormId: z.uuid().nullable().default(null),
});
export const scoringInput = z.object({ criteria: scoringSchema });

export const stageInput = z.object({
  stages: z
    .array(z.object({ id: z.uuid().nullable().default(null), name: z.string().trim().min(2, 'نام مرحله دست‌کم دو نویسه است').max(60), kind: z.enum(['open', 'hired', 'rejected']), archived: z.boolean().default(false) }))
    .min(3)
    .max(20)
    .refine((s) => s.some((x) => x.kind === 'hired' && !x.archived) && s.some((x) => x.kind === 'rejected' && !x.archived) && s.some((x) => x.kind === 'open' && !x.archived), {
      message: 'دست‌کم یک مرحله باز، یک مرحله «استخدام» و یک مرحله «رد» فعال لازم است',
    }),
});

export const formInput = z.object({
  name: z.string().trim().min(2, 'نام فرم الزامی است').max(120),
  criteria: z
    .array(z.object({ key: z.string().regex(/^[a-z0-9_]{1,40}$/), label: z.string().trim().min(2, 'عنوان معیار الزامی است').max(160), weight: z.number().int().min(1).max(10) }))
    .min(1, 'دست‌کم یک معیار لازم است')
    .max(30)
    .refine((c) => new Set(c.map((x) => x.key)).size === c.length, { message: 'کلید معیارها باید یکتا باشد' }),
  archived: z.boolean().default(false),
});

export const applyInput = z.object({ candidateIds: z.array(z.uuid()).min(1).max(100) });
export const moveInput = z.object({ stageId: z.uuid('مرحله را انتخاب کنید'), note: text(1000).default(''), rejectionReason: text(500).default('') });
export const interviewInput = z.object({
  formId: z.uuid('فرم ارزیابی را انتخاب کنید'),
  interviewerId: z.uuid('مصاحبه‌گر را انتخاب کنید'),
  date: isoDate,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'ساعت را به شکل ۰۹:۳۰ وارد کنید'),
  mode: z.enum(['in_person', 'online', 'phone']).default('in_person'),
});
export const evaluationInput = z.object({
  ratings: z.record(z.string(), z.number().int().min(1).max(5)),
  recommendation: z.enum(['strong_yes', 'yes', 'no', 'strong_no']),
  notes: text(8000).default(''),
});
export const mergeInput = z.object({ keepId: z.uuid() });
export const reportQuery = z.object({ from: isoDate, to: isoDate });
