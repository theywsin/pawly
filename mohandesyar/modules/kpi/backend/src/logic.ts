import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { conflict, forbidden, invalid, notFound } from './errors.js';
import { evaluate, parseFormula, variables } from './formula.js';
import type { computeInput, decisionInput, definitionInput, rewardRuleInput, scorecardComputeInput, scorecardQuery, sheetQuery, targetsInput, valueInput } from './inputs.js';
import { parsePeriod, periodLabel, periodRange, rewardCoefficient, scoreCard, type ItemInput, type RewardBand } from './scoring.js';

type Row = Record<string, unknown>;
const rows = async <T = Row>(tx: Db, q: SQL) => (await tx.execute(q)).rows as T[];
const one = async <T = Row>(tx: Db, q: SQL) => (await rows<T>(tx, q))[0];

export interface Definition {
  id: string;
  company_id: string;
  code: string;
  name: string;
  description: string;
  unit: string;
  direction: 'higher' | 'lower';
  level: string;
  frequency: string;
  source: 'manual' | 'provider' | 'formula';
  provider_key: string | null;
  formula: string | null;
  weight: number;
  good_pct: number;
  warning_pct: number;
  is_gate: boolean;
  owner_user_id: string | null;
  status: string;
  version: number;
}
const DEF_COLS = sql`d.id, d.company_id, d.code, d.name, d.description, d.unit, d.direction, d.level, d.frequency, d.source, d.provider_key, d.formula, d.weight,
  d.good_pct::float, d.warning_pct::float, d.is_gate, d.owner_user_id, d.status, d.version`;

/** own scope: definitions you are responsible for. */
function defScope(ctx: ModuleRequestContext): SQL {
  return ctx.can('kpi.view', 'company') ? sql`TRUE` : sql`d.owner_user_id = ${ctx.userId}`;
}

async function loadDef(tx: Db, ctx: ModuleRequestContext, id: string, lock = false): Promise<Definition> {
  const d = await one<Definition>(tx, sql`SELECT ${DEF_COLS} FROM kpi_definitions d WHERE d.id = ${id} AND ${defScope(ctx)} ${lock ? sql`FOR UPDATE` : sql``}`);
  if (!d) throw notFound('شاخص');
  return d;
}

function checkPeriod(d: Pick<Definition, 'frequency' | 'name'>, period: string) {
  if (parsePeriod(period)!.frequency !== d.frequency) {
    const f = { monthly: 'ماهانه (1405-07)', quarterly: 'فصلی (1405-Q3)', yearly: 'سالانه (1405)' }[d.frequency as 'monthly'];
    throw invalid('PERIOD_FREQUENCY', `دوره شاخص «${d.name}» ${f} است`);
  }
}

// ---------------------------------------------------------------- definitions

