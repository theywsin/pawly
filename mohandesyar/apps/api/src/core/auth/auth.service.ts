import { sql } from 'drizzle-orm';
import type { Database } from '../../infra/db.js';
import { uuidv7 } from '../../infra/ids.js';
import type { Redis } from '../../infra/redis.js';
import { rateLimit } from '../../infra/redis.js';
import type { AuditService } from '../audit/audit.service.js';
import { badRequest, forbidden, tooMany, unauthorized } from '../http/errors.js';
import {
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  hashPassword,
  otpauthUrl,
  passwordPolicyError,
  randomToken,
  tokenHash,
  verifyPassword,
  verifyTotp,
} from './crypto.js';
import type { Jwt} from './jwt.js';
import { type AccessClaims, type Audience } from './jwt.js';

export const REFRESH_TTL_DAYS = 14;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

type Subject = 'user' | 'admin';

interface SubjectRow {
  id: string;
  email: string;
  full_name: string;
  password_hash: string;
  totp_secret_enc: string | null;
  totp_enabled: boolean;
  status: string;
  failed_attempts: number;
  locked_until: string | null;
  roles?: string[];
}

export interface LoginResult {
  /** Set when a second factor is required before tokens are issued. */
  mfaRequired?: boolean;
  /** Console admins without TOTP must enrol before getting a session. */
  mfaEnrollmentRequired?: boolean;
  /** Short-lived token proving the password step (for /2fa and /2fa/enroll). */
  pendingToken?: string;
  accessToken?: string;
  refreshToken?: string;
  /** For app users with several tenants and no tenant chosen. */
  tenants?: { id: string; name: string }[];
}

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Authentication for company users (aud "app") and platform admins (aud "console"); the two never
 * share tokens. Refresh tokens are opaque, stored hashed, rotated on every use, and a reused (already
 * rotated) token revokes its whole family (docs/02 ADR-12).
 */
export class AuthService {
  private readonly dummyHash = hashPassword(randomToken());

  constructor(
    private readonly db: Database,
    private readonly redis: Redis,
    private readonly jwt: Jwt,
    private readonly audit: AuditService,
    private readonly encryptionKey: string,
  ) {}

  private table(subject: Subject) {
    return subject === 'user' ? sql.raw('core_users') : sql.raw('platform_admins');
  }

  private async loadByEmail(subject: Subject, email: string): Promise<SubjectRow | null> {
    const r = await this.db.app.execute(sql`SELECT * FROM ${this.table(subject)} WHERE lower(email) = lower(${email})`);
    return (r.rows[0] as unknown as SubjectRow | undefined) ?? null;
  }

  private async loadById(subject: Subject, id: string): Promise<SubjectRow | null> {
    const r = await this.db.app.execute(sql`SELECT * FROM ${this.table(subject)} WHERE id = ${id}`);
    return (r.rows[0] as unknown as SubjectRow | undefined) ?? null;
  }

  async userTenants(userId: string): Promise<{ id: string; name: string; status: string }[]> {
    const r = await this.db.app.execute(sql`SELECT tenant_id AS id, tenant_name AS name, tenant_status AS status FROM core_user_memberships(${userId})`);
    return r.rows as { id: string; name: string; status: string }[];
  }

