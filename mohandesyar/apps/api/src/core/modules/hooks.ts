import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { isSharedBackendSpecifier } from '@mohandesyar/module-sdk/server';

let installed = false;

/**
 * Resolution rules for code loaded from the module store (docs/03 §5): a module bundle may import
 * relative files inside its own directory, Node built-ins, and the shared dependencies of the host
 * (resolved as if imported by the host, so there is exactly one @nestjs/common, drizzle-orm, ...).
 * Any other bare specifier is refused before it can be loaded.
 */
export function installModuleResolveHooks(storeDir: string): void {
  if (installed) return;
  installed = true;
  const storeUrl = pathToFileURL(storeDir.endsWith('/') ? storeDir : `${storeDir}/`).href;
  const hostParent = import.meta.url;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const parent = context.parentURL;
      if (!parent || !parent.startsWith(storeUrl)) return nextResolve(specifier, context);
      if (specifier.startsWith('node:')) return nextResolve(specifier, context);
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const r = nextResolve(specifier, context);
        // Relative imports must stay inside the same module/version directory.
        const moduleRoot = parent.slice(0, storeUrl.length) + parent.slice(storeUrl.length).split('/').slice(0, 2).join('/') + '/';
        if (!r.url.startsWith(moduleRoot)) throw new Error(`module import escapes its package: ${specifier}`);
        return r;
      }
      if (isSharedBackendSpecifier(specifier)) return nextResolve(specifier, { ...context, parentURL: hostParent });
      throw new Error(`module code may not import "${specifier}": only shared dependencies are provided by the core; bundle it into the module`);
    },
  });
}

const nativeRequire = createRequire(import.meta.url);

/**
 * Loads a module bundle through Node's native `require(esm)` (Node ≥ 22.12). Unlike a dynamic
 * `import()` this works the same under the production runtime and under test runners that sandbox
 * imports, and it is covered by the synchronous resolve hooks above. Module bundles therefore must
 * not use top-level await.
 */
export function nativeLoad(file: string): Record<string, unknown> {
  return nativeRequire(file) as Record<string, unknown>;
}
