import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { extname, join, normalize, sep } from 'node:path';
import { Catch, Controller, Get, HttpException, Inject, Module, SetMetadata, type ArgumentsHost, type DynamicModule, type ExceptionFilter, type Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, NestFactory, RouterModule, type Routes } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { Public } from '@mohandesyar/module-sdk/server';
import { sql } from 'drizzle-orm';
import { CoreGuard } from '../core/http/core.guard.js';
import { AuthController, ConsoleAuthController } from '../core/http/controllers/auth.controller.js';
import { CoreController } from '../core/http/controllers/core.controller.js';
import { ConsoleController } from '../core/http/controllers/console.controller.js';
import { PublicController } from '../platform/public.controller.js';
import { ConsoleSiteController } from '../platform/console-site.controller.js';
import { META_MODULE } from '../core/http/context.js';
import type { LoadedModule } from '../core/modules/loader.js';
import { loadModuleFromStore } from '../core/modules/loader.js';
import { logger } from '../infra/logger.js';
import { Services } from './services.js';
import type { EventConsumer } from '../core/events/event-bus.js';
import { uuidv7 } from '../infra/ids.js';

@Catch()
class ErrorFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<{ status(c: number): { send(b: unknown): void }; sent?: boolean }>();
    if (reply.sent) return;
    if (err instanceof HttpException) {
      const body = err.getResponse();
      const status = err.getStatus();
      const normalised =
        typeof body === 'object' && body !== null && 'code' in body
          ? body
          : { code: status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR', message: status === 404 ? 'مسیر یافت نشد' : 'درخواست نامعتبر است' };
      reply.status(status).send(normalised);
      return;
    }
    const ref = uuidv7();
    logger.error({ err, ref }, 'unhandled error');
    reply.status(500).send({ code: 'INTERNAL', message: 'خطای داخلی رخ داد؛ با پشتیبانی تماس بگیرید', ref });
  }
}

@Controller('health')
class HealthController {
  constructor(@Inject(Services) private readonly s: Services) {}

  @Public()
  @Get('live')
  live() {
    return { ok: true };
  }

  @Public()
  @Get('ready')
  async ready() {
    await this.s.db.app.execute(sql`SELECT 1`);
    await this.s.redis.ping();
    return { ok: true, instance: this.s.instanceId, modules: [...this.s.registry.loaded.keys()], loadErrors: Object.fromEntries(this.s.registry.loadErrors) };
  }
}

/** Wraps a loaded module definition into a Nest module mounted under /api/m/<id>/v<apiVersion>. */
function moduleClassFor(m: LoadedModule): Type {
  const controllers = m.definition.controllers ?? [];
  for (const c of controllers) SetMetadata(META_MODULE, m.id)(c);
  const cls = class {};
  Object.defineProperty(cls, 'name', { value: `Module_${m.id.replace(/-/g, '_')}` });
  Module({ controllers, providers: (m.definition.providers ?? []) as never[] })(cls);
  return cls;
}

