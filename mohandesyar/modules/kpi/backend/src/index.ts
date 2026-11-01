import { defineModule } from '@mohandesyar/module-sdk/server';
import manifest from '../../module.manifest.json' with { type: 'json' };
import { KpiController } from './controller.js';
import { statusWidget } from './logic.js';

export default defineModule({
  manifest,
  controllers: [KpiController],
  widgetData: { 'kpi.status': (ctx) => statusWidget(ctx) },
});
