import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, ModuleEventContext, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { addDays, normalizePersian, zonedToUtc } from '@mohandesyar/persian';
import { conflict, forbidden, invalid, notFound } from './errors.js';
import type {
  applyInput, candidateInput, candidateQuery, evaluationInput, fileInput, formInput, interviewInput, jobInput, moveInput, reportQuery, retentionInput, scoringInput, stageInput,
} from './inputs.js';
import { experienceYears, scoreCandidate, scoringSchema, type ScoringCandidate } from './scoring.js';

type Row = Record<string, unknown>;
const rows = async <T = Row>(tx: Db, q: SQL) => (await tx.execute(q)).rows as T[];
const one = async <T = Row>(tx: Db, q: SQL) => (await rows<T>(tx, q))[0];
const TZ = 'Asia/Tehran';
const ANON_NAME = 'رزومه حذف‌شده';

/** Months → ISO date, clamped to the month's last day (e.g. 2024-02-29 + 12 months → 2025-02-28). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

/** Search words → a prefix tsquery over the normalised text ("simple" config: no stemming, works for Persian). */
export function toTsQuery(q: string): string | null {
  const words = normalizePersian(q)
    .split(' ')
    .map((w) => w.replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter(Boolean)
    .slice(0, 8);
  return words.length ? words.map((w) => `${w}:*`).join(' & ') : null;
}

// ---------------------------------------------------------------- candidate data

interface CandidateFull extends ScoringCandidate {
  id: string;
  company_id: string;
  full_name: string;
  status: string;
}

async function loadScoring(tx: Db, ids: string[]): Promise<Map<string, CandidateFull>> {
  if (!ids.length) return new Map();
  const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const base = await rows<CandidateFull>(tx, sql`SELECT id, company_id, full_name, status, city, expected_salary::text, available_from::text, summary FROM recruitment_candidates WHERE id IN (${list})`);
  const map = new Map(base.map((c) => [c.id, { ...c, educations: [], experiences: [], projects: [], skills: [] } as CandidateFull]));
  for (const e of await rows<{ candidate_id: string; degree: string; field: string }>(tx, sql`SELECT candidate_id, degree, field FROM recruitment_educations WHERE candidate_id IN (${list})`)) map.get(e.candidate_id)?.educations.push(e);
  for (const e of await rows<{ candidate_id: string; title: string; description: string; started_on: string; ended_on: string | null }>(
    tx,
    sql`SELECT candidate_id, title, description, started_on::text, ended_on::text FROM recruitment_experiences WHERE candidate_id IN (${list})`,
  ))
    map.get(e.candidate_id)?.experiences.push(e);
  for (const p of await rows<{ candidate_id: string; title: string; role: string; description: string }>(tx, sql`SELECT candidate_id, title, role, description FROM recruitment_candidate_projects WHERE candidate_id IN (${list})`))
    map.get(p.candidate_id)?.projects.push(p);
  for (const s of await rows<{ candidate_id: string; kind: string; name: string; level: number }>(tx, sql`SELECT candidate_id, kind, name, level FROM recruitment_skills WHERE candidate_id IN (${list})`))
    map.get(s.candidate_id)?.skills.push(s);
  return map;
}

/** Rebuilds the full-text document of a candidate from its structured resume. */
async function reindex(tx: Db, id: string) {
  // Normalise the stored document the same way queries are normalised (Arabic letter variants, digits, ZWNJ).
  const r = await one<{ doc: string }>(tx, sql`SELECT c.name_norm || ' ' || coalesce((SELECT string_agg(x, ' ') FROM (
      SELECT c.desired_position || ' ' || c.city || ' ' || c.summary AS x
      UNION ALL SELECT field || ' ' || institution FROM recruitment_educations WHERE candidate_id = c.id
      UNION ALL SELECT employer || ' ' || title || ' ' || description FROM recruitment_experiences WHERE candidate_id = c.id
      UNION ALL SELECT title || ' ' || role || ' ' || client || ' ' || description FROM recruitment_candidate_projects WHERE candidate_id = c.id
      UNION ALL SELECT name || ' ' || detail FROM recruitment_skills WHERE candidate_id = c.id) parts), '') AS doc FROM recruitment_candidates c WHERE c.id = ${id}`);
  if (r) await tx.execute(sql`UPDATE recruitment_candidates SET search_doc = to_tsvector('simple', ${normalizePersian(r.doc)}) WHERE id = ${id}`);
}

async function replaceChildren(tx: Db, ctx: ModuleRequestContext, id: string, companyId: string, input: z.infer<typeof candidateInput>) {
  for (const t of ['recruitment_educations', 'recruitment_experiences', 'recruitment_candidate_projects', 'recruitment_skills']) {
    await tx.execute(sql`DELETE FROM ${sql.raw(t)} WHERE candidate_id = ${id}`);
  }
  const base = { tenant: ctx.tenantId, company: companyId };
  for (const e of input.educations) {
    await tx.execute(sql`INSERT INTO recruitment_educations (id, tenant_id, company_id, candidate_id, degree, field, institution, end_year)
      VALUES (${randomUUID()}, ${base.tenant}, ${base.company}, ${id}, ${e.degree}, ${e.field}, ${e.institution}, ${e.endYear})`);
  }
  for (const e of input.experiences) {
    await tx.execute(sql`INSERT INTO recruitment_experiences (id, tenant_id, company_id, candidate_id, employer, title, started_on, ended_on, description)
      VALUES (${randomUUID()}, ${base.tenant}, ${base.company}, ${id}, ${e.employer}, ${e.title}, ${e.startedOn}, ${e.endedOn}, ${e.description})`);
  }
  for (const p of input.projects) {
    await tx.execute(sql`INSERT INTO recruitment_candidate_projects (id, tenant_id, company_id, candidate_id, title, role, client, year, description)
      VALUES (${randomUUID()}, ${base.tenant}, ${base.company}, ${id}, ${p.title}, ${p.role}, ${p.client}, ${p.year}, ${p.description})`);
  }
  const seen = new Set<string>();
  for (const s of input.skills) {
    const key = `${s.kind}:${normalizePersian(s.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await tx.execute(sql`INSERT INTO recruitment_skills (id, tenant_id, company_id, candidate_id, kind, name, name_norm, level, detail)
      VALUES (${randomUUID()}, ${base.tenant}, ${base.company}, ${id}, ${s.kind}, ${s.name}, ${normalizePersian(s.name)}, ${s.level}, ${s.detail})`);
  }
}

/** Rule-based duplicate detection: same mobile, same e-mail or same normalised full name (docs/05). */
async function detectDuplicates(tx: Db, ctx: { tenantId: string }, id: string): Promise<number> {
  const c = await one<{ company_id: string; mobile: string | null; email: string | null; name_norm: string; status: string }>(
    tx,
    sql`SELECT company_id, mobile, email, name_norm, status FROM recruitment_candidates WHERE id = ${id}`,
  );
  if (!c || c.status === 'merged' || c.status === 'anonymized') return 0;
  const others = await rows<{ id: string; mobile: boolean; email: boolean; name: boolean }>(
    tx,
    sql`SELECT id, (mobile = ${c.mobile}) IS TRUE AS mobile, (email = ${c.email}) IS TRUE AS email, (name_norm = ${c.name_norm}) AS name
      FROM recruitment_candidates WHERE company_id = ${c.company_id} AND id <> ${id} AND status NOT IN ('merged', 'anonymized')
        AND ((mobile IS NOT NULL AND mobile = ${c.mobile}) OR (email IS NOT NULL AND email = ${c.email}) OR name_norm = ${c.name_norm})`,
  );
  for (const o of others) {
    const rules = [o.mobile && 'mobile', o.email && 'email', o.name && 'name'].filter(Boolean) as string[];
    const [a, b] = id < o.id ? [id, o.id] : [o.id, id];
    await tx.execute(sql`INSERT INTO recruitment_duplicates (id, tenant_id, company_id, a_id, b_id, rules) VALUES (${randomUUID()}, ${ctx.tenantId}, ${c.company_id}, ${a}, ${b}, ${`{${rules.join(",")}}`}::text[])
      ON CONFLICT (a_id, b_id) DO UPDATE SET rules = EXCLUDED.rules WHERE recruitment_duplicates.status = 'open'`);
  }
  return others.length;
}

/** Re-scores the given applications (or all applications of a job) against the job's current profile. */
async function rescore(tx: Db, where: SQL, today: string) {
  const apps = await rows<{ id: string; candidate_id: string; scoring: unknown; scoring_version: number }>(
    tx,
    sql`SELECT a.id, a.candidate_id, j.scoring, j.scoring_version FROM recruitment_applications a JOIN recruitment_jobs j ON j.id = a.job_id WHERE ${where}`,
  );
  const cands = await loadScoring(tx, [...new Set(apps.map((a) => a.candidate_id))]);
  for (const a of apps) {
    const c = cands.get(a.candidate_id);
    if (!c || c.status === 'anonymized') continue;
    const criteria = scoringSchema.parse(a.scoring);
    const r = scoreCandidate(criteria, c, today);
    await tx.execute(sql`UPDATE recruitment_applications SET score = ${r.score}, score_breakdown = ${JSON.stringify(r.breakdown)}::jsonb, scoring_version = ${a.scoring_version},
      scored_at = now(), updated_at = now() WHERE id = ${a.id}`);
  }
}

/** Removes personal data of a candidate; aggregate hiring statistics (applications, stages, dates) remain. */
async function anonymize(tx: Db, ctx: { tenantId: string; audit: ModuleEventContext['audit'] }, id: string, reason: 'retention' | 'request'): Promise<string[]> {
  const files = (await rows<{ file_id: string }>(tx, sql`DELETE FROM recruitment_files WHERE candidate_id = ${id} RETURNING file_id`)).map((f) => f.file_id);
  for (const t of ['recruitment_educations', 'recruitment_experiences', 'recruitment_candidate_projects', 'recruitment_skills']) {
    await tx.execute(sql`DELETE FROM ${sql.raw(t)} WHERE candidate_id = ${id}`);
  }
  await tx.execute(sql`DELETE FROM recruitment_duplicates WHERE (a_id = ${id} OR b_id = ${id}) AND status = 'open'`);
  await tx.execute(sql`UPDATE recruitment_applications SET score_breakdown = '[]', rejection_reason = '' WHERE candidate_id = ${id}`);
  await tx.execute(sql`UPDATE recruitment_interviews i SET notes = '' FROM recruitment_applications a WHERE a.id = i.application_id AND a.candidate_id = ${id}`);
  await tx.execute(sql`UPDATE recruitment_candidates SET full_name = ${ANON_NAME}, name_norm = '', mobile = NULL, email = NULL, city = '', desired_position = '', expected_salary = NULL,
    available_from = NULL, referrer = '', portfolio_url = '', summary = '', consent_note = '', search_doc = ''::tsvector, status = 'anonymized', updated_at = now() WHERE id = ${id}`);
  await ctx.audit({ action: 'recruitment.candidate.anonymized', entityType: 'candidate', entityId: id, after: { reason, files: files.length } }, tx);
  return files;
}

// ---------------------------------------------------------------- candidates

export interface CandidateListRow {
  id: string;
  full_name: string;
  desired_position: string;
  city: string;
  mobile: string | null;
  email: string | null;
  status: string;
  source: string;
  expected_salary: string | null;
  created_at: string;
  retention_until: string;
  skills: string[] | null;
  degree: string | null;
  duplicates: number;
  applications: number;
  years?: number;
}

export const Candidates = {
  async list(ctx: ModuleRequestContext, f: z.infer<typeof candidateQuery>, today: string) {
    return ctx.db.transaction(async (tx) => {
      const ts = f.q ? toTsQuery(f.q) : null;
      const like = f.q ? `%${normalizePersian(f.q).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null;
      const list = await rows<CandidateListRow>(
        tx,
        sql`SELECT c.id, c.full_name, c.desired_position, c.city, c.mobile, c.email, c.status, c.source, c.expected_salary::text, c.created_at, c.retention_until::text,
          (SELECT array_agg(s.name ORDER BY s.level DESC, s.name) FROM (SELECT name, level FROM recruitment_skills s WHERE s.candidate_id = c.id ORDER BY level DESC LIMIT 5) s) AS skills,
          (SELECT e.degree FROM recruitment_educations e WHERE e.candidate_id = c.id ORDER BY array_position(ARRAY['phd','master','bachelor','associate','diploma','other'], e.degree) LIMIT 1) AS degree,
          (SELECT count(*)::int FROM recruitment_duplicates d WHERE d.status = 'open' AND (d.a_id = c.id OR d.b_id = c.id)) AS duplicates,
          (SELECT count(*)::int FROM recruitment_applications a WHERE a.candidate_id = c.id) AS applications
        FROM recruitment_candidates c
        WHERE ${f.status === 'all' ? sql`c.status IN ('active', 'hired', 'archived')` : sql`c.status = ${f.status}`}
          ${ts ? sql`AND (c.search_doc @@ to_tsquery('simple', ${ts}) OR c.mobile ILIKE ${like} OR c.email ILIKE ${like})` : sql``}
          ${f.skill ? sql`AND EXISTS (SELECT 1 FROM recruitment_skills s WHERE s.candidate_id = c.id AND s.name_norm = ${normalizePersian(f.skill)})` : sql``}
          ${f.degree ? sql`AND EXISTS (SELECT 1 FROM recruitment_educations e WHERE e.candidate_id = c.id AND array_position(ARRAY['diploma','associate','bachelor','master','phd'], e.degree) >= array_position(ARRAY['diploma','associate','bachelor','master','phd'], ${f.degree}))` : sql``}
          ${f.maxSalary !== undefined ? sql`AND c.expected_salary <= ${f.maxSalary}` : sql``}
          ${f.city ? sql`AND c.city ILIKE ${`%${f.city.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`}` : sql``}
          ${f.jobId ? sql`AND NOT EXISTS (SELECT 1 FROM recruitment_applications a WHERE a.candidate_id = c.id AND a.job_id = ${f.jobId})` : sql``}
        ORDER BY ${ts ? sql`ts_rank(c.search_doc, to_tsquery('simple', ${ts})) DESC,` : sql``} c.created_at DESC LIMIT 500`,
      );
      // Years of experience are computed from the dated periods (overlaps counted once), as in scoring.
      const exp = list.length
        ? await rows<{ candidate_id: string; started_on: string; ended_on: string | null }>(
            tx,
            sql`SELECT candidate_id, started_on::text, ended_on::text FROM recruitment_experiences WHERE candidate_id IN (${sql.join(list.map((c) => sql`${c.id}::uuid`), sql`, `)})`,
          )
        : [];
      for (const c of list) c.years = Math.round(experienceYears(exp.filter((e) => e.candidate_id === c.id), today) * 10) / 10;
      return f.minYears !== undefined ? list.filter((c) => c.years! >= f.minYears!) : list;
    });
  },

  async get(ctx: ModuleRequestContext, id: string) {
    return ctx.db.transaction(async (tx) => {
      const c = await one(tx, sql`SELECT id, full_name, mobile, email, city, desired_position, expected_salary::text, available_from::text, referrer, source, portfolio_url, summary,
          consent_on::text, consent_note, retention_until::text, status, merged_into, created_at, created_by, updated_at
        FROM recruitment_candidates WHERE id = ${id} AND status <> 'anonymized'`);
      if (!c) throw notFound('متقاضی');
      const [educations, experiences, projects, skills, files, applications, duplicates] = await Promise.all([
        rows(tx, sql`SELECT id, degree, field, institution, end_year FROM recruitment_educations WHERE candidate_id = ${id} ORDER BY end_year DESC NULLS LAST, id`),
        rows(tx, sql`SELECT id, employer, title, started_on::text, ended_on::text, description FROM recruitment_experiences WHERE candidate_id = ${id} ORDER BY started_on DESC`),
        rows(tx, sql`SELECT id, title, role, client, year, description FROM recruitment_candidate_projects WHERE candidate_id = ${id} ORDER BY year DESC NULLS LAST, title`),
        rows(tx, sql`SELECT id, kind, name, level, detail FROM recruitment_skills WHERE candidate_id = ${id} ORDER BY kind, level DESC, name`),
        rows(tx, sql`SELECT id, file_id, kind, name, size, created_at, created_by FROM recruitment_files WHERE candidate_id = ${id} ORDER BY created_at DESC`),
        rows(tx, sql`SELECT a.id, a.job_id, j.title AS job_title, a.stage_id, s.name AS stage_name, s.kind AS stage_kind, a.score::float, a.created_at, a.hired_on::text
          FROM recruitment_applications a JOIN recruitment_jobs j ON j.id = a.job_id JOIN recruitment_stages s ON s.id = a.stage_id WHERE a.candidate_id = ${id} ORDER BY a.created_at DESC`),
        rows(tx, sql`SELECT d.id, d.rules, CASE WHEN d.a_id = ${id} THEN d.b_id ELSE d.a_id END AS other_id, o.full_name AS other_name
          FROM recruitment_duplicates d JOIN recruitment_candidates o ON o.id = CASE WHEN d.a_id = ${id} THEN d.b_id ELSE d.a_id END
          WHERE d.status = 'open' AND (d.a_id = ${id} OR d.b_id = ${id})`),
      ]);
      // Viewing a resume (personal data) is recorded (docs/05: sensitive views are logged).
      await ctx.audit({ action: 'recruitment.candidate.viewed', entityType: 'candidate', entityId: id }, tx);
      return { candidate: c, educations, experiences, projects, skills, files, applications, duplicates };
    });
  },

  async save(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof candidateInput>, today: string) {
    if (input.consentOn > today) throw invalid('CONSENT_DATE', 'تاریخ رضایت نمی‌تواند در آینده باشد');
    const { retentionMonths } = await ctx.settings<{ retentionMonths: number }>();
    return ctx.db.transaction(async (tx) => {
      let companyId = ctx.companyId;
      const retention = addMonths(input.consentOn, retentionMonths);
      const fields = sql`full_name = ${input.fullName}, name_norm = ${normalizePersian(input.fullName)}, mobile = ${input.mobile}, email = ${input.email}, city = ${input.city},
        desired_position = ${input.desiredPosition}, expected_salary = ${input.expectedSalary}, available_from = ${input.availableFrom}, referrer = ${input.referrer}, source = ${input.source},
        portfolio_url = ${input.portfolioUrl}, summary = ${input.summary}`;
      if (id) {
        const cur = await one<{ company_id: string; status: string; consent_on: string }>(tx, sql`SELECT company_id, status, consent_on::text FROM recruitment_candidates WHERE id = ${id} FOR UPDATE`);
        if (!cur || cur.status === 'anonymized') throw notFound('متقاضی');
        if (cur.status === 'merged') throw conflict('MERGED', 'این رزومه در رزومه دیگری ادغام شده است');
        companyId = cur.company_id;
        // A renewed consent restarts the retention period; an unchanged one keeps it.
        const consent = input.consentOn !== cur.consent_on ? sql`, consent_on = ${input.consentOn}, consent_note = ${input.consentNote}, retention_until = ${retention}` : sql`, consent_note = ${input.consentNote}`;
        await tx.execute(sql`UPDATE recruitment_candidates SET ${fields} ${consent}, updated_at = now() WHERE id = ${id}`);
      } else {
        id = randomUUID();
        await tx.execute(sql`INSERT INTO recruitment_candidates (id, tenant_id, company_id, full_name, name_norm, consent_on, consent_note, retention_until, created_by)
          VALUES (${id}, ${ctx.tenantId}, ${companyId}, ${input.fullName}, '', ${input.consentOn}, ${input.consentNote}, ${retention}, ${ctx.userId})`);
        await tx.execute(sql`UPDATE recruitment_candidates SET ${fields} WHERE id = ${id}`);
      }
      await replaceChildren(tx, ctx, id, companyId, input);
      await reindex(tx, id);
      const duplicates = await detectDuplicates(tx, ctx, id);
      await rescore(tx, sql`a.candidate_id = ${id}`, today);
      await ctx.audit({ action: 'recruitment.candidate.saved', entityType: 'candidate', entityId: id }, tx);
      return { id, duplicates };
    });
  },

  async setStatus(ctx: ModuleRequestContext, id: string, status: 'active' | 'archived') {
    await ctx.db.transaction(async (tx) => {
      const r = await rows(tx, sql`UPDATE recruitment_candidates SET status = ${status}, updated_at = now() WHERE id = ${id} AND status IN ('active', 'archived', 'hired') RETURNING id`);
      if (!r.length) throw notFound('متقاضی');
    });
  },

  async renewConsent(ctx: ModuleRequestContext, id: string, input: z.infer<typeof retentionInput>, today: string) {
    if (input.consentOn > today) throw invalid('CONSENT_DATE', 'تاریخ رضایت نمی‌تواند در آینده باشد');
    const { retentionMonths } = await ctx.settings<{ retentionMonths: number }>();
    const until = addMonths(input.consentOn, retentionMonths);
    await ctx.db.transaction(async (tx) => {
      const r = await rows(tx, sql`UPDATE recruitment_candidates SET consent_on = ${input.consentOn}, consent_note = ${input.consentNote}, retention_until = ${until}, updated_at = now()
        WHERE id = ${id} AND status IN ('active', 'archived', 'hired') RETURNING id`);
      if (!r.length) throw notFound('متقاضی');
      await ctx.audit({ action: 'recruitment.consent.renewed', entityType: 'candidate', entityId: id, after: { consentOn: input.consentOn, retentionUntil: until } }, tx);
    });
    return { retentionUntil: until };
  },

  /** Deletion on the candidate's request: personal data and files are erased now (statistics remain). */
  async erase(ctx: ModuleRequestContext, id: string) {
    const files = await ctx.db.transaction(async (tx) => {
      const c = await one(tx, sql`SELECT id FROM recruitment_candidates WHERE id = ${id} AND status <> 'anonymized' FOR UPDATE`);
      if (!c) throw notFound('متقاضی');
      return anonymize(tx, ctx, id, 'request');
    });
    for (const f of files) await ctx.files.remove(f);
  },

  // ---- files
  async attachFile(ctx: ModuleRequestContext, id: string, input: z.infer<typeof fileInput>) {
    return ctx.db.transaction(async (tx) => {
      const c = await one<{ company_id: string }>(tx, sql`SELECT company_id FROM recruitment_candidates WHERE id = ${id} AND status IN ('active', 'archived', 'hired') FOR UPDATE`);
      if (!c) throw notFound('متقاضی');
      const f = await ctx.files.claim(input.fileId, { type: 'candidate', id }, tx);
      const rid = randomUUID();
      await tx.execute(sql`INSERT INTO recruitment_files (id, tenant_id, company_id, candidate_id, file_id, kind, name, size, created_by)
        VALUES (${rid}, ${ctx.tenantId}, ${c.company_id}, ${id}, ${f.id}, ${input.kind}, ${f.name}, ${f.size}, ${ctx.userId})`);
      return { id: rid, name: f.name };
    });
  },

  async removeFile(ctx: ModuleRequestContext, id: string, fileRowId: string) {
    const fileId = await ctx.db.transaction(async (tx) => {
      const r = await one<{ file_id: string }>(tx, sql`DELETE FROM recruitment_files WHERE id = ${fileRowId} AND candidate_id = ${id} RETURNING file_id`);
      if (!r) throw notFound('فایل');
      await ctx.audit({ action: 'recruitment.file.deleted', entityType: 'candidate', entityId: id, after: { fileId: r.file_id } }, tx);
      return r.file_id;
    });
    await ctx.files.remove(fileId);
  },

  /** Download link: recruiters, or an interviewer with an interview for this candidate. Every issue is audited. */
  async fileUrl(ctx: ModuleRequestContext, id: string, fileRowId: string) {
    const f = await ctx.db.transaction(async (tx) => {
      const r = await one<{ file_id: string }>(tx, sql`SELECT file_id FROM recruitment_files WHERE id = ${fileRowId} AND candidate_id = ${id}`);
      if (!r) throw notFound('فایل');
      if (!ctx.can('recruitment.candidate.view', 'company')) {
        const assigned = await one(tx, sql`SELECT 1 FROM recruitment_interviews i JOIN recruitment_applications a ON a.id = i.application_id
          WHERE a.candidate_id = ${id} AND i.interviewer_id = ${ctx.userId} AND i.status <> 'cancelled' LIMIT 1`);
        if (!assigned) throw notFound('فایل');
      }
      await ctx.audit({ action: 'recruitment.file.downloaded', entityType: 'candidate', entityId: id, after: { fileId: r.file_id } }, tx);
      return r;
    });
    return ctx.files.url(f.file_id);
  },
};

