import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, ModuleEventContext, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { normalizeIranMobile } from '@mohandesyar/persian';
import { conflict, forbidden, invalid, notFound } from './errors.js';
import type { accountInput, contactInput, convertInput, interactionInput, leadInput, moveInput, opportunityInput, proposalInput, proposalStatusInput, proposalVersionInput, reportQuery, stageInput } from './inputs.js';

type Row = Record<string, unknown>;
const rows = async <T = Row>(tx: Db, q: SQL) => (await tx.execute(q)).rows as T[];
const one = async <T = Row>(tx: Db, q: SQL) => (await rows<T>(tx, q))[0];
const like = (q: string) => `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

/** company scope: everything; own scope: records the user owns or created. */
function scope(ctx: ModuleRequestContext, permission: string, alias: SQL): SQL {
  if (ctx.can(permission, 'company')) return sql`TRUE`;
  if (!ctx.can(permission, 'own')) return sql`FALSE`;
  return sql`(${alias}.owner_id = ${ctx.userId} OR ${alias}.created_by = ${ctx.userId})`;
}
const A = sql.raw('a');
const L = sql.raw('l');
const O = sql.raw('o');

async function validateUser(ctx: ModuleRequestContext, id: string | null) {
  if (id && !(await ctx.directory([id])).length) throw invalid('UNKNOWN_USER', 'کاربر انتخاب‌شده عضو فعال سازمان نیست');
}

const mobileOf = (s: string) => (s.trim() ? normalizeIranMobile(s) : null);

// ---------------------------------------------------------------- pipeline stages

export const DEFAULT_STAGES: { name: string; probability: number; kind: 'open' | 'won' | 'lost' }[] = [
  { name: 'ارزیابی اولیه', probability: 10, kind: 'open' },
  { name: 'جلسه و بازدید', probability: 25, kind: 'open' },
  { name: 'ارسال پیشنهاد', probability: 50, kind: 'open' },
  { name: 'مذاکره', probability: 75, kind: 'open' },
  { name: 'برنده', probability: 100, kind: 'won' },
  { name: 'از دست رفته', probability: 0, kind: 'lost' },
];

export interface Stage {
  id: string;
  name: string;
  sort: number;
  probability: number;
  kind: 'open' | 'won' | 'lost';
  archived: boolean;
}

/** Stages of a company; the default pipeline is created the first time a company uses CRM. */
async function stagesOf(tx: Db, tenantId: string, companyId: string): Promise<Stage[]> {
  let s = await rows<Stage>(tx, sql`SELECT id, name, sort, probability, kind, archived FROM crm_pipeline_stages WHERE company_id = ${companyId} ORDER BY sort, created_at`);
  if (!s.length) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`crm-stages:${companyId}`}))`);
    s = await rows<Stage>(tx, sql`SELECT id, name, sort, probability, kind, archived FROM crm_pipeline_stages WHERE company_id = ${companyId} ORDER BY sort, created_at`);
    if (!s.length) {
      let i = 0;
      for (const d of DEFAULT_STAGES) {
        await tx.execute(sql`INSERT INTO crm_pipeline_stages (id, tenant_id, company_id, name, sort, probability, kind) VALUES (${randomUUID()}, ${tenantId}, ${companyId}, ${d.name}, ${++i * 10}, ${d.probability}, ${d.kind})`);
      }
      s = await rows<Stage>(tx, sql`SELECT id, name, sort, probability, kind, archived FROM crm_pipeline_stages WHERE company_id = ${companyId} ORDER BY sort, created_at`);
    }
  }
  return s;
}

export const Stages = {
  list: (ctx: ModuleRequestContext) => ctx.db.transaction((tx) => stagesOf(tx, ctx.tenantId, ctx.companyId)),

  async save(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof stageInput>) {
    return ctx.db.transaction(async (tx) => {
      const stages = await stagesOf(tx, ctx.tenantId, ctx.companyId);
      if (id) {
        const cur = stages.find((s) => s.id === id);
        if (!cur) throw notFound('مرحله');
        if (cur.kind !== input.kind && (await one(tx, sql`SELECT 1 FROM crm_opportunities WHERE stage_id = ${id} AND deleted_at IS NULL LIMIT 1`))) {
          throw conflict('STAGE_IN_USE', 'نوع مرحله‌ای که فرصت دارد قابل تغییر نیست');
        }
        await tx.execute(sql`UPDATE crm_pipeline_stages SET name = ${input.name}, probability = ${input.probability}, kind = ${input.kind}, sort = ${input.sort} WHERE id = ${id}`);
      } else {
        id = randomUUID();
        await tx.execute(sql`INSERT INTO crm_pipeline_stages (id, tenant_id, company_id, name, sort, probability, kind) VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.name}, ${input.sort}, ${input.probability}, ${input.kind})`);
      }
      await assertPipelineShape(tx, ctx.companyId);
      await ctx.audit({ action: 'crm.stage.saved', entityType: 'stage', entityId: id, after: input }, tx);
      return { id };
    });
  },

  async archive(ctx: ModuleRequestContext, id: string, archived: boolean) {
    await ctx.db.transaction(async (tx) => {
      if (archived && (await one(tx, sql`SELECT 1 FROM crm_opportunities WHERE stage_id = ${id} AND status = 'open' AND deleted_at IS NULL LIMIT 1`))) {
        throw conflict('STAGE_IN_USE', 'در این مرحله فرصت باز وجود دارد؛ ابتدا آن‌ها را منتقل کنید');
      }
      const r = await rows(tx, sql`UPDATE crm_pipeline_stages SET archived = ${archived} WHERE id = ${id} AND company_id = ${ctx.companyId} RETURNING id`);
      if (!r.length) throw notFound('مرحله');
      await assertPipelineShape(tx, ctx.companyId);
    });
  },
};

