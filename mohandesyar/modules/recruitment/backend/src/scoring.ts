import { z } from 'zod';
import { normalizePersian } from '@mohandesyar/persian';

/**
 * Transparent, advisory scoring of a candidate against a job (docs/05 recruitment_scoring_profiles).
 *
 * Only the criterion types below exist; the schema rejects anything else, and the candidate model has no
 * field for age, gender, marital status, ethnicity, religion or health, so they can never become criteria.
 * Every criterion yields a fraction 0..1 with a human-readable reason; the total is the weighted mean × 100.
 */

export const DEGREES = ['diploma', 'associate', 'bachelor', 'master', 'phd'] as const;
const degreeRank = (d: string) => DEGREES.indexOf(d as (typeof DEGREES)[number]);
export const DEGREE_FA: Record<string, string> = { diploma: 'دیپلم', associate: 'کاردانی', bachelor: 'کارشناسی', master: 'کارشناسی ارشد', phd: 'دکتری', other: 'سایر' };
export const SKILL_KIND_FA: Record<string, string> = { skill: 'مهارت', software: 'نرم‌افزار', certificate: 'گواهینامه', language: 'زبان' };

const weight = z.number().int().min(1, 'وزن دست‌کم ۱ است').max(10, 'وزن حداکثر ۱۰ است');
const name = z.string().trim().min(1, 'نام را وارد کنید').max(120);

export const criterionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('item'), kind: z.enum(['skill', 'software', 'certificate', 'language']), name, minLevel: z.number().int().min(1).max(5).default(1), weight }),
  z.object({ type: z.literal('experience_years'), min: z.number().min(0.5).max(40), weight }),
  z.object({ type: z.literal('education'), minDegree: z.enum(DEGREES), field: z.string().trim().max(120).default(''), weight }),
  z.object({ type: z.literal('keyword'), keyword: name, weight }),
  z.object({ type: z.literal('salary_fit'), max: z.number().int().min(1), weight }),
  z.object({ type: z.literal('availability'), withinDays: z.number().int().min(0).max(365), weight }),
  z.object({ type: z.literal('city'), city: name, weight }),
]);
export const scoringSchema = z.array(criterionSchema).max(30, 'حداکثر ۳۰ معیار');
export type Criterion = z.infer<typeof criterionSchema>;

export interface ScoringCandidate {
  city: string;
  expected_salary: string | number | null;
  available_from: string | null;
  summary: string;
  educations: { degree: string; field: string }[];
  experiences: { title: string; description: string; started_on: string; ended_on: string | null }[];
  projects: { title: string; role: string; description: string }[];
  skills: { kind: string; name: string; level: number }[];
}

export interface BreakdownItem {
  label: string;
  weight: number;
  fraction: number;
  points: number;
  reason: string;
}

export const norm = normalizePersian;

const DAY = 86_400_000;
const fa = (n: number, digits = 1) => n.toLocaleString('fa-IR', { maximumFractionDigits: digits });

/** Total years of experience, overlapping periods counted once; an open period runs until `today`. */
export function experienceYears(items: { started_on: string; ended_on: string | null }[], today: string): number {
  const ranges = items
    .map((e) => [Date.parse(e.started_on), Date.parse(e.ended_on ?? today)] as const)
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b >= a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const [a, b] of ranges) {
    if (cur && a <= cur[1]) cur[1] = Math.max(cur[1], b);
    else {
      if (cur) total += cur[1] - cur[0];
      cur = [a, b];
    }
  }
  if (cur) total += cur[1] - cur[0];
  return total / DAY / 365.25;
}

