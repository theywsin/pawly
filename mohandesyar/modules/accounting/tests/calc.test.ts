import { describe, expect, it } from 'vitest';
import { fromMilli, issueCost, jalaliYearOf, lineCalc, milli, monthlyDepreciation, monthRange, periodOf, seasonRange } from '../backend/src/calc.js';

describe('amounts and quantities', () => {
  it('computes invoice lines in bigint with half-up rounding', () => {
    expect(milli('12.5')).toBe(12500n);
    expect(fromMilli(12500n)).toBe('12.5');
    expect(fromMilli(-3000n)).toBe('-3');
    expect(lineCalc('2.5', 333n, 0n, 9)).toEqual({ gross: 833n, amount: 833n, vat: 75n }); // 832.5 → 833; 74.97 → 75
    expect(lineCalc('1', 2_500_000n, 500_000n, 10)).toEqual({ gross: 2_500_000n, amount: 2_000_000n, vat: 200_000n });
    expect(lineCalc('3', 1000n, 0n, 0).vat).toBe(0n);
  });
  it('issues stock at moving average', () => {
    expect(issueCost(150_000n, 8_000_000n, 30_000n)).toBe(1_600_000n);
    expect(issueCost(3000n, 100n, 1000n)).toBe(33n);
    expect(issueCost(1000n, 100n, 1000n)).toBe(100n); // whole stock: exact remaining value
  });
});

describe('Jalali periods', () => {
  it('fiscal year, month and VAT season ranges', () => {
    expect(jalaliYearOf('2026-10-18')).toMatchObject({ jy: 1405, start: '2026-03-21', end: '2027-03-20' });
    expect(monthRange('1405-07')).toEqual({ start: '2026-09-23', end: '2026-10-22' });
    expect(monthRange('1405-12')).toEqual({ start: '2027-02-20', end: '2027-03-20' });
    expect(periodOf('2026-10-18')).toBe('1405-07');
    expect(seasonRange(1405, 3)).toEqual({ start: '2026-09-23', end: '2026-12-21' });
  });
});

describe('depreciation', () => {
  const a = { acquired_on: '2026-09-10', cost: 1000n, salvage: 100n, method: 'straight_line' as const, useful_life_months: 7, rate_percent: null };
  it('starts the month after acquisition and lands exactly on salvage', () => {
    expect(monthlyDepreciation(a, '1405-06', 0n)).toBe(0n); // acquisition month (Shahrivar)
    let acc = 0n;
    const months = ['1405-07', '1405-08', '1405-09', '1405-10', '1405-11', '1405-12', '1406-01', '1406-02'];
    const got = months.map((p) => {
      const d = monthlyDepreciation(a, p, acc);
      acc += d;
      return d;
    });
    expect(got).toEqual([129n, 128n, 129n, 128n, 129n, 128n, 129n, 0n]);
    expect(acc).toBe(900n);
  });
  it('catches up after opening depreciation and never goes below salvage', () => {
    expect(monthlyDepreciation(a, '1405-07', 899n)).toBe(0n); // already ahead of schedule
    expect(monthlyDepreciation(a, '1406-01', 899n)).toBe(1n);
    expect(monthlyDepreciation({ ...a, method: 'declining', useful_life_months: null, rate_percent: 24 }, '1405-07', 0n)).toBe(20n); // 1000 × 24% / 12
    expect(monthlyDepreciation({ ...a, method: 'declining', useful_life_months: null, rate_percent: 100 }, '1405-07', 895n)).toBe(5n); // 105 / 12 = 9, capped at the 5 left above salvage
  });
});
