import { defineModule } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import manifest from '../../module.manifest.json' with { type: 'json' };
import { onFinancePayment, onProcurementInvoice } from './assets.js';
import { LedgerController, OperationsController } from './controller.js';
import { kpi, overviewWidget } from './widgets.js';
import { dueChequesWidget } from './treasury.js';

export default defineModule({
  manifest,
  controllers: [LedgerController, OperationsController],
  eventHandlers: {
    'procurement.invoice.approved': (e, ctx) => onProcurementInvoice(ctx, e.payload as Parameters<typeof onProcurementInvoice>[1]),
    'finance.payment.executed': (e, ctx) => onFinancePayment(ctx, e, e.payload as Parameters<typeof onFinancePayment>[2]),
  },
  widgetData: {
    'accounting.overview': (ctx) => overviewWidget(ctx, todayIso()),
    'accounting.cheques': (ctx) => dueChequesWidget(ctx, todayIso()),
  },
  kpiProviders: {
    'accounting.revenue': (ctx, p) => kpi(ctx, p, 'revenue'),
    'accounting.net_profit': (ctx, p) => kpi(ctx, p, 'profit'),
    'accounting.cash': (ctx, p) => kpi(ctx, p, 'cash'),
    'accounting.receivables': (ctx, p) => kpi(ctx, p, 'receivables'),
  },
});
