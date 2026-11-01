import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { Ctx, RequirePermission, type ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import { z } from 'zod';
import { parse } from './errors.js';
import { contractInput, employeeInput, endInput, leaveInput, leaveQuery, leaveTypesInput, listQuery, recordInput, reviewInput, skillsInput, trainingInput } from './inputs.js';
import { Employees, Leave, Reviews, Transfer } from './logic.js';

const uuid = (v: string) => parse(z.uuid({ message: 'شناسه نامعتبر است' }), v);
const ok = { ok: true };

/** Mounted at /api/m/hr/v1. */
@Controller()
export class HrController {
  // ---------------------------------------------------------------- employees
  @Get('employees')
  @RequirePermission('hr.employee.view', 'own')
  list(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return Employees.list(ctx, parse(listQuery, q));
  }

  @Get('employees/me')
  @RequirePermission('hr.employee.view', 'own')
  me(@Ctx() ctx: ModuleRequestContext) {
    return Employees.mine(ctx);
  }

  @Post('employees')
  @RequirePermission('hr.employee.manage', 'company')
  create(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Employees.save(ctx, null, parse(employeeInput, body));
  }

  @Get('employees/:id')
  @RequirePermission('hr.employee.view', 'own')
  get(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Employees.get(ctx, uuid(id), todayIso());
  }

  @Put('employees/:id')
  @RequirePermission('hr.employee.manage', 'company')
  update(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Employees.save(ctx, uuid(id), parse(employeeInput, body));
  }

  @Post('employees/:id/end')
  @HttpCode(200)
  @RequirePermission('hr.employee.manage', 'company')
  async end(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    await Employees.end(ctx, uuid(id), parse(endInput, body));
    return ok;
  }

  @Post('employees/:id/records')
  @RequirePermission('hr.employee.manage', 'company')
  record(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Employees.addRecord(ctx, uuid(id), parse(recordInput, body));
  }

  @Put('employees/:id/skills')
  @RequirePermission('hr.employee.manage', 'company')
  async skills(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    await Employees.setSkills(ctx, uuid(id), parse(skillsInput, body));
    return ok;
  }

  @Post('employees/:id/trainings')
  @RequirePermission('hr.employee.manage', 'company')
  training(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Employees.addTraining(ctx, uuid(id), parse(trainingInput, body));
  }

  @Delete('employees/:id/trainings/:tid')
  @RequirePermission('hr.employee.manage', 'company')
  async removeTraining(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('tid') tid: string) {
    await Employees.removeTraining(ctx, uuid(id), uuid(tid));
    return ok;
  }

  @Post('employees/:id/contracts')
  @RequirePermission('hr.contract.manage', 'company')
  contract(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Employees.addContract(ctx, uuid(id), parse(contractInput, body));
  }

  // ---------------------------------------------------------------- transfer from recruitment
  @Get('transfer/hired')
  @RequirePermission('hr.employee.manage', 'company')
  hired(@Ctx() ctx: ModuleRequestContext) {
    return Transfer.hired(ctx);
  }

  @Get('transfer/candidates/:id')
  @RequirePermission('hr.employee.manage', 'company')
  candidate(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Transfer.candidate(ctx, uuid(id));
  }

  // ---------------------------------------------------------------- leave
  @Get('leave/types')
  @RequirePermission('hr.leave.request', 'own')
  types(@Ctx() ctx: ModuleRequestContext) {
    return Leave.types(ctx);
  }

  @Put('leave/types')
  @RequirePermission('hr.leave.manage', 'company')
  async saveTypes(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    await Leave.saveTypes(ctx, parse(leaveTypesInput, body));
    return ok;
  }

  @Get('leave')
  @RequirePermission('hr.leave.request', 'own')
  leave(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return Leave.list(ctx, parse(leaveQuery, q));
  }

  @Post('leave')
  @RequirePermission('hr.leave.request', 'own')
  request(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Leave.request(ctx, parse(leaveInput, body));
  }

  @Post('leave/:id/cancel')
  @HttpCode(200)
  @RequirePermission('hr.leave.request', 'own')
  cancel(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Leave.cancel(ctx, uuid(id));
  }

  // ---------------------------------------------------------------- reviews
  @Get('reviews')
  @RequirePermission('hr.review.view', 'own')
  reviews(@Ctx() ctx: ModuleRequestContext) {
    return Reviews.list(ctx);
  }

  @Post('reviews')
  @RequirePermission('hr.review.manage', 'company')
  createReview(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown, @Query('finalize') finalize?: string) {
    return Reviews.save(ctx, null, parse(reviewInput, body), finalize === '1');
  }

  @Put('reviews/:id')
  @RequirePermission('hr.review.manage', 'company')
  updateReview(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown, @Query('finalize') finalize?: string) {
    return Reviews.save(ctx, uuid(id), parse(reviewInput, body), finalize === '1');
  }
}
