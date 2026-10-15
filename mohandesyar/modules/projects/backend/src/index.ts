import { defineModule } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import manifest from '../../module.manifest.json' with { type: 'json' };
import { ProjectsController } from './controller.js';
import { activeCount, delayedCount, onWorkflowCompleted, openIssues, overview, publicService, search } from './logic.js';

import { importProjects } from './import.js';

export default defineModule({
  manifest,
  controllers: [ProjectsController],

  publicServices: {
    'projects.projects': (ctx) => publicService(ctx),
  },

  eventHandlers: {
    'core.workflow.completed': (event, ctx) => onWorkflowCompleted(ctx, event.payload as Parameters<typeof onWorkflowCompleted>[1]),
  },

  seedTenant: async (ctx) => {
    await ctx.ensureWorkflow('projects.change_request', { title: 'تأیید درخواست تغییر پروژه', steps: [{ key: 'review', label: 'تأیید درخواست تغییر', approverRole: 'company_admin' }] });
  },

  widgetData: {
    'projects.overview': (ctx) => overview(ctx, todayIso()),
    'projects.issues': (ctx) => openIssues(ctx),
  },

  kpiProviders: {
    'projects.active_count': (ctx, p) => activeCount(ctx, p),
    'projects.delayed_count': (ctx, p) => delayedCount(ctx, p, todayIso()),
  },

  searchProviders: {
    'projects.projects': (ctx, q, limit) => search(ctx, q, limit),
  },
  importers: { 'projects.projects': (ctx, rows, opts) => importProjects(ctx, rows, opts) },
});