/** Loads every installed module version recorded in the registry; failures are isolated per module. */
export async function loadInstalledModules(s: Services): Promise<LoadedModule[]> {
  const r = await s.db.app.execute(sql`SELECT id, active_version FROM core_modules WHERE state = 'installed' AND active_version IS NOT NULL ORDER BY id`);
  const rows = r.rows as { id: string; active_version: string }[];
  const manifests = await s.db.app.execute(sql`SELECT module_id, manifest FROM core_module_versions WHERE status = 'active'`);
  const deps = new Map((manifests.rows as { module_id: string; manifest: { dependencies: Record<string, string> } }[]).map((x) => [x.module_id, Object.keys(x.manifest.dependencies ?? {})]));
  // Topological order on required dependencies.
  const order: string[] = [];
  const visit = (id: string, stack: Set<string>) => {
    if (order.includes(id) || stack.has(id)) return;
    stack.add(id);
    for (const d of deps.get(id) ?? []) visit(d, stack);
    order.push(id);
  };
  for (const row of rows) visit(row.id, new Set());
  const loaded: LoadedModule[] = [];
  s.registry.loaded.clear();
  s.registry.loadErrors.clear();
  for (const id of order) {
    const row = rows.find((x) => x.id === id);
    if (!row) continue;
    const missing = (deps.get(id) ?? []).filter((d) => !s.registry.loaded.has(d));
    let status: 'loaded' | 'load_failed' | 'skipped' = 'loaded';
    let error: string | null = null;
    if (missing.length) {
      status = 'skipped';
      error = `required dependencies not loaded: ${missing.join(', ')}`;
    } else {
      try {
        const m = await loadModuleFromStore(s.config.MODULE_STORE_DIR, id, row.active_version);
        s.registry.loaded.set(id, m);
        loaded.push(m);
      } catch (err) {
        status = 'load_failed';
        error = (err as Error).message;
      }
    }
    if (error) {
      s.registry.loadErrors.set(id, error);
      logger.error({ module: id, error }, 'module not loaded');
    }
    await s.db.app.execute(sql`INSERT INTO core_module_runtime_status (instance_id, module_id, version, status, error, booted_at, reported_at)
      VALUES (${s.instanceId}, ${id}, ${row.active_version}, ${status}, ${error}, ${s.bootedAt}, now())
      ON CONFLICT (instance_id, module_id) DO UPDATE SET version = EXCLUDED.version, status = EXCLUDED.status, error = EXCLUDED.error, booted_at = EXCLUDED.booted_at, reported_at = now()`);
  }
  await s.db.app.execute(sql`DELETE FROM core_module_runtime_status WHERE instance_id = ${s.instanceId} AND NOT (module_id = ANY(${`{${order.join(',')}}`}::text[]))`);
  wireEventConsumers(s, loaded);
  return loaded;
}

function wireEventConsumers(s: Services, loaded: LoadedModule[]): void {
  const consumers: EventConsumer[] = [];
  for (const m of loaded) {
    for (const [type, handler] of Object.entries(m.definition.eventHandlers ?? {})) {
      consumers.push({
        id: `${m.id}:${type}`,
        moduleId: m.id,
        type,
        handle: async (event) => handler(event, await s.contexts.forTenant(m, event.tenantId)),
      });
    }
  }
  consumers.push({ id: 'core:webhooks', moduleId: null, type: '*', handle: (event) => s.integrations.onEvent(event) });
  s.events.setConsumers(consumers);
}

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
};

function securityHeaders(scriptHashes: string[]): Record<string, string> {
  const scripts = ["'self'", ...scriptHashes.map((h) => `'sha256-${h}'`)].join(' ');
  return {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': `default-src 'self'; script-src ${scripts}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`,
  };
}

/** The SPA's inline import map is allowed by hash, so CSP keeps `script-src 'self'` without 'unsafe-inline'. */
async function inlineScriptHashes(webDist: string | undefined): Promise<string[]> {
  if (!webDist || !existsSync(join(webDist, 'index.html'))) return [];
  const html = await readFile(join(webDist, 'index.html'), 'utf8');
  const { createHash } = await import('node:crypto');
  return [...html.matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g)].map((m) => createHash('sha256').update(m[1]!).digest('base64'));
}

async function sendFile(reply: FastifyReply, file: string, cache: string) {
  reply.type(MIME[extname(file)] ?? 'application/octet-stream');
  reply.header('cache-control', cache);
  reply.header('vary', 'accept-encoding');
  const accept = String(reply.request.headers['accept-encoding'] ?? '');
  for (const [enc, ext] of [['br', '.br'], ['gzip', '.gz']] as const) {
    if (accept.includes(enc) && existsSync(file + ext)) {
      reply.header('content-encoding', enc);
      return reply.send(await readFile(file + ext));
    }
  }
  return reply.send(await readFile(file));
}

const escHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Head tags of a blog post page (title, description, canonical, Open Graph and BlogPosting data). */
export function postHead(p: { title: string; description: string; image: string | null; publishedAt: string; updatedAt: string; author: string; text: string }, url: string, origin: string): string {
  const title = `${p.title} | مهندیکس`;
  const image = p.image ? `${origin}${p.image}` : `${origin}/brand/og.png`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: p.title,
    description: p.description,
    image,
    datePublished: new Date(p.publishedAt).toISOString(),
    dateModified: new Date(p.updatedAt).toISOString(),
    inLanguage: 'fa-IR',
    mainEntityOfPage: url,
    ...(p.author ? { author: { '@type': 'Person', name: p.author } } : {}),
    publisher: { '@type': 'Organization', name: 'مهندیکس', logo: { '@type': 'ImageObject', url: `${origin}/brand/logo-512.png` } },
    articleBody: p.text,
  };
  return [
    `<title>${escHtml(title)}</title>`,
    `<meta name="description" content="${escHtml(p.description)}" />`,
    `<link rel="canonical" href="${escHtml(url)}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="مهندیکس" />`,
    `<meta property="og:locale" content="fa_IR" />`,
    `<meta property="og:title" content="${escHtml(title)}" />`,
    `<meta property="og:description" content="${escHtml(p.description)}" />`,
    `<meta property="og:url" content="${escHtml(url)}" />`,
    `<meta property="og:image" content="${escHtml(image)}" />`,
    `<meta property="article:published_time" content="${new Date(p.publishedAt).toISOString()}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    // JSON in a script element: '<' is escaped so no text can close the element.
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`,
  ].join('\n    ');
}

function trustProxy(v: string): boolean | string {
  return v === 'true' ? true : v === 'false' ? false : v;
}

export interface CreateAppOptions {
  logger?: boolean;
}

