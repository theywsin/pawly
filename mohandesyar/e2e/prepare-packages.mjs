// Builds the packages the E2E suite uploads through the console: hello-module signed with the release
// key (trusted at migrate time), the same unsigned, and a variant whose migration fails half-way.
import { cp, mkdir, mkdtemp, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateSigningKey, signPackage } from '../packages/module-package/dist/index.js';
import { packModule } from '../tools/module-cli/dist/pack.js';

const out = process.argv[2];
const hello = resolve(import.meta.dirname, '../modules/hello-module');
const key = generateSigningKey();
await mkdir(join(out, 'keys'), { recursive: true });
await mkdir(join(out, 'pkgs'), { recursive: true });
await writeFile(join(out, 'keys/release.pub.pem'), key.publicKeyPem);

async function build(name, fixture, sign) {
  const work = await mkdtemp(join(tmpdir(), 'e2e-pkg-'));
  const src = join(work, 'src');
  await cp(hello, src, { recursive: true, filter: (p) => !/\/(node_modules|dist|fixtures|tests)(\/|$)/.test(p.slice(hello.length)) });
  await symlink(join(hello, 'node_modules'), join(src, 'node_modules'));
  if (fixture) {
    const fx = join(hello, 'fixtures', fixture);
    const m = JSON.parse(await readFile(join(src, 'module.manifest.json'), 'utf8'));
    const patch = JSON.parse(await readFile(join(fx, 'manifest.patch.json'), 'utf8'));
    await writeFile(join(src, 'module.manifest.json'), JSON.stringify({ ...m, ...patch }, null, 2));
    await cp(fx, src, { recursive: true, filter: (p) => !p.endsWith('manifest.patch.json') });
  }
  const pkg = await packModule(src, join(work, 'out'));
  if (sign) await signPackage(pkg, key.privateKeyPem);
  await rename(pkg, join(out, 'pkgs', name));
}
await build('hello-module-1.0.0.mypkg', null, true);
await build('hello-module-unsigned.mypkg', null, false);
await build('hello-module-bad-migration.mypkg', 'bad-migration', true);
