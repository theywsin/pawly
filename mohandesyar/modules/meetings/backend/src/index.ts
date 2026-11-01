import { defineModule } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import manifest from '../../module.manifest.json' with { type: 'json' };
import { MeetingsController } from './controller.js';
import { overdue, overdueCount, publicService, resolutionReminders, search, upcoming } from './logic.js';

export default defineModule({
  manifest,
  controllers: [MeetingsController],
  publicServices: { 'meetings.meetings': (ctx) => publicService(ctx) },
  schedules: { 'resolution-reminders': { everyMinutes: 360, run: async (ctx) => void (await resolutionReminders(ctx, todayIso())) } },
  widgetData: {
    'meetings.upcoming': (ctx) => upcoming(ctx),
    'meetings.overdue': (ctx) => overdue(ctx, todayIso()),
  },
  kpiProviders: { 'meetings.overdue_resolutions': (ctx, p) => overdueCount(ctx, p, todayIso()) },
  searchProviders: { 'meetings.meetings': (ctx, q, limit) => search(ctx, q, limit) },
});
