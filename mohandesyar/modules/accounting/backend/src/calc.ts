import { jalaliMonthLength, toGregorian, toJalali } from '@mohandesyar/persian';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (g: { gy: number; gm: number; gd: number }) => `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
export const jalaliOf = (day: string) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return toJalali(y, m, d);
};

/** Rounds a non-negative rational a/b to the nearest integer (half up), in bigint. */
export const roundDiv = (a: bigint, b: bigint) => (a * 2n + b) / (b * 2n);

/** Quantity "12.5" → thousandths (12500n). Validated to ≤ 3 decimals by the input schema. */
export function milli(qty: string): bigint {
  const [i, f = ''] = qty.split('.');
  return BigInt(i!) * 1000n + BigInt((f + '000').slice(0, 3));
}
export const fromMilli = (m: bigint) => {
  const neg = m < 0n;
  const a = neg ? -m : m;
  const f = (a % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${a / 1000n}${f ? `.${f}` : ''}`;
};

export interface LineCalc {
  gross: bigint;
  amount: bigint;
  vat: bigint;
}
/** Invoice line: gross = qty × price, amount = gross − discount, VAT = amount × rate% (rate has ≤ 2 decimals). */
export function lineCalc(qty: string, unitPrice: bigint, discount: bigint, vatRate: number): LineCalc {
  const gross = roundDiv(milli(qty) * unitPrice, 1000n);
  const amount = gross - discount;
  const rate = BigInt(Math.round(vatRate * 100));
  return { gross, amount, vat: amount > 0n ? roundDiv(amount * rate, 10_000n) : 0n };
}

/** Jalali fiscal year containing `day`: 1 Farvardin – last day of Esfand, as Gregorian ISO dates. */
export function jalaliYearOf(day: string): { title: string; start: string; end: string; jy: number } {
  const { jy } = jalaliOf(day);
  return { jy, title: `سال مالی ${jy.toLocaleString('fa-IR', { useGrouping: false })}`, start: iso(toGregorian(jy, 1, 1)), end: iso(toGregorian(jy, 12, jalaliMonthLength(jy, 12))) };
}

/** Jalali month period "1405-07" → Gregorian first/last day. */
export function monthRange(period: string): { start: string; end: string } {
  const [jy, jm] = period.split('-').map(Number) as [number, number];
  return { start: iso(toGregorian(jy, jm, 1)), end: iso(toGregorian(jy, jm, jalaliMonthLength(jy, jm))) };
}
export const periodOf = (day: string) => {
  const j = jalaliOf(day);
  return `${j.jy}-${pad(j.jm)}`;
};
const monthIndex = (period: string) => {
  const [jy, jm] = period.split('-').map(Number) as [number, number];
  return jy * 12 + jm - 1;
};

/** VAT season (فصل): quarter 1–4 of Jalali year `jy`. */
export function seasonRange(jy: number, q: number): { start: string; end: string } {
  const m0 = (q - 1) * 3 + 1;
  return { start: iso(toGregorian(jy, m0, 1)), end: iso(toGregorian(jy, m0 + 2, jalaliMonthLength(jy, m0 + 2))) };
}

export interface AssetCalc {
  acquired_on: string;
  cost: bigint;
  salvage: bigint;
  method: 'straight_line' | 'declining';
  useful_life_months: number | null;
  rate_percent: number | null;
}
/**
 * Depreciation of one Jalali month. Starts the month after acquisition (A66). Straight line keeps the
 * accumulated amount at round(base × k / life) for the k-th month, so rounding never drifts and the last
 * month lands exactly on the salvage value; declining applies rate/12 to the book value each month.
 * Never takes the book value below salvage. `accumulated` includes opening depreciation.
 */
export function monthlyDepreciation(a: AssetCalc, period: string, accumulated: bigint): bigint {
  const k = monthIndex(period) - monthIndex(periodOf(a.acquired_on));
  if (k < 1) return 0n;
  const room = a.cost - a.salvage - accumulated;
  if (room <= 0n) return 0n;
  let amount: bigint;
  if (a.method === 'straight_line') {
    const life = BigInt(a.useful_life_months!);
    const base = a.cost - a.salvage;
    const target = BigInt(k) >= life ? base : roundDiv(base * BigInt(k), life);
    amount = target - accumulated;
  } else {
    const rate = BigInt(Math.round(a.rate_percent! * 100));
    amount = roundDiv((a.cost - accumulated) * rate, 120_000n);
  }
  if (amount <= 0n) return 0n;
  return amount > room ? room : amount;
}

/** Moving average: cost of issuing `qtyMilli` out of a stock of `onHandMilli` costing `onHandCost`. */
export function issueCost(onHandMilli: bigint, onHandCost: bigint, qtyMilli: bigint): bigint {
  if (qtyMilli >= onHandMilli) return onHandCost;
  return roundDiv(onHandCost * qtyMilli, onHandMilli);
}