// ---------------------------------------------------------------- duplicates & merge

export const Duplicates = {
  list: (ctx: ModuleRequestContext) =>
    ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT d.id, d.rules, d.created_at,
          json_build_object('id', a.id, 'full_name', a.full_name, 'mobile', a.mobile, 'email', a.email, 'desired_position', a.desired_position, 'created_at', a.created_at, 'status', a.status) AS a,
          json_build_object('id', b.id, 'full_name', b.full_name, 'mobile', b.mobile, 'email', b.email, 'desired_position', b.desired_position, 'created_at', b.created_at, 'status', b.status) AS b
        FROM recruitment_duplicates d JOIN recruitment_candidates a ON a.id = d.a_id JOIN recruitment_candidates b ON b.id = d.b_id
        WHERE d.status = 'open' ORDER BY d.created_at DESC LIMIT 300`),
    ),

  async dismiss(ctx: ModuleRequestContext, pairId: string) {
    await ctx.db.transaction(async (tx) => {
      const r = await rows(tx, sql`UPDATE recruitment_duplicates SET status = 'dismissed', resolved_by = ${ctx.userId}, resolved_at = now() WHERE id = ${pairId} AND status = 'open' RETURNING id`);
      if (!r.length) throw notFound('مورد تکراری');
    });
  },

  /**
   * Merges the other candidate of the pair into `keepId`: empty fields are filled, resume items, files and
   * applications move (an application to the same job keeps the kept one and moves its interviews), and
   * the merged record keeps only a pointer to the kept one.
   */
  async merge(ctx: ModuleRequestContext, pairId: string, keepId: string, today: string) {
    await ctx.db.transaction(async (tx) => {
      const p = await one<{ a_id: string; b_id: string }>(tx, sql`SELECT a_id, b_id FROM recruitment_duplicates WHERE id = ${pairId} AND status = 'open' FOR UPDATE`);
      if (!p) throw notFound('مورد تکراری');
      if (keepId !== p.a_id && keepId !== p.b_id) throw invalid('KEEP_ID', 'رزومه نگه‌داشته باید یکی از دو رزومه باشد');
      const drop = keepId === p.a_id ? p.b_id : p.a_id;
      await tx.execute(sql`SELECT id FROM recruitment_candidates WHERE id IN (${keepId}, ${drop}) ORDER BY id FOR UPDATE`);
      await tx.execute(sql`UPDATE recruitment_candidates k SET
          mobile = coalesce(k.mobile, d.mobile), email = coalesce(k.email, d.email), city = CASE WHEN k.city = '' THEN d.city ELSE k.city END,
          desired_position = CASE WHEN k.desired_position = '' THEN d.desired_position ELSE k.desired_position END, expected_salary = coalesce(k.expected_salary, d.expected_salary),
          available_from = coalesce(k.available_from, d.available_from), referrer = CASE WHEN k.referrer = '' THEN d.referrer ELSE k.referrer END,
          portfolio_url = CASE WHEN k.portfolio_url = '' THEN d.portfolio_url ELSE k.portfolio_url END, summary = CASE WHEN k.summary = '' THEN d.summary ELSE k.summary END,
          consent_on = greatest(k.consent_on, d.consent_on), retention_until = greatest(k.retention_until, d.retention_until),
          status = CASE WHEN 'hired' IN (k.status, d.status) THEN 'hired' ELSE k.status END, updated_at = now()
        FROM recruitment_candidates d WHERE k.id = ${keepId} AND d.id = ${drop}`);
      for (const t of ['recruitment_educations', 'recruitment_experiences', 'recruitment_candidate_projects', 'recruitment_skills', 'recruitment_files']) {
        await tx.execute(sql`UPDATE ${sql.raw(t)} SET candidate_id = ${keepId} WHERE candidate_id = ${drop}`);
      }
      // Identical items from both resumes are kept once (the higher skill level wins).
      await tx.execute(sql`DELETE FROM recruitment_skills s USING recruitment_skills t WHERE s.candidate_id = ${keepId} AND t.candidate_id = ${keepId} AND s.kind = t.kind AND s.name_norm = t.name_norm
        AND (s.level < t.level OR (s.level = t.level AND s.id > t.id))`);
      await tx.execute(sql`DELETE FROM recruitment_educations s USING recruitment_educations t WHERE s.candidate_id = ${keepId} AND t.candidate_id = ${keepId} AND s.degree = t.degree AND s.field = t.field AND s.id > t.id`);
      await tx.execute(sql`DELETE FROM recruitment_experiences s USING recruitment_experiences t WHERE s.candidate_id = ${keepId} AND t.candidate_id = ${keepId} AND s.employer = t.employer AND s.title = t.title AND s.started_on = t.started_on AND s.id > t.id`);
      await tx.execute(sql`DELETE FROM recruitment_candidate_projects s USING recruitment_candidate_projects t WHERE s.candidate_id = ${keepId} AND t.candidate_id = ${keepId} AND s.title = t.title AND s.id > t.id`);
      const clash = await rows<{ drop_app: string; keep_app: string }>(tx, sql`SELECT d.id AS drop_app, k.id AS keep_app FROM recruitment_applications d
        JOIN recruitment_applications k ON k.job_id = d.job_id AND k.candidate_id = ${keepId} WHERE d.candidate_id = ${drop}`);
      for (const c of clash) {
        await tx.execute(sql`UPDATE recruitment_interviews SET application_id = ${c.keep_app} WHERE application_id = ${c.drop_app}`);
        await tx.execute(sql`DELETE FROM recruitment_applications WHERE id = ${c.drop_app}`);
      }
      await tx.execute(sql`UPDATE recruitment_applications SET candidate_id = ${keepId} WHERE candidate_id = ${drop}`);
      await tx.execute(sql`UPDATE recruitment_candidates SET status = 'merged', merged_into = ${keepId}, mobile = NULL, email = NULL, summary = '', search_doc = ''::tsvector, updated_at = now() WHERE id = ${drop}`);
      await tx.execute(sql`UPDATE recruitment_duplicates SET status = 'merged', resolved_by = ${ctx.userId}, resolved_at = now() WHERE status = 'open' AND (id = ${pairId} OR a_id = ${drop} OR b_id = ${drop})`);
      await reindex(tx, keepId);
      await detectDuplicates(tx, ctx, keepId);
      await rescore(tx, sql`a.candidate_id = ${keepId}`, today);
      await ctx.audit({ action: 'recruitment.candidate.merged', entityType: 'candidate', entityId: keepId, after: { merged: drop } }, tx);
    });
  },
};

// ---------------------------------------------------------------- stages & interview forms

export const DEFAULT_STAGES: { name: string; kind: 'open' | 'hired' | 'rejected' }[] = [
  { name: 'دریافت رزومه', kind: 'open' },
  { name: 'غربالگری', kind: 'open' },
  { name: 'مصاحبه', kind: 'open' },
  { name: 'پیشنهاد همکاری', kind: 'open' },
  { name: 'استخدام‌شده', kind: 'hired' },
  { name: 'ردشده', kind: 'rejected' },
];

export const DEFAULT_FORM = {
  name: 'ارزیابی عمومی مصاحبه',
  criteria: [
    { key: 'technical', label: 'دانش فنی و تخصصی', weight: 3 },
    { key: 'experience', label: 'تجربه مرتبط با نقش', weight: 3 },
    { key: 'problem_solving', label: 'حل مسئله', weight: 2 },
    { key: 'communication', label: 'مهارت ارتباطی و کار تیمی', weight: 2 },
    { key: 'motivation', label: 'انگیزه و تناسب با نقش', weight: 1 },
  ],
};

export interface Stage {
  id: string;
  name: string;
  sort: number;
  kind: 'open' | 'hired' | 'rejected';
  archived: boolean;
}

/** Stages of a company; the default pipeline (and interview form) are created on first use. */
async function stagesOf(tx: Db, tenantId: string, companyId: string, userId: string): Promise<Stage[]> {
  const q = sql`SELECT id, name, sort, kind, archived FROM recruitment_stages WHERE company_id = ${companyId} ORDER BY sort, created_at`;
  let s = await rows<Stage>(tx, q);
  if (!s.length) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`recruitment-stages:${companyId}`}))`);
    s = await rows<Stage>(tx, q);
    if (!s.length) {
      let i = 0;
      for (const d of DEFAULT_STAGES) {
        await tx.execute(sql`INSERT INTO recruitment_stages (id, tenant_id, company_id, name, sort, kind) VALUES (${randomUUID()}, ${tenantId}, ${companyId}, ${d.name}, ${++i * 10}, ${d.kind})`);
      }
      if (!(await one(tx, sql`SELECT 1 FROM recruitment_interview_forms WHERE company_id = ${companyId} LIMIT 1`))) {
        await tx.execute(sql`INSERT INTO recruitment_interview_forms (id, tenant_id, company_id, name, criteria, created_by)
          VALUES (${randomUUID()}, ${tenantId}, ${companyId}, ${DEFAULT_FORM.name}, ${JSON.stringify(DEFAULT_FORM.criteria)}::jsonb, ${userId})`);
      }
      s = await rows<Stage>(tx, q);
    }
  }
  return s;
}

