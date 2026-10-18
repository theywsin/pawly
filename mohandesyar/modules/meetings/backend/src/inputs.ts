import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ معتبر نیست');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'ساعت را به شکل ۰۹:۳۰ وارد کنید');
const text = (max: number) => z.string().trim().max(max, `حداکثر ${max} نویسه`);

export const meetingInput = z
  .object({
    title: z.string().trim().min(2, 'موضوع جلسه الزامی است').max(200),
    kind: z.enum(['internal', 'client', 'site', 'board', 'coordination', 'other']).default('internal'),
    date: isoDate,
    startTime: time,
    endTime: time,
    location: text(200).default(''),
    onlineLink: z.union([z.literal(''), z.url('نشانی جلسه آنلاین معتبر نیست')]).default(''),
    projectId: z.uuid().nullable().default(null),
    attendeeIds: z.array(z.uuid()).max(100).default([]),
    externalAttendees: z.array(z.object({ name: z.string().trim().min(2).max(120), org: text(120).default('') })).max(50).default([]),
    agenda: z.array(z.string().trim().min(2, 'هر بند دستور جلسه دست‌کم دو نویسه است').max(300)).max(50).default([]),
  })
  .refine((v) => v.endTime > v.startTime, { message: 'پایان جلسه باید بعد از شروع آن باشد', path: ['endTime'] });

export const minutesInput = z.object({ minutes: text(50_000), attendance: z.record(z.uuid(), z.enum(['unknown', 'present', 'absent'])).default({}) });

export const resolutionInput = z.object({
  body: z.string().trim().min(2, 'متن مصوبه الزامی است').max(2000),
  ownerId: z.uuid('مسئول اجرا را انتخاب کنید'),
  dueOn: isoDate.nullable().default(null),
});

export const resolutionUpdateInput = z
  .object({ status: z.enum(['open', 'done', 'cancelled']), doneOn: isoDate.nullable().default(null), followUp: text(2000).default('') })
  .refine((v) => v.status !== 'done' || v.doneOn, { message: 'تاریخ انجام را وارد کنید', path: ['doneOn'] });

export const listQuery = z.object({ from: isoDate.optional(), to: isoDate.optional(), projectId: z.uuid().optional() });
export const resolutionQuery = z.object({ status: z.enum(['open', 'done', 'cancelled', 'overdue']).optional(), mine: z.enum(['1']).optional() });
