import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '@mohandesyar/module-sdk';
import { lintMigration } from '@mohandesyar/module-package';
import { compareQuotes, lineAmount, qty, qtyText, threeWayMatch } from '../backend/src/calc.js';

const root = join(import.meta.dirname, '..');

describe('procurement package', () => {
  it('has a valid manifest and lint-clean migrations', async () => {
    const r = parseManifest(JSON.parse(readFileSync(join(root, 'module.manifest.json'), 'utf8')));
    expect(r.ok ? [] : r.errors).toEqual([]);
    for (const f of readdirSync(join(root, 'migrations'))) expect(await lintMigration(f, readFileSync(join(root, 'migrations', f), 'utf8'), 'procurement_')).toEqual([]);
  });
});

describe('quantities and amounts', () => {
  it('is exact to three decimals and rounds amounts to the rial', () => {
    expect(qty('12.5')).toBe(12500n);
    expect(qty('0.125')).toBe(125n);
    expect(qtyText(12500n)).toBe('12.5');
    expect(qtyText(3000n)).toBe('3');
    expect(lineAmount('2.5', '3')).toBe(8n); // 7.5 → 8
    expect(lineAmount('1000000', '9000000000')).toBe(9_000_000_000_000_000n);
  });
});

describe('three-way match', () => {
  const order = [
    { id: 'L1', description: 'میلگرد ۱۶', quantity: '10', unitPrice: '1000', accepted: '6', invoiced: '0' },
    { id: 'L2', description: 'سیمان', quantity: '5', unitPrice: '200', accepted: '5', invoiced: '2' },
  ];
  it('passes when invoiced ≤ accepted − invoiced and prices ≤ order', () => {
    const r = threeWayMatch(order, [{ orderLineId: 'L1', quantity: '6', unitPrice: '1000' }, { orderLineId: 'L2', quantity: '3', unitPrice: '190' }], '6570');
    expect(r).toEqual({ ok: true, issues: [], computed: '6570' });
  });
  it('flags unreceived quantities, over-ordering, higher prices and a wrong total', () => {
    const r = threeWayMatch(order, [{ orderLineId: 'L1', quantity: '8', unitPrice: '1100' }, { orderLineId: 'L2', quantity: '4', unitPrice: '200' }, { orderLineId: 'X', quantity: '1', unitPrice: '1' }], '1');
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => `${i.orderLineId}:${i.kind}`)).toEqual(['L1:not_received', 'L1:price', 'L2:over_order', 'X:unknown_line', 'null:total']);
    expect(r.issues[0]!.message).toContain('۶');
  });
});

describe('quote comparison', () => {
  it('ranks complete quotes by total and marks the lowest price per line', () => {
    const lines = [{ id: 'a', quantity: '10' }, { id: 'b', quantity: '2' }];
    const c = compareQuotes(lines, [
      { supplierId: 's1', supplierName: 'الف', deliveryDays: 5, prices: { a: '100', b: '500' } },
      { supplierId: 's2', supplierName: 'ب', deliveryDays: 3, prices: { a: '90', b: '700' } },
      { supplierId: 's3', supplierName: 'ج', deliveryDays: 1, prices: { a: '50', b: null } },
    ]);
    expect(c.totals.map((t) => [t.supplierId, t.total, t.complete])).toEqual([['s1', '2000', true], ['s2', '2300', true], ['s3', '500', false]]);
    expect(c.lowest).toBe('s1');
    expect(c.lowestPerLine).toEqual({ a: ['s3'], b: ['s1'] });
  });
});
