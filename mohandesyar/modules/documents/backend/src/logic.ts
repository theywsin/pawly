import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, ModuleEventContext, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { addDays, normalizePersian } from '@mohandesyar/persian';
import { addYears } from './calc.js';
import { conflict, forbidden, invalid, notFound } from './errors.js';
import type { accessInput, categoryInput, disposeInput, documentInput, documentQuery, documentUpdate, folderInput, linkInput, policyInput, versionInput } from './inputs.js';

type Row = Record<string, unknown>;
const rows = async <T = Row>(tx: Db, q: SQL) => (await tx.execute(q)).rows as T[];
const one = async <T = Row>(tx: Db, q: SQL) => (await rows<T>(tx, q))[0];
const uuids = (ids: readonly string[]) => sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `);
const SENSITIVE = new Set(['confidential', 'secret']);

type Projects = { memberOf(u: string): Promise<string[]>; get(id: string): Promise<{ id: string; code: string; title: string } | null>; search(q: string, l: number): Promise<{ id: string; code: string; title: string }[]> };
type Contracts = { get?(id: string): Promise<{ id: string; code: string; title: string } | null>; search?(q: string, l: number): Promise<{ id: string; code: string; title: string }[]> };
type Ledger = { searchPayments?(q: string, l: number): Promise<{ id: string; number: number; description: string; amount: string }[]>; getPayment?(id: string): Promise<{ id: string; number: number; description: string } | null> };
const projectsOf = (ctx: { services: ModuleRequestContext['services'] }) => ctx.services.get<Projects>('projects.projects', '^1');
const contractsOf = (ctx: { services: ModuleRequestContext['services'] }) => ctx.services.get<Contracts>('contracts.contracts', '^1');
const ledgerOf = (ctx: { services: ModuleRequestContext['services'] }) => ctx.services.get<Ledger>('finance.ledger', '^1');

/** Text indexed for search: Persian-normalised code, title, description, tags and file names. */
const searchText = (parts: (string | null | undefined)[]) => normalizePersian(parts.filter(Boolean).join(' ')).toLowerCase();

// ---------------------------------------------------------------- access

/**
 * Who may see a document (one rule used by list, detail, search and widgets):
 * - the owner, and users on its access list, always;
 * - confidential: also documents.admin;
 * - internal: anyone with documents.view in scope (company: all; project: linked to one of the user's
 *   projects or created by them; own: created by them);
 * - secret: only the owner and the access list.
 */
interface Viewer {
  userId: string;
  admin: boolean;
  view: 'company' | 'project' | 'own' | null;
  manage: 'company' | 'project' | null;
  projects: string[];
}

async function viewer(ctx: ModuleRequestContext): Promise<Viewer> {
  const view = ctx.can('documents.view', 'company') ? 'company' : ctx.can('documents.view', 'project') ? 'project' : ctx.can('documents.view', 'own') ? 'own' : null;
  const manage = ctx.can('documents.manage', 'company') ? 'company' : ctx.can('documents.manage', 'project') ? 'project' : null;
  const projects = view === 'project' || manage === 'project' ? ((await projectsOf(ctx)?.memberOf(ctx.userId)) ?? []) : [];
  return { userId: ctx.userId, admin: ctx.can('documents.admin', 'company'), view, manage, projects };
}

const linkedTo = (projects: string[]) =>
  projects.length ? sql`EXISTS (SELECT 1 FROM documents_links l WHERE l.document_id = d.id AND l.entity_type = 'project' AND l.entity_id IN (${uuids(projects)}))` : sql`FALSE`;

function visibleSql(v: Viewer): SQL {
  const scope = v.view === 'company' ? sql`TRUE` : v.view === 'project' ? sql`(${linkedTo(v.projects)} OR d.created_by = ${v.userId})` : v.view === 'own' ? sql`d.created_by = ${v.userId}` : sql`FALSE`;
  return sql`(d.owner_id = ${v.userId}
    OR EXISTS (SELECT 1 FROM documents_access a WHERE a.document_id = d.id AND a.principal = ${v.userId})
    OR (d.confidentiality = 'confidential' AND ${v.admin})
    OR (d.confidentiality = 'internal' AND ${scope}))`;
}

interface DocRow {
  id: string;
  company_id: string;
  code: string;
  title: string;
  confidentiality: string;
  status: string;
  owner_id: string;
  created_by: string;
  current_version: number | null;
  category_id: string | null;
  retention_until: string | null;
  effective_on: string | null;
}

/** Loads a visible document with the caller's edit right; invisible documents are "not found". */
async function load(ctx: ModuleRequestContext, tx: Db, v: Viewer, id: string, lock = false) {
  const d = await one<DocRow>(
    tx,
    sql`SELECT d.id, d.company_id, d.code, d.title, d.confidentiality, d.status, d.owner_id, d.created_by, d.current_version, d.category_id, d.retention_until::text, d.effective_on::text
      FROM documents_documents d WHERE d.id = ${id} AND ${visibleSql(v)} ${lock ? sql`FOR UPDATE` : sql``}`,
  );
  if (!d) throw notFound('سند');
  const acl = await one<{ can_edit: boolean }>(tx, sql`SELECT can_edit FROM documents_access WHERE document_id = ${id} AND principal = ${v.userId}`);
  const linked = v.manage === 'project' ? !!(await one(tx, sql`SELECT 1 FROM documents_documents d WHERE d.id = ${id} AND ${linkedTo(v.projects)}`)) : false;
  const canEdit =
    d.status !== 'disposed' &&
    v.manage !== null &&
    (d.owner_id === v.userId ||
      !!acl?.can_edit ||
      (d.confidentiality === 'confidential' && v.admin) ||
      (d.confidentiality === 'internal' && (v.manage === 'company' || linked || d.created_by === v.userId)));
  return { doc: d, canEdit, canManageAccess: d.status !== 'disposed' && (d.owner_id === v.userId || (v.admin && d.confidentiality !== 'secret')) };
}

async function logAccess(ctx: ModuleRequestContext, tx: Db, d: DocRow, action: 'view' | 'download', version: number | null) {
  if (!SENSITIVE.has(d.confidentiality)) return;
  await tx.execute(sql`INSERT INTO documents_access_log (id, tenant_id, company_id, document_id, version, action, user_id) VALUES (${randomUUID()}, ${ctx.tenantId}, ${d.company_id}, ${d.id}, ${version}, ${action}, ${ctx.userId})`);
  await ctx.audit({ action: `documents.document.${action}`, entityType: 'document', entityId: d.id, after: { code: d.code, confidentiality: d.confidentiality, version } }, tx);
}

// ---------------------------------------------------------------- links

async function checkLink(ctx: ModuleRequestContext, type: string, id: string): Promise<string> {
  if (type === 'project') {
    const svc = projectsOf(ctx);
    const p = svc ? await svc.get(id) : null;
    if (!p) throw invalid('LINK', 'پروژه یافت نشد یا ماژول پروژه فعال نیست');
    return `${p.code} — ${p.title}`;
  }
  if (type === 'contract') {
    const svc = contractsOf(ctx);
    const c = svc?.get ? await svc.get(id) : null;
    if (!c) throw invalid('LINK', 'قرارداد یافت نشد یا ماژول قراردادها فعال نیست');
    return `${c.code} — ${c.title}`;
  }
  if (type === 'payment') {
    const svc = ledgerOf(ctx);
    const p = svc?.getPayment ? await svc.getPayment(id) : null;
    if (!p) throw invalid('LINK', 'درخواست پرداخت یافت نشد یا ماژول مالی فعال نیست');
    return `پرداخت ${p.number.toLocaleString('fa-IR')} — ${p.description}`;
  }
  const u = (await ctx.directory([id]))[0];
  if (!u) throw invalid('LINK', 'کاربر یافت نشد');
  return u.fullName;
}

/** In project scope a new document must be linked to at least one of the user's projects. */
function assertProjectLinks(v: Viewer, links: { type: string; id: string }[]) {
  if (v.manage === 'company') return;
  if (v.manage === null) throw forbidden('دسترسی ثبت سند ندارید');
  if (!links.some((l) => l.type === 'project' && v.projects.includes(l.id))) throw forbidden('سند را به یکی از پروژه‌هایی که عضو آن هستید متصل کنید');
}

// ---------------------------------------------------------------- documents

async function categoryRule(tx: Db, categoryId: string | null) {
  if (!categoryId) return { requiresApproval: true, years: null as number | null };
  const c = await one<{ requires_approval: boolean; years: number | null; archived: boolean }>(
    tx,
    sql`SELECT c.requires_approval, c.archived, p.years FROM documents_categories c LEFT JOIN documents_retention_policies p ON p.id = c.retention_policy_id WHERE c.id = ${categoryId}`,
  );
  if (!c) throw invalid('CATEGORY', 'دسته معتبر نیست');
  return { requiresApproval: c.requires_approval, years: c.years, archived: c.archived };
}
const retention = (effectiveOn: string | null, years: number | null) => (effectiveOn && years ? addYears(effectiveOn, years) : null);

async function checkFolder(tx: Db, folderId: string | null) {
  if (folderId && !(await one(tx, sql`SELECT 1 FROM documents_folders WHERE id = ${folderId}`))) throw invalid('FOLDER', 'پوشه معتبر نیست');
}

/** Adds a version; approval through the workflow unless the category waives it. Returns the new version number. */
async function addVersion(ctx: ModuleRequestContext, tx: Db, d: { id: string; company_id: string; code: string; title: string; category_id: string | null; effective_on: string | null }, fileId: string, note: string, today: string) {
  if (await one(tx, sql`SELECT 1 FROM documents_versions WHERE document_id = ${d.id} AND status = 'pending'`)) throw conflict('PENDING_VERSION', 'یک نسخه در انتظار تأیید است؛ ابتدا تکلیف آن روشن شود');
  const f = await ctx.files.claim(fileId, { type: 'document', id: d.id }, tx);
  const n = (await one<{ n: number }>(tx, sql`SELECT coalesce(max(version), 0)::int + 1 AS n FROM documents_versions WHERE document_id = ${d.id}`))!.n;
  const vid = randomUUID();
  const rule = await categoryRule(tx, d.category_id);
  await tx.execute(sql`INSERT INTO documents_versions (id, tenant_id, company_id, document_id, version, file_id, file_name, file_size, mime, note, status, created_by)
    VALUES (${vid}, ${ctx.tenantId}, ${d.company_id}, ${d.id}, ${n}, ${f.id}, ${f.name}, ${f.size}, ${f.mime}, ${note}, 'pending', ${ctx.userId})`);
  if (rule.requiresApproval) {
    const wf = await ctx.startWorkflow({ key: 'documents.version', entityType: 'document_version', entityId: vid, title: `تأیید سند ${d.code} نسخه ${n.toLocaleString('fa-IR')}: ${d.title}` }, tx);
    await tx.execute(sql`UPDATE documents_versions SET workflow_instance_id = ${wf.instanceId} WHERE id = ${vid}`);
  } else {
    await approveVersion(tx, d.id, vid, n, [], today, rule.years, d.effective_on);
  }
  await tx.execute(sql`UPDATE documents_documents SET search_text = search_text || ' ' || ${searchText([f.name])} WHERE id = ${d.id}`);
  await ctx.audit({ action: 'documents.version.added', entityType: 'document', entityId: d.id, after: { version: n, file: f.name, approval: rule.requiresApproval } }, tx);
  return { version: n, pending: rule.requiresApproval };
}

async function approveVersion(tx: Db, docId: string, versionId: string, n: number, deciders: string[], today: string, years: number | null, effectiveOn: string | null) {
  await tx.execute(sql`UPDATE documents_versions SET status = 'superseded' WHERE document_id = ${docId} AND status = 'approved'`);
  await tx.execute(sql`UPDATE documents_versions SET status = 'approved', approvers = ${`{${deciders.join(',')}}`}::uuid[], decided_at = now() WHERE id = ${versionId}`);
  const eff = effectiveOn ?? today;
  await tx.execute(sql`UPDATE documents_documents SET current_version = ${n}, status = CASE WHEN status = 'draft' THEN 'active' ELSE status END, effective_on = ${eff}, retention_until = ${retention(eff, years)}
    WHERE id = ${docId}`);
}

export const Documents = {
  async list(ctx: ModuleRequestContext, f: z.infer<typeof documentQuery>, today: string) {
    const v = await viewer(ctx);
    const q = f.q ? normalizePersian(f.q).toLowerCase() : null;
    const like = q ? `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null;
    return ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT d.id, d.code, d.title, d.folder_id, d.category_id, c.name AS category_name, d.tags, d.confidentiality, d.status, d.owner_id, d.current_version,
          d.expires_on::text, d.retention_until::text, d.created_at,
          (d.expires_on IS NOT NULL AND d.expires_on < ${today}::date) AS expired,
          (d.expires_on IS NOT NULL AND d.expires_on >= ${today}::date AND d.expires_on - d.remind_days <= ${today}::date) AS expiring,
          EXISTS (SELECT 1 FROM documents_versions x WHERE x.document_id = d.id AND x.status = 'pending') AS has_pending,
          coalesce((SELECT json_agg(json_build_object('type', l.entity_type, 'id', l.entity_id, 'label', l.label)) FROM documents_links l WHERE l.document_id = d.id), '[]') AS links
        FROM documents_documents d LEFT JOIN documents_categories c ON c.id = d.category_id
        WHERE ${visibleSql(v)}
          ${like ? sql`AND (to_tsvector('simple', d.search_text) @@ plainto_tsquery('simple', ${q}) OR d.search_text ILIKE ${like})` : sql``}
          ${f.folderId ? sql`AND d.folder_id = ${f.folderId}` : sql``}
          ${f.categoryId ? sql`AND d.category_id = ${f.categoryId}` : sql``}
          ${f.tag ? sql`AND ${f.tag} = ANY (d.tags)` : sql``}
          ${f.status ? sql`AND d.status = ${f.status}` : sql`AND d.status <> 'disposed'`}
          ${f.confidentiality ? sql`AND d.confidentiality = ${f.confidentiality}` : sql``}
          ${f.expiring ? sql`AND d.status = 'active' AND d.expires_on IS NOT NULL AND d.expires_on - d.remind_days <= ${today}::date` : sql``}
          ${f.linkType && f.linkId ? sql`AND EXISTS (SELECT 1 FROM documents_links l WHERE l.document_id = d.id AND l.entity_type = ${f.linkType} AND l.entity_id = ${f.linkId})` : sql``}
        ORDER BY d.created_at DESC LIMIT 500`),
    );
  },

  async get(ctx: ModuleRequestContext, id: string, today: string) {
    const v = await viewer(ctx);
    return ctx.db.transaction(async (tx) => {
      const { doc, canEdit, canManageAccess } = await load(ctx, tx, v, id);
      await logAccess(ctx, tx, doc, 'view', doc.current_version);
      const d = await one(tx, sql`SELECT d.*, d.expires_on::text, d.retention_until::text, d.effective_on::text, d.reminded_for::text, c.name AS category_name, fo.name AS folder_name,
          (d.expires_on IS NOT NULL AND d.expires_on < ${today}::date) AS expired
        FROM documents_documents d LEFT JOIN documents_categories c ON c.id = d.category_id LEFT JOIN documents_folders fo ON fo.id = d.folder_id WHERE d.id = ${id}`);
      delete (d as Row).search_text;
      const versions = await rows<{ status: string }>(tx, sql`SELECT id, version, file_name, file_size, mime, note, status, approvers, created_by, created_at, decided_at, (file_id IS NOT NULL) AS has_file
        FROM documents_versions WHERE document_id = ${id} ORDER BY version DESC`);
      const links = await rows(tx, sql`SELECT id, entity_type, entity_id, label FROM documents_links WHERE document_id = ${id} ORDER BY created_at`);
      const access = canManageAccess || canEdit ? await rows(tx, sql`SELECT principal AS user_id, can_edit FROM documents_access WHERE document_id = ${id} ORDER BY principal`) : [];
      const log =
        SENSITIVE.has(doc.confidentiality) && (doc.owner_id === ctx.userId || (v.admin && doc.confidentiality !== 'secret'))
          ? await rows(tx, sql`SELECT action, version, user_id, at FROM documents_access_log WHERE document_id = ${id} ORDER BY at DESC LIMIT 200`)
          : null;
      return {
        document: d,
        versions: canEdit ? versions : versions.filter((x) => x.status === 'approved' || x.status === 'superseded'),
        links,
        access,
        log,
        canEdit,
        canManageAccess,
        canDispose: v.admin && doc.status !== 'disposed' && doc.confidentiality !== 'secret' && !!doc.retention_until && doc.retention_until <= today,
        underRetention: !!doc.retention_until && doc.retention_until > today,
      };
    });
  },

  async create(ctx: ModuleRequestContext, input: z.infer<typeof documentInput>, today: string) {
    const v = await viewer(ctx);
    assertProjectLinks(v, input.links);
    const labels = await Promise.all(input.links.map((l) => checkLink(ctx, l.type, l.id)));
    return ctx.db.transaction(async (tx) => {
      await checkFolder(tx, input.folderId);
      const rule = await categoryRule(tx, input.categoryId);
      if (rule.archived) throw invalid('CATEGORY', 'این دسته بایگانی شده است');
      if (await one(tx, sql`SELECT 1 FROM documents_documents WHERE company_id = ${ctx.companyId} AND code = ${input.code}`)) throw conflict('DUPLICATE', 'این شماره سند قبلاً ثبت شده است');
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO documents_documents (id, tenant_id, company_id, code, title, description, folder_id, category_id, tags, confidentiality, owner_id, expires_on, remind_days, search_text, created_by)
        VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.code}, ${input.title}, ${input.description}, ${input.folderId}, ${input.categoryId}, ${`{${input.tags.map((t) => JSON.stringify(t)).join(',')}}`}::text[],
          ${input.confidentiality}, ${ctx.userId}, ${input.expiresOn}, ${input.remindDays}, ${searchText([input.code, input.title, input.description, ...input.tags])}, ${ctx.userId})`);
      for (const [i, l] of input.links.entries()) {
        await tx.execute(sql`INSERT INTO documents_links (id, tenant_id, company_id, document_id, entity_type, entity_id, label, created_by)
          VALUES (${randomUUID()}, ${ctx.tenantId}, ${ctx.companyId}, ${id}, ${l.type}, ${l.id}, ${labels[i]!}, ${ctx.userId}) ON CONFLICT DO NOTHING`);
      }
      await ctx.audit({ action: 'documents.document.created', entityType: 'document', entityId: id, after: { code: input.code, confidentiality: input.confidentiality } }, tx);
      const r = await addVersion(ctx, tx, { id, company_id: ctx.companyId, code: input.code, title: input.title, category_id: input.categoryId, effective_on: null }, input.fileId, input.note, today);
      return { id, ...r };
    });
  },

  async update(ctx: ModuleRequestContext, id: string, input: z.infer<typeof documentUpdate>) {
    const v = await viewer(ctx);
    return ctx.db.transaction(async (tx) => {
      const { doc, canEdit, canManageAccess } = await load(ctx, tx, v, id, true);
      if (!canEdit) throw forbidden('اجازه ویرایش این سند را ندارید');
      // Raising or lowering confidentiality changes who sees it: only the owner or an administrator.
      if (input.confidentiality !== doc.confidentiality && !canManageAccess) throw forbidden('تغییر سطح محرمانگی فقط با مالک سند یا مدیر اسناد است');
      if (input.code !== doc.code && (await one(tx, sql`SELECT 1 FROM documents_documents WHERE company_id = ${doc.company_id} AND code = ${input.code} AND id <> ${id}`))) throw conflict('DUPLICATE', 'این شماره سند قبلاً ثبت شده است');
      await checkFolder(tx, input.folderId);
      const rule = await categoryRule(tx, input.categoryId);
      const files = await rows<{ file_name: string }>(tx, sql`SELECT file_name FROM documents_versions WHERE document_id = ${id}`);
      await tx.execute(sql`UPDATE documents_documents SET code = ${input.code}, title = ${input.title}, description = ${input.description}, folder_id = ${input.folderId}, category_id = ${input.categoryId},
          tags = ${`{${input.tags.map((t) => JSON.stringify(t)).join(',')}}`}::text[], confidentiality = ${input.confidentiality}, expires_on = ${input.expiresOn}, remind_days = ${input.remindDays},
          reminded_for = CASE WHEN expires_on IS DISTINCT FROM ${input.expiresOn}::date THEN NULL ELSE reminded_for END,
          retention_until = ${retention(doc.effective_on, rule.years)}, retention_notified = CASE WHEN category_id IS DISTINCT FROM ${input.categoryId}::uuid THEN false ELSE retention_notified END,
          search_text = ${searchText([input.code, input.title, input.description, ...input.tags, ...files.map((x) => x.file_name)])}
        WHERE id = ${id}`);
      await ctx.audit({ action: 'documents.document.updated', entityType: 'document', entityId: id, before: { code: doc.code, confidentiality: doc.confidentiality }, after: { code: input.code, confidentiality: input.confidentiality } }, tx);
    });
  },

  async addVersion(ctx: ModuleRequestContext, id: string, input: z.infer<typeof versionInput>, today: string) {
    const v = await viewer(ctx);
    return ctx.db.transaction(async (tx) => {
      const { doc, canEdit } = await load(ctx, tx, v, id, true);
      if (!canEdit) throw forbidden('اجازه افزودن نسخه به این سند را ندارید');
      if (doc.status === 'obsolete') throw conflict('OBSOLETE', 'سند منسوخ شده است');
      return addVersion(ctx, tx, doc, input.fileId, input.note, today);
    });
  },

  /** Withdraws a pending version (its creator or an editor); the uploaded file is erased. */
  async withdrawVersion(ctx: ModuleRequestContext, id: string, versionId: string) {
    const v = await viewer(ctx);
    const fileId = await ctx.db.transaction(async (tx) => {
      const { canEdit } = await load(ctx, tx, v, id, true);
      const x = await one<{ status: string; created_by: string; file_id: string | null; workflow_instance_id: string | null; version: number }>(
        tx,
        sql`SELECT status, created_by, file_id, workflow_instance_id, version FROM documents_versions WHERE id = ${versionId} AND document_id = ${id} FOR UPDATE`,
      );
      if (!x) throw notFound('نسخه');
      if (!canEdit && x.created_by !== ctx.userId) throw forbidden('اجازه این کار را ندارید');
      if (x.status !== 'pending') throw conflict('DECIDED', 'فقط نسخه در انتظار تأیید پس گرفته می‌شود');
      if (x.workflow_instance_id) await ctx.cancelWorkflow(x.workflow_instance_id, tx);
      await tx.execute(sql`DELETE FROM documents_versions WHERE id = ${versionId}`);
      await ctx.audit({ action: 'documents.version.withdrawn', entityType: 'document', entityId: id, after: { version: x.version } }, tx);
      return x.file_id;
    });
    if (fileId) await ctx.files.remove(fileId);
  },

  /** Download link: approved versions for viewers; pending/rejected ones only for editors. Sensitive downloads are logged. */
  async versionUrl(ctx: ModuleRequestContext, id: string, versionId: string) {
    const v = await viewer(ctx);
    const fileId = await ctx.db.transaction(async (tx) => {
      const { doc, canEdit } = await load(ctx, tx, v, id);
      const x = await one<{ status: string; file_id: string | null; version: number }>(tx, sql`SELECT status, file_id, version FROM documents_versions WHERE id = ${versionId} AND document_id = ${id}`);
      if (!x || (!canEdit && x.status !== 'approved' && x.status !== 'superseded')) throw notFound('نسخه');
      if (!x.file_id) throw conflict('DISPOSED', 'فایل این نسخه امحا شده است');
      await logAccess(ctx, tx, doc, 'download', x.version);
      return x.file_id;
    });
    return ctx.files.url(fileId);
  },

  async addLink(ctx: ModuleRequestContext, id: string, input: z.infer<typeof linkInput>) {
    const v = await viewer(ctx);
    const label = await checkLink(ctx, input.type, input.id);
    return ctx.db.transaction(async (tx) => {
      const { doc, canEdit } = await load(ctx, tx, v, id);
      if (!canEdit) throw forbidden('اجازه ویرایش این سند را ندارید');
      const lid = randomUUID();
      const r = await rows(tx, sql`INSERT INTO documents_links (id, tenant_id, company_id, document_id, entity_type, entity_id, label, created_by)
        VALUES (${lid}, ${ctx.tenantId}, ${doc.company_id}, ${id}, ${input.type}, ${input.id}, ${input.label || label}, ${ctx.userId}) ON CONFLICT DO NOTHING RETURNING id`);
      if (!r.length) throw conflict('DUPLICATE', 'این اتصال وجود دارد');
      await ctx.audit({ action: 'documents.link.added', entityType: 'document', entityId: id, after: { type: input.type, id: input.id } }, tx);
      return { id: lid };
    });
  },

  async removeLink(ctx: ModuleRequestContext, id: string, linkId: string) {
    const v = await viewer(ctx);
    await ctx.db.transaction(async (tx) => {
      const { canEdit } = await load(ctx, tx, v, id);
      if (!canEdit) throw forbidden('اجازه ویرایش این سند را ندارید');
      const l = await one<{ entity_type: string; entity_id: string }>(tx, sql`DELETE FROM documents_links WHERE id = ${linkId} AND document_id = ${id} RETURNING entity_type, entity_id`);
      if (!l) throw notFound('اتصال');
      // A project-scoped editor may not cut the document loose from all of their projects.
      if (v.manage === 'project' && !(await one(tx, sql`SELECT 1 FROM documents_documents d WHERE d.id = ${id} AND (${linkedTo(v.projects)} OR d.owner_id = ${ctx.userId})`))) {
        throw forbidden('سند باید به دست‌کم یکی از پروژه‌های شما متصل بماند');
      }
      await ctx.audit({ action: 'documents.link.removed', entityType: 'document', entityId: id, after: l }, tx);
    });
  },

  async setAccess(ctx: ModuleRequestContext, id: string, input: z.infer<typeof accessInput>) {
    const v = await viewer(ctx);
    const known = new Set((await ctx.directory(input.users.map((u) => u.userId))).map((u) => u.id));
    if (input.users.some((u) => !known.has(u.userId))) throw invalid('USER', 'کاربر معتبر نیست');
    await ctx.db.transaction(async (tx) => {
      const { doc, canManageAccess } = await load(ctx, tx, v, id, true);
      if (!canManageAccess) throw forbidden('فقط مالک سند یا مدیر اسناد دسترسی را تعیین می‌کند');
      const before = await rows(tx, sql`SELECT principal, can_edit FROM documents_access WHERE document_id = ${id}`);
      await tx.execute(sql`DELETE FROM documents_access WHERE document_id = ${id}`);
      for (const u of input.users) {
        await tx.execute(sql`INSERT INTO documents_access (id, tenant_id, company_id, document_id, principal, can_edit) VALUES (${randomUUID()}, ${ctx.tenantId}, ${doc.company_id}, ${id}, ${u.userId}, ${u.canEdit}) ON CONFLICT DO NOTHING`);
      }
      await ctx.audit({ action: 'documents.access.changed', entityType: 'document', entityId: id, before: { users: before }, after: { users: input.users } }, tx);
    });
  },

  async obsolete(ctx: ModuleRequestContext, id: string) {
    const v = await viewer(ctx);
    await ctx.db.transaction(async (tx) => {
      const { doc, canEdit } = await load(ctx, tx, v, id, true);
      if (!canEdit) throw forbidden('اجازه ویرایش این سند را ندارید');
      if (doc.status !== 'active') throw conflict('NOT_ACTIVE', 'فقط سند معتبر منسوخ می‌شود');
      await tx.execute(sql`UPDATE documents_documents SET status = 'obsolete' WHERE id = ${id}`);
      await ctx.audit({ action: 'documents.document.obsoleted', entityType: 'document', entityId: id }, tx);
    });
  },

  /** A document that never had an approved version can be deleted; anything approved is kept (obsolete / dispose). */
  async remove(ctx: ModuleRequestContext, id: string) {
    const v = await viewer(ctx);
    const files = await ctx.db.transaction(async (tx) => {
      const { doc, canEdit } = await load(ctx, tx, v, id, true);
      if (!canEdit || (doc.owner_id !== ctx.userId && !v.admin)) throw forbidden('فقط مالک سند یا مدیر اسناد');
      if (doc.status !== 'draft') throw conflict('HAS_APPROVED', 'سند دارای نسخه تأییدشده حذف نمی‌شود؛ آن را منسوخ کنید یا پس از پایان دوره نگهداری امحا کنید');
      const vs = await rows<{ file_id: string | null; workflow_instance_id: string | null; status: string }>(tx, sql`SELECT file_id, workflow_instance_id, status FROM documents_versions WHERE document_id = ${id}`);
      for (const x of vs) if (x.status === 'pending' && x.workflow_instance_id) await ctx.cancelWorkflow(x.workflow_instance_id, tx);
      await tx.execute(sql`DELETE FROM documents_documents WHERE id = ${id}`);
      await ctx.audit({ action: 'documents.document.deleted', entityType: 'document', entityId: id, before: { code: doc.code } }, tx);
      return vs.map((x) => x.file_id).filter((x): x is string => !!x);
    });
    for (const f of files) await ctx.files.remove(f);
  },

  /**
   * Disposal after the retention period (administrator, written reason): files of every version are erased,
   * the record, versions metadata and access log remain as evidence.
   */
  async dispose(ctx: ModuleRequestContext, id: string, input: z.infer<typeof disposeInput>, today: string) {
    const v = await viewer(ctx);
    if (!v.admin) throw forbidden('امحا فقط با مدیر اسناد است');
    const files = await ctx.db.transaction(async (tx) => {
      const { doc } = await load(ctx, tx, v, id, true);
      if (doc.status === 'disposed') throw conflict('DISPOSED', 'این سند قبلاً امحا شده است');
      if (doc.confidentiality === 'secret') throw forbidden('سند سری را فقط مالک پس از کاهش سطح محرمانگی به مدیر اسناد می‌سپارد');
      if (!doc.retention_until) throw conflict('NO_RETENTION', 'برای این سند سیاست نگهداری تعیین نشده است');
      if (doc.retention_until > today) throw conflict('UNDER_RETENTION', `دوره نگهداری این سند تا ${doc.retention_until} ادامه دارد`);
      const vs = await rows<{ id: string; file_id: string | null; workflow_instance_id: string | null; status: string }>(tx, sql`SELECT id, file_id, workflow_instance_id, status FROM documents_versions WHERE document_id = ${id}`);
      for (const x of vs) if (x.status === 'pending' && x.workflow_instance_id) await ctx.cancelWorkflow(x.workflow_instance_id, tx);
      await tx.execute(sql`DELETE FROM documents_versions WHERE document_id = ${id} AND status IN ('pending', 'rejected')`);
      await tx.execute(sql`UPDATE documents_versions SET file_id = NULL WHERE document_id = ${id}`);
      await tx.execute(sql`UPDATE documents_documents SET status = 'disposed', disposed_at = now(), disposed_by = ${ctx.userId} WHERE id = ${id}`);
      await ctx.audit({ action: 'documents.document.disposed', entityType: 'document', entityId: id, after: { code: doc.code, reason: input.reason, retentionUntil: doc.retention_until } }, tx);
      return vs.map((x) => x.file_id).filter((x): x is string => !!x);
    });
    for (const f of files) await ctx.files.remove(f);
  },
};

