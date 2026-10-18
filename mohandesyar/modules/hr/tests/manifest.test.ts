import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '@mohandesyar/module-sdk';
import { lintMigration } from '@mohandesyar/module-package';
import { contractInput, employeeInput, leaveInput } from '../backend/src/inputs.js';
import { jalaliYear } from '../backend/src/logic.js';

const root = join(import.meta.dirname, '..');

describe('hr package', () => {
  it('has a valid manifest', () => {
    const r = parseManifest(JSON.parse(readFileSync(join(root, 'module.manifest.json'), 'utf8')));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
  it('ships migrations that pass the installer lint', async () => {
    for (const f of readdirSync(join(root, 'migrations'))) expect(await lintMigration(f, readFileSync(join(root, 'migrations', f), 'utf8'), 'hr_')).toEqual([]);
  });
  it('validates employees', () => {
    const ok = { personnelNo: '۱۰۲۴', fullName: 'مریم احمدی', hiredOn: '2025-03-21' };
    expect(employeeInput.parse(ok).personnelNo).toBe('1024');
    expect(employeeInput.parse({ ...ok, nationalId: '۰۰۱۳۵۴۲۴۱۹' }).nationalId).toBe('0013542419');
    expect(employeeInput.safeParse({ ...ok, nationalId: '0013542418' }).success).toBe(false); // checksum
    expect(employeeInput.safeParse({ ...ok, mobile: '0912' }).success).toBe(false);
  });
  it('validates contracts and leave', () => {
    expect(contractInput.safeParse({ kind: 'fixed_term', startsOn: '2025-03-21' }).success).toBe(false); // needs an end date
    expect(contractInput.safeParse({ kind: 'permanent', startsOn: '2025-03-21' }).success).toBe(true);
    expect(contractInput.safeParse({ kind: 'project', startsOn: '2025-03-21', endsOn: '2025-01-01' }).success).toBe(false);
    expect(leaveInput.safeParse({ typeId: '0190a7d4-6c1e-7a00-8000-000000000000', startsOn: '2025-05-02', endsOn: '2025-05-01' }).success).toBe(false);
  });
  it('maps dates to the Jalali leave year', () => {
    expect(jalaliYear('2025-03-20')).toBe(1403);
    expect(jalaliYear('2025-03-21')).toBe(1404);
  });
});
