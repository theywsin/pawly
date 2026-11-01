import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Ctx, RequirePermission, type ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { z } from 'zod';
import { parse } from './errors.js';
import { compareInput, trendInput, viewInput } from './inputs.js';
import { companies, compare, providers, trend, Views } from './logic.js';

/** Mounted at /api/m/holding/v1. Per-company access is checked again inside every report (canIn). */
@Controller()
export class HoldingController {
  @Get('companies')
  @RequirePermission('holding.view', 'company')
  companies(@Ctx() ctx: ModuleRequestContext) {
    return companies(ctx);
  }

  @Get('providers')
  @RequirePermission('holding.view', 'company')
  providers(@Ctx() ctx: ModuleRequestContext) {
    return providers(ctx);
  }

  @Post('compare')
  @HttpCode(200)
  @RequirePermission('holding.view', 'company')
  compare(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return compare(ctx, parse(compareInput, b));
  }

  @Post('trend')
  @HttpCode(200)
  @RequirePermission('holding.view', 'company')
  trend(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return trend(ctx, parse(trendInput, b));
  }

  @Get('views')
  @RequirePermission('holding.view', 'company')
  views(@Ctx() ctx: ModuleRequestContext) {
    return Views.list(ctx);
  }

  @Post('views')
  @RequirePermission('holding.manage', 'company')
  saveView(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Views.save(ctx, parse(viewInput, b));
  }

  @Delete('views/:id')
  @RequirePermission('holding.manage', 'company')
  async removeView(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    await Views.remove(ctx, parse(z.uuid({ message: 'شناسه نامعتبر است' }), id));
    return { ok: true };
  }
}
