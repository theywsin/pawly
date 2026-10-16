import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningKey } from '@mohandesyar/module-package';
import { todayIso } from '@mohandesyar/persian';
import { TestApp } from '../helpers/app.js';
import { buildModule } from '../helpers/packages.js';

/**
 * Integrations: API keys act for their creator in one company, narrowed to explicit scopes, only on module
 * APIs, revocable; webhooks receive signed event deliveries of their company, retried on failure.
 */
let t: TestApp;
let a: { token: string; tenantId: string };
let b: { token: string; tenantId: string };
let worker: { token: string; userId: string };
let key = '';
let keyId = '';
let hookId = '';
let secret = '';
let server: Server;
let base = '';
let status = 200;
const received: { headers: IncomingHttpHeaders; body: string }[] = [];
const qhse = (p: string) => `/api/m/qhse/v1${p}`;
const today = todayIso();
const drain = async () => {
  while ((await t.services.events.dispatchOnce()) > 0);
};

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.statusCode = status;
      res.end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t = await TestApp.start({ WEBHOOK_ALLOW_PRIVATE: 'true' });
  const admin = await t.consoleAdmin();
  const k = generateSigningKey();
  a = await t.signup('int-a');
  b = await t.signup('int-b');
  await t.installModules(admin, k.publicKeyPem, [await buildModule('qhse', k)], [a.tenantId, b.tenantId]);
  worker = await t.member(a.token, 'incident_reporter', 'worker');
}, 240_000);
afterAll(async () => {
  await t?.stop();
  server?.close();
});

describe('API keys', () => {
  it('creates a key only with permissions the creator holds, and shows it once', async () => {
    expect((await t.req('POST', '/api/core/integrations/api-keys', { token: worker.token, body: { name: 'x', scopes: ['qhse.view'] } })).status).toBe(403);
    expect((await t.req('POST', '/api/core/integrations/api-keys', { token: a.token, body: { name: 'همه', scopes: ['qhse.*'] } })).body.code).toBe('SCOPE_NOT_HELD');
    const scopes = (await t.req('GET', '/api/core/integrations/scopes', { token: a.token })).body.map((s: { key: string }) => s.key);
    expect(scopes).toContain('qhse.view');
    const r = await t.req('POST', '/api/core/integrations/api-keys', { token: a.token, body: { name: 'سامانه HSE پیمانکار', scopes: ['qhse.view', 'qhse.incident.report'] } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    key = r.body.key;
    keyId = r.body.id;
    expect(key).toMatch(/^mk_[a-z0-9]{10}_/);
    const list = (await t.req('GET', '/api/core/integrations/api-keys', { token: a.token })).body;
    expect(JSON.stringify(list)).not.toContain(key.split('_')[2]);
  });

  it('works on module APIs within its scopes only', async () => {
    const r = await t.req('POST', qhse('/incidents'), { token: key, body: { kind: 'near_miss', severity: 'low', occurredOn: today, title: 'گزارش از سامانه پیمانکار' } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await t.req('GET', qhse('/incidents'), { token: key })).body).toHaveLength(1);
    expect((await t.req('GET', qhse('/risks'), { token: key })).status).toBe(200);
    expect((await t.req('POST', qhse('/risks'), { token: key, body: { activity: 'حفاری', hazard: 'ریزش', likelihood: 2, severity: 2 } })).status).toBe(403); // qhse.manage not in scopes
    expect((await t.req('GET', '/api/core/me', { token: key })).body.code).toBe('API_KEY_SCOPE');
    expect((await t.req('GET', '/api/core/integrations/api-keys', { token: key })).status).toBe(403);
    expect((await t.req('GET', qhse('/incidents'), { token: `${key.slice(0, -2)}xx` })).body.code).toBe('API_KEY_INVALID');
    expect((await t.req('GET', qhse('/incidents'), { token: b.token })).body).toEqual([]); // other tenant
  });

  it('stops working once revoked', async () => {
    expect((await t.req('DELETE', `/api/core/integrations/api-keys/${keyId}`, { token: a.token })).status).toBe(200);
    expect((await t.req('GET', qhse('/incidents'), { token: key })).body.code).toBe('API_KEY_REVOKED');
  });
});

describe('webhooks', () => {
  it('only subscribes to events of active modules', async () => {
    await drain(); // events from before the webhook existed are not delivered to it
    const events = (await t.req('GET', '/api/core/integrations/events', { token: a.token })).body.map((e: { type: string }) => e.type);
    expect(events).toContain('qhse.incident.reported');
    expect((await t.req('POST', '/api/core/integrations/webhooks', { token: a.token, body: { name: 'نادرست', url: `${base}/hook`, events: ['finance.payment.executed'] } })).body.code).toBe('WEBHOOK_EVENTS');
    const r = await t.req('POST', '/api/core/integrations/webhooks', { token: a.token, body: { name: 'سامانه ایمنی', url: `${base}/hook`, events: ['qhse.incident.reported'] } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    hookId = r.body.id;
    secret = r.body.secret;
    expect(secret).toMatch(/^whsec_/);
  });

  it('delivers signed events of its company and retries failures', async () => {
    await t.req('POST', qhse('/incidents'), { token: a.token, body: { kind: 'injury', severity: 'medium', occurredOn: today, title: 'برخورد ابزار' } });
    await t.req('POST', qhse('/incidents'), { token: b.token, body: { kind: 'injury', severity: 'medium', occurredOn: today, title: 'سازمان دیگر' } });
    await drain();
    expect(await t.services.integrations.sendOnce()).toBe(1); // only tenant A's company event
    expect(received.some((r) => r.body.includes('سازمان دیگر'))).toBe(false);
    const got = received.at(-1)!;
    const body = JSON.parse(got.body) as { type: string; data: { number: number }; companyId: string };
    expect(body.type).toBe('qhse.incident.reported');
    expect(got.headers['x-mohandix-event']).toBe('qhse.incident.reported');
    const [ts, v1] = String(got.headers['x-mohandix-signature']).split(',').map((x) => x.split('=')[1]);
    expect(v1).toBe(createHmac('sha256', secret).update(`${ts}.${got.body}`).digest('hex'));
    // A failing receiver is retried later, not lost.
    status = 500;
    expect((await t.req('POST', `/api/core/integrations/webhooks/${hookId}/ping`, { token: a.token })).status).toBe(200);
    expect(await t.services.integrations.sendOnce()).toBe(1);
    const d = (await t.req('GET', `/api/core/integrations/webhooks/${hookId}/deliveries`, { token: a.token })).body;
    expect(d[0]).toMatchObject({ event_type: 'core.ping', status: 'pending', attempts: 1, response_status: 500 });
    expect(d[1]).toMatchObject({ event_type: 'qhse.incident.reported', status: 'ok', response_status: 200 });
    // Disabled webhooks get no new deliveries.
    await t.req('PUT', `/api/core/integrations/webhooks/${hookId}/active`, { token: a.token, body: { active: false } });
    await t.req('POST', qhse('/incidents'), { token: a.token, body: { kind: 'near_miss', severity: 'low', occurredOn: today, title: 'بعد از غیرفعال' } });
    await drain();
    expect((await t.req('GET', `/api/core/integrations/webhooks/${hookId}/deliveries`, { token: a.token })).body).toHaveLength(2);
    expect((await t.req('GET', '/api/core/integrations/webhooks', { token: b.token })).body).toEqual([]);
  });
});
