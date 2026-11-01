import { mkdtemp, readFile, rm, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyPackage, keyIdOf } from '@mohandesyar/module-package';
import { packModule } from '../src/pack.js';

let work: string;
beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'cli-'));
});
afterAll(async () => rm(work, { recursive: true, force: true }));

const cli = (...args: string[]) => execFileSync('npx', ['tsx', join(import.meta.dirname, '../src/cli.ts'), ...args], { encoding: 'utf8', stdio: 'pipe' });

describe('module CLI', () => {
  it('keygen → pack → sign → verify round trip', async () => {
    cli('keygen', '--out', join(work, 'keys'));
    const pkg = await packModule(join(import.meta.dirname, 'fixtures/demo'), join(work, 'out'));
    expect(pkg.endsWith('demo-1.2.3.mypkg')).toBe(true);
    const { readdirSync } = await import('node:fs');
    const keyFile = readdirSync(join(work, 'keys')).find((f) => f.endsWith('.key.pem'))!;
    const pubFile = readdirSync(join(work, 'keys')).find((f) => f.endsWith('.pub.pem'))!;
    cli('sign', pkg, '--key', join(work, 'keys', keyFile));
    expect(cli('verify', pkg, '--pub', join(work, 'keys', pubFile))).toContain('OK demo@1.2.3');

    const pem = await readFile(join(work, 'keys', pubFile), 'utf8');
    const v = await verifyPackage(pkg, join(work, 'x'), [{ keyId: keyIdOf(pem), publicKeyPem: pem }]);
    const bundle = await readFile(join(v.dir, 'backend/index.mjs'), 'utf8');
    expect(bundle).toContain('from "@nestjs/common"'); // shared dependency stays external
    expect(bundle).toContain('hello '); // local helper bundled
    const meta = JSON.parse(await readFile(join(v.dir, 'migrations/meta.json'), 'utf8'));
    expect(meta).toEqual([
      { file: '0001_init.sql', kind: 'expand', down: null },
      { file: '0002_more.sql', kind: 'expand', down: '0002_more.down.sql' },
    ]);
  }, 60_000);

  it('verify fails for a package signed with a different key', async () => {
    cli('keygen', '--out', join(work, 'other'));
    const { readdirSync } = await import('node:fs');
    const pub = readdirSync(join(work, 'other')).find((f) => f.endsWith('.pub.pem'))!;
    expect(() => cli('verify', join(work, 'out/demo-1.2.3.mypkg'), '--pub', join(work, 'other', pub))).toThrow(/UNKNOWN_KEY/);
  }, 60_000);

  it('refuses to pack a module whose migration touches core tables', async () => {
    const dir = join(work, 'bad');
    await cp(join(import.meta.dirname, 'fixtures/demo'), dir, { recursive: true });
    await writeFile(join(dir, 'migrations/0003_evil.sql'), 'DELETE FROM core_audit_log;');
    await expect(packModule(dir, join(work, 'out2'))).rejects.toThrow(/core_audit_log/);
  });
});
