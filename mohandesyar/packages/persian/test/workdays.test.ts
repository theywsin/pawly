import { describe, expect, it } from 'vitest';
import { fixedHolidays, isWorkingDay, workingDayAt, workingDaysBetween } from '../src/index.js';

const cal = { weeklyOff: [5], holidays: new Set<string>() };

describe('work calendar', () => {
  it('computes the fixed official holidays of a Jalali year', () => {
    const h = fixedHolidays(1404);
    expect(h[0]).toEqual({ date: '2025-03-21', title: 'عید نوروز' });
    expect(h.find((x) => x.title === 'روز طبیعت')!.date).toBe('2025-04-02');
    expect(h.find((x) => x.title === 'پیروزی انقلاب اسلامی')!.date).toBe('2026-02-11');
    expect(h).toHaveLength(10);
  });

  it('Fridays, fixed holidays and organisation holidays are not working days', () => {
    expect(isWorkingDay('2025-10-17', cal)).toBe(false); // Friday
    expect(isWorkingDay('2025-10-16', cal)).toBe(true); // Thursday
    expect(isWorkingDay('2025-03-23', cal)).toBe(false); // 3 Farvardin 1404
    expect(isWorkingDay('2025-03-23', { ...cal, fixedOfficial: false })).toBe(true);
    expect(isWorkingDay('2025-06-27', cal)).toBe(false); // Friday
    expect(isWorkingDay('2025-07-06', { ...cal, holidays: new Set(['2025-07-06']) })).toBe(false); // e.g. Ashura entered by the organisation
  });

  it('counts and steps over working days', () => {
    // 1403 is a leap year: 29 Esfand (oil day) is 19 Mar 2025 and 30 Esfand (20 Mar) is a working day.
    expect(workingDayAt('2025-03-20', 0, cal)).toBe('2025-03-20');
    expect(workingDayAt('2025-03-21', 0, cal)).toBe('2025-03-25'); // after Nowruz 1–4 Farvardin
    expect(workingDayAt('2025-03-25', 6, cal)).toBe('2025-04-03'); // skips Fri 28 Mar, 12 & 13 Farvardin (1 & 2 Apr)
    expect(workingDaysBetween('2025-10-11', '2025-10-17', cal)).toBe(6); // Sat–Fri
    expect(workingDaysBetween('2025-10-17', '2025-10-11', cal)).toBe(0);
  });
});
