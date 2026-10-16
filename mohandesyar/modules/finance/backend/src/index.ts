import { defineModule } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import manifest from '../../module.manifest.json' with { type: 'json' };
import { cashWidget, dueAlerts, dueWidget, kpi, onInvoiceApproved, onOrderApproved, paymentsWidget, publicService, search } from './cash.js';
import { FinanceController } from './controller.js';
import { onWorkflowCompleted } from './money.js';

import { importCounterparties } from './import.js';

import { transactionsReport } from './reports.js';

export default defineModule({
  manifest,
  controllers: [FinanceController],
  publicServices: { 'finance.ledger': (ctx) => publicService(ctx) },
  eventHandlers: {
    'core.workflow.completed': (e, ctx) => onWorkflowCompleted(ctx, e.payload as Parameters<typeof onWorkflowCompleted>[1]),
    'procurement.order.approved': (e, ctx) => onOrderApproved(ctx, e.payload as Parameters<typeof onOrderApproved>[1]),
    'procurement.invoice.approved': (e, ctx) => onInvoiceApproved(ctx, e.payload as Parameters<typeof onInvoiceApproved>[1]),
  },
  // Default payment approval: the finance manager; from 10 billion rial also the company manager. Editable
  // in Settings → Approval workflows (steps, roles, thresholds) together with each role's approval limit.
  seedTenant: async (ctx) => {
    await ctx.ensureWorkflow('finance.payment', {
      title: 'تأیید درخواست پرداخت',
      steps: [
        { key: 'finance', label: 'تأیید مدیر مالی', approverRole: 'finance_manager' },
        { key: 'board', label: 'تأیید مدیر شرکت', approverRole: 'company_admin', minAmount: 10_000_000_000 },
      ],
    });
  },
  schedules: { 'due-alerts': { everyMinutes: 720, run: async (ctx) => void (await dueAlerts(ctx, todayIso())) } },
  widgetData: {
    'finance.cash': (ctx) => cashWidget(ctx),
    'finance.due': (ctx) => dueWidget(ctx, todayIso()),
    'finance.payments': (ctx) => paymentsWidget(ctx),
  },
  kpiProviders: {
    'finance.cash_balance': (ctx, p) => kpi.cashBalance(ctx, p),
    'finance.income': (ctx, p) => kpi.flow('income')(ctx, p),
    'finance.expense': (ctx, p) => kpi.flow('expense')(ctx, p),
    'finance.overdue_receivables': (ctx, p) => kpi.overdueReceivables(ctx, p),
  },
  searchProviders: { 'finance.counterparties': (ctx, q, limit) => search(ctx, q, limit) },
  importers: { 'finance.counterparties': (ctx, rows, opts) => importCounterparties(ctx, rows, opts) },
  reports: { 'finance.transactions': (ctx, p) => transactionsReport(ctx, p) },
});
