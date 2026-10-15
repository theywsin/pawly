import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '@mohandesyar/module-sdk';
import { lintMigration } from '@mohandesyar/module-package';
import { candidateInput, stageInput } from '../backend/src/inputs.js';
import { addMonths, toTsQuery } from '../backend/src/logic.js';

const root = join(import.meta.dirname, '..');

describe('recruitment package', () => {
  it('has a valid manifest', () => {
    const r = parseManifest(JSON.parse(readFileSync(join(root, 'module.manifest.json'), 'utf8')));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
  it('ships migrations that pass the installer lint', async () => {
    for (const f of readdirSync(join(root, 'migrations'))) expect(await lintMigration(f, readFileSync(join(root, 'migrations', f), 'utf8'), 'recruitment_')).toEqual([]);
  });
  it('stores no protected attributes', () => {
    const sql = readFileSync(join(root, 'migrations', '0001_recruitment.sql'), 'utf8').replace(/^--.*$/gm, '');
    for (const word of ['birth', 'age', 'gender', 'sex', 'marital', 'religion', 'ethnic', 'health', 'disab', 'national_id']) expect(sql).not.toMatch(new RegExp(`\\b${word}\\w*\\s+(text|date|int|boolean|smallint)`, 'i'));
  });
  it('validates a candidate', () => {
    const ok = { fullName: 'سارا محمدی', mobile: '۰۹۱۲ ۱۲۳ ۴۵۶۷', consentOn: '2025-01-10' };
    const r = candidateInput.safeParse(ok);
    expect(r.success && r.data.mobile).toBe('09121234567');
    expect(candidateInput.safeParse({ ...ok, mobile: '' }).success).toBe(false); // needs mobile or e-mail
    expect(candidateInput.safeParse({ ...ok, mobile: '12345' }).success).toBe(false);
    expect(candidateInput.safeParse({ ...ok, email: 'A@B.CO' }).data?.email).toBe('a@b.co');
    expect(candidateInput.safeParse({ fullName: 'x', mobile: '09121234567', consentOn: '2025-01-10' }).success).toBe(false);
    expect(candidateInput.safeParse({ ...ok, experiences: [{ employer: 'مشاور الف', title: 'طراح', startedOn: '2024-01-01', endedOn: '2023-01-01' }] }).success).toBe(false);
  });
  it('requires a complete pipeline', () => {
    const s = (kind: string) => ({ name: 'مرحله', kind });
    expect(stageInput.safeParse({ stages: [s('open'), s('hired'), s('rejected')] }).success).toBe(true);
    expect(stageInput.safeParse({ stages: [s('open'), s('open'), s('rejected')] }).success).toBe(false);
  });
  it('computes retention dates and safe search queries', () => {
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
    expect(addMonths('2025-01-31', 1)).toBe('2025-02-28');
    expect(addMonths('2025-03-15', 24)).toBe('2027-03-15');
    expect(toTsQuery('طراح سازه')).toBe('طراح:* & سازه:*');
    expect(toTsQuery("x' | !(y)")).toBe('x:* & y:*');
    expect(toTsQuery('   ')).toBeNull();
    expect(toTsQuery('مي‌خواهم')).toBe('می:* & خواهم:*');
  });
});