// ---------------------------------------------------------------- workflow outcome

export async function onWorkflowCompleted(ctx: ModuleEventContext, p: { moduleId: string; entityType: string; entityId: string; state: 'approved' | 'rejected'; deciders?: string[] }, today: string) {
  if (p.moduleId !== 'documents' || p.entityType !== 'document_version') return;
  const r = await ctx.db.transaction(async (tx) => {
    const x = await one<{ id: string; document_id: string; version: number; status: string; created_by: string; company_id: string }>(
      tx,
      sql`SELECT id, document_id, version, status, created_by, company_id FROM documents_versions WHERE id = ${p.entityId} FOR UPDATE`,
    );
    if (!x || x.status !== 'pending') return null;
    const d = (await one<{ code: string; title: string; category_id: string | null; effective_on: string | null; owner_id: string }>(
      tx,
      sql`SELECT code, title, category_id, effective_on::text, owner_id FROM documents_documents WHERE id = ${x.document_id} FOR UPDATE`,
    ))!;
    if (p.state === 'approved') {
      const rule = await categoryRule(tx, d.category_id);
      await approveVersion(tx, x.document_id, x.id, x.version, p.deciders ?? [], today, rule.years, d.effective_on);
      await ctx.publish('documents.version.approved', { documentId: x.document_id, code: d.code, version: x.version, companyId: x.company_id }, tx);
    } else {
      await tx.execute(sql`UPDATE documents_versions SET status = 'rejected', approvers = ${`{${(p.deciders ?? []).join(',')}}`}::uuid[], decided_at = now() WHERE id = ${x.id}`);
    }
    return { x, d };
  });
  if (!r) return;
  const users = [...new Set([r.x.created_by, r.d.owner_id])];
  await ctx.notify({
    userIds: users,
    type: 'documents.version.decided',
    title: `نسخه ${r.x.version.toLocaleString('fa-IR')} سند ${r.d.code} ${p.state === 'approved' ? 'تأیید شد' : 'رد شد'}`,
    link: `/app/documents/d/${r.x.document_id}`,
  });
}

