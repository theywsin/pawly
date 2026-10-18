import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { Ctx, RequirePermission, type ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import { z } from 'zod';
import { parse } from './errors.js';
import { attendanceInput, doneInput, dutyInput, rangeQuery, reportInput, reviewInput, scoreInput, taskInput, taskQuery } from './inputs.js';
import { Taskboard } from './logic.js';

const uuid = (v: string) => parse(z.uuid({ message: 'شناسه نامعتبر است' }), v);
const optUuid = (v: unknown) => (v === undefined || v === '' ? undefined : uuid(String(v)));

/** Mounted at /api/m/taskboard/v1. Manager-only actions also check taskboard.manage@company in the logic. */
@Controller()
export class TaskboardController {
  @Get('me/today')
  @RequirePermission('taskboard.use', 'own')
  today(@Ctx() ctx: ModuleRequestContext) {
    return Taskboard.today(ctx, todayIso());
  }

  @Get('tasks')
  @RequirePermission('taskboard.use', 'own')
  tasks(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return Taskboard.tasks(ctx, parse(taskQuery, q));
  }

  @Post('tasks')
  @RequirePermission('taskboard.manage', 'company')
  create(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Taskboard.createTasks(ctx, parse(taskInput, body));
  }

  @Post('tasks/:id/done')
  @HttpCode(200)
  @RequirePermission('taskboard.use', 'own')
  done(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Taskboard.done(ctx, uuid(id), parse(doneInput, body ?? {}));
  }

  @Post('tasks/:id/undo')
  @HttpCode(200)
  @RequirePermission('taskboard.use', 'own')
  undo(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Taskboard.undo(ctx, uuid(id));
  }

  @Post('tasks/:id/review')
  @HttpCode(200)
  @RequirePermission('taskboard.manage', 'company')
  review(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Taskboard.review(ctx, uuid(id), parse(reviewInput, body));
  }

  @Post('tasks/:id/cancel')
  @HttpCode(200)
  @RequirePermission('taskboard.manage', 'company')
  cancel(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Taskboard.cancel(ctx, uuid(id));
  }

  @Get('duties')
  @RequirePermission('taskboard.manage', 'company')
  duties(@Ctx() ctx: ModuleRequestContext) {
    return Taskboard.duties(ctx);
  }

  @Post('duties')
  @RequirePermission('taskboard.manage', 'company')
  createDuty(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Taskboard.saveDuty(ctx, null, parse(dutyInput, body), todayIso());
  }

  @Put('duties/:id')
  @RequirePermission('taskboard.manage', 'company')
  updateDuty(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Taskboard.saveDuty(ctx, uuid(id), parse(dutyInput, body), todayIso());
  }

  @Post('duties/:id/active')
  @HttpCode(200)
  @RequirePermission('taskboard.manage', 'company')
  dutyActive(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Taskboard.setDutyActive(ctx, uuid(id), parse(z.object({ active: z.boolean() }), body).active);
  }

  @Post('attendance/check-in')
  @HttpCode(200)
  @RequirePermission('taskboard.use', 'own')
  checkIn(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Taskboard.checkIn(ctx, parse(attendanceInput, body ?? {}), todayIso());
  }

  @Post('attendance/check-out')
  @HttpCode(200)
  @RequirePermission('taskboard.use', 'own')
  checkOut(@Ctx() ctx: ModuleRequestContext) {
    return Taskboard.checkOut(ctx, todayIso());
  }

  @Get('attendance')
  @RequirePermission('taskboard.use', 'own')
  attendance(@Ctx() ctx: ModuleRequestContext, @Query() q: Record<string, unknown>) {
    return Taskboard.attendance(ctx, parse(rangeQuery, q), optUuid(q.userId));
  }

  @Put('reports/today')
  @RequirePermission('taskboard.use', 'own')
  saveReport(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Taskboard.saveReport(ctx, parse(reportInput, body), todayIso());
  }

  @Get('reports')
  @RequirePermission('taskboard.use', 'own')
  reports(@Ctx() ctx: ModuleRequestContext, @Query() q: Record<string, unknown>) {
    return Taskboard.reports(ctx, parse(rangeQuery, q), optUuid(q.userId));
  }

  @Post('reports/:id/score')
  @HttpCode(200)
  @RequirePermission('taskboard.manage', 'company')
  scoreReport(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Taskboard.scoreReport(ctx, uuid(id), parse(scoreInput, body));
  }

  @Get('scorecard')
  @RequirePermission('taskboard.use', 'own')
  scorecard(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return Taskboard.scorecard(ctx, parse(rangeQuery, q), todayIso());
  }
}
