import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSigningKey } from '@mohandesyar/module-package';
import { addDays, todayIso } from '@mohandesyar/persian';
import { multipart, TestApp } from '../helpers/app.js';
import { buildModule } from '../helpers/packages.js';

/**
 * documents (with projects): folders, categories and retention policies; project-scoped creation; version
 * approval through the core workflow by someone other than the uploader; immutable approved versions;
 * Persian full-text search; confidential and secret documents with access lists and a view/download log;
 * links; expiry reminders; retention and disposal; tenant isolation.
 */
let t: TestApp;
let a: { token: string; tenantId: string };
let b: { token: string; tenantId: string };
let dc: { token: string; userId: string };
let dc2: { token: string; userId: string };
let contrib: { token: string; userId: string };
let reader: { token: string; userId: string };
const api = (p: string) => `/api/m/documents/v1${p}`;
const papi = (p: string) => `/api/m/projects/v1/projects${p}`;
const today = todayIso();
let companyIds: string[] = [];
let p1 = '';
let p2 = '';
let folder = '';
let contracts = '';
let general = '';
let docId = '';
let confId = '';
const upload = async (token: string, name: string, body = 'سند') =>
  (await t.req('POST', '/api/core/files', { token, ...multipart(Buffer.from(`%PDF-1.4 ${body}`), name, 'file', { module: 'documents', confidentiality: 'confidential' }) })).body.id as string;
const drain = async () => {
  while ((await t.services.events.dispatchOnce()) > 0);
};
const asCompany = <T,>(q: ReturnType<typeof sql>) => t.services.db.tx({ tenantId: a.tenantId, companyIds }, (x) => x.execute(q)) as Promise<T>;
const ids = (r: { body: { id: string }[] }) => r.body.map((x) => x.id);

beforeAll(async () => {
  t = await TestApp.start();
  const admin = await t.consoleAdmin();
  const key = generateSigningKey();
  a = await t.signup('doc-a');
  b = await t.signup('doc-b');
  await t.installModules(admin, key.publicKeyPem, [await buildModule('projects', key), await buildModule('documents', key)], [a.tenantId, b.tenantId]);
  dc = await t.member(a.token, 'document_controller', 'dc');
  dc2 = await t.member(a.token, 'document_controller', 'dc2');
  contrib = await t.member(a.token, 'document_contributor', 'contrib');
  reader = await t.member(a.token, 'document_reader', 'reader');
  companyIds = (await t.req('GET', '/api/core/me', { token: a.token })).body.company.ids;
  p1 = (await t.req('POST', papi(''), { token: a.token, body: { code: 'P-1', title: 'پل بزرگراه', status: 'active' } })).body.id;
  p2 = (await t.req('POST', papi(''), { token: a.token, body: { code: 'P-2', title: 'پروژه دیگر', status: 'active' } })).body.id;
  await t.req('POST', papi(`/${p1}/members`), { token: a.token, body: { userId: contrib.userId, role: 'engineer' } });
}, 240_000);
afterAll(async () => t?.stop());

