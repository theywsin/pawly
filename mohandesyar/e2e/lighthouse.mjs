// Lighthouse audit of the public pages (mobile and desktop) against a running server built for production.
// Usage: node e2e/lighthouse.mjs [baseUrl]   — fails if any category scores below 0.9.
import { chromium } from '@playwright/test';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';

const base = (process.argv[2] ?? 'http://127.0.0.1:3200').replace(/\/$/, '');
const pages = ['/', '/pricing', '/modules', '/modules/projects', '/blog', '/download', '/contact'];
const categories = ['performance', 'accessibility', 'best-practices', 'seo'];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--remote-debugging-port=9333'] });
let failed = false;
try {
  for (const form of ['mobile', 'desktop']) {
    for (const path of pages) {
      const { lhr } = await lighthouse(`${base}${path}`, { port: 9333, output: 'json', logLevel: 'error', onlyCategories: categories, formFactor: form }, form === 'desktop' ? desktopConfig : undefined);
      if (lhr.runtimeError) throw new Error(`${path}: ${lhr.runtimeError.code}`);
      const scores = categories.map((c) => [c, lhr.categories[c].score]);
      const low = scores.filter(([, s]) => s < 0.9);
      if (low.length) failed = true;
      console.log(`${low.length ? '✘' : '✓'} ${form.padEnd(7)} ${path.padEnd(18)} ${scores.map(([c, s]) => `${c} ${Math.round(s * 100)}`).join('  ')}`);
    }
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
