import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { Ctx, RequirePermission, type ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { z } from 'zod';
import { createNoteInput, NotesLogic } from './notes.js';

/** Mounted by the core at /api/m/hello-module/v1/notes. Every route declares its permission. */
@Controller('notes')
export class NotesController {
  @Get()
  @RequirePermission('hello-module.note.view', 'own')
  list(@Ctx() ctx: ModuleRequestContext) {
    return NotesLogic.list(ctx);
  }

  @Get('greeting')
  @RequirePermission('hello-module.note.view', 'own')
  async greeting(@Ctx() ctx: ModuleRequestContext) {
    const s = await ctx.settings<{ greeting: string }>();
    return { greeting: s.greeting, financeActive: ctx.modules.isActive('finance') };
  }

  @Post()
  @RequirePermission('hello-module.note.create', 'own')
  async create(@Ctx() ctx: ModuleRequestContext, @Body() body: unknown) {
    const parsed = createNoteInput.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'اطلاعات یادداشت معتبر نیست', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const r = await NotesLogic.create(ctx, parsed.data);
    if ('error' in r) throw new BadRequestException({ code: 'NOTE_TOO_LONG', message: r.error });
    return r;
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermission('hello-module.note.delete', 'own')
  async remove(@Ctx() ctx: ModuleRequestContext, @Param('id') id: string) {
    if (!z.uuid().safeParse(id).success || !(await NotesLogic.remove(ctx, id))) throw new NotFoundException({ code: 'NOT_FOUND', message: 'یادداشت یافت نشد' });
    return { ok: true };
  }
}