export const Stages = {
  list: (ctx: ModuleRequestContext) => ctx.db.transaction((tx) => stagesOf(tx, ctx.tenantId, ctx.companyId, ctx.userId)),

  /** Saves the whole pipeline in its new order; stages are archived, never deleted. */
  async save(ctx: ModuleRequestContext, input: z.infer<typeof stageInput>) {
    await ctx.db.transaction(async (tx) => {
      const cur = await stagesOf(tx, ctx.tenantId, ctx.companyId, ctx.userId);
      const sent = new Set(input.stages.map((s) => s.id).filter(Boolean));
      if (cur.some((s) => !sent.has(s.id))) throw invalid('STAGE_MISSING', 'مرحله‌ها حذف نمی‌شوند؛ مرحله بلااستفاده را بایگانی کنید');
      let i = 0;
      for (const s of input.stages) {
        i += 10;
        if (s.id) {
          const old = cur.find((x) => x.id === s.id);
          if (!old) throw notFound('مرحله');
          const used = await one(tx, sql`SELECT 1 FROM recruitment_applications WHERE stage_id = ${s.id} LIMIT 1`);
          if (used && old.kind !== s.kind) throw conflict('STAGE_IN_USE', `نوع مرحله «${old.name}» که متقاضی دارد قابل تغییر نیست`);
          if (s.archived && !old.archived && (await one(tx, sql`SELECT 1 FROM recruitment_applications a JOIN recruitment_jobs j ON j.id = a.job_id WHERE a.stage_id = ${s.id} AND j.status <> 'closed' LIMIT 1`))) {
            throw conflict('STAGE_IN_USE', `در مرحله «${old.name}» متقاضی فعال وجود دارد؛ ابتدا آن‌ها را منتقل کنید`);
          }
          await tx.execute(sql`UPDATE recruitment_stages SET name = ${s.name}, kind = ${s.kind}, archived = ${s.archived}, sort = ${i} WHERE id = ${s.id}`);
        } else {
          await tx.execute(sql`INSERT INTO recruitment_stages (id, tenant_id, company_id, name, sort, kind, archived) VALUES (${randomUUID()}, ${ctx.tenantId}, ${ctx.companyId}, ${s.name}, ${i}, ${s.kind}, ${s.archived})`);
        }
      }
      await ctx.audit({ action: 'recruitment.stages.saved', entityType: 'pipeline', entityId: ctx.companyId, after: input.stages }, tx);
    });
  },
};