  /** Password step. Returns tokens directly, or a pending token when a second factor is needed. */
  async login(subject: Subject, email: string, password: string, tenantId: string | undefined, meta: RequestMeta): Promise<LoginResult> {
    if (!(await rateLimit(this.redis, `login:${subject}:${meta.ip ?? '-'}`, 30, 300))) throw tooMany();
    if (!(await rateLimit(this.redis, `login:${subject}:${email.toLowerCase()}`, 10, 300))) throw tooMany();
    const row = await this.loadByEmail(subject, email);
    const invalid = unauthorized('INVALID_CREDENTIALS', 'ایمیل یا رمز عبور نادرست است');
    if (!row) {
      await verifyPassword(await this.dummyHash, password); // equalise timing with the existing-account path
      throw invalid;
    }
    if (row.status !== 'active') throw forbidden('ACCOUNT_DISABLED', 'حساب کاربری غیرفعال است');
    if (row.locked_until && new Date(row.locked_until) > new Date()) {
      throw forbidden('ACCOUNT_LOCKED', 'به‌دلیل تلاش‌های ناموفق، حساب موقتاً قفل شده است؛ ۱۵ دقیقه دیگر تلاش کنید');
    }
    if (!(await verifyPassword(row.password_hash, password))) {
      const failed = row.failed_attempts + 1;
      await this.db.app.execute(sql`UPDATE ${this.table(subject)} SET failed_attempts = ${failed},
        locked_until = ${failed >= MAX_FAILED ? sql`now() + make_interval(mins => ${LOCK_MINUTES})` : sql`locked_until`} WHERE id = ${row.id}`);
      if (failed >= MAX_FAILED) {
        await this.audit.append({ tenantId: null, actorType: subject, actorId: row.id, action: 'auth.locked', ip: meta.ip });
      }
      throw invalid;
    }
    await this.db.app.execute(sql`UPDATE ${this.table(subject)} SET failed_attempts = 0, locked_until = NULL WHERE id = ${row.id}`);

    let tid: string | undefined;
    if (subject === 'user') {
      const all = (await this.userTenants(row.id)).filter((t) => t.status !== 'closed');
      if (all.length === 0) throw forbidden('NO_TENANT', 'این حساب عضو هیچ سازمانی نیست');
      const tenants = all.filter((t) => t.status !== 'pending');
      if (tenants.length === 0 || (tenantId && all.some((t) => t.id === tenantId && t.status === 'pending'))) {
        throw forbidden('TENANT_PENDING', 'درخواست ثبت‌نام سازمان شما در انتظار تأیید مدیر سامانه است');
      }
      if (tenantId) {
        if (!tenants.some((t) => t.id === tenantId)) throw forbidden('NOT_A_MEMBER', 'شما عضو این سازمان نیستید');
        tid = tenantId;
      } else if (tenants.length === 1) {
        tid = tenants[0]!.id;
      } else {
        return { tenants: tenants.map(({ id, name }) => ({ id, name })) };
      }
    }

    if (subject === 'admin' && !row.totp_enabled) {
      return { mfaEnrollmentRequired: true, pendingToken: await this.pendingToken(subject, row.id, tid) };
    }
    if (row.totp_enabled) {
      return { mfaRequired: true, pendingToken: await this.pendingToken(subject, row.id, tid) };
    }
    return this.issue(subject, row.id, tid, ['pwd'], meta);
  }

  private async pendingToken(subject: Subject, id: string, tid?: string): Promise<string> {
    const token = randomToken();
    await this.redis.set(`mfa:${tokenHash(token)}`, JSON.stringify({ subject, id, tid }), 'EX', 300);
    return token;
  }

  private async consumePending(subject: Subject, token: string, peek = false): Promise<{ id: string; tid?: string }> {
    const key = `mfa:${tokenHash(token)}`;
    const raw = peek ? await this.redis.get(key) : await this.redis.getdel(key);
    if (!raw) throw unauthorized('MFA_EXPIRED', 'مهلت تأیید دومرحله‌ای تمام شده است؛ دوباره وارد شوید');
    const v = JSON.parse(raw) as { subject: Subject; id: string; tid?: string };
    if (v.subject !== subject) throw unauthorized();
    return v;
  }

