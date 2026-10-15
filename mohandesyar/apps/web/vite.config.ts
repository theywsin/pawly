import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

const SHARED = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'react-router', '@tanstack/react-query', '@mohandesyar/ui', '@mohandesyar/module-sdk/web'];

/** Injects the shared-runtime import map (built by scripts/build-shared.mjs) into index.html. */
function importMap(): Plugin {
  return {
    name: 'mohandesyar-import-map',
    transformIndexHtml(html) {
      const map = readFileSync(join(import.meta.dirname, 'public/shared/importmap.json'), 'utf8');
      return html.replace('<!--importmap-->', `<script type="importmap">${map}</script>`);
    },
  };
}

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react(), tailwind(), importMap()],
  publicDir: isSsrBuild ? false : 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // Browser build: shared runtime comes from the import map. SSR (prerender) build: bundle workspace sources.
    rollupOptions: { external: isSsrBuild ? [] : SHARED },
    modulePreload: { polyfill: false },
  },
  ssr: { noExternal: ['@mohandesyar/ui', '@mohandesyar/persian', '@mohandesyar/module-sdk'] },
}));
