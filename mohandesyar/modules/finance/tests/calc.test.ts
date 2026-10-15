import { describe, expect, it } from 'vitest';
import { autoMatch, computeEac, parseStatement } from '../backend/src/calc.js';
import { amount, isValidIban, paymentRequestInput, transferInput } from '../backend/src/inputs.js';

describe('EAC', () => {
  const base = { bac: 10_000_000_000n, ac: 6_000_000_000n, physicalPct: 50, manualEtc: null };
  it('cpi: AC + (BAC − EV) / CPI', () => {
    const r = computeEac({ ...base, method: 'cpi' });
    expect(r.ev).toBe(5_000_000_000n);
    expect(r.cpi).toBeCloseTo(0.8333, 3);
    expect(r.eac).toBe(12_000_000_000n); // 6 + 5 / 0.8333
    expect(r.vac).toBe(-2_000_000_000n);
  });
  it('budget_rate and manual ETC', () => {
    expect(computeEac({ ...base, method: 'budget_rate' }).eac).toBe(11_000_000_000n);
    expect(computeEac({ ...base, method: 'manual_etc' }).reason).toContain('ETC');
    expect(computeEac({ ...base, method: 'manual_etc', manualEtc: 3_500_000_000n }).eac).toBe(9_500_000_000n);
  });
  it('reports why it cannot compute instead of inventing a number', () => {
    expect(computeEac({ ...base, physicalPct: null, method: 'cpi' })).toMatchObject({ eac: null, reason: expect.stringContaining('پیشرفت') });
    expect(computeEac({ ...base, physicalPct: 0, method: 'cpi' }).eac).toBeNull();
  });
  it('stays exact beyond 2^53 rial', () => {
    const r = computeEac({ bac: 90_000_000_000_000_001n, ac: 1n, physicalPct: 100, manualEtc: null, method: 'budget_rate' });
    expect(r.eac).toBe(1n);
  });
});

describe('statement import', () => {
  it('reads Jalali and ISO dates, Persian digits, separators and withdrawals', () => {
    const r = parseStatement('تاریخ,مبلغ,پیگیری,شرح\n1405/07/01,"۱۲٬۰۰۰٬۰۰۰",A1,واریز مشتری\n2026-09-24;-3,500,000;B2;کارمزد\n1405/07/03\t(500000)\tC3\tچک\nبد,1,,');
    expect(r.rows.map((x) => [x.occurredOn, x.amount, x.reference])).toEqual([
      ['2026-09-23', 12_000_000n, 'A1'],
      ['2026-09-24', -3_500_000n, 'B2'],
      ['2026-09-25', -500_000n, 'C3'],
    ]);
    expect(r.errors).toEqual([{ line: 5, message: 'تاریخ «بد» معتبر نیست' }]);
  });
  it('auto-matches by amount and date, prefers references, leaves ties for the user', () => {
    const lines = [
      { id: 'l1', occurredOn: '2026-09-23', amount: 100n, reference: 'R9' },
      { id: 'l2', occurredOn: '2026-09-23', amount: -50n, reference: '' },
      { id: 'l3', occurredOn: '2026-09-23', amount: 70n, reference: '' },
    ];
    const txs = [
      { id: 't1', occurredOn: '2026-09-22', signed: 100n, reference: '' },
      { id: 't2', occurredOn: '2026-09-25', signed: 100n, reference: 'R9' },
      { id: 't3', occurredOn: '2026-09-23', signed: -50n, reference: '' },
      { id: 't4', occurredOn: '2026-09-22', signed: 70n, reference: '' },
      { id: 't5', occurredOn: '2026-09-24', signed: 70n, reference: '' },
      { id: 't6', occurredOn: '2026-10-30', signed: -50n, reference: '' },
    ];
    expect(autoMatch(lines, txs)).toEqual([{ lineId: 'l1', txId: 't2' }, { lineId: 'l2', txId: 't3' }]);
  });
});

describe('inputs', () => {
  it('validates IBAN checksums and rial amounts as strings', () => {
    expect(isValidIban('IR062960000000100324200001')).toBe(true);
    expect(isValidIban('IR062960000000100324200002')).toBe(false);
    expect(amount.parse('۱٬۲۰۰٬۰۰۰')).toBe('1200000');
    expect(amount.safeParse('0').success).toBe(false);
    expect(amount.safeParse('12.5').success).toBe(false);
    expect(amount.safeParse('9000000000000000001').success).toBe(false); // beyond numeric(20,0) headroom
  });
  it('rejects a transfer to the same account', () => {
    const id = '0190a7d4-6c1e-7a00-8000-000000000001';
    expect(transferInput.safeParse({ fromAccountId: id, toAccountId: id, amount: '1', occurredOn: '2026-01-01' }).success).toBe(false);
    expect(paymentRequestInput.safeParse({ counterpartyId: id, amount: '1', dueOn: '2026-01-01', description: 'x', categoryId: id }).success).toBe(false);
  });
});
