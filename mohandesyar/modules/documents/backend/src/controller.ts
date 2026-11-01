import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { Ctx, RequirePermission, type ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import { z } from 'zod';
import { parse } from './errors.js';
import { accessInput, categoryInput, disposeInput, documentInput, documentQuery, documentUpdate, folderInput, linkInput, policyInput, versionInput } from './inputs.js';
import { Documents, Lookups, Setup } from './logic.js';

const uuid = (v: string) => parse(z.uuid({ message: 'شناسه نامعتبر است' }), v);
const q100 = (q?: string) => (q ? String(q).slice(0, 100) : '');
const ok = { ok: true };

/**
 * Mounted at /api/m/documents/v1. Route permissions are the floor; who sees or edits a given document
 * (scope, confidentiality, access list) is decided per document in logic.ts.
 */
@Controller()
export class DocumentsController {
  // ---------------------------------------------------------------- documents
  @Get('documents')
  @RequirePermission('documents.view', 'own')
  list(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return Documents.list(ctx, parse(documentQuery, q), todayIso());
  }

  @Get('documents/:id')
  @RequirePermission('documents.view', 'own')
  get(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Documents.get(ctx, uuid(id), todayIso());
  }

  @Post('documents')
  @RequirePermission('documents.manage', 'project')
  create(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Documents.create(ctx, parse(documentInput, b), todayIso());
  }

  @Put('documents/:id')
  @HttpCode(200)
  @RequirePermission('documents.manage', 'project')
  async update(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    await Documents.update(ctx, uuid(id), parse(documentUpdate, b));
    return ok;
  }

  @Delete('documents/:id')
  @RequirePermission('documents.manage', 'project')
  async remove(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    await Documents.remove(ctx, uuid(id));
    return ok;
  }

  @Post('documents/:id/versions')
  @RequirePermission('documents.manage', 'project')
  addVersion(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    return Documents.addVersion(ctx, uuid(id), parse(versionInput, b), todayIso());
  }

  @Delete('documents/:id/versions/:versionId')
  @RequirePermission('documents.manage', 'project')
  async withdraw(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('versionId') v: string) {
    await Documents.withdrawVersion(ctx, uuid(id), uuid(v));
    return ok;
  }

  @Get('documents/:id/versions/:versionId/url')
  @RequirePermission('documents.view', 'own')
  url(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('versionId') v: string) {
    return Documents.versionUrl(ctx, uuid(id), uuid(v));
  }

  @Post('documents/:id/links')
  @RequirePermission('documents.manage', 'project')
  addLink(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    return Documents.addLink(ctx, uuid(id), parse(linkInput, b));
  }

  @Delete('documents/:id/links/:linkId')
  @RequirePermission('documents.manage', 'project')
  async removeLink(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('linkId') l: string) {
    await Documents.removeLink(ctx, uuid(id), uuid(l));
    return ok;
  }

  /** The owner may manage access with view rights only (e.g. a confidential document they own). */
  @Put('documents/:id/access')
  @HttpCode(200)
  @RequirePermission('documents.view', 'own')
  async access(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    await Documents.setAccess(ctx, uuid(id), parse(accessInput, b));
    return ok;
  }

  @Post('documents/:id/obsolete')
  @HttpCode(200)
  @RequirePermission('documents.manage', 'project')
  async obsolete(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    await Documents.obsolete(ctx, uuid(id));
    return ok;
  }

  @Post('documents/:id/dispose')
  @HttpCode(200)
  @RequirePermission('documents.admin', 'company')
  async dispose(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    await Documents.dispose(ctx, uuid(id), parse(disposeInput, b), todayIso());
    return ok;
  }

  // ---------------------------------------------------------------- lookups (for forms and filters)
  @Get('folders')
  @RequirePermission('documents.view', 'own')
  folders(@Ctx() ctx: ModuleRequestContext) {
    return Setup.folders(ctx);
  }

  @Get('categories')
  @RequirePermission('documents.view', 'own')
  categories(@Ctx() ctx: ModuleRequestContext) {
    return Setup.categories(ctx);
  }

  @Get('lookups/projects')
  @RequirePermission('documents.view', 'own')
  projects(@Ctx() ctx: ModuleRequestContext, @Query('q') q?: string) {
    return Lookups.projects(ctx, q100(q));
  }

  @Get('lookups/contracts')
  @RequirePermission('documents.manage', 'project')
  contracts(@Ctx() ctx: ModuleRequestContext, @Query('q') q?: string) {
    return Lookups.contracts(ctx, q100(q));
  }

  @Get('lookups/payments')
  @RequirePermission('documents.manage', 'project')
  payments(@Ctx() ctx: ModuleRequestContext, @Query('q') q?: string) {
    return Lookups.payments(ctx, q100(q));
  }

  // ---------------------------------------------------------------- administration
  @Post('folders')
  @RequirePermission('documents.admin', 'company')
  createFolder(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Setup.saveFolder(ctx, null, parse(folderInput, b));
  }

  @Put('folders/:id')
  @RequirePermission('documents.admin', 'company')
  updateFolder(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    return Setup.saveFolder(ctx, uuid(id), parse(folderInput, b));
  }

  @Delete('folders/:id')
  @RequirePermission('documents.admin', 'company')
  async removeFolder(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    await Setup.removeFolder(ctx, uuid(id));
    return ok;
  }

  @Post('categories')
  @RequirePermission('documents.admin', 'company')
  createCategory(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Setup.saveCategory(ctx, null, parse(categoryInput, b));
  }

  @Put('categories/:id')
  @RequirePermission('documents.admin', 'company')
  updateCategory(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    return Setup.saveCategory(ctx, uuid(id), parse(categoryInput, b));
  }

  @Get('retention-policies')
  @RequirePermission('documents.admin', 'company')
  policies(@Ctx() ctx: ModuleRequestContext) {
    return Setup.policies(ctx);
  }

  @Post('retention-policies')
  @RequirePermission('documents.admin', 'company')
  createPolicy(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Setup.savePolicy(ctx, null, parse(policyInput, b));
  }

  @Put('retention-policies/:id')
  @RequirePermission('documents.admin', 'company')
  updatePolicy(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    return Setup.savePolicy(ctx, uuid(id), parse(policyInput, b));
  }

  @Get('retention-due')
  @RequirePermission('documents.admin', 'company')
  retentionDue(@Ctx() ctx: ModuleRequestContext) {
    return Setup.retentionDue(ctx, todayIso());
  }
}
