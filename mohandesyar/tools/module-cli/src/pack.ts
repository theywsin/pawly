import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { parseManifest, SHARED_WEB_DEPENDENCIES } from '@mohandesyar/module-sdk';
import { isSharedBackendSpecifier } from '@mohandesyar/module-sdk/server';
import { lintMigration, packDirectory } from '@mohandesyar/module-package';

/**
 * Builds a module source directory into an unsigned `.mypkg`:
 *   backend/src/index.ts  → backend/index.mjs  (esbuild, shared deps external)
 *   frontend/src/index.tsx → frontend/*.js     (esbuild ESM + code splitting, shared deps external)
 *   frontend/module.css                          (Tailwind utilities used by the module; optional extra rules in frontend/src/module.css)
 *   migrations/*.sql (+ generated meta.json), seed/, docs/
 */

export interface MigrationMeta {
  file: string;
  kind: 'expand' | 'contract';
  down: string | null;
}

export async function migrationMeta(dir: string): Promise<MigrationMeta[]> {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql')).sort();
  return files.map((file) => {
    const down = file.replace(/\.sql$/, '.down.sql');
    return { file, kind: file.includes('.contract.') ? 'contract' : 'expand', down: existsSync(join(dir, down)) ? down : null };
  });
}

export async function packModule(moduleDir: string, outDir: string, opts: { log?: (m: string) => void } = {}): Promise<string> {
  const log = opts.log ?? (() => {});
  const src = resolve(moduleDir);
  const parsed = parseManifest(JSON.parse(await readFile(join(src, 'module.manifest.json'), 'utf8')));
  if (!parsed.ok) throw new Error(`manifest نامعتبر:\n  ${parsed.errors.join('\n  ')}`);
  const m = parsed.manifest;

  const stage = await mkdtemp(join(tmpdir(), `mypkg-${m.id}-`));
  try {
    await cp(join(src, 'module.manifest.json'), join(stage, 'module.manifest.json'));

    log(`backend: bundling ${m.id}`);
    await build({
      entryPoints: [join(src, 'backend/src/index.ts')],
      outfile: join(stage, m.backend.entry),
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      legalComments: 'none',
      logLevel: 'silent',
      tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
      plugins: [
        {
          name: 'shared-backend-deps',
          setup(b) {
            b.onResolve({ filter: /^[^./]/ }, (args) => {
              if (args.path.startsWith('node:')) return { external: true };
              if (isSharedBackendSpecifier(args.path)) return { path: args.path, external: true };
              return undefined; // bundled
            });
          },
        },
      ],
    });

    const feEntry = join(src, 'frontend/src/index.tsx');
    if (existsSync(feEntry)) {
      if (!m.frontend.entry) throw new Error('frontend/src/index.tsx وجود دارد ولی manifest.frontend.entry تعریف نشده است');
      log('frontend: bundling');
      await build({
        entryPoints: { index: feEntry },
        outdir: join(stage, 'frontend'),
        bundle: true,
        splitting: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        jsx: 'automatic',
        minify: true,
        chunkNames: 'chunks/[name]-[hash]',
        logLevel: 'silent',
        external: [...SHARED_WEB_DEPENDENCIES],
        loader: { '.svg': 'text' },
      });
      // Utility CSS for exactly the classes this module uses (no preflight; theme tokens come from the host).
      if (!m.frontend.styles.includes('frontend/module.css')) throw new Error('manifest.frontend.styles باید "frontend/module.css" را شامل شود');
      const req = createRequire(import.meta.url);
      const tw = dirname(req.resolve('tailwindcss/package.json'));
      const theme = req.resolve('@mohandesyar/ui/theme.css');
      const extra = join(src, 'frontend/src/module.css');
      const input = join(stage, `..`, `${m.id}-${process.pid}-tw-input.css`);
      await writeFile(
        input,
        [`@import '${join(tw, 'utilities.css')}' source('${join(src, 'frontend/src')}');`, `@reference '${theme}';`, existsSync(extra) ? `@import '${extra}';` : ''].join('\n'),
      );
      log('frontend: tailwind');
      const bin = join(dirname(req.resolve('@tailwindcss/cli/package.json')), 'dist/index.mjs');
      const r = spawnSync(process.execPath, [bin, '-i', input, '-o', join(stage, 'frontend/module.css'), '--minify'], { encoding: 'utf8' });
      await rm(input, { force: true });
      if (r.status !== 0) throw new Error(`tailwind failed: ${r.stderr}`);
    }

    const migSrc = join(src, 'migrations');
    const meta = await migrationMeta(migSrc);
    await mkdir(join(stage, 'migrations'), { recursive: true });
    for (const entry of meta) {
      for (const f of [entry.file, entry.down].filter(Boolean) as string[]) {
        const sql = await readFile(join(migSrc, f), 'utf8');
        const issues = await lintMigration(f, sql, m.tablePrefix);
        if (issues.length) throw new Error(`مهاجرت نامعتبر:\n  ${issues.map((i) => `${i.file}#${i.statement}: ${i.message}`).join('\n  ')}`);
        await cp(join(migSrc, f), join(stage, 'migrations', f));
      }
    }
    await writeFile(join(stage, 'migrations/meta.json'), JSON.stringify(meta, null, 2) + '\n');

    for (const d of ['seed', 'docs']) {
      if (existsSync(join(src, d)) && (await stat(join(src, d))).isDirectory()) await cp(join(src, d), join(stage, d), { recursive: true });
    }

    await mkdir(outDir, { recursive: true });
    const out = join(resolve(outDir), `${m.id}-${m.version}.mypkg`);
    await packDirectory(stage, out);
    log(`packed ${out}`);
    return out;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
