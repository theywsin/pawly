import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

export const notFound = (what = 'قرارداد') => new NotFoundException({ code: 'NOT_FOUND', message: `${what} یافت نشد` });
export const conflict = (code: string, message: string) => new ConflictException({ code, message });
export const invalid = (code: string, message: string) => new BadRequestException({ code, message });
export const forbidden = (message: string) => new ForbiddenException({ code: 'FORBIDDEN', message });

/** Parses input with a zod schema; failures become 400 VALIDATION_FAILED with Persian per-field messages. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'اطلاعات وارد‌شده معتبر نیست',
      details: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}
