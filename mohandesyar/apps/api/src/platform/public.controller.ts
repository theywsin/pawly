import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '@mohandesyar/module-sdk/server';
import { Services } from '../app/services.js';
import { RequestMetaParam } from '../core/http/context.js';
import type { RequestMeta } from '../core/auth/auth.service.js';
import { notFound } from '../core/http/errors.js';

/** Unauthenticated endpoints used by the landing pages (docs/07 §2). Nothing here exposes tenant data. */
@Controller('public')
export class PublicController {
  constructor(@Inject(Services) private readonly s: Services) {}

  @Public()
  @Get('plans')
  plans() {
    return this.s.site.publicPlans();
  }

  @Public()
  @Get('site')
  site() {
    return this.s.site.publicSite();
  }

  @Public()
  @Get('pages/:key')
  page(@Param('key') key: string) {
    return this.s.site.page(key);
  }

  @Public()
  @Get('form-token')
  formToken() {
    return { token: this.s.site.formToken() };
  }

  @Public()
  @Post('leads')
  @HttpCode(201)
  lead(@Body() body: unknown, @RequestMetaParam() meta: RequestMeta) {
    return this.s.site.submitLead(body, meta);
  }

  /** Site images (blog, logos). Ids are immutable, so browsers may cache them for a year. */
  @Public()
  @Get('media/:id')
  async media(@Param('id') id: string, @Res({ passthrough: true }) reply: { header(k: string, v: string): void; type(t: string): void }) {
    if (!z.uuid().safeParse(id).success) throw notFound();
    const m = await this.s.media.read(id);
    reply.type(m.mime);
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    reply.header('content-security-policy', "default-src 'none'");
    return m.data;
  }

  /** Whether online purchase is available, VAT and the free trial length. */
  @Public()
  @Get('billing')
  billing() {
    return this.s.billing.publicInfo();
  }

  @Public()
  @Get('blog')
  blog(@Query('page') page?: string, @Query('category') category?: string, @Query('tag') tag?: string) {
    return this.s.blog.list({ page: Number(page) || 1, category: category?.slice(0, 80) || undefined, tag: tag?.slice(0, 40) || undefined });
  }

  @Public()
  @Get('blog/:slug')
  post(@Param('slug') slug: string) {
    return this.s.blog.post(slug.slice(0, 120));
  }
}
