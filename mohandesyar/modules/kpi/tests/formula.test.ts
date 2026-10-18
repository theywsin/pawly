import { describe, expect, it } from 'vitest';
import { FormulaError, evaluate, parseFormula, variables } from '../backend/src/formula.js';
import { periodLabel, periodRange, rewardCoefficient, scoreCard, scoreItem, type ItemInput } from '../backend/src/scoring.js';

const ev = (f: string, v: Record<string, number | null> = {}) => evaluate(parseFormula(f), v);

describe('formula', () => {
  it('respects precedence, unary minus, parentheses and functions', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('(1 + 2) * 3')).toBe(9);
    expect(ev('-2 * -3')).toBe(6);
    expect(ev('10 / 4 - 1')).toBe(1.5);
    expect(ev('max(1, min(5, 3), abs(-2))')).toBe(3);
    expect(ev('round(2.5) + round(2.4)')).toBe(5);
    expect(ev('۱۰ × ۲ ÷ ۴')).toBe(5); // Persian digits and signs
  });
  it('uses KPI codes as variables and returns null for missing data or division by zero', () => {
    expect(ev('done / planned * 100', { done: 45, planned: 60 })).toBe(75);
    expect(ev('done / planned', { done: 45, planned: 0 })).toBeNull();
    expect(ev('done / planned', { done: 45 })).toBeNull();
    expect([...variables(parseFormula('a + max(b, c * a)'))].sort()).toEqual(['a', 'b', 'c']);
  });
  it('rejects anything that is not the arithmetic language (no eval)', () => {
    for (const bad of ['process.exit()', 'a; b', '1 +', '(1', 'pow(2, 3)', 'constructor(1)', '"x"', 'a.b', '2 ** 3', 'abs(1, 2)', 'max', '', 'x'.repeat(501), '('.repeat(60) + '1' + ')'.repeat(60)]) {
      expect(() => parseFormula(bad), bad.slice(0, 20)).toThrow(FormulaError);
    }
  });
});

describe('periods', () => {
  it('maps Jalali periods to Gregorian ranges', () => {
    expect(periodRange('1404')).toEqual({ from: '2025-03-21', to: '2026-03-20' });
    expect(periodRange('1404-Q1')).toEqual({ from: '2025-03-21', to: '2025-06-21' });
    expect(periodRange('1403-12')).toEqual({ from: '2025-02-19', to: '2025-03-20' }); // leap Esfand: 30 days
    expect(periodRange('1404-13')).toBeNull();
    expect(periodLabel('1405-Q3')).toBe('پاییز ۱۴۰۵');
    expect(periodLabel('1405-07')).toBe('مهر ۱۴۰۵');
  });
});

const item = (p: Partial<ItemInput>): ItemInput => ({ definitionId: 'd', code: 'c', name: 'شاخص', unit: 'count', direction: 'higher', weight: 1, isGate: false, goodPct: 100, warningPct: 80, target: 100, value: 100, valueStatus: 'approved', ...p });

describe('scoring', () => {
  it('scores achievement in both directions with thresholds and a cap', () => {
    expect(scoreItem(item({ value: 90 }))).toMatchObject({ score: 90, status: 'warning' });
    expect(scoreItem(item({ value: 70 }))).toMatchObject({ status: 'critical' });
    expect(scoreItem(item({ value: 500 }))).toMatchObject({ score: 120, status: 'good' }); // capped
    expect(scoreItem(item({ direction: 'lower', target: 10, value: 20 }))).toMatchObject({ score: 50, status: 'critical' });
    expect(scoreItem(item({ direction: 'lower', target: 0, value: 0 }))).toMatchObject({ score: 120, status: 'good' }); // zero incidents
    expect(scoreItem(item({ target: null })).status).toBe('missing');
    expect(scoreItem(item({ value: null })).reason).toContain('تأییدشده');
  });
  it('weights items, flags incomplete cards and enforces gates', () => {
    const c = scoreCard([item({ weight: 3, value: 100 }), item({ weight: 1, value: 60 }), item({ weight: 2, target: null })]);
    expect(c.score).toBe(90); // (3·100 + 1·60) / 4
    expect(c.complete).toBe(false);
    const g = scoreCard([item({ weight: 3 }), item({ name: 'حوادث', isGate: true, direction: 'lower', target: 0, value: 2 })]);
    expect(g.gateFailed).toBe(true);
    expect(g.gateReasons[0]).toContain('حوادث');
  });
  it('suggests (never pays) a reward coefficient from versioned bands', () => {
    const bands = [{ minScore: 90, coefficient: 1.2 }, { minScore: 70, coefficient: 1 }, { minScore: 50, coefficient: 0.5 }];
    expect(rewardCoefficient(95, bands, false, 0).coefficient).toBe(1.2);
    expect(rewardCoefficient(72, bands, false, 0).coefficient).toBe(1);
    expect(rewardCoefficient(10, bands, false, 0).coefficient).toBe(0);
    expect(rewardCoefficient(99, bands, true, 0)).toMatchObject({ coefficient: 0, reason: expect.stringContaining('شرط لازم') });
  });
});
