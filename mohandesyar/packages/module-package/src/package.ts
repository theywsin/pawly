import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, relative, sep } from 'node:path';
import * as tar from 'tar';
import { parseManifest, type ModuleManifest } from '@mohandesyar/module-sdk';

/**
 * Package format, signing and verification — docs/03-module-system.md §3–4.
 *
 *   <id>-<version>.mypkg = tar.gz { module.manifest.json, backend/, frontend/, migrations/, seed/, docs/, CHECKSUMS, SIGNATURE }
 *   CHECKSUMS = sorted lines "<sha256-hex>  <path>" for every file except CHECKSUMS and SIGNATURE
 *   SIGNATURE = {"alg":"ed25519","keyId":"…","sig":"<base64 signature of CHECKSUMS bytes>"}
 */

export const CHECKSUMS_FILE = 'CHECKSUMS';
export const SIGNATURE_FILE = 'SIGNATURE';
export const MANIFEST_FILE = 'module.manifest.json';
const TOP_LEVEL = new Set(['module.manifest.json', 'backend', 'frontend', 'migrations', 'seed', 'docs', CHECKSUMS_FILE, SIGNATURE_FILE]);

export interface PackageLimits {
  maxCompressedBytes: number;
  maxExtractedBytes: number;
  maxFiles: number;
}

export const DEFAULT_LIMITS: PackageLimits = {
  maxCompressedBytes: 50 * 1024 * 1024,
  maxExtractedBytes: 200 * 1024 * 1024,
  maxFiles: 5000,
};

export class PackageError extends Error {
  constructor(
    readonly code:
      | 'TOO_LARGE'
      | 'BAD_ARCHIVE'
      | 'UNSAFE_ENTRY'
      | 'MISSING_SIGNATURE'
      | 'UNKNOWN_KEY'
      | 'BAD_SIGNATURE'
      | 'CHECKSUM_MISMATCH'
      | 'UNLISTED_FILE'
      | 'MISSING_FILE'
      | 'BAD_MANIFEST',
    message: string,
  ) {
    super(message);
    this.name = 'PackageError';
  }
}

// ---------------------------------------------------------------- keys

export interface KeyPairPem {
  keyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

export function keyIdOf(publicKey: KeyObject | string): string {
  const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey;
  const der = key.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 16);
}

export function generateSigningKey(): KeyPairPem {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    keyId: keyIdOf(publicKey),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

// ---------------------------------------------------------------- checksums

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new PackageError('UNSAFE_ENTRY', `پیوند نمادین مجاز نیست: ${relative(root, full)}`);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(relative(root, full).split(sep).join(posix.sep));
      else throw new PackageError('UNSAFE_ENTRY', `نوع فایل مجاز نیست: ${relative(root, full)}`);
    }
  }
  await walk(root);
  return out.sort();
}

async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest('hex');
}

export async function computeChecksums(root: string): Promise<string> {
  const files = (await listFiles(root)).filter((f) => f !== CHECKSUMS_FILE && f !== SIGNATURE_FILE);
  const lines: string[] = [];
  for (const f of files) lines.push(`${await sha256File(join(root, f))}  ${f}`);
  return lines.join('\n') + '\n';
}

function parseChecksums(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split('\n')) {
    if (!line) continue;
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (!m) throw new PackageError('BAD_ARCHIVE', 'فایل CHECKSUMS قالب نادرست دارد');
    map.set(m[2]!, m[1]!);
  }
  return map;
}

// ---------------------------------------------------------------- pack & sign

async function writeDeterministicTar(root: string, outFile: string): Promise<void> {
  const files = await listFiles(root);
  await tar.c({ gzip: { level: 9 }, file: outFile, cwd: root, portable: true, mtime: new Date(0), noDirRecurse: true }, files);
}

/** Packs a staged module directory (already containing built backend/frontend) into an unsigned package. */
export async function packDirectory(stagedDir: string, outFile: string): Promise<{ manifest: ModuleManifest }> {
  const manifest = await readManifest(stagedDir);
  for (const name of await readdir(stagedDir)) {
    if (!TOP_LEVEL.has(name)) throw new PackageError('UNSAFE_ENTRY', `مسیر سطح بالای غیرمجاز در بسته: ${name}`);
  }
  await rm(join(stagedDir, SIGNATURE_FILE), { force: true });
  await writeFile(join(stagedDir, CHECKSUMS_FILE), await computeChecksums(stagedDir));
  await writeDeterministicTar(stagedDir, outFile);
  return { manifest };
}

