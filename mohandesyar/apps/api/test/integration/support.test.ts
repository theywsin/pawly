import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { multipart, TestApp } from '../helpers/app.js';

/** Support tickets and the console customer page on a real database: visibility, attachments, notifications, isolation. */
let t: TestApp;
let admin: { token: string };
let a: { token: string; tenantId: string };
let b: { token: string; tenantId: string };
let employee: { token: string; userId: string };
let ticketId = '';

beforeAll(async () => {
  t = await TestApp.start();
  admin = await t.consoleAdmin(['support']);
  a = await t.signup('support-a');
  b = await t.signup('support-b');
  employee = await t.member(a.token, 'employee', 'staff');
});
afterAll(async () => t?.stop());

const up = (token: string, data: Buffer, name: string, url = '/api/support/attachments') => {
  const m = multipart(data, name);
  return t.req('POST', url, { token, payload: m.payload, headers: m.headers });
};

describe('tickets', () => {
  it('any member opens a ticket with an attachment', async () => {
    const f = await up(employee.token, Buffer.from('log line 1\nlog line 2'), 'خطا.txt');
    expect(f.status, JSON.stringify(f.body)).toBe(201);
    const r = await t.req('POST', '/api/support/tickets', { token: employee.token, body: { subject: 'گزارش خطا در ورود', category: 'technical', priority: 'high', body: 'هنگام ورود خطای ۵۰۰ می‌بینم.', attachmentIds: [f.body.id] } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.number).toBeGreaterThanOrEqual(1001);
    ticketId = r.body.id;
    const d = (await t.req('GET', `/api/support/tickets/${ticketId}`, { token: employee.token })).body;
    expect(d).toMatchObject({ status: 'open', subject: 'گزارش خطا در ورود', priority: 'high' });
    expect(d.messages[0].files[0]).toMatchObject({ name: 'خطا.txt' });
    const dl = await t.req('GET', `/api/support/attachments/${f.body.id}`, { token: employee.token });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toContain("filename*=UTF-8''%D8%AE%D8%B7%D8%A7.txt");
    // An attachment is used once.
    expect((await t.req('POST', '/api/support/tickets', { token: employee.token, body: { subject: 'دوباره', body: 'متن کافی', attachmentIds: [f.body.id] } })).status).toBe(400);
  });

  it('rejects scripts and validates input in Persian', async () => {
    expect((await up(employee.token, Buffer.from('x'), 'run.sh')).body.code).toBe('FILE_TYPE_BLOCKED');
    const bad = await t.req('POST', '/api/support/tickets', { token: employee.token, body: { subject: 'ab', body: '' } });
    expect(bad.status).toBe(400);
    expect(bad.body.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['subject', 'body']));
  });

  it('members see their own tickets; the organisation admin sees all; other organisations see nothing', async () => {
    await t.req('POST', '/api/support/tickets', { token: a.token, body: { subject: 'سؤال درباره فاکتور', category: 'billing', body: 'فاکتور را چگونه بگیرم؟' } });
    expect((await t.req('GET', '/api/support/tickets', { token: employee.token })).body).toHaveLength(1);
    expect((await t.req('GET', '/api/support/tickets', { token: a.token })).body).toHaveLength(2);
    expect((await t.req('GET', '/api/support/tickets', { token: b.token })).body).toHaveLength(0);
    expect((await t.req('GET', `/api/support/tickets/${ticketId}`, { token: b.token })).status).toBe(404);
    const file = (await t.req('GET', `/api/support/tickets/${ticketId}`, { token: a.token })).body.messages[0].files[0].id;
    expect((await t.req('GET', `/api/support/attachments/${file}`, { token: b.token })).status).toBe(404);
  });

  it('the platform answers from the console and the member is notified', async () => {
    const queue = (await t.req('GET', '/api/console/support/tickets?status=waiting', { token: admin.token })).body as { id: string; priority: string; tenant_name: string }[];
    expect(queue[0]).toMatchObject({ id: ticketId, priority: 'high', tenant_name: 'سازمان support-a' });
    const f = await up(admin.token, Buffer.from('راهنما'), 'راهنما.txt', `/api/console/support/attachments?ticketId=${ticketId}`);
    expect(f.status, JSON.stringify(f.body)).toBe(201);
    const r = await t.req('POST', `/api/console/support/tickets/${ticketId}/reply`, { token: admin.token, body: { body: 'مشکل برطرف شد؛ دوباره امتحان کنید.', attachmentIds: [f.body.id] } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = (await t.req('GET', `/api/support/tickets/${ticketId}`, { token: employee.token })).body;
    expect(d.status).toBe('answered');
    expect(d.messages[1]).toMatchObject({ author_type: 'admin', author_name: 'پشتیبانی', body: 'مشکل برطرف شد؛ دوباره امتحان کنید.' });
    expect((await t.req('GET', `/api/support/attachments/${f.body.id}`, { token: employee.token })).status).toBe(200);
    const n = (await t.req('GET', '/api/core/notifications', { token: employee.token })).body;
    expect(JSON.stringify(n)).toContain('پاسخ پشتیبانی به تیکت');
  });

  it('a reply from the member reopens it; the member can close it', async () => {
    await t.req('POST', `/api/support/tickets/${ticketId}/reply`, { token: employee.token, body: { body: 'هنوز خطا دارم.' } });
    expect((await t.req('GET', `/api/support/tickets/${ticketId}`, { token: employee.token })).body.status).toBe('customer_reply');
    await t.req('POST', `/api/support/tickets/${ticketId}/close`, { token: employee.token });
    expect((await t.req('GET', `/api/console/support/tickets/${ticketId}`, { token: admin.token })).body.status).toBe('closed');
    expect((await t.req('GET', '/api/console/support/tickets', { token: a.token })).status).toBe(401);
  });
});

describe('customer page in the console', () => {
  it('shows organisation, companies, members with last login, subscription, modules and tickets', async () => {
    const d = (await t.req('GET', `/api/console/customers/${a.tenantId}`, { token: admin.token })).body;
    expect(d.tenant).toMatchObject({ id: a.tenantId, name: 'سازمان support-a', active_users: '2' }); // bigint counters arrive as strings
    expect(d.companies).toHaveLength(1);
    expect(d.members).toHaveLength(2);
    expect(d.members.every((m: { last_login: string | null }) => m.last_login)).toBe(true);
    expect(d.tickets).toHaveLength(2);
    expect(d).toHaveProperty('invoices');
    expect(d).toHaveProperty('payments');
    expect((await t.req('GET', '/api/console/customers/018f0000-0000-7000-8000-000000000000', { token: admin.token })).status).toBe(404);
  });
});
