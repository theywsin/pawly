import { inflateRawSync } from 'node:zlib';

/**
 * Minimal, dependency-free readers for the first worksheet of an .xlsx file and for CSV/TSV text. Values
 * come back as strings exactly as stored (numbers as written by Excel, dates as serial numbers); the import
 * service converts them by column type. Limits guard against zip bombs and oversized sheets.
 */
export class SpreadsheetError extends Error {}

const MAX_ENTRY = 30 * 1024 * 1024;
export const MAX_ROWS = 5000;
const MAX_COLS = 100;

export function readSpreadsheet(data: Buffer, filename: string): string[][] {
  if (data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return readXlsx(data);
  if (/\.(xlsx|xlsm)$/i.test(filename)) throw new SpreadsheetError('فایل Excel معتبر نیست');
  if (/\.xls$/i.test(filename)) throw new SpreadsheetError('قالب قدیمی xls پشتیبانی نمی‌شود؛ فایل را با قالب xlsx یا CSV ذخیره کنید');
  return readCsv(data.toString('utf8'));
}

// ---------------------------------------------------------------- zip

function unzip(data: Buffer): Map<string, () => Buffer> {
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65_557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SpreadsheetError('فایل Excel معتبر نیست');
  const count = data.readUInt16LE(eocd + 10);
  let p = data.readUInt32LE(eocd + 16);
  const files = new Map<string, () => Buffer>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > data.length || data.readUInt32LE(p) !== 0x02014b50) throw new SpreadsheetError('فایل Excel معتبر نیست');
    const method = data.readUInt16LE(p + 10);
    const csize = data.readUInt32LE(p + 20);
    const usize = data.readUInt32LE(p + 24);
    const nameLen = data.readUInt16LE(p + 28);
    const extraLen = data.readUInt16LE(p + 30);
    const commentLen = data.readUInt16LE(p + 32);
    const local = data.readUInt32LE(p + 42);
    const name = data.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    files.set(name, () => {
      if (usize > MAX_ENTRY) throw new SpreadsheetError('فایل بیش از حد بزرگ است');
      if (local + 30 > data.length || data.readUInt32LE(local) !== 0x04034b50) throw new SpreadsheetError('فایل Excel معتبر نیست');
      const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
      const raw = data.subarray(start, start + csize);
      if (method === 0) return raw;
      if (method === 8) {
        try {
          return inflateRawSync(raw, { maxOutputLength: MAX_ENTRY });
        } catch {
          throw new SpreadsheetError('فایل Excel معتبر نیست یا بیش از حد بزرگ است');
        }
      }
      throw new SpreadsheetError('روش فشرده‌سازی فایل پشتیبانی نمی‌شود');
    });
  }
  return files;
}

// ---------------------------------------------------------------- xml helpers

const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_m, e: string) => {
    const k = e.toLowerCase();
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'amp') return '&';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const cp = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
  });
/** Concatenated text of all <t> elements (rich text runs included, phonetic <rPh> excluded). */
const textOf = (xml: string) => decode([...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

function colIndex(ref: string) {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readXlsx(data: Buffer): string[][] {
  const files = unzip(data);
  const get = (name: string) => files.get(name)?.().toString('utf8');
  // First sheet in workbook order, resolved through the workbook relationships.
  const workbook = get('xl/workbook.xml');
  const rels = get('xl/_rels/workbook.xml.rels');
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const first = workbook && /<sheet\b[^>]*>/.exec(workbook)?.[0];
  const rid = first && (attr(first, 'r:id') ?? /\br:id="([^"]*)"/.exec(first)?.[1]);
  if (rid && rels) {
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => attr(r, 'Id') === rid);
    const target = rel && attr(rel, 'Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheet = get(sheetPath);
  if (!sheet) throw new SpreadsheetError('برگه‌ای در فایل Excel یافت نشد');
  const ssXml = get('xl/sharedStrings.xml');
  const shared = ssXml ? [...ssXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!)) : [];
  const out: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const r = Number(attr(rm[1] ?? rm[3] ?? '', 'r') ?? out.length + 1);
    if (r > MAX_ROWS + 1) throw new SpreadsheetError(`حداکثر ${MAX_ROWS.toLocaleString('fa-IR')} ردیف در هر بار ورود مجاز است`);
    const cells: string[] = [];
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = cm[1]!;
      const body = cm[2] ?? '';
      const ref = attr(head, 'r');
      const i = ref ? colIndex(ref) : cells.length;
      if (i < 0 || i >= MAX_COLS) continue;
      const t = attr(head, 't');
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      cells[i] = t === 's' ? (shared[Number(v)] ?? '') : t === 'inlineStr' ? textOf(body) : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : v === undefined ? '' : decode(v);
    }
    while (out.length < r - 1) out.push([]);
    out.push(Array.from(cells, (c) => c ?? ''));
  }
  return out;
}

// ---------------------------------------------------------------- csv

export function readCsv(text: string): string[][] {
  const s = text.replace(/^\uFEFF/, '');
  const firstLine = s.slice(0, s.search(/\r?\n|$/));
  const sep = firstLine.includes('\t') ? '\t' : firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"' && cur === '') q = true;
    else if (c === sep) {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      if (rows.length > MAX_ROWS + 1) throw new SpreadsheetError(`حداکثر ${MAX_ROWS.toLocaleString('fa-IR')} ردیف در هر بار ورود مجاز است`);
      row = [];
      cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}