export const Forms = {
  list: (ctx: ModuleRequestContext) =>
    ctx.db.transaction(async (tx) => {
      await stagesOf(tx, ctx.tenantId, ctx.companyId, ctx.userId);
      return rows(tx, sql`SELECT id, name, criteria, archived, created_at FROM recruitment_interview_forms ORDER BY archived, created_at`);
    }),

  async save(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof formInput>) {
    return ctx.db.transaction(async (tx) => {
      if (id) {
        const r = await rows(tx, sql`UPDATE recruitment_interview_forms SET name = ${input.name}, criteria = ${JSON.stringify(input.criteria)}::jsonb, archived = ${input.archived} WHERE id = ${id} RETURNING id`);
        if (!r.length) throw notFound('فرم ارزیابی');
      } else {
        id = randomUUID();
        await tx.execute(sql`INSERT INTO recruitment_interview_forms (id, tenant_id, company_id, name, criteria, archived, created_by)
          VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.name}, ${JSON.stringify(input.criteria)}::jsonb, ${input.archived}, ${ctx.userId})`);
      }
      await ctx.audit({ action: 'recruitment.form.saved', entityType: 'interview_form', entityId: id, after: input }, tx);
      return { id };
    });
  },
};

// ---------------------------------------------------------------- jobs & applications

