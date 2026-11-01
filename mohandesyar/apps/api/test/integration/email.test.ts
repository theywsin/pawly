import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { TestApp } from '../helpers/app.js';
import { smtpSink } from '../helpers/smtp.js';

/** SMTP: notifications queue an email in the same transaction; delivery retries; users can opt out. */
let t: TestApp;
let sink: Awaited<ReturnType<typeof smtpSink>>;

beforeAll(async () => {
  sink = await smtpSink();
  t = await TestApp.start({ SMTP_URL: `smtp://127.0.0.1:${sink.port}/?ignoreTLS=true`, MAIL_FROM: 'Mohandix <no-reply@example.ir>', PUBLIC_ORIGIN: 'https://app.example.ir' });
});
afterAll(async () => {
  await t?.stop();
  await sink?.close();
});

const notify = (tenantId: string, userIds: string[], title: string) =>
  t.services.notifications.notify({ tenantId, userIds, type: 'test', title, body: 'متن اعلان', link: '/app/tasks' });

describe('email channel', () => {
  it('delivers a notification as a right-to-left email with an absolute link', async () => {
    const a = await t.signup('mail-a');
    const me = await t.req('GET', '/api/core/me', { token: a.token });
    expect(me.body.user.emailNotifications).toBe(true);
    await notify(a.tenantId, [me.body.user.id], 'وظیفه جدید به شما سپرده شد');
    expect(await t.services.mailer.deliverOnce()).toBe(1);
    expect(sink.mails).toHaveLength(1);
    expect(sink.mails[0]!.to).toEqual([a.email]);
    const raw = sink.mails[0]!.data;
    expect(raw).toMatch(/dir=(3D)?"rtl"/); // quoted-printable encodes '='
    expect(raw).toMatch(/https:\/\/app\.example\.ir\/app\/tasks/);
  });

  it('does not email for a notification whose transaction rolled back', async () => {
    const a = await t.signup('mail-rb');
    const userId = (await t.req('GET', '/api/core/me', { token: a.token })).body.user.id;
    await t.services.db
      .tx({ tenantId: a.tenantId }, async (tx) => {
        await t.services.notifications.notify({ tenantId: a.tenantId, userIds: [userId], type: 'test', title: 'برگشت‌خورده' }, tx as never);
        throw new Error('rollback');
      })
      .catch(() => undefined);
    const before = sink.mails.length;
    expect(await t.services.mailer.deliverOnce()).toBe(0);
    expect(sink.mails.length).toBe(before);
  });

  it('retries after an SMTP failure and respects the opt-out', async () => {
    const a = await t.signup('mail-retry');
    const userId = (await t.req('GET', '/api/core/me', { token: a.token })).body.user.id;
    sink.fail.on = true;
    await notify(a.tenantId, [userId], 'تلاش دوباره');
    expect(await t.services.mailer.deliverOnce()).toBe(1);
    const q = (text: ReturnType<typeof sql>) => t.services.db.tx({ tenantId: a.tenantId }, (tx) => tx.execute(text)).then((r) => r.rows as Record<string, unknown>[]);
    const failed = await q(sql`SELECT status, attempts, last_error, available_at > now() AS later FROM core_email_queue WHERE subject = 'تلاش دوباره'`);
    expect(failed[0]).toMatchObject({ status: 'pending', attempts: 1, later: true }); // backoff before the next try
    expect(String(failed[0]!.last_error)).toContain('554');
    sink.fail.on = false;
    await q(sql`UPDATE core_email_queue SET available_at = now() WHERE subject = 'تلاش دوباره'`);
    expect(await t.services.mailer.deliverOnce()).toBe(1);
    expect((await q(sql`SELECT status FROM core_email_queue WHERE subject = 'تلاش دوباره'`))[0]!.status).toBe('sent');

    expect((await t.req('PUT', '/api/core/profile/email-notifications', { token: a.token, body: { enabled: false } })).status).toBe(200);
    await notify(a.tenantId, [userId], 'بدون ایمیل');
    expect(await q(sql`SELECT 1 FROM core_email_queue WHERE subject = 'بدون ایمیل'`)).toEqual([]);
    const n = await t.req('GET', '/api/core/notifications', { token: a.token });
    expect(n.body.items[0].title).toBe('بدون ایمیل'); // in-app notification still delivered
  });

  it('console shows queue state and can send a test email', async () => {
    const admin = await t.consoleAdmin();
    const sys = await t.req('GET', '/api/console/system', { token: admin.token });
    expect(sys.body.email.enabled).toBe(true);
    expect(sys.body.email.queue.sent).toBeGreaterThanOrEqual(2);
    const r = await t.req('POST', '/api/console/system/test-email', { token: admin.token, body: { to: 'ops@example.ir' } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(sink.mails.at(-1)!.to).toEqual(['ops@example.ir']);
  });
});
