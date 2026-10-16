import type { MeModule } from '@mohandesyar/module-sdk/web';

const bundles = new Map<string, Promise<Record<string, unknown>>>();

function ensureStyles(urls: string[]): void {
  for (const href of urls) {
    if (document.querySelector(`link[data-module-style="${href}"]`)) continue;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.dataset.moduleStyle = href;
    document.head.appendChild(l);
  }
}

/**
 * Loads a module's frontend bundle (ESM, served by the API from the module store under a versioned,
 * immutable URL). Bare imports inside the bundle resolve through the host import map.
 */
export function loadModuleBundle(m: MeModule): Promise<Record<string, unknown>> {
  if (!m.frontend) return Promise.reject(new Error('این ماژول رابط کاربری ندارد'));
  ensureStyles(m.styles);
  let p = bundles.get(m.frontend);
  if (!p) {
    p = import(/* @vite-ignore */ m.frontend) as Promise<Record<string, unknown>>;
    p.catch(() => bundles.delete(m.frontend!));
    bundles.set(m.frontend, p);
  }
  return p;
}
