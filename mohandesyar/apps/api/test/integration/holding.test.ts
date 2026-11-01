import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningKey } from '@mohandesyar/module-package';
import { todayIso } from '@mohandesyar/persian';
import { TestApp } from '../helpers/app.js';
import { buildModule } from '../helpers/packages.js';

/**
 * holding (with qhse as a provider source): two companies in one tenant; values computed live from the
 * qhse providers per company; a member with holding rights in one company never sees the other; totals
 * (sum vs. average); Jalali monthly trend; saved views; tenant isolation.
 */
let t: TestApp;
let a: { token: string; tenantId: string };
let b: { token: string; tenantId: string };
let companyA = '';
let companyB = '';
let partial: { token: string; userId: string };
const api = (p: string) => `/api/m/holding/v1${p}`;
const today = todayIso();
const month = `${today.slice(0, 7)}-01`;
const incident = (company: string, kind: string) =>
  t.req('POST', '/api/m/qhse/v1/incidents', { token: a.token, headers: { 'x-company-id': company }, body: { kind, severity: 'low', occurredOn: today, title: 'رویداد آزمایشی' } });

beforeAll(async () => {
  t = await TestApp.start();
  const admin = await t.consoleAdmin();
  const key = generateSigningKey();
  a = await t.signup('hold-a');
  b = await t.signup('hold-b');
  await t.installModules(admin, key.publicKeyPem, [await buildModule('qhse', key), await buildModule('holding', key)], [a.tenantId, b.tenantId]);
  companyA = (await t.req('GET', '/api/core/me', { token: a.token })).body.company.id;
  const created = await t.req('POST', '/api/core/companies', { token: a.token, body: { name: 'شرکت ساختمانی دوم' } });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  companyB = created.body.id;
  const email = `hm-${Date.now()}@example.ir`;
  const add = await t.req('POST', '/api/core/members', { token: a.token, body: { email, fullName: 'مدیر هلدینگ جزئی', initialPassword: 'Passw0rd-strong', roleKey: 'holding_manager', companyId: companyA } });
  expect(add.status, JSON.stringify(add.body)).toBeLessThan(300);
  const login = await t.req('POST', '/api/auth/login', { body: { email, password: 'Passw0rd-strong' } });
  expect(login.body.accessToken).toBeTruthy();
  partial = { token: login.body.accessToken, userId: '' };
  for (const k of ['injury', 'near_miss', 'near_miss']) await incident(companyA, k);
  await incident(companyB, 'injury');
}, 240_000);
afterAll(async () => t?.stop());

describe('holding', () => {
  it('compares companies with live provider values and the right totals', async () => {
    expect((await t.req('GET', api('/companies'), { token: a.token })).body.map((c: { id: string }) => c.id).sort()).toEqual([companyA, companyB].sort());
    const keys = (await t.req('GET', api('/providers'), { token: a.token })).body.map((p: { key: string }) => p.key);
    expect(keys).toContain('qhse.near_misses');
    const r = await t.req('POST', api('/compare'), { token: a.token, body: { providers: ['qhse.incidents', 'qhse.near_misses', 'qhse.inspection_score'], from: month, to: today } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = (id: string) => r.body.rows.find((x: { companyId: string }) => x.companyId === id).values;
    expect(row(companyA)).toEqual({ 'qhse.incidents': 1, 'qhse.near_misses': 2, 'qhse.inspection_score': null });
    expect(row(companyB)).toEqual({ 'qhse.incidents': 1, 'qhse.near_misses': 0, 'qhse.inspection_score': null });
    expect(r.body.totals['qhse.near_misses']).toEqual({ value: 2, method: 'sum' });
    expect(r.body.totals['qhse.inspection_score']).toEqual({ value: null, method: 'none' }); // no data, not zero
    expect((await t.req('POST', api('/compare'), { token: a.token, body: { providers: ['nope.missing'], from: month, to: today } })).body.code).toBe('PROVIDER');
  });

  it('shows a member only the companies where they hold holding rights', async () => {
    expect((await t.req('GET', api('/companies'), { token: partial.token })).body.map((c: { id: string }) => c.id)).toEqual([companyA]);
    const r = (await t.req('POST', api('/compare'), { token: partial.token, body: { providers: ['qhse.near_misses'], from: month, to: today } })).body;
    expect(r.rows.map((x: { companyId: string }) => x.companyId)).toEqual([companyA]);
    expect((await t.req('POST', api('/compare'), { token: partial.token, body: { providers: ['qhse.near_misses'], from: month, to: today, companyIds: [companyB] } })).status).toBe(403);
    expect((await t.req('GET', api('/companies'), { token: partial.token, headers: { 'x-company-id': companyB } })).status).toBe(403);
  });

  it('builds a Jalali monthly trend and keeps saved views', async () => {
    const tr = (await t.req('POST', api('/trend'), { token: a.token, body: { provider: 'qhse.near_misses', to: today, months: 3 } })).body;
    expect(tr.months).toHaveLength(3);
    expect(tr.series.find((s: { companyId: string }) => s.companyId === companyA).points.at(-1)).toBe(2);
    expect((await t.req('POST', api('/views'), { token: a.token, body: { name: 'ایمنی شرکت‌ها', providers: ['qhse.incidents', 'qhse.near_misses'] } })).status).toBe(201);
    expect((await t.req('POST', api('/views'), { token: a.token, body: { name: 'ایمنی شرکت‌ها', providers: ['qhse.incidents'] } })).body.code).toBe('DUPLICATE');
    expect((await t.req('GET', api('/views'), { token: a.token })).body[0].providers).toEqual(['qhse.incidents', 'qhse.near_misses']);
  });

  it('isolates tenants', async () => {
    expect((await t.req('GET', api('/companies'), { token: b.token })).body).toHaveLength(1);
    expect((await t.req('POST', api('/compare'), { token: b.token, body: { providers: ['qhse.near_misses'], from: month, to: today, companyIds: [companyA] } })).status).toBe(403);
  });
});