// ---------------------------------------------------------------- reminders

/** Expiry reminders to the owner (once per expiry date) and retention-due notices to the owner (once). */
export async function reminders(ctx: ModuleEventContext, today: string) {
  const r = await ctx.db.transaction(async (tx) => {
    const exp = await rows<{ id: string; code: string; title: string; owner_id: string; expires_on: string }>(
      tx,
      sql`UPDATE documents_documents SET reminded_for = expires_on
        WHERE status = 'active' AND expires_on IS NOT NULL AND expires_on - remind_days <= ${today}::date AND reminded_for IS DISTINCT FROM expires_on
        RETURNING id, code, title, owner_id, expires_on::text`,
    );
    const ret = await rows<{ id: string; code: string; title: string; owner_id: string }>(
      tx,
      sql`UPDATE documents_documents SET retention_notified = true
        WHERE status IN ('active', 'obsolete') AND retention_until IS NOT NULL AND retention_until <= ${today}::date AND NOT retention_notified RETURNING id, code, title, owner_id`,
    );
    return { exp, ret };
  });
  for (const d of r.exp) {
    await ctx.notify({ userIds: [d.owner_id], type: 'documents.expiry', title: `سند ${d.code} (${d.title}) ${d.expires_on < today ? 'منقضی شده است' : 'رو به انقضاست'}`, link: `/app/documents/d/${d.id}` });
  }
  for (const d of r.ret) {
    await ctx.notify({ userIds: [d.owner_id], type: 'documents.retention', title: `دوره نگهداری سند ${d.code} (${d.title}) به پایان رسیده است؛ امحا یا تمدید را بررسی کنید`, link: `/app/documents/d/${d.id}` });
  }
  return r.exp.length + r.ret.length;
}