/** Builds the HTTP application for the current set of loaded modules. */
export async function createApp(s: Services, opts: CreateAppOptions = {}): Promise<NestFastifyApplication> {
  const loaded = await loadInstalledModules(s);
  const moduleClasses = loaded.map((m) => ({ m, cls: moduleClassFor(m) }));
  const routes: Routes = moduleClasses.map(({ m, cls }) => ({ path: `m/${m.id}/v${m.manifest.apiVersion}`, module: cls }));

  @Module({
    imports: [...moduleClasses.map((x) => x.cls), RouterModule.register(routes)],
    controllers: [HealthController, AuthController, ConsoleAuthController, CoreController, ConsoleController, PublicController, ConsoleSiteController],
    providers: [
      { provide: Services, useValue: s },
      { provide: APP_GUARD, useClass: CoreGuard },
      { provide: APP_FILTER, useClass: ErrorFilter },
    ],
  })
  class AppModule {}

  // Module controllers resolve Services through the root provider (global).
  const Root: DynamicModule = { module: AppModule, global: true };
  const app = await NestFactory.create<NestFastifyApplication>(Root, new FastifyAdapter({ trustProxy: trustProxy(s.config.TRUST_PROXY), bodyLimit: 2 * 1024 * 1024 }), {
    logger: opts.logger ? ['error', 'warn'] : false,
  });
  app.setGlobalPrefix('api');
  const fastify = app.getHttpAdapter().getInstance() as unknown as FastifyInstance;
  await fastify.register(fastifyCookie as never);
  await fastify.register(fastifyMultipart as never, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } });

  const headers = securityHeaders(await inlineScriptHashes(s.config.WEB_DIST_DIR));
  fastify.addHook('onSend', async (_req: FastifyRequest, reply: FastifyReply) => {
    for (const [k, v] of Object.entries(headers)) reply.header(k, v);
  });

  // Module frontend assets: only the active version of an installed module is served (immutable, versioned path).
  fastify.get('/modules-assets/:id/:version/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as Record<string, string>;
    const rest = params['*'] ?? '';
    const m = s.registry.loaded.get(params.id ?? '');
    if (!m || m.version !== params.version || !rest.startsWith('frontend/')) return reply.code(404).send({ code: 'NOT_FOUND' });
    const file = normalize(join(m.dir, rest));
    if (!file.startsWith(m.dir + sep) || !existsSync(file)) return reply.code(404).send({ code: 'NOT_FOUND' });
    return sendFile(reply, file, 'public, max-age=31536000, immutable');
  });

  // SPA (built web app): prerendered public pages, static files, and the SPA shell for client-side routes.
  const webDist = s.config.WEB_DIST_DIR;
  if (webDist && existsSync(webDist)) {
    const origin = s.config.PUBLIC_ORIGIN.replace(/\/$/, '');
    const shell = existsSync(join(webDist, 'app-shell.html')) ? join(webDist, 'app-shell.html') : join(webDist, 'index.html');
    const sendRendered = async (reply: FastifyReply, html: string) => {
      reply.type(MIME['.html']!);
      reply.header('cache-control', 'no-cache');
      reply.header('vary', 'accept-encoding');
      const body = html.replaceAll('%%ORIGIN%%', origin);
      if (String(reply.request.headers['accept-encoding'] ?? '').includes('gzip')) {
        reply.header('content-encoding', 'gzip');
        return reply.send(gzipSync(body));
      }
      return reply.send(body);
    };
    const sendHtml = async (reply: FastifyReply, file: string) => sendRendered(reply, await readFile(file, 'utf8'));
    const blogTemplate = join(webDist, 'blog-post.html');
    const manifestFile = join(webDist, 'prerender-manifest.json');
    const pages: { path: string; priority: number }[] = existsSync(manifestFile) ? JSON.parse(await readFile(manifestFile, 'utf8')) : [];

    fastify.get('/robots.txt', async (_req: FastifyRequest, reply: FastifyReply) => {
      reply.type(MIME['.txt']!);
      return reply.send(['User-agent: *', 'Allow: /', 'Disallow: /app', 'Disallow: /console', 'Disallow: /auth', 'Disallow: /api', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n'));
    });
    fastify.get('/sitemap.xml', async (_req: FastifyRequest, reply: FastifyReply) => {
      reply.type(MIME['.xml']!);
      const posts = (await s.blog.sitemap()).map((p) => `  <url><loc>${origin}/blog/${encodeURIComponent(p.slug)}</loc><lastmod>${new Date(p.updatedAt).toISOString()}</lastmod><priority>0.6</priority></url>`);
      const urls = [...pages.map((p) => `  <url><loc>${origin}${p.path}</loc><priority>${p.priority.toFixed(1)}</priority></url>`), ...posts].join('\n');
      return reply.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
    });

    // Catch-all GET (Nest owns the 404 handler); API routes are more specific and take precedence.
    fastify.get('/*', async (req: FastifyRequest, reply: FastifyReply) => {
      const path = decodeURIComponent(req.url.split('?')[0] ?? '/');
      if (path.startsWith('/api/')) return reply.code(404).send({ code: 'NOT_FOUND', message: 'مسیر یافت نشد' });
      const candidate = normalize(join(webDist, path));
      if (!candidate.startsWith(webDist)) return reply.code(404).send({ code: 'NOT_FOUND' });
      if (existsSync(candidate) && (await stat(candidate)).isFile()) {
        if (candidate.endsWith('.html')) return sendHtml(reply, candidate);
        const immutable = path.startsWith('/assets/') || path.startsWith('/shared/');
        return sendFile(reply, candidate, immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      }
      // Blog posts are dynamic: the post template gets the post's own title, description, image and
      // structured data so links and search results show the article; the SPA renders the body.
      const post = /^\/blog\/([^/]+)$/.exec(path);
      if (post && existsSync(blogTemplate)) {
        const seo = await s.blog.seo(post[1]!.slice(0, 120));
        if (!seo) return sendHtml(reply.code(404), shell);
        const url = `${origin}/blog/${encodeURIComponent(post[1]!.toLowerCase())}`;
        return sendRendered(reply, (await readFile(blogTemplate, 'utf8')).replace('<!--POST_HEAD-->', postHead(seo, url, origin)));
      }
      // Prerendered public pages (e.g. /pricing → pricing/index.html), else the SPA shell.
      const pre = join(candidate, 'index.html');
      if (existsSync(pre)) return sendHtml(reply, pre);
      return sendHtml(reply, shell);
    });
  }

  await app.init();
  await fastify.ready();
  return app;
}
