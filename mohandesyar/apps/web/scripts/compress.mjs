// Precompresses static build output (brotli + gzip) so the server never compresses at request time.
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const dist = new URL('../dist/', import.meta.url).pathname;
const EXT = /\.(js|css|svg|json|xml|txt|webmanifest)$/;
let n = 0;
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else if (EXT.test(e.name) && (await stat(p)).size > 1024) {
      const buf = await readFile(p);
      await writeFile(`${p}.br`, brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
      await writeFile(`${p}.gz`, gzipSync(buf, { level: 9 }));
      n++;
    }
  }
}
await walk(dist);
console.log(`precompressed ${n} files`);
