import { isoToJalali, jalaliMonthLength, toGregorian, utcToZoned, zonedToUtc, addDays } from '@mohandesyar/persian';

export const RANGES = ['last_7_days', 'last_month', 'month_to_date', 'year_to_date', 'custom'] as const;
export type Range = (typeof RANGES)[number];
const pad = (n: number) => String(n).padStart(2, '0');
const g = (jy: number, jm: number, jd: number) => {
  const x = toGregorian(jy, jm, jd);
  return `${x.gy}-${pad(x.gm)}-${pad(x.gd)}`;
};
const jParts = (iso: string) => isoToJalali(iso)!.split('/').map(Number) as [number, number, number];

/** Resolves a relative period on the Jalali calendar (Tehran date `today`). */
export function resolveRange(p: { range: Range; from?: string | null; to?: string | null }, today: string): { from: string; to: string } {
  const [jy, jm] = jParts(today);
  switch (p.range) {
    case 'last_7_days':
      return { from: addDays(today, -6), to: today };
    case 'month_to_date':
      return { from: g(jy, jm, 1), to: today };
    case 'year_to_date':
      return { from: g(jy, 1, 1), to: today };
    case 'last_month': {
      const [y, m] = jm === 1 ? [jy - 1, 12] : [jy, jm - 1];
      return { from: g(y, m, 1), to: g(y, m, jalaliMonthLength(y, m)) };
    }
    case 'custom':
      return { from: p.from!, to: p.to! };
  }
}

/**
 * Next delivery after `now`, at 07:00 Tehran: daily → tomorrow; weekly → next Saturday (start of the
 * Iranian week); monthly → the 1st of the next Jalali month.
 */
export function nextRun(schedule: 'daily' | 'weekly' | 'monthly', now: Date): string {
  const today = utcToZoned(now.toISOString()).date;
  let day: string;
  if (schedule === 'daily') day = addDays(today, 1);
  else if (schedule === 'weekly') {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 6 = Saturday
    day = addDays(today, ((6 - dow + 7) % 7) || 7);
  } else {
    const [jy, jm] = jParts(today);
    day = jm === 12 ? g(jy + 1, 1, 1) : g(jy, jm + 1, 1);
  }
  return zonedToUtc(day, '07:00');
}
