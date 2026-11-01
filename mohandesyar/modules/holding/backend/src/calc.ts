import { isoToJalali, jalaliMonthLength, toGregorian } from '@mohandesyar/persian';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (g: { gy: number; gm: number; gd: number }) => `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;

/** The `n` Jalali months ending with the month containing `toIso`, oldest first, as ISO date ranges. */
export function jalaliMonths(toIso: string, n: number) {
  const [jy0, jm0] = isoToJalali(toIso)!.split('/').map(Number) as [number, number];
  const out: { label: string; from: string; to: string }[] = [];
  let jy = jy0;
  let jm = jm0;
  for (let i = 0; i < n; i++) {
    out.unshift({ label: `${jy}/${pad(jm)}`, from: iso(toGregorian(jy, jm, 1)), to: iso(toGregorian(jy, jm, jalaliMonthLength(jy, jm))) });
    jm -= 1;
    if (jm === 0) {
      jm = 12;
      jy -= 1;
    }
  }
  return out;
}

/** Holding total of one provider: sums for counts and amounts, a plain average for rates and percentages. */
export function aggregate(unit: string, values: (number | null)[]) {
  const v = values.filter((x): x is number => x !== null);
  if (!v.length) return { value: null, method: 'none' as const };
  if (unit === 'count' || unit === 'rial') return { value: v.reduce((s, x) => s + x, 0), method: 'sum' as const };
  return { value: Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 100) / 100, method: 'average' as const };
}
