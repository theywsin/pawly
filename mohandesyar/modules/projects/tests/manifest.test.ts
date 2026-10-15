import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '@mohandesyar/module-sdk';
import { lintMigration } from '@mohandesyar/module-package';
import { activityInput, progressInput, projectInput, riskInput } from '../backend/src/inputs.js';

const root = join(import.meta.dirname, '..');

describe('projects package', () => {
  it('has a valid manifest (including project-scoped role grants)', () => {
    const r = parseManifest(JSON.parse(readFileSync(join(root, 'module.manifest.json'), 'utf8')));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it('ships migrations that pass the installer lint', async () => {
    for (const f of readdirSync(join(root, 'migrations'))) expect(await lintMigration(f, readFileSync(join(root, 'migrations', f), 'utf8'), 'projects_')).toEqual([]);
  });

  it('validates input', () => {
    expect(projectInput.safeParse({ code: 'P1', title: 'پروژه', plannedStart: '2025-02-01', plannedFinish: '2025-01-01' }).success).toBe(false);
    expect(projectInput.safeParse({ code: 'P1', title: 'پروژه', budgetAmount: '-1' }).success).toBe(false);
    expect(activityInput.safeParse({ name: 'خاک‌برداری', durationDays: '2.5' }).success).toBe(false);
    expect(activityInput.parse({ name: 'خاک‌برداری', durationDays: '12' }).durationDays).toBe(12);
    expect(progressInput.safeParse({ date: '2025-01-01', percent: 101 }).success).toBe(false);
    expect(riskInput.safeParse({ title: 'ریسک', probability: 6, impact: 1 }).success).toBe(false);
  });
});
