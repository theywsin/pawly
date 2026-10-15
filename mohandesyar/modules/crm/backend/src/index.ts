import { defineModule } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import manifest from '../../module.manifest.json' with { type: 'json' };
import { CrmController } from './controller.js';
import { followupReminders, followups, newLeads, pipelineWidget, publicService, searchAccounts, searchOpportunities, wonValue } from './logic.js';

export default defineModule({
  manifest,
  controllers: [CrmController],
  publicServices: {
    'crm.accounts': (ctx) => publicService(ctx),
  },
  schedules: {
    'followup-reminders': { everyMinutes: 120, run: async (ctx) => void (await followupReminders(ctx, todayIso())) },
  },
  widgetData: {
    'crm.pipeline': (ctx) => pipelineWidget(ctx),
    'crm.followups': (ctx) => followups(ctx, todayIso()),
  },
  kpiProviders: {
    'crm.won_value': (ctx, p) => wonValue(ctx, p),
    'crm.new_leads': (ctx, p) => newLeads(ctx, p),
  },
  searchProviders: {
    'crm.accounts': (ctx, q, limit) => searchAccounts(ctx, q, limit),
    'crm.opportunities': (ctx, q, limit) => searchOpportunities(ctx, q, limit),
  },
});
