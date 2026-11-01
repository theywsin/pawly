// Packs and signs every business module for a release.
//   node tools/release/pack-modules.mjs <outDir> [--key <private.pem>]
// Without --key a new signing key pair is generated in <outDir>/keys (keep release.key.pem OFF the server:
// it is what lets you publish future module versions). Packages land in <outDir>/modules.
import { cp, mkdir, mkdtemp, readdir, readFile, rename, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { generateSigningKey, signPackage } from '../../packages/module-package/dist/index.js';
import { packModule } from '../module-cli/dist/pack.js';

const out = resolve(process.argv[2] ?? 'release');
const keyArg = process.argv.indexOf('--key');
const root = resolve(import.meta.dirname, '../../modules');
await mkdir(join(out, 'keys'), { recursive: true });
await mkdir(join(out, 'modules'), { recursive: true });

let key;
if (keyArg > 0) {
  const privateKeyPem = await readFile(process.argv[keyArg + 1], 'utf8');
  key = { privateKeyPem, publicKeyPem: createPublicKey(createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'pem' }).toString() };
} else {
  key = generateSigningKey();
  await writeFile(join(out, 'keys', 'release.key.pem'), key.privateKeyPem, { mode: 0o600 });
}
await writeFile(join(out, 'keys', 'release.pub.pem'), key.publicKeyPem);

const ids = (await readdir(root)).filter((d) => d !== 'hello-module').sort();
for (const id of ids) {
  const dir = join(root, id);
  if (!(await stat(join(dir, 'module.manifest.json')).catch(() => null))) continue;
  const work = await mkdtemp(join(tmpdir(), `release-${id}-`));
  const src = join(work, 'src');
  await cp(dir, src, { recursive: true, filter: (p) => !/\/(node_modules|dist|tests|fixtures)(\/|$)/.test(p.slice(dir.length)) });
  await symlink(join(dir, 'node_modules'), join(src, 'node_modules'));
  const pkg = await packModule(src, join(work, 'out'));
  await signPackage(pkg, key.privateKeyPem);
  const name = pkg.split('/').pop();
  await rename(pkg, join(out, 'modules', name));
  console.log('packed', name);
}