  async verifySecondFactor(subject: Subject, pendingToken: string, code: string, meta: RequestMeta): Promise<LoginResult> {
    if (!(await rateLimit(this.redis, `mfa:${tokenHash(pendingToken)}`, 5, 300))) throw tooMany();
    const p = await this.consumePending(subject, pendingToken, true);
    const row = await this.loadById(subject, p.id);
    if (!row?.totp_secret_enc || !verifyTotp(decryptSecret(row.totp_secret_enc, this.encryptionKey), code)) {
      throw unauthorized('INVALID_OTP', 'کد تأیید نادرست است');
    }
    await this.consumePending(subject, pendingToken);
    return this.issue(subject, p.id, p.tid, ['pwd', 'otp'], meta);
  }

  /** Starts TOTP enrolment either from a pending login (admins) or for a signed-in user. Returns the otpauth URL. */
  async beginTotpEnrollment(subject: Subject, ref: { pendingToken?: string; subjectId?: string }): Promise<{ secret: string; otpauthUrl: string }> {
    const id = ref.subjectId ?? (await this.consumePending(subject, ref.pendingToken ?? '', true)).id;
    const row = await this.loadById(subject, id);
    if (!row) throw unauthorized();
    if (row.totp_enabled) throw badRequest('MFA_ALREADY_ENABLED', 'تأیید دومرحله‌ای قبلاً فعال شده است');
    const secret = generateTotpSecret();
    await this.redis.set(`totp-enrol:${subject}:${id}`, secret, 'EX', 600);
    return { secret, otpauthUrl: otpauthUrl(secret, row.email, 'Mohandix') };
  }

  async confirmTotpEnrollment(subject: Subject, ref: { pendingToken?: string; subjectId?: string }, code: string, meta: RequestMeta): Promise<LoginResult | { enabled: true }> {
    const pending = ref.pendingToken ? await this.consumePending(subject, ref.pendingToken, true) : undefined;
    const id = ref.subjectId ?? pending!.id;
    const secret = await this.redis.get(`totp-enrol:${subject}:${id}`);
    if (!secret || !verifyTotp(secret, code)) throw unauthorized('INVALID_OTP', 'کد تأیید نادرست است');
    await this.db.app.execute(sql`UPDATE ${this.table(subject)} SET totp_secret_enc = ${encryptSecret(secret, this.encryptionKey)}, totp_enabled = true WHERE id = ${id}`);
    await this.redis.del(`totp-enrol:${subject}:${id}`);
    await this.audit.append({ tenantId: pending?.tid ?? null, actorType: subject, actorId: id, action: 'auth.mfa_enabled', ip: meta.ip });
    if (ref.pendingToken) {
      await this.consumePending(subject, ref.pendingToken);
      return this.issue(subject, id, pending!.tid, ['pwd', 'otp'], meta);
    }
    return { enabled: true };
  }

  /** Verifies a TOTP code for a signed-in subject (used for "fresh 2FA" on sensitive operations). */
  async checkTotp(subject: Subject, id: string, code: string): Promise<boolean> {
    if (!(await rateLimit(this.redis, `otpcheck:${subject}:${id}`, 10, 300))) throw tooMany();
    const row = await this.loadById(subject, id);
    return !!row?.totp_secret_enc && verifyTotp(decryptSecret(row.totp_secret_enc, this.encryptionKey), code);
  }

  private async issue(subject: Subject, id: string, tid: string | undefined, amr: string[], meta: RequestMeta, familyId = uuidv7()): Promise<LoginResult> {
    const sid = uuidv7();
    const refresh = randomToken();
    await this.db.app.execute(sql`INSERT INTO core_sessions (id, subject_type, subject_id, tenant_id, family_id, refresh_hash, ip, user_agent, expires_at)
      VALUES (${sid}, ${subject}, ${id}, ${tid ?? null}, ${familyId}, ${tokenHash(refresh)}, ${meta.ip ?? null}, ${meta.userAgent?.slice(0, 300) ?? null},
              now() + make_interval(days => ${REFRESH_TTL_DAYS}))`);
    const aud: Audience = subject === 'user' ? 'app' : 'console';
    const claims: AccessClaims = { sub: id, sid, aud, amr, ...(tid ? { tid } : {}), ...(amr.includes('otp') ? { otp_at: Math.floor(Date.now() / 1000) } : {}) };
    return { accessToken: await this.jwt.sign(claims), refreshToken: refresh };
  }

