import { describe, expect, it } from 'vitest';
import { convertCell, excelSerialToIso, mapRows, type ImportTemplate } from '../../src/core/imports/import.service.js';
import { readCsv, readSpreadsheet } from '../../src/core/imports/spreadsheet.js';
import { xlsx } from '../helpers/xlsx.js';

const col = (type: 'text' | 'integer' | 'decimal' | 'money' | 'date' | 'boolean' | 'enum', extra = {}) => ({ key: 'x', header: 'ستون', required: false, type, ...extra });

describe('spreadsheet import', () => {
  it('reads xlsx (deflate, shared strings, rich text, relationships) and CSV', () => {
    const b = xlsx([['کد', 'عنوان'], ['P-1', 'پل & تونل'], [null, null], [12, 'دوم']]);
    expect(readSpreadsheet(b, 'a.xlsx')).toEqual([['کد', 'عنوان'], ['P-1', 'پل & تونل'], [], ['12', 'دوم']]);
    expect(readCsv('﻿a,b\r\n"x, y","q""z"\n')).toEqual([['a', 'b'], ['x, y', 'q"z']]);
    expect(readCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(() => readSpreadsheet(Buffer.from('nope'), 'a.xls')).toThrow('xlsx');
  });

  it('converts cells by type: Persian digits, Jalali dates, Excel serials, enums', () => {
    expect(convertCell(col('money'), '۱٬۲۵۰٬۰۰۰')).toEqual({ value: '1250000' });
    expect(convertCell(col('money'), '-5')).toHaveProperty('error');
    expect(convertCell(col('integer'), '12.0')).toEqual({ value: '12' });
    expect(convertCell(col('decimal'), '۲٫۵')).toEqual({ value: '2.5' });
    expect(convertCell(col('date'), '۱۴۰۵/۰۷/۲۳')).toEqual({ value: '2026-10-15' });
    expect(convertCell(col('date'), '2026/1/5')).toEqual({ value: '2026-01-05' });
    expect(convertCell(col('date'), '46310')).toEqual({ value: '2026-10-15' });
    expect(convertCell(col('date'), '1405/13/01')).toHaveProperty('error');
    expect(convertCell(col('boolean'), 'بله')).toEqual({ value: 'true' });
    expect(convertCell(col('enum', { values: { 'در حال اجرا': 'active' } }), 'در حال اجرا')).toEqual({ value: 'active' });
    expect(convertCell(col('enum', { values: { 'در حال اجرا': 'active' } }), 'active')).toEqual({ value: 'active' });
    expect(convertCell(col('text', { required: true }), '  ')).toEqual({ error: '«ستون» الزامی است' });
    expect(excelSerialToIso(60)).toBe('1900-02-28'); // Excel's phantom 29 Feb 1900 collapses
  });

  it('maps headers by text (ignoring a trailing *) and reports row numbers', () => {
    const t: ImportTemplate = { key: 'm.t', title: { fa: 't' }, permission: 'm.p', columns: [
      { key: 'code', header: 'کد', required: true, type: 'text' },
      { key: 'start', header: 'شروع', required: false, type: 'date' },
    ] };
    const r = mapRows(t, [[], ['شروع', 'کد *', 'اضافه'], ['1405/01/01', 'A'], [], ['bad', 'B']]);
    expect(r.ignored).toEqual(['اضافه']);
    expect(r.rows).toEqual([{ row: 3, values: { code: 'A', start: '2026-03-21' } }, { row: 5, values: { code: 'B' } }]);
    expect(r.errors).toEqual([{ row: 5, column: 'start', message: expect.stringContaining('تاریخ معتبر نیست') }]);
    expect(mapRows(t, [['شروع']]).errors[0]!.message).toBe('ستون «کد» در سطر عنوان یافت نشد');
  });
});
