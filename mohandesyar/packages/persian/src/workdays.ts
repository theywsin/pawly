/**
 * Working-day calendar: weekly days off (Friday by default) plus holidays. Fixed solar (Jalali) official
 * holidays are computed; lunar (Hijri) holidays move every year and are entered by the organisation.
 */
import { toGregorian, toJalali } from './jalali.js';

/** Jalali month/day of Iran's fixed official holidays (solar calendar). */
export const FIXED_OFFICIAL_HOLIDAYS: { month: number; day: number; title: string }[] = [
  { month: 1, day: 1, title: 'عید نوروز' },
  { month: 1, day: 2, title: 'عید نوروز' },
  { month: 1, day: 3, title: 'عید نوروز' },
  { month: 1, day: 4, title: 'عید نوروز' },
  { month: 1, day: 12, title: 'روز جمهوری اسلامی' },
  { month: 1, day: 13, title: 'روز طبیعت' },
  { month: 3, day: 14, title: 'رحلت امام خمینی' },
  { month: 3, day: 15, title: 'قیام ۱۵ خرداد' },
  { month: 11, day: 22, title: 'پیروزی انقلاب اسلامی' },
  { month: 12, day: 29, title: 'ملی شدن صنعت نفت' },
];

const pad = (n: number) => String(n).padStart(2, '0');

/** Fixed official holidays of one Jalali year as ISO dates. */
export function fixedHolidays(jy: number): { date: string; title: string }[] {
  return FIXED_OFFICIAL_HOLIDAYS.map((h) => {
    const g = toGregorian(jy, h.month, h.day);
    return { date: `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`, title: h.title };
  });
}

export interface WorkCalendar {
  /** JS weekday numbers (0 = Sunday … 5 = Friday, 6 = Saturday) that are always off. */
  weeklyOff: readonly number[];
  /** Extra non-working ISO dates (organisation holidays, lunar official holidays). */
  holidays: ReadonlySet<string>;
  /** Include the computed fixed official holidays (default true). */
  fixedOfficial?: boolean;
}

const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const shift = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

export function isWorkingDay(iso: string, cal: WorkCalendar): boolean {
  if (cal.weeklyOff.includes(weekday(iso)) || cal.holidays.has(iso)) return false;
  if (cal.fixedOfficial !== false) {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    const j = toJalali(y, m, d);
    if (FIXED_OFFICIAL_HOLIDAYS.some((h) => h.month === j.jm && h.day === j.jd)) return false;
  }
  return true;
}

/** First working day on or after `iso`. */
export function nextWorkingDay(iso: string, cal: WorkCalendar): string {
  let d = iso;
  for (let i = 0; i < 400 && !isWorkingDay(d, cal); i++) d = shift(d, 1);
  return d;
}

/** The `n`-th working day counted from `start` (n = 0 → first working day on or after start). */
export function workingDayAt(start: string, n: number, cal: WorkCalendar): string {
  let d = nextWorkingDay(start, cal);
  for (let i = 0; i < n; i++) d = nextWorkingDay(shift(d, 1), cal);
  return d;
}

/** Working days in [start, end] inclusive (0 when end < start). */
export function workingDaysBetween(start: string, end: string, cal: WorkCalendar): number {
  let n = 0;
  for (let d = start; d <= end; d = shift(d, 1)) if (isWorkingDay(d, cal)) n++;
  return n;
}