  async refresh(subject: Subject, refreshToken: string, meta: RequestMeta): Promise<LoginResult> {
    const h = tokenHash(refreshToken);
    type SessionRow = { id: string; subject_id: string; tenant_id: string | null; family_id: string; expires_at: string; rotated_at: string | null; revoked_at: string | null };
    const outcome = await this.db.app.transaction(async (tx) => {
      const r = await tx.execute(sql`SELECT * FROM core_sessions WHERE refresh_hash = ${h} AND subject_type = ${subject} FOR UPDATE`);
      const s = r.rows[0] as SessionRow | undefined;
      if (!s) return { kind: 'invalid' as const };
      if (s.rotated_at || s.revoked_at) return { kind: 'reused' as const, session: s };
      if (new Date(s.expires_at) < new Date()) return { kind: 'invalid' as const };
      const subj = await this.loadById(subject, s.subject_id);
      if (!subj || subj.status !== 'active') return { kind: 'invalid' as const };
      await tx.execute(sql`UPDATE core_sessions SET rotated_at = now(), last_used_at = now() WHERE id = ${s.id}`);
      const amr = subj.totp_enabled ? ['pwd', 'otp'] : ['pwd'];
      const sid = uuidv7();
      const refresh = randomToken();
      await tx.execute(sql`INSERT INTO core_sessions (id, subject_type, subject_id, tenant_id, family_id, refresh_hash, ip, user_agent, expires_at)
        VALUES (${sid}, ${subject}, ${s.subject_id}, ${s.tenant_id}, ${s.family_id}, ${tokenHash(refresh)}, ${meta.ip ?? null}, ${meta.userAgent?.slice(0, 300) ?? null},
                now() + make_interval(days => ${REFRESH_TTL_DAYS}))`);
      const aud: Audience = subject === 'user' ? 'app' : 'console';
      const access = await this.jwt.sign({ sub: s.subject_id, sid, aud, amr, ...(s.tenant_id ? { tid: s.tenant_id } : {}) });
      return { kind: 'ok' as const, result: { accessToken: access, refreshToken: refresh } };
    });
    if (outcome.kind === 'ok') return outcome.result;
    if (outcome.kind === 'reused') {
      // Reuse of a rotated token: assume theft and revoke the whole family (outside the read transaction).
      const s = outcome.session;
      const revoked = await this.db.app.execute(sql`UPDATE core_sessions SET revoked_at = coalesce(revoked_at, now()), revoke_reason = coalesce(revoke_reason, 'refresh_reuse')
        WHERE family_id = ${s.family_id} RETURNING id`);
      for (const row of revoked.rows as { id: string }[]) await this.redis.del(`sess:${row.id}`);
      await this.audit.append({ tenantId: s.tenant_id, actorType: subject, actorId: s.subject_id, action: 'auth.refresh_reuse_detected', ip: meta.ip });
      throw unauthorized('SESSION_REVOKED', 'نشست شما باطل شده است؛ دوباره وارد شوید');
    }
    throw unauthorized('SESSION_INVALID');
  }

  /** Session validity for access tokens: a revoked family invalidates outstanding access tokens immediately. */
  async isSessionActive(sid: string): Promise<boolean> {
    const cached = await this.redis.get(`sess:${sid}`);
    if (cached) return cached === '1';
    const r = await this.db.app.execute(sql`SELECT 1 FROM core_sessions s WHERE s.id = ${sid} AND s.revoked_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM core_sessions f WHERE f.family_id = s.family_id AND f.revoked_at IS NOT NULL)`);
    const ok = r.rows.length > 0;
    await this.redis.set(`sess:${sid}`, ok ? '1' : '0', 'EX', 30);
    return ok;
  }

