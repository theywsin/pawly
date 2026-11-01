import { describe, expect, it } from 'vitest';
import { computeStatement, currentAmount, pctUnits, percentOf } from '../backend/src/calc.js';

const rates = { goodPerformancePct: '10', insurancePct: '5', taxPct: '3', vatPct: '10', prepaymentRecoveryPct: '25' };

describe('contract money arithmetic', () => {
  it('parses percentages exactly and rejects bad input', () => {
    expect(pctUnits('10')).toBe(100_000n);
    expect(pctUnits('2.5')).toBe(25_000n);
    expect(pctUnits('10.0000')).toBe(100_000n);
    expect(pctUnits(0)).toBe(0n);
    expect(() => pctUnits('100.5')).toThrow();
    expect(() => pctUnits('-1')).toThrow();
    expect(() => pctUnits('1e3')).toThrow();
  });

  it('rounds half up to whole rial without floating point', () => {
    expect(percentOf(1_000_000_000n, '10')).toBe(100_000_000n);
    expect(percentOf(15n, '10')).toBe(2n); // 1.5 → 2
    expect(percentOf(14n, '10')).toBe(1n); // 1.4 → 1
    expect(percentOf(999_999_999_999_999_999n, '3')).toBe(30_000_000_000_000_000n);
    expect(percentOf(123_456_789n, '2.5')).toBe(3_086_420n); // 3,086,419.725
  });

  it('first statement: period gross, retentions, tax, capped prepayment recovery, VAT', () => {
    const s = computeStatement({ cumulativeGross: 4_000_000_000n, previousCumulative: 0n, prepaymentRemaining: 500_000_000n, otherDeductions: 20_000_000n }, rates);
    expect(s).toEqual({
      periodGross: 4_000_000_000n,
      goodPerformance: 400_000_000n,
      insurance: 200_000_000n,
      tax: 120_000_000n,
      prepaymentRecovery: 500_000_000n, // 25% would be 1,000,000,000 — capped at what remains
      otherDeductions: 20_000_000n,
      vat: 400_000_000n,
      netPayable: 3_160_000_000n,
    });
  });

  it('later statement uses only this period and stops recovering a repaid prepayment', () => {
    const s = computeStatement({ cumulativeGross: 6_000_000_000n, previousCumulative: 4_000_000_000n, prepaymentRemaining: 0n, otherDeductions: 0n }, rates);
    expect(s.periodGross).toBe(2_000_000_000n);
    expect(s.prepaymentRecovery).toBe(0n);
    expect(s.netPayable).toBe(2_000_000_000n - 200_000_000n - 100_000_000n - 60_000_000n + 200_000_000n);
  });

  it('refuses a cumulative amount below the previous statement', () => {
    expect(() => computeStatement({ cumulativeGross: 1n, previousCumulative: 2n, prepaymentRemaining: 0n, otherDeductions: 0n }, rates)).toThrow('CUMULATIVE_DECREASED');
  });

  it('current amount includes positive and negative amendments', () => {
    expect(currentAmount(10_000_000_000n, [2_500_000_000n, -500_000_000n])).toBe(12_000_000_000n);
  });
});
