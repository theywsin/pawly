import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ معتبر نیست');
const text = (max: number) => z.string().trim().max(max, `حداکثر ${max} نویسه`);
const optUuid = z.uuid().nullable().default(null);
const level = z.number().int().min(1, 'بین ۱ تا ۵').max(5, 'بین ۱ تا ۵');
const AREAS = ['safety', 'quality', 'environment', 'health'] as const;

export const incidentInput = z.object({
  kind: z.enum(['injury', 'near_miss', 'unsafe_condition', 'property_damage', 'environmental']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  occurredOn: isoDate,
  occurredTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$|^$/, 'ساعت را به شکل ۱۴:۳۰ وارد کنید').default(''),
  projectId: optUuid,
  location: text(300).default(''),
  title: z.string().trim().min(3, 'عنوان حادثه الزامی است').max(200),
  description: text(5000).default(''),
  injuredCount: z.number().int().min(0).max(1000).default(0),
  lostDays: z.number().int().min(0).max(100000).default(0),
  fatality: z.boolean().default(false),
  immediateAction: text(2000).default(''),
});
export const investigationInput = z.object({
  status: z.enum(['investigating', 'closed']),
  rootCause: text(5000).default(''),
  lostDays: z.number().int().min(0).max(100000).optional(),
}).refine((v) => v.status !== 'closed' || v.rootCause.length >= 10, { message: 'برای بستن، علت ریشه‌ای را (حداقل ۱۰ نویسه) بنویسید', path: ['rootCause'] });
export const incidentQuery = z.object({ status: z.enum(['open', 'investigating', 'closed']).optional(), kind: z.string().max(30).optional(), projectId: z.uuid().optional() });

export const manhoursInput = z.object({
  projectId: optUuid,
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'ماه معتبر نیست'),
  hours: z.number().min(0).max(1e9),
  headcount: z.number().int().min(0).max(1e6).default(0),
});

export const riskInput = z.object({
  projectId: optUuid,
  activity: z.string().trim().min(2, 'فعالیت الزامی است').max(200),
  hazard: z.string().trim().min(2, 'خطر الزامی است').max(300),
  consequence: text(1000).default(''),
  likelihood: level,
  severity: level,
  controls: text(3000).default(''),
  residualLikelihood: level.nullable().default(null),
  residualSeverity: level.nullable().default(null),
  ownerId: optUuid,
  reviewOn: isoDate.nullable().default(null),
  status: z.enum(['open', 'controlled', 'closed']).default('open'),
}).refine((v) => (v.residualLikelihood === null) === (v.residualSeverity === null), { message: 'احتمال و شدت باقی‌مانده را با هم وارد کنید', path: ['residualSeverity'] });

export const checklistInput = z.object({
  name: z.string().trim().min(2, 'نام چک‌لیست الزامی است').max(120),
  area: z.enum(AREAS).default('safety'),
  items: z.array(z.string().trim().min(2, 'متن بند الزامی است').max(300)).min(1, 'دست‌کم یک بند لازم است').max(200),
  archived: z.boolean().default(false),
});
export const inspectionInput = z.object({
  checklistId: z.uuid('چک‌لیست را انتخاب کنید'),
  projectId: optUuid,
  inspectedOn: isoDate,
  location: text(300).default(''),
  results: z.array(z.object({ result: z.enum(['ok', 'nok', 'na']), note: text(500).default('') })).min(1),
  notes: text(3000).default(''),
  /** Raise one non-conformance for all failed items. */
  raiseNcr: z.boolean().default(false),
});

export const ncrInput = z.object({
  source: z.enum(['inspection', 'incident', 'audit', 'customer', 'other']).default('other'),
  incidentId: optUuid,
  projectId: optUuid,
  area: z.enum(AREAS).default('quality'),
  title: z.string().trim().min(3, 'عنوان الزامی است').max(200),
  description: text(5000).default(''),
  severity: z.enum(['minor', 'major', 'critical']).default('minor'),
  raisedOn: isoDate,
});

export const actionInput = z.object({
  kind: z.enum(['corrective', 'preventive']),
  ncrId: optUuid,
  incidentId: optUuid,
  projectId: optUuid,
  title: z.string().trim().min(3, 'شرح اقدام الزامی است').max(300),
  ownerId: z.uuid('مسئول را انتخاب کنید'),
  dueOn: isoDate,
});
export const actionDoneInput = z.object({ note: z.string().trim().min(5, 'شرح انجام کار را بنویسید').max(2000) });
export const actionQuery = z.object({ status: z.enum(['open', 'done', 'verified', 'overdue']).optional(), mine: z.enum(['1']).optional() });

export const trainingInput = z.object({
  title: z.string().trim().min(3, 'عنوان آموزش الزامی است').max(200),
  topic: z.enum(['safety', 'quality', 'environment', 'health', 'induction']).default('safety'),
  heldOn: isoDate,
  hours: z.number().positive('مدت را وارد کنید').max(200),
  trainer: text(120).default(''),
  projectId: optUuid,
  attendees: z.array(z.object({ userId: optUuid, name: z.string().trim().min(2, 'نام شرکت‌کننده الزامی است').max(120) })).min(1, 'دست‌کم یک شرکت‌کننده لازم است').max(500),
});

export const ppeInput = z.object({
  userId: optUuid,
  personName: z.string().trim().min(2, 'نام تحویل‌گیرنده الزامی است').max(120),
  item: z.string().trim().min(2, 'نام تجهیز الزامی است').max(120),
  quantity: z.number().int().min(1).max(1000).default(1),
  issuedOn: isoDate,
  replaceOn: isoDate.nullable().default(null),
  projectId: optUuid,
}).refine((v) => !v.replaceOn || v.replaceOn >= v.issuedOn, { message: 'تاریخ تعویض باید بعد از تحویل باشد', path: ['replaceOn'] });

export const settingsInput = z.object({ urgentRecipients: z.array(z.uuid()).max(50) });
export const reportQuery = z.object({ from: isoDate, to: isoDate, projectId: z.uuid().optional() });