  async logout(subject: Subject, refreshToken: string | undefined, sid: string | undefined): Promise<void> {
    if (refreshToken) {
      await this.db.app.execute(sql`UPDATE core_sessions SET revoked_at = now(), revoke_reason = 'logout'
        WHERE family_id = (SELECT family_id FROM core_sessions WHERE refresh_hash = ${tokenHash(refreshToken)} AND subject_type = ${subject})`);
    }
    if (sid) {
      await this.db.app.execute(sql`UPDATE core_sessions SET revoked_at = now(), revoke_reason = 'logout'
        WHERE family_id = (SELECT family_id FROM core_sessions WHERE id = ${sid})`);
      await this.redis.del(`sess:${sid}`);
    }
  }

  async logoutAll(subject: Subject, subjectId: string, meta: RequestMeta): Promise<number> {
    const r = await this.db.app.execute(sql`UPDATE core_sessions SET revoked_at = now(), revoke_reason = 'logout_all'
      WHERE subject_type = ${subject} AND subject_id = ${subjectId} AND revoked_at IS NULL RETURNING id`);
    for (const row of r.rows as { id: string }[]) await this.redis.del(`sess:${row.id}`);
    await this.audit.append({ tenantId: null, actorType: subject, actorId: subjectId, action: 'auth.logout_all', ip: meta.ip });
    return r.rows.length;
  }

  async listSessions(subject: Subject, subjectId: string) {
    const r = await this.db.app.execute(sql`SELECT id, ip, user_agent, created_at, last_used_at, expires_at FROM core_sessions
      WHERE subject_type = ${subject} AND subject_id = ${subjectId} AND revoked_at IS NULL AND rotated_at IS NULL AND expires_at > now()
      ORDER BY last_used_at DESC`);
    return r.rows;
  }

  async changePassword(subject: Subject, id: string, current: string, next: string, meta: RequestMeta): Promise<void> {
    const row = await this.loadById(subject, id);
    if (!row || !(await verifyPassword(row.password_hash, current))) throw unauthorized('INVALID_CREDENTIALS', 'رمز فعلی نادرست است');
    const policy = passwordPolicyError(next);
    if (policy) throw badRequest('WEAK_PASSWORD', policy);
    await this.db.app.execute(sql`UPDATE ${this.table(subject)} SET password_hash = ${await hashPassword(next)} WHERE id = ${id}`);
    await this.logoutAll(subject, id, meta);
  }

  async createAdmin(input: { email: string; fullName: string; password: string; roles: string[] }): Promise<string> {
    const policy = passwordPolicyError(input.password);
    if (policy) throw badRequest('WEAK_PASSWORD', policy);
    const id = uuidv7();
    await this.db.app.execute(sql`INSERT INTO platform_admins (id, email, full_name, password_hash, roles)
      VALUES (${id}, ${input.email}, ${input.fullName}, ${await hashPassword(input.password)}, ${`{${input.roles.join(',')}}`}::text[])`);
    await this.audit.append({ tenantId: null, actorType: 'system', actorId: null, action: 'platform.admin_created', entityType: 'platform_admin', entityId: id, after: { email: input.email, roles: input.roles } });
    return id;
  }

  async adminProfile(id: string): Promise<{ id: string; email: string; fullName: string; roles: string[] } | null> {
    const row = await this.loadById('admin', id);
    return row && row.status === 'active' ? { id: row.id, email: row.email, fullName: row.full_name, roles: row.roles ?? [] } : null;
  }

  async userProfile(id: string): Promise<{ id: string; email: string; fullName: string; totpEnabled: boolean; emailNotifications: boolean } | null> {
    const row = await this.loadById('user', id);
    return row ? { id: row.id, email: row.email, fullName: row.full_name, totpEnabled: row.totp_enabled, emailNotifications: (row as { email_notifications?: boolean }).email_notifications !== false } : null;
  }
}
