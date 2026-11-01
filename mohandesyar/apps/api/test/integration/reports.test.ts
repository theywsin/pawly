import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningKey } from '@mohandesyar/module-package';
import { todayIso } from '@mohandesyar/persian';
import { TestApp } from '../helpers/app.js';
import { buildModule } from '../helpers/packages.js';

/**
 * Reports: module report providers listed by permission, run on screen with validated filters, saved with a
 * schedule, delivered to each recipient with that recipient's own access (project scope, no access → a
 * failed delivery, never someone else's rows), downloadable only by the recipient, and picked up by the
 * scheduler when due.
 */
let t: TestApp;
let a: { token: string; tenantId: string };
let officer: { token: string; userId: string };
let worker: { token: string; userId: string };
let adminId = '';
let savedId = '';
let companyIds: string[] = [];
const today = todayIso();
const body = { range: 'custom', from: today, to: today, filters: {} as Record<string, string> };

beforeAll(async () => {
  t = await TestApp.start();
  const admin = await t.consoleAdmin();
  const key = generateSigningKey();
  a = await t.signup('rep-a');
  await t.installModules(admin, key.publicKeyPem, [await buildModule('projects', key), await buildModule('qhse', key)], [a.tenantId]);
  officer = await t.member(a.token, 'site_hse_officer', 'officer');
  worker = await t.member(a.token, 'incident_reporter', 'worker');
  const me = (await t.req('GET', '/api/core/me', { token: a.token })).body;
  adminId = me.user.id;
  companyIds = me.company.ids;
  const p1 = (await t.req('POST', '/api/m/projects/v1/projects', { token: a.token, body: { code: 'P-1', title: 'تونل', status: 'active' } })).body.id;
  const p2 = (await t.req('POST', '/api/m/projects/v1/projects', { token: a.token, body: { code: 'P-2', title: 'سد', status: 'active' } })).body.id;
  await t.req('POST', `/api/m/projects/v1/projects/${p1}/members`, { token: a.token, body: { userId: officer.userId, role: 'engineer' } });
  for (const [projectId, kind] of [[p1, 'near_miss'], [p2, 'injury']]) {
    await t.req('POST', '/api/m/qhse/v1/incidents', { token: a.token, body: { kind, severity: 'low', occurredOn: today, title: 'رویداد گزارش', projectId } });
  }
}, 240_000);
afterAll(async () => t?.stop());

describe('reports', () => {
  it('lists reports by permission and runs them with validated filters', async () => {
    const keys = (await t.req('GET', '/api/core/reports', { token: a.token })).body.map((r: { key: string }) => r.key).sort();
    expect(keys).toEqual(['projects.status', 'qhse.incidents_report']);
    expect((await t.req('GET', '/api/core/reports', { token: worker.token })).body).toEqual([]);
    const r = await t.req('POST', '/api/core/reports/run/qhse/qhse.incidents_report', { token: a.token, body });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.rows).toHaveLength(2);
    expect(r.body.columns[0]).toMatchObject({ key: 'number', header: 'شماره' });
    expect((await t.req('POST', '/api/core/reports/run/qhse/qhse.incidents_report', { token: a.token, body: { ...body, filters: { kind: 'near_miss' } } })).body.rows).toHaveLength(1);
    expect((await t.req('POST', '/api/core/reports/run/qhse/qhse.incidents_report', { token: a.token, body: { ...body, filters: { kind: 'x' } } })).body.code).toBe('FILTER');
    expect((await t.req('POST', '/api/core/reports/run/qhse/qhse.incidents_report', { token: a.token, body: { ...body, filters: { nope: '1' } } })).body.code).toBe('FILTER');
    expect((await t.req('POST', '/api/core/reports/run/qhse/qhse.incidents_report', { token: a.token, body: { range: 'custom', filters: {} } })).status).toBe(400);
    expect((await t.req('POST', '/api/core/reports/run/qhse/qhse.incidents_report', { token: worker.token, body })).status).toBe(403);
    // The officer sees only their project's incident.
    expect((await t.req('POST', '/api/core/reports/run/qhse/qhse.incidents_report', { token: officer.token, body })).body.rows).toHaveLength(1);
  });

  it('delivers a saved report to each recipient with their own access', async () => {
    const save = { moduleId: 'qhse', reportKey: 'qhse.incidents_report', name: 'حوادث روزانه', params: { range: 'last_7_days', filters: {} }, schedule: 'daily', recipients: [] as string[] };
    expect((await t.req('POST', '/api/core/reports/saved', { token: a.token, body: save })).body.code).toBe('RECIPIENTS');
    const r = await t.req('POST', '/api/core/reports/saved', { token: a.token, body: { ...save, recipients: [adminId, officer.userId, worker.userId] } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    savedId = r.body.id;
    expect(new Date(r.body.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    expect((await t.req('POST', `/api/core/reports/saved/${savedId}/send`, { token: officer.token })).status).toBe(404); // not the owner
    expect((await t.req('POST', `/api/core/reports/saved/${savedId}/send`, { token: a.token })).body).toEqual({ delivered: 2 });
    const mine = (await t.req('GET', '/api/core/reports/inbox', { token: a.token })).body;
    const theirs = (await t.req('GET', '/api/core/reports/inbox', { token: officer.token })).body;
    const none = (await t.req('GET', '/api/core/reports/inbox', { token: worker.token })).body;
    expect(mine[0]).toMatchObject({ status: 'ok', row_count: 2, has_file: true });
    expect(theirs[0]).toMatchObject({ status: 'ok', row_count: 1 });
    expect(none[0]).toMatchObject({ status: 'failed', row_count: 0, has_file: false });
    // Files go to their recipient only.
    expect((await t.req('GET', `/api/core/reports/inbox/${mine[0].id}/download`, { token: a.token })).body.url).toMatch(/^http/);
    expect((await t.req('GET', `/api/core/reports/inbox/${mine[0].id}/download`, { token: officer.token })).status).toBe(404);
    const file = await fetch((await t.req('GET', `/api/core/reports/inbox/${theirs[0].id}/download`, { token: officer.token })).body.url);
    expect(Buffer.from(await file.arrayBuffer()).subarray(0, 2).toString()).toBe('PK');
    expect((await t.req('GET', '/api/core/notifications', { token: officer.token })).body.items.some((n: { type: string }) => n.type === 'core.report.delivered')).toBe(true);
  });

  it('runs due reports from the scheduler and sets the next run', async () => {
    await t.services.db.tx({ tenantId: a.tenantId, companyIds }, (x) => x.execute(sql`UPDATE core_saved_reports SET next_run_at = now() - interval '1 minute' WHERE id = ${savedId}`));
    await t.services.scheduler.tick(Date.now());
    const runs = (await t.req('GET', '/api/core/reports/inbox', { token: a.token })).body;
    expect(runs).toHaveLength(2);
    const next = (await t.services.db.tx({ tenantId: a.tenantId, companyIds }, (x) => x.execute(sql`SELECT next_run_at FROM core_saved_reports WHERE id = ${savedId}`))).rows[0] as { next_run_at: string };
    expect(new Date(next.next_run_at).getTime()).toBeGreaterThan(Date.now() + 60 * 60_000);
    await t.services.scheduler.tick(Date.now()); // not due again
    expect((await t.req('GET', '/api/core/reports/inbox', { token: a.token })).body).toHaveLength(2);
  });
});
