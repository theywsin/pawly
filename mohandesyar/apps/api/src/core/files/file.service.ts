import type { Db } from '@mohandesyar/module-sdk/server';
import { createHash } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand, CreateBucketCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { sql } from 'drizzle-orm';
import type { Config } from '../../config.js';
import type { Database } from '../../infra/db.js';
import { uuidv7 } from '../../infra/ids.js';
import type { AuditService } from '../audit/audit.service.js';
import { badRequest, notFound } from '../http/errors.js';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const BLOCKED_EXT = /\.(exe|bat|cmd|com|scr|msi|ps1|vbs|js|jar|sh|html?|svg)$/i;

interface Scope {
  tenantId: string;
  companyId: string;
  companyIds: readonly string[];
  userId: string;
}

/**
 * S3-compatible file storage (docs/01 CORE-FILE). Objects are private; downloads go through a
 * short-lived presigned URL issued only after the row is visible under RLS for the caller.
 */
export class FileService {
  private readonly s3: S3Client;
  /** Signs download links for the address browsers reach (S3_PUBLIC_ENDPOINT); same as `s3` when unset. */
  private readonly presigner: S3Client;
  private readonly bucket: string;
  private bucketReady = false;

  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    config: Config,
  ) {
    this.bucket = config.S3_BUCKET;
    const client = (endpoint: string | undefined) =>
      new S3Client({
        endpoint,
        region: config.S3_REGION,
        forcePathStyle: config.S3_FORCE_PATH_STYLE,
        credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
      });
    this.s3 = client(config.S3_ENDPOINT);
    this.presigner = config.S3_PUBLIC_ENDPOINT ? client(config.S3_PUBLIC_ENDPOINT) : this.s3;
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
    this.bucketReady = true;
  }

  async upload(
    s: Scope,
    file: { name: string; mime: string; data: Buffer },
    meta: { confidentiality?: 'public' | 'internal' | 'confidential' | 'secret'; owner?: { module: string; entityType?: string; entityId?: string } } = {},
  ): Promise<{ id: string; size: number; sha256: string }> {
    if (file.data.length === 0) throw badRequest('EMPTY_FILE', 'فایل خالی است');
    if (file.data.length > MAX_FILE_BYTES) throw badRequest('FILE_TOO_LARGE', 'حجم فایل بیش از ۵۰ مگابایت است');
    if (BLOCKED_EXT.test(file.name)) throw badRequest('FILE_TYPE_BLOCKED', 'این نوع فایل مجاز نیست');
    await this.ensureBucket();
    const id = uuidv7();
    const sha256 = createHash('sha256').update(file.data).digest('hex');
    const key = `t/${s.tenantId}/${id}`;
    // Name and type are stored on the object too: some S3 implementations (e.g. SeaweedFS) ignore the
    // response-* overrides of signed links and serve the stored headers instead.
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: file.data, ContentType: file.mime || 'application/octet-stream', ContentDisposition: contentDisposition(file.name) }));
    await this.db.tx({ tenantId: s.tenantId, companyIds: s.companyIds, userId: s.userId }, async (tx) => {
      await tx.execute(sql`INSERT INTO core_files (id, tenant_id, company_id, object_key, name, mime, size, sha256, confidentiality, owner_module, owner_entity_type, owner_entity_id, uploaded_by)
        VALUES (${id}, ${s.tenantId}, ${s.companyId}, ${key}, ${file.name.slice(0, 255)}, ${file.mime.slice(0, 100)}, ${file.data.length}, ${sha256}, ${meta.confidentiality ?? 'internal'},
                ${meta.owner?.module ?? null}, ${meta.owner?.entityType ?? null}, ${meta.owner?.entityId ?? null}, ${s.userId})`);
      await this.audit.append({ tenantId: s.tenantId, actorType: 'user', actorId: s.userId, action: 'file.uploaded', entityType: 'file', entityId: id, after: { name: file.name, size: file.data.length } }, tx);
    });
    return { id, size: file.data.length, sha256 };
  }

  /**
   * Attaches a file the same user uploaded for `module` to one of the module's records. A file can be
   * claimed once; afterwards only the module decides who may download it.
   */
  async claim(s: Scope, module: string, id: string, entity: { type: string; id: string }, txIn?: Db): Promise<{ id: string; name: string; mime: string; size: number }> {
    const run = async (tx: Db) => {
      const r = await tx.execute(sql`UPDATE core_files SET owner_entity_type = ${entity.type}, owner_entity_id = ${entity.id}
        WHERE id = ${id} AND owner_module = ${module} AND owner_entity_id IS NULL AND uploaded_by = ${s.userId} AND deleted_at IS NULL
        RETURNING id, name, mime, size`);
      const row = r.rows[0] as { id: string; name: string; mime: string; size: number } | undefined;
      if (!row) throw notFound('فایل بارگذاری‌شده یافت نشد یا قبلاً پیوست شده است');
      return row;
    };
    return txIn ? run(txIn) : this.db.tx({ tenantId: s.tenantId, companyIds: s.companyIds, userId: s.userId }, run);
  }

  /** Returns a 5-minute presigned URL. Confidential files are audited on every download. */
  async downloadUrl(s: Scope, id: string, viaModule?: string): Promise<{ url: string; name: string }> {
    const row = await this.db.tx({ tenantId: s.tenantId, companyIds: s.companyIds }, async (tx) => {
      const r = await tx.execute(sql`SELECT object_key, name, mime, confidentiality, owner_module FROM core_files WHERE id = ${id} AND deleted_at IS NULL`);
      return r.rows[0] as { object_key: string; name: string; mime: string; confidentiality: string; owner_module: string | null } | undefined;
    });
    if (!row) throw notFound();
    // Files owned by a module (resumes, contracts…) are served only through that module's own permission checks.
    if (row.owner_module && row.owner_module !== viaModule) throw notFound();
    if (row.confidentiality === 'confidential' || row.confidentiality === 'secret') {
      await this.audit.append({ tenantId: s.tenantId, actorType: 'user', actorId: s.userId, action: 'file.downloaded', entityType: 'file', entityId: id });
    }
    const url = await getSignedUrl(
      this.presigner,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: row.object_key,
        ResponseContentDisposition: contentDisposition(row.name),
        ResponseContentType: row.mime,
      }),
      { expiresIn: 300 },
    );
    return { url, name: row.name };
  }

  /**
   * Permanently removes a module-owned file (retention purge, record deletion): the row is marked deleted
   * and the stored object is erased. Only the owning module can remove its files.
   */
  async remove(s: { tenantId: string; companyIds: readonly string[]; userId: string | null }, module: string, id: string): Promise<void> {
    const row = await this.db.tx({ tenantId: s.tenantId, companyIds: s.companyIds }, async (tx) => {
      const r = await tx.execute(sql`UPDATE core_files SET deleted_at = now() WHERE id = ${id} AND owner_module = ${module} AND deleted_at IS NULL RETURNING object_key`);
      const k = r.rows[0] as { object_key: string } | undefined;
      if (k) await this.audit.append({ tenantId: s.tenantId, actorType: s.userId ? 'user' : 'system', actorId: s.userId, moduleId: module, action: 'file.deleted', entityType: 'file', entityId: id }, tx);
      return k;
    });
    if (row) await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: row.object_key }));
  }

  async list(s: Scope, owner: { module: string; entityType: string; entityId: string }) {
    return this.db.tx({ tenantId: s.tenantId, companyIds: s.companyIds }, async (tx) => {
      const r = await tx.execute(sql`SELECT id, name, mime, size, confidentiality, uploaded_by, created_at FROM core_files
        WHERE owner_module = ${owner.module} AND owner_entity_type = ${owner.entityType} AND owner_entity_id = ${owner.entityId} AND deleted_at IS NULL ORDER BY created_at DESC`);
      return r.rows;
    });
  }

  // Raw object access for platform data (site images, ticket attachments) whose rows and access rules
  // live outside core_files. Callers authorise before reading.

  async putObject(key: string, data: Buffer, mime: string, name: string): Promise<void> {
    await this.ensureBucket();
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: mime, ContentDisposition: contentDisposition(name) }));
  }

  async getObject(key: string): Promise<Buffer> {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!r.Body) throw notFound();
    return Buffer.from(await r.Body.transformToByteArray());
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/**
 * RFC 6266 attachment header: an ASCII fallback (`filename=`) for old clients plus the exact UTF-8 name
 * (`filename*=`), which browsers prefer. The fallback keeps the extension so the file still opens.
 */
export function contentDisposition(name: string): string {
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(name)?.[0] ?? '';
  const ascii = name.replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '').replace(/\s+/g, ' ').trim();
  const fallback = ascii.replace(/\.[A-Za-z0-9]{1,8}$/, '').replace(/^[ .-]+|[ .-]+$/g, '') ? ascii : `download${ext}`;
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
