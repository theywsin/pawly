import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../infra/db.js';
import { uuidv7 } from '../infra/ids.js';
import type { AuditService } from '../core/audit/audit.service.js';
import { badRequest, conflict, notFound } from '../core/http/errors.js';

/** Persian or Latin words joined by single hyphens (Persian slugs are common for Persian search). */
export const SLUG = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;
const slug = (max: number) => z.string().trim().toLowerCase().min(2, 'نامک کوتاه است').max(max).regex(SLUG, 'نامک فقط حرف، عدد و خط تیره (بدون فاصله) است');

const text = (max: number) => z.string().trim().min(1, 'متن خالی است').max(max);
export const blockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('p'), text: text(10_000) }),
  z.object({ type: z.literal('h2'), text: text(200) }),
  z.object({ type: z.literal('h3'), text: text(200) }),
  z.object({ type: z.literal('quote'), text: text(2_000) }),
  z.object({ type: z.enum(['ul', 'ol']), items: z.array(text(1_000)).min(1).max(100) }),
  z.object({ type: z.literal('img'), mediaId: z.uuid(), caption: z.string().trim().max(300).default(''), alt: z.string().trim().max(300).default('') }),
]);
export type Block = z.infer<typeof blockSchema>;

export const postSchema = z.object({
  slug: slug(120),
  title: z.string().trim().min(3, 'عنوان کوتاه است').max(200),
  excerpt: z.string().trim().max(500).default(''),
  coverId: z.uuid().nullable().default(null),
  categoryId: z.uuid().nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  body: z.array(blockSchema).max(500).default([]),
  status: z.enum(['draft', 'published']).default('draft'),
  /** ISO time; required when published (a future time schedules the post). */
  publishedAt: z.iso.datetime({ offset: true }).nullable().default(null),
  authorName: z.string().trim().max(120).default(''),
  seoTitle: z.string().trim().max(200).default(''),
  seoDescription: z.string().trim().max(300).default(''),
});
export type PostInput = z.infer<typeof postSchema>;

export const categorySchema = z.object({ slug: slug(80), name: z.string().trim().min(2, 'نام دسته کوتاه است').max(80), sort: z.number().int().default(0) });

const PAGE_SIZE = 12;
/** PostgreSQL array literal; each element is quoted (JSON string escaping matches the array syntax). */
const pgArray = (xs: readonly string[]) => `{${xs.map((x) => JSON.stringify(x)).join(',')}}`;
const pgCode = (err: unknown) => (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
const media = (id: string | null) => (id ? `/api/public/media/${id}` : null);

interface PostRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  cover_id: string | null;
  category_id: string | null;
  category_slug?: string | null;
  category_name?: string | null;
  tags: string[];
  body: Block[];
  status: string;
  published_at: string | null;
  updated_at: string;
  author_name: string;
  seo_title: string;
  seo_description: string;
}

function publicPost(r: PostRow, withBody: boolean) {
  return {
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    cover: media(r.cover_id),
    category: r.category_slug ? { slug: r.category_slug, name: r.category_name } : null,
    tags: r.tags,
    publishedAt: r.published_at,
    updatedAt: r.updated_at,
    authorName: r.author_name,
    ...(withBody
      ? {
          seoTitle: r.seo_title,
          seoDescription: r.seo_description,
          body: r.body.map((b) => (b.type === 'img' ? { ...b, src: media(b.mediaId) } : b)),
        }
      : {}),
  };
}

/** Plain text of a post, for the meta description fallback and structured data. */
export function plainText(body: Block[]): string {
  return body
    .flatMap((b) => ('items' in b ? b.items : b.type === 'img' ? [b.caption] : [b.text]))
    .join('\n')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1');
}

const PUBLIC = sql`p.status = 'published' AND p.published_at <= now()`;

