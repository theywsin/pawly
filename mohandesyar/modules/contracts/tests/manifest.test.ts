import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '@mohandesyar/module-sdk';
import { lintMigration } from '@mohandesyar/module-package';
import { amendmentInput, contractInput, statementInput } from '../backend/src/inputs.js';

const root = join(import.meta.dirname, '..');

describe('contracts package', () => {
  it('has a valid manifest', () => {
    const r = parseManifest(JSON.parse(readFileSync(join(root, 'module.manifest.json'), 'utf8')));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it('ships migrations that pass the installer lint', async () => {
    for (const f of readdirSync(join(root, 'migrations'))) {
      expect(await lintMigration(f, readFileSync(join(root, 'migrations', f), 'utf8'), 'contracts_')).toEqual([]);
    }
  });

  it('validates contract input', () => {
    const ok = { code: 'C-1', title: 'قرارداد', kind: 'employer', direction: 'income', counterpartyName: 'کارفرما', initialAmount: '1000' };
    expect(contractInput.safeParse(ok).success).toBe(true);
    expect(contractInput.safeParse({ ...ok, initialAmount: '-5' }).success).toBe(false);
    expect(contractInput.safeParse({ ...ok, prepaymentAmount: '2000' }).success).toBe(false);
    expect(contractInput.safeParse({ ...ok, startOn: '2025-02-01', endOn: '2025-01-01' }).success).toBe(false);
    expect(contractInput.safeParse({ ...ok, goodPerformancePct: '101' }).success).toBe(false);
    expect(contractInput.parse({ ...ok, initialAmount: 1000 }).initialAmount).toBe('1000');
  });

  it('requires a new end date for renewals and a delta for amount amendments', () => {
    expect(amendmentInput.safeParse({ kind: 'renewal', title: 'تمدید', signedOn: '2025-01-01' }).success).toBe(false);
    expect(amendmentInput.safeParse({ kind: 'amount', title: 'افزایش', signedOn: '2025-01-01' }).success).toBe(false);
    expect(amendmentInput.safeParse({ kind: 'amount', title: 'کاهش', amountDelta: '-100', signedOn: '2025-01-01' }).success).toBe(true);
    expect(statementInput.safeParse({ periodTo: '2025-01-01', cumulativeGross: '1.5' }).success).toBe(false);
  });
});
