#!/usr/bin/env node
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { generateSigningKey, keyIdOf, signPackage, verifyPackage, PackageError } from '@mohandesyar/module-package';
import { packModule } from './pack.js';

const usage = `usage:
  mohandesyar-module keygen --out <dir>                 create an Ed25519 key pair (keep the private key offline)
  mohandesyar-module pack <moduleDir> [--out <dir>]     build and pack a module (unsigned)
  mohandesyar-module sign <pkg> --key <private.pem>     sign a package
  mohandesyar-module verify <pkg> --pub <public.pem>    verify a package like the server does`;

async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { out: { type: 'string' }, key: { type: 'string' }, pub: { type: 'string' } },
  });
  switch (cmd) {
    case 'keygen': {
      const out = resolve(values.out ?? '.');
      await mkdir(out, { recursive: true });
      const k = generateSigningKey();
      await writeFile(join(out, `module-signing-${k.keyId}.pub.pem`), k.publicKeyPem);
      await writeFile(join(out, `module-signing-${k.keyId}.key.pem`), k.privateKeyPem, { mode: 0o600 });
      console.log(`keyId ${k.keyId}\npublic  ${join(out, `module-signing-${k.keyId}.pub.pem`)}\nprivate ${join(out, `module-signing-${k.keyId}.key.pem`)}`);
      return;
    }
    case 'pack': {
      if (!positionals[0]) throw new Error(usage);
      await packModule(positionals[0], values.out ?? 'dist/packages', { log: (m) => console.log(m) });
      return;
    }
    case 'sign': {
      if (!positionals[0] || !values.key) throw new Error(usage);
      const { keyId } = await signPackage(positionals[0], await readFile(values.key, 'utf8'));
      console.log(`signed ${positionals[0]} with key ${keyId}`);
      return;
    }
    case 'verify': {
      if (!positionals[0] || !values.pub) throw new Error(usage);
      const pem = await readFile(values.pub, 'utf8');
      const dir = await mkdtemp(join(tmpdir(), 'mypkg-verify-'));
      try {
        const v = await verifyPackage(positionals[0], dir, [{ keyId: keyIdOf(pem), publicKeyPem: pem }]);
        console.log(`OK ${v.manifest.id}@${v.manifest.version} signed by ${v.keyId} sha256=${v.packageSha256}`);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
      return;
    }
    default:
      throw new Error(usage);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof PackageError ? `${err.code}: ${err.message}` : (err as Error).message);
  process.exit(1);
});
