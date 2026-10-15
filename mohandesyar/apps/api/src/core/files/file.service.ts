import type { Db } from '@mohandesyar/module-sdk/server';
import { createHash } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { sql } from 'drizzle-orm';
import type { Config } from '../../config.js';
import type { Database } from '../../infra/db.js';
import { uuidv7 } from '../../infra/ids.js';
import type { AuditService } from '../audit/audit.service.js';
import { badRequest, notFound } from '../http/errors.js';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
const BLOCKED_EXT = /\.(exe|bat|cmd|com|scr|msi|ps1|vbs|js|jar|sh|html?|svg)$/i;

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
  private readonly bucket: string;
  private bucketReady = false;

  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
    config: Config,
  ) {
    this.bucket = config.S3_BUCKET;
    this.s3 = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
    });
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
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: file.data, ContentType: 'application/octet-stream' }));
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
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: row.object_key,
        ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
        ResponseContentType: row.mime,
      }),
      { expiresIn: 300 },
    );
    return { url, name: row.name };
  }

  async list(s: Scope, owner: { module: string; entityType: string; entityId: string }) {
    return this.db.tx({ tenantId: s.tenantId, companyIds: s.companyIds }, async (tx) => {
      const r = await tx.execute(sql`SELECT id, name, mime, size, confidentiality, uploaded_by, created_at FROM core_files
        WHERE owner_module = ${owner.module} AND owner_entity_type = ${owner.entityType} AND owner_entity_id = ${owner.entityId} AND deleted_at IS NULL ORDER BY created_at DESC`);
      return r.rows;
    });
  }
}
