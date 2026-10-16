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
const rawTemplate = await readFile(join(dist, 'index.html'), 'utf8');
// Public pages inline the (small) stylesheet so first paint does not wait on another request.
const cssLink = rawTemplate.match(/<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+\.css)"[^>]*>/);
const inlined = cssLink ? rawTemplate.replace(cssLink[0], `<style>${await readFile(join(dist, cssLink[1]), 'utf8')}</style>`) : rawTemplate;
// Prerendered HTML is already visible; do not let JS preloads compete with first paint.
const template = inlined.replace(/\s*<link rel="modulepreload"[^>]*>/g, '');
if (!template.includes('<div id="root"></div>')) throw new Error('unexpected index.html template');

// SPA shell for /app, /console, /auth: never indexed.
await writeFile(join(dist, 'app-shell.html'), rawTemplate.replace('<title>', '<meta name="robots" content="noindex" />\n    <title>'));

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', name: SITE_NAME, url: '%%ORIGIN%%/', logo: '%%ORIGIN%%/brand/logo-512.png' },
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
    `<meta property="og:image" content="%%ORIGIN%%/brand/og.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
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
// Blog posts are dynamic: the API fills <!--POST_HEAD--> with each post's meta tags; the SPA renders the body.
await writeFile(join(dist, 'blog-post.html'), template.replace(/<title>[^<]*<\/title>/, '<!--POST_HEAD-->'));
await writeFile(join(dist, 'prerender-manifest.json'), JSON.stringify(PRERENDER.map((p) => ({ path: p.path, priority: p.priority }))));
console.log(`prerendered ${PRERENDER.length} pages`);
