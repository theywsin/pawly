import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningKey } from '@mohandesyar/module-package';
import { addDays, todayIso } from '@mohandesyar/persian';
import { TestApp } from '../helpers/app.js';
import { buildModule } from '../helpers/packages.js';

/** crm (with contracts and projects installed): leads → conversion → pipeline → proposals → reports; own-scope reps; isolation. */
let t: TestApp;
let a: { token: string; tenantId: string };
let b: { token: string; tenantId: string };
let rep: { token: string; userId: string };
let rep2: { token: string; userId: string };
const api = (p: string) => `/api/m/crm/v1${p}`;
const today = todayIso();
let stages: { id: string; name: string; kind: string; probability: number }[] = [];
let leadId = '';
let accountId = '';
let oppId = '';

beforeAll(async () => {
  t = await TestApp.start();
  const admin = await t.consoleAdmin();
  const key = generateSigningKey();
  a = await t.signup('crm-a');
  b = await t.signup('crm-b');
  await t.installModules(admin, key.publicKeyPem, [await buildModule('contracts', key), await buildModule('projects', key), await buildModule('crm', key)], [a.tenantId, b.tenantId]);
  rep = await t.member(a.token, 'sales_rep', 'rep');
  rep2 = await t.member(a.token, 'sales_rep', 'rep2');
}, 300_000);
afterAll(async () => t?.stop());

