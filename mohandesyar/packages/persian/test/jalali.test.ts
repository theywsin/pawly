import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, isJalaliLeapYear, isoToJalali, jalaliMonthLength, parseJalaliDate, toGregorian, toJalali, todayIso } from '../src/index.js';

const icu = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
function icuJalali(d: Date) {
  const p = Object.fromEntries(icu.formatToParts(d).map((x) => [x.type, x.value]));
  return { jy: Number(p.year), jm: Number(p.month), jd: Number(p.day) };
}

describe('jalali conversion', () => {
  it('matches the ICU persian calendar for every day 1980–2060, both directions', () => {
    for (let t = Date.UTC(1980, 0, 1); t < Date.UTC(2060, 0, 1); t += 86_400_000) {
      const d = new Date(t);
      const g = { gy: d.getUTCFullYear(), gm: d.getUTCMonth() + 1, gd: d.getUTCDate() };
      const j = toJalali(g.gy, g.gm, g.gd);
      expect(j).toEqual(icuJalali(d));
      expect(toGregorian(j.jy, j.jm, j.jd)).toEqual(g);
    }
  });

  it('knows leap years and month lengths', () => {
    expect(isJalaliLeapYear(1403)).toBe(true);
    expect(isJalaliLeapYear(1404)).toBe(false);
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(jalaliMonthLength(1404, 12)).toBe(29);
    expect(jalaliMonthLength(1404, 1)).toBe(31);
    expect(jalaliMonthLength(1404, 7)).toBe(30);
  });

  it('parses typed dates in Persian or Latin digits and rejects impossible ones', () => {
    expect(parseJalaliDate('۱۴۰۳/۰۱/۰۱')).toBe('2024-03-20');
    expect(parseJalaliDate('1403-5-12')).toBe('2024-08-02');
    expect(parseJalaliDate(' 1404/12/29 ')).toBe('2026-03-20');
    expect(parseJalaliDate('1404/12/30')).toBeNull();
    expect(parseJalaliDate('1403/13/01')).toBeNull();
    expect(parseJalaliDate('1403/07/31')).toBeNull();
    expect(parseJalaliDate('03/01/01')).toBeNull();
    expect(parseJalaliDate('abc')).toBeNull();
    expect(isoToJalali('2024-08-02')).toBe('1403/05/12');
    expect(isoToJalali('2024-08-02T10:00:00Z')).toBe('1403/05/12');
  });

  it('date arithmetic on calendar dates', () => {
    expect(daysBetween('2024-03-01', '2024-03-31')).toBe(30);
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(todayIso('Asia/Tehran', new Date('2024-03-19T21:00:00Z'))).toBe('2024-03-20');
  });
});

import { utcToZoned, zonedToUtc } from '../src/index.js';
describe('time zones', () => {
  it('converts Tehran wall-clock time to UTC and back (with and without the former DST)', () => {
    expect(zonedToUtc('2025-10-15', '09:30')).toBe('2025-10-15T06:00:00.000Z'); // +03:30 (no DST since 2022)
    expect(zonedToUtc('2021-07-01', '09:30')).toBe('2021-07-01T05:00:00.000Z'); // +04:30 (DST in 2021)
    expect(utcToZoned('2025-10-15T06:00:00.000Z')).toEqual({ date: '2025-10-15', time: '09:30' });
    expect(utcToZoned('2025-10-15T21:00:00.000Z')).toEqual({ date: '2025-10-16', time: '00:30' });
    expect(zonedToUtc('2025-03-21', '00:15', 'UTC')).toBe('2025-03-21T00:15:00.000Z');
  });
});
