import { parse } from 'libpg-query';

/**
 * AST-based lint for module migrations (docs/03-module-system.md §7). Runs at `module:pack` time and
 * again on the server before any SQL is executed. It is an allowlist: unknown statement types fail.
 *
 * Known limitation: PL/pgSQL function bodies are opaque strings and are not inspected; functions run
 * with the invoker's privileges (the RLS-bound app role), and SECURITY DEFINER is rejected.
 */

const ALLOWED_STATEMENTS = new Set([
  'CreateStmt',
  'IndexStmt',
  'AlterTableStmt',
  'CreatePolicyStmt',
  'AlterPolicyStmt',
  'DropStmt',
  'RenameStmt',
  'CommentStmt',
  'CreateEnumStmt',
  'AlterEnumStmt',
  'CreateSeqStmt',
  'AlterSeqStmt',
  'ViewStmt',
  'CreateFunctionStmt',
  'CreateTrigStmt',
  'InsertStmt',
  'UpdateStmt',
  'DeleteStmt',
  'SelectStmt',
]);

const ALLOWED_DROP_TYPES = new Set(['OBJECT_TABLE', 'OBJECT_INDEX', 'OBJECT_POLICY', 'OBJECT_VIEW', 'OBJECT_SEQUENCE', 'OBJECT_TYPE', 'OBJECT_TRIGGER', 'OBJECT_FUNCTION']);

/** Relations that module SQL may read without owning them (none today; kept explicit). */
const READABLE_SYSTEM_RELATIONS = new Set<string>();

export interface LintIssue {
  file: string;
  statement: number;
  message: string;
}

type Node = Record<string, unknown>;

function* walk(node: unknown): Generator<[string, Node]> {
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Node)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) yield [k, v as Node];
      yield* walk(v);
    }
  }
}

function sval(n: unknown): string | undefined {
  return (n as { String?: { sval?: string } })?.String?.sval;
}

export async function lintMigration(file: string, sqlText: string, tablePrefix: string): Promise<LintIssue[]> {
  const issues: LintIssue[] = [];
  let tree: { stmts?: { stmt: Node }[] };
  try {
    tree = (await parse(sqlText)) as unknown as typeof tree;
  } catch (err) {
    return [{ file, statement: 0, message: `خطای نحوی SQL: ${(err as Error).message}` }];
  }
  const ctes = new Set<string>();
  (tree.stmts ?? []).forEach(({ stmt }, idx) => {
    const n = idx + 1;
    const add = (message: string) => issues.push({ file, statement: n, message });
    const [type, body] = Object.entries(stmt)[0] as [string, Node];

    if (!ALLOWED_STATEMENTS.has(type)) {
      add(`دستور ${type} در مهاجرت ماژول مجاز نیست`);
      return;
    }
    if (type === 'IndexStmt' && body.concurrent) add('CREATE INDEX CONCURRENTLY در مهاجرت تراکنشی مجاز نیست');
    if (type === 'DropStmt' && !ALLOWED_DROP_TYPES.has(String(body.removeType))) add(`حذف شیء از نوع ${String(body.removeType)} مجاز نیست`);
    if (type === 'CreateFunctionStmt') {
      for (const [k, v] of walk(body)) {
        if (k === 'DefElem' && v.defname === 'security' && (v.arg as Node)?.Boolean) add('تابع SECURITY DEFINER مجاز نیست');
      }
      const name = (body.funcname as unknown[] | undefined)?.map(sval).filter(Boolean).at(-1);
      if (name && !name.startsWith(tablePrefix)) add(`نام تابع «${name}» باید با «${tablePrefix}» شروع شود`);
    }
    if (type === 'CreateEnumStmt') {
      const name = (body.typeName as unknown[] | undefined)?.map(sval).filter(Boolean).at(-1);
      if (name && !name.startsWith(tablePrefix)) add(`نام نوع «${name}» باید با «${tablePrefix}» شروع شود`);
    }
    if (type === 'CreateStmt' || type === 'ViewStmt') {
      const rel = (type === 'CreateStmt' ? body.relation : body.view) as Node | undefined;
      if (rel?.relpersistence === 't') add('جدول موقت در مهاجرت مجاز نیست');
    }

    for (const [k, v] of walk(body)) {
      if (k === 'CommonTableExpr' && typeof v.ctename === 'string') ctes.add(v.ctename);
    }
    for (const [k, v] of walk(stmt)) {
      if (k !== 'RangeVar' && k !== 'relation' && k !== 'view' && k !== 'table') continue;
      const relname = v.relname;
      if (typeof relname !== 'string') continue;
      const schema = v.schemaname;
      if (schema !== undefined && schema !== 'public') {
        add(`ارجاع به شِمای «${String(schema)}» مجاز نیست`);
        continue;
      }
      if (ctes.has(relname) || READABLE_SYSTEM_RELATIONS.has(relname)) continue;
      if (!relname.startsWith(tablePrefix)) add(`ارجاع به جدول «${relname}» خارج از پیشوند ماژول «${tablePrefix}» است`);
    }
    for (const [k, v] of walk(stmt)) {
      if (k === 'DropStmt' || k === 'RenameStmt') {
        for (const [k2, v2] of walk(v)) {
          if (k2 === 'List') {
            const parts = ((v2.items as unknown[]) ?? []).map(sval).filter(Boolean) as string[];
            const target = parts.at(-1);
            if (target && parts.length <= 2 && !target.startsWith(tablePrefix) && v.removeType !== 'OBJECT_POLICY' && v.removeType !== 'OBJECT_TRIGGER') {
              add(`حذف/تغییر نام «${target}» خارج از پیشوند ماژول است`);
            }
          }
        }
      }
    }
  });
  return issues;
}
