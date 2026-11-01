import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tar from 'tar';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateSigningKey, packDirectory, PackageError, signPackage, verifyPackage, verifyInstalledDirectory, DEFAULT_LIMITS } from '../src/package.js';

const manifest = {
  manifestVersion: 1,
  id: 'demo',
  name: { fa: 'نمونه' },
  version: '1.0.0',
  description: { fa: 'نمونه' },
  publisher: { id: 'test', name: 'Test' },
  coreVersionRange: '^1.0.0',
  backend: { entry: 'backend/index.mjs' },
  tablePrefix: 'demo_',
  entitlement: { key: 'mod.demo' },
};

let work: string;
beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), 'pkgtest-'));
});
afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

async function stage(extra?: (dir: string) => Promise<void>) {
  const dir = join(work, 'stage');
  await mkdir(join(dir, 'backend'), { recursive: true });
  await mkdir(join(dir, 'migrations'), { recursive: true });
  await writeFile(join(dir, 'module.manifest.json'), JSON.stringify(manifest));
  await writeFile(join(dir, 'backend/index.mjs'), 'export default {};\n');
  await writeFile(join(dir, 'migrations/0001_init.sql'), 'CREATE TABLE demo_items (id uuid primary key);\n');
  await extra?.(dir);
  return dir;
}

async function signed() {
  const key = generateSigningKey();
  const pkg = join(work, 'demo.mypkg');
  await packDirectory(await stage(), pkg);
  await signPackage(pkg, key.privateKeyPem);
  return { key, pkg };
}

async function expectCode(p: Promise<unknown>, code: PackageError['code']) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof PackageError && e.code === code);
}

describe('package signing and verification', () => {
  it('verifies a correctly signed package and returns the manifest', async () => {
    const { key, pkg } = await signed();
    const v = await verifyPackage(pkg, join(work, 'out'), [key]);
    expect(v.manifest.id).toBe('demo');
    expect(v.keyId).toBe(key.keyId);
    await verifyInstalledDirectory(v.dir);
  });

  it('packs deterministically', async () => {
    const dir = await stage();
    await packDirectory(dir, join(work, 'a.mypkg'));
    await packDirectory(dir, join(work, 'b.mypkg'));
    expect(Buffer.compare(await readFile(join(work, 'a.mypkg')), await readFile(join(work, 'b.mypkg')))).toBe(0);
  });

  it('rejects an unsigned package', async () => {
    const pkg = join(work, 'u.mypkg');
    await packDirectory(await stage(), pkg);
    await expectCode(verifyPackage(pkg, join(work, 'out'), [generateSigningKey()]), 'MISSING_SIGNATURE');
  });

  it('rejects a package signed by an untrusted key', async () => {
    const { pkg } = await signed();
    await expectCode(verifyPackage(pkg, join(work, 'out'), [generateSigningKey()]), 'UNKNOWN_KEY');
  });

  it('rejects a forged signature claiming a trusted key id', async () => {
    const trusted = generateSigningKey();
    const { pkg } = await signed();
    const ex = join(work, 'ex');
    await mkdir(ex);
    await tar.x({ file: pkg, cwd: ex });
    const sig = JSON.parse(await readFile(join(ex, 'SIGNATURE'), 'utf8'));
    await writeFile(join(ex, 'SIGNATURE'), JSON.stringify({ ...sig, keyId: trusted.keyId }));
    await tar.c({ gzip: true, file: pkg, cwd: ex }, ['module.manifest.json', 'backend', 'migrations', 'CHECKSUMS', 'SIGNATURE']);
    await expectCode(verifyPackage(pkg, join(work, 'out'), [trusted]), 'BAD_SIGNATURE');
  });

  it('rejects a file modified after signing', async () => {
    const { key, pkg } = await signed();
    const ex = join(work, 'ex');
    await mkdir(ex);
    await tar.x({ file: pkg, cwd: ex });
    await writeFile(join(ex, 'backend/index.mjs'), 'process.exit(1)\n');
    await tar.c({ gzip: true, file: pkg, cwd: ex }, ['module.manifest.json', 'backend', 'migrations', 'CHECKSUMS', 'SIGNATURE']);
    await expectCode(verifyPackage(pkg, join(work, 'out'), [key]), 'CHECKSUM_MISMATCH');
  });

  it('rejects a file added after signing', async () => {
    const { key, pkg } = await signed();
    const ex = join(work, 'ex');
    await mkdir(ex);
    await tar.x({ file: pkg, cwd: ex });
    await writeFile(join(ex, 'backend/extra.mjs'), 'export {}\n');
    await tar.c({ gzip: true, file: pkg, cwd: ex }, ['module.manifest.json', 'backend', 'migrations', 'CHECKSUMS', 'SIGNATURE']);
    await expectCode(verifyPackage(pkg, join(work, 'out'), [key]), 'UNLISTED_FILE');
  });

  it('rejects path traversal entries before extracting anything', async () => {
    const src = join(work, 'evil');
    await mkdir(join(src, 'a'), { recursive: true });
    await writeFile(join(src, 'x.txt'), 'x');
    const pkg = join(work, 'evil.mypkg');
    await tar.c({ gzip: true, file: pkg, cwd: join(src, 'a'), preservePaths: true }, ['../x.txt']);
    await expectCode(verifyPackage(pkg, join(work, 'out'), [generateSigningKey()]), 'UNSAFE_ENTRY');
  });

  it('rejects symlinks inside the archive', async () => {
    const src = join(work, 'ln');
    await mkdir(join(src, 'backend'), { recursive: true });
    await symlink('/etc/passwd', join(src, 'backend/index.mjs'));
    const pkg = join(work, 'ln.mypkg');
    await tar.c({ gzip: true, file: pkg, cwd: src }, ['backend']);
    await expectCode(verifyPackage(pkg, join(work, 'out'), [generateSigningKey()]), 'UNSAFE_ENTRY');
  });

  it('rejects oversized content (zip-bomb guard)', async () => {
    const dir = await stage(async (d) => writeFile(join(d, 'backend/big.bin'), Buffer.alloc(2 * 1024 * 1024)));
    const pkg = join(work, 'big.mypkg');
    await packDirectory(dir, pkg);
    await expectCode(verifyPackage(pkg, join(work, 'out'), [generateSigningKey()], { ...DEFAULT_LIMITS, maxExtractedBytes: 1024 * 1024 }), 'TOO_LARGE');
  });

  it('rejects a garbage file', async () => {
    const pkg = join(work, 'junk.mypkg');
    await writeFile(pkg, 'not a tarball');
    await expectCode(verifyPackage(pkg, join(work, 'out'), [generateSigningKey()]), 'BAD_ARCHIVE');
  });

  it('rejects an invalid manifest even when signed', async () => {
    const key = generateSigningKey();
    const dir = await stage(async (d) => writeFile(join(d, 'module.manifest.json'), JSON.stringify({ ...manifest, tablePrefix: 'x_' })));
    const pkg = join(work, 'bad.mypkg');
    await expect(packDirectory(dir, pkg)).rejects.toThrow(PackageError);
    void key;
  });

  it('detects tampering of an installed directory', async () => {
    const { key, pkg } = await signed();
    const v = await verifyPackage(pkg, join(work, 'out'), [key]);
    await writeFile(join(v.dir, 'backend/index.mjs'), 'tampered');
    await expectCode(verifyInstalledDirectory(v.dir), 'CHECKSUM_MISMATCH');
  });
});