export const Definitions = {
  providers: (ctx: ModuleRequestContext) => ctx.kpi.providers(),

  list: (ctx: ModuleRequestContext) =>
    ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT ${DEF_COLS},
          (SELECT count(*)::int FROM kpi_values v WHERE v.definition_id = d.id AND v.status = 'submitted') AS pending_values
        FROM kpi_definitions d WHERE ${defScope(ctx)} ORDER BY d.status, d.level, d.name`),
    ),

  /** Definition with its versions and history (approved values against targets, oldest first). */
  async get(ctx: ModuleRequestContext, id: string) {
    return ctx.db.transaction(async (tx) => {
      const d = await loadDef(tx, ctx, id);
      const [versions, history] = await Promise.all([
        rows(tx, sql`SELECT version, snapshot, created_at, created_by FROM kpi_definition_versions WHERE definition_id = ${id} ORDER BY version DESC`),
        rows<{ period: string; subject_type: string; subject_id: string; subject_name: string; value: number | null; status: string | null; target: number | null }>(
          tx,
          sql`SELECT coalesce(v.period, t.period) AS period, coalesce(v.subject_type, t.subject_type) AS subject_type, coalesce(v.subject_id, t.subject_id) AS subject_id,
              coalesce(v.subject_name, t.subject_name) AS subject_name, v.value::float, v.status, t.target::float
            FROM kpi_values v FULL JOIN kpi_targets t ON t.definition_id = v.definition_id AND t.period = v.period AND t.subject_type = v.subject_type AND t.subject_id = v.subject_id
            WHERE coalesce(v.definition_id, t.definition_id) = ${id} ORDER BY 1, 4 LIMIT 1000`,
        ),
      ]);
      return { definition: d, versions, history: history.map((h) => ({ ...h, label: periodLabel(h.period) })) };
    });
  },

  async save(ctx: ModuleRequestContext, id: string | null, input: z.infer<typeof definitionInput>) {
    if (input.source === 'provider' && !ctx.kpi.providers().some((p) => p.key === input.providerKey)) throw invalid('PROVIDER', 'این منبع داده در ماژول‌های فعال سازمان وجود ندارد');
    if (input.ownerUserId && !(await ctx.directory([input.ownerUserId])).length) throw invalid('UNKNOWN_USER', 'مسئول شاخص عضو فعال سازمان نیست');
    return ctx.db.transaction(async (tx) => {
      const companyId = id ? (await loadDef(tx, ctx, id, true)).company_id : ctx.companyId;
      if (input.source === 'formula') await checkFormula(tx, companyId, input.code, input.formula!, input.frequency, input.level);
      const dup = await one(tx, sql`SELECT 1 FROM kpi_definitions WHERE company_id = ${companyId} AND code = ${input.code} ${id ? sql`AND id <> ${id}` : sql``}`);
      if (dup) throw conflict('CODE_TAKEN', 'این کد برای شاخص دیگری استفاده شده است');
      const f = sql`code = ${input.code}, name = ${input.name}, description = ${input.description}, unit = ${input.unit}, direction = ${input.direction}, level = ${input.level},
        frequency = ${input.frequency}, source = ${input.source}, provider_key = ${input.providerKey}, formula = ${input.formula}, weight = ${input.weight}, good_pct = ${input.goodPct},
        warning_pct = ${input.warningPct}, is_gate = ${input.isGate}, owner_user_id = ${input.ownerUserId}, status = ${input.status}`;
      let version = 1;
      if (id) {
        const used = await one(tx, sql`SELECT 1 FROM kpi_values WHERE definition_id = ${id} LIMIT 1`);
        const cur = await loadDef(tx, ctx, id);
        if (used && (cur.level !== input.level || cur.frequency !== input.frequency)) throw conflict('IN_USE', 'سطح و دوره شاخصی که مقدار دارد قابل تغییر نیست؛ شاخص جدید تعریف کنید');
        if (cur.code !== input.code && (await one(tx, sql`SELECT 1 FROM kpi_definitions WHERE company_id = ${companyId} AND formula IS NOT NULL AND formula ~* ${`\\m${cur.code}\\M`}`))) {
          throw conflict('CODE_IN_FORMULA', 'کد این شاخص در فرمول شاخص دیگری به کار رفته است');
        }
        version = (await one<{ version: number }>(tx, sql`UPDATE kpi_definitions SET ${f}, version = version + 1, updated_at = now() WHERE id = ${id} RETURNING version`))!.version;
      } else {
        id = randomUUID();
        await tx.execute(sql`INSERT INTO kpi_definitions (id, tenant_id, company_id, code, name, direction, level, frequency, source, provider_key, formula, created_by)
          VALUES (${id}, ${ctx.tenantId}, ${companyId}, ${input.code}, ${input.name}, ${input.direction}, ${input.level}, ${input.frequency}, ${input.source}, ${input.providerKey}, ${input.formula}, ${ctx.userId})`);
        await tx.execute(sql`UPDATE kpi_definitions SET ${f} WHERE id = ${id}`);
      }
      await tx.execute(sql`INSERT INTO kpi_definition_versions (id, tenant_id, company_id, definition_id, version, snapshot, created_by)
        VALUES (${randomUUID()}, ${ctx.tenantId}, ${companyId}, ${id}, ${version}, ${JSON.stringify(input)}::jsonb, ${ctx.userId})`);
      await ctx.audit({ action: 'kpi.definition.saved', entityType: 'kpi_definition', entityId: id, after: { version, ...input } }, tx);
      return { id, version };
    });
  },

  async setTargets(ctx: ModuleRequestContext, id: string, input: z.infer<typeof targetsInput>) {
    await ctx.db.transaction(async (tx) => {
      const d = await loadDef(tx, ctx, id);
      checkPeriod(d, input.period);
      for (const t of input.targets) {
        if (t.subjectType !== d.level) throw invalid('LEVEL', 'سطح موضوع با سطح شاخص یکی نیست');
        await tx.execute(sql`INSERT INTO kpi_targets (id, tenant_id, company_id, definition_id, period, subject_type, subject_id, subject_name, target, updated_by)
          VALUES (${randomUUID()}, ${ctx.tenantId}, ${d.company_id}, ${id}, ${input.period}, ${t.subjectType}, ${t.subjectId}, ${t.subjectName}, ${t.target}, ${ctx.userId})
          ON CONFLICT (definition_id, period, subject_type, subject_id) DO UPDATE SET target = EXCLUDED.target, subject_name = EXCLUDED.subject_name, updated_at = now(), updated_by = EXCLUDED.updated_by`);
      }
      await ctx.audit({ action: 'kpi.targets.saved', entityType: 'kpi_definition', entityId: id, after: input }, tx);
    });
  },
};

/** Formula variables must be other KPI codes of the same level and frequency, without cycles. */
async function checkFormula(tx: Db, companyId: string, code: string, formula: string, frequency: string, level: string) {
  const vars = [...variables(parseFormula(formula))];
  if (vars.includes(code)) throw invalid('FORMULA_SELF', 'فرمول نمی‌تواند به خود شاخص اشاره کند');
  const defs = await rows<{ code: string; formula: string | null; frequency: string; level: string }>(tx, sql`SELECT code, formula, frequency, level FROM kpi_definitions WHERE company_id = ${companyId}`);
  const byCode = new Map(defs.map((d) => [d.code, d]));
  const unknown = vars.filter((v) => !byCode.has(v));
  if (unknown.length) throw invalid('FORMULA_VARS', `شاخصی با این کد وجود ندارد: ${unknown.join('، ')}`);
  const mismatch = vars.filter((v) => byCode.get(v)!.frequency !== frequency || byCode.get(v)!.level !== level);
  if (mismatch.length) throw invalid('FORMULA_VARS', `دوره یا سطح این شاخص‌ها با شاخص فرمولی یکی نیست: ${mismatch.join('، ')}`);
  // Cycle check through other formula definitions.
  const seen = new Set<string>();
  const walk = (c: string): boolean => {
    if (c === code) return true;
    if (seen.has(c)) return false;
    seen.add(c);
    const f = byCode.get(c)?.formula;
    return f ? [...variables(parseFormula(f))].some(walk) : false;
  };
  if (vars.some(walk)) throw invalid('FORMULA_CYCLE', 'فرمول حلقه ایجاد می‌کند (شاخص‌ها به یکدیگر وابسته‌اند)');
}

// ---------------------------------------------------------------- values

async function writeValue(
  tx: Db,
  ctx: ModuleRequestContext,
  d: Definition,
  s: { period: string; subjectType: string; subjectId: string; subjectName: string },
  value: number,
  source: string,
  snapshot: unknown,
  note: string,
) {
  checkPeriod(d, s.period);
  if (s.subjectType !== d.level) throw invalid('LEVEL', 'سطح موضوع با سطح شاخص یکی نیست');
  const cur = await one<{ id: string; status: string }>(tx, sql`SELECT id, status FROM kpi_values WHERE definition_id = ${d.id} AND period = ${s.period} AND subject_type = ${s.subjectType} AND subject_id = ${s.subjectId} FOR UPDATE`);
  if (cur?.status === 'approved') throw conflict('APPROVED', 'مقدار این دوره تأیید شده است؛ برای تغییر، تأییدکننده باید آن را بازگشایی کند');
  const id = cur?.id ?? randomUUID();
  if (cur) {
    await tx.execute(sql`UPDATE kpi_values SET value = ${value}, source = ${source}, provider_snapshot = ${snapshot === null ? null : JSON.stringify(snapshot)}::jsonb, note = ${note}, status = 'submitted',
      entered_by = ${ctx.userId}, entered_at = now(), decided_by = NULL, decided_at = NULL, decision_note = '', definition_version = ${d.version}, subject_name = ${s.subjectName} WHERE id = ${id}`);
  } else {
    await tx.execute(sql`INSERT INTO kpi_values (id, tenant_id, company_id, definition_id, definition_version, period, subject_type, subject_id, subject_name, value, source, provider_snapshot, note, entered_by)
      VALUES (${id}, ${ctx.tenantId}, ${d.company_id}, ${d.id}, ${d.version}, ${s.period}, ${s.subjectType}, ${s.subjectId}, ${s.subjectName}, ${value}, ${source},
              ${snapshot === null ? null : JSON.stringify(snapshot)}::jsonb, ${note}, ${ctx.userId})`);
  }
  await tx.execute(sql`INSERT INTO kpi_value_history (id, tenant_id, company_id, value_id, value, status, action, actor_id, note) VALUES (${randomUUID()}, ${ctx.tenantId}, ${d.company_id}, ${id}, ${value}, 'submitted', ${source === 'manual' ? 'entered' : 'computed'}, ${ctx.userId}, ${note})`);
  return id;
}

function canEnter(ctx: ModuleRequestContext, d: Definition) {
  if (!ctx.can('kpi.value.enter', 'company') && d.owner_user_id !== ctx.userId) throw forbidden('فقط مسئول این شاخص یا مدیر شاخص‌ها مقدار ثبت می‌کند');
}

export const Values = {
  /** The data-entry sheet of a period: every active definition of that frequency × its subjects (targets and values). */
  async sheet(ctx: ModuleRequestContext, f: z.infer<typeof sheetQuery>) {
    const freq = parsePeriod(f.period)!.frequency;
    return ctx.db.transaction(async (tx) => {
      const defs = await rows<Definition>(tx, sql`SELECT ${DEF_COLS} FROM kpi_definitions d WHERE d.status = 'active' AND d.frequency = ${freq} AND ${defScope(ctx)}
        ${f.level ? sql`AND d.level = ${f.level}` : sql``} ORDER BY d.level, d.name`);
      if (!defs.length) return { period: f.period, label: periodLabel(f.period), rows: [] };
      const ids = sql.join(defs.map((d) => sql`${d.id}::uuid`), sql`, `);
      const [targets, values] = await Promise.all([
        rows<{ definition_id: string; subject_type: string; subject_id: string; subject_name: string; target: number }>(tx, sql`SELECT definition_id, subject_type, subject_id, subject_name, target::float FROM kpi_targets WHERE period = ${f.period} AND definition_id IN (${ids})`),
        rows<{ id: string; definition_id: string; subject_type: string; subject_id: string; subject_name: string; value: number; source: string; status: string; note: string; entered_by: string; entered_at: string; decided_by: string | null; decision_note: string; provider_snapshot: unknown }>(
          tx,
          sql`SELECT id, definition_id, subject_type, subject_id, subject_name, value::float, source, status, note, entered_by, entered_at, decided_by, decision_note, provider_snapshot FROM kpi_values WHERE period = ${f.period} AND definition_id IN (${ids})`,
        ),
      ]);
      const out = [];
      for (const d of defs) {
        const keys = new Map<string, { subjectType: string; subjectId: string; subjectName: string }>();
        for (const t of targets.filter((x) => x.definition_id === d.id)) keys.set(`${t.subject_type}:${t.subject_id}`, { subjectType: t.subject_type, subjectId: t.subject_id, subjectName: t.subject_name });
        for (const v of values.filter((x) => x.definition_id === d.id)) keys.set(`${v.subject_type}:${v.subject_id}`, { subjectType: v.subject_type, subjectId: v.subject_id, subjectName: v.subject_name });
        if (!keys.size && d.level === 'org') keys.set('org:org', { subjectType: 'org', subjectId: 'org', subjectName: 'سازمان' });
        for (const k of keys.values()) {
          out.push({
            definition: d,
            ...k,
            canEnter: d.status === 'active' && (ctx.can('kpi.value.enter', 'company') || (d.owner_user_id === ctx.userId && ctx.can('kpi.value.enter', 'own'))),
            target: targets.find((t) => t.definition_id === d.id && t.subject_type === k.subjectType && t.subject_id === k.subjectId)?.target ?? null,
            value: values.find((v) => v.definition_id === d.id && v.subject_type === k.subjectType && v.subject_id === k.subjectId) ?? null,
          });
        }
      }
      return { period: f.period, label: periodLabel(f.period), rows: out };
    });
  },

  async enter(ctx: ModuleRequestContext, defId: string, input: z.infer<typeof valueInput>) {
    return ctx.db.transaction(async (tx) => {
      const d = await loadDef(tx, ctx, defId);
      if (d.status !== 'active') throw conflict('ARCHIVED', 'شاخص بایگانی شده است');
      if (d.source !== 'manual') throw conflict('NOT_MANUAL', 'مقدار این شاخص از منبع داده یا فرمول محاسبه می‌شود');
      canEnter(ctx, d);
      const id = await writeValue(tx, ctx, d, input, input.value, 'manual', null, input.note);
      await ctx.audit({ action: 'kpi.value.entered', entityType: 'kpi_value', entityId: id, after: { period: input.period, subject: input.subjectId, value: input.value } }, tx);
      return { id };
    });
  },

  /** Provider or formula value, stored with a traceable snapshot (docs/05 provider_snapshot). */
  async compute(ctx: ModuleRequestContext, defId: string, input: z.infer<typeof computeInput>) {
    const d = await ctx.db.transaction((tx) => loadDef(tx, ctx, defId));
    if (d.source === 'manual') throw conflict('MANUAL', 'این شاخص ورود دستی دارد');
    canEnter(ctx, d);
    checkPeriod(d, input.period);
    let value: number | null;
    let snapshot: Record<string, unknown>;
    if (d.source === 'provider') {
      const range = periodRange(input.period)!;
      const info = ctx.kpi.providers().find((p) => p.key === d.provider_key);
      if (!info) throw conflict('PROVIDER_UNAVAILABLE', 'ماژول منبع داده این شاخص فعال نیست');
      value = await ctx.kpi.evaluate(d.provider_key!, { companyId: d.company_id, ...range, dimensions: { subjectType: input.subjectType, subjectId: input.subjectId } });
      if (value === null) throw conflict('NO_DATA', 'منبع داده برای این دوره مقداری برنگرداند (داده کافی وجود ندارد)');
      snapshot = { provider: d.provider_key, module: info.moduleId, title: info.title, from: range.from, to: range.to, computedAt: new Date().toISOString() };
    } else {
      const ast = parseFormula(d.formula!);
      const codes = [...variables(ast)];
      const inputs = await ctx.db.transaction((tx) =>
        rows<{ code: string; value: number }>(tx, sql`SELECT k.code, v.value::float FROM kpi_values v JOIN kpi_definitions k ON k.id = v.definition_id
          WHERE k.company_id = ${d.company_id} AND k.code IN (${sql.join(codes.map((c) => sql`${c}`), sql`, `)}) AND v.period = ${input.period} AND v.subject_type = ${input.subjectType}
            AND v.subject_id = ${input.subjectId} AND v.status = 'approved'`),
      );
      const vars = Object.fromEntries(inputs.map((i) => [i.code, i.value]));
      const missing = codes.filter((c) => !(c in vars));
      if (missing.length) throw conflict('FORMULA_INPUTS', `مقدار تأییدشده این شاخص‌ها برای همین دوره و موضوع لازم است: ${missing.join('، ')}`);
      value = evaluate(ast, vars);
      if (value === null) throw conflict('FORMULA_RESULT', 'نتیجه فرمول قابل محاسبه نیست (مثلاً تقسیم بر صفر)');
      snapshot = { formula: d.formula, inputs: vars, computedAt: new Date().toISOString() };
    }
    const v = value;
    return ctx.db.transaction(async (tx) => {
      const fresh = await loadDef(tx, ctx, defId);
      const id = await writeValue(tx, ctx, fresh, input, v, d.source, snapshot, '');
      await ctx.audit({ action: 'kpi.value.computed', entityType: 'kpi_value', entityId: id, after: { value: v, snapshot } }, tx);
      return { id, value: v, snapshot };
    });
  },

  async decide(ctx: ModuleRequestContext, id: string, input: z.infer<typeof decisionInput>) {
    await ctx.db.transaction(async (tx) => {
      const v = await one<{ status: string; entered_by: string; company_id: string; value: number }>(tx, sql`SELECT status, entered_by, company_id, value::float FROM kpi_values WHERE id = ${id} FOR UPDATE`);
      if (!v) throw notFound('مقدار');
      if (v.status !== 'submitted') throw conflict('DECIDED', 'این مقدار قبلاً بررسی شده است');
      if (v.entered_by === ctx.userId) throw forbidden('ثبت‌کننده مقدار نمی‌تواند آن را تأیید یا رد کند');
      const status = input.decision === 'approve' ? 'approved' : 'rejected';
      await tx.execute(sql`UPDATE kpi_values SET status = ${status}, decided_by = ${ctx.userId}, decided_at = now(), decision_note = ${input.note} WHERE id = ${id}`);
      await tx.execute(sql`INSERT INTO kpi_value_history (id, tenant_id, company_id, value_id, value, status, action, actor_id, note) VALUES (${randomUUID()}, ${ctx.tenantId}, ${v.company_id}, ${id}, ${v.value}, ${status}, ${input.decision}, ${ctx.userId}, ${input.note})`);
      await ctx.audit({ action: `kpi.value.${status}`, entityType: 'kpi_value', entityId: id, after: input }, tx);
    });
  },

  /** An approved value is reopened (back to submitted) before it can be corrected; recorded in its history. */
  async reopen(ctx: ModuleRequestContext, id: string, note: string) {
    await ctx.db.transaction(async (tx) => {
      const v = await one<{ status: string; company_id: string; value: number }>(tx, sql`SELECT status, company_id, value::float FROM kpi_values WHERE id = ${id} FOR UPDATE`);
      if (!v) throw notFound('مقدار');
      if (v.status !== 'approved') throw conflict('NOT_APPROVED', 'فقط مقدار تأییدشده بازگشایی می‌شود');
      await tx.execute(sql`UPDATE kpi_values SET status = 'submitted', decided_by = NULL, decided_at = NULL WHERE id = ${id}`);
      await tx.execute(sql`INSERT INTO kpi_value_history (id, tenant_id, company_id, value_id, value, status, action, actor_id, note) VALUES (${randomUUID()}, ${ctx.tenantId}, ${v.company_id}, ${id}, ${v.value}, 'submitted', 'reopened', ${ctx.userId}, ${note})`);
      await ctx.audit({ action: 'kpi.value.reopened', entityType: 'kpi_value', entityId: id, after: { note } }, tx);
    });
  },

  history: (ctx: ModuleRequestContext, id: string) =>
    ctx.db.transaction(async (tx) => {
      const v = await one<{ definition_id: string }>(tx, sql`SELECT definition_id FROM kpi_values WHERE id = ${id}`);
      if (!v) throw notFound('مقدار');
      await loadDef(tx, ctx, v.definition_id);
      return rows(tx, sql`SELECT value::float, status, action, actor_id, note, at FROM kpi_value_history WHERE value_id = ${id} ORDER BY at`);
    }),
};

// ---------------------------------------------------------------- subjects

export async function subjects(ctx: ModuleRequestContext, type: string) {
  if (type === 'org') return [{ id: 'org', name: 'سازمان' }];
  if (type === 'person') return (await ctx.directory()).map((u) => ({ id: u.id, name: u.fullName }));
  if (type === 'project') {
    const svc = ctx.services.get<{ search(q: string, limit: number): Promise<{ id: string; code: string; title: string }[]> }>('projects.projects', '^1');
    return svc ? (await svc.search('', 200)).map((p) => ({ id: p.id, name: `${p.code} — ${p.title}` })) : [];
  }
  if (type === 'unit') {
    const svc = ctx.services.get<{ list(): Promise<{ department: string }[]> }>('hr.employees', '^1');
    const fromHr = svc ? (await svc.list()).map((e) => e.department).filter(Boolean) : [];
    const used = await ctx.db.transaction((tx) => rows<{ subject_id: string }>(tx, sql`SELECT DISTINCT subject_id FROM kpi_targets WHERE subject_type = 'unit'`));
    return [...new Set([...fromHr, ...used.map((u) => u.subject_id)])].sort().map((u) => ({ id: u, name: u }));
  }
  const used = await ctx.db.transaction((tx) => rows<{ subject_id: string; subject_name: string }>(tx, sql`SELECT DISTINCT subject_id, subject_name FROM kpi_targets WHERE subject_type = ${type}`));
  return used.map((u) => ({ id: u.subject_id, name: u.subject_name }));
}

// ---------------------------------------------------------------- scorecards

function cardScope(ctx: ModuleRequestContext): SQL {
  return ctx.can('kpi.view', 'company') ? sql`TRUE` : sql`(s.subject_type = 'person' AND s.subject_id = ${ctx.userId}::text)`;
}

export const Scorecards = {
  /**
   * (Re)computes the scorecards of a period for every subject of a level that has targets. A draft or reviewed
   * card is recomputed in place (back to draft); an approved card is kept and a new version is drafted.
   */
  async compute(ctx: ModuleRequestContext, input: z.infer<typeof scorecardComputeInput>) {
    const freq = parsePeriod(input.period)!.frequency;
    return ctx.db.transaction(async (tx) => {
      const defs = await rows<Definition>(tx, sql`SELECT ${DEF_COLS} FROM kpi_definitions d WHERE d.status = 'active' AND d.level = ${input.subjectType} AND d.frequency = ${freq} AND d.company_id = ${ctx.companyId}`);
      if (!defs.length) throw invalid('NO_DEFINITIONS', 'برای این سطح و نوع دوره شاخص فعالی تعریف نشده است');
      const ids = sql.join(defs.map((d) => sql`${d.id}::uuid`), sql`, `);
      const targets = await rows<{ definition_id: string; subject_id: string; subject_name: string; target: number }>(
        tx,
        sql`SELECT definition_id, subject_id, subject_name, target::float FROM kpi_targets WHERE period = ${input.period} AND subject_type = ${input.subjectType} AND definition_id IN (${ids})
          ${input.subjectId ? sql`AND subject_id = ${input.subjectId}` : sql``}`,
      );
      const values = await rows<{ definition_id: string; subject_id: string; value: number; status: string }>(
        tx,
        sql`SELECT definition_id, subject_id, value::float, status FROM kpi_values WHERE period = ${input.period} AND subject_type = ${input.subjectType} AND definition_id IN (${ids})`,
      );
      const subjectsMap = new Map(targets.map((t) => [t.subject_id, t.subject_name]));
      if (!subjectsMap.size) throw invalid('NO_TARGETS', 'برای این دوره هدفی تعیین نشده است');
      const done = [];
      for (const [subjectId, subjectName] of subjectsMap) {
        const items: ItemInput[] = defs.map((d) => {
          const v = values.find((x) => x.definition_id === d.id && x.subject_id === subjectId);
          return {
            definitionId: d.id, code: d.code, name: d.name, unit: d.unit, direction: d.direction, weight: d.weight, isGate: d.is_gate, goodPct: d.good_pct, warningPct: d.warning_pct,
            target: targets.find((t) => t.definition_id === d.id && t.subject_id === subjectId)?.target ?? null,
            value: v?.status === 'approved' ? v.value : null,
            valueStatus: v?.status ?? null,
          };
        });
        const card = scoreCard(items);
        const prev = await one<{ id: string; version: number; status: string }>(
          tx,
          sql`SELECT id, version, status FROM kpi_scorecards WHERE company_id = ${ctx.companyId} AND subject_type = ${input.subjectType} AND subject_id = ${subjectId} AND period = ${input.period}
            ORDER BY version DESC LIMIT 1 FOR UPDATE`,
        );
        const fields = sql`score = ${card.score}, complete = ${card.complete}, gate_failed = ${card.gateFailed}, breakdown = ${JSON.stringify(card)}::jsonb, computed_at = now(), computed_by = ${ctx.userId}`;
        if (prev && prev.status !== 'approved' && prev.status !== 'superseded') {
          await tx.execute(sql`UPDATE kpi_scorecards SET ${fields}, status = 'draft', reviewed_by = NULL, reviewed_at = NULL WHERE id = ${prev.id}`);
          done.push({ id: prev.id, subjectName, version: prev.version, score: card.score });
        } else {
          const id = randomUUID();
          const version = (prev?.version ?? 0) + 1;
          await tx.execute(sql`INSERT INTO kpi_scorecards (id, tenant_id, company_id, subject_type, subject_id, subject_name, period, version, score, complete, gate_failed, breakdown, computed_by)
            VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${input.subjectType}, ${subjectId}, ${subjectName}, ${input.period}, ${version}, ${card.score}, ${card.complete}, ${card.gateFailed},
                    ${JSON.stringify(card)}::jsonb, ${ctx.userId})`);
          done.push({ id, subjectName, version, score: card.score });
        }
      }
      await ctx.audit({ action: 'kpi.scorecards.computed', entityType: 'kpi_period', entityId: input.period, after: { level: input.subjectType, cards: done.length } }, tx);
      return done;
    });
  },

  list: (ctx: ModuleRequestContext, f: z.infer<typeof scorecardQuery>) =>
    ctx.db.transaction((tx) =>
      rows(tx, sql`SELECT s.id, s.subject_type, s.subject_id, s.subject_name, s.period, s.version, s.score::float, s.complete, s.gate_failed, s.status, s.computed_at, s.reviewed_by, s.approved_by,
          r.coefficient::float AS reward_coefficient
        FROM kpi_scorecards s LEFT JOIN kpi_reward_results r ON r.scorecard_id = s.id
        WHERE ${cardScope(ctx)} ${f.period ? sql`AND s.period = ${f.period}` : sql``} ${f.status ? sql`AND s.status = ${f.status}` : sql`AND s.status <> 'superseded'`}
        ORDER BY s.period DESC, s.subject_type, s.subject_name LIMIT 1000`),
    ),

  async get(ctx: ModuleRequestContext, id: string) {
    return ctx.db.transaction(async (tx) => {
      const s = await one<{ subject_type: string; subject_id: string; period: string; company_id: string }>(tx, sql`SELECT s.* , s.score::float FROM kpi_scorecards s WHERE s.id = ${id} AND ${cardScope(ctx)}`);
      if (!s) throw notFound('کارت امتیاز');
      const [versions, reward] = await Promise.all([
        rows(tx, sql`SELECT id, version, score::float, status, computed_at, approved_at FROM kpi_scorecards WHERE company_id = ${s.company_id} AND subject_type = ${s.subject_type} AND subject_id = ${s.subject_id} AND period = ${s.period} ORDER BY version DESC`),
        one(tx, sql`SELECT r.coefficient::float, r.reason, r.created_at, w.name AS rule_name, w.version AS rule_version FROM kpi_reward_results r JOIN kpi_reward_rules w ON w.id = r.rule_id WHERE r.scorecard_id = ${id}`),
      ]);
      return { scorecard: { ...s, label: periodLabel(s.period) }, versions, reward: reward ?? null };
    });
  },

  async review(ctx: ModuleRequestContext, id: string, comment: string) {
    await ctx.db.transaction(async (tx) => {
      const r = await rows(tx, sql`UPDATE kpi_scorecards SET status = 'reviewed', reviewed_by = ${ctx.userId}, reviewed_at = now(), comment = ${comment} WHERE id = ${id} AND status = 'draft' RETURNING id`);
      if (!r.length) throw conflict('NOT_DRAFT', 'فقط کارت پیش‌نویس بازبینی می‌شود');
      await ctx.audit({ action: 'kpi.scorecard.reviewed', entityType: 'kpi_scorecard', entityId: id, after: { comment } }, tx);
    });
  },

  /**
   * Final approval by someone other than the reviewer and the person scored; only complete cards. The reward
   * coefficient is computed with the active rule version and stored as a suggestion — nothing is paid.
   */
  async approve(ctx: ModuleRequestContext, id: string, comment: string) {
    const r = await ctx.db.transaction(async (tx) => {
      const s = await one<{ status: string; reviewed_by: string | null; subject_type: string; subject_id: string; subject_name: string; period: string; company_id: string; complete: boolean; score: number | null; gate_failed: boolean }>(
        tx,
        sql`SELECT status, reviewed_by, subject_type, subject_id, subject_name, period, company_id, complete, score::float, gate_failed FROM kpi_scorecards WHERE id = ${id} FOR UPDATE`,
      );
      if (!s) throw notFound('کارت امتیاز');
      if (s.status !== 'reviewed') throw conflict('NOT_REVIEWED', 'کارت امتیاز باید ابتدا بازبینی شود');
      if (s.reviewed_by === ctx.userId) throw forbidden('بازبین نمی‌تواند همان کارت را تأیید نهایی کند');
      if (s.subject_type === 'person' && s.subject_id === ctx.userId) throw forbidden('کارت امتیاز خودتان را نمی‌توانید تأیید کنید');
      if (!s.complete) throw conflict('INCOMPLETE', 'همه شاخص‌های کارت باید هدف و مقدار تأییدشده داشته باشند');
      await tx.execute(sql`UPDATE kpi_scorecards SET status = 'superseded' WHERE company_id = ${s.company_id} AND subject_type = ${s.subject_type} AND subject_id = ${s.subject_id} AND period = ${s.period} AND status = 'approved'`);
      await tx.execute(sql`UPDATE kpi_scorecards SET status = 'approved', approved_by = ${ctx.userId}, approved_at = now(), comment = CASE WHEN ${comment} = '' THEN comment ELSE ${comment} END WHERE id = ${id}`);
      const rule = await one<{ id: string; bands: RewardBand[]; gate_coefficient: number }>(tx, sql`SELECT id, bands, gate_coefficient::float FROM kpi_reward_rules WHERE company_id = ${s.company_id} AND active ORDER BY version DESC LIMIT 1`);
      let reward = null;
      if (rule) {
        reward = rewardCoefficient(s.score, rule.bands, s.gate_failed, rule.gate_coefficient);
        await tx.execute(sql`INSERT INTO kpi_reward_results (id, tenant_id, company_id, scorecard_id, rule_id, coefficient, reason) VALUES (${randomUUID()}, ${ctx.tenantId}, ${s.company_id}, ${id}, ${rule.id}, ${reward.coefficient}, ${reward.reason})`);
      }
      await ctx.publish('kpi.scorecard.approved', { scorecardId: id, subjectType: s.subject_type, subjectId: s.subject_id, period: s.period, score: s.score, gateFailed: s.gate_failed, rewardCoefficient: reward?.coefficient ?? null }, tx);
      await ctx.audit({ action: 'kpi.scorecard.approved', entityType: 'kpi_scorecard', entityId: id, after: { score: s.score, reward } }, tx);
      return s;
    });
    if (r.subject_type === 'person') {
      await ctx.notify({ userIds: [r.subject_id], type: 'kpi.scorecard.approved', title: `کارت امتیاز ${periodLabel(r.period)} شما تأیید شد`, link: `/app/kpi/scorecards/${id}` });
    }
  },
};

// ---------------------------------------------------------------- reward rules

export const Rewards = {
  list: (ctx: ModuleRequestContext) =>
    ctx.db.transaction((tx) => rows(tx, sql`SELECT id, version, name, bands, gate_coefficient::float, active, created_at, created_by FROM kpi_reward_rules ORDER BY version DESC`)),

  /** A new version of the rule; earlier versions remain for the results computed with them. */
  async save(ctx: ModuleRequestContext, input: z.infer<typeof rewardRuleInput>) {
    return ctx.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`kpi-rules:${ctx.companyId}`}))`);
      const v = (await one<{ v: number }>(tx, sql`SELECT coalesce(max(version), 0)::int + 1 AS v FROM kpi_reward_rules WHERE company_id = ${ctx.companyId}`))!.v;
      await tx.execute(sql`UPDATE kpi_reward_rules SET active = false WHERE company_id = ${ctx.companyId}`);
      const bands = [...input.bands].sort((a, b) => b.minScore - a.minScore);
      const id = randomUUID();
      await tx.execute(sql`INSERT INTO kpi_reward_rules (id, tenant_id, company_id, version, name, bands, gate_coefficient, created_by)
        VALUES (${id}, ${ctx.tenantId}, ${ctx.companyId}, ${v}, ${input.name}, ${JSON.stringify(bands)}::jsonb, ${input.gateCoefficient}, ${ctx.userId})`);
      await ctx.audit({ action: 'kpi.reward_rule.saved', entityType: 'kpi_reward_rule', entityId: id, after: { version: v, ...input } }, tx);
      return { id, version: v };
    });
  },
};

