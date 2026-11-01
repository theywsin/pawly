import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { Ctx, RequirePermission, type ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import { z } from 'zod';
import { parse } from './errors.js';
import {
  applyInput, candidateInput, candidateQuery, evaluationInput, fileInput, formInput, interviewInput, jobInput, mergeInput, moveInput, reportQuery, retentionInput, scoringInput, stageInput, statusInput,
} from './inputs.js';
import { Applications, Candidates, Duplicates, Forms, Interviews, Jobs, Stages, report } from './logic.js';

const uuid = (v: string) => parse(z.uuid({ message: 'شناسه نامعتبر است' }), v);
const ok = { ok: true };

/** Mounted at /api/m/recruitment/v1. */
@Controller()
export class RecruitmentController {
  // ---------------------------------------------------------------- candidates
  @Get('candidates')
  @RequirePermission('recruitment.candidate.view', 'company')
  candidates(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return Candidates.list(ctx, parse(candidateQuery, q), todayIso());
  }

  @Post('candidates')
  @RequirePermission('recruitment.candidate.manage', 'company')
  createCandidate(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Candidates.save(ctx, null, parse(candidateInput, body), todayIso());
  }

  @Get('candidates/:id')
  @RequirePermission('recruitment.candidate.view', 'company')
  candidate(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Candidates.get(ctx, uuid(id));
  }

  @Put('candidates/:id')
  @RequirePermission('recruitment.candidate.manage', 'company')
  updateCandidate(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Candidates.save(ctx, uuid(id), parse(candidateInput, body), todayIso());
  }

  @Put('candidates/:id/status')
  @RequirePermission('recruitment.candidate.manage', 'company')
  async status(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    await Candidates.setStatus(ctx, uuid(id), parse(statusInput, body).status);
    return ok;
  }

  @Put('candidates/:id/consent')
  @RequirePermission('recruitment.candidate.manage', 'company')
  consent(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Candidates.renewConsent(ctx, uuid(id), parse(retentionInput, body), todayIso());
  }

  /** Erasure on the candidate's request (personal data and files). */
  @Delete('candidates/:id')
  @RequirePermission('recruitment.candidate.manage', 'company')
  async erase(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    await Candidates.erase(ctx, uuid(id));
    return ok;
  }

  @Post('candidates/:id/files')
  @RequirePermission('recruitment.candidate.manage', 'company')
  attach(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Candidates.attachFile(ctx, uuid(id), parse(fileInput, body));
  }

  @Delete('candidates/:id/files/:fid')
  @RequirePermission('recruitment.candidate.manage', 'company')
  async removeFile(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('fid') fid: string) {
    await Candidates.removeFile(ctx, uuid(id), uuid(fid));
    return ok;
  }

  @Get('candidates/:id/files/:fid/url')
  @RequirePermission('recruitment.candidate.view', 'company')
  fileUrl(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('fid') fid: string) {
    return Candidates.fileUrl(ctx, uuid(id), uuid(fid));
  }

  // ---------------------------------------------------------------- duplicates
  @Get('duplicates')
  @RequirePermission('recruitment.candidate.manage', 'company')
  duplicates(@Ctx() ctx: ModuleRequestContext) {
    return Duplicates.list(ctx);
  }

  @Post('duplicates/:id/merge')
  @HttpCode(200)
  @RequirePermission('recruitment.candidate.manage', 'company')
  async merge(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    await Duplicates.merge(ctx, uuid(id), parse(mergeInput, body).keepId, todayIso());
    return ok;
  }

  @Post('duplicates/:id/dismiss')
  @HttpCode(200)
  @RequirePermission('recruitment.candidate.manage', 'company')
  async dismiss(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    await Duplicates.dismiss(ctx, uuid(id));
    return ok;
  }

  // ---------------------------------------------------------------- jobs, scoring, applications
  @Get('jobs')
  @RequirePermission('recruitment.application.manage', 'company')
  jobs(@Ctx() ctx: ModuleRequestContext) {
    return Jobs.list(ctx);
  }

  @Post('jobs')
  @RequirePermission('recruitment.job.manage', 'company')
  createJob(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Jobs.save(ctx, null, parse(jobInput, body), todayIso());
  }

  @Get('jobs/:id')
  @RequirePermission('recruitment.application.manage', 'company')
  job(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Jobs.get(ctx, uuid(id));
  }

  @Put('jobs/:id')
  @RequirePermission('recruitment.job.manage', 'company')
  updateJob(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Jobs.save(ctx, uuid(id), parse(jobInput, body), todayIso());
  }

  @Put('jobs/:id/scoring')
  @RequirePermission('recruitment.job.manage', 'company')
  scoring(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Jobs.saveScoring(ctx, uuid(id), parse(scoringInput, body), todayIso());
  }

  @Post('jobs/:id/applications')
  @RequirePermission('recruitment.application.manage', 'company')
  apply(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Jobs.apply(ctx, uuid(id), parse(applyInput, body), todayIso());
  }

  @Get('applications/:id')
  @RequirePermission('recruitment.application.manage', 'company')
  application(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Applications.get(ctx, uuid(id));
  }

  @Post('applications/:id/move')
  @HttpCode(200)
  @RequirePermission('recruitment.application.manage', 'company')
  move(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Applications.move(ctx, uuid(id), parse(moveInput, body), todayIso());
  }

  @Post('applications/:id/rescore')
  @HttpCode(200)
  @RequirePermission('recruitment.application.manage', 'company')
  async rescore(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    await Applications.rescore(ctx, uuid(id), todayIso());
    return ok;
  }

  @Post('applications/:id/interviews')
  @RequirePermission('recruitment.application.manage', 'company')
  schedule(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Applications.schedule(ctx, uuid(id), parse(interviewInput, body));
  }

  // ---------------------------------------------------------------- settings: stages & forms
  @Get('stages')
  @RequirePermission('recruitment.application.manage', 'company')
  stages(@Ctx() ctx: ModuleRequestContext) {
    return Stages.list(ctx);
  }

  @Put('stages')
  @RequirePermission('recruitment.job.manage', 'company')
  async saveStages(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    await Stages.save(ctx, parse(stageInput, body));
    return ok;
  }

  @Get('forms')
  @RequirePermission('recruitment.application.manage', 'company')
  forms(@Ctx() ctx: ModuleRequestContext) {
    return Forms.list(ctx);
  }

  @Post('forms')
  @RequirePermission('recruitment.job.manage', 'company')
  createForm(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    return Forms.save(ctx, null, parse(formInput, body));
  }

  @Put('forms/:id')
  @RequirePermission('recruitment.job.manage', 'company')
  updateForm(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    return Forms.save(ctx, uuid(id), parse(formInput, body));
  }

  // ---------------------------------------------------------------- interviews
  @Get('interviews/mine')
  @RequirePermission('recruitment.interview.evaluate', 'own')
  myInterviews(@Ctx() ctx: ModuleRequestContext) {
    return Interviews.mine(ctx);
  }

  @Get('interviews/:id')
  @RequirePermission('recruitment.interview.evaluate', 'own')
  interview(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    return Interviews.get(ctx, uuid(id));
  }

  @Put('interviews/:id/evaluation')
  @RequirePermission('recruitment.interview.evaluate', 'own')
  async evaluate(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Body() body: unknown) {
    await Interviews.evaluate(ctx, uuid(id), parse(evaluationInput, body));
    return ok;
  }

  @Get('interviews/:id/files/:fid/url')
  @RequirePermission('recruitment.interview.evaluate', 'own')
  interviewFile(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string, @Param('fid') fid: string) {
    return Interviews.fileUrl(ctx, uuid(id), uuid(fid));
  }

  @Post('interviews/:id/cancel')
  @HttpCode(200)
  @RequirePermission('recruitment.application.manage', 'company')
  async cancelInterview(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    await Interviews.cancel(ctx, uuid(id));
    return ok;
  }

  // ---------------------------------------------------------------- reports
  @Get('reports')
  @RequirePermission('recruitment.report.view', 'company')
  report(@Ctx() ctx: ModuleRequestContext, @Query() q: unknown) {
    return report(ctx, parse(reportQuery, q));
  }
}
