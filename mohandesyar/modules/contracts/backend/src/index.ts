import { defineModule } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import manifest from '../../module.manifest.json' with { type: 'json' };
import { ContractsController } from './controller.js';
import { Contracts, expiringSoon, expiryAlerts, onWorkflowCompleted, publicService, search, signedValue } from './logic.js';

export default defineModule({
  manifest,
  controllers: [ContractsController],

  publicServices: {
    'contracts.contracts': (ctx) => publicService(ctx),
  },

  eventHandlers: {
    'core.workflow.completed': (event, ctx) => onWorkflowCompleted(ctx, event.payload as Parameters<typeof onWorkflowCompleted>[1]),
  },

  // Default approval for progress statements: one step by the company manager. The organisation can
  // redefine it (more steps, amount thresholds, other roles) through the workflow definitions API.
  seedTenant: async (ctx) => {
    await ctx.ensureWorkflow('contracts.statement', { title: 'تأیید صورت‌وضعیت قرارداد', steps: [{ key: 'review', label: 'تأیید صورت‌وضعیت', approverRole: 'company_admin' }] });
  },

  schedules: {
    'expiry-alerts': { everyMinutes: 360, run: async (ctx) => void (await expiryAlerts(ctx, todayIso())) },
  },

  widgetData: {
    'contracts.summary': (ctx) => Contracts.summary(ctx),
    'contracts.expiring': (ctx) => expiringSoon(ctx, todayIso()),
  },

  kpiProviders: {
    'contracts.signed_value': (ctx, p) => signedValue(ctx, p),
  },

  searchProviders: {
    'contracts.contracts': (ctx, q, limit) => search(ctx, q, limit),
  },
});
