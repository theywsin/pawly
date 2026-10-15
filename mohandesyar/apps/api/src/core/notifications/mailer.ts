import { sql } from 'drizzle-orm';
import { createTransport, type Transporter } from 'nodemailer';
import type { Database } from '../../infra/db.js';

/**
 * Delivers queued email (core_email_queue) through SMTP. Rows are claimed with SKIP LOCKED, so every
 * worker can run the loop; failures retry with backoff (6 attempts), then stay "failed" for the console.
 */
export class Mailer {
  private readonly transport: Transporter | null;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;

  constructor(
    private readonly db: Database,
    smtpUrl: string | undefined,
    private readonly from: string,
    private readonly onError: (err: unknown, ctx: Record<string, unknown>) => void,
  ) {
    this.transport = smtpUrl ? createTransport(smtpUrl) : null;
  }

  get enabled(): boolean {
    return this.transport !== null;
  }

  async deliverOnce(limit = 20): Promise<number> {
    if (!this.transport) return 0;
    const rows = (await this.db.app.execute(sql`SELECT * FROM core_email_claim(${limit})`)).rows as { id: string; to_email: string; subject: string; body: string }[];
    for (const m of rows) {
      try {
        await this.transport.sendMail({ from: this.from, to: m.to_email, subject: m.subject, text: m.body, html: htmlOf(m.subject, m.body) });
        await this.db.app.execute(sql`SELECT core_email_finish(${m.id}, true, NULL)`);
      } catch (err) {
        this.onError(err, { emailId: m.id });
        await this.db.app.execute(sql`SELECT core_email_finish(${m.id}, false, ${(err as Error).message})`);
      }
    }
    return rows.length;
  }

  /** Sends one message immediately (console "test email"). */
  async sendNow(to: string, subject: string, body: string): Promise<void> {
    if (!this.transport) throw new Error('SMTP is not configured');
    await this.transport.sendMail({ from: this.from, to, subject, text: body, html: htmlOf(subject, body) });
  }

  async stats(): Promise<Record<string, number>> {
    const r = await this.db.app.execute(sql`SELECT * FROM core_email_stats()`);
    return Object.fromEntries((r.rows as { status: string; n: string }[]).map((x) => [x.status, Number(x.n)]));
  }

  start(intervalMs = 10_000): void {
    if (this.timer || !this.transport) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.deliverOnce()
        .catch((err) => this.onError(err, { phase: 'mailer' }))
        .finally(() => (this.running = null));
    }, intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Right-to-left HTML version of a plain-text message (links stay clickable). */
function htmlOf(subject: string, body: string): string {
  const html = esc(body)
    .split('\n')
    .map((l) => l.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>'))
    .join('<br>');
  return `<!doctype html><html lang="fa" dir="rtl"><body style="font-family:Vazirmatn,Tahoma,sans-serif;direction:rtl;text-align:right;line-height:1.9"><h2 style="font-size:16px">${esc(subject)}</h2><p>${html}</p><p style="color:#666;font-size:12px">مهندیکس</p></body></html>`;
}