/** Adds (or replaces) the SIGNATURE file of a package, signing its CHECKSUMS with an Ed25519 key. */
export async function signPackage(pkgFile: string, privateKeyPem: string, outFile = pkgFile): Promise<{ keyId: string }> {
  const work = await mkdtemp(join(tmpdir(), 'mypkg-sign-'));
  try {
    await safeExtract(pkgFile, work, DEFAULT_LIMITS);
    const checksums = await readFile(join(work, CHECKSUMS_FILE));
    const recomputed = await computeChecksums(work);
    if (recomputed !== checksums.toString('utf8')) throw new PackageError('CHECKSUM_MISMATCH', 'CHECKSUMS با محتوای بسته مطابقت ندارد');
    const privateKey = createPrivateKey(privateKeyPem);
    const keyId = keyIdOf(createPublicKey(privateKey));
    const sig = sign(null, checksums, privateKey).toString('base64');
    await writeFile(join(work, SIGNATURE_FILE), JSON.stringify({ alg: 'ed25519', keyId, sig }) + '\n');
    await writeDeterministicTar(work, outFile);
    return { keyId };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- verify

/**
 * Lists the archive first and rejects anything unsafe (absolute paths, `..`, links, devices, unknown
 * top-level entries, too many files, too many bytes) before extracting a single byte.
 */
export async function safeExtract(pkgFile: string, dest: string, limits: PackageLimits): Promise<void> {
  const st = await stat(pkgFile);
  if (st.size > limits.maxCompressedBytes) throw new PackageError('TOO_LARGE', 'حجم بسته بیش از حد مجاز است');

  let files = 0;
  let bytes = 0;
  let problem: PackageError | undefined;
  try {
    await tar.t({
      file: pkgFile,
      strict: true,
      onReadEntry: (entry) => {
        if (problem) return;
        const p = entry.path;
        const parts = p.split('/').filter(Boolean);
        if (p.startsWith('/') || p.includes('\\') || parts.includes('..') || parts.length === 0) {
          problem = new PackageError('UNSAFE_ENTRY', `مسیر ناامن در بسته: ${p}`);
        } else if (entry.type !== 'File' && entry.type !== 'Directory') {
          problem = new PackageError('UNSAFE_ENTRY', `نوع ورودی مجاز نیست (${entry.type}): ${p}`);
        } else if (!TOP_LEVEL.has(parts[0]!)) {
          problem = new PackageError('UNSAFE_ENTRY', `مسیر سطح بالای غیرمجاز: ${p}`);
        }
        if (entry.type === 'File') {
          files += 1;
          bytes += entry.size ?? 0;
          if (files > limits.maxFiles || bytes > limits.maxExtractedBytes) {
            problem ??= new PackageError('TOO_LARGE', 'تعداد یا حجم فایل‌های بسته بیش از حد مجاز است');
          }
        }
      },
    });
  } catch (err) {
    if (err instanceof PackageError) throw err;
    throw new PackageError('BAD_ARCHIVE', `فایل بسته خراب یا نامعتبر است: ${(err as Error).message}`);
  }
  if (problem) throw problem;

  await mkdir(dest, { recursive: true });
  let written = 0;
  await tar.x({
    file: pkgFile,
    cwd: dest,
    strict: true,
    preservePaths: false,
    preserveOwner: false,
    noChmod: true,
    filter: (_p, entry) => {
      const size = 'size' in entry ? (entry.size ?? 0) : 0;
      written += size;
      return written <= limits.maxExtractedBytes;
    },
  });
  // Defence in depth: nothing but regular files and directories may exist after extraction.
  for (const f of await listFiles(dest)) {
    const s = await lstat(join(dest, f));
    if (!s.isFile()) throw new PackageError('UNSAFE_ENTRY', `ورودی ناامن پس از استخراج: ${f}`);
  }
}

export interface TrustedKey {
  keyId: string;
  publicKeyPem: string;
}

export interface VerifiedPackage {
  manifest: ModuleManifest;
  keyId: string;
  packageSha256: string;
  dir: string;
}

async function readManifest(dir: string): Promise<ModuleManifest> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(dir, MANIFEST_FILE), 'utf8'));
  } catch {
    throw new PackageError('BAD_MANIFEST', 'فایل module.manifest.json وجود ندارد یا JSON معتبر نیست');
  }
  const r = parseManifest(raw);
  if (!r.ok) throw new PackageError('BAD_MANIFEST', `manifest نامعتبر است: ${r.errors.join('؛ ')}`);
  return r.manifest;
}