export class BlogService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ public

  async list(q: { page?: number; category?: string; tag?: string }) {
    const page = Math.max(1, Math.min(500, q.page ?? 1));
    const where = sql`${PUBLIC} ${q.category ? sql`AND c.slug = ${q.category}` : sql``} ${q.tag ? sql`AND ${q.tag} = ANY (p.tags)` : sql``}`;
    const [rows, count, categories] = await Promise.all([
      this.db.app.execute(sql`SELECT p.*, c.slug AS category_slug, c.name AS category_name FROM platform_blog_posts p
        LEFT JOIN platform_blog_categories c ON c.id = p.category_id WHERE ${where}
        ORDER BY p.published_at DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`),
      this.db.app.execute(sql`SELECT count(*)::int AS n FROM platform_blog_posts p LEFT JOIN platform_blog_categories c ON c.id = p.category_id WHERE ${where}`),
      this.publicCategories(),
    ]);
    const total = (count.rows[0] as { n: number }).n;
    return { posts: (rows.rows as unknown as PostRow[]).map((r) => publicPost(r, false)), page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total, categories };
  }

  async publicCategories() {
    const r = await this.db.app.execute(sql`SELECT c.slug, c.name, count(p.id)::int AS posts FROM platform_blog_categories c
      JOIN platform_blog_posts p ON p.category_id = c.id AND ${PUBLIC} GROUP BY c.id ORDER BY c.sort, c.name`);
    return r.rows;
  }

  async post(slugValue: string) {
    const r = await this.db.app.execute(sql`SELECT p.*, c.slug AS category_slug, c.name AS category_name FROM platform_blog_posts p
      LEFT JOIN platform_blog_categories c ON c.id = p.category_id WHERE p.slug = ${slugValue.toLowerCase()} AND ${PUBLIC}`);
    const row = r.rows[0] as unknown as PostRow | undefined;
    if (!row) throw notFound('این مطلب یافت نشد');
    const related = await this.db.app.execute(sql`SELECT p.*, NULL AS category_slug FROM platform_blog_posts p
      WHERE ${PUBLIC} AND p.id <> ${row.id} AND (p.category_id = ${row.category_id} OR p.tags && ${pgArray(row.tags)}::text[])
      ORDER BY p.published_at DESC LIMIT 3`);
    return { ...publicPost(row, true), related: (related.rows as unknown as PostRow[]).map((x) => publicPost(x, false)) };
  }

  /** Data the server needs to write a post's meta tags; null when the post is not public. */
  async seo(slugValue: string): Promise<{ title: string; description: string; image: string | null; publishedAt: string; updatedAt: string; author: string; text: string } | null> {
    const r = await this.db.app.execute(sql`SELECT p.* FROM platform_blog_posts p WHERE p.slug = ${slugValue.toLowerCase()} AND ${PUBLIC}`);
    const row = r.rows[0] as unknown as PostRow | undefined;
    if (!row) return null;
    const body = plainText(row.body);
    return {
      title: row.seo_title || row.title,
      description: (row.seo_description || row.excerpt || body).replace(/\s+/g, ' ').slice(0, 300),
      image: media(row.cover_id),
      publishedAt: row.published_at!,
      updatedAt: row.updated_at,
      author: row.author_name,
      text: body,
    };
  }

  async sitemap(): Promise<{ slug: string; updatedAt: string }[]> {
    const r = await this.db.app.execute(sql`SELECT slug, updated_at FROM platform_blog_posts p WHERE ${PUBLIC} ORDER BY published_at DESC LIMIT 5000`);
    return (r.rows as { slug: string; updated_at: string }[]).map((x) => ({ slug: x.slug, updatedAt: x.updated_at }));
  }

  // ------------------------------------------------------------------ console

  async adminList() {
    const r = await this.db.app.execute(sql`SELECT p.id, p.slug, p.title, p.status, p.published_at, p.updated_at, c.name AS category_name,
        (p.status = 'published' AND p.published_at > now()) AS scheduled
      FROM platform_blog_posts p LEFT JOIN platform_blog_categories c ON c.id = p.category_id ORDER BY p.updated_at DESC`);
    return r.rows;
  }

  async adminGet(id: string) {
    const r = await this.db.app.execute(sql`SELECT * FROM platform_blog_posts WHERE id = ${id}`);
    const row = r.rows[0] as unknown as (PostRow & { cover_id: string | null }) | undefined;
    if (!row) throw notFound();
    return { ...row, cover: media(row.cover_id), body: row.body.map((b) => (b.type === 'img' ? { ...b, src: media(b.mediaId) } : b)) };
  }

  async save(id: string | null, input: PostInput, adminId: string): Promise<string> {
    if (input.status === 'published' && !input.publishedAt) input.publishedAt = new Date().toISOString();
    const mediaIds = [input.coverId, ...input.body.flatMap((b) => (b.type === 'img' ? [b.mediaId] : []))].filter((x): x is string => !!x);
    if (mediaIds.length) {
      const found = await this.db.app.execute(sql`SELECT count(DISTINCT id)::int AS n FROM platform_media WHERE id = ANY (${pgArray(mediaIds)}::uuid[])`);
      if ((found.rows[0] as { n: number }).n !== new Set(mediaIds).size) throw badRequest('MEDIA_NOT_FOUND', 'یکی از تصاویر یافت نشد؛ دوباره بارگذاری کنید');
    }
    const pid = id ?? uuidv7();
    try {
      const r = await this.db.app.execute(sql`INSERT INTO platform_blog_posts (id, slug, title, excerpt, cover_id, category_id, tags, body, status, published_at, author_name, seo_title, seo_description, created_by)
        VALUES (${pid}, ${input.slug}, ${input.title}, ${input.excerpt}, ${input.coverId}, ${input.categoryId}, ${pgArray(input.tags)}::text[], ${JSON.stringify(input.body)}::jsonb,
                ${input.status}, ${input.publishedAt}, ${input.authorName}, ${input.seoTitle}, ${input.seoDescription}, ${adminId})
        ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, title = EXCLUDED.title, excerpt = EXCLUDED.excerpt, cover_id = EXCLUDED.cover_id,
          category_id = EXCLUDED.category_id, tags = EXCLUDED.tags, body = EXCLUDED.body, status = EXCLUDED.status, published_at = EXCLUDED.published_at,
          author_name = EXCLUDED.author_name, seo_title = EXCLUDED.seo_title, seo_description = EXCLUDED.seo_description, updated_at = now()
        RETURNING id`);
      if (!r.rows.length) throw notFound();
    } catch (err) {
      if (pgCode(err) === '23505') throw conflict('SLUG_TAKEN', 'این نامک برای مطلب دیگری استفاده شده است');
      if (pgCode(err) === '23503') throw badRequest('VALIDATION_FAILED', 'دسته‌بندی یافت نشد', [{ path: 'categoryId', message: 'دسته‌بندی یافت نشد' }]);
      throw err;
    }
    await this.audit.append({ tenantId: null, actorType: 'admin', actorId: adminId, action: id ? 'blog.post_updated' : 'blog.post_created', entityType: 'blog_post', entityId: pid, after: { slug: input.slug, status: input.status } });
    return pid;
  }

  async remove(id: string, adminId: string) {
    await this.db.app.execute(sql`DELETE FROM platform_blog_posts WHERE id = ${id}`);
    await this.audit.append({ tenantId: null, actorType: 'admin', actorId: adminId, action: 'blog.post_deleted', entityType: 'blog_post', entityId: id });
  }

  async categories() {
    return (await this.db.app.execute(sql`SELECT c.*, (SELECT count(*)::int FROM platform_blog_posts p WHERE p.category_id = c.id) AS posts FROM platform_blog_categories c ORDER BY c.sort, c.name`)).rows;
  }

  async saveCategory(id: string | null, input: z.infer<typeof categorySchema>, adminId: string): Promise<string> {
    const cid = id ?? uuidv7();
    try {
      await this.db.app.execute(sql`INSERT INTO platform_blog_categories (id, slug, name, sort) VALUES (${cid}, ${input.slug}, ${input.name}, ${input.sort})
        ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, sort = EXCLUDED.sort`);
    } catch (err) {
      if (pgCode(err) === '23505') throw conflict('SLUG_TAKEN', 'این نامک برای دسته دیگری استفاده شده است');
      throw err;
    }
    await this.audit.append({ tenantId: null, actorType: 'admin', actorId: adminId, action: 'blog.category_saved', entityType: 'blog_category', entityId: cid });
    return cid;
  }

  async removeCategory(id: string, adminId: string) {
    await this.db.app.execute(sql`DELETE FROM platform_blog_categories WHERE id = ${id}`);
    await this.audit.append({ tenantId: null, actorType: 'admin', actorId: adminId, action: 'blog.category_deleted', entityType: 'blog_category', entityId: id });
  }
}
