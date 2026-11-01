import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '@mohandesyar/module-sdk';
import { lintMigration } from '@mohandesyar/module-package';
import { contactInput, interactionInput, leadInput, opportunityInput } from '../backend/src/inputs.js';
import { DEFAULT_STAGES } from '../backend/src/logic.js';

const root = join(import.meta.dirname, '..');

describe('crm package', () => {
  it('has a valid manifest', () => {
    const r = parseManifest(JSON.parse(readFileSync(join(root, 'module.manifest.json'), 'utf8')));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it('ships migrations that pass the installer lint', async () => {
    for (const f of readdirSync(join(root, 'migrations'))) expect(await lintMigration(f, readFileSync(join(root, 'migrations', f), 'utf8'), 'crm_')).toEqual([]);
  });

  it('default pipeline has open, won and lost stages with rising probability', () => {
    const open = DEFAULT_STAGES.filter((s) => s.kind === 'open').map((s) => s.probability);
    expect(open).toEqual([...open].sort((a, b) => a - b));
    expect(DEFAULT_STAGES.filter((s) => s.kind === 'won')).toHaveLength(1);
    expect(DEFAULT_STAGES.filter((s) => s.kind === 'lost')).toHaveLength(1);
  });

  it('validates input', () => {
    expect(leadInput.safeParse({ title: 'سرنخ', source: 'unknown' }).success).toBe(false);
    expect(leadInput.safeParse({ title: 'سرنخ', source: 'tender', score: 120 }).success).toBe(false);
    expect(contactInput.safeParse({ fullName: 'علی', email: 'not-mail' }).success).toBe(false);
    expect(interactionInput.safeParse({ kind: 'call', occurredOn: '2025-01-01', summary: 'تماس' }).success).toBe(false);
    expect(opportunityInput.safeParse({ title: 'فرصت', accountId: 'x' }).success).toBe(false);
  });
});