describe('documents', () => {
  it('sets up folders, categories and retention policies (administrators only)', async () => {
    expect((await t.req('POST', api('/folders'), { token: contrib.token, body: { name: 'فنی' } })).status).toBe(403);
    folder = (await t.req('POST', api('/folders'), { token: dc.token, body: { name: 'فنی' } })).body.id;
    expect((await t.req('POST', api('/folders'), { token: dc.token, body: { name: 'فنی' } })).body.code).toBe('DUPLICATE');
    const sub = (await t.req('POST', api('/folders'), { token: dc.token, body: { name: 'نقشه‌ها', parentId: folder } })).body.id;
    expect((await t.req('PUT', api(`/folders/${folder}`), { token: dc.token, body: { name: 'فنی', parentId: sub } })).body.code).toBe('FOLDER');
    const policy = (await t.req('POST', api('/retention-policies'), { token: dc.token, body: { name: 'یک‌ساله', years: 1 } })).body.id;
    contracts = (await t.req('POST', api('/categories'), { token: dc.token, body: { name: 'اسناد قراردادی', retentionPolicyId: policy } })).body.id;
    general = (await t.req('POST', api('/categories'), { token: dc.token, body: { name: 'عمومی', requiresApproval: false } })).body.id;
    expect((await t.req('GET', api('/categories'), { token: reader.token })).body).toHaveLength(2);
  });

  it('creates a document only inside the contributor\'s projects and sends version 1 for approval', async () => {
    const body = { code: 'DWG-001', title: 'نقشه سازه‌اي پل', description: 'نقشه‌هاي اجرايي عرشه', folderId: folder, categoryId: contracts, tags: ['سازه', 'عرشه'] };
    expect((await t.req('POST', api('/documents'), { token: contrib.token, body: { ...body, fileId: await upload(contrib.token, 'a.pdf') } })).status).toBe(403);
    expect((await t.req('POST', api('/documents'), { token: contrib.token, body: { ...body, fileId: await upload(contrib.token, 'a.pdf'), links: [{ type: 'project', id: p2 }] } })).status).toBe(403);
    const r = await t.req('POST', api('/documents'), { token: contrib.token, body: { ...body, fileId: await upload(contrib.token, 'deck-plan.pdf'), links: [{ type: 'project', id: p1 }] } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ version: 1, pending: true });
    docId = r.body.id;
    expect((await t.req('POST', api('/documents'), { token: dc.token, body: { ...body, fileId: await upload(dc.token, 'b.pdf') } })).body.code).toBe('DUPLICATE');
    // Readers see the draft record but not the unapproved file.
    const d = (await t.req('GET', api(`/documents/${docId}`), { token: reader.token })).body;
    expect(d).toMatchObject({ canEdit: false, versions: [] });
    expect(d.links[0]).toMatchObject({ entity_type: 'project', label: 'P-1 — پل بزرگراه' });
  });

  it('approves the version by another controller; approved versions are immutable', async () => {
    const vId = (await t.req('GET', api(`/documents/${docId}`), { token: contrib.token })).body.versions[0].id;
    const item = (await t.req('GET', '/api/core/approvals', { token: dc2.token })).body.find((x: { entity_id: string }) => x.entity_id === vId);
    expect((await t.req('POST', `/api/core/approvals/${item.id}/decide`, { token: dc2.token, body: { decision: 'approve' } })).status).toBe(200);
    await drain();
    const d = (await t.req('GET', api(`/documents/${docId}`), { token: reader.token })).body;
    expect(d.document).toMatchObject({ status: 'active', current_version: 1, retention_until: addDays(today, 365 + (isLeapAhead(today) ? 1 : 0)) });
    expect(d.versions[0]).toMatchObject({ status: 'approved', approvers: [dc2.userId] });
    expect((await t.req('GET', api(`/documents/${docId}/versions/${vId}/url`), { token: reader.token })).body.url).toMatch(/^http/);
    expect((await t.req('GET', '/api/core/notifications', { token: contrib.token })).body.items.some((n: { type: string }) => n.type === 'documents.version.decided')).toBe(true);
    await expect(asCompany(sql`UPDATE documents_versions SET file_name = 'x.pdf' WHERE id = ${vId}`)).rejects.toSatisfy((e: unknown) => String((e as { cause?: { message?: string } }).cause?.message).includes('immutable'));
    // Version 2: one pending at a time, withdrawable.
    const v2 = await t.req('POST', api(`/documents/${docId}/versions`), { token: contrib.token, body: { fileId: await upload(contrib.token, 'deck-plan-rev2.pdf'), note: 'اصلاح آرماتور' } });
    expect(v2.body).toMatchObject({ version: 2, pending: true });
    expect((await t.req('POST', api(`/documents/${docId}/versions`), { token: contrib.token, body: { fileId: await upload(contrib.token, 'c.pdf') } })).body.code).toBe('PENDING_VERSION');
    expect((await t.req('POST', api(`/documents/${docId}/versions`), { token: reader.token, body: { fileId: await upload(dc.token, 'd.pdf') } })).status).toBe(403);
    const v2Id = (await t.req('GET', api(`/documents/${docId}`), { token: contrib.token })).body.versions[0].id;
    expect((await t.req('DELETE', api(`/documents/${docId}/versions/${v2Id}`), { token: contrib.token })).status).toBe(200);
    expect((await t.req('GET', '/api/core/approvals', { token: dc2.token })).body.some((x: { entity_id: string }) => x.entity_id === v2Id)).toBe(false);
  });

  it('finds documents by normalised Persian text, tag and file name', async () => {
    // Stored with Arabic yeh («اي»), searched with Persian yeh.
    expect(ids(await t.req('GET', api(`/documents?q=${encodeURIComponent('نقشه‌های اجرایی')}`), { token: reader.token }))).toEqual([docId]);
    expect(ids(await t.req('GET', api(`/documents?tag=${encodeURIComponent('عرشه')}`), { token: reader.token }))).toEqual([docId]);
    expect(ids(await t.req('GET', api('/documents?q=deck-plan'), { token: reader.token }))).toEqual([docId]);
    expect(ids(await t.req('GET', api(`/documents?linkType=project&linkId=${p1}`), { token: reader.token }))).toEqual([docId]);
    expect((await t.req('GET', api('/documents?q=nothing-like-this'), { token: reader.token })).body).toEqual([]);
  });

  it('hides confidential documents outside the access list and logs every view and download', async () => {
    const r = await t.req('POST', api('/documents'), { token: dc.token, body: { code: 'HR-9', title: 'صورت‌جلسه محرمانه', categoryId: general, confidentiality: 'confidential', fileId: await upload(dc.token, 'm.pdf') } });
    expect(r.body).toMatchObject({ pending: false }); // category without approval
    confId = r.body.id;
    expect(ids(await t.req('GET', api('/documents'), { token: reader.token }))).not.toContain(confId);
    expect((await t.req('GET', api(`/documents/${confId}`), { token: reader.token })).status).toBe(404);
    expect((await t.req('GET', api(`/documents/${confId}`), { token: dc2.token })).status).toBe(200); // administrator
    expect((await t.req('PUT', api(`/documents/${confId}/access`), { token: reader.token, body: { users: [{ userId: reader.userId }] } })).status).toBe(404);
    expect((await t.req('PUT', api(`/documents/${confId}/access`), { token: dc.token, body: { users: [{ userId: reader.userId }] } })).status).toBe(200);
    const d = (await t.req('GET', api(`/documents/${confId}`), { token: reader.token })).body;
    expect(d.canEdit).toBe(false);
    expect((await t.req('GET', api(`/documents/${confId}/versions/${d.versions[0].id}/url`), { token: reader.token })).status).toBe(200);
    // Reader cannot lower the confidentiality; only the owner or an administrator.
    expect((await t.req('PUT', api(`/documents/${confId}`), { token: reader.token, body: { code: 'HR-9', title: 'صورت‌جلسه', confidentiality: 'internal' } })).status).toBe(403);
    const log = (await t.req('GET', api(`/documents/${confId}`), { token: dc.token })).body.log;
    expect(log.filter((l: { user_id: string }) => l.user_id === reader.userId).map((l: { action: string }) => l.action).sort()).toEqual(['download', 'view']);
    const audit = await t.services.db.tx({ tenantId: a.tenantId }, (x) => x.execute(sql`SELECT action FROM core_audit_log WHERE entity_id = ${confId} AND action = 'documents.document.download'`));
    expect(audit.rows).toHaveLength(1);
  });

  it('keeps secret documents from everyone but the owner and the access list', async () => {
    const r = await t.req('POST', api('/documents'), { token: contrib.token, body: { code: 'SEC-1', title: 'برآورد محرمانه مناقصه', confidentiality: 'secret', categoryId: general, links: [{ type: 'project', id: p1 }], fileId: await upload(contrib.token, 's.pdf') } });
    expect(r.status).toBe(201);
    expect((await t.req('GET', api(`/documents/${r.body.id}`), { token: dc.token })).status).toBe(404);
    expect(ids(await t.req('GET', api('/documents?q=SEC'), { token: dc.token }))).toEqual([]);
    expect((await t.req('GET', api(`/documents/${r.body.id}`), { token: contrib.token })).body.canManageAccess).toBe(true);
    const s = (await t.req('GET', '/api/core/search?q=SEC-1', { token: dc.token })).body;
    expect(JSON.stringify(s)).not.toContain(r.body.id);
  });

  it('validates links and reminds the owner before expiry, once', async () => {
    expect((await t.req('POST', api(`/documents/${docId}/links`), { token: contrib.token, body: { type: 'project', id: '00000000-0000-4000-8000-000000000000' } })).body.code).toBe('LINK');
    expect((await t.req('POST', api(`/documents/${docId}/links`), { token: contrib.token, body: { type: 'user', id: reader.userId } })).status).toBe(201);
    const exp = await t.req('POST', api('/documents'), { token: dc.token, body: { code: 'INS-1', title: 'بیمه‌نامه تجهیزات', categoryId: general, expiresOn: addDays(today, 10), remindDays: 30, fileId: await upload(dc.token, 'i.pdf') } });
    expect(ids(await t.req('GET', api('/documents?expiring=1'), { token: dc.token }))).toEqual([exp.body.id]);
    await t.services.scheduler.tick(Date.now());
    await t.services.scheduler.tick(Date.now() + 13 * 3600_000);
    const notes = (await t.req('GET', '/api/core/notifications', { token: dc.token })).body.items.filter((n: { type: string }) => n.type === 'documents.expiry');
    expect(notes).toHaveLength(1);
  });

  it('never deletes an approved document; disposes it only after retention, with a reason', async () => {
    expect((await t.req('DELETE', api(`/documents/${docId}`), { token: dc.token })).body.code).toBe('HAS_APPROVED');
    expect((await t.req('POST', api(`/documents/${docId}/dispose`), { token: dc.token, body: { reason: 'پایان نگهداری' } })).body.code).toBe('UNDER_RETENTION');
    // Back-date the approval two years and recompute through the category.
    await asCompany(sql`UPDATE documents_documents SET effective_on = ${addDays(today, -800)}::date WHERE id = ${docId}`);
    await t.req('PUT', api(`/categories/${contracts}`), { token: dc.token, body: { name: 'اسناد قراردادی', retentionPolicyId: (await t.req('GET', api('/retention-policies'), { token: dc.token })).body[0].id } });
    expect(ids(await t.req('GET', api('/retention-due'), { token: dc.token }))).toEqual([docId]);
    expect((await t.req('POST', api(`/documents/${docId}/dispose`), { token: dc.token, body: { reason: '' } })).status).toBe(400);
    expect((await t.req('POST', api(`/documents/${docId}/dispose`), { token: contrib.token, body: { reason: 'پایان نگهداری' } })).status).toBe(403);
    expect((await t.req('POST', api(`/documents/${docId}/dispose`), { token: dc.token, body: { reason: 'پایان دوره نگهداری طبق سیاست' } })).status).toBe(200);
    const d = (await t.req('GET', api(`/documents/${docId}`), { token: dc.token })).body;
    expect(d.document.status).toBe('disposed');
    expect((await t.req('GET', api(`/documents/${docId}/versions/${d.versions[0].id}/url`), { token: dc.token })).body.code).toBe('DISPOSED');
    expect(ids(await t.req('GET', api('/documents'), { token: dc.token }))).not.toContain(docId);
  });

  it('isolates tenants', async () => {
    expect((await t.req('GET', api('/documents'), { token: b.token })).body).toEqual([]);
    expect((await t.req('GET', api(`/documents/${confId}`), { token: b.token })).status).toBe(404);
  });
});

/** True when the coming year spans 29 February (retention of one year is then 366 days). */
function isLeapAhead(iso: string) {
  const y = Number(iso.slice(0, 4));
  const feb29 = (yr: number) => new Date(Date.UTC(yr, 1, 29)).getUTCMonth() === 1;
  return (feb29(y) && iso <= `${y}-02-29`) || (feb29(y + 1) && iso > `${y}-02-29`);
}
