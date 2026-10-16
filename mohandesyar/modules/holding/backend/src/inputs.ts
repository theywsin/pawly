import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ معتبر نیست');
const providerKey = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z0-9_*-]+)+$/, 'شاخص معتبر نیست');

export const compareInput = z
  .object({
    providers: z.array(providerKey).min(1, 'دست‌کم یک شاخص انتخاب کنید').max(20),
    from: isoDate,
    to: isoDate,
    companyIds: z.array(z.uuid()).max(100).optional(),
  })
  .refine((v) => v.from <= v.to, { message: 'ابتدای بازه باید قبل از انتهای آن باشد', path: ['to'] });
export const trendInput = z.object({ provider: providerKey, to: isoDate, months: z.number().int().min(2).max(24).default(6), companyIds: z.array(z.uuid()).max(100).optional() });
export const viewInput = z.object({ name: z.string().trim().min(2, 'نام نما الزامی است').max(120), providers: z.array(providerKey).min(1, 'دست‌کم یک شاخص انتخاب کنید').max(20) });
