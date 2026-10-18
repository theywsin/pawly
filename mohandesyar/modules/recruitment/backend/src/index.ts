import { defineModule } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import manifest from '../../module.manifest.json' with { type: 'json' };
import { RecruitmentController } from './controller.js';
import { kpi, myInterviewsWidget, pipelineWidget, publicService, retentionPurge, search } from './logic.js';

export default defineModule({
  manifest,
  controllers: [RecruitmentController],
  publicServices: { 'recruitment.candidates': (ctx) => publicService(ctx) },
  schedules: { 'retention-purge': { everyMinutes: 720, run: async (ctx) => void (await retentionPurge(ctx, todayIso())) } },
  widgetData: {
    'recruitment.pipeline': (ctx) => pipelineWidget(ctx, todayIso()),
    'recruitment.my_interviews': (ctx) => myInterviewsWidget(ctx),
  },
  kpiProviders: {
    'recruitment.hires': (ctx, p) => kpi.hires(ctx, p),
    'recruitment.time_to_hire': (ctx, p) => kpi.timeToHire(ctx, p),
    'recruitment.open_jobs': (ctx, p) => kpi.openJobs(ctx, p),
  },
  searchProviders: { 'recruitment.candidates': (ctx, q, limit) => search(ctx, q, limit) },
});
