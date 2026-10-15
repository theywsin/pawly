import { defineModule } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import manifest from '../../module.manifest.json' with { type: 'json' };
import { ProcurementController } from './controller.js';
import { kpi, onWorkflowCompleted, search, statusWidget } from './logic.js';

export default defineModule({
  manifest,
  controllers: [ProcurementController],
  eventHandlers: {
    'core.workflow.completed': (e, ctx) => onWorkflowCompleted(ctx, e.payload as Parameters<typeof onWorkflowCompleted>[1]),
  },
  // Defaults, editable in Settings → Approval workflows: requests by the procurement lead; orders by the
  // procurement lead and, from 5 billion rial, also the company manager.
  seedTenant: async (ctx) => {
    await ctx.ensureWorkflow('procurement.request', {
      title: 'تأیید درخواست خرید',
      steps: [{ key: 'procurement', label: 'تأیید مسئول تدارکات', approverRole: 'procurement_manager' }],
    });
    await ctx.ensureWorkflow('procurement.order', {
      title: 'تأیید سفارش خرید',
      steps: [
        { key: 'procurement', label: 'تأیید مسئول تدارکات', approverRole: 'procurement_manager' },
        { key: 'board', label: 'تأیید مدیر شرکت', approverRole: 'company_admin', minAmount: 5_000_000_000 },
      ],
    });
  },
  widgetData: { 'procurement.status': (ctx) => statusWidget(ctx, todayIso()) },
  kpiProviders: {
    'procurement.spend': (ctx, p) => kpi.spend(ctx, p),
    'procurement.late_orders': (ctx, p) => kpi.lateOrders(ctx, p),
    'procurement.on_time_rate': (ctx, p) => kpi.onTimeRate(ctx, p),
  },
  searchProviders: { 'procurement.suppliers': (ctx, q, limit) => search(ctx, q, limit) },
});