function evaluate(c: Criterion, cand: ScoringCandidate, today: string): { label: string; fraction: number; reason: string } {
  switch (c.type) {
    case 'item': {
      const label = `${SKILL_KIND_FA[c.kind]}: ${c.name}${c.minLevel > 1 ? ` (سطح ${fa(c.minLevel)}+)` : ''}`;
      const want = norm(c.name);
      const have = cand.skills.filter((s) => s.kind === c.kind && norm(s.name) === want).sort((a, b) => b.level - a.level)[0];
      if (!have) return { label, fraction: 0, reason: 'در رزومه ثبت نشده است' };
      if (have.level >= c.minLevel) return { label, fraction: 1, reason: `ثبت شده با سطح ${fa(have.level)} از ۵` };
      return { label, fraction: have.level / c.minLevel, reason: `سطح ${fa(have.level)} کمتر از سطح مورد نیاز ${fa(c.minLevel)} است` };
    }
    case 'experience_years': {
      const label = `سابقه کار دست‌کم ${fa(c.min)} سال`;
      const years = experienceYears(cand.experiences, today);
      const fraction = Math.min(1, years / c.min);
      return { label, fraction, reason: years > 0 ? `مجموع سابقه ثبت‌شده ${fa(years)} سال` : 'سابقه کاری ثبت نشده است' };
    }
    case 'education': {
      const label = `تحصیلات ${DEGREE_FA[c.minDegree]} یا بالاتر${c.field ? ` در رشته ${c.field}` : ''}`;
      const ok = cand.educations.filter((e) => degreeRank(e.degree) >= degreeRank(c.minDegree));
      if (!ok.length) {
        const best = cand.educations.map((e) => e.degree).sort((a, b) => degreeRank(b) - degreeRank(a))[0];
        return { label, fraction: 0, reason: best ? `بالاترین مدرک ثبت‌شده: ${DEGREE_FA[best]}` : 'تحصیلات ثبت نشده است' };
      }
      if (!c.field) return { label, fraction: 1, reason: `مدرک ${DEGREE_FA[ok[0]!.degree]} در رشته ${ok[0]!.field}` };
      const f = norm(c.field);
      const match = ok.find((e) => norm(e.field).includes(f));
      return match
        ? { label, fraction: 1, reason: `مدرک ${DEGREE_FA[match.degree]} در رشته ${match.field}` }
        : { label, fraction: 0.5, reason: `مقطع کافی است ولی رشته (${ok.map((e) => e.field).join('، ')}) با «${c.field}» یکی نیست` };
    }
    case 'keyword': {
      const label = `تجربه مرتبط با «${c.keyword}»`;
      const k = norm(c.keyword);
      const where = [
        ...cand.projects.filter((p) => norm(`${p.title} ${p.role} ${p.description}`).includes(k)).map((p) => `پروژه «${p.title}»`),
        ...cand.experiences.filter((e) => norm(`${e.title} ${e.description}`).includes(k)).map((e) => `سابقه «${e.title}»`),
      ];
      if (!where.length && norm(cand.summary).includes(k)) where.push('خلاصه رزومه');
      return where.length ? { label, fraction: 1, reason: `در ${where.slice(0, 3).join('، ')}` } : { label, fraction: 0, reason: 'در پروژه‌ها و سوابق یافت نشد' };
    }
    case 'salary_fit': {
      const label = `حقوق مورد انتظار حداکثر ${c.max.toLocaleString('fa-IR')} ریال`;
      if (cand.expected_salary === null || cand.expected_salary === '') return { label, fraction: 0, reason: 'حقوق مورد انتظار ثبت نشده است' };
      const s = Number(cand.expected_salary);
      return s <= c.max ? { label, fraction: 1, reason: `مورد انتظار ${s.toLocaleString('fa-IR')} ریال` } : { label, fraction: 0, reason: `مورد انتظار ${s.toLocaleString('fa-IR')} ریال، بیش از سقف` };
    }
    case 'availability': {
      const label = c.withinDays ? `آمادگی شروع ظرف ${fa(c.withinDays)} روز` : 'آمادگی شروع فوری';
      if (!cand.available_from) return { label, fraction: 0, reason: 'تاریخ آمادگی ثبت نشده است' };
      const days = Math.round((Date.parse(cand.available_from) - Date.parse(today)) / DAY);
      return days <= c.withinDays ? { label, fraction: 1, reason: days <= 0 ? 'آماده شروع است' : `${fa(days)} روز دیگر آماده است` } : { label, fraction: 0, reason: `${fa(days)} روز دیگر آماده است` };
    }
    case 'city': {
      const label = `محل سکونت: ${c.city}`;
      if (!cand.city) return { label, fraction: 0, reason: 'محل سکونت ثبت نشده است' };
      return norm(cand.city) === norm(c.city) ? { label, fraction: 1, reason: 'منطبق است' } : { label, fraction: 0, reason: `ساکن ${cand.city}` };
    }
  }
}

/** Score 0..100 (one decimal) with one breakdown line per criterion; null when the job has no criteria. */
export function scoreCandidate(criteria: Criterion[], cand: ScoringCandidate, today: string): { score: number | null; breakdown: BreakdownItem[] } {
  if (!criteria.length) return { score: null, breakdown: [] };
  const total = criteria.reduce((s, c) => s + c.weight, 0);
  const breakdown = criteria.map((c) => {
    const r = evaluate(c, cand, today);
    const fraction = Math.round(r.fraction * 1000) / 1000;
    return { label: r.label, weight: c.weight, fraction, points: Math.round((c.weight * fraction * 1000) / total) / 10, reason: r.reason };
  });
  const score = Math.round(breakdown.reduce((s, b) => s + b.weight * b.fraction, 0) * 1000 / total) / 10;
  return { score, breakdown };
}
