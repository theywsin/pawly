import { z } from 'zod';

const date = z.iso.date({ message: 'تاریخ معتبر نیست' });
const time = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'ساعت را به شکل ۰۸:۰۰ وارد کنید');
const priority = z.enum(['low', 'normal', 'high']).default('normal');

export const taskInput = z.object({
  title: z.string().trim().min(2, 'عنوان کار را بنویسید').max(200),
  description: z.string().trim().max(5000).default(''),
  assigneeIds: z.array(z.uuid()).min(1, 'دست‌کم یک نفر را انتخاب کنید').max(100),
  dueDate: date,
  dueTime: time,
  priority,
});

export const dutyInput = z
  .object({
    title: z.string().trim().min(2, 'عنوان وظیفه را بنویسید').max(200),
    description: z.string().trim().max(5000).default(''),
    assigneeId: z.uuid('کارمند را انتخاب کنید'),
    recurrence: z.enum(['daily', 'weekly', 'monthly']),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    monthDay: z.number().int().min(1).max(31).nullable().default(null),
    dueTime: time,
    priority,
    skipDaysOff: z.boolean().default(true),
  })
  .refine((d) => d.recurrence !== 'weekly' || d.weekdays.length > 0, { path: ['weekdays'], message: 'روزهای هفته را انتخاب کنید' })
  .refine((d) => d.recurrence !== 'monthly' || d.monthDay !== null, { path: ['monthDay'], message: 'روز ماه را وارد کنید' });

export const doneInput = z.object({ note: z.string().trim().max(2000).default('') });

export const reviewInput = z
  .object({
    decision: z.enum(['approve', 'return']),
    score: z.number().int().min(1).max(5).nullable().default(null),
    note: z.string().trim().max(2000).default(''),
  })
  .refine((r) => r.decision !== 'approve' || r.score !== null, { path: ['score'], message: 'برای تأیید، نمره ۱ تا ۵ بدهید' })
  .refine((r) => r.decision !== 'return' || r.note.length > 0, { path: ['note'], message: 'دلیل برگشت را بنویسید' });

export const reportInput = z.object({
  body: z.string().trim().min(5, 'گزارش کار را بنویسید').max(10_000),
  hours: z.number().positive().max(24).multipleOf(0.5, 'ساعت را با گام نیم ساعت وارد کنید').nullable().default(null),
});

export const scoreInput = z.object({ score: z.number().int().min(1, 'نمره ۱ تا ۵').max(5, 'نمره ۱ تا ۵'), note: z.string().trim().max(2000).default('') });

export const attendanceInput = z.object({ note: z.string().trim().max(500).default('') });

export const rangeQuery = z.object({ from: date, to: date }).refine((r) => r.from <= r.to, { path: ['to'], message: 'پایان بازه پیش از شروع است' });

export const taskQuery = z.object({
  scope: z.enum(['mine', 'team']).default('mine'),
  status: z.enum(['open', 'review', 'closed', 'all']).default('all'),
  assigneeId: z.uuid().optional(),
  from: date.optional(),
  to: date.optional(),
});
