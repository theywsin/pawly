// Bundles the API (and the dry-load child entry) with esbuild. npm dependencies stay external and are
// resolved from node_modules at runtime — module bundles resolve their shared dependencies to the same copies.
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

await rm(new URL('../dist', import.meta.url), { recursive: true, force: true });
await build({
  entryPoints: { main: 'src/main.ts', 'dry-load': 'src/dry-load.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
  logLevel: 'warning',
});
console.log('api built');
