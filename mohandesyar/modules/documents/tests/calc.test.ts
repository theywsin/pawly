import { describe, expect, it } from 'vitest';
import { addYears, parseTags } from '../backend/src/calc.js';

describe('documents calc', () => {
  it('adds whole years, clamping 29 February', () => {
    expect(addYears('2026-10-15', 1)).toBe('2027-10-15');
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28');
    expect(addYears('2028-02-29', 4)).toBe('2032-02-29');
  });
  it('parses tags from Persian or Latin commas', () => {
    expect(parseTags('سازه، عرشه,  سازه ,')).toEqual(['سازه', 'عرشه']);
  });
});
