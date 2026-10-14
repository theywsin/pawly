import { describe, expect, it } from 'vitest';
import { formatDate, formatMoney, formatNumber, isValidNationalId, jalaliParts, normalizePersian, toLatinDigits, toPersianDigits } from '../src/index.js';

describe('persian', () => {
  it('converts digits both ways', () => {
    expect(toPersianDigits('1405/07/22')).toBe('۱۴۰۵/۰۷/۲۲');
    expect(toLatinDigits('۱۲۳٤٥')).toBe('12345');
  });

  it('formats Jalali dates in the Tehran time zone', () => {
    expect(jalaliParts('2026-03-20T21:00:00Z')).toEqual({ year: 1405, month: 1, day: 1 }); // 00:30 Tehran on Nowruz
    expect(jalaliParts('2026-10-14T12:00:00Z')).toEqual({ year: 1405, month: 7, day: 22 });
    expect(formatDate('2026-10-14T12:00:00Z', { style: 'short', digits: 'latn' })).toBe('1405/07/22');
    expect(formatDate('2026-03-21T12:00:00Z')).toContain('فروردین');
    expect(formatDate('invalid')).toBe('');
  });

  it('formats numbers and money', () => {
    expect(formatNumber(1234567, { digits: 'latn' })).toBe('1,234,567');
    expect(formatNumber(1234567)).toBe('۱٬۲۳۴٬۵۶۷');
    expect(formatMoney(12_345_670, { unit: 'toman', digits: 'latn' })).toBe('1,234,567 تومان');
    expect(formatMoney('99999999999999999990', { digits: 'latn' })).toBe('99,999,999,999,999,999,990 ریال');
  });

  it('normalises Persian text', () => {
    expect(normalizePersian('علي  كريمي')).toBe('علی کریمی');
    expect(normalizePersian('مي‌خواهم')).toBe('می خواهم');
    expect(normalizePersian('ABC ۱۲۳')).toBe('abc 123');
    expect(normalizePersian('مُحَمَّد')).toBe('محمد');
  });

  it('validates national ids', () => {
    expect(isValidNationalId('0499370899')).toBe(true);
    expect(isValidNationalId('۰۴۹۹۳۷۰۸۹۹')).toBe(true);
    expect(isValidNationalId('0499370898')).toBe(false);
    expect(isValidNationalId('1111111111')).toBe(false);
  });
});
