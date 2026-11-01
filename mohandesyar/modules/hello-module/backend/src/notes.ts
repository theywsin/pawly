import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, gte, ilike, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Db, ModuleEventContext, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { notes } from './schema.js';

export const createNoteInput = z.object({
  title: z.string().trim().min(1, 'عنوان الزامی است').max(200, 'عنوان حداکثر ۲۰۰ نویسه است'),
  body: z.string().max(10_000).default(''),
});

/** Business logic, independent from HTTP so it can be unit-tested and reused by providers. */
export const NotesLogic = {
  async list(ctx: ModuleRequestContext) {
    const ownOnly = !ctx.can('hello-module.note.view', 'company');
    return ctx.db.transaction((tx) =>
      tx
        .select()
        .from(notes)
        .where(and(isNull(notes.deletedAt), ownOnly ? eq(notes.createdBy, ctx.userId) : undefined))
        .orderBy(desc(notes.createdAt))
        .limit(200),
    );
  },

  async create(ctx: ModuleRequestContext, input: z.infer<typeof createNoteInput>) {
    const settings = await ctx.settings<{ maxNoteLength: number }>();
    if (input.body.length > settings.maxNoteLength) {
      return { error: `متن یادداشت حداکثر ${settings.maxNoteLength} نویسه است` } as const;
    }
    const id = randomUUID();
    await ctx.db.transaction(async (tx: Db) => {
      await tx.insert(notes).values({ id, tenantId: ctx.tenantId, companyId: ctx.companyId, title: input.title, body: input.body, createdBy: ctx.userId });
      await ctx.audit({ action: 'hello-module.note.created', entityType: 'note', entityId: id, after: { title: input.title } }, tx);
      await ctx.publish('hello-module.note.created', { noteId: id, title: input.title, createdBy: ctx.userId }, tx);
    });
    return { id } as const;
  },

  /** Soft delete; data stays recoverable. Returns false when the note is not visible to the caller. */
  async remove(ctx: ModuleRequestContext, id: string) {
    const ownOnly = !ctx.can('hello-module.note.delete', 'company');
    return ctx.db.transaction(async (tx: Db) => {
      const r = await tx
        .update(notes)
        .set({ deletedAt: new Date(), updatedBy: ctx.userId })
        .where(and(eq(notes.id, id), isNull(notes.deletedAt), ownOnly ? eq(notes.createdBy, ctx.userId) : undefined))
        .returning({ id: notes.id });
      if (r.length) await ctx.audit({ action: 'hello-module.note.deleted', entityType: 'note', entityId: id }, tx);
      return r.length > 0;
    });
  },

  async count(ctx: { db: ModuleEventContext['db'] }, range?: { from: string; to: string }) {
    const [row] = await ctx.db.transaction((tx) =>
      tx
        .select({ n: count() })
        .from(notes)
        .where(and(isNull(notes.deletedAt), range ? gte(notes.createdAt, new Date(range.from)) : undefined, range ? lt(notes.createdAt, new Date(range.to)) : undefined)),
    );
    return row?.n ?? 0;
  },

  async search(ctx: ModuleRequestContext, q: string, limit: number) {
    const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    const rows = await ctx.db.transaction((tx) =>
      tx.select({ id: notes.id, title: notes.title, body: notes.body }).from(notes).where(and(isNull(notes.deletedAt), ilike(notes.title, `%${escaped}%`))).limit(limit),
    );
    return rows.map((r) => ({ entityType: 'note', entityId: r.id, title: r.title, snippet: r.body.slice(0, 120), link: `/app/hello?note=${r.id}` }));
  },
};
