import { sql } from 'drizzle-orm';
import type { Database, Db } from '../../infra/db.js';
import { uuidv7 } from '../../infra/ids.js';
import type { Redis } from '../../infra/redis.js';

export interface NotifyInput {
  tenantId: string;
  userIds: string[];
  type: string;
  title: string;
  body?: string;
  link?: string;
  moduleId?: string | null;
}

/** Outbound channel adapter (email/SMS). The default deployment has none configured: in-app only. */
export interface NotificationChannel {
  readonly name: 'email' | 'sms';
  send(to: { userId: string; email: string }, n: { title: string; body?: string; link?: string }): Promise<void>;
}

export const channelName = (tenantId: string, userId: string) => `notif:${tenantId}:${userId}`;

export class NotificationService {
  constructor(
    private readonly db: Database,
    private readonly redis: Redis,
    private readonly channels: NotificationChannel[] = [],
    /** When set, each notification is also queued as an email (same transaction) for users who did not opt out. */
    private readonly email: { origin: string } | null = null,
  ) {}

  /**
   * Stores in-app notifications (in `tx` when given, so they commit with the business change) and
   * pushes a real-time signal to connected SSE clients.
   */
  async notify(input: NotifyInput, tx?: Db): Promise<void> {
    if (input.userIds.length === 0) return;
    const ids: string[] = [];
    const write = async (t: Db) => {
      for (const userId of new Set(input.userIds)) {
        const id = uuidv7();
        ids.push(id);
        await t.execute(sql`INSERT INTO core_notifications (id, tenant_id, user_id, type, module_id, title, body, link)
          VALUES (${id}, ${input.tenantId}, ${userId}, ${input.type}, ${input.moduleId ?? null}, ${input.title}, ${input.body ?? null}, ${input.link ?? null})`);
      }
      if (this.email) {
        const text = [input.body, input.link ? `${this.email.origin.replace(/\/$/, '')}${input.link}` : null].filter(Boolean).join('\n\n') || input.title;
        await t.execute(sql`INSERT INTO core_email_queue (id, tenant_id, to_email, subject, body)
          SELECT gen_random_uuid(), ${input.tenantId}, u.email, ${input.title}, ${text} FROM core_users u
           WHERE u.id = ANY(${`{${[...new Set(input.userIds)].join(',')}}`}::uuid[]) AND u.email_notifications AND u.email <> ''`);
      }
    };
    if (tx) await write(tx);
    else await this.db.tx({ tenantId: input.tenantId }, write);
    for (const userId of new Set(input.userIds)) {
      await this.redis.publish(channelName(input.tenantId, userId), JSON.stringify({ type: input.type, title: input.title }));
    }
    if (this.channels.length) {
      const users = await this.db.app.execute(sql`SELECT id, email FROM core_users WHERE id = ANY(${`{${[...new Set(input.userIds)].join(',')}}`}::uuid[])`);
      for (const ch of this.channels) {
        for (const u of users.rows as { id: string; email: string }[]) {
          await ch.send({ userId: u.id, email: u.email }, input).catch(() => undefined);
        }
      }
    }
  }

  async list(tenantId: string, userId: string, opts: { unreadOnly?: boolean; limit?: number } = {}) {
    return this.db.tx({ tenantId }, async (tx) => {
      const r = await tx.execute(sql`SELECT id, type, module_id, title, body, link, created_at, read_at FROM core_notifications
        WHERE user_id = ${userId} ${opts.unreadOnly ? sql`AND read_at IS NULL` : sql``} ORDER BY created_at DESC LIMIT ${opts.limit ?? 50}`);
      const c = await tx.execute(sql`SELECT count(*)::int AS n FROM core_notifications WHERE user_id = ${userId} AND read_at IS NULL`);
      return { items: r.rows, unread: (c.rows[0] as { n: number }).n };
    });
  }

  async markRead(tenantId: string, userId: string, ids: string[] | 'all'): Promise<void> {
    await this.db.tx({ tenantId }, (tx) =>
      ids === 'all'
        ? tx.execute(sql`UPDATE core_notifications SET read_at = now() WHERE user_id = ${userId} AND read_at IS NULL`)
        : tx.execute(sql`UPDATE core_notifications SET read_at = now() WHERE user_id = ${userId} AND id = ANY(${`{${ids.join(',')}}`}::uuid[])`),
    );
  }
}
