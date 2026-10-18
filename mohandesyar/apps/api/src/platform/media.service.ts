import { sql } from 'drizzle-orm';
import type { Database } from '../infra/db.js';
import { uuidv7 } from '../infra/ids.js';
import type { AuditService } from '../core/audit/audit.service.js';
import type { FileService } from '../core/files/file.service.js';
import { badRequest, notFound } from '../core/http/errors.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Detects the image type from its first bytes; the declared type and extension are not trusted. */
export function sniffImage(data: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | null {
  if (data.length < 12) return null;
  if (data[0] === 0x89 && data.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (data.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  return null;
}

/**
 * Images uploaded by platform admins for the public site (blog covers and body images, client logos).
 * They are public by nature and served by the API with long-lived caching; ids are random UUIDs.
 */
export class MediaService {
  constructor(
    private readonly db: Database,
    private readonly files: FileService,
    private readonly audit: AuditService,
  ) {}

  async upload(file: { name: string; data: Buffer }, alt: string, adminId: string): Promise<{ id: string; url: string; mime: string }> {
    if (file.data.length > MAX_IMAGE_BYTES) throw badRequest('FILE_TOO_LARGE', 'حجم تصویر بیش از ۵ مگابایت است');
    const mime = sniffImage(file.data);
    if (!mime) throw badRequest('NOT_AN_IMAGE', 'فقط تصویر PNG، JPEG، WebP یا GIF مجاز است');
    const id = uuidv7();
    const key = `p/${id}`;
    await this.files.putObject(key, file.data, mime, file.name);
    await this.db.app.execute(sql`INSERT INTO platform_media (id, object_key, name, mime, size, alt, uploaded_by)
      VALUES (${id}, ${key}, ${file.name.slice(0, 255)}, ${mime}, ${file.data.length}, ${alt.slice(0, 300)}, ${adminId})`);
    await this.audit.append({ tenantId: null, actorType: 'admin', actorId: adminId, action: 'site.media_uploaded', entityType: 'media', entityId: id });
    return { id, url: mediaUrl(id), mime };
  }

  async read(id: string): Promise<{ data: Buffer; mime: string }> {
    const r = await this.db.app.execute(sql`SELECT object_key, mime FROM platform_media WHERE id = ${id}`);
    const row = r.rows[0] as { object_key: string; mime: string } | undefined;
    if (!row) throw notFound();
    return { data: await this.files.getObject(row.object_key), mime: row.mime };
  }

  async list(limit = 200) {
    const r = await this.db.app.execute(sql`SELECT id, name, mime, size, alt, created_at FROM platform_media ORDER BY created_at DESC LIMIT ${limit}`);
    return (r.rows as { id: string }[]).map((m) => ({ ...m, url: mediaUrl(m.id) }));
  }
}

export const mediaUrl = (id: string) => `/api/public/media/${id}`;
