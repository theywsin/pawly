import { describe, expect, it } from 'vitest';
import { criterionSchema, experienceYears, scoreCandidate, scoringSchema, type ScoringCandidate } from '../backend/src/scoring.js';

const cand: ScoringCandidate = {
  city: 'تهران',
  expected_salary: '400000000',
  available_from: '2025-06-10',
  summary: 'طراحی سازه‌های فولادی',
  educations: [{ degree: 'master', field: 'مهندسی عمران - سازه' }],
  experiences: [
    { title: 'طراح سازه', description: 'طراحی ساختمان‌های بتنی', started_on: '2018-01-01', ended_on: '2021-01-01' },
    { title: 'کارشناس', description: 'نظارت کارگاهی', started_on: '2020-01-01', ended_on: null },
  ],
  projects: [{ title: 'برج مسکونی ونک', role: 'طراح', description: 'تحلیل لرزه‌ای با ETABS' }],
  skills: [
    { kind: 'software', name: 'ETABS', level: 4 },
    { kind: 'software', name: 'SAFE', level: 2 },
    { kind: 'language', name: 'انگليسي', level: 3 },
  ],
};
const today = '2025-06-01';

describe('scoring', () => {
  it('rejects criteria outside the whitelist', () => {
    for (const bad of [{ type: 'age', max: 30, weight: 1 }, { type: 'gender', value: 'x', weight: 1 }, { type: 'religion', weight: 1 }, { type: 'item', kind: 'marital', name: 'x', weight: 1 }]) {
      expect(criterionSchema.safeParse(bad).success).toBe(false);
    }
    expect(scoringSchema.safeParse([{ type: 'item', kind: 'software', name: 'ETABS', weight: 11 }]).success).toBe(false);
  });

  it('counts overlapping experience once', () => {
    // 2018-01-01 → 2025-06-01 continuously (the two periods overlap in 2020).
    expect(experienceYears(cand.experiences, today)).toBeCloseTo(7.41, 1);
    expect(experienceYears([], today)).toBe(0);
  });

  it('explains every point and weights criteria', () => {
    const criteria = scoringSchema.parse([
      { type: 'item', kind: 'software', name: 'etabs', minLevel: 3, weight: 3 },
      { type: 'item', kind: 'software', name: 'SAFE', minLevel: 4, weight: 2 },
      { type: 'experience_years', min: 10, weight: 2 },
      { type: 'education', minDegree: 'bachelor', field: 'سازه', weight: 2 },
      { type: 'keyword', keyword: 'لرزه‌ای', weight: 1 },
      { type: 'salary_fit', max: 300000000, weight: 1 },
      { type: 'availability', withinDays: 30, weight: 1 },
      { type: 'city', city: 'تهران', weight: 1 },
      { type: 'item', kind: 'language', name: 'انگلیسی', minLevel: 3, weight: 1 },
    ]);
    const r = scoreCandidate(criteria, cand, today);
    const by = (i: number) => r.breakdown[i]!;
    expect(by(0)).toMatchObject({ fraction: 1, reason: 'ثبت شده با سطح ۴ از ۵' }); // case-insensitive name match
    expect(by(1).fraction).toBe(0.5); // level 2 of required 4
    expect(by(1).reason).toContain('کمتر');
    expect(by(2).fraction).toBeCloseTo(0.741, 2);
    expect(by(3)).toMatchObject({ fraction: 1 });
    expect(by(4).reason).toContain('برج مسکونی ونک');
    expect(by(5)).toMatchObject({ fraction: 0 });
    expect(by(5).reason).toContain('بیش از سقف');
    expect(by(6).fraction).toBe(1);
    expect(by(7).fraction).toBe(1);
    expect(by(8).fraction).toBe(1); // Arabic Yeh in the resume matches Persian Yeh in the criterion
    const expected = (3 * 1 + 2 * 0.5 + 2 * 0.741 + 2 + 1 + 0 + 1 + 1 + 1) / 14 * 100;
    expect(r.score).toBeCloseTo(expected, 0);
    expect(r.breakdown.reduce((s, b) => s + b.points, 0)).toBeCloseTo(r.score!, 0);
  });

  it('gives half credit for the right degree in another field and nothing for a lower degree', () => {
    const c = scoringSchema.parse([{ type: 'education', minDegree: 'master', field: 'معماری', weight: 1 }]);
    expect(scoreCandidate(c, cand, today).score).toBe(50);
    const phd = scoringSchema.parse([{ type: 'education', minDegree: 'phd', weight: 1 }]);
    const r = scoreCandidate(phd, cand, today);
    expect(r.score).toBe(0);
    expect(r.breakdown[0]!.reason).toContain('کارشناسی ارشد');
  });

  it('treats missing data as zero with a reason, and an empty profile as no score', () => {
    const empty: ScoringCandidate = { city: '', expected_salary: null, available_from: null, summary: '', educations: [], experiences: [], projects: [], skills: [] };
    const c = scoringSchema.parse([{ type: 'salary_fit', max: 1, weight: 1 }, { type: 'availability', withinDays: 0, weight: 1 }, { type: 'city', city: 'شیراز', weight: 1 }]);
    const r = scoreCandidate(c, empty, today);
    expect(r.score).toBe(0);
    expect(r.breakdown.every((b) => b.reason.includes('ثبت نشده'))).toBe(true);
    expect(scoreCandidate([], cand, today)).toEqual({ score: null, breakdown: [] });
  });
});
