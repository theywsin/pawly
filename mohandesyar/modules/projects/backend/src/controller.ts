import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { Ctx, RequirePermission, type ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import { z } from 'zod';
import { parse } from './errors.js';
import { activityInput, changeRequestInput, dailyReportInput, dependencyInput, issueInput, listQuery, memberInput, phaseInput, phaseStatusInput, progressInput, projectInput, riskInput } from './inputs.js';
import { Projects } from './logic.js';

const uuid = (v: string) => parse(z.uuid({ message: 'شناسه نامعتبر است' }), v);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ معتبر نیست');

/**
 * Mounted at /api/m/projects/v1. Route permissions are checked at the weakest useful scope ("project");
 * logic.ts then requires company scope or membership of the specific project.
 */
@Controller('projects')
export class ProjectsController {
  @Get()
  @RequirePermission('projects.project.view', 'project')
  list(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return Projects.list(ctx, parse(listQuery, q), todayIso());
  }

  @Get('lookups/:kind')
  @RequirePermission('projects.project.view', 'project')
  lookup(@Ctx() ctx: ModuleRequestContext, @Param('kind') kind: string, @Query('q') q = '') {
    return Projects.lookup(ctx, parse(z.enum(['contracts', 'accounts']), kind), String(q).slice(0, 100));
  }

  @Post()
  @RequirePermission('projects.project.create', 'company')
  create(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Projects.create(ctx, parse(projectInput, body));
  }

  @Get(':id')
  @RequirePermission('projects.project.view', 'project')
  async get(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    const r = await Projects.get(ctx, uuid(id), todayIso());
    return { ...r, linked: await Projects.linked(ctx, r.project) };
  }

  @Get(':id/curve')
  @RequirePermission('projects.project.view', 'project')
  curve(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Projects.curve(ctx, uuid(id), todayIso());
  }

  @Put(':id')
  @RequirePermission('projects.project.update', 'project')
  async update(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    const { version } = parse(z.object({ version: z.number().int() }).loose(), body);
    await Projects.update(ctx, uuid(id), version, parse(projectInput, body));
    return { ok: true };
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermission('projects.project.delete', 'company')
  async remove(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    await Projects.remove(ctx, uuid(id));
    return { ok: true };
  }

  @Post(':id/members')
  @HttpCode(200)
  @RequirePermission('projects.project.update', 'project')
  async addMember(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    await Projects.addMember(ctx, uuid(id), parse(memberInput, body));
    return { ok: true };
  }

  @Delete(':id/members/:userId')
  @HttpCode(200)
  @RequirePermission('projects.project.update', 'project')
  async removeMember(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('userId') userId: string) {
    await Projects.removeMember(ctx, uuid(id), uuid(userId));
    return { ok: true };
  }

  @Post(':id/activities')
  @RequirePermission('projects.schedule.edit', 'project')
  addActivity(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Projects.addActivity(ctx, uuid(id), parse(activityInput, body));
  }

  @Put(':id/activities/:aid')
  @RequirePermission('projects.schedule.edit', 'project')
  async updateActivity(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('aid') aid: string, @Body() body: unknown) {
    await Projects.updateActivity(ctx, uuid(id), uuid(aid), parse(activityInput, body));
    return { ok: true };
  }

  @Delete(':id/activities/:aid')
  @HttpCode(200)
  @RequirePermission('projects.schedule.edit', 'project')
  async removeActivity(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('aid') aid: string) {
    await Projects.removeActivity(ctx, uuid(id), uuid(aid));
    return { ok: true };
  }

  @Post(':id/dependencies')
  @RequirePermission('projects.schedule.edit', 'project')
  addDependency(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Projects.addDependency(ctx, uuid(id), parse(dependencyInput, body));
  }

  @Delete(':id/dependencies/:did')
  @HttpCode(200)
  @RequirePermission('projects.schedule.edit', 'project')
  async removeDependency(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('did') did: string) {
    await Projects.removeDependency(ctx, uuid(id), uuid(did));
    return { ok: true };
  }

  @Post(':id/activities/:aid/progress')
  @HttpCode(200)
  @RequirePermission('projects.progress.record', 'project')
  async progress(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('aid') aid: string, @Body() body: unknown) {
    await Projects.recordProgress(ctx, uuid(id), uuid(aid), parse(progressInput, body));
    return { ok: true };
  }

  @Get(':id/activities/:aid/progress')
  @RequirePermission('projects.project.view', 'project')
  progressHistory(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('aid') aid: string) {
    return Projects.progressHistory(ctx, uuid(id), uuid(aid));
  }

  @Post(':id/phases')
  @RequirePermission('projects.project.update', 'project')
  addPhase(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Projects.addPhase(ctx, uuid(id), parse(phaseInput, body));
  }

  @Post(':id/phases/:phaseId/status')
  @HttpCode(200)
  @RequirePermission('projects.project.update', 'project')
  async phaseStatus(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('phaseId') phaseId: string, @Body() body: unknown) {
    await Projects.setPhaseStatus(ctx, uuid(id), uuid(phaseId), parse(phaseStatusInput, body));
    return { ok: true };
  }

  @Post(':id/issues')
  @RequirePermission('projects.progress.record', 'project')
  addIssue(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Projects.addIssue(ctx, uuid(id), parse(issueInput, body));
  }

  @Post(':id/issues/:iid/resolve')
  @HttpCode(200)
  @RequirePermission('projects.progress.record', 'project')
  async resolveIssue(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('iid') iid: string, @Body() body: unknown) {
    await Projects.resolveIssue(ctx, uuid(id), uuid(iid), parse(z.object({ resolvedOn: isoDate.nullable() }), body).resolvedOn);
    return { ok: true };
  }

  @Post(':id/risks')
  @RequirePermission('projects.progress.record', 'project')
  addRisk(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Projects.addRisk(ctx, uuid(id), parse(riskInput, body));
  }

  @Post(':id/risks/:rid/status')
  @HttpCode(200)
  @RequirePermission('projects.progress.record', 'project')
  async riskStatus(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('rid') rid: string, @Body() body: unknown) {
    await Projects.setRiskStatus(ctx, uuid(id), uuid(rid), parse(z.object({ status: z.enum(['open', 'closed']) }), body).status);
    return { ok: true };
  }

  @Post(':id/daily-reports')
  @RequirePermission('projects.progress.record', 'project')
  addDailyReport(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Projects.addDailyReport(ctx, uuid(id), parse(dailyReportInput, body));
  }

  @Post(':id/change-requests')
  @RequirePermission('projects.change.create', 'project')
  addChange(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Projects.addChange(ctx, uuid(id), parse(changeRequestInput, body));
  }

  @Post(':id/change-requests/:cid/submit')
  @HttpCode(200)
  @RequirePermission('projects.change.create', 'project')
  submitChange(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('cid') cid: string) {
    return Projects.submitChange(ctx, uuid(id), uuid(cid));
  }
}
