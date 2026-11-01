import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '@mohandesyar/module-sdk';
import { lintMigration } from '@mohandesyar/module-package';
import { meetingInput, resolutionUpdateInput } from '../backend/src/inputs.js';

const root = join(import.meta.dirname, '..');

describe('meetings package', () => {
  it('has a valid manifest', () => {
    const r = parseManifest(JSON.parse(readFileSync(join(root, 'module.manifest.json'), 'utf8')));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });
  it('ships migrations that pass the installer lint', async () => {
    for (const f of readdirSync(join(root, 'migrations'))) expect(await lintMigration(f, readFileSync(join(root, 'migrations', f), 'utf8'), 'meetings_')).toEqual([]);
  });
  it('validates input', () => {
    const ok = { title: 'جلسه', date: '2025-05-01', startTime: '09:00', endTime: '10:30' };
    expect(meetingInput.safeParse(ok).success).toBe(true);
    expect(meetingInput.safeParse({ ...ok, startTime: '9:00' }).success).toBe(false);
    expect(meetingInput.safeParse({ ...ok, endTime: '08:00' }).success).toBe(false);
    expect(meetingInput.safeParse({ ...ok, onlineLink: 'not a url' }).success).toBe(false);
    expect(resolutionUpdateInput.safeParse({ status: 'done' }).success).toBe(false);
  });
});
