import { defineModule } from '@mohandesyar/module-sdk/server';
import { todayIso } from '@mohandesyar/persian';
import manifest from '../../module.manifest.json' with { type: 'json' };
import { TaskboardController } from './controller.js';
import { generateDuties, kpi, overdueAlerts, teamWidget, todayWidget } from './logic.js';

export default defineModule({
  manifest,
  controllers: [TaskboardController],
  schedules: {
    duties: {
      everyMinutes: 30,
      run: async (ctx) => {
        await generateDuties(ctx, todayIso());
        await overdueAlerts(ctx);
      },
    },
  },
  widgetData: {
    'taskboard.today': (ctx) => todayWidget(ctx, todayIso()),
    'taskboard.team': (ctx) => teamWidget(ctx, todayIso()),
  },
  kpiProviders: {
    'taskboard.on_time_rate': (ctx, p) => kpi(ctx, p, 'onTimeRate', todayIso()),
    'taskboard.average_score': (ctx, p) => kpi(ctx, p, 'averageScore', todayIso()),
    'taskboard.attendance_rate': (ctx, p) => kpi(ctx, p, 'attendanceRate', todayIso()),
    'taskboard.performance': (ctx, p) => kpi(ctx, p, 'performance', todayIso()),
  },
});