describe('crm', () => {
  it('creates the default pipeline on first use', async () => {
    stages = (await t.req('GET', api('/stages'), { token: a.token })).body;
    expect(stages.map((s) => s.kind)).toEqual(['open', 'open', 'open', 'open', 'won', 'lost']);
    expect(stages[2]).toMatchObject({ name: 'ارسال پیشنهاد', probability: 50 });
  });

  it('a rep records a lead; validation and own scope apply', async () => {
    const bad = await t.req('POST', api('/leads'), { token: rep.token, body: { title: 'x', source: 'nowhere', mobile: '123' } });
    expect(bad.status).toBe(400);
    const r = await t.req('POST', api('/leads'), {
      token: rep.token,
      body: { title: 'طراحی و نظارت مجتمع تجاری', organizationName: 'شرکت توسعه شهری آریا', contactName: 'مهندس کاظمی', mobile: '۰۹۱۲۳۴۵۶۷۸۹', source: 'referral', need: 'طراحی معماری و سازه', estimatedBudget: '12000000000', score: 70, nextContactOn: today },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    leadId = r.body.id;
    expect((await t.req('GET', api('/leads'), { token: rep2.token })).body).toEqual([]); // another rep: own scope
    expect((await t.req('GET', api(`/leads/${leadId}`), { token: rep2.token })).status).toBe(404);
    expect((await t.req('GET', api('/leads'), { token: a.token })).body.map((x: { id: string }) => x.id)).toEqual([leadId]);
    const l = await t.req('GET', api(`/leads/${leadId}`), { token: rep.token });
    expect(l.body.lead).toMatchObject({ mobile: '09123456789', owner_id: rep.userId, status: 'new' });
  });

  it('an interaction moves a new lead to contacted and sets the next contact', async () => {
    const r = await t.req('POST', api('/interactions'), { token: rep.token, body: { leadId, kind: 'call', occurredOn: today, summary: 'هماهنگی جلسه معرفی', nextContactOn: addDays(today, 2) } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const l = await t.req('GET', api(`/leads/${leadId}`), { token: rep.token });
    expect(l.body.lead).toMatchObject({ status: 'contacted', next_contact_on: addDays(today, 2) });
    expect(l.body.interactions).toHaveLength(1);
  });

  it('converts the lead into an account, contact and opportunity in the first stage', async () => {
    const r = await t.req('POST', api(`/leads/${leadId}/convert`), { token: rep.token, body: {} });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    accountId = r.body.accountId;
    oppId = r.body.opportunityId;
    expect((await t.req('POST', api(`/leads/${leadId}/convert`), { token: rep.token, body: {} })).status).toBe(409);
    const o = await t.req('GET', api(`/opportunities/${oppId}`), { token: rep.token });
    expect(o.body.opportunity).toMatchObject({ title: 'طراحی و نظارت مجتمع تجاری', amount: '12000000000', stage_id: stages[0]!.id, status: 'open', account_name: 'شرکت توسعه شهری آریا', source: 'referral' });
    const acc = await t.req('GET', api(`/accounts/${accountId}`), { token: rep.token });
    expect(acc.body.contacts[0]).toMatchObject({ full_name: 'مهندس کاظمی', mobile: '09123456789' });
    expect(acc.body.interactions).toHaveLength(1); // the lead's history moves with it
  });

  it('warns about a contact with a mobile already registered (without blocking)', async () => {
    const r = await t.req('POST', api(`/accounts/${accountId}/contacts`), { token: rep.token, body: { fullName: 'کاظمی (دفتر)', mobile: '+98 912 345 6789' } });
    expect(r.status).toBe(201);
    expect(r.body.duplicates).toHaveLength(1);
  });

  it('proposals are versioned; sent versions are kept; acceptance is recorded', async () => {
    const p = await t.req('POST', api(`/opportunities/${oppId}/proposals`), { token: rep.token, body: { title: 'پیشنهاد فنی و مالی', kind: 'technical_financial', amount: '11500000000', validUntil: addDays(today, 30), content: 'شرح خدمات…' } });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    expect((await t.req('POST', api(`/opportunities/${oppId}/proposals/${p.body.id}/status`), { token: rep.token, body: { status: 'accepted', on: today } })).status).toBe(409);
    expect((await t.req('POST', api(`/opportunities/${oppId}/proposals/${p.body.id}/status`), { token: rep.token, body: { status: 'sent', on: today } })).status).toBe(200);
    const v2 = await t.req('POST', api(`/opportunities/${oppId}/proposals/${p.body.id}/versions`), { token: rep.token, body: { amount: '11000000000', validUntil: addDays(today, 45), content: 'با تخفیف' } });
    expect(v2.body.version).toBe(2);
    await t.req('POST', api(`/opportunities/${oppId}/proposals/${p.body.id}/status`), { token: rep.token, body: { status: 'sent', on: today } });
    await t.req('POST', api(`/opportunities/${oppId}/proposals/${p.body.id}/status`), { token: rep.token, body: { status: 'accepted', on: today } });
    const o = await t.req('GET', api(`/opportunities/${oppId}`), { token: rep.token });
    const prop = o.body.proposals[0];
    expect(prop.status).toBe('accepted');
    expect(prop.versions.map((v: { version: number; amount: string; sentOn: string | null }) => [v.version, v.amount, !!v.sentOn])).toEqual([[2, '11000000000', true], [1, '11500000000', true]]);
  });

  it('moves through the pipeline; losing needs a reason; winning closes and publishes', async () => {
    await t.req('POST', api(`/opportunities/${oppId}/move`), { token: rep.token, body: { stageId: stages[2]!.id } });
    const lost = stages.find((s) => s.kind === 'lost')!;
    const won = stages.find((s) => s.kind === 'won')!;
    expect((await t.req('POST', api(`/opportunities/${oppId}/move`), { token: rep.token, body: { stageId: lost.id } })).body.code).toBe('LOST_REASON_REQUIRED');
    const w = await t.req('POST', api(`/opportunities/${oppId}/move`), { token: rep.token, body: { stageId: won.id } });
    expect(w.body.status).toBe('won');
    const o = await t.req('GET', api(`/opportunities/${oppId}`), { token: rep.token });
    expect(o.body.opportunity).toMatchObject({ status: 'won', closed_on: today });
    expect(o.body.history.map((h: { to_name: string }) => h.to_name)).toEqual(['برنده', 'ارسال پیشنهاد', 'ارزیابی اولیه']);
    const { sql } = await import('drizzle-orm');
    const ev = await t.services.db.tx({ tenantId: a.tenantId }, (tx) => tx.execute(sql`SELECT payload FROM core_outbox WHERE event_type = 'crm.opportunity.won'`));
    expect(ev.rows).toEqual([{ payload: { opportunityId: oppId, accountId, title: 'طراحی و نظارت مجتمع تجاری', amount: '12000000000' } }]);
  });

  it('a lost opportunity and a lost lead feed the sales report', async () => {
    const acc = await t.req('POST', api('/accounts'), { token: a.token, body: { kind: 'company', name: 'شهرداری منطقه ۲' } });
    const o = await t.req('POST', api('/opportunities'), { token: a.token, body: { title: 'نظارت پروژه پل', accountId: acc.body.id, amount: '5000000000' } });
    await t.req('POST', api(`/opportunities/${o.body.id}/move`), { token: a.token, body: { stageId: stages.find((s) => s.kind === 'lost')!.id, lostReason: 'قیمت بالاتر از رقیب' } });
    const open = await t.req('POST', api('/opportunities'), { token: a.token, body: { title: 'طراحی مدرسه', accountId: acc.body.id, amount: '2000000000', stageId: stages[3]!.id } });
    expect(open.status).toBe(201);
    const l2 = await t.req('POST', api('/leads'), { token: a.token, body: { title: 'سرنخ نمایشگاه', source: 'exhibition' } });
    expect((await t.req('POST', api(`/leads/${l2.body.id}/lost`), { token: a.token, body: { reason: 'بودجه ندارد' } })).status).toBe(200);

    expect((await t.req('GET', api(`/reports/sales?from=${addDays(today, -30)}&to=${today}`), { token: rep.token })).status).toBe(403);
    const r = await t.req('GET', api(`/reports/sales?from=${addDays(today, -30)}&to=${today}`), { token: a.token });
    expect(r.body.leads).toMatchObject({ total: 2, converted: 1, lost: 1, conversionRate: 50 });
    expect(r.body.opportunities).toMatchObject({ won: 1, won_value: '12000000000', lost: 1, winRate: 50 });
    expect(r.body.bySource).toContainEqual({ source: 'referral', leads: 1, converted: 1, won_value: '12000000000' });
    expect(r.body.pipeline.find((s: { name: string }) => s.name === 'مذاکره')).toMatchObject({ count: 1, value: '2000000000', weighted: '1500000000' });
    expect(r.body.lostReasons).toEqual([{ reason: 'قیمت بالاتر از رقیب', n: 1 }]);
    expect(r.body.byOwner.find((x: { owner_id: string }) => x.owner_id === rep.userId)).toMatchObject({ won: 1, won_value: '12000000000' });
  });

  it('the pipeline keeps open, won and lost stages', async () => {
    const won = stages.find((s) => s.kind === 'won')!;
    expect((await t.req('PUT', api(`/stages/${won.id}`), { token: a.token, body: { name: 'برنده', probability: 100, kind: 'open', sort: 50 } })).body.code).toBe('STAGE_IN_USE');
    const add = await t.req('PUT', api('/stages/new'), { token: a.token, body: { name: 'ارزیابی صلاحیت', probability: 15, kind: 'open', sort: 15 } });
    expect(add.status, JSON.stringify(add.body)).toBe(200);
    expect((await t.req('PUT', api('/stages/new'), { token: rep.token, body: { name: 'x مرحله', probability: 1 } })).status).toBe(403);
  });

  it('follow-ups: widget for the owner and one reminder per day', async () => {
    const l = await t.req('POST', api('/leads'), { token: rep.token, body: { title: 'تماس امروز', source: 'call', nextContactOn: today } });
    expect(l.status).toBe(201);
    const w = await t.req('GET', '/api/core/widgets/crm/crm.followups', { token: rep.token });
    expect(w.body.data.items.map((x: { title: string }) => x.title)).toContain('تماس امروز');
    const now = Date.now();
    await t.services.scheduler.tick(now);
    await t.services.scheduler.tick(now + 130 * 60_000);
    const n = await t.req('GET', '/api/core/notifications', { token: rep.token });
    expect(n.body.items.filter((x: { type: string; title: string }) => x.type === 'crm.followup' && x.title.includes('تماس امروز'))).toHaveLength(1);
  });

  it('serves accounts to other modules and stays isolated between organisations', async () => {
    const k = await t.req('GET', '/api/m/contracts/v1/lookups/accounts?q=آریا', { token: a.token });
    expect(k.body).toEqual([{ id: accountId, title: 'شرکت توسعه شهری آریا' }]);
    expect((await t.req('GET', api(`/accounts/${accountId}`), { token: b.token })).status).toBe(404);
    expect((await t.req('GET', '/api/m/contracts/v1/lookups/accounts?q=', { token: b.token })).body).toEqual([]);
    const s = await t.req('GET', '/api/core/search?q=آریا', { token: a.token });
    expect(JSON.stringify(s.body)).toContain(`/app/crm/accounts/${accountId}`);
  });
});
