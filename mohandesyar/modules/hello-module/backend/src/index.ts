import { defineModule } from '@mohandesyar/module-sdk/server';
import manifest from '../../module.manifest.json' with { type: 'json' };
import { NotesController } from './notes.controller.js';
import { NotesLogic } from './notes.js';

/**
 * Backend entry of hello-module. The core imports this file from the module store, mounts the
 * controllers under /api/m/hello-module/v1, and wires the providers below into its infrastructure.
 */
export default defineModule({
  manifest,
  controllers: [NotesController],

  // Public API for other modules: ctx.services.get('hello-module.notes', '^1')
  publicServices: {
    'hello-module.notes': (ctx) => ({ count: () => NotesLogic.count(ctx) }),
  },

  // Consumes its own event to demonstrate the outbox → handler path: confirms creation to the author.
  eventHandlers: {
    'hello-module.note.created': async (event, ctx) => {
      const p = event.payload as { noteId: string; title: string; createdBy: string };
      await ctx.notify({ userIds: [p.createdBy], type: 'hello-module.note.created', title: `یادداشت «${p.title}» ثبت شد`, link: `/app/hello?note=${p.noteId}` });
    },
  },

  widgetData: {
    'hello-module.count': async (ctx) => ({ count: await NotesLogic.count(ctx) }),
  },

  kpiProviders: {
    'hello-module.notes_created': async (ctx, p) => NotesLogic.count(ctx, { from: p.from, to: p.to }),
  },

  searchProviders: {
    'hello-module.notes': (ctx, q, limit) => NotesLogic.search(ctx, q, limit),
  },
});
