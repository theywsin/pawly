import { defineModule } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import manifest from '../../module.manifest.json' with { type: 'json' };
import { HrController } from './controller.js';
import { contractAlerts, kpi, myLeaveWidget, onWorkflowCompleted, overviewWidget, publicService, search } from './logic.js';

export default defineModule({
  manifest,
  controllers: [HrController],
  publicServices: { 'hr.employees': (ctx) => publicService(ctx) },
  eventHandlers: {
    'core.workflow.completed': (event, ctx) => onWorkflowCompleted(ctx, event.payload as Parameters<typeof onWorkflowCompleted>[1]),
  },
  // Default leave approval: one step by the HR manager role. The organisation can redefine it
  // (more steps, other roles) through the workflow definitions API.
  seedTenant: async (ctx) => {
    await ctx.ensureWorkflow('hr.leave', { title: 'تأیید مرخصی', steps: [{ key: 'hr', label: 'تأیید منابع انسانی', approverRole: 'hr_manager' }] });
  },
  schedules: { 'contract-alerts': { everyMinutes: 720, run: async (ctx) => void (await contractAlerts(ctx, todayIso())) } },
  widgetData: {
    'hr.overview': async (ctx) => overviewWidget(ctx, todayIso(), (await ctx.settings<{ contractAlertDays: number }>()).contractAlertDays),
    'hr.my_leave': (ctx) => myLeaveWidget(ctx, todayIso()),
  },
  kpiProviders: {
    'hr.headcount': (ctx, p) => kpi.headcount(ctx, p),
    'hr.training_hours': (ctx, p) => kpi.trainingHours(ctx, p),
    'hr.leave_days': (ctx, p) => kpi.leaveDays(ctx, p),
  },
  searchProviders: { 'hr.employees': (ctx, q, limit) => search(ctx, q, limit) },
});
