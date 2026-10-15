/**
 * A small, safe arithmetic language for KPI formulas (docs/05 kpi_definitions.formula) — a hand-written
 * tokenizer and recursive-descent parser; nothing is ever passed to eval/Function.
 *
 *   expr   := term (('+' | '-') term)*
 *   term   := unary (('*' | '/') unary)*
 *   unary  := '-' unary | atom
 *   atom   := number | variable | func '(' expr (',' expr)* ')' | '(' expr ')'
 *
 * Variables are KPI codes ([a-z][a-z0-9_]*); functions: min, max, abs, round. Division by zero or a
 * missing variable makes the result null (reported, never silently zero).
 */

export type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'neg'; e: Node }
  | { t: 'bin'; op: '+' | '-' | '*' | '/'; a: Node; b: Node }
  | { t: 'call'; fn: 'min' | 'max' | 'abs' | 'round'; args: Node[] };

export class FormulaError extends Error {}

const FUNCS = new Set(['min', 'max', 'abs', 'round']);
const MAX_LEN = 500;
const MAX_DEPTH = 40;

type Tok = { k: 'num'; v: number; p: number } | { k: 'id'; v: string; p: number } | { k: 'op'; v: string; p: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(src.slice(i));
      if (!m) throw new FormulaError(`عدد نامعتبر در نویسه ${i + 1}`);
      out.push({ k: 'num', v: Number(m[0]), p: i });
      i += m[0].length;
    } else if (/[a-z_]/i.test(c)) {
      const m = /^[a-z_][a-z0-9_]*/i.exec(src.slice(i))!;
      out.push({ k: 'id', v: m[0].toLowerCase(), p: i });
      i += m[0].length;
    } else if ('+-*/(),'.includes(c)) {
      out.push({ k: 'op', v: c, p: i });
      i++;
    } else {
      throw new FormulaError(`نویسه غیرمجاز «${c}» در جایگاه ${i + 1}`);
    }
  }
  return out;
}

export function parseFormula(src: string): Node {
  const text = src.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/×/g, '*').replace(/÷/g, '/');
  if (!text.trim()) throw new FormulaError('فرمول خالی است');
  if (text.length > MAX_LEN) throw new FormulaError(`فرمول حداکثر ${MAX_LEN} نویسه است`);
  const toks = tokenize(text);
  let i = 0;
  let depth = 0;
  const peek = () => toks[i];
  const isOp = (v: string) => peek()?.k === 'op' && peek()!.v === v;
  const expectOp = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`«${v}» انتظار می‌رفت${peek() ? ` در جایگاه ${peek()!.p + 1}` : ' در پایان فرمول'}`);
    i++;
  };
  const enter = () => {
    if (++depth > MAX_DEPTH) throw new FormulaError('فرمول بیش از حد تودرتو است');
  };
  function expr(): Node {
    enter();
    let n = term();
    while (isOp('+') || isOp('-')) {
      const op = toks[i++]!.v as '+' | '-';
      n = { t: 'bin', op, a: n, b: term() };
    }
    depth--;
    return n;
  }
  function term(): Node {
    let n = unary();
    while (isOp('*') || isOp('/')) {
      const op = toks[i++]!.v as '*' | '/';
      n = { t: 'bin', op, a: n, b: unary() };
    }
    return n;
  }
  function unary(): Node {
    if (isOp('-')) {
      i++;
      enter();
      const e = unary();
      depth--;
      return { t: 'neg', e };
    }
    return atom();
  }
  function atom(): Node {
    const tk = peek();
    if (!tk) throw new FormulaError('فرمول ناقص است');
    if (tk.k === 'num') {
      i++;
      return { t: 'num', v: tk.v };
    }
    if (tk.k === 'id') {
      i++;
      if (isOp('(')) {
        if (!FUNCS.has(tk.v)) throw new FormulaError(`تابع «${tk.v}» پشتیبانی نمی‌شود (مجاز: min، max، abs، round)`);
        i++;
        const args = [expr()];
        while (isOp(',')) {
          i++;
          args.push(expr());
        }
        expectOp(')');
        const fn = tk.v as 'min' | 'max' | 'abs' | 'round';
        if ((fn === 'abs' || fn === 'round') && args.length !== 1) throw new FormulaError(`تابع ${fn} یک ورودی می‌گیرد`);
        return { t: 'call', fn, args };
      }
      if (FUNCS.has(tk.v)) throw new FormulaError(`«${tk.v}» نام تابع است و نمی‌تواند متغیر باشد`);
      return { t: 'var', name: tk.v };
    }
    if (tk.v === '(') {
      i++;
      const e = expr();
      expectOp(')');
      return e;
    }
    throw new FormulaError(`«${tk.v}» در جایگاه ${tk.p + 1} انتظار نمی‌رفت`);
  }
  const root = expr();
  if (i < toks.length) throw new FormulaError(`«${toks[i]!.v}» در جایگاه ${toks[i]!.p + 1} انتظار نمی‌رفت`);
  return root;
}

export function variables(n: Node, out = new Set<string>()): Set<string> {
  if (n.t === 'var') out.add(n.name);
  else if (n.t === 'neg') variables(n.e, out);
  else if (n.t === 'bin') {
    variables(n.a, out);
    variables(n.b, out);
  }
  else if (n.t === 'call') n.args.forEach((a) => variables(a, out));
  return out;
}

/** Evaluates with the given variable values; null when a variable is missing or a division by zero occurs. */
export function evaluate(n: Node, vars: Record<string, number | null | undefined>): number | null {
  switch (n.t) {
    case 'num':
      return n.v;
    case 'var': {
      const v = vars[n.name];
      return v === null || v === undefined || !Number.isFinite(v) ? null : v;
    }
    case 'neg': {
      const v = evaluate(n.e, vars);
      return v === null ? null : -v;
    }
    case 'bin': {
      const a = evaluate(n.a, vars);
      const b = evaluate(n.b, vars);
      if (a === null || b === null) return null;
      if (n.op === '+') return a + b;
      if (n.op === '-') return a - b;
      if (n.op === '*') return a * b;
      return b === 0 ? null : a / b;
    }
    case 'call': {
      const args = n.args.map((x) => evaluate(x, vars));
      if (args.some((x) => x === null)) return null;
      const v = args as number[];
      if (n.fn === 'min') return Math.min(...v);
      if (n.fn === 'max') return Math.max(...v);
      if (n.fn === 'abs') return Math.abs(v[0]!);
      return Math.round(v[0]!);
    }
  }
}
