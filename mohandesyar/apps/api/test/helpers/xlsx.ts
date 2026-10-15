import { deflateRawSync } from 'node:zlib';

/** CRC-32 for zip entries. */
function crc32(b: Buffer) {
  let c = ~0;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** Zip with DEFLATE entries, as Excel writes them (the export code in the UI package only stores). */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8');
    const data = deflateRawSync(raw);
    const n = Buffer.from(name, 'utf8');
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0);
    l.writeUInt16LE(20, 4);
    l.writeUInt16LE(8, 8);
    l.writeUInt32LE(crc32(raw), 14);
    l.writeUInt32LE(data.length, 18);
    l.writeUInt32LE(raw.length, 22);
    l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc32(raw), 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    locals.push(l, n, data);
    centrals.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(Object.keys(files).length, 8);
  e.writeUInt16LE(Object.keys(files).length, 10);
  e.writeUInt32LE(cd.length, 12);
  e.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, e]);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const colName = (i: number) => (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '') + String.fromCharCode(65 + (i % 26));

/**
 * A real-world-shaped workbook: text in sharedStrings, numbers as <v>, an Excel date serial, the sheet
 * reached through workbook relationships (named "data.xml", not sheet1.xml). Cells: string or number.
 */
export function xlsx(rows: (string | number | null)[][]): Buffer {
  const shared: string[] = [];
  const sheetRows = rows
    .map((r, ri) => {
      const cells = r
        .map((v, ci) => {
          if (v === null || v === '') return '';
          const ref = `${colName(ci)}${ri + 1}`;
          if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
          shared.push(v);
          return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
        })
        .join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="داده" sheetId="1" r:id="rId7"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId7" Type="worksheet" Target="worksheets/data.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<sst>${shared.map((s) => `<si><r><t>${esc(s)}</t></r></si>`).join('')}</sst>`,
    'xl/worksheets/data.xml': `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
  });
}
