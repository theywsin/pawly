import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '@mohandesyar/module-sdk';
import { lintMigration } from '@mohandesyar/module-package';
import { DEFAULT_CHART, REQUIRED_KEYS, type ChartAccount } from '../backend/src/chart.js';
import { assetInput, invoiceInput, treasuryDocInput, voucherInput } from '../backend/src/inputs.js';

const root = join(import.meta.dirname, '..');
const U = '0e1f6c1e-6a7f-4f3e-9d6b-8f1f6f9d2a11';

describe('accounting package', () => {
  it('has a valid manifest', () => {
    const r = parseManifest(JSON.parse(readFileSync(join(root, 'module.manifest.json'), 'utf8')));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
  it('ships migrations that pass the installer lint', async () => {
    for (const f of readdirSync(join(root, 'migrations'))) expect(await lintMigration(f, readFileSync(join(root, 'migrations', f), 'utf8'), 'accounting_')).toEqual([]);
  });
  it('default chart: unique nested codes, every system key once on a subsidiary', () => {
    const codes: string[] = [];
    const keys: string[] = [];
    const walk = (a: ChartAccount, parent: string, depth: number) => {
      codes.push(a.code);
      expect(a.code.startsWith(parent)).toBe(true);
      if (a.key) {
        expect(depth).toBe(2);
        keys.push(a.key);
      }
      for (const c of a.children ?? []) walk(c, a.code, depth + 1);
    };
    for (const g of DEFAULT_CHART) walk(g, '', 0);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of REQUIRED_KEYS) expect(keys).toContain(k);
  });
  it('validates input', () => {
    const line = { accountId: U, debit: '1000', credit: '0' };
    expect(voucherInput.safeParse({ date: '2026-10-18', lines: [line, { ...line, debit: '0', credit: '1000' }] }).success).toBe(true);
    expect(voucherInput.safeParse({ date: '2026-10-18', lines: [{ ...line, credit: '5' }, line] }).success).toBe(false);
    expect(voucherInput.safeParse({ date: '2026-10-18', lines: [line] }).success).toBe(false);
    expect(invoiceInput.safeParse({ kind: 'sale', date: '2026-10-18', detailId: U, lines: [{ itemId: U, qty: '1.2345', unitPrice: '10' }] }).success).toBe(false);
    expect(invoiceInput.safeParse({ kind: 'sale', date: '2026-10-18', detailId: U, lines: [{ itemId: U, qty: '۱٫۵'.replace('٫', '.'), unitPrice: '۱۰۰۰' }] }).success).toBe(true);
    expect(treasuryDocInput.safeParse({ kind: 'payment', date: '2026-10-18', detailId: U, method: 'transfer', amount: '10' }).success).toBe(false);
    expect(treasuryDocInput.safeParse({ kind: 'receipt', date: '2026-10-18', detailId: U, method: 'cheque', amount: '10', cheque: { number: '1', dueOn: '2026-11-01', sayadId: '123' } }).success).toBe(false);
    expect(assetInput.safeParse({ code: 'A', name: 'دستگاه', acquiredOn: '2026-01-01', cost: '100', salvage: '90', openingDepreciation: '20', method: 'straight_line', usefulLifeMonths: 12 }).success).toBe(false);
  });
});