// ---------------------------------------------------------------- setup (folders, categories, retention)

export const Setup = {
  folders: (ctx: ModuleRequestContext) =>
    ctx.db.transaction((tx) => rows(tx, sql`SELECT f.id, f.parent_id, f.name, (SELECT count(*)::int FROM documents_documents d WHERE d.folder_id = f.id AND d.status <> 'disposed') AS documents FROM documents_folders f ORDER BY f.name`)),

  async saveFolder(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof folderInput>) {
    return ctx.db.transaction(async (tx) => {
      if (input.parentId) {
        if (!(await one(tx, sql`SELECT 1 FROM documents_folders WHERE id = ${input.parentId}`))) throw invalid('FOLDER', 'پوشه والد معتبر نیست');
        if (id) {
          const loop = await one(tx, sql`WITH RECURSIVE up AS (SELECT id, parent_id FROM documents_folders WHERE id = ${input.parentId} UNION ALL SELECT f.id, f.parent_id FROM documents_folders f JOIN up ON f.id = up.parent_id)
            SELECT 1 FROM up WHERE id = ${id}`);
          if (loop) throw invalid('FOLDER', 'پوشه نمی‌تواند زیرمجموعه خودش باشد');
        }
      }
      try {
        if (id) {
          if (!(await rows(tx, sql`UPDATE documents_folders SET name = ${input.name}, parent_id = ${input.parentId} WHERE id = ${id} RETURNING id`)).length) throw notFound('پوشه');
        } else {
          id = randomUUID();
          await tx.execute(sql`INSERT INTO documents_folders (id, tenant_id, company_id, parent_id, name, created_by) VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.parentId}, ${input.name}, ${ctx.userId})`);
        }
      } catch (e) {
        if ((e as { cause?: { code?: string } }).cause?.code === '23505') throw conflict('DUPLICATE', 'پوشه‌ای با این نام در همین محل وجود دارد');
        throw e;
      }
      return { id };
    });
  },

  async removeFolder(ctx: ModuleRequestContext, id: string) {
    await ctx.db.transaction(async (tx) => {
      if (await one(tx, sql`SELECT 1 FROM documents_folders WHERE parent_id = ${id}`)) throw conflict('NOT_EMPTY', 'پوشه زیرپوشه دارد');
      if (await one(tx, sql`SELECT 1 FROM documents_documents WHERE folder_id = ${id}`)) throw conflict('NOT_EMPTY', 'پوشه سند دارد');
      if (!(await rows(tx, sql`DELETE FROM documents_folders WHERE id = ${id} RETURNING id`)).length) throw notFound('پوشه');
    });
  },

  categories: (ctx: ModuleRequestContext) =>
    ctx.db.transaction((tx) => rows(tx, sql`SELECT c.id, c.name, c.requires_approval, c.retention_policy_id, p.name AS policy_name, p.years, c.archived FROM documents_categories c
      LEFT JOIN documents_retention_policies p ON p.id = c.retention_policy_id ORDER BY c.archived, c.name`)),

  async saveCategory(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof categoryInput>) {
    return ctx.db.transaction(async (tx) => {
      if (input.retentionPolicyId && !(await one(tx, sql`SELECT 1 FROM documents_retention_policies WHERE id = ${input.retentionPolicyId}`))) throw invalid('POLICY', 'سیاست نگهداری معتبر نیست');
      try {
        if (id) {
          if (!(await rows(tx, sql`UPDATE documents_categories SET name = ${input.name}, requires_approval = ${input.requiresApproval}, retention_policy_id = ${input.retentionPolicyId}, archived = ${input.archived} WHERE id = ${id} RETURNING id`)).length) throw notFound('دسته');
          await recomputeRetention(tx, sql`d.category_id = ${id}`);
        } else {
          id = randomUUID();
          await tx.execute(sql`INSERT INTO documents_categories (id, tenant_id, company_id, name, requires_approval, retention_policy_id, archived) VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.name}, ${input.requiresApproval}, ${input.retentionPolicyId}, ${input.archived})`);
        }
      } catch (e) {
        if ((e as { cause?: { code?: string } }).cause?.code === '23505') throw conflict('DUPLICATE', 'این دسته وجود دارد');
        throw e;
      }
      await ctx.audit({ action: 'documents.category.saved', entityType: 'document_category', entityId: id, after: input }, tx);
      return { id };
    });
  },

  policies: (ctx: ModuleRequestContext) => ctx.db.transaction((tx) => rows(tx, sql`SELECT id, name, years, archived FROM documents_retention_policies ORDER BY archived, name`)),

  async savePolicy(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof policyInput>) {
    return ctx.db.transaction(async (tx) => {
      try {
        if (id) {
          if (!(await rows(tx, sql`UPDATE documents_retention_policies SET name = ${input.name}, years = ${input.years}, archived = ${input.archived} WHERE id = ${id} RETURNING id`)).length) throw notFound('سیاست نگهداری');
          await recomputeRetention(tx, sql`c.retention_policy_id = ${id}`);
        } else {
          id = randomUUID();
          await tx.execute(sql`INSERT INTO documents_retention_policies (id, tenant_id, company_id, name, years, archived) VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.name}, ${input.years}, ${input.archived})`);
        }
      } catch (e) {
        if ((e as { cause?: { code?: string } }).cause?.code === '23505') throw conflict('DUPLICATE', 'این سیاست وجود دارد');
        throw e;
      }
      await ctx.audit({ action: 'documents.retention.saved', entityType: 'retention_policy', entityId: id, after: input }, tx);
      return { id };
    });
  },

  /** Documents past their retention period, awaiting the administrator's decision. */
  retentionDue: (ctx: ModuleRequestContext, today: string) =>
    ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT d.id, d.code, d.title, d.status, d.retention_until::text, c.name AS category_name FROM documents_documents d LEFT JOIN documents_categories c ON c.id = d.category_id
        WHERE d.status IN ('active', 'obsolete') AND d.confidentiality <> 'secret' AND d.retention_until IS NOT NULL AND d.retention_until <= ${today}::date ORDER BY d.retention_until`),
    ),
};

async function recomputeRetention(tx: Db, where: SQL) {
  await tx.execute(sql`UPDATE documents_documents d SET retention_until = CASE WHEN d.effective_on IS NULL OR p.years IS NULL THEN NULL ELSE (d.effective_on + make_interval(years => p.years))::date END,
      retention_notified = false
    FROM documents_categories c LEFT JOIN documents_retention_policies p ON p.id = c.retention_policy_id
    WHERE c.id = d.category_id AND ${where} AND d.status <> 'disposed'`);
}

// ---------------------------------------------------------------- lookups, widget, KPI, search

export const Lookups = {
  async projects(ctx: ModuleRequestContext, q: string) {
    const svc = projectsOf(ctx);
    if (!svc) return [];
    const v = await viewer(ctx);
    const list = await svc.search(q, 50);
    return v.manage === 'company' || v.view === 'company' ? list : list.filter((p) => v.projects.includes(p.id));
  },
  async contracts(ctx: ModuleRequestContext, q: string) {
    const svc = contractsOf(ctx);
    return svc?.search ? svc.search(q, 50) : [];
  },
  async payments(ctx: ModuleRequestContext, q: string) {
    const svc = ledgerOf(ctx);
    return svc?.searchPayments ? svc.searchPayments(q, 50) : [];
  },
};

export async function expiringWidget(ctx: ModuleRequestContext, today: string) {
  const v = await viewer(ctx);
  return ctx.db.transaction(async (tx) => {
    const list = await rows(tx, sql`SELECT d.id, d.code, d.title, d.expires_on::text, (d.expires_on < ${today}::date) AS expired FROM documents_documents d
      WHERE d.status = 'active' AND d.expires_on IS NOT NULL AND d.expires_on <= ${addDays(today, 30)}::date AND ${visibleSql(v)} ORDER BY d.expires_on LIMIT 10`);
    const pending = (await one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM documents_versions x JOIN documents_documents d ON d.id = x.document_id WHERE x.status = 'pending' AND ${visibleSql(v)}`))!.n;
    return { list, pending };
  });
}

