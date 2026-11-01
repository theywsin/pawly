import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { Ctx, RequirePermission, type ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import { z } from 'zod';
import { parse } from './errors.js';
import { accountInput, contactInput, convertInput, interactionInput, leadInput, leadLostInput, moveInput, opportunityInput, proposalInput, proposalStatusInput, proposalVersionInput, reportQuery, stageInput } from './inputs.js';
import { Accounts, addInteraction, followups, Leads, Opportunities, salesReport, Stages } from './logic.js';

const uuid = (v: string) => parse(z.uuid({ message: 'شناسه نامعتبر است' }), v);
const q = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : undefined);

/** Mounted at /api/m/crm/v1. "own" scope rows are filtered in logic.ts (owner or creator). */
@Controller()
export class CrmController {
  // ------------------------------------------------------------- accounts
  @Get('accounts')
  @RequirePermission('crm.account.view', 'own')
  accounts(@Ctx() ctx: ModuleRequestContext, @Query('q') search?: string) {
    return Accounts.list(ctx, q(search));
  }

  @Post('accounts')
  @RequirePermission('crm.account.manage', 'own')
  createAccount(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Accounts.save(ctx, null, parse(accountInput, body));
  }

  @Get('accounts/:id')
  @RequirePermission('crm.account.view', 'own')
  account(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Accounts.get(ctx, uuid(id));
  }

  @Put('accounts/:id')
  @RequirePermission('crm.account.manage', 'own')
  updateAccount(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Accounts.save(ctx, uuid(id), parse(accountInput, body));
  }

  @Post('accounts/:id/contacts')
  @RequirePermission('crm.account.manage', 'own')
  addContact(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Accounts.addContact(ctx, uuid(id), parse(contactInput, body));
  }

  @Delete('accounts/:id/contacts/:contactId')
  @HttpCode(200)
  @RequirePermission('crm.account.manage', 'own')
  async removeContact(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('contactId') contactId: string) {
    await Accounts.removeContact(ctx, uuid(id), uuid(contactId));
    return { ok: true };
  }

  @Post('interactions')
  @RequirePermission('crm.account.view', 'own')
  interaction(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return addInteraction(ctx, parse(interactionInput, body));
  }

  // ------------------------------------------------------------- leads
  @Get('leads')
  @RequirePermission('crm.pipeline.view', 'own')
  leads(@Ctx() ctx: ModuleRequestContext, @Query('status') status?: string, @Query('q') search?: string) {
    return Leads.list(ctx, { status: status ? parse(z.enum(['new', 'contacted', 'qualified', 'converted', 'lost']), status) : undefined, q: q(search) });
  }

  @Post('leads')
  @RequirePermission('crm.pipeline.manage', 'own')
  createLead(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Leads.save(ctx, null, parse(leadInput, body));
  }

  @Get('leads/:id')
  @RequirePermission('crm.pipeline.view', 'own')
  lead(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Leads.get(ctx, uuid(id));
  }

  @Put('leads/:id')
  @RequirePermission('crm.pipeline.manage', 'own')
  updateLead(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Leads.save(ctx, uuid(id), parse(leadInput, body));
  }

  @Post('leads/:id/lost')
  @HttpCode(200)
  @RequirePermission('crm.pipeline.manage', 'own')
  async loseLead(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    await Leads.lose(ctx, uuid(id), parse(leadLostInput, body).reason);
    return { ok: true };
  }

  @Post('leads/:id/convert')
  @HttpCode(200)
  @RequirePermission('crm.pipeline.manage', 'own')
  convert(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Leads.convert(ctx, uuid(id), parse(convertInput, body));
  }

  // ------------------------------------------------------------- opportunities
  @Get('board')
  @RequirePermission('crm.pipeline.view', 'own')
  board(@Ctx() ctx: ModuleRequestContext) {
    return Opportunities.board(ctx);
  }

  @Get('followups')
  @RequirePermission('crm.pipeline.view', 'own')
  followups(@Ctx() ctx: ModuleRequestContext) {
    return followups(ctx, todayIso());
  }

  @Post('opportunities')
  @RequirePermission('crm.pipeline.manage', 'own')
  createOpportunity(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Opportunities.save(ctx, null, parse(opportunityInput, body));
  }

  @Get('opportunities/:id')
  @RequirePermission('crm.pipeline.view', 'own')
  opportunity(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Opportunities.get(ctx, uuid(id));
  }

  @Put('opportunities/:id')
  @RequirePermission('crm.pipeline.manage', 'own')
  updateOpportunity(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Opportunities.save(ctx, uuid(id), parse(opportunityInput, body));
  }

  @Post('opportunities/:id/move')
  @HttpCode(200)
  @RequirePermission('crm.pipeline.manage', 'own')
  move(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Opportunities.move(ctx, uuid(id), parse(moveInput, body), todayIso());
  }

  @Post('opportunities/:id/proposals')
  @RequirePermission('crm.pipeline.manage', 'own')
  addProposal(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Opportunities.addProposal(ctx, uuid(id), parse(proposalInput, body));
  }

  @Post('opportunities/:id/proposals/:pid/versions')
  @RequirePermission('crm.pipeline.manage', 'own')
  addVersion(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('pid') pid: string, @Body() body: unknown) {
    return Opportunities.addProposalVersion(ctx, uuid(id), uuid(pid), parse(proposalVersionInput, body));
  }

  @Post('opportunities/:id/proposals/:pid/status')
  @HttpCode(200)
  @RequirePermission('crm.pipeline.manage', 'own')
  async proposalStatus(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('pid') pid: string, @Body() body: unknown) {
    await Opportunities.setProposalStatus(ctx, uuid(id), uuid(pid), parse(proposalStatusInput, body));
    return { ok: true };
  }

  @Get('lookups/:kind')
  @RequirePermission('crm.pipeline.view', 'own')
  lookup(@Ctx() ctx: ModuleRequestContext, @Param('kind') kind: string, @Query('q') search = '') {
    return Opportunities.lookup(ctx, parse(z.enum(['projects', 'contracts']), kind), String(search).slice(0, 100));
  }

  // ------------------------------------------------------------- pipeline settings and reports
  @Get('stages')
  @RequirePermission('crm.pipeline.view', 'own')
  stages(@Ctx() ctx: ModuleRequestContext) {
    return Stages.list(ctx);
  }

  @Put('stages/:id')
  @RequirePermission('crm.settings.manage', 'company')
  saveStage(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Stages.save(ctx, id === 'new' ? null : uuid(id), parse(stageInput, body));
  }

  @Post('stages/:id/archive')
  @HttpCode(200)
  @RequirePermission('crm.settings.manage', 'company')
  async archiveStage(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    await Stages.archive(ctx, uuid(id), parse(z.object({ archived: z.boolean() }), body).archived);
    return { ok: true };
  }

  @Get('reports/sales')
  @RequirePermission('crm.report.view', 'company')
  report(@Ctx() ctx: ModuleRequestContext, @Query() query: unknown) {
    return salesReport(ctx, parse(reportQuery, query));
  }
}
