import { describe, expect, it } from 'vitest';
import { toCsv, toXlsx } from '../src/index.js';

describe('export writers', () => {
  it('writes CSV with a BOM and quoting', () => {
    expect(toCsv([{ header: 'نام', value: (r: { n: string }) => r.n }], [{ n: 'الف, ب' }])).toBe('﻿نام\r\n"الف, ب"\r\n');
  });
  it('writes an xlsx zip whose sheet holds the cells', () => {
    const z = Buffer.from(toXlsx('برگه', [{ header: 'مبلغ', value: (r: { v: number }) => r.v, kind: 'number' }], [{ v: 1250 }]));
    expect(z.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(z.toString('utf8')).toContain('<v>1250</v>');
  });
});
