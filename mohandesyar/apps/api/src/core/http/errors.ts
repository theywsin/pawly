import { HttpException, HttpStatus } from '@nestjs/common';
import type { z } from 'zod';

/** API error with a stable machine code and a Persian message (docs/07 §7: user-facing messages are Persian). */
export class ApiError extends HttpException {
  constructor(status: HttpStatus, readonly code: string, message: string, readonly details?: unknown) {
    super({ code, message, details }, status);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new ApiError(HttpStatus.BAD_REQUEST, code, message, details);
export const unauthorized = (code = 'UNAUTHORIZED', message = 'نیاز به ورود دوباره است') => new ApiError(HttpStatus.UNAUTHORIZED, code, message);
export const forbidden = (code = 'FORBIDDEN', message = 'دسترسی به این بخش مجاز نیست') => new ApiError(HttpStatus.FORBIDDEN, code, message);
export const notFound = (message = 'مورد درخواستی یافت نشد') => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', message);
export const conflict = (code: string, message: string, details?: unknown) => new ApiError(HttpStatus.CONFLICT, code, message, details);
export const tooMany = () => new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', 'تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید');

/** Validates input with Zod and maps issues to a 400 with field paths. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw badRequest(
      'VALIDATION_FAILED',
      'اطلاعات ارسال‌شده معتبر نیست',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}
