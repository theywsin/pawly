import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { TestApp, multipart } from '../helpers/app.js';

let t: TestApp;
let owner: { token: string; tenantId: string };
const users: Record<string, { token: string; userId: string }> = {};

async function member(key: string, roleKey: string) {
  const email = `${key}-${Date.now()}@example.ir`;
  const add = await t.req('POST', '/api/core/members', { token: owner.token, body: { email, fullName: key, initialPassword: 'Member-pass1', roleKey } });
  expect(add.status, JSON.stringify(add.body)).toBe(201);
  const login = await t.req('POST', '/api/auth/login', { body: { email, password: 'Member-pass1' } });
  users[key] = { token: login.body.accessToken, userId: add.body.userId };
}

async function scopeOf(token: string) {
  const me = await t.req('GET', '/api/core/me', { token });
  return { tenantId: me.body.tenant.id, companyId: me.body.company.id, companyIds: me.body.company.ids, userId: me.body.user.id };
}

beforeAll(async () => {
  t = await TestApp.start();
  owner = await t.signup('svc');
  await member('requester', 'employee');
  await member('ceo1', 'ceo');
  await member('ceo2', 'ceo');
  await member('admin2', 'company_admin');
});
afterAll(async () => t?.stop());

describe('workflow engine', () => {
  beforeAll(async () => {
    const r = await t.req('PUT', '/api/core/workflows/payments.approval', {
      token: owner.token,
      body: {
        moduleId: 'core',
        definition: {
          title: 'تأیید پرداخت',
          steps: [
            { key: 'ceo', label: 'مدیرعامل', approverRole: 'ceo' },
            { key: 'board', label: 'مدیر شرکت', approverRole: 'company_admin', minAmount: 1_000_000_000 },
          ],
        },
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.version).toBe(1);
    const bad = await t.req('PUT', '/api/core/workflows/bad', { token: owner.token, body: { moduleId: 'core', definition: { title: 'x', steps: [] } } });
    expect(bad.status).toBe(400);
  });

  it('routes a small amount through one step and notifies approvers and requester', async () => {
    const s = await scopeOf(users.requester!.token);
    const w = await t.services.workflow.start(s, { moduleId: 'core', key: 'payments.approval', entityType: 'payment', entityId: 'p-1', title: 'پرداخت پیش‌پرداخت', amount: 5_000_000 });
    expect(w.state).toBe('pending');
    const inbox = await t.req('GET', '/api/core/approvals', { token: users.ceo1!.token });
    expect(inbox.body.map((x: { id: string }) => x.id)).toContain(w.instanceId);
    // The requester never sees their own request to approve.
    expect((await t.req('GET', '/api/core/approvals', { token: users.requester!.token })).body).toEqual([]);
    const notes = await t.req('GET', '/api/core/notifications', { token: users.ceo1!.token });
    expect(notes.body.items[0].title).toContain('پرداخت پیش‌پرداخت');
    const d = await t.req('POST', `/api/core/approvals/${w.instanceId}/decide`, { token: users.ceo1!.token, body: { decision: 'approve' } });
    expect(d.body.state).toBe('approved');
    const done = await t.req('GET', '/api/core/notifications', { token: users.requester!.token });
    expect(done.body.items[0].title).toContain('تأیید شد');
    const ev = await t.services.db.tx({ tenantId: s.tenantId }, (tx) => tx.execute(sql`SELECT payload FROM core_outbox WHERE event_type = 'core.workflow.completed'`));
    expect((ev.rows[0] as { payload: { state: string } }).payload.state).toBe('approved');
  });

  it('enforces separation of duties, eligibility and distinct approvers', async () => {
    const s = await scopeOf(users.ceo1!.token);
    const w = await t.services.workflow.start(s, { moduleId: 'core', key: 'payments.approval', entityType: 'payment', entityId: 'p-2', title: 'خرید بزرگ', amount: 2_000_000_000 });
    const self = await t.req('POST', `/api/core/approvals/${w.instanceId}/decide`, { token: users.ceo1!.token, body: { decision: 'approve' } });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('SELF_APPROVAL');
    const wrong = await t.req('POST', `/api/core/approvals/${w.instanceId}/decide`, { token: users.requester!.token, body: { decision: 'approve' } });
    expect(wrong.body.code).toBe('NOT_APPROVER');
    expect((await t.req('POST', `/api/core/approvals/${w.instanceId}/decide`, { token: users.ceo2!.token, body: { decision: 'approve' } })).body.state).toBe('pending');
    // Second step (amount ≥ threshold) needs a company admin other than people who already decided.
    expect((await t.req('POST', `/api/core/approvals/${w.instanceId}/decide`, { token: users.ceo2!.token, body: { decision: 'approve' } })).body.code).toBe('DUPLICATE_APPROVER');
    expect((await t.req('POST', `/api/core/approvals/${w.instanceId}/decide`, { token: users.admin2!.token, body: { decision: 'approve' } })).body.state).toBe('approved');
    expect((await t.req('POST', `/api/core/approvals/${w.instanceId}/decide`, { token: owner.token, body: { decision: 'approve' } })).body.code).toBe('WORKFLOW_FINISHED');
  });

  it('applies the role approval limit', async () => {
    await t.services.db.tx({ tenantId: owner.tenantId }, (tx) => tx.execute(sql`UPDATE core_roles SET approval_limit = 1000000 WHERE key = 'ceo'`));
    const s = await scopeOf(users.requester!.token);
    const w = await t.services.workflow.start(s, { moduleId: 'core', key: 'payments.approval', entityType: 'payment', entityId: 'p-3', title: 'پرداخت متوسط', amount: 5_000_000 });
    const r = await t.req('POST', `/api/core/approvals/${w.instanceId}/decide`, { token: users.ceo1!.token, body: { decision: 'approve' } });
    expect(r.body.code).toBe('OVER_APPROVAL_LIMIT');
    expect((await t.req('POST', `/api/core/approvals/${w.instanceId}/decide`, { token: users.ceo1!.token, body: { decision: 'reject', comment: 'خارج از اختیار' } })).body.state).toBe('rejected');
  });

  it('keeps workflows tenant-isolated', async () => {
    const other = await t.signup('svc-other');
    expect((await t.req('GET', '/api/core/approvals', { token: other.token })).body).toEqual([]);
    const s = await scopeOf(users.requester!.token);
    const w = await t.services.workflow.start(s, { moduleId: 'core', key: 'payments.approval', entityType: 'payment', entityId: 'p-4', title: 'x', amount: 1 });
    expect((await t.req('POST', `/api/core/approvals/${w.instanceId}/decide`, { token: other.token, body: { decision: 'approve' } })).status).toBe(404);
  });
});

describe('files (S3-compatible storage)', () => {
  it('stores a file privately and hands out a short-lived download URL only within the tenant', async () => {
    const { payload, headers } = multipart(Buffer.from('نقشه سازه — نسخه ۱'), 'plan.txt');
    const up = await t.req('POST', '/api/core/files', { token: owner.token, payload, headers });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect(up.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    const url = await t.req('GET', `/api/core/files/${up.body.id}/url`, { token: owner.token });
    expect(url.body.url).toContain('X-Amz-Expires=300');
    const res = await fetch(url.body.url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('نقشه سازه — نسخه ۱');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    // Another tenant cannot obtain a URL; the object key is never exposed.
    const other = await t.signup('files-other');
    expect((await t.req('GET', `/api/core/files/${up.body.id}/url`, { token: other.token })).status).toBe(404);
  });

  it('keeps module-owned files out of the generic download endpoint', async () => {
    const bad = multipart(Buffer.from('cv'), 'cv.txt', 'file', { module: 'no.such' });
    expect((await t.req('POST', '/api/core/files', { token: owner.token, ...bad })).body.code).toBe('MODULE_INACTIVE');
    const s = await scopeOf(owner.token);
    const f = await t.services.files.upload(s, { name: 'cv.txt', mime: 'text/plain', data: Buffer.from('رزومه') }, { confidentiality: 'confidential', owner: { module: 'recruitment' } });
    // Only the owning module (after its own permission check) can hand out a link.
    expect((await t.req('GET', `/api/core/files/${f.id}/url`, { token: owner.token })).status).toBe(404);
    await expect(t.services.files.downloadUrl(s, f.id, 'crm')).rejects.toThrow();
    const claimed = await t.services.files.claim(s, 'recruitment', f.id, { type: 'candidate', id: 'c-1' });
    expect(claimed.name).toBe('cv.txt');
    // A file can be claimed only once, and only by its module.
    await expect(t.services.files.claim(s, 'recruitment', f.id, { type: 'candidate', id: 'c-2' })).rejects.toThrow();
    expect((await t.services.files.downloadUrl(s, f.id, 'recruitment')).url).toContain('X-Amz-Expires=300');
  });

  it('rejects executable/script uploads and empty files', async () => {
    const html = multipart(Buffer.from('<script>alert(1)</script>'), 'x.html');
    expect((await t.req('POST', '/api/core/files', { token: owner.token, ...html })).body.code).toBe('FILE_TYPE_BLOCKED');
    const empty = multipart(Buffer.alloc(0), 'a.txt');
    expect((await t.req('POST', '/api/core/files', { token: owner.token, ...empty })).body.code).toBe('EMPTY_FILE');
  });
});

describe('notifications', () => {
  it('marks notifications read', async () => {
    const before = await t.req('GET', '/api/core/notifications', { token: users.ceo1!.token });
    expect(before.body.unread).toBeGreaterThan(0);
    await t.req('POST', '/api/core/notifications/read', { token: users.ceo1!.token, body: { ids: 'all' } });
    expect((await t.req('GET', '/api/core/notifications', { token: users.ceo1!.token })).body.unread).toBe(0);
  });
});