/** A usable pipeline keeps at least one active open, one won and one lost stage. */
async function assertPipelineShape(tx: Db, companyId: string) {
  const k = await rows<{ kind: string; n: number }>(tx, sql`SELECT kind, count(*)::int AS n FROM crm_pipeline_stages WHERE company_id = ${companyId} AND NOT archived GROUP BY kind`);
  const n = (kind: string) => k.find((x) => x.kind === kind)?.n ?? 0;
  if (!n('open') || !n('won') || !n('lost')) throw invalid('PIPELINE_SHAPE', 'قیف فروش باید دست‌کم یک مرحله باز، یک مرحله «برنده» و یک مرحله «از دست رفته» فعال داشته باشد');
}

// ---------------------------------------------------------------- accounts & contacts

export const Accounts = {
  async list(ctx: ModuleRequestContext, q?: string) {
    return ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT a.id, a.kind, a.name, a.industry, a.phone, a.city, a.owner_id, a.created_at,
          (SELECT count(*)::int FROM crm_opportunities o WHERE o.account_id = a.id AND o.status = 'open' AND o.deleted_at IS NULL) AS open_opportunities
        FROM crm_accounts a WHERE a.deleted_at IS NULL AND ${scope(ctx, 'crm.account.view', A)} ${q ? sql`AND a.name ILIKE ${like(q)}` : sql``} ORDER BY a.name LIMIT 500`),
    );
  },

  async get(ctx: ModuleRequestContext, id: string) {
    return ctx.db.transaction(async (tx) => {
      const account = await one(tx, sql`SELECT a.* , a.created_at FROM crm_accounts a WHERE a.id = ${id} AND a.deleted_at IS NULL AND ${scope(ctx, 'crm.account.view', A)}`);
      if (!account) throw notFound('مشتری');
      const pipelineVisible = scope(ctx, 'crm.pipeline.view', O);
      const [contacts, interactions, opportunities] = await Promise.all([
        rows(tx, sql`SELECT id, full_name, position, mobile, phone, email, notes FROM crm_contacts WHERE account_id = ${id} AND deleted_at IS NULL ORDER BY full_name`),
        rows(tx, sql`SELECT i.id, i.kind, i.occurred_on::text, i.summary, i.created_by, i.contact_id, i.opportunity_id FROM crm_interactions i WHERE i.account_id = ${id} ORDER BY i.occurred_on DESC, i.created_at DESC LIMIT 200`),
        rows(tx, sql`SELECT o.id, o.title, o.amount::text, o.status, o.expected_close_on::text, s.name AS stage FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id = o.stage_id
          WHERE o.account_id = ${id} AND o.deleted_at IS NULL AND ${pipelineVisible} ORDER BY o.created_at DESC`),
      ]);
      return { account, contacts, interactions, opportunities };
    });
  },

  async save(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof accountInput>) {
    await validateUser(ctx, input.ownerId);
    return ctx.db.transaction(async (tx) => {
      if (id) {
        const r = await rows(tx, sql`UPDATE crm_accounts a SET kind = ${input.kind}, name = ${input.name}, national_id = ${input.nationalId}, economic_code = ${input.economicCode}, industry = ${input.industry},
            phone = ${input.phone}, email = ${input.email}, city = ${input.city}, address = ${input.address}, source = ${input.source}, notes = ${input.notes}, owner_id = ${input.ownerId},
            updated_at = now(), version = version + 1 WHERE a.id = ${id} AND a.deleted_at IS NULL AND ${scope(ctx, 'crm.account.manage', A)} RETURNING a.id`);
        if (!r.length) throw notFound('مشتری');
      } else {
        id = randomUUID();
        await tx.execute(sql`INSERT INTO crm_accounts (id, tenant_id, company_id, kind, name, national_id, economic_code, industry, phone, email, city, address, source, notes, owner_id, created_by)
          VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.kind}, ${input.name}, ${input.nationalId}, ${input.economicCode}, ${input.industry}, ${input.phone}, ${input.email}, ${input.city},
            ${input.address}, ${input.source}, ${input.notes}, ${input.ownerId ?? ctx.userId}, ${ctx.userId})`);
      }
      await ctx.audit({ action: 'crm.account.saved', entityType: 'account', entityId: id, after: { name: input.name } }, tx);
      const dupes = await rows<{ id: string; name: string }>(tx, sql`SELECT id, name FROM crm_accounts WHERE deleted_at IS NULL AND id <> ${id} AND lower(name) = lower(${input.name}) LIMIT 5`);
      return { id, duplicates: dupes };
    });
  },

  async addContact(ctx: ModuleRequestContext, accountId: string, input: z.infer<typeof contactInput>) {
    const mobile = mobileOf(input.mobile);
    if (input.mobile.trim() && !mobile) throw invalid('VALIDATION_FAILED', 'شماره موبایل معتبر نیست');
    return ctx.db.transaction(async (tx) => {
      const acc = await one<{ company_id: string }>(tx, sql`SELECT a.company_id FROM crm_accounts a WHERE a.id = ${accountId} AND a.deleted_at IS NULL AND ${scope(ctx, 'crm.account.manage', A)}`);
      if (!acc) throw notFound('مشتری');
      // Same mobile already registered: warn (people move between companies) but do not block.
      const duplicates = mobile ? await rows<{ id: string; full_name: string; account_id: string; account_name: string }>(tx, sql`SELECT c.id, c.full_name, c.account_id, a.name AS account_name FROM crm_contacts c JOIN crm_accounts a ON a.id = c.account_id
          WHERE c.mobile = ${mobile} AND c.deleted_at IS NULL LIMIT 5`) : [];
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO crm_contacts (id, tenant_id, company_id, account_id, full_name, position, mobile, phone, email, notes, created_by)
        VALUES (${id}, ${ctx.tenantId}, ${acc.company_id}, ${accountId}, ${input.fullName}, ${input.position}, ${mobile}, ${input.phone}, ${input.email}, ${input.notes}, ${ctx.userId})`);
      return { id, duplicates };
    });
  },

  async removeContact(ctx: ModuleRequestContext, accountId: string, contactId: string) {
    await ctx.db.transaction(async (tx) => {
      const ok = await one(tx, sql`SELECT 1 FROM crm_accounts a WHERE a.id = ${accountId} AND ${scope(ctx, 'crm.account.manage', A)}`);
      if (!ok) throw notFound('مشتری');
      const r = await rows(tx, sql`UPDATE crm_contacts SET deleted_at = now() WHERE id = ${contactId} AND account_id = ${accountId} AND deleted_at IS NULL RETURNING id`);
      if (!r.length) throw notFound('مخاطب');
    });
  },
};