// ---------------------------------------------------------------- widget

export async function statusWidget(ctx: ModuleRequestContext) {
  return ctx.db.transaction(async (tx) => {
    // Latest approved value of each visible definition and subject, against its target.
    const latest = await rows<{ name: string; subject_name: string; period: string; value: number; target: number | null; direction: 'higher' | 'lower'; good_pct: number; warning_pct: number; is_gate: boolean; definition_id: string }>(
      tx,
      sql`SELECT DISTINCT ON (v.definition_id, v.subject_type, v.subject_id) d.id AS definition_id, d.name, v.subject_name, v.period, v.value::float, t.target::float, d.direction, d.good_pct::float, d.warning_pct::float, d.is_gate
        FROM kpi_values v JOIN kpi_definitions d ON d.id = v.definition_id
        LEFT JOIN kpi_targets t ON t.definition_id = v.definition_id AND t.period = v.period AND t.subject_type = v.subject_type AND t.subject_id = v.subject_id
        WHERE v.status = 'approved' AND d.status = 'active' AND ${defScope(ctx)}
        ORDER BY v.definition_id, v.subject_type, v.subject_id, v.period DESC`,
    );
    const items = latest.map((l) => {
      const c = scoreCard([{ definitionId: l.definition_id, code: '', name: l.name, unit: '', direction: l.direction, weight: 1, isGate: l.is_gate, goodPct: l.good_pct, warningPct: l.warning_pct, target: l.target, value: l.value, valueStatus: 'approved' }]).items[0]!;
      return { name: l.name, subject: l.subject_name, period: periodLabel(l.period), status: c.status, score: c.score, isGate: l.is_gate };
    });
    const pending = ctx.can('kpi.value.approve', 'company') ? (await one<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM kpi_values WHERE status = 'submitted' AND entered_by <> ${ctx.userId}`))!.n : null;
    const count = (s: string) => items.filter((i) => i.status === s).length;
    return { good: count('good'), warning: count('warning'), critical: count('critical'), attention: items.filter((i) => i.status === 'critical' || (i.isGate && i.status !== 'good')).slice(0, 6), pending };
  });
}

