import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '@mohandesyar/module-sdk';
import { lintMigration } from '@mohandesyar/module-package';
import { definitionInput } from '../backend/src/inputs.js';

const root = join(import.meta.dirname, '..');

describe('kpi package', () => {
  it('has a valid manifest', () => {
    const r = parseManifest(JSON.parse(readFileSync(join(root, 'module.manifest.json'), 'utf8')));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
  it('ships migrations that pass the installer lint and have no payment field', async () => {
    for (const f of readdirSync(join(root, 'migrations'))) {
      const sql = readFileSync(join(root, 'migrations', f), 'utf8');
      expect(await lintMigration(f, sql, 'kpi_')).toEqual([]);
      expect(sql.replace(/^--.*$/gm, '')).not.toMatch(/\b(amount|paid|payment|payroll|salary)\w*\s+(numeric|text|boolean|int)/i);
    }
  });
  it('validates definitions, including the formula', () => {
    const ok = { code: 'Progress_Rate', name: 'نرخ پیشرفت', direction: 'higher', level: 'project', frequency: 'monthly', source: 'formula', formula: 'done / planned * 100' };
    expect(definitionInput.parse(ok).code).toBe('progress_rate');
    expect(definitionInput.safeParse({ ...ok, formula: 'require("fs")' }).success).toBe(false);
    expect(definitionInput.safeParse({ ...ok, source: 'provider' }).success).toBe(false); // provider key required
    expect(definitionInput.safeParse({ ...ok, goodPct: 80, warningPct: 90 }).success).toBe(false);
    expect(definitionInput.parse({ ...ok, source: 'manual' }).formula).toBeNull();
  });
});