// ---------------------------------------------------------------- interactions

export async function addInteraction(ctx: ModuleRequestContext, input: z.infer<typeof interactionInput>) {
  return ctx.db.transaction(async (tx) => {
    let companyId = ctx.companyId;
    let accountId = input.accountId;
    if (input.opportunityId) {
      const o = await one<{ company_id: string; account_id: string }>(tx, sql`SELECT o.company_id, o.account_id FROM crm_opportunities o WHERE o.id = ${input.opportunityId} AND o.deleted_at IS NULL AND ${scope(ctx, 'crm.pipeline.manage', O)}`);
      if (!o) throw notFound('فرصت');
      companyId = o.company_id;
      accountId = accountId ?? o.account_id;
      if (input.nextContactOn) await tx.execute(sql`UPDATE crm_opportunities SET next_contact_on = ${input.nextContactOn}, updated_at = now() WHERE id = ${input.opportunityId}`);
    }
    if (input.leadId) {
      const l = await one<{ company_id: string; account_id: string | null }>(tx, sql`SELECT l.company_id, l.account_id FROM crm_leads l WHERE l.id = ${input.leadId} AND l.deleted_at IS NULL AND ${scope(ctx, 'crm.pipeline.manage', L)}`);
      if (!l) throw notFound('سرنخ');
      companyId = l.company_id;
      accountId = accountId ?? l.account_id;
      await tx.execute(sql`UPDATE crm_leads SET status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END,
        next_contact_on = coalesce(${input.nextContactOn}::date, next_contact_on), updated_at = now() WHERE id = ${input.leadId}`);
    }
    if (accountId && !input.opportunityId && !input.leadId) {
      const a = await one<{ company_id: string }>(tx, sql`SELECT a.company_id FROM crm_accounts a WHERE a.id = ${accountId} AND a.deleted_at IS NULL AND ${scope(ctx, 'crm.account.manage', A)}`);
      if (!a) throw notFound('مشتری');
      companyId = a.company_id;
    }
    const id = randomUUID();
    await tx.execute(sql`INSERT INTO crm_interactions (id, tenant_id, company_id, account_id, lead_id, opportunity_id, contact_id, kind, occurred_on, summary, created_by)
      VALUES (${id}, ${ctx.tenantId}, ${companyId}, ${accountId}, ${input.leadId}, ${input.opportunityId}, ${input.contactId}, ${input.kind}, ${input.occurredOn}, ${input.summary}, ${ctx.userId})`);
    return { id };
  });
}

// ---------------------------------------------------------------- leads

