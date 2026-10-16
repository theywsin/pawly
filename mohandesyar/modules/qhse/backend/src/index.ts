import { defineModule } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import manifest from '../../module.manifest.json' with { type: 'json' };
import { QhseController } from './controller.js';
import { kpi, remindOverdue, search, statusWidget } from './logic.js';

import { incidentsReport } from './reports.js';

export default defineModule({
  manifest,
  controllers: [QhseController],
  schedules: { 'overdue-actions': { everyMinutes: 720, run: async (ctx) => void (await remindOverdue(ctx, todayIso())) } },
  widgetData: { 'qhse.status': (ctx) => statusWidget(ctx, todayIso()) },
  kpiProviders: {
    'qhse.incidents': (ctx, p) => kpi.count(false)(ctx, p),
    'qhse.near_misses': (ctx, p) => kpi.count(true)(ctx, p),
    'qhse.ltifr': (ctx, p) => kpi.ltifr(ctx, p),
    'qhse.overdue_actions': (ctx, p) => kpi.overdue(ctx, p),
    'qhse.inspection_score': (ctx, p) => kpi.inspectionScore(ctx, p),
  },
  searchProviders: { 'qhse.incidents': (ctx, q, limit) => search(ctx, q, limit) },
  reports: { 'qhse.incidents_report': (ctx, p) => incidentsReport(ctx, p) },
});
