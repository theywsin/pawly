// Builds the shared runtime dependencies (React, router, query client, UI kit, module SDK) into one
// set of ESM files with a single React instance, and writes the import map that maps their bare
// specifiers to hashed URLs. The host SPA and every module bundle import these through the map, so a
// module installed at runtime shares the host's React tree (docs/03-module-system.md §6).
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'shared');
const shims = join(root, '.shared-shims');
const require = createRequire(join(root, 'package.json'));

/** Shared specifiers; CJS packages need explicit named re-exports so browsers see static exports. */
const SHARED = {
  react: { cjs: true },
  'react/jsx-runtime': { cjs: true },
  'react-dom': { cjs: true },
  'react-dom/client': { cjs: true },
  'react-router': { cjs: false },
  '@tanstack/react-query': { cjs: false },
  '@mohandesyar/ui': { cjs: false },
  '@mohandesyar/module-sdk/web': { cjs: false },
};

await rm(out, { recursive: true, force: true });
await rm(shims, { recursive: true, force: true });
await mkdir(shims, { recursive: true });
const entryPoints = {};
for (const [spec, { cjs }] of Object.entries(SHARED)) {
  const name = spec.replace(/^@/, '').replace(/[/]/g, '__');
  const file = join(shims, `${name}.js`);
  if (cjs) {
    const mod = require(spec);
    const names = Object.keys(mod).filter((k) => k !== 'default' && /^[A-Za-z_$][\w$]*$/.test(k));
    await writeFile(file, `import m from ${JSON.stringify(spec)};\nexport const { ${names.join(', ')} } = m;\nexport default m;\n`);
  } else {
    await writeFile(file, `export * from ${JSON.stringify(spec)};\n`);
  }
  entryPoints[name] = file;
}

const result = await build({
  entryPoints,
  outdir: out,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  jsx: 'automatic',
  entryNames: '[name]-[hash]',
  chunkNames: 'chunk-[hash]',
  metafile: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  nodePaths: [join(root, 'node_modules')],
  logLevel: 'warning',
});

const imports = {};
for (const [file, info] of Object.entries(result.metafile.outputs)) {
  if (!info.entryPoint) continue;
  const name = Object.entries(entryPoints).find(([, f]) => relative(root, f) === info.entryPoint || f.endsWith(info.entryPoint))?.[0];
  const spec = Object.keys(SHARED).find((s) => s.replace(/^@/, '').replace(/[/]/g, '__') === name);
  if (spec) imports[spec] = '/' + relative(join(root, 'public'), join(root, file.startsWith('/') ? relative(root, file) : file)).split('\\').join('/');
}
if (Object.keys(imports).length !== Object.keys(SHARED).length) throw new Error(`import map incomplete: ${JSON.stringify(imports)}`);
await writeFile(join(out, 'importmap.json'), JSON.stringify({ imports }, null, 2));
await rm(shims, { recursive: true, force: true });
console.log('shared runtime:', imports);
