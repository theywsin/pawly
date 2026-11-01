import { describe, expect, it } from 'vitest';
import { dutyOccursOn, lateMinutes, performance, percent, scorePercent } from '../backend/src/calc.js';

const cal = { weeklyOff: [5], holidays: new Set<string>(['2026-10-20']) };
const base = { weekdays: [] as number[], month_day: null, skip_days_off: true };

describe('duty schedule', () => {
  it('daily duties skip Fridays and holidays unless asked', () => {
    expect(dutyOccursOn({ ...base, recurrence: 'daily' }, '2026-10-18', cal)).toBe(true); // Sunday
    expect(dutyOccursOn({ ...base, recurrence: 'daily' }, '2026-10-23', cal)).toBe(false); // Friday
    expect(dutyOccursOn({ ...base, recurrence: 'daily' }, '2026-10-20', cal)).toBe(false); // holiday
    expect(dutyOccursOn({ ...base, recurrence: 'daily', skip_days_off: false }, '2026-10-23', cal)).toBe(true);
  });
  it('weekly duties run on the chosen weekdays', () => {
    const d = { ...base, recurrence: 'weekly' as const, weekdays: [6, 1] };
    expect(dutyOccursOn(d, '2026-10-17', cal)).toBe(true); // Saturday
    expect(dutyOccursOn(d, '2026-10-19', cal)).toBe(true); // Monday
    expect(dutyOccursOn(d, '2026-10-18', cal)).toBe(false);
  });
  it('monthly duties use the Jalali day, capped at month end', () => {
    // 2026-10-18 = 26 Mehr 1405
    expect(dutyOccursOn({ ...base, recurrence: 'monthly', month_day: 26 }, '2026-10-18', cal)).toBe(true);
    expect(dutyOccursOn({ ...base, recurrence: 'monthly', month_day: 25 }, '2026-10-18', cal)).toBe(false);
    // Mehr has 30 days: a duty on the 31st runs on 30 Mehr (2026-10-22)
    expect(dutyOccursOn({ ...base, recurrence: 'monthly', month_day: 31 }, '2026-10-22', cal)).toBe(true);
  });
});

describe('figures', () => {
  it('counts lateness after the grace period in Tehran time', () => {
    expect(lateMinutes('2026-10-18T04:35:00Z', '08:00', 10)).toBe(0); // 08:05
    expect(lateMinutes('2026-10-18T04:55:00Z', '08:00', 10)).toBe(25); // 08:25
  });
  it('combines components with weights, ignoring missing ones', () => {
    expect(performance({ onTimeRate: 100, averageScore: 80, attendanceRate: 50, reportRate: 0 })).toBe(74);
    expect(performance({ onTimeRate: 100, averageScore: null, attendanceRate: null, reportRate: null })).toBe(100);
    expect(performance({ onTimeRate: null, averageScore: null, attendanceRate: null, reportRate: null })).toBeNull();
    expect(scorePercent(4.5)).toBe(90);
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(1, 0)).toBeNull();
  });
});