/**
 * Full verification in the order mandated by docs/03 §4: size & safe extraction → signature over
 * CHECKSUMS with an active trusted key → every file hashed and listed, nothing extra → manifest.
 * No package code is imported or executed here.
 */
export async function verifyPackage(pkgFile: string, dest: string, trustedKeys: TrustedKey[], limits = DEFAULT_LIMITS): Promise<VerifiedPackage> {
  await safeExtract(pkgFile, dest, limits);

  let sigDoc: { alg?: string; keyId?: string; sig?: string };
  try {
    sigDoc = JSON.parse(await readFile(join(dest, SIGNATURE_FILE), 'utf8'));
  } catch {
    throw new PackageError('MISSING_SIGNATURE', 'بسته امضا نشده است');
  }
  if (sigDoc.alg !== 'ed25519' || typeof sigDoc.keyId !== 'string' || typeof sigDoc.sig !== 'string') {
    throw new PackageError('MISSING_SIGNATURE', 'قالب امضای بسته نامعتبر است');
  }
  const key = trustedKeys.find((k) => k.keyId === sigDoc.keyId);
  if (!key) throw new PackageError('UNKNOWN_KEY', `کلید امضا (${sigDoc.keyId}) مورد اعتماد نیست`);

  let checksumsBytes: Buffer;
  try {
    checksumsBytes = await readFile(join(dest, CHECKSUMS_FILE));
  } catch {
    throw new PackageError('MISSING_FILE', 'فایل CHECKSUMS وجود ندارد');
  }
  const ok = verify(null, checksumsBytes, createPublicKey(key.publicKeyPem), Buffer.from(sigDoc.sig, 'base64'));
  if (!ok) throw new PackageError('BAD_SIGNATURE', 'امضای بسته معتبر نیست');

  const listed = parseChecksums(checksumsBytes.toString('utf8'));
  const present = (await listFiles(dest)).filter((f) => f !== CHECKSUMS_FILE && f !== SIGNATURE_FILE);
  for (const f of present) {
    const expected = listed.get(f);
    if (!expected) throw new PackageError('UNLISTED_FILE', `فایل خارج از فهرست CHECKSUMS: ${f}`);
    if ((await sha256File(join(dest, f))) !== expected) throw new PackageError('CHECKSUM_MISMATCH', `checksum نادرست: ${f}`);
  }
  for (const f of listed.keys()) {
    if (!present.includes(f)) throw new PackageError('MISSING_FILE', `فایل فهرست‌شده وجود ندارد: ${f}`);
  }

  const manifest = await readManifest(dest);
  return { manifest, keyId: key.keyId, packageSha256: await sha256File(pkgFile), dir: dest };
}

/** Re-hashes an installed package directory against its CHECKSUMS (detects tampering on disk). */
export async function verifyInstalledDirectory(dir: string): Promise<void> {
  const listed = parseChecksums(await readFile(join(dir, CHECKSUMS_FILE), 'utf8'));
  for (const f of await listFiles(dir)) {
    if (f !== CHECKSUMS_FILE && f !== SIGNATURE_FILE && !listed.has(f)) throw new PackageError('UNLISTED_FILE', `فایل اضافه در پوشه نصب: ${f}`);
  }
  for (const [f, expected] of listed) {
    if ((await sha256File(join(dir, f))) !== expected) throw new PackageError('CHECKSUM_MISMATCH', `فایل نصب‌شده تغییر کرده است: ${f}`);
  }
}
