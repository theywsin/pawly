import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, toCsv, toXlsx, type ExportColumn } from '@mohandesyar/ui';

interface Row { code: string; title: string; amount: string; note: string | null }
const rows: Row[] = [
  { code: 'ق-۱', title: 'اجرای سوله، فاز "الف"', amount: '12500000000', note: 'خط اول\nخط دوم' },
  { code: 'Q-2', title: 'نظارت <پروژه> & طراحی', amount: '1234567890123456789', note: null },
];
const columns: ExportColumn<Row>[] = [
  { header: 'شماره', value: (r) => r.code },
  { header: 'عنوان', value: (r) => r.title },
  { header: 'مبلغ (ریال)', value: (r) => r.amount, kind: 'number' },
  { header: 'یادداشت', value: (r) => r.note },
];

describe('export', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('CSV has a BOM and escapes quotes, commas and newlines', () => {
    const csv = toCsv(columns, rows);
    expect(csv.startsWith('﻿شماره,عنوان,مبلغ (ریال),یادداشت\r\n')).toBe(true);
    expect(csv).toContain('ق-۱,"اجرای سوله، فاز ""الف""",12500000000,"خط اول\nخط دوم"');
    expect(csv).toContain('Q-2,نظارت <پروژه> & طراحی,1234567890123456789,\r\n');
  });

  it('XLSX opens in a real reader: RTL sheet, Persian text, numeric amounts, long amounts kept as text', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xlsx-'));
    const file = join(dir, 'out.xlsx');
    writeFileSync(file, toXlsx('قراردادها', columns, rows));
    const out = execFileSync('python3', ['-I', '-c', `
import json, sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1]); ws = wb.active
print(json.dumps({"title": ws.title, "rtl": ws.sheet_view.rightToLeft, "rows": [[c.value for c in r] for r in ws.iter_rows()]}, ensure_ascii=False))
`, file]).toString();
    const r = JSON.parse(out);
    expect(r.title).toBe('قراردادها');
    expect(r.rtl).toBe(true);
    expect(r.rows).toEqual([
      ['شماره', 'عنوان', 'مبلغ (ریال)', 'یادداشت'],
      ['ق-۱', 'اجرای سوله، فاز "الف"', 12500000000, 'خط اول\nخط دوم'],
      ['Q-2', 'نظارت <پروژه> & طراحی', '1234567890123456789', null],
    ]);
  });
});
