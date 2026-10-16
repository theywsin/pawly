import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { multipart, TestApp } from '../helpers/app.js';

let t: TestApp;
let admin: { token: string };

export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

beforeAll(async () => {
  t = await TestApp.start();
  admin = await t.consoleAdmin(['super_admin', 'sales_admin']);
});
afterAll(async () => t?.stop());

const upload = (data: Buffer, name: string, token = admin.token) => {
  const m = multipart(data, name, 'file', { alt: 'لوگو' });
  return t.req('POST', '/api/console/site/media', { token, payload: m.payload, headers: m.headers });
};

describe('site images', () => {
  it('stores raster images (type detected from content) and serves them publicly with long caching', async () => {
    const r = await upload(PNG, 'logo.png');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ mime: 'image/png', url: `/api/public/media/${r.body.id}` });
    const img = await t.req('GET', r.body.url);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['cache-control']).toContain('immutable');
    expect((await t.req('GET', '/api/public/media/not-a-uuid')).status).toBe(404);
  });

  it('refuses SVG, HTML and files that only claim to be images', async () => {
    const svg = await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.svg');
    expect(svg.status).toBe(400);
    expect(svg.body.code).toBe('NOT_AN_IMAGE');
    expect((await upload(Buffer.from('<html><body>hi</body></html>'), 'fake.png')).body.code).toBe('NOT_AN_IMAGE');
  });

  it('is for platform admins only', async () => {
    const user = await t.signup('media');
    expect((await upload(PNG, 'a.png', user.token)).status).toBe(401);
  });
});

describe('our customers', () => {
  it('stays empty until a logo is published, then lists published customers in order', async () => {
    expect((await t.req('GET', '/api/public/site')).body.clients).toEqual([]);
    const logo = (await upload(PNG, 'c.png')).body;
    const save = (id: string, body: object) => t.req('PUT', `/api/console/site/clients/${id}`, { token: admin.token, body });
    expect((await save('new', { name: 'شرکت دوم', logoId: logo.id, sort: 2, url: 'https://second.example' })).status).toBe(200);
    await save('new', { name: 'شرکت اول', logoId: logo.id, sort: 1 });
    await save('new', { name: 'شرکت پنهان', logoId: logo.id, published: false });
    const bad = await save('new', { name: 'بد', logoId: logo.id, url: 'javascript:alert(1)' });
    expect(bad.status).toBe(400);
    expect((await save('new', { name: 'بی‌لوگو', logoId: '018f0000-0000-7000-8000-000000000000' })).status).toBe(400);
    const clients = (await t.req('GET', '/api/public/site')).body.clients;
    expect(clients.map((c: { name: string }) => c.name)).toEqual(['شرکت اول', 'شرکت دوم']);
    expect(clients[1]).toMatchObject({ url: 'https://second.example', logo: logo.url });
    const all = (await t.req('GET', '/api/console/site/clients', { token: admin.token })).body as { id: string; name: string }[];
    expect(all).toHaveLength(3);
    await t.req('POST', `/api/console/site/clients/${all.find((c) => c.name === 'شرکت اول')!.id}/delete`, { token: admin.token });
    expect((await t.req('GET', '/api/public/site')).body.clients.map((c: { name: string }) => c.name)).toEqual(['شرکت دوم']);
  });
});

describe('app download links', () => {
  it('defaults to no links and publishes what the console saves', async () => {
    const before = (await t.req('GET', '/api/public/site')).body.apps;
    expect(before.android).toEqual({ url: '', version: '', note: '' });
    const r = await t.req('PUT', '/api/console/site/apps', { token: admin.token, body: { android: { url: 'https://dl.example.ir/app.apk', version: '1.2.0' }, windows: { url: 'https://dl.example.ir/setup.exe', note: 'ویندوز ۱۰ به بالا' } } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const apps = (await t.req('GET', '/api/public/site')).body.apps;
    expect(apps.android).toEqual({ url: 'https://dl.example.ir/app.apk', version: '1.2.0', note: '' });
    expect(apps.windows.note).toBe('ویندوز ۱۰ به بالا');
    expect(apps.ios.url).toBe('');
    const bad = await t.req('PUT', '/api/console/site/apps', { token: admin.token, body: { mac: { url: 'ftp://x' } } });
    expect(bad.status).toBe(400);
    expect(bad.body.details[0].path).toBe('mac.url');
  });
});
