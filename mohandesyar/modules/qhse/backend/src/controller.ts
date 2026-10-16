import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { Ctx, RequirePermission, type ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import { z } from 'zod';
import { parse } from './errors.js';
import {
  actionDoneInput, actionInput, actionQuery, checklistInput, incidentInput, incidentQuery, inspectionInput, investigationInput, manhoursInput, ncrInput, ppeInput, reportQuery, riskInput,
  settingsInput, trainingInput,
} from './inputs.js';
import { Actions, Incidents, Inspections, Manhours, Ncrs, Ppe, projectOptions, Risks, Settings, statusReport, Training } from './logic.js';

const uuid = (v: string) => parse(z.uuid({ message: 'شناسه نامعتبر است' }), v);
const ok = { ok: true };

/** Mounted at /api/m/qhse/v1. Project scope is applied per row in logic.ts. */
@Controller()
export class QhseController {
  // ---------------------------------------------------------------- incidents
  @Get('incidents')
  @RequirePermission('qhse.incident.report', 'project')
  incidents(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return Incidents.list(ctx, parse(incidentQuery, q));
  }

  @Get('incidents/:id')
  @RequirePermission('qhse.incident.report', 'project')
  incident(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Incidents.get(ctx, uuid(id));
  }

  @Post('incidents')
  @RequirePermission('qhse.incident.report', 'project')
  report(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Incidents.report(ctx, parse(incidentInput, b));
  }

  @Post('incidents/:id/investigation')
  @HttpCode(200)
  @RequirePermission('qhse.manage', 'project')
  async investigate(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    await Incidents.investigate(ctx, uuid(id), parse(investigationInput, b));
    return ok;
  }

  @Get('projects')
  @RequirePermission('qhse.incident.report', 'project')
  projects(@Ctx() ctx: ModuleRequestContext) {
    return projectOptions(ctx);
  }

  // ---------------------------------------------------------------- man-hours, risks
  @Get('manhours')
  @RequirePermission('qhse.view', 'project')
  manhours(@Ctx() ctx: ModuleRequestContext) {
    return Manhours.list(ctx);
  }

  @Put('manhours')
  @HttpCode(200)
  @RequirePermission('qhse.manage', 'project')
  async saveManhours(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    await Manhours.save(ctx, parse(manhoursInput, b));
    return ok;
  }

  @Get('risks')
  @RequirePermission('qhse.view', 'project')
  risks(@Ctx() ctx: ModuleRequestContext) {
    return Risks.list(ctx);
  }

  @Post('risks')
  @RequirePermission('qhse.manage', 'project')
  createRisk(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Risks.save(ctx, null, parse(riskInput, b));
  }

  @Put('risks/:id')
  @RequirePermission('qhse.manage', 'project')
  updateRisk(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    return Risks.save(ctx, uuid(id), parse(riskInput, b));
  }

  // ---------------------------------------------------------------- inspections
  @Get('checklists')
  @RequirePermission('qhse.view', 'project')
  checklists(@Ctx() ctx: ModuleRequestContext) {
    return Inspections.checklists(ctx);
  }

  @Post('checklists')
  @RequirePermission('qhse.admin', 'company')
  createChecklist(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Inspections.saveChecklist(ctx, null, parse(checklistInput, b));
  }

  @Put('checklists/:id')
  @RequirePermission('qhse.admin', 'company')
  updateChecklist(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    return Inspections.saveChecklist(ctx, uuid(id), parse(checklistInput, b));
  }

  @Get('inspections')
  @RequirePermission('qhse.view', 'project')
  inspections(@Ctx() ctx: ModuleRequestContext) {
    return Inspections.list(ctx);
  }

  @Get('inspections/:id')
  @RequirePermission('qhse.view', 'project')
  inspection(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Inspections.get(ctx, uuid(id));
  }

  @Post('inspections')
  @RequirePermission('qhse.manage', 'project')
  inspect(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Inspections.create(ctx, parse(inspectionInput, b));
  }

  // ---------------------------------------------------------------- non-conformances and actions
  @Get('ncrs')
  @RequirePermission('qhse.view', 'project')
  ncrs(@Ctx() ctx: ModuleRequestContext) {
    return Ncrs.list(ctx);
  }

  @Get('ncrs/:id')
  @RequirePermission('qhse.view', 'project')
  ncr(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Ncrs.get(ctx, uuid(id));
  }

  @Post('ncrs')
  @RequirePermission('qhse.manage', 'project')
  raise(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Ncrs.create(ctx, parse(ncrInput, b));
  }

  @Post('ncrs/:id/close')
  @HttpCode(200)
  @RequirePermission('qhse.manage', 'project')
  async closeNcr(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    await Ncrs.close(ctx, uuid(id));
    return ok;
  }

  /** Owners see their own actions even without view rights (they need to report them done). */
  @Get('actions')
  @RequirePermission('qhse.incident.report', 'project')
  actions(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return Actions.list(ctx, parse(actionQuery, q), todayIso());
  }

  @Post('actions')
  @RequirePermission('qhse.manage', 'project')
  createAction(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Actions.create(ctx, parse(actionInput, b));
  }

  @Post('actions/:id/done')
  @HttpCode(200)
  @RequirePermission('qhse.incident.report', 'project')
  async done(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    await Actions.done(ctx, uuid(id), parse(actionDoneInput, b));
    return ok;
  }

  @Post('actions/:id/verify')
  @HttpCode(200)
  @RequirePermission('qhse.manage', 'project')
  async verify(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() b: unknown) {
    await Actions.verify(ctx, uuid(id), parse(z.object({ accept: z.boolean() }), b).accept);
    return ok;
  }

  // ---------------------------------------------------------------- training, PPE
  @Get('trainings')
  @RequirePermission('qhse.view', 'project')
  trainings(@Ctx() ctx: ModuleRequestContext) {
    return Training.list(ctx);
  }

  @Post('trainings')
  @RequirePermission('qhse.manage', 'project')
  createTraining(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Training.create(ctx, parse(trainingInput, b));
  }

  @Get('ppe')
  @RequirePermission('qhse.view', 'project')
  ppe(@Ctx() ctx: ModuleRequestContext) {
    return Ppe.list(ctx, todayIso());
  }

  @Post('ppe')
  @RequirePermission('qhse.manage', 'project')
  issuePpe(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    return Ppe.issue(ctx, parse(ppeInput, b));
  }

  // ---------------------------------------------------------------- report, settings
  @Get('report')
  @RequirePermission('qhse.view', 'project')
  report2(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return statusReport(ctx, parse(reportQuery, q), todayIso());
  }

  @Get('settings')
  @RequirePermission('qhse.admin', 'company')
  settings(@Ctx() ctx: ModuleRequestContext) {
    return Settings.get(ctx);
  }

  @Put('settings')
  @HttpCode(200)
  @RequirePermission('qhse.admin', 'company')
  async saveSettings(@Ctx() ctx: ModuleRequestContext, @Body() b: unknown) {
    await Settings.save(ctx, parse(settingsInput, b));
    return ok;
  }
}
