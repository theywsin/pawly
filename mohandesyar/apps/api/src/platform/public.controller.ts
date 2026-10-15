import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { Public } from '@mohandesyar/module-sdk/server';
import { Services } from '../app/services.js';
import { RequestMetaParam } from '../core/http/context.js';
import type { RequestMeta } from '../core/auth/auth.service.js';

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
}
