import type { ImportResult, ImportRow, ModuleRequestContext } from '@mohandesyar/module-sdk/server';
import { normalizePersian, parseJalaliDate, toLatinDigits } from '@mohandesyar/persian';
import { readSpreadsheet, SpreadsheetError } from './spreadsheet.js';

export interface ImportColumn {
  key: string;
  header: string;
  required: boolean;
  type: 'text' | 'integer' | 'decimal' | 'money' | 'date' | 'boolean' | 'enum';
  values?: Record<string, string>;
  maxLength?: number;
  hint?: string;
}
export interface ImportTemplate {
  key: string;
  title: { fa: string };
  permission: string;
  columns: ImportColumn[];
}
export interface ImportError {
  row: number;
  column?: string;
  message: string;
}

const norm = (s: string) => normalizePersian(s).replace(/\s*\*$/, '');
const fa = (n: number) => n.toLocaleString('fa-IR');
const YES = new Set(['بله', 'آری', 'دارد', 'true', 'yes', '1', 'y', 'x', '✓']);
const NO = new Set(['خیر', 'نه', 'ندارد', 'false', 'no', '0', 'n']);

/** Excel serial day (1900 date system, with its 1900 leap-year bug) → ISO date. */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
}

/** Converts one cell by column type; returns the stored string, null for empty, or an error message. */
export function convertCell(c: ImportColumn, raw: string): { value: string | null } | { error: string } {
  const text = raw.replace(/‏|‎/g, '').trim();
  if (text === '') return c.required ? { error: `«${c.header}» الزامی است` } : { value: null };
  const latin = toLatinDigits(text).replace(/[٬,\s]/g, '');
  switch (c.type) {
    case 'text':
      if (c.maxLength && text.length > c.maxLength) return { error: `«${c.header}» حداکثر ${fa(c.maxLength)} نویسه است` };
      return { value: text };
    case 'integer':
    case 'money': {
      let v = latin.replace(/\.0+$/, '');
      if (/^-?\d+(\.\d+)?e[+-]?\d+$/i.test(v)) v = BigInt(Math.round(Number(v))).toString();
      if (!/^-?\d{1,18}$/.test(v)) return { error: `«${c.header}» باید عدد صحیح باشد («${text}»)` };
      if (c.type === 'money' && v.startsWith('-')) return { error: `«${c.header}» نمی‌تواند منفی باشد` };
      return { value: v.replace(/^(-?)0+(?=\d)/, '$1') };
    }
    case 'decimal': {
      const v = latin.replace('٫', '.');
      if (!/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(v) || !Number.isFinite(Number(v))) return { error: `«${c.header}» باید عدد باشد («${text}»)` };
      return { value: /e/i.test(v) ? String(Number(v)) : v };
    }
    case 'date': {
      if (/^\d+(\.\d+)?$/.test(latin) && Number(latin) < 200_000) {
        const iso = excelSerialToIso(Number(latin));
        return iso ? { value: iso } : { error: `«${c.header}» تاریخ معتبر نیست («${text}»)` };
      }
      const m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:[T\s].*)?$/.exec(toLatinDigits(text));
      if (m && Number(m[1]) > 1700) {
        const iso = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
        const d = new Date(`${iso}T00:00:00Z`);
        return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(iso) ? { value: iso } : { error: `«${c.header}» تاریخ معتبر نیست («${text}»)` };
      }
      const j = m ? parseJalaliDate(`${m[1]}/${m[2]}/${m[3]}`) : null;
      return j ? { value: j } : { error: `«${c.header}» تاریخ معتبر نیست («${text}»)؛ مثال: ۱۴۰۵/۰۷/۲۳` };
    }
    case 'boolean': {
      const k = norm(text);
      if (YES.has(k)) return { value: 'true' };
      if (NO.has(k)) return { value: 'false' };
      return { error: `«${c.header}» باید «بله» یا «خیر» باشد` };
    }
    case 'enum': {
      const k = norm(text);
      for (const [label, value] of Object.entries(c.values ?? {})) if (norm(label) === k || norm(value) === k) return { value };
      return { error: `«${c.header}» باید یکی از این‌ها باشد: ${Object.keys(c.values ?? {}).join('، ')}` };
    }
  }
}

