import { z } from 'zod';
import { FormulaError, parseFormula } from './formula.js';
import { parsePeriod } from './scoring.js';

const text = (max: number) => z.string().trim().max(max, `حداکثر ${max} نویسه`);
export const period = z.string().refine((p) => !!parsePeriod(p), 'دوره معتبر نیست (مثلاً 1405، 1405-Q3 یا 1405-07)');
const level = z.enum(['org', 'unit', 'project', 'role', 'person']);
const subject = { subjectType: level, subjectId: z.string().trim().min(1).max(100), subjectName: z.string().trim().min(1, 'نام موضوع را وارد کنید').max(160) };

export const definitionInput = z
  .object({
    code: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,39}$/, 'کد فقط حروف کوچک لاتین، رقم و _ (برای استفاده در فرمول)'),
    name: z.string().trim().min(2, 'نام شاخص الزامی است').max(160),
    description: text(4000).default(''),
    unit: text(30).default('count'),
    direction: z.enum(['higher', 'lower']),
    level,
    frequency: z.enum(['monthly', 'quarterly', 'yearly']),
    source: z.enum(['manual', 'provider', 'formula']),
    providerKey: z.string().trim().max(100).nullable().default(null),
    formula: z.string().trim().max(500).nullable().default(null),
    weight: z.number().int().min(1).max(100).default(1),
    goodPct: z.number().positive().max(1000).default(100),
    warningPct: z.number().positive().max(1000).default(80),
    isGate: z.boolean().default(false),
    ownerUserId: z.uuid().nullable().default(null),
    status: z.enum(['active', 'archived']).default('active'),
  })
  .refine((v) => v.warningPct <= v.goodPct, { message: 'آستانه هشدار باید کمتر یا برابر آستانه مطلوب باشد', path: ['warningPct'] })
  .refine((v) => v.source !== 'provider' || !!v.providerKey, { message: 'منبع داده (Provider) را انتخاب کنید', path: ['providerKey'] })
  .superRefine((v, c) => {
    if (v.source !== 'formula') return;
    if (!v.formula) return c.addIssue({ code: 'custom', message: 'فرمول را وارد کنید', path: ['formula'] });
    try {
      parseFormula(v.formula);
    } catch (e) {
      c.addIssue({ code: 'custom', message: e instanceof FormulaError ? e.message : 'فرمول نامعتبر است', path: ['formula'] });
    }
  })
  .transform((v) => ({ ...v, providerKey: v.source === 'provider' ? v.providerKey : null, formula: v.source === 'formula' ? v.formula : null }));

export const targetsInput = z.object({
  period,
  targets: z.array(z.object({ ...subject, target: z.number().finite('هدف باید عدد باشد') })).max(500),
});

export const valueInput = z.object({ period, ...subject, value: z.number().finite('مقدار باید عدد باشد'), note: text(1000).default('') });
export const computeInput = z.object({ period, ...subject });
export const decisionInput = z.object({ decision: z.enum(['approve', 'reject']), note: text(1000).default('') }).refine((v) => v.decision === 'approve' || v.note, { message: 'دلیل رد را بنویسید', path: ['note'] });
export const sheetQuery = z.object({ period, level: level.optional() });

export const scorecardComputeInput = z.object({ period, subjectType: level, subjectId: z.string().trim().min(1).max(100).optional() });
export const scorecardQuery = z.object({ period: period.optional(), status: z.enum(['draft', 'reviewed', 'approved', 'superseded']).optional() });
export const commentInput = z.object({ comment: text(2000).default('') });

export const rewardRuleInput = z.object({
  name: z.string().trim().min(2, 'نام قاعده الزامی است').max(120),
  bands: z
    .array(z.object({ minScore: z.number().min(0).max(120), coefficient: z.number().min(0).max(5) }))
    .min(1, 'دست‌کم یک بازه لازم است')
    .max(20)
    .refine((b) => new Set(b.map((x) => x.minScore)).size === b.length, { message: 'حداقل امتیاز بازه‌ها نباید تکراری باشد' }),
  gateCoefficient: z.number().min(0).max(5).default(0),
});
