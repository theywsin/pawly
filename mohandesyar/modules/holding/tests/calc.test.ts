import { describe, expect, it } from 'vitest';
import { aggregate, jalaliMonths } from '../backend/src/calc.js';

describe('holding calc', () => {
  it('lists Jalali months across the year boundary', () => {
    expect(jalaliMonths('2026-04-05', 2)).toEqual([
      { label: '1404/12', from: '2026-02-20', to: '2026-03-20' },
      { label: '1405/01', from: '2026-03-21', to: '2026-04-20' },
    ]);
  });
  it('sums counts and amounts, averages rates, and ignores missing values', () => {
    expect(aggregate('count', [2, null, 3])).toEqual({ value: 5, method: 'sum' });
    expect(aggregate('percent', [80, 90, null])).toEqual({ value: 85, method: 'average' });
    expect(aggregate('rate', [null])).toEqual({ value: null, method: 'none' });
  });
});