/**
 * Turns a sheet into typed rows: the first non-empty row is the header, matched to columns by header text
 * (a trailing «*» ignored) or by key; fully empty rows are skipped. Missing required columns are an error.
 */
export function mapRows(t: ImportTemplate, sheet: string[][]): { rows: ImportRow[]; errors: ImportError[]; ignored: string[] } {
  const headerAt = sheet.findIndex((r) => r.some((c) => c.trim() !== ''));
  if (headerAt < 0) return { rows: [], errors: [{ row: 0, message: 'فایل خالی است' }], ignored: [] };
  const header = sheet[headerAt]!;
  const pos = new Map<string, number>();
  const ignored: string[] = [];
  header.forEach((h, i) => {
    if (!h.trim()) return;
    const col = t.columns.find((c) => norm(c.header) === norm(h) || c.key.toLowerCase() === h.trim().toLowerCase());
    if (col && !pos.has(col.key)) pos.set(col.key, i);
    else ignored.push(h.trim());
  });
  const missing = t.columns.filter((c) => c.required && !pos.has(c.key));
  if (missing.length) return { rows: [], errors: missing.map((c) => ({ row: headerAt + 1, column: c.key, message: `ستون «${c.header}» در سطر عنوان یافت نشد` })), ignored };
  const rows: ImportRow[] = [];
  const errors: ImportError[] = [];
  for (let i = headerAt + 1; i < sheet.length; i++) {
    const r = sheet[i]!;
    if (!r.some((c) => c.trim() !== '')) continue;
    const values: Record<string, string | null> = {};
    for (const c of t.columns) {
      const p = pos.get(c.key);
      const res = convertCell(c, p === undefined ? '' : (r[p] ?? ''));
      if ('error' in res) errors.push({ row: i + 1, column: c.key, message: res.error });
      else values[c.key] = res.value;
    }
    rows.push({ row: i + 1, values });
  }
  if (!rows.length && !errors.length) errors.push({ row: headerAt + 1, message: 'ردیف داده‌ای زیر سطر عنوان نیست' });
  return { rows, errors, ignored };
}

export interface ImportOutcome {
  total: number;
  created: number;
  imported: boolean;
  errors: ImportError[];
  ignoredColumns: string[];
}

/** Parses, converts and runs the module importer: always a dry run first; writes only when asked and clean. */
export async function runImport(
  t: ImportTemplate,
  importer: (ctx: ModuleRequestContext, rows: ImportRow[], opts: { dryRun: boolean }) => Promise<ImportResult>,
  ctx: ModuleRequestContext,
  file: { data: Buffer; name: string },
  commit: boolean,
): Promise<ImportOutcome> {
  let sheet: string[][];
  try {
    sheet = readSpreadsheet(file.data, file.name);
  } catch (e) {
    if (e instanceof SpreadsheetError) return { total: 0, created: 0, imported: false, errors: [{ row: 0, message: e.message }], ignoredColumns: [] };
    throw e;
  }
  const { rows, errors, ignored } = mapRows(t, sheet);
  const base = { total: rows.length, ignoredColumns: ignored };
  if (errors.length) return { ...base, created: 0, imported: false, errors: errors.slice(0, 500) };
  const dry = await importer(ctx, rows, { dryRun: true });
  if (dry.errors.length || !commit) return { ...base, created: dry.created, imported: false, errors: dry.errors.slice(0, 500) };
  const done = await importer(ctx, rows, { dryRun: false });
  return { ...base, created: done.created, imported: done.errors.length === 0, errors: done.errors.slice(0, 500) };
}
