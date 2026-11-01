import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { Ctx, RequirePermission, type ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import { z } from 'zod';
import { parse } from './errors.js';
import { listQuery, meetingInput, minutesInput, resolutionInput, resolutionQuery, resolutionUpdateInput } from './inputs.js';
import { Meetings } from './logic.js';

const uuid = (v: string) => parse(z.uuid({ message: 'شناسه نامعتبر است' }), v);

/** Mounted at /api/m/meetings/v1. */
@Controller()
export class MeetingsController {
  @Get('meetings')
  @RequirePermission('meetings.meeting.view', 'own')
  list(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return Meetings.list(ctx, parse(listQuery, q));
  }

  @Post('meetings')
  @RequirePermission('meetings.meeting.manage', 'own')
  create(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Meetings.save(ctx, null, parse(meetingInput, body));
  }

  @Get('meetings/:id')
  @RequirePermission('meetings.meeting.view', 'own')
  get(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Meetings.get(ctx, uuid(id));
  }

  @Put('meetings/:id')
  @RequirePermission('meetings.meeting.manage', 'own')
  update(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Meetings.save(ctx, uuid(id), parse(meetingInput, body));
  }

  @Post('meetings/:id/cancel')
  @HttpCode(200)
  @RequirePermission('meetings.meeting.manage', 'own')
  async cancel(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    await Meetings.cancel(ctx, uuid(id));
    return { ok: true };
  }

  @Put('meetings/:id/minutes')
  @RequirePermission('meetings.meeting.manage', 'own')
  async minutes(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown, @Query('finalize') finalize?: string) {
    await Meetings.saveMinutes(ctx, uuid(id), parse(minutesInput, body), finalize === '1');
    return { ok: true };
  }

  @Post('meetings/:id/resolutions')
  @RequirePermission('meetings.meeting.manage', 'own')
  addResolution(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Meetings.addResolution(ctx, uuid(id), parse(resolutionInput, body));
  }

  /** Projects for linking, through the projects module's public service (empty when it is not active). */
  @Get('lookups/projects')
  @RequirePermission('meetings.meeting.manage', 'own')
  projects(@Ctx() ctx: ModuleRequestContext, @Query('q') q = '') {
    const svc = ctx.services.get<{ search(q: string, limit: number): Promise<{ id: string; code: string; title: string }[]> }>('projects.projects', '^1');
    return svc ? svc.search(String(q).slice(0, 100), 30) : [];
  }

  @Get('resolutions')
  @RequirePermission('meetings.meeting.view', 'own')
  resolutions(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return Meetings.resolutions(ctx, parse(resolutionQuery, q), todayIso());
  }

  @Put('resolutions/:rid')
  @RequirePermission('meetings.resolution.update', 'own')
  async updateResolution(@Ctx() ctx: ModuleRequestContext, @Param('rid') rid: string, @Body() body: unknown) {
    await Meetings.updateResolution(ctx, uuid(rid), parse(resolutionUpdateInput, body));
    return { ok: true };
  }
}
