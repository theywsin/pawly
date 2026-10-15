import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { Ctx, RequirePermission, type ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import { z } from 'zod';
import { parse } from './errors.js';
import { activateInput, activeContractUpdate, amendmentInput, closeInput, contractInput, guaranteeInput, guaranteeStatusInput, listQuery, obligationDoneInput, obligationInput, paymentTermInput, statementInput } from './inputs.js';
import { Contracts, expiringSoon } from './logic.js';

const uuid = (v: string) => parse(z.uuid({ message: 'شناسه نامعتبر است' }), v);

/** Mounted at /api/m/contracts/v1. Every route declares its permission; row-level "own" checks are in logic.ts. */
@Controller()
export class ContractsController {
  @Get('contracts')
  @RequirePermission('contracts.contract.view', 'own')
  list(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return Contracts.list(ctx, parse(listQuery, q));
  }

  @Get('summary')
  @RequirePermission('contracts.contract.view', 'own')
  summary(@Ctx() ctx: ModuleRequestContext) {
    return Contracts.summary(ctx);
  }

  @Get('expiring')
  @RequirePermission('contracts.contract.view', 'own')
  expiring(@Ctx() ctx: ModuleRequestContext) {
    return expiringSoon(ctx, todayIso());
  }

  @Get('lookups/:kind')
  @RequirePermission('contracts.contract.view', 'own')
  lookup(@Ctx() ctx: ModuleRequestContext, @Param('kind') kind: string, @Query('q') q = '') {
    return Contracts.lookup(ctx, parse(z.enum(['projects', 'accounts']), kind), String(q).slice(0, 100));
  }

  @Post('contracts')
  @RequirePermission('contracts.contract.create', 'company')
  create(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Contracts.create(ctx, parse(contractInput, body));
  }

  @Get('contracts/:id')
  @RequirePermission('contracts.contract.view', 'own')
  async get(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    const r = await Contracts.get(ctx, uuid(id));
    return { ...r, linked: await Contracts.linkedNames(ctx, r.contract) };
  }

  @Put('contracts/:id')
  @RequirePermission('contracts.contract.update', 'own')
  async update(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ version: z.number().int(), status: z.enum(['draft', 'active', 'completed', 'terminated']) }).loose(), body);
    await Contracts.update(ctx, uuid(id), b.version, b.status === 'draft' ? parse(contractInput, body) : parse(activeContractUpdate, body));
    return { ok: true };
  }

  @Post('contracts/:id/activate')
  @HttpCode(200)
  @RequirePermission('contracts.contract.update', 'own')
  async activate(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    await Contracts.activate(ctx, uuid(id), parse(activateInput, body).signedOn);
    return { ok: true };
  }

  @Post('contracts/:id/close')
  @HttpCode(200)
  @RequirePermission('contracts.contract.update', 'own')
  async close(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(closeInput, body);
    await Contracts.close(ctx, uuid(id), b.status, b.note);
    return { ok: true };
  }

  @Delete('contracts/:id')
  @HttpCode(200)
  @RequirePermission('contracts.contract.delete', 'company')
  async remove(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    await Contracts.remove(ctx, uuid(id));
    return { ok: true };
  }

  @Post('contracts/:id/amendments')
  @RequirePermission('contracts.contract.update', 'own')
  amend(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Contracts.addAmendment(ctx, uuid(id), parse(amendmentInput, body));
  }

  @Post('contracts/:id/guarantees')
  @RequirePermission('contracts.contract.update', 'own')
  addGuarantee(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Contracts.addGuarantee(ctx, uuid(id), parse(guaranteeInput, body));
  }

  @Post('contracts/:id/guarantees/:gid/status')
  @HttpCode(200)
  @RequirePermission('contracts.contract.update', 'own')
  async guaranteeStatus(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('gid') gid: string, @Body() body: unknown) {
    await Contracts.setGuaranteeStatus(ctx, uuid(id), uuid(gid), parse(guaranteeStatusInput, body));
    return { ok: true };
  }

  @Post('contracts/:id/payment-terms')
  @RequirePermission('contracts.contract.update', 'own')
  addPaymentTerm(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Contracts.addPaymentTerm(ctx, uuid(id), parse(paymentTermInput, body));
  }

  @Post('contracts/:id/obligations')
  @RequirePermission('contracts.contract.update', 'own')
  addObligation(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Contracts.addObligation(ctx, uuid(id), parse(obligationInput, body));
  }

  @Post('contracts/:id/obligations/:oid/done')
  @HttpCode(200)
  @RequirePermission('contracts.contract.update', 'own')
  async obligationDone(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('oid') oid: string, @Body() body: unknown) {
    await Contracts.setObligationDone(ctx, uuid(id), uuid(oid), parse(obligationDoneInput, body).doneOn);
    return { ok: true };
  }

  @Delete('contracts/:id/:kind/:itemId')
  @HttpCode(200)
  @RequirePermission('contracts.contract.update', 'own')
  async removeItem(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('kind') kind: string, @Param('itemId') itemId: string) {
    const k = parse(z.enum(['guarantees', 'payment-terms', 'obligations']), kind);
    await Contracts.removeItem(ctx, uuid(id), ({ guarantees: 'guarantee', 'payment-terms': 'payment-term', obligations: 'obligation' } as const)[k], uuid(itemId));
    return { ok: true };
  }

  @Post('contracts/:id/statements/preview')
  @HttpCode(200)
  @RequirePermission('contracts.contract.view', 'own')
  preview(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown, @Query('exclude') exclude?: string) {
    return Contracts.previewStatement(ctx, uuid(id), parse(statementInput, body), exclude ? uuid(exclude) : undefined);
  }

  @Post('contracts/:id/statements')
  @RequirePermission('contracts.statement.create', 'own')
  createStatement(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Contracts.createStatement(ctx, uuid(id), parse(statementInput, body));
  }

  @Put('contracts/:id/statements/:sid')
  @RequirePermission('contracts.statement.create', 'own')
  async updateStatement(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('sid') sid: string, @Body() body: unknown) {
    await Contracts.updateStatement(ctx, uuid(id), uuid(sid), parse(statementInput, body));
    return { ok: true };
  }

  @Delete('contracts/:id/statements/:sid')
  @HttpCode(200)
  @RequirePermission('contracts.statement.create', 'own')
  async deleteStatement(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('sid') sid: string) {
    await Contracts.deleteStatement(ctx, uuid(id), uuid(sid));
    return { ok: true };
  }

  @Post('contracts/:id/statements/:sid/submit')
  @HttpCode(200)
  @RequirePermission('contracts.statement.create', 'own')
  submit(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('sid') sid: string) {
    return Contracts.submitStatement(ctx, uuid(id), uuid(sid));
  }
}
