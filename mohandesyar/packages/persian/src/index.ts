/**
 * Persian formatting and normalisation (docs/08 §5). Dates are stored in UTC and displayed in the
 * Jalali (Solar Hijri) calendar through the platform's ICU data (Intl "persian" calendar); no
 * calendar library is needed for display.
 */

export type DigitStyle = 'fa' | 'latn';

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function toPersianDigits(s: string | number): string {
  return String(s).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]!);
}

export function toLatinDigits(s: string): string {
  return s.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d))).replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

export function formatNumber(n: number | bigint | string, opts: { digits?: DigitStyle; maximumFractionDigits?: number } = {}): string {
  const value = typeof n === 'string' ? Number(n) : n;
  const locale = opts.digits === 'latn' ? 'fa-IR-u-nu-latn' : 'fa-IR';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: opts.maximumFractionDigits ?? 2 }).format(value as number);
}

/** Amounts are stored in rial (integers). Toman = rial / 10. */
export function formatMoney(rial: number | bigint | string, opts: { unit?: 'rial' | 'toman'; digits?: DigitStyle } = {}): string {
  const r = typeof rial === 'bigint' ? rial : BigInt(typeof rial === 'string' ? rial : Math.round(rial));
  const unit = opts.unit ?? 'rial';
  const value = unit === 'toman' ? r / 10n : r;
  const locale = opts.digits === 'latn' ? 'fa-IR-u-nu-latn' : 'fa-IR';
  return `${new Intl.NumberFormat(locale).format(value)} ${unit === 'toman' ? 'تومان' : 'ریال'}`;
}

export interface DateFormatOptions {
  digits?: DigitStyle;
  timeZone?: string;
  withTime?: boolean;
  style?: 'short' | 'medium' | 'long';
}

export function formatDate(value: string | number | Date, opts: DateFormatOptions = {}): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const locale = `fa-IR-u-ca-persian${opts.digits === 'latn' ? '-nu-latn' : ''}`;
  const style = opts.style ?? 'medium';
  // dateStyle cannot be combined with individual hour/minute fields; use timeStyle in that case.
  const options: Intl.DateTimeFormatOptions =
    style === 'short'
      ? { year: 'numeric', month: '2-digit', day: '2-digit', ...(opts.withTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}) }
      : { dateStyle: style, ...(opts.withTime ? { timeStyle: 'short', hourCycle: 'h23' } : {}) };
  return new Intl.DateTimeFormat(locale, { timeZone: opts.timeZone ?? 'Asia/Tehran', ...options }).format(d);
}

/** Jalali year/month/day of an instant in a time zone. */
export function jalaliParts(value: string | number | Date, timeZone = 'Asia/Tehran'): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(value));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

const RTF = new Intl.RelativeTimeFormat('fa', { numeric: 'auto' });
export function formatRelative(value: string | number | Date, now = Date.now()): string {
  const diff = (new Date(value).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return RTF.format(Math.round(diff), 'second');
  if (abs < 3600) return RTF.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return RTF.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return RTF.format(Math.round(diff / 86400), 'day');
  return formatDate(value);
}

/**
 * Normalises Persian text for storage keys, search and duplicate detection: Arabic Yeh/Kaf → Persian,
 * strips diacritics and tatweel, unifies ZWNJ/spaces, converts digits to Latin, lower-cases Latin.
 */
export function normalizePersian(text: string): string {
  return toLatinDigits(text)
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ۀة]/g, 'ه')
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[‌‏‎]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Validates an Iranian national ID (کد ملی) checksum. */
export function isValidNationalId(code: string): boolean {
  const c = toLatinDigits(code).trim();
  if (!/^\d{10}$/.test(c) || /^(\d)\1{9}$/.test(c)) return false;
  const check = Number(c[9]);
  const sum = [...c.slice(0, 9)].reduce((s, d, i) => s + Number(d) * (10 - i), 0) % 11;
  return sum < 2 ? check === sum : check === 11 - sum;
}

/**
 * Normalises an Iranian mobile number to 09XXXXXXXXX (accepts Persian/Arabic digits, +98, 0098, spaces
 * and dashes). Returns null when the input is not a valid Iranian mobile number.
 */
export function normalizeIranMobile(input: string): string | null {
  const d = toLatinDigits(input).replace(/[\s\-()]/g, '');
  const m = /^(?:\+98|0098|98|0)?(9\d{9})$/.exec(d);
  return m ? `0${m[1]}` : null;
}

/** Loose international phone check (landlines, foreign numbers): 7–15 digits after normalisation. */
export function normalizePhone(input: string): string | null {
  const mobile = normalizeIranMobile(input);
  if (mobile) return mobile;
  const d = toLatinDigits(input).replace(/[\s\-()]/g, '');
  return /^\+?\d{7,15}$/.test(d) ? d : null;
}
export * from './jalali.js';
