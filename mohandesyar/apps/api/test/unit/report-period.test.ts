import { describe, expect, it } from 'vitest';
import { nextRun, resolveRange } from '../../src/core/reports/period.js';

describe('report periods', () => {
  it('resolves relative ranges on the Jalali calendar', () => {
    // 1405/07/24 = 2026-10-16
    expect(resolveRange({ range: 'month_to_date' }, '2026-10-16')).toEqual({ from: '2026-09-23', to: '2026-10-16' });
    expect(resolveRange({ range: 'last_month' }, '2026-10-16')).toEqual({ from: '2026-08-23', to: '2026-09-22' });
    expect(resolveRange({ range: 'year_to_date' }, '2026-10-16')).toEqual({ from: '2026-03-21', to: '2026-10-16' });
    expect(resolveRange({ range: 'last_month' }, '2026-03-25')).toEqual({ from: '2026-02-20', to: '2026-03-20' }); // Farvardin → Esfand of the previous year
    expect(resolveRange({ range: 'last_7_days' }, '2026-10-16')).toEqual({ from: '2026-10-10', to: '2026-10-16' });
  });
  it('schedules the next delivery at 07:00 Tehran', () => {
    const now = new Date('2026-10-16T10:00:00Z'); // Friday afternoon in Tehran
    expect(nextRun('daily', now)).toBe('2026-10-17T03:30:00.000Z');
    expect(nextRun('weekly', now)).toBe('2026-10-17T03:30:00.000Z'); // next Saturday
    expect(nextRun('monthly', now)).toBe('2026-10-23T03:30:00.000Z'); // 1 Aban 1405
  });
});
