import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { Ctx, RequirePermission, type ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { z } from 'zod';
import { parse } from './errors.js';
import { commentInput, computeInput, decisionInput, definitionInput, rewardRuleInput, scorecardComputeInput, scorecardQuery, sheetQuery, targetsInput, valueInput } from './inputs.js';
import { Definitions, Rewards, Scorecards, Values, subjects } from './logic.js';

const uuid = (v: string) => parse(z.uuid({ message: 'شناسه نامعتبر است' }), v);
const ok = { ok: true };

/** Mounted at /api/m/kpi/v1. */
@Controller()
export class KpiController {
  // ---------------------------------------------------------------- definitions
  @Get('providers')
  @RequirePermission('kpi.view', 'own')
  providers(@Ctx() ctx: ModuleRequestContext) {
    return Definitions.providers(ctx);
  }

  @Get('definitions')
  @RequirePermission('kpi.view', 'own')
  definitions(@Ctx() ctx: ModuleRequestContext) {
    return Definitions.list(ctx);
  }

  @Post('definitions')
  @RequirePermission('kpi.definition.manage', 'company')
  create(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Definitions.save(ctx, null, parse(definitionInput, body));
  }

  @Get('definitions/:id')
  @RequirePermission('kpi.view', 'own')
  definition(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Definitions.get(ctx, uuid(id));
  }

  @Put('definitions/:id')
  @RequirePermission('kpi.definition.manage', 'company')
  update(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Definitions.save(ctx, uuid(id), parse(definitionInput, body));
  }

  @Put('definitions/:id/targets')
  @RequirePermission('kpi.definition.manage', 'company')
  async targets(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    await Definitions.setTargets(ctx, uuid(id), parse(targetsInput, body));
    return ok;
  }

  @Get('subjects')
  @RequirePermission('kpi.view', 'own')
  subjects(@Ctx() ctx: ModuleRequestContext, @Query('type') type = 'org') {
    return subjects(ctx, parse(z.enum(['org', 'unit', 'project', 'role', 'person']), type));
  }

  // ---------------------------------------------------------------- values
  @Get('values')
  @RequirePermission('kpi.view', 'own')
  sheet(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return Values.sheet(ctx, parse(sheetQuery, q));
  }

  @Post('definitions/:id/values')
  @RequirePermission('kpi.value.enter', 'own')
  enter(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Values.enter(ctx, uuid(id), parse(valueInput, body));
  }

  @Post('definitions/:id/compute')
  @RequirePermission('kpi.value.enter', 'own')
  compute(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Values.compute(ctx, uuid(id), parse(computeInput, body));
  }

  @Post('values/:id/decision')
  @HttpCode(200)
  @RequirePermission('kpi.value.approve', 'company')
  async decide(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    await Values.decide(ctx, uuid(id), parse(decisionInput, body));
    return ok;
  }

  @Post('values/:id/reopen')
  @HttpCode(200)
  @RequirePermission('kpi.value.approve', 'company')
  async reopen(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    await Values.reopen(ctx, uuid(id), parse(commentInput, body).comment);
    return ok;
  }

  @Get('values/:id/history')
  @RequirePermission('kpi.view', 'own')
  history(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Values.history(ctx, uuid(id));
  }

  // ---------------------------------------------------------------- scorecards
  @Post('scorecards/compute')
  @HttpCode(200)
  @RequirePermission('kpi.scorecard.review', 'company')
  computeCards(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Scorecards.compute(ctx, parse(scorecardComputeInput, body));
  }

  @Get('scorecards')
  @RequirePermission('kpi.view', 'own')
  cards(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return Scorecards.list(ctx, parse(scorecardQuery, q));
  }

  @Get('scorecards/:id')
  @RequirePermission('kpi.view', 'own')
  card(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Scorecards.get(ctx, uuid(id));
  }

  @Post('scorecards/:id/review')
  @HttpCode(200)
  @RequirePermission('kpi.scorecard.review', 'company')
  async review(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    await Scorecards.review(ctx, uuid(id), parse(commentInput, body).comment);
    return ok;
  }

  @Post('scorecards/:id/approve')
  @HttpCode(200)
  @RequirePermission('kpi.scorecard.approve', 'company')
  async approve(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    await Scorecards.approve(ctx, uuid(id), parse(commentInput, body).comment);
    return ok;
  }

  // ---------------------------------------------------------------- reward rules (suggestions only)
  @Get('reward-rules')
  @RequirePermission('kpi.view', 'company')
  rules(@Ctx() ctx: ModuleRequestContext) {
    return Rewards.list(ctx);
  }

  @Post('reward-rules')
  @RequirePermission('kpi.reward.manage', 'company')
  saveRule(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Rewards.save(ctx, parse(rewardRuleInput, body));
  }
}
