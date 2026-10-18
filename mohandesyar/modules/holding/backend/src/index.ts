import { defineModule } from '@mohandesyar/module-sdk/server';
import manifest from '../../module.manifest.json' with { type: 'json' };
import { HoldingController } from './controller.js';

export default defineModule({ manifest, controllers: [HoldingController] });
