import { cp, mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packModule } from '@mohandesyar/module-cli';
import { generateSigningKey, signPackage, type KeyPairPem } from '@mohandesyar/module-package';

export const HELLO_DIR = resolve(import.meta.dirname, '../../../../modules/hello-module');

/** Builds hello-module (optionally with a fixture overlay) into a package; signs it unless `sign: false`. */
export async function buildHello(opts: { fixture?: string; key?: KeyPairPem; sign?: boolean; withFrontend?: boolean } = {}): Promise<string> {
  const work = await mkdtemp(join(tmpdir(), 'hello-build-'));
  const src = join(work, 'src');
  await cp(HELLO_DIR, src, {
    recursive: true,
    filter: (p) => !/\/(node_modules|dist|fixtures|tests)(\/|$)/.test(p.slice(HELLO_DIR.length)),
  });
  // Module-private dependencies (e.g. icons) are bundled from the module's own node_modules.
  await symlink(join(HELLO_DIR, 'node_modules'), join(src, 'node_modules'));
  if (opts.withFrontend === false) await rm(join(src, 'frontend/src'), { recursive: true, force: true });
  if (opts.fixture) {
    const fx = join(HELLO_DIR, 'fixtures', opts.fixture);
    const patchFile = join(fx, 'manifest.patch.json');
    if (existsSync(patchFile)) {
      const m = JSON.parse(await readFile(join(src, 'module.manifest.json'), 'utf8'));
      await writeFile(join(src, 'module.manifest.json'), JSON.stringify({ ...m, ...JSON.parse(await readFile(patchFile, 'utf8')) }, null, 2));
    }
    await cp(fx, src, { recursive: true, filter: (p) => !p.endsWith('manifest.patch.json') });
  }
  if (opts.withFrontend === false) {
    const m = JSON.parse(await readFile(join(src, 'module.manifest.json'), 'utf8'));
    await writeFile(join(src, 'module.manifest.json'), JSON.stringify({ ...m, frontend: { styles: [] }, routes: [] }, null, 2));
  }
  const pkg = await packModule(src, join(work, 'out'));
  if (opts.sign !== false) await signPackage(pkg, (opts.key ?? generateSigningKey()).privateKeyPem);
  return pkg;
}