export const Jobs = {
  list: (ctx: ModuleRequestContext) =>
    ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT j.id, j.title, j.department, j.location, j.employment, j.openings, j.status, j.opened_on::text, j.closed_on::text, jsonb_array_length(j.scoring)::int AS criteria,
          (SELECT count(*)::int FROM recruitment_applications a JOIN recruitment_stages s ON s.id = a.stage_id WHERE a.job_id = j.id AND s.kind = 'open') AS active,
          (SELECT count(*)::int FROM recruitment_applications a JOIN recruitment_stages s ON s.id = a.stage_id WHERE a.job_id = j.id AND s.kind = 'hired') AS hired,
          (SELECT count(*)::int FROM recruitment_applications a WHERE a.job_id = j.id) AS total
        FROM recruitment_jobs j WHERE j.deleted_at IS NULL ORDER BY (j.status = 'open') DESC, j.opened_on DESC LIMIT 300`),
    ),

  async get(ctx: ModuleRequestContext, id: string) {
    return ctx.db.transaction(async (tx) => {
      const job = await one<{ company_id: string }>(tx, sql`SELECT id, company_id, title, department, location, employment, openings, description, status, scoring, scoring_version, interview_form_id,
          opened_on::text, closed_on::text, created_at FROM recruitment_jobs WHERE id = ${id} AND deleted_at IS NULL`);
      if (!job) throw notFound('موقعیت شغلی');
      const stages = await stagesOf(tx, ctx.tenantId, job.company_id, ctx.userId);
      const applications = await rows(tx, sql`SELECT a.id, a.candidate_id, c.full_name, c.desired_position, c.status AS candidate_status, a.stage_id, a.score::float, a.score_breakdown,
          a.scoring_version, a.created_at, a.hired_on::text, a.rejection_reason,
          (SELECT count(*)::int FROM recruitment_interviews i WHERE i.application_id = a.id AND i.status <> 'cancelled') AS interviews,
          (SELECT round(avg(i.score), 1)::float FROM recruitment_interviews i WHERE i.application_id = a.id AND i.status = 'done') AS interview_score
        FROM recruitment_applications a JOIN recruitment_candidates c ON c.id = a.candidate_id WHERE a.job_id = ${id}
        ORDER BY a.score DESC NULLS LAST, a.created_at`);
      return { job, stages, applications };
    });
  },

  async save(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof jobInput>, today: string) {
    return ctx.db.transaction(async (tx) => {
      if (input.interviewFormId && !(await one(tx, sql`SELECT 1 FROM recruitment_interview_forms WHERE id = ${input.interviewFormId} AND NOT archived`))) throw invalid('FORM', 'فرم ارزیابی معتبر نیست');
      const closed = input.status === 'closed' ? sql`coalesce(closed_on, ${today}::date)` : sql`NULL`;
      if (id) {
        const r = await rows(tx, sql`UPDATE recruitment_jobs SET title = ${input.title}, department = ${input.department}, location = ${input.location}, employment = ${input.employment},
          openings = ${input.openings}, description = ${input.description}, status = ${input.status}, interview_form_id = ${input.interviewFormId}, closed_on = ${closed}, updated_at = now()
          WHERE id = ${id} AND deleted_at IS NULL RETURNING id`);
        if (!r.length) throw notFound('موقعیت شغلی');
      } else {
        id = randomUUID();
        await tx.execute(sql`INSERT INTO recruitment_jobs (id, tenant_id, company_id, title, department, location, employment, openings, description, status, interview_form_id, opened_on, created_by)
          VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.title}, ${input.department}, ${input.location}, ${input.employment}, ${input.openings}, ${input.description}, ${input.status},
                  ${input.interviewFormId}, ${today}, ${ctx.userId})`);
      }
      await ctx.audit({ action: 'recruitment.job.saved', entityType: 'job', entityId: id, after: { title: input.title, status: input.status } }, tx);
      return { id };
    });
  },

  /** A new scoring profile version; every application of the job is re-scored with it. */
  async saveScoring(ctx: ModuleRequestContext, id: string, input: z.infer<typeof scoringInput>, today: string) {
    return ctx.db.transaction(async (tx) => {
      const r = await one<{ scoring_version: number }>(tx, sql`UPDATE recruitment_jobs SET scoring = ${JSON.stringify(input.criteria)}::jsonb, scoring_version = scoring_version + 1, updated_at = now()
        WHERE id = ${id} AND deleted_at IS NULL RETURNING scoring_version`);
      if (!r) throw notFound('موقعیت شغلی');
      await rescore(tx, sql`a.job_id = ${id}`, today);
      await ctx.audit({ action: 'recruitment.scoring.saved', entityType: 'job', entityId: id, after: { version: r.scoring_version, criteria: input.criteria } }, tx);
      return { version: r.scoring_version };
    });
  },

  async apply(ctx: ModuleRequestContext, jobId: string, input: z.infer<typeof applyInput>, today: string) {
    return ctx.db.transaction(async (tx) => {
      const job = await one<{ company_id: string; status: string }>(tx, sql`SELECT company_id, status FROM recruitment_jobs WHERE id = ${jobId} AND deleted_at IS NULL FOR UPDATE`);
      if (!job) throw notFound('موقعیت شغلی');
      if (job.status === 'closed') throw conflict('JOB_CLOSED', 'موقعیت شغلی بسته شده است');
      const first = (await stagesOf(tx, ctx.tenantId, job.company_id, ctx.userId)).find((s) => s.kind === 'open' && !s.archived)!;
      const ids: string[] = [];
      for (const cid of new Set(input.candidateIds)) {
        const c = await one(tx, sql`SELECT 1 FROM recruitment_candidates WHERE id = ${cid} AND company_id = ${job.company_id} AND status IN ('active', 'hired', 'archived')`);
        if (!c) throw invalid('CANDIDATE', 'یکی از متقاضیان انتخاب‌شده معتبر نیست');
        const aid = randomUUID();
        const ins = await rows(tx, sql`INSERT INTO recruitment_applications (id, tenant_id, company_id, candidate_id, job_id, stage_id, created_by)
          VALUES (${aid}, ${ctx.tenantId}, ${job.company_id}, ${cid}, ${jobId}, ${first.id}, ${ctx.userId}) ON CONFLICT (candidate_id, job_id) DO NOTHING RETURNING id`);
        if (!ins.length) continue;
        await tx.execute(sql`INSERT INTO recruitment_application_events (id, tenant_id, company_id, application_id, to_stage_id, changed_by) VALUES (${randomUUID()}, ${ctx.tenantId}, ${job.company_id}, ${aid}, ${first.id}, ${ctx.userId})`);
        ids.push(aid);
      }
      if (ids.length) await rescore(tx, sql`a.id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`, today);
      return { added: ids.length };
    });
  },
};

export const Applications = {
  async get(ctx: ModuleRequestContext, id: string) {
    return ctx.db.transaction(async (tx) => {
      const app = await one(tx, sql`SELECT a.id, a.job_id, j.title AS job_title, a.candidate_id, c.full_name, a.stage_id, a.score::float, a.score_breakdown, a.scoring_version, a.scored_at,
          a.rejection_reason, a.hired_on::text, a.created_at, j.interview_form_id
        FROM recruitment_applications a JOIN recruitment_jobs j ON j.id = a.job_id JOIN recruitment_candidates c ON c.id = a.candidate_id WHERE a.id = ${id}`);
      if (!app) throw notFound('درخواست');
      const [events, interviews] = await Promise.all([
        rows(tx, sql`SELECT e.id, e.from_stage_id, e.to_stage_id, e.note, e.changed_by, e.changed_at FROM recruitment_application_events e WHERE e.application_id = ${id} ORDER BY e.changed_at`),
        rows(tx, sql`SELECT i.id, i.form_id, f.name AS form_name, i.interviewer_id, i.scheduled_at, i.mode, i.status, i.score::float, i.recommendation, i.notes, i.ratings, i.evaluated_at
          FROM recruitment_interviews i JOIN recruitment_interview_forms f ON f.id = i.form_id WHERE i.application_id = ${id} ORDER BY i.scheduled_at`),
      ]);
      return { application: app, events, interviews };
    });
  },

  async move(ctx: ModuleRequestContext, id: string, input: z.infer<typeof moveInput>, today: string) {
    const r = await ctx.db.transaction(async (tx) => {
      const a = await one<{ company_id: string; stage_id: string; candidate_id: string; job_id: string; job_title: string }>(
        tx,
        sql`SELECT a.company_id, a.stage_id, a.candidate_id, a.job_id, j.title AS job_title FROM recruitment_applications a JOIN recruitment_jobs j ON j.id = a.job_id WHERE a.id = ${id} FOR UPDATE OF a`,
      );
      if (!a) throw notFound('درخواست');
      const to = await one<{ kind: string; archived: boolean }>(tx, sql`SELECT kind, archived FROM recruitment_stages WHERE id = ${input.stageId} AND company_id = ${a.company_id}`);
      if (!to || to.archived) throw invalid('STAGE', 'مرحله مقصد معتبر نیست');
      if (input.stageId === a.stage_id) return null;
      if (to.kind === 'rejected' && !input.rejectionReason) throw invalid('REASON', 'دلیل رد را برای پیگیری و گزارش وارد کنید');
      await tx.execute(sql`UPDATE recruitment_applications SET stage_id = ${input.stageId}, updated_at = now(),
        rejection_reason = ${to.kind === 'rejected' ? input.rejectionReason : ''}, hired_on = ${to.kind === 'hired' ? today : null} WHERE id = ${id}`);
      await tx.execute(sql`INSERT INTO recruitment_application_events (id, tenant_id, company_id, application_id, from_stage_id, to_stage_id, note, changed_by)
        VALUES (${randomUUID()}, ${ctx.tenantId}, ${a.company_id}, ${id}, ${a.stage_id}, ${input.stageId}, ${input.note}, ${ctx.userId})`);
      if (to.kind === 'hired') {
        await tx.execute(sql`UPDATE recruitment_candidates SET status = 'hired', updated_at = now() WHERE id = ${a.candidate_id}`);
        await ctx.publish('recruitment.candidate.hired', { candidateId: a.candidate_id, applicationId: id, jobId: a.job_id, jobTitle: a.job_title, hiredOn: today }, tx);
      }
      await ctx.audit({ action: 'recruitment.application.moved', entityType: 'application', entityId: id, after: { stageId: input.stageId } }, tx);
      return a;
    });
    return { ok: true, moved: !!r };
  },

  async rescore(ctx: ModuleRequestContext, id: string, today: string) {
    await ctx.db.transaction(async (tx) => {
      if (!(await one(tx, sql`SELECT 1 FROM recruitment_applications WHERE id = ${id}`))) throw notFound('درخواست');
      await rescore(tx, sql`a.id = ${id}`, today);
    });
  },

  async schedule(ctx: ModuleRequestContext, id: string, input: z.infer<typeof interviewInput>) {
    if (!(await ctx.directory([input.interviewerId])).length) throw invalid('UNKNOWN_USER', 'مصاحبه‌گر عضو فعال سازمان نیست');
    const at = zonedToUtc(input.date, input.time, TZ);
    const r = await ctx.db.transaction(async (tx) => {
      const a = await one<{ company_id: string; full_name: string; job_title: string }>(tx, sql`SELECT a.company_id, c.full_name, j.title AS job_title FROM recruitment_applications a
        JOIN recruitment_candidates c ON c.id = a.candidate_id JOIN recruitment_jobs j ON j.id = a.job_id WHERE a.id = ${id}`);
      if (!a) throw notFound('درخواست');
      if (!(await one(tx, sql`SELECT 1 FROM recruitment_interview_forms WHERE id = ${input.formId} AND NOT archived`))) throw invalid('FORM', 'فرم ارزیابی معتبر نیست');
      const iid = randomUUID();
      await tx.execute(sql`INSERT INTO recruitment_interviews (id, tenant_id, company_id, application_id, form_id, interviewer_id, scheduled_at, mode, created_by)
        VALUES (${iid}, ${ctx.tenantId}, ${a.company_id}, ${id}, ${input.formId}, ${input.interviewerId}, ${at}, ${input.mode}, ${ctx.userId})`);
      return { id: iid, ...a };
    });
    await ctx.notify({ userIds: [input.interviewerId], type: 'recruitment.interview.assigned', title: `مصاحبه با ${r.full_name} برای «${r.job_title}»`, body: `${input.date} ساعت ${input.time}`, link: `/app/recruitment/interviews/${r.id}` });
    return { id: r.id };
  },
};

// ---------------------------------------------------------------- interviews (interviewer: own scope)

function interviewScope(ctx: ModuleRequestContext): SQL {
  if (ctx.can('recruitment.application.manage', 'company') || ctx.can('recruitment.interview.evaluate', 'company')) return sql`TRUE`;
  return sql`i.interviewer_id = ${ctx.userId}`;
}

export const Interviews = {
  mine: (ctx: ModuleRequestContext) =>
    ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT i.id, i.scheduled_at, i.mode, i.status, i.score::float, i.recommendation, c.full_name, j.title AS job_title
        FROM recruitment_interviews i JOIN recruitment_applications a ON a.id = i.application_id JOIN recruitment_candidates c ON c.id = a.candidate_id JOIN recruitment_jobs j ON j.id = a.job_id
        WHERE i.interviewer_id = ${ctx.userId} AND i.status <> 'cancelled' ORDER BY (i.status = 'scheduled') DESC, i.scheduled_at DESC LIMIT 200`),
    ),

  /** The interviewer sees the resume content needed for the interview, not contact details or salary. */
  async get(ctx: ModuleRequestContext, id: string) {
    return ctx.db.transaction(async (tx) => {
      const i = await one<{ candidate_id: string; criteria: unknown }>(tx, sql`SELECT i.id, i.application_id, i.interviewer_id, i.scheduled_at, i.mode, i.status, i.ratings, i.score::float, i.recommendation, i.notes,
          i.evaluated_at, f.name AS form_name, f.criteria, a.candidate_id, c.full_name, c.desired_position, c.summary, c.status AS candidate_status, j.title AS job_title
        FROM recruitment_interviews i JOIN recruitment_interview_forms f ON f.id = i.form_id JOIN recruitment_applications a ON a.id = i.application_id
          JOIN recruitment_candidates c ON c.id = a.candidate_id JOIN recruitment_jobs j ON j.id = a.job_id
        WHERE i.id = ${id} AND ${interviewScope(ctx)}`);
      if (!i) throw notFound('مصاحبه');
      const cid = i.candidate_id;
      const [educations, experiences, projects, skills, files] = await Promise.all([
        rows(tx, sql`SELECT degree, field, institution, end_year FROM recruitment_educations WHERE candidate_id = ${cid} ORDER BY end_year DESC NULLS LAST`),
        rows(tx, sql`SELECT employer, title, started_on::text, ended_on::text, description FROM recruitment_experiences WHERE candidate_id = ${cid} ORDER BY started_on DESC`),
        rows(tx, sql`SELECT title, role, client, year, description FROM recruitment_candidate_projects WHERE candidate_id = ${cid} ORDER BY year DESC NULLS LAST`),
        rows(tx, sql`SELECT kind, name, level FROM recruitment_skills WHERE candidate_id = ${cid} ORDER BY kind, level DESC`),
        rows(tx, sql`SELECT id, kind, name, size FROM recruitment_files WHERE candidate_id = ${cid} ORDER BY created_at DESC`),
      ]);
      await ctx.audit({ action: 'recruitment.candidate.viewed', entityType: 'candidate', entityId: cid, after: { via: 'interview', interviewId: id } }, tx);
      return { interview: i, educations, experiences, projects, skills, files };
    });
  },

  async evaluate(ctx: ModuleRequestContext, id: string, input: z.infer<typeof evaluationInput>) {
    await ctx.db.transaction(async (tx) => {
      const i = await one<{ interviewer_id: string; status: string; criteria: { key: string; weight: number }[] }>(
        tx,
        sql`SELECT i.interviewer_id, i.status, f.criteria FROM recruitment_interviews i JOIN recruitment_interview_forms f ON f.id = i.form_id WHERE i.id = ${id} AND ${interviewScope(ctx)} FOR UPDATE OF i`,
      );
      if (!i) throw notFound('مصاحبه');
      if (i.interviewer_id !== ctx.userId && !ctx.can('recruitment.interview.evaluate', 'company')) throw forbidden('فقط مصاحبه‌گر همین مصاحبه ارزیابی را ثبت می‌کند');
      if (i.status === 'cancelled') throw conflict('CANCELLED', 'مصاحبه لغو شده است');
      const missing = i.criteria.filter((c) => !(c.key in input.ratings));
      if (missing.length) throw invalid('RATINGS', 'به همه معیارهای فرم امتیاز دهید');
      const total = i.criteria.reduce((s, c) => s + c.weight, 0);
      const score = Math.round((i.criteria.reduce((s, c) => s + c.weight * input.ratings[c.key]!, 0) / total / 5) * 1000) / 10;
      const ratings = Object.fromEntries(i.criteria.map((c) => [c.key, input.ratings[c.key]]));
      await tx.execute(sql`UPDATE recruitment_interviews SET ratings = ${JSON.stringify(ratings)}::jsonb, score = ${score}, recommendation = ${input.recommendation}, notes = ${input.notes},
        status = 'done', evaluated_at = now() WHERE id = ${id}`);
      await ctx.audit({ action: 'recruitment.interview.evaluated', entityType: 'interview', entityId: id, after: { score, recommendation: input.recommendation } }, tx);
    });
  },

  /** Resume download for the interviewer of this interview (checked again inside Candidates.fileUrl). */
  async fileUrl(ctx: ModuleRequestContext, id: string, fileRowId: string) {
    const i = await ctx.db.transaction((tx) =>
      one<{ candidate_id: string }>(tx, sql`SELECT a.candidate_id FROM recruitment_interviews i JOIN recruitment_applications a ON a.id = i.application_id WHERE i.id = ${id} AND ${interviewScope(ctx)}`),
    );
    if (!i) throw notFound('مصاحبه');
    return Candidates.fileUrl(ctx, i.candidate_id, fileRowId);
  },

  async cancel(ctx: ModuleRequestContext, id: string) {
    await ctx.db.transaction(async (tx) => {
      const r = await rows(tx, sql`UPDATE recruitment_interviews SET status = 'cancelled' WHERE id = ${id} AND status = 'scheduled' RETURNING id`);
      if (!r.length) throw conflict('NOT_SCHEDULED', 'فقط مصاحبه برگزارنشده قابل لغو است');
    });
  },
};

