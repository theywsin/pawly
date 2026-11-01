import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ معتبر نیست');
const text = (max: number) => z.string().trim().max(max, `حداکثر ${max} نویسه`);
const optUuid = z.uuid().nullable().default(null);
const tags = z
  .array(z.string().trim().min(1).max(40, 'برچسب حداکثر ۴۰ نویسه'))
  .max(20, 'حداکثر ۲۰ برچسب')
  .default([])
  .transform((t) => [...new Set(t)]);
export const LINK_TYPES = ['project', 'contract', 'payment', 'user'] as const;
const link = z.object({ type: z.enum(LINK_TYPES), id: z.uuid() });

const meta = {
  code: z.string().trim().min(1, 'شماره سند الزامی است').max(60),
  title: z.string().trim().min(2, 'عنوان سند الزامی است').max(300),
  description: text(4000).default(''),
  folderId: optUuid,
  categoryId: optUuid,
  tags,
  confidentiality: z.enum(['internal', 'confidential', 'secret']).default('internal'),
  expiresOn: isoDate.nullable().default(null),
  remindDays: z.number().int().min(0).max(365).default(30),
};
export const documentInput = z.object({ ...meta, links: z.array(link).max(50).default([]), fileId: z.uuid('فایل سند را بارگذاری کنید'), note: text(1000).default('') });
export const documentUpdate = z.object(meta);
export const versionInput = z.object({ fileId: z.uuid('فایل را بارگذاری کنید'), note: text(1000).default('') });
export const linkInput = link.extend({ label: text(200).default('') });
export const accessInput = z.object({ users: z.array(z.object({ userId: z.uuid(), canEdit: z.boolean().default(false) })).max(200) });
export const documentQuery = z.object({
  q: text(200).optional(),
  folderId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  tag: text(40).optional(),
  status: z.enum(['draft', 'active', 'obsolete', 'disposed']).optional(),
  confidentiality: z.enum(['internal', 'confidential', 'secret']).optional(),
  expiring: z.enum(['1']).optional(),
  linkType: z.enum(LINK_TYPES).optional(),
  linkId: z.uuid().optional(),
});
export const folderInput = z.object({ name: z.string().trim().min(1, 'نام پوشه الزامی است').max(120), parentId: optUuid });
export const categoryInput = z.object({ name: z.string().trim().min(2, 'نام دسته الزامی است').max(120), requiresApproval: z.boolean().default(true), retentionPolicyId: optUuid, archived: z.boolean().default(false) });
export const policyInput = z.object({ name: z.string().trim().min(2, 'نام سیاست الزامی است').max(120), years: z.number().int().min(1, 'حداقل یک سال').max(100), archived: z.boolean().default(false) });
export const disposeInput = z.object({ reason: z.string().trim().min(5, 'دلیل امحا را بنویسید').max(1000) });
