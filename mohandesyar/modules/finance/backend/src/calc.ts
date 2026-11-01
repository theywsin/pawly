import { daysBetween, parseJalaliDate, toLatinDigits } from '@mohandesyar/persian';

/** Rial arithmetic in bigint; percentages are carried as thousandths of a percent. */
export const big = (v: string | number | bigint | null | undefined) => (v === null || v === undefined || v === '' ? 0n : BigInt(v));
const divRound = (a: bigint, b: bigint) => (a >= 0n ? (2n * a + b) / (2n * b) : -((2n * -a + b) / (2n * b)));

export type EacMethod = 'cpi' | 'budget_rate' | 'manual_etc';
export const EAC_FA: Record<EacMethod, string> = {
  cpi: 'AC + (BAC − EV) ÷ CPI',
  budget_rate: 'AC + (BAC − EV)',
  manual_etc: 'AC + ETC دستی',
};

export interface EacInput {
  bac: bigint; // approved budget at completion
  ac: bigint; // actual cost (executed payments, transfers excluded)
  physicalPct: number | null; // actual physical progress 0..100 from projects
  method: EacMethod;
  manualEtc: bigint | null;
}

export interface EacResult {
  ev: bigint | null;
  cpi: number | null;
  eac: bigint | null;
  vac: bigint | null;
  formula: string;
  reason: string | null;
}

export function computeEac(i: EacInput): EacResult {
  const ev = i.physicalPct === null ? null : divRound(i.bac * BigInt(Math.round(i.physicalPct * 1000)), 100_000n);
  const cpi = ev !== null && i.ac > 0n ? Number((ev * 10_000n) / i.ac) / 10_000 : null;
  let eac: bigint | null = null;
  let reason: string | null = null;
  if (i.method === 'manual_etc') {
    if (i.manualEtc === null) reason = 'برآورد هزینه باقی‌مانده (ETC) ثبت نشده است';
    else eac = i.ac + i.manualEtc;
  } else if (ev === null) {
    reason = 'پیشرفت فیزیکی پروژه در دسترس نیست';
  } else if (i.method === 'budget_rate') {
    eac = i.ac + (i.bac - ev);
  } else if (ev === 0n) {
    reason = 'ارزش کسب‌شده صفر است؛ CPI قابل محاسبه نیست';
  } else {
    // AC + (BAC − EV) / CPI, with CPI = EV / AC  ⇒  AC + (BAC − EV) · AC / EV
    eac = i.ac + divRound((i.bac - ev) * i.ac, ev);
  }
  return { ev, cpi, eac, vac: eac === null ? null : i.bac - eac, formula: EAC_FA[i.method], reason };
}

export interface StatementRow {
  line: number;
  occurredOn: string;
  amount: bigint; // + deposit, − withdrawal
  reference: string;
  description: string;
}

/**
 * Parses a bank statement exported as CSV/TSV: date, amount, reference, description. Dates may be Jalali
 * (1405/07/23) or ISO; amounts may use Persian digits, thousands separators and a leading minus or
 * trailing parentheses for withdrawals. A header row is skipped. Returns rows and per-line errors.
 */
export function parseStatement(csv: string): { rows: StatementRow[]; errors: { line: number; message: string }[] } {
  const rows: StatementRow[] = [];
  const errors: { line: number; message: string }[] = [];
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = idx + 1;
    if (!raw.trim()) return;
    const sep = raw.includes('\t') ? '\t' : raw.includes(';') ? ';' : ',';
    const cells = splitCsv(raw, sep).map((c) => c.trim());
    const [d = '', a = '', ref = '', ...desc] = cells;
    const dateText = toLatinDigits(d);
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(dateText) && Number(dateText.slice(0, 4)) > 1700 ? dateText : parseJalaliDate(dateText);
    if (!iso) {
      if (idx === 0) return; // header
      errors.push({ line, message: `تاریخ «${d}» معتبر نیست` });
      return;
    }
    let s = toLatinDigits(a).replace(/[,٬\s]/g, '');
    let neg = false;
    if (/^\(.*\)$/.test(s)) {
      neg = true;
      s = s.slice(1, -1);
    }
    if (s.startsWith('-') || s.startsWith('−')) {
      neg = true;
      s = s.slice(1);
    }
    if (s.startsWith('+')) s = s.slice(1);
    if (!/^\d{1,18}$/.test(s) || BigInt(s) === 0n) {
      errors.push({ line, message: `مبلغ «${a}» معتبر نیست` });
      return;
    }
    rows.push({ line, occurredOn: iso, amount: neg ? -BigInt(s) : BigInt(s), reference: ref.slice(0, 100), description: desc.join(sep === ',' ? ', ' : ' ').slice(0, 500) });
  });
  return { rows, errors };
}

function splitCsv(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      out.push(cur);
      cur = '';
    }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export interface MatchLine {
  id: string;
  occurredOn: string;
  amount: bigint;
  reference: string;
}
export interface MatchTx {
  id: string;
  occurredOn: string;
  signed: bigint; // in = +, out = −
  reference: string;
}

/**
 * Proposes one-to-one matches: same signed amount, dates within `days`; a matching reference wins, then
 * the nearest date. A line or transaction with two equally good candidates is left for the user.
 */
export function autoMatch(lines: MatchLine[], txs: MatchTx[], days = 3): { lineId: string; txId: string }[] {
  const used = new Set<string>();
  const out: { lineId: string; txId: string }[] = [];
  for (const l of [...lines].sort((a, b) => a.occurredOn.localeCompare(b.occurredOn))) {
    const cands = txs
      .filter((t) => !used.has(t.id) && t.signed === l.amount && Math.abs(daysBetween(l.occurredOn, t.occurredOn)) <= days)
      .map((t) => ({ t, score: (l.reference && t.reference && l.reference === t.reference ? 0 : 100) + Math.abs(daysBetween(l.occurredOn, t.occurredOn)) }))
      .sort((a, b) => a.score - b.score);
    if (!cands.length) continue;
    if (cands.length > 1 && cands[0]!.score === cands[1]!.score) continue;
    used.add(cands[0]!.t.id);
    out.push({ lineId: l.id, txId: cands[0]!.t.id });
  }
  return out;
}