export const kpi = {
  expired: (ctx: ModuleEventContext, p: { companyId: string; to: string }) =>
    ctx.db.transaction(async (tx) => (await one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM documents_documents WHERE company_id = ${p.companyId} AND status = 'active' AND expires_on < ${p.to}::date`))!.n),
  pending: (ctx: ModuleEventContext, p: { companyId: string }) =>
    ctx.db.transaction(async (tx) => (await one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM documents_versions WHERE company_id = ${p.companyId} AND status = 'pending'`))!.n),
};

export async function search(ctx: ModuleRequestContext, q: string, limit: number) {
  const v = await viewer(ctx);
  const n = normalizePersian(q).toLowerCase();
  const like = `%${n.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const r = await ctx.db.transaction((tx) =>
    rows<{ id: string; code: string; title: string }>(tx, sql`SELECT d.id, d.code, d.title FROM documents_documents d
      WHERE d.status <> 'disposed' AND ${visibleSql(v)} AND (to_tsvector('simple', d.search_text) @@ plainto_tsquery('simple', ${n}) OR d.search_text ILIKE ${like})
      ORDER BY d.created_at DESC LIMIT ${limit}`),
  );
  return r.map((x) => ({ entityType: 'document', entityId: x.id, title: `${x.code} — ${x.title}`, link: `/app/documents/d/${x.id}` }));
}
