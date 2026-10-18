import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningKey } from '@mohandesyar/module-package';
import { TestApp } from '../helpers/app.js';
import { buildModule } from '../helpers/packages.js';

/** Custom roles, per-member role assignment and the guards that keep an organisation from locking itself out. */
let t: TestApp;
let owner: { token: string; tenantId: string };
let staff: { token: string; userId: string };
let staffMembership = '';

beforeAll(async () => {
  t = await TestApp.start();
  const admin = await t.consoleAdmin();
  owner = await t.signup('roles');
  const key = generateSigningKey();
  await t.installModules(admin, key.publicKeyPem, [await buildModule('meetings', key)], [owner.tenantId]);
  staff = await t.member(owner.token, 'employee', 'staff');
  const members = (await t.req('GET', '/api/core/members', { token: owner.token })).body as { id: string; user_id: string }[];
  staffMembership = members.find((m) => m.user_id === staff.userId)!.id;
}, 180_000);
afterAll(async () => t?.stop());

const call = (token: string, method: string, url: string, body?: object) => t.req(method, url, { token, body });

describe('permission catalogue', () => {
  it('lists core permissions and those of the organisation’s active modules, in Persian', async () => {
    const cat = (await call(owner.token, 'GET', '/api/core/permissions')).body as { key: string; moduleId: string; moduleName: string; label: string }[];
    expect(cat.find((p) => p.key === 'core.user.create')).toMatchObject({ moduleId: 'core', label: 'افزودن کاربر' });
    expect(cat.some((p) => p.moduleId === 'meetings' && p.moduleName === 'جلسات و مصوبات')).toBe(true);
    expect((await call(staff.token, 'GET', '/api/core/permissions')).status).toBe(403);
  });
});

describe('roles', () => {
  let key = '';
  it('an administrator creates a role with chosen permissions and gives it to an employee, who gains exactly those', async () => {
    const meetingsView = ((await call(owner.token, 'GET', '/api/core/permissions')).body as { key: string; moduleId: string }[]).filter((p) => p.moduleId === 'meetings').map((p) => p.key);
    expect((await call(staff.token, 'GET', '/api/m/meetings/v1/meetings')).status).toBe(403);
    const r = await call(owner.token, 'POST', '/api/core/roles', { name: 'دبیر جلسات', grants: meetingsView.map((permission) => ({ permission, scope: 'company' })) });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    key = r.body.key;
    expect(key).toMatch(/^custom_/);
    const set = await call(owner.token, 'PUT', `/api/core/members/${staffMembership}/roles`, { roles: [{ roleKey: 'employee' }, { roleKey: key }] });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect((await call(staff.token, 'GET', '/api/m/meetings/v1/meetings')).status).toBe(200);
    const me = (await call(staff.token, 'GET', '/api/core/me')).body;
    expect(me.modules.map((m: { id: string }) => m.id)).toContain('meetings');
    // Changing the role takes effect on the next request.
    await call(owner.token, 'PUT', `/api/core/roles/${key}`, { name: 'دبیر جلسات', grants: [] });
    expect((await call(staff.token, 'GET', '/api/m/meetings/v1/meetings')).status).toBe(403);
  });

  it('employees cannot manage roles or members', async () => {
    expect((await call(staff.token, 'POST', '/api/core/roles', { name: 'نقش من', grants: [{ permission: '*' }] })).status).toBe(403);
    expect((await call(staff.token, 'PUT', `/api/core/members/${staffMembership}/roles`, { roles: [{ roleKey: 'company_admin' }] })).status).toBe(403);
  });

  it('the administrator role is locked, built-in roles are not deleted, and a held role is not deleted', async () => {
    expect((await call(owner.token, 'PUT', '/api/core/roles/company_admin', { name: 'مدیر', grants: [] })).body.code).toBe('ROLE_LOCKED');
    expect((await call(owner.token, 'POST', '/api/core/roles/employee/delete')).body.code).toBe('ROLE_BUILT_IN');
    expect((await call(owner.token, 'POST', `/api/core/roles/${key}/delete`)).body.code).toBe('ROLE_IN_USE');
    await call(owner.token, 'PUT', `/api/core/members/${staffMembership}/roles`, { roles: [{ roleKey: 'employee' }] });
    expect((await call(owner.token, 'POST', `/api/core/roles/${key}/delete`)).status).toBe(200);
  });

  it('the organisation always keeps an active administrator', async () => {
    const members = (await call(owner.token, 'GET', '/api/core/members')).body as { id: string; user_id: string }[];
    const ownerMembership = members.find((m) => m.id !== staffMembership)!.id;
    expect((await call(owner.token, 'PUT', `/api/core/members/${ownerMembership}/roles`, { roles: [{ roleKey: 'employee' }] })).body.code).toBe('LAST_ADMIN');
    expect((await call(owner.token, 'POST', `/api/core/members/${ownerMembership}/status`, { status: 'disabled' })).body.code).toBe('SELF_DISABLE');
  });

  it('a disabled employee loses access immediately and regains it when enabled', async () => {
    expect((await call(owner.token, 'POST', `/api/core/members/${staffMembership}/status`, { status: 'disabled' })).status).toBe(200);
    expect((await call(staff.token, 'GET', '/api/core/me')).status).toBe(403);
    await call(owner.token, 'POST', `/api/core/members/${staffMembership}/status`, { status: 'active' });
    expect((await call(staff.token, 'GET', '/api/core/me')).status).toBe(200);
  });
});