// ---------------------------------------------------------------- reports, widgets, providers, jobs

export async function report(ctx: ModuleRequestContext, f: z.infer<typeof reportQuery>) {
  if (f.from > f.to) throw invalid('RANGE', 'ابتدای بازه باید قبل از انتهای آن باشد');
  const from = zonedToUtc(f.from, '00:00', TZ);
  const to = zonedToUtc(addDays(f.to, 1), '00:00', TZ);
  return ctx.db.transaction(async (tx) => {
    const [jobs, sources, rejections, totals] = await Promise.all([
      rows(tx, sql`SELECT j.id, j.title, j.status,
          count(a.id) FILTER (WHERE a.created_at >= ${from} AND a.created_at < ${to})::int AS applications,
          count(a.id) FILTER (WHERE a.hired_on BETWEEN ${f.from}::date AND ${f.to}::date)::int AS hired,
          count(a.id) FILTER (WHERE s.kind = 'rejected' AND a.updated_at >= ${from} AND a.updated_at < ${to})::int AS rejected,
          count(a.id) FILTER (WHERE s.kind = 'open')::int AS in_progress,
          round(avg(a.hired_on - (a.created_at AT TIME ZONE ${TZ})::date) FILTER (WHERE a.hired_on BETWEEN ${f.from}::date AND ${f.to}::date), 1)::float AS days_to_hire
        FROM recruitment_jobs j LEFT JOIN recruitment_applications a ON a.job_id = j.id LEFT JOIN recruitment_stages s ON s.id = a.stage_id
        WHERE j.deleted_at IS NULL GROUP BY j.id ORDER BY j.title`),
      rows(tx, sql`SELECT c.source, count(DISTINCT c.id) FILTER (WHERE c.created_at >= ${from} AND c.created_at < ${to})::int AS candidates,
          count(DISTINCT a.id) FILTER (WHERE a.hired_on BETWEEN ${f.from}::date AND ${f.to}::date)::int AS hired
        FROM recruitment_candidates c LEFT JOIN recruitment_applications a ON a.candidate_id = c.id WHERE c.status <> 'merged' GROUP BY c.source ORDER BY 2 DESC`),
      rows(tx, sql`SELECT a.rejection_reason AS reason, count(*)::int AS n FROM recruitment_applications a JOIN recruitment_stages s ON s.id = a.stage_id
        WHERE s.kind = 'rejected' AND a.rejection_reason <> '' AND a.updated_at >= ${from} AND a.updated_at < ${to} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
      one(tx, sql`SELECT (SELECT count(*)::int FROM recruitment_candidates WHERE status NOT IN ('merged', 'anonymized') AND created_at >= ${from} AND created_at < ${to}) AS new_candidates,
          (SELECT count(*)::int FROM recruitment_applications WHERE hired_on BETWEEN ${f.from}::date AND ${f.to}::date) AS hired,
          (SELECT count(*)::int FROM recruitment_interviews WHERE status = 'done' AND evaluated_at >= ${from} AND evaluated_at < ${to}) AS interviews,
          (SELECT round(avg(hired_on - (created_at AT TIME ZONE ${TZ})::date), 1)::float FROM recruitment_applications WHERE hired_on BETWEEN ${f.from}::date AND ${f.to}::date) AS days_to_hire,
          (SELECT count(*)::int FROM recruitment_jobs WHERE status = 'open' AND deleted_at IS NULL) AS open_jobs`),
    ]);
    return { totals, jobs, sources, rejections };
  });
}

export async function pipelineWidget(ctx: ModuleRequestContext, today: string) {
  return ctx.db.transaction(async (tx) => {
    const r = await one(tx, sql`SELECT (SELECT count(*)::int FROM recruitment_jobs WHERE status = 'open' AND deleted_at IS NULL) AS open_jobs,
        (SELECT count(*)::int FROM recruitment_applications a JOIN recruitment_stages s ON s.id = a.stage_id JOIN recruitment_jobs j ON j.id = a.job_id WHERE s.kind = 'open' AND j.status <> 'closed') AS active,
        (SELECT count(*)::int FROM recruitment_interviews WHERE status = 'scheduled' AND scheduled_at >= now() AND scheduled_at < now() + interval '7 days') AS interviews_week,
        (SELECT count(*)::int FROM recruitment_applications WHERE hired_on > ${today}::date - 30) AS hired_30,
        (SELECT count(*)::int FROM recruitment_duplicates WHERE status = 'open') AS duplicates`);
    return r;
  });
}

export async function myInterviewsWidget(ctx: ModuleRequestContext) {
  return ctx.db.transaction(async (tx) => ({
    items: await rows(tx, sql`SELECT i.id, i.scheduled_at, c.full_name, j.title AS job_title FROM recruitment_interviews i JOIN recruitment_applications a ON a.id = i.application_id
      JOIN recruitment_candidates c ON c.id = a.candidate_id JOIN recruitment_jobs j ON j.id = a.job_id
      WHERE i.interviewer_id = ${ctx.userId} AND i.status = 'scheduled' ORDER BY i.scheduled_at LIMIT 8`),
  }));
}

export async function search(ctx: ModuleRequestContext, q: string, limit: number) {
  const ts = toTsQuery(q);
  if (!ts) return [];
  const r = await ctx.db.transaction((tx) =>
    rows<{ id: string; full_name: string; desired_position: string }>(tx, sql`SELECT id, full_name, desired_position FROM recruitment_candidates
      WHERE status IN ('active', 'hired', 'archived') AND search_doc @@ to_tsquery('simple', ${ts}) ORDER BY ts_rank(search_doc, to_tsquery('simple', ${ts})) DESC LIMIT ${limit}`),
  );
  return r.map((x) => ({ entityType: 'candidate', entityId: x.id, title: x.full_name, snippet: x.desired_position, link: `/app/recruitment/candidates/${x.id}` }));
}

/** Daily: anonymises resumes whose retention period has ended and erases their files. */
export async function retentionPurge(ctx: ModuleEventContext, today: string): Promise<number> {
  const expired = await ctx.db.transaction((tx) => rows<{ id: string }>(tx, sql`SELECT id FROM recruitment_candidates WHERE status <> 'anonymized' AND retention_until < ${today}::date LIMIT 500`));
  for (const c of expired) {
    const files = await ctx.db.transaction(async (tx) => {
      const locked = await one(tx, sql`SELECT id FROM recruitment_candidates WHERE id = ${c.id} AND status <> 'anonymized' AND retention_until < ${today}::date FOR UPDATE SKIP LOCKED`);
      return locked ? anonymize(tx, ctx, c.id, 'retention') : [];
    });
    for (const f of files) await ctx.files.remove(f);
  }
  return expired.length;
}

export const kpi = {
  hires: (ctx: ModuleEventContext, p: { companyId: string; from: string; to: string }) =>
    ctx.db.transaction(async (tx) => (await one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM recruitment_applications WHERE company_id = ${p.companyId} AND hired_on BETWEEN ${p.from}::date AND ${p.to}::date`))!.n),
  timeToHire: (ctx: ModuleEventContext, p: { companyId: string; from: string; to: string }) =>
    ctx.db.transaction(async (tx) => {
      const r = await one<{ d: number | null }>(tx, sql`SELECT round(avg(hired_on - (created_at AT TIME ZONE ${TZ})::date), 1)::float AS d FROM recruitment_applications
        WHERE company_id = ${p.companyId} AND hired_on BETWEEN ${p.from}::date AND ${p.to}::date`);
      return r!.d;
    }),
  openJobs: (ctx: ModuleEventContext, p: { companyId: string }) =>
    ctx.db.transaction(async (tx) => (await one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM recruitment_jobs WHERE company_id = ${p.companyId} AND status = 'open' AND deleted_at IS NULL`))!.n),
};

/**
 * Public service recruitment.candidates@1 — used by hr to offer a field-by-field transfer of a hired
 * candidate. The caller (hr) checks its own permissions; nothing is transferred automatically.
 */
export function publicService(ctx: ModuleEventContext) {
  return {
    hired: () =>
      ctx.db.transaction((tx) =>
        rows(tx, sql`SELECT DISTINCT ON (c.id) c.id, c.full_name, j.title AS job_title, a.hired_on::text FROM recruitment_applications a
          JOIN recruitment_candidates c ON c.id = a.candidate_id JOIN recruitment_jobs j ON j.id = a.job_id
          WHERE a.hired_on IS NOT NULL AND c.status = 'hired' ORDER BY c.id, a.hired_on DESC`),
      ),
    get: (id: string) =>
      ctx.db.transaction(async (tx) => {
        const c = await one(tx, sql`SELECT id, full_name, mobile, email, city, desired_position, expected_salary::text, available_from::text FROM recruitment_candidates
          WHERE id = ${id} AND status IN ('active', 'hired', 'archived')`);
        if (!c) return null;
        const [educations, experiences, skills] = await Promise.all([
          rows(tx, sql`SELECT degree, field, institution, end_year FROM recruitment_educations WHERE candidate_id = ${id}`),
          rows(tx, sql`SELECT employer, title, started_on::text, ended_on::text, description FROM recruitment_experiences WHERE candidate_id = ${id} ORDER BY started_on`),
          rows(tx, sql`SELECT kind, name, level FROM recruitment_skills WHERE candidate_id = ${id}`),
        ]);
        return { ...c, educations, experiences, skills };
      }),
  };
}
