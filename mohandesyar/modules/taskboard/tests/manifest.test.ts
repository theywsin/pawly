import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '@mohandesyar/module-sdk';
import { lintMigration } from '@mohandesyar/module-package';
import { dutyInput, reportInput, reviewInput, taskInput } from '../backend/src/inputs.js';

const root = join(import.meta.dirname, '..');
const U = '0e1f6c1e-6a7f-4f3e-9d6b-8f1f6f9d2a11';

describe('taskboard package', () => {
  it('has a valid manifest', () => {
    const r = parseManifest(JSON.parse(readFileSync(join(root, 'module.manifest.json'), 'utf8')));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
  it('ships migrations that pass the installer lint', async () => {
    for (const f of readdirSync(join(root, 'migrations'))) expect(await lintMigration(f, readFileSync(join(root, 'migrations', f), 'utf8'), 'taskboard_')).toEqual([]);
  });
  it('validates input', () => {
    const t = { title: 'بازدید کارگاه', assigneeIds: [U], dueDate: '2026-10-18', dueTime: '10:00' };
    expect(taskInput.safeParse(t).success).toBe(true);
    expect(taskInput.safeParse({ ...t, assigneeIds: [] }).success).toBe(false);
    expect(taskInput.safeParse({ ...t, dueTime: '8:00' }).success).toBe(false);
    const d = { title: 'حضور', assigneeId: U, recurrence: 'weekly', dueTime: '08:00' };
    expect(dutyInput.safeParse(d).success).toBe(false);
    expect(dutyInput.safeParse({ ...d, weekdays: [6] }).success).toBe(true);
    expect(dutyInput.safeParse({ ...d, recurrence: 'monthly' }).success).toBe(false);
    expect(reviewInput.safeParse({ decision: 'approve' }).success).toBe(false);
    expect(reviewInput.safeParse({ decision: 'return' }).success).toBe(false);
    expect(reviewInput.safeParse({ decision: 'approve', score: 4 }).success).toBe(true);
    expect(reportInput.safeParse({ body: 'گزارش کار امروز', hours: 7.3 }).success).toBe(false);
  });
});
