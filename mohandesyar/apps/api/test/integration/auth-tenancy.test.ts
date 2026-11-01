import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totp } from '../../src/core/auth/crypto.js';
import { TestApp } from '../helpers/app.js';

let t: TestApp;
beforeAll(async () => {
  t = await TestApp.start();
});
afterAll(async () => t?.stop());

describe('authentication', () => {
  it('signs up a tenant and returns an access token plus an httpOnly refresh cookie', async () => {
    const email = `owner-${Date.now()}@example.ir`;
    const r = await t.req('POST', '/api/auth/signup', { body: { fullName: 'مالک', email, password: 'Passw0rd-strong', tenantName: 'شرکت الف' } });
    expect(r.status).toBe(201);
    expect(r.body.accessToken).toBeTruthy();
    expect(r.body.refreshToken).toBeUndefined();
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toMatch(/my_rt=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    const me = await t.req('GET', '/api/core/me', { token: r.body.accessToken });
    expect(me.status).toBe(200);
    expect(me.body.tenant.name).toBe('شرکت الف');
    expect(me.body.permissions).toContain('core.user.create');
  });

  it('rejects weak passwords and duplicate emails with Persian messages', async () => {
    const weak = await t.req('POST', '/api/auth/signup', { body: { fullName: 'x y', email: 'w@example.ir', password: 'short', tenantName: 'ab' } });
    expect(weak.status).toBe(400);
    expect(weak.body.message).toMatch(/رمز/);
    const a = await t.signup('dup');
    const dup = await t.req('POST', '/api/auth/signup', { body: { fullName: 'x y', email: a.email, password: 'Passw0rd-strong', tenantName: 'سازمان دیگر' } });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('EMAIL_TAKEN');
  });

  it('requires a token, and rejects console tokens on app routes and vice versa', async () => {
    expect((await t.req('GET', '/api/core/me')).status).toBe(401);
    const admin = await t.consoleAdmin();
    expect((await t.req('GET', '/api/core/me', { token: admin.token })).status).toBe(401);
    const user = await t.signup('aud');
    expect((await t.req('GET', '/api/console/modules', { token: user.token })).status).toBe(401);
    expect((await t.req('GET', '/api/console/modules', { token: admin.token })).status).toBe(200);
  });

  it('locks the account after 5 failed attempts', async () => {
    const u = await t.signup('lock');
    for (let i = 0; i < 5; i++) {
      const r = await t.req('POST', '/api/auth/login', { body: { email: u.email, password: 'wrong-password-1' } });
      expect(r.status).toBe(401);
    }
    const locked = await t.req('POST', '/api/auth/login', { body: { email: u.email, password: u.password } });
    expect(locked.status).toBe(403);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
  });

  it('rotates refresh tokens and revokes the family when a rotated token is reused', async () => {
    const u = await t.signup('rot');
    const login = await t.req('POST', '/api/auth/login', { body: { email: u.email, password: u.password } });
    const rt1 = /my_rt=([^;]+)/.exec(String(login.headers['set-cookie']))![1]!;
    const csrf = { 'x-requested-with': 'mohandesyar' };
    expect((await t.req('POST', '/api/auth/refresh', { headers: { cookie: `my_rt=${rt1}` } })).status).toBe(401); // missing CSRF header
    const r2 = await t.req('POST', '/api/auth/refresh', { headers: { cookie: `my_rt=${rt1}`, ...csrf } });
    expect(r2.status).toBe(200);
    const rt2 = /my_rt=([^;]+)/.exec(String(r2.headers['set-cookie']))![1]!;
    expect(rt2).not.toBe(rt1);
    // Reuse of rt1 → whole family revoked, including rt2 and its access token.
    expect((await t.req('POST', '/api/auth/refresh', { headers: { cookie: `my_rt=${rt1}`, ...csrf } })).status).toBe(401);
    expect((await t.req('POST', '/api/auth/refresh', { headers: { cookie: `my_rt=${rt2}`, ...csrf } })).status).toBe(401);
    await t.services.redis.flushdb();
    expect((await t.req('GET', '/api/core/me', { token: r2.body.accessToken })).status).toBe(401);
  });

  it('logs out of all devices', async () => {
    const u = await t.signup('all');
    const a = await t.req('POST', '/api/auth/login', { body: { email: u.email, password: u.password } });
    const b = await t.req('POST', '/api/auth/login', { body: { email: u.email, password: u.password } });
    expect((await t.req('POST', '/api/auth/logout-all', { token: a.body.accessToken })).status).toBe(200);
    await t.services.redis.flushdb();
    expect((await t.req('GET', '/api/core/me', { token: b.body.accessToken })).status).toBe(401);
  });

  it('supports optional TOTP for users', async () => {
    const u = await t.signup('otp');
    const start = await t.req('POST', '/api/auth/2fa/enroll/start', { token: u.token });
    expect(start.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect((await t.req('POST', '/api/auth/2fa/enroll/confirm', { token: u.token, body: { code: '000000' } })).status).toBe(401);
    expect((await t.req('POST', '/api/auth/2fa/enroll/confirm', { token: u.token, body: { code: totp(start.body.secret) } })).status).toBe(200);
    const login = await t.req('POST', '/api/auth/login', { body: { email: u.email, password: u.password } });
    expect(login.body.mfaRequired).toBe(true);
    expect(login.body.accessToken).toBeUndefined();
    const ok = await t.req('POST', '/api/auth/2fa', { body: { pendingToken: login.body.pendingToken, code: totp(start.body.secret) } });
    expect(ok.body.accessToken).toBeTruthy();
  });

  it('forces platform admins to enrol TOTP before any console session', async () => {
    await t.services.auth.createAdmin({ email: 'noenrol@platform.ir', fullName: 'x', password: 'Admin-Passw0rd', roles: ['support'] });
    const r = await t.req('POST', '/api/console/auth/login', { body: { email: 'noenrol@platform.ir', password: 'Admin-Passw0rd' } });
    expect(r.body.mfaEnrollmentRequired).toBe(true);
    expect(r.body.accessToken).toBeUndefined();
  });
});

describe('tenant isolation (API level)', () => {
  it('a tenant never sees or touches another tenant’s members, tasks, roles or audit', async () => {
    const a = await t.signup('iso-a');
    const b = await t.signup('iso-b');
    const task = await t.req('POST', '/api/core/tasks', { token: a.token, body: { title: 'وظیفه محرمانه الف' } });
    expect(task.status).toBe(201);
    const bTasks = await t.req('GET', '/api/core/tasks', { token: b.token });
    expect(bTasks.body.map((x: { title: string }) => x.title)).not.toContain('وظیفه محرمانه الف');
    // Direct attempt on A's task id with B's token.
    const patch = await t.req('PATCH', `/api/core/tasks/${task.body.id}`, { token: b.token, body: { status: 'done' } });
    expect(patch.status).toBe(404);
    const bMembers = await t.req('GET', '/api/core/members', { token: b.token });
    expect(bMembers.body).toHaveLength(1);
    const bAudit = await t.req('GET', '/api/core/audit', { token: b.token });
    expect(bAudit.body.every((e: { entity_id: string }) => e.entity_id !== task.body.id)).toBe(true);
    // Company header pointing at A's company is refused for B.
    const aMe = await t.req('GET', '/api/core/me', { token: a.token });
    const cross = await t.req('GET', '/api/core/tasks', { token: b.token, headers: { 'x-company-id': aMe.body.company.id } });
    expect(cross.status).toBe(403);
  });

  it('a non-admin member is limited by role', async () => {
    const a = await t.signup('rbac');
    const add = await t.req('POST', '/api/core/members', { token: a.token, body: { email: `emp-${Date.now()}@example.ir`, fullName: 'کارمند', initialPassword: 'Employee-pass1', roleKey: 'employee' } });
    expect(add.status).toBe(201);
    const login = await t.req('POST', '/api/auth/login', { body: { email: (await t.req('GET', '/api/core/members', { token: a.token })).body.find((m: { full_name: string }) => m.full_name === 'کارمند').email, password: 'Employee-pass1' } });
    const emp = login.body.accessToken as string;
    expect((await t.req('GET', '/api/core/members', { token: emp })).status).toBe(403);
    expect((await t.req('POST', '/api/core/tasks', { token: emp, body: { title: 'کار من' } })).status).toBe(201);
    const ownerTask = await t.req('POST', '/api/core/tasks', { token: a.token, body: { title: 'کار مدیر' } });
    const empTasks = await t.req('GET', '/api/core/tasks', { token: emp });
    expect(empTasks.body.map((x: { title: string }) => x.title)).toEqual(['کار من']);
    expect((await t.req('PATCH', `/api/core/tasks/${ownerTask.body.id}`, { token: emp, body: { status: 'done' } })).status).toBe(404);
  });
});