export const Leads = {
  async list(ctx: ModuleRequestContext, f: { status?: string; q?: string }) {
    return ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT l.id, l.title, l.organization_name, l.contact_name, l.mobile, l.source, l.estimated_budget::text, l.score, l.owner_id, l.next_contact_on::text, l.status, l.lost_reason,
          l.account_id, l.opportunity_id, l.created_at FROM crm_leads l
        WHERE l.deleted_at IS NULL AND ${scope(ctx, 'crm.pipeline.view', L)} ${f.status ? sql`AND l.status = ${f.status}` : sql`AND l.status NOT IN ('converted', 'lost')`}
          ${f.q ? sql`AND (l.title ILIKE ${like(f.q)} OR l.organization_name ILIKE ${like(f.q)} OR l.contact_name ILIKE ${like(f.q)})` : sql``}
        ORDER BY l.next_contact_on NULLS LAST, l.score DESC, l.created_at DESC LIMIT 500`),
    );
  },

  async get(ctx: ModuleRequestContext, id: string) {
    return ctx.db.transaction(async (tx) => {
      const lead = await one(tx, sql`SELECT l.*, l.estimated_budget::text AS estimated_budget, l.next_contact_on::text AS next_contact_on FROM crm_leads l WHERE l.id = ${id} AND l.deleted_at IS NULL AND ${scope(ctx, 'crm.pipeline.view', L)}`);
      if (!lead) throw notFound('سرنخ');
      const interactions = await rows(tx, sql`SELECT id, kind, occurred_on::text, summary, created_by FROM crm_interactions WHERE lead_id = ${id} ORDER BY occurred_on DESC, created_at DESC`);
      return { lead, interactions };
    });
  },

  async save(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof leadInput>) {
    await validateUser(ctx, input.ownerId);
    const mobile = mobileOf(input.mobile);
    if (input.mobile.trim() && !mobile) throw invalid('VALIDATION_FAILED', 'شماره موبایل معتبر نیست');
    return ctx.db.transaction(async (tx) => {
      if (input.accountId && !(await one(tx, sql`SELECT 1 FROM crm_accounts a WHERE a.id = ${input.accountId} AND a.deleted_at IS NULL AND ${scope(ctx, 'crm.account.view', A)}`))) throw notFound('مشتری');
      if (id) {
        const r = await rows(tx, sql`UPDATE crm_leads l SET title = ${input.title}, account_id = ${input.accountId}, organization_name = ${input.organizationName}, contact_name = ${input.contactName},
            mobile = ${mobile}, email = ${input.email}, source = ${input.source}, need = ${input.need}, estimated_budget = ${input.estimatedBudget}, score = ${input.score}, owner_id = ${input.ownerId},
            next_contact_on = ${input.nextContactOn}, status = ${input.status}, updated_at = now()
          WHERE l.id = ${id} AND l.deleted_at IS NULL AND l.status NOT IN ('converted', 'lost') AND ${scope(ctx, 'crm.pipeline.manage', L)} RETURNING l.id`);
        if (!r.length) throw notFound('سرنخ باز');
      } else {
        id = randomUUID();
        await tx.execute(sql`INSERT INTO crm_leads (id, tenant_id, company_id, title, account_id, organization_name, contact_name, mobile, email, source, need, estimated_budget, score, owner_id, next_contact_on, status, created_by)
          VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.title}, ${input.accountId}, ${input.organizationName}, ${input.contactName}, ${mobile}, ${input.email}, ${input.source}, ${input.need},
            ${input.estimatedBudget}, ${input.score}, ${input.ownerId ?? ctx.userId}, ${input.nextContactOn}, ${input.status}, ${ctx.userId})`);
      }
      return { id };
    });
  },

  async lose(ctx: ModuleRequestContext, id: string, reason: string) {
    await ctx.db.transaction(async (tx) => {
      const r = await rows(tx, sql`UPDATE crm_leads l SET status = 'lost', lost_reason = ${reason}, next_contact_on = NULL, updated_at = now()
        WHERE l.id = ${id} AND l.deleted_at IS NULL AND l.status NOT IN ('converted', 'lost') AND ${scope(ctx, 'crm.pipeline.manage', L)} RETURNING l.id`);
      if (!r.length) throw notFound('سرنخ باز');
    });
  },

  /** Lead → (account) + contact + opportunity in the first open stage. */
  async convert(ctx: ModuleRequestContext, id: string, input: z.infer<typeof convertInput>) {
    return ctx.db.transaction(async (tx) => {
      const l = await one<{ id: string; company_id: string; title: string; account_id: string | null; organization_name: string; contact_name: string; mobile: string | null; email: string; source: string; owner_id: string | null; estimated_budget: string | null; status: string }>(
        tx,
        sql`SELECT l.id, l.company_id, l.title, l.account_id, l.organization_name, l.contact_name, l.mobile, l.email, l.source, l.owner_id, l.estimated_budget::text, l.status FROM crm_leads l
          WHERE l.id = ${id} AND l.deleted_at IS NULL AND ${scope(ctx, 'crm.pipeline.manage', L)} FOR UPDATE OF l`,
      );
      if (!l) throw notFound('سرنخ');
      if (l.status === 'converted' || l.status === 'lost') throw conflict('LEAD_CLOSED', 'این سرنخ قبلاً تبدیل یا بسته شده است');
      let accountId = input.accountId ?? l.account_id;
      if (accountId) {
        if (!(await one(tx, sql`SELECT 1 FROM crm_accounts WHERE id = ${accountId} AND deleted_at IS NULL`))) throw notFound('مشتری');
      } else {
        const name = l.organization_name || l.contact_name;
        if (name.trim().length < 2) throw invalid('NO_ACCOUNT_NAME', 'برای تبدیل، نام سازمان یا مخاطب سرنخ را وارد کنید یا مشتری موجودی را انتخاب کنید');
        accountId = randomUUID();
        await tx.execute(sql`INSERT INTO crm_accounts (id, tenant_id, company_id, kind, name, email, source, owner_id, created_by)
          VALUES (${accountId}, ${ctx.tenantId}, ${l.company_id}, ${l.organization_name ? 'company' : 'person'}, ${name}, ${l.email}, ${l.source}, ${l.owner_id ?? ctx.userId}, ${ctx.userId})`);
      }
      let contactId: string | null = null;
      if (l.contact_name.trim().length >= 2) {
        contactId = randomUUID();
        await tx.execute(sql`INSERT INTO crm_contacts (id, tenant_id, company_id, account_id, full_name, mobile, email, created_by)
          VALUES (${contactId}, ${ctx.tenantId}, ${l.company_id}, ${accountId}, ${l.contact_name}, ${l.mobile}, ${l.email}, ${ctx.userId})`);
      }
      const stages = await stagesOf(tx, ctx.tenantId, l.company_id);
      const first = stages.find((s) => s.kind === 'open' && !s.archived)!;
      const oppId = randomUUID();
      await tx.execute(sql`INSERT INTO crm_opportunities (id, tenant_id, company_id, title, account_id, contact_id, lead_id, stage_id, amount, expected_close_on, owner_id, source, created_by)
        VALUES (${oppId}, ${ctx.tenantId}, ${l.company_id}, ${input.opportunityTitle ?? l.title}, ${accountId}, ${contactId}, ${id}, ${first.id},
          ${input.amount !== '0' ? input.amount : (l.estimated_budget ?? '0')}, ${input.expectedCloseOn}, ${l.owner_id ?? ctx.userId}, ${l.source}, ${ctx.userId})`);
      await tx.execute(sql`INSERT INTO crm_stage_history (id, tenant_id, company_id, opportunity_id, from_stage_id, to_stage_id, changed_by) VALUES (${randomUUID()}, ${ctx.tenantId}, ${l.company_id}, ${oppId}, NULL, ${first.id}, ${ctx.userId})`);
      await tx.execute(sql`UPDATE crm_leads SET status = 'converted', account_id = ${accountId}, opportunity_id = ${oppId}, next_contact_on = NULL, updated_at = now() WHERE id = ${id}`);
      await tx.execute(sql`UPDATE crm_interactions SET account_id = coalesce(account_id, ${accountId}) WHERE lead_id = ${id}`);
      await ctx.audit({ action: 'crm.lead.converted', entityType: 'lead', entityId: id, after: { accountId, opportunityId: oppId } }, tx);
      await ctx.publish('crm.lead.converted', { leadId: id, accountId, opportunityId: oppId }, tx);
      return { accountId, opportunityId: oppId };
    });
  },
};

// ---------------------------------------------------------------- opportunities

const OPP_COLUMNS = sql`o.id, o.company_id, o.title, o.account_id, a.name AS account_name, o.contact_id, o.lead_id, o.stage_id, o.amount::text, o.probability, s.probability AS stage_probability,
  s.name AS stage_name, s.kind AS stage_kind, o.expected_close_on::text, o.owner_id, o.next_contact_on::text, o.status, o.lost_reason, o.closed_on::text, o.source,
  o.projects_project_id, o.contracts_contract_id, o.created_by, o.created_at, o.version`;

export const Opportunities = {
  /** Board: open opportunities by stage, plus recently closed ones. */
  async board(ctx: ModuleRequestContext) {
    return ctx.db.transaction(async (tx) => {
      const stages = await stagesOf(tx, ctx.tenantId, ctx.companyId);
      const opps = await rows(tx, sql`SELECT ${OPP_COLUMNS} FROM crm_opportunities o JOIN crm_accounts a ON a.id = o.account_id JOIN crm_pipeline_stages s ON s.id = o.stage_id
        WHERE o.deleted_at IS NULL AND o.company_id = ${ctx.companyId} AND ${scope(ctx, 'crm.pipeline.view', O)} AND (o.status = 'open' OR o.closed_on >= current_date - 90)
        ORDER BY o.expected_close_on NULLS LAST, o.created_at`);
      return { stages: stages.filter((s) => !s.archived), opportunities: opps };
    });
  },

  async get(ctx: ModuleRequestContext, id: string) {
    return ctx.db.transaction(async (tx) => {
      const o = await one<{ stage_id: string; company_id: string; projects_project_id: string | null; contracts_contract_id: string | null }>(tx, sql`SELECT ${OPP_COLUMNS} FROM crm_opportunities o JOIN crm_accounts a ON a.id = o.account_id
        JOIN crm_pipeline_stages s ON s.id = o.stage_id WHERE o.id = ${id} AND o.deleted_at IS NULL AND ${scope(ctx, 'crm.pipeline.view', O)}`);
      if (!o) throw notFound('فرصت');
      const [history, interactions, proposals, stages] = await Promise.all([
        rows(tx, sql`SELECT h.id, h.from_stage_id, h.to_stage_id, t.name AS to_name, h.changed_at, h.changed_by FROM crm_stage_history h JOIN crm_pipeline_stages t ON t.id = h.to_stage_id
          WHERE h.opportunity_id = ${id} ORDER BY h.changed_at DESC`),
        rows(tx, sql`SELECT id, kind, occurred_on::text, summary, created_by FROM crm_interactions WHERE opportunity_id = ${id} ORDER BY occurred_on DESC, created_at DESC`),
        rows(tx, sql`SELECT p.id, p.number, p.title, p.kind, p.status,
            (SELECT json_agg(json_build_object('id', v.id, 'version', v.version, 'amount', v.amount::text, 'validUntil', v.valid_until::text, 'content', v.content, 'sentOn', v.sent_on::text, 'createdAt', v.created_at, 'createdBy', v.created_by) ORDER BY v.version DESC)
               FROM crm_proposal_versions v WHERE v.proposal_id = p.id) AS versions
          FROM crm_proposals p WHERE p.opportunity_id = ${id} AND p.deleted_at IS NULL ORDER BY p.number DESC`),
        stagesOf(tx, ctx.tenantId, o.company_id),
      ]);
      return { opportunity: o, history, interactions, proposals, stages: stages.filter((s) => !s.archived) };
    });
  },

  async save(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof opportunityInput>) {
    await validateUser(ctx, input.ownerId);
    return ctx.db.transaction(async (tx) => {
      const acc = await one<{ company_id: string }>(tx, sql`SELECT a.company_id FROM crm_accounts a WHERE a.id = ${input.accountId} AND a.deleted_at IS NULL AND ${scope(ctx, 'crm.account.view', A)}`);
      if (!acc) throw notFound('مشتری');
      if (input.contactId && !(await one(tx, sql`SELECT 1 FROM crm_contacts WHERE id = ${input.contactId} AND account_id = ${input.accountId} AND deleted_at IS NULL`))) throw invalid('BAD_CONTACT', 'مخاطب انتخاب‌شده متعلق به این مشتری نیست');
      if (id) {
        const r = await rows(tx, sql`UPDATE crm_opportunities o SET title = ${input.title}, account_id = ${input.accountId}, contact_id = ${input.contactId}, amount = ${input.amount}, probability = ${input.probability},
            expected_close_on = ${input.expectedCloseOn}, owner_id = ${input.ownerId ?? sql`o.owner_id`}, next_contact_on = ${input.nextContactOn}, source = ${input.source},
            projects_project_id = ${input.projectId}, contracts_contract_id = ${input.contractId}, updated_at = now(), version = version + 1
          WHERE o.id = ${id} AND o.deleted_at IS NULL AND ${scope(ctx, 'crm.pipeline.manage', O)} RETURNING o.id`);
        if (!r.length) throw notFound('فرصت');
      } else {
        const stages = await stagesOf(tx, ctx.tenantId, acc.company_id);
        const stage = input.stageId ? stages.find((s) => s.id === input.stageId && s.kind === 'open' && !s.archived) : stages.find((s) => s.kind === 'open' && !s.archived);
        if (!stage) throw invalid('BAD_STAGE', 'فرصت جدید باید در یکی از مراحل باز قرار گیرد');
        id = randomUUID();
        await tx.execute(sql`INSERT INTO crm_opportunities (id, tenant_id, company_id, title, account_id, contact_id, stage_id, amount, probability, expected_close_on, owner_id, next_contact_on, source,
            projects_project_id, contracts_contract_id, created_by)
          VALUES (${id}, ${ctx.tenantId}, ${acc.company_id}, ${input.title}, ${input.accountId}, ${input.contactId}, ${stage.id}, ${input.amount}, ${input.probability}, ${input.expectedCloseOn},
            ${input.ownerId ?? ctx.userId}, ${input.nextContactOn}, ${input.source}, ${input.projectId}, ${input.contractId}, ${ctx.userId})`);
        await tx.execute(sql`INSERT INTO crm_stage_history (id, tenant_id, company_id, opportunity_id, from_stage_id, to_stage_id, changed_by) VALUES (${randomUUID()}, ${ctx.tenantId}, ${acc.company_id}, ${id}, NULL, ${stage.id}, ${ctx.userId})`);
      }
      return { id };
    });
  },

  /** Moves an opportunity to a stage; won/lost stages close it (lost needs a reason). */
  async move(ctx: ModuleRequestContext, id: string, input: z.infer<typeof moveInput>, today: string) {
    return ctx.db.transaction(async (tx) => {
      const o = await one<{ id: string; company_id: string; stage_id: string; title: string; account_id: string; amount: string; owner_id: string | null }>(
        tx,
        sql`SELECT o.id, o.company_id, o.stage_id, o.title, o.account_id, o.amount::text, o.owner_id FROM crm_opportunities o WHERE o.id = ${id} AND o.deleted_at IS NULL AND ${scope(ctx, 'crm.pipeline.manage', O)} FOR UPDATE OF o`,
      );
      if (!o) throw notFound('فرصت');
      const stage = (await stagesOf(tx, ctx.tenantId, o.company_id)).find((s) => s.id === input.stageId && !s.archived);
      if (!stage) throw notFound('مرحله');
      if (stage.id === o.stage_id) return { status: stage.kind };
      if (stage.kind === 'lost' && input.lostReason.trim().length < 2) throw invalid('LOST_REASON_REQUIRED', 'دلیل از دست رفتن فرصت را بنویسید');
      const status = stage.kind;
      await tx.execute(sql`UPDATE crm_opportunities SET stage_id = ${stage.id}, status = ${status}, lost_reason = ${stage.kind === 'lost' ? input.lostReason : ''},
          closed_on = ${status === 'open' ? null : today}, next_contact_on = ${status === 'open' ? sql`next_contact_on` : null}, updated_at = now(), version = version + 1 WHERE id = ${id}`);
      await tx.execute(sql`INSERT INTO crm_stage_history (id, tenant_id, company_id, opportunity_id, from_stage_id, to_stage_id, changed_by) VALUES (${randomUUID()}, ${ctx.tenantId}, ${o.company_id}, ${id}, ${o.stage_id}, ${stage.id}, ${ctx.userId})`);
      if (status === 'won') await ctx.publish('crm.opportunity.won', { opportunityId: id, accountId: o.account_id, title: o.title, amount: o.amount }, tx);
      await ctx.audit({ action: 'crm.opportunity.moved', entityType: 'opportunity', entityId: id, after: { stage: stage.name, status } }, tx);
      return { status };
    });
  },

  // ------------------------------------------------------------- proposals

  async addProposal(ctx: ModuleRequestContext, id: string, input: z.infer<typeof proposalInput>) {
    return ctx.db.transaction(async (tx) => {
      const o = await one<{ company_id: string }>(tx, sql`SELECT o.company_id FROM crm_opportunities o WHERE o.id = ${id} AND o.deleted_at IS NULL AND ${scope(ctx, 'crm.pipeline.manage', O)} FOR UPDATE OF o`);
      if (!o) throw notFound('فرصت');
      const n = await one<{ n: number }>(tx, sql`SELECT coalesce(max(number), 0)::int + 1 AS n FROM crm_proposals WHERE opportunity_id = ${id}`);
      const pid = randomUUID();
      await tx.execute(sql`INSERT INTO crm_proposals (id, tenant_id, company_id, opportunity_id, number, title, kind, created_by) VALUES (${pid}, ${ctx.tenantId}, ${o.company_id}, ${id}, ${n!.n}, ${input.title}, ${input.kind}, ${ctx.userId})`);
      await tx.execute(sql`INSERT INTO crm_proposal_versions (id, tenant_id, company_id, proposal_id, version, amount, valid_until, content, created_by)
        VALUES (${randomUUID()}, ${ctx.tenantId}, ${o.company_id}, ${pid}, 1, ${input.amount}, ${input.validUntil}, ${input.content}, ${ctx.userId})`);
      return { id: pid, number: n!.n };
    });
  },

  async addProposalVersion(ctx: ModuleRequestContext, id: string, pid: string, input: z.infer<typeof proposalVersionInput>) {
    return ctx.db.transaction(async (tx) => {
      const p = await proposalFor(tx, ctx, id, pid);
      if (p.status === 'accepted' || p.status === 'rejected') throw conflict('PROPOSAL_CLOSED', 'پیشنهاد پذیرفته یا ردشده قابل بازنگری نیست');
      const v = await one<{ v: number }>(tx, sql`SELECT max(version)::int + 1 AS v FROM crm_proposal_versions WHERE proposal_id = ${pid}`);
      await tx.execute(sql`INSERT INTO crm_proposal_versions (id, tenant_id, company_id, proposal_id, version, amount, valid_until, content, created_by)
        VALUES (${randomUUID()}, ${ctx.tenantId}, ${p.company_id}, ${pid}, ${v!.v}, ${input.amount}, ${input.validUntil}, ${input.content}, ${ctx.userId})`);
      // A revised proposal has not been sent yet.
      await tx.execute(sql`UPDATE crm_proposals SET status = 'draft' WHERE id = ${pid}`);
      return { version: v!.v };
    });
  },

  async setProposalStatus(ctx: ModuleRequestContext, id: string, pid: string, input: z.infer<typeof proposalStatusInput>) {
    await ctx.db.transaction(async (tx) => {
      const p = await proposalFor(tx, ctx, id, pid);
      if (input.status === 'sent') {
        if (p.status !== 'draft') throw conflict('NOT_DRAFT', 'فقط آخرین نسخه پیش‌نویس قابل ارسال است');
        await tx.execute(sql`UPDATE crm_proposal_versions SET sent_on = ${input.on} WHERE proposal_id = ${pid} AND version = (SELECT max(version) FROM crm_proposal_versions WHERE proposal_id = ${pid})`);
      } else if (p.status !== 'sent') throw conflict('NOT_SENT', 'پاسخ کارفرما فقط برای پیشنهاد ارسال‌شده ثبت می‌شود');
      await tx.execute(sql`UPDATE crm_proposals SET status = ${input.status} WHERE id = ${pid}`);
      await ctx.audit({ action: `crm.proposal.${input.status}`, entityType: 'proposal', entityId: pid }, tx);
    });
  },

  async lookup(ctx: ModuleRequestContext, kind: 'projects' | 'contracts', q: string) {
    if (kind === 'projects') {
      const s = ctx.services.get<{ search(q: string, limit: number): Promise<{ id: string; code: string; title: string }[]> }>('projects.projects', '^1');
      return s ? s.search(q, 20) : [];
    }
    const s = ctx.services.get<{ search?(q: string, limit: number): Promise<{ id: string; code: string; title: string }[]> }>('contracts.contracts', '^1');
    return s?.search ? s.search(q, 20) : [];
  },
};

async function proposalFor(tx: Db, ctx: ModuleRequestContext, oppId: string, pid: string) {
  const p = await one<{ company_id: string; status: string }>(tx, sql`SELECT p.company_id, p.status FROM crm_proposals p JOIN crm_opportunities o ON o.id = p.opportunity_id
    WHERE p.id = ${pid} AND p.opportunity_id = ${oppId} AND p.deleted_at IS NULL AND o.deleted_at IS NULL AND ${scope(ctx, 'crm.pipeline.manage', O)} FOR UPDATE OF p`);
  if (!p) throw notFound('پیشنهاد');
  return p;
}

// ---------------------------------------------------------------- reports

export async function salesReport(ctx: ModuleRequestContext, f: z.infer<typeof reportQuery>) {
  if (!ctx.can('crm.report.view', 'company')) throw forbidden('دسترسی به گزارش‌های فروش ندارید');
  return ctx.db.transaction(async (tx) => {
    const company = ctx.companyId;
    const created = sql`created_at >= ${f.from}::date AND created_at < ${f.to}::date + 1`;
    const leads = await one<{ total: number; converted: number; lost: number }>(tx, sql`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'converted')::int AS converted,
      count(*) FILTER (WHERE status = 'lost')::int AS lost FROM crm_leads WHERE deleted_at IS NULL AND company_id = ${company} AND ${created}`);
    const bySource = await rows(tx, sql`SELECT l.source, count(*)::int AS leads, count(*) FILTER (WHERE l.status = 'converted')::int AS converted,
        coalesce(sum(o.amount) FILTER (WHERE o.status = 'won'), 0)::text AS won_value
      FROM crm_leads l LEFT JOIN crm_opportunities o ON o.id = l.opportunity_id AND o.deleted_at IS NULL
      WHERE l.deleted_at IS NULL AND l.company_id = ${company} AND l.created_at >= ${f.from}::date AND l.created_at < ${f.to}::date + 1 GROUP BY l.source ORDER BY leads DESC`);
    const closed = await one<{ won: number; won_value: string; lost: number }>(tx, sql`SELECT count(*) FILTER (WHERE status = 'won')::int AS won, coalesce(sum(amount) FILTER (WHERE status = 'won'), 0)::text AS won_value,
      count(*) FILTER (WHERE status = 'lost')::int AS lost FROM crm_opportunities WHERE deleted_at IS NULL AND company_id = ${company} AND closed_on BETWEEN ${f.from}::date AND ${f.to}::date`);
    const pipeline = await rows(tx, sql`SELECT s.id, s.name, s.sort, count(o.id)::int AS count, coalesce(sum(o.amount), 0)::text AS value,
        coalesce(round(sum(o.amount * coalesce(o.probability, s.probability) / 100.0)), 0)::text AS weighted
      FROM crm_pipeline_stages s LEFT JOIN crm_opportunities o ON o.stage_id = s.id AND o.status = 'open' AND o.deleted_at IS NULL
      WHERE s.company_id = ${company} AND s.kind = 'open' AND NOT s.archived GROUP BY s.id ORDER BY s.sort`);
    const byOwner = await rows(tx, sql`SELECT o.owner_id, count(*) FILTER (WHERE o.status = 'open')::int AS open, coalesce(sum(o.amount) FILTER (WHERE o.status = 'open'), 0)::text AS open_value,
        count(*) FILTER (WHERE o.status = 'won' AND o.closed_on BETWEEN ${f.from}::date AND ${f.to}::date)::int AS won,
        coalesce(sum(o.amount) FILTER (WHERE o.status = 'won' AND o.closed_on BETWEEN ${f.from}::date AND ${f.to}::date), 0)::text AS won_value,
        count(*) FILTER (WHERE o.status = 'lost' AND o.closed_on BETWEEN ${f.from}::date AND ${f.to}::date)::int AS lost
      FROM crm_opportunities o WHERE o.deleted_at IS NULL AND o.company_id = ${company} GROUP BY o.owner_id ORDER BY won_value DESC`);
    const lostReasons = await rows(tx, sql`SELECT lost_reason AS reason, count(*)::int AS n FROM crm_opportunities WHERE deleted_at IS NULL AND company_id = ${company} AND status = 'lost'
      AND closed_on BETWEEN ${f.from}::date AND ${f.to}::date GROUP BY lost_reason ORDER BY n DESC LIMIT 10`);
    const l = leads!;
    const c = closed!;
    return {
      leads: { ...l, conversionRate: l.total ? (l.converted / l.total) * 100 : null },
      opportunities: { ...c, winRate: c.won + c.lost ? (c.won / (c.won + c.lost)) * 100 : null },
      bySource,
      pipeline,
      byOwner,
      lostReasons,
    };
  });
}

// ---------------------------------------------------------------- tenant-wide: widgets, jobs, providers

export async function pipelineWidget(ctx: ModuleRequestContext) {
  return ctx.db.transaction(async (tx) => {
    await stagesOf(tx, ctx.tenantId, ctx.companyId);
    const stages = await rows<{ name: string; count: number; value: string; weighted: string }>(tx, sql`SELECT s.name, count(o.id)::int AS count, coalesce(sum(o.amount), 0)::text AS value,
        coalesce(round(sum(o.amount * coalesce(o.probability, s.probability) / 100.0)), 0)::text AS weighted
      FROM crm_pipeline_stages s LEFT JOIN crm_opportunities o ON o.stage_id = s.id AND o.status = 'open' AND o.deleted_at IS NULL AND ${scope(ctx, 'crm.pipeline.view', O)}
      WHERE s.company_id = ${ctx.companyId} AND s.kind = 'open' AND NOT s.archived GROUP BY s.id ORDER BY s.sort`);
    return { stages };
  });
}

export async function followups(ctx: ModuleRequestContext, today: string) {
  return ctx.db.transaction(async (tx) => {
    const leads = await rows(tx, sql`SELECT l.id, l.title, l.next_contact_on::text AS due, 'lead' AS type FROM crm_leads l WHERE l.deleted_at IS NULL AND l.owner_id = ${ctx.userId}
      AND l.status NOT IN ('converted', 'lost') AND l.next_contact_on <= ${today}::date`);
    const opps = await rows(tx, sql`SELECT o.id, o.title, o.next_contact_on::text AS due, 'opportunity' AS type FROM crm_opportunities o WHERE o.deleted_at IS NULL AND o.owner_id = ${ctx.userId}
      AND o.status = 'open' AND o.next_contact_on <= ${today}::date`);
    return { items: [...leads, ...opps].sort((a, b) => String(a.due).localeCompare(String(b.due))).slice(0, 15) };
  });
}

/** Daily: reminds owners of leads and opportunities due for contact today (once per record and date). */
export async function followupReminders(ctx: ModuleEventContext, today: string) {
  const due = await ctx.db.transaction(async (tx) => {
    const items = await rows<{ id: string; company_id: string; title: string; owner_id: string; type: string }>(tx, sql`
      SELECT id, company_id, title, owner_id, 'lead' AS type FROM crm_leads WHERE deleted_at IS NULL AND status NOT IN ('converted', 'lost') AND next_contact_on = ${today}::date AND owner_id IS NOT NULL
      UNION ALL
      SELECT id, company_id, title, owner_id, 'opportunity' AS type FROM crm_opportunities WHERE deleted_at IS NULL AND status = 'open' AND next_contact_on = ${today}::date AND owner_id IS NOT NULL`);
    const fresh = [];
    for (const i of items) {
      const r = await tx.execute(sql`INSERT INTO crm_alerts (id, tenant_id, company_id, alert_key) VALUES (${randomUUID()}, ${ctx.tenantId}, ${i.company_id}, ${`followup:${i.type}:${i.id}:${today}`}) ON CONFLICT DO NOTHING RETURNING id`);
      if (r.rows.length) fresh.push(i);
    }
    return fresh;
  });
  for (const i of due) {
    await ctx.notify({ userIds: [i.owner_id], type: 'crm.followup', title: `امروز موعد پیگیری «${i.title}» است`, link: i.type === 'lead' ? `/app/crm/leads/${i.id}` : `/app/crm/opportunities/${i.id}` });
  }
  return due.length;
}

export async function searchAccounts(ctx: ModuleRequestContext, q: string, limit: number) {
  const r = await ctx.db.transaction((tx) => rows<{ id: string; name: string; city: string }>(tx, sql`SELECT a.id, a.name, a.city FROM crm_accounts a WHERE a.deleted_at IS NULL AND ${scope(ctx, 'crm.account.view', A)} AND a.name ILIKE ${like(q)} LIMIT ${limit}`));
  return r.map((x) => ({ entityType: 'account', entityId: x.id, title: x.name, snippet: x.city, link: `/app/crm/accounts/${x.id}` }));
}

export async function searchOpportunities(ctx: ModuleRequestContext, q: string, limit: number) {
  const r = await ctx.db.transaction((tx) => rows<{ id: string; title: string; account: string }>(tx, sql`SELECT o.id, o.title, a.name AS account FROM crm_opportunities o JOIN crm_accounts a ON a.id = o.account_id
    WHERE o.deleted_at IS NULL AND ${scope(ctx, 'crm.pipeline.view', O)} AND o.title ILIKE ${like(q)} LIMIT ${limit}`));
  return r.map((x) => ({ entityType: 'opportunity', entityId: x.id, title: x.title, snippet: x.account, link: `/app/crm/opportunities/${x.id}` }));
}

/** Public service crm.accounts@1 (contracts and projects link to accounts). */
export function publicService(ctx: ModuleEventContext) {
  return {
    search: (q: string, limit: number) =>
      ctx.db.transaction((tx) => rows<{ id: string; title: string }>(tx, sql`SELECT id, name AS title FROM crm_accounts WHERE deleted_at IS NULL AND (${q === ''} OR name ILIKE ${like(q)}) ORDER BY name LIMIT ${Math.min(50, limit)}`)),
    get: async (id: string) => (await ctx.db.transaction((tx) => one<{ id: string; title: string }>(tx, sql`SELECT id, name AS title FROM crm_accounts WHERE id = ${id} AND deleted_at IS NULL`))) ?? null,
  };
}

export async function wonValue(ctx: ModuleEventContext, p: { companyId: string; from: string; to: string }) {
  const r = await ctx.db.transaction((tx) => one<{ v: string }>(tx, sql`SELECT coalesce(sum(amount), 0)::text AS v FROM crm_opportunities WHERE deleted_at IS NULL AND company_id = ${p.companyId}
    AND status = 'won' AND closed_on >= ${p.from.slice(0, 10)}::date AND closed_on < ${p.to.slice(0, 10)}::date`));
  return Number(r!.v);
}

export async function newLeads(ctx: ModuleEventContext, p: { companyId: string; from: string; to: string }) {
  const r = await ctx.db.transaction((tx) => one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM crm_leads WHERE deleted_at IS NULL AND company_id = ${p.companyId} AND created_at >= ${p.from} AND created_at < ${p.to}`));
  return r!.n;
}
