import { defineModule } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import manifest from '../../module.manifest.json' with { type: 'json' };
import { DocumentsController } from './controller.js';
import { expiringWidget, kpi, onWorkflowCompleted, reminders, search } from './logic.js';

export default defineModule({
  manifest,
  controllers: [DocumentsController],
  eventHandlers: {
    'core.workflow.completed': (e, ctx) => onWorkflowCompleted(ctx, e.payload as Parameters<typeof onWorkflowCompleted>[1], todayIso()),
  },
  // Default: each new version is approved by a document controller other than its uploader (editable in
  // Settings → Approval workflows); a category can waive approval.
  seedTenant: async (ctx) => {
    await ctx.ensureWorkflow('documents.version', {
      title: 'تأیید نسخه سند',
      steps: [{ key: 'control', label: 'تأیید کنترل‌کننده اسناد', approverRole: 'document_controller' }],
    });
  },
  schedules: { reminders: { everyMinutes: 720, run: async (ctx) => void (await reminders(ctx, todayIso())) } },
  widgetData: { 'documents.expiring': (ctx) => expiringWidget(ctx, todayIso()) },
  kpiProviders: {
    'documents.expired': (ctx, p) => kpi.expired(ctx, p),
    'documents.pending_approval': (ctx, p) => kpi.pending(ctx, p),
  },
  searchProviders: { 'documents.documents': (ctx, q, limit) => search(ctx, q, limit) },
});
