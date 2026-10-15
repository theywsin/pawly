// Writes static HTML for every public route (dist/<route>/index.html), keeps the SPA shell for the
// app/console as dist/app-shell.html, and emits prerender-manifest.json for the API's sitemap.
// Absolute URLs use the %%ORIGIN%% placeholder, replaced by the API with its configured PUBLIC_ORIGIN.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const { render, PRERENDER, fullTitle, SITE_NAME } = await import(pathToFileURL(join(root, 'dist-ssr/entry-prerender.js')).href);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const template = await readFile(join(dist, 'index.html'), 'utf8');
if (!template.includes('<div id="root"></div>')) throw new Error('unexpected index.html template');

// SPA shell for /app, /console, /auth: never indexed.
await writeFile(join(dist, 'app-shell.html'), template.replace('<title>', '<meta name="robots" content="noindex" />\n    <title>'));

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', name: SITE_NAME, url: '%%ORIGIN%%/' },
    {
      '@type': 'SoftwareApplication',
      name: SITE_NAME,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      inLanguage: 'fa-IR',
      description: PRERENDER[0].meta.description,
      url: '%%ORIGIN%%/',
    },
  ],
};

for (const page of PRERENDER) {
  const body = await render(page.path);
  const title = esc(fullTitle(page.meta.title));
  const desc = esc(page.meta.description);
  const url = `%%ORIGIN%%${page.path === '/' ? '/' : page.path}`;
  const head = [
    `<title>${title}</title>`,
    `<meta name="description" content="${desc}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(SITE_NAME)}" />`,
    `<meta property="og:locale" content="fa_IR" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${desc}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta name="twitter:card" content="summary" />`,
    page.path === '/' ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : '',
  ]
    .filter(Boolean)
    .join('\n    ');
  const html = template.replace(/<title>[^<]*<\/title>/, head).replace('<div id="root"></div>', `<div id="root">${body}</div>`);
  const file = page.path === '/' ? join(dist, 'index.html') : join(dist, page.path, 'index.html');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
}
await writeFile(join(dist, 'prerender-manifest.json'), JSON.stringify(PRERENDER.map((p) => ({ path: p.path, priority: p.priority }))));
console.log(`prerendered ${PRERENDER.length} pages`);
