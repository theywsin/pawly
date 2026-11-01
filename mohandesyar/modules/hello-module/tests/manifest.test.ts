import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '@mohandesyar/module-sdk';
import { lintMigration } from '@mohandesyar/module-package';
import { createNoteInput } from '../backend/src/notes.js';

const root = join(import.meta.dirname, '..');

describe('hello-module', () => {
  it('has a valid manifest', () => {
    const r = parseManifest(JSON.parse(readFileSync(join(root, 'module.manifest.json'), 'utf8')));
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it('ships migrations that pass the installer lint', async () => {
    const sql = readFileSync(join(root, 'migrations/0001_notes.sql'), 'utf8');
    expect(await lintMigration('0001_notes.sql', sql, 'hello_module_')).toEqual([]);
  });

  it('validates note input with Persian messages', () => {
    expect(createNoteInput.safeParse({ title: '  ' }).success).toBe(false);
    const r = createNoteInput.safeParse({ title: 'x'.repeat(201) });
    expect(r.success ? '' : r.error.issues[0]?.message).toContain('۲۰۰');
    expect(createNoteInput.parse({ title: ' بازدید ' })).toEqual({ title: 'بازدید', body: '' });
  });
});
