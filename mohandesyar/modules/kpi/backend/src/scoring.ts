import { jalaliMonthLength, toGregorian } from '@mohandesyar/persian';

/** Periods are Jalali: "1405" (year), "1405-Q3" (quarter), "1405-07" (month). */
export type Frequency = 'monthly' | 'quarterly' | 'yearly';

export function parsePeriod(p: string): { frequency: Frequency; year: number; index: number } | null {
  let m = /^(\d{4})$/.exec(p);
  if (m) return { frequency: 'yearly', year: Number(m[1]), index: 1 };
  m = /^(\d{4})-Q([1-4])$/.exec(p);
  if (m) return { frequency: 'quarterly', year: Number(m[1]), index: Number(m[2]) };
  m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(p);
  if (m) return { frequency: 'monthly', year: Number(m[1]), index: Number(m[2]) };
  return null;
}

const iso = (g: { gy: number; gm: number; gd: number }) => `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;

/** Gregorian ISO date range [from, to] of a Jalali period (inclusive). */
export function periodRange(p: string): { from: string; to: string } | null {
  const x = parsePeriod(p);
  if (!x) return null;
  const [m1, m2] = x.frequency === 'yearly' ? [1, 12] : x.frequency === 'quarterly' ? [(x.index - 1) * 3 + 1, x.index * 3] : [x.index, x.index];
  return { from: iso(toGregorian(x.year, m1, 1)), to: iso(toGregorian(x.year, m2, jalaliMonthLength(x.year, m2))) };
}

const QUARTER = ['', 'بهار', 'تابستان', 'پاییز', 'زمستان'];
const MONTH = ['', 'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
export function periodLabel(p: string): string {
  const x = parsePeriod(p);
  if (!x) return p;
  const y = x.year.toLocaleString('fa-IR', { useGrouping: false });
  return x.frequency === 'yearly' ? `سال ${y}` : x.frequency === 'quarterly' ? `${QUARTER[x.index]} ${y}` : `${MONTH[x.index]} ${y}`;
}

export interface ItemInput {
  definitionId: string;
  code: string;
  name: string;
  unit: string;
  direction: 'higher' | 'lower';
  weight: number;
  isGate: boolean;
  goodPct: number;
  warningPct: number;
  target: number | null;
  value: number | null;
  valueStatus: string | null;
}

export interface Item extends ItemInput {
  achievement: number | null;
  score: number | null;
  status: 'good' | 'warning' | 'critical' | 'missing';
  reason: string;
}

/** Achievement against target, capped at 120% so one outlier cannot hide the rest. */
export const CAP = 1.2;
const pct = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString('fa-IR')}٪`;

export function scoreItem(i: ItemInput): Item {
  if (i.target === null) return { ...i, achievement: null, score: null, status: 'missing', reason: 'هدف این دوره تعیین نشده است' };
  if (i.value === null) return { ...i, achievement: null, score: null, status: 'missing', reason: 'مقدار تأییدشده‌ای برای این دوره ثبت نشده است' };
  let a: number;
  if (i.direction === 'higher') a = i.target === 0 ? (i.value >= 0 ? CAP : 0) : i.value / i.target;
  else a = i.value === 0 ? CAP : i.value <= 0 ? CAP : i.target / i.value;
  a = Math.max(0, Math.min(CAP, a));
  const p = a * 100;
  const status = p >= i.goodPct ? 'good' : p >= i.warningPct ? 'warning' : 'critical';
  const dirText = i.direction === 'higher' ? 'بیشتر بهتر' : 'کمتر بهتر';
  return { ...i, achievement: Math.round(a * 1000) / 1000, score: Math.round(p * 10) / 10, status, reason: `تحقق ${pct(p)} از هدف (${dirText})` };
}

export interface RewardBand {
  minScore: number;
  coefficient: number;
}

export interface Scorecard {
  items: Item[];
  score: number | null;
  complete: boolean;
  gateFailed: boolean;
  gateReasons: string[];
}

/**
 * Weighted mean of item scores over items that have both target and approved value. Gate KPIs (safety,
 * quality, compliance) are a precondition: a gate item that is not "good" — or missing — fails the gate.
 */
export function scoreCard(inputs: ItemInput[]): Scorecard {
  const items = inputs.map(scoreItem);
  const counted = items.filter((x) => x.score !== null);
  const w = counted.reduce((s, x) => s + x.weight, 0);
  const score = w ? Math.round((counted.reduce((s, x) => s + x.weight * Math.min(x.score!, 100 * CAP), 0) / w) * 10) / 10 : null;
  const gateReasons = items.filter((x) => x.isGate && x.status !== 'good').map((x) => `${x.name}: ${x.status === 'missing' ? x.reason : `وضعیت ${x.status === 'warning' ? 'هشدار' : 'بحرانی'}`}`);
  return { items, score, complete: counted.length === items.length && items.length > 0, gateFailed: gateReasons.length > 0, gateReasons };
}

/** Suggested coefficient only (never a payment): the highest band reached; a failed gate uses gateCoefficient. */
export function rewardCoefficient(score: number | null, bands: RewardBand[], gateFailed: boolean, gateCoefficient: number): { coefficient: number; reason: string } {
  if (gateFailed) return { coefficient: gateCoefficient, reason: 'شرط لازم (ایمنی/کیفیت/انطباق) برقرار نیست' };
  if (score === null) return { coefficient: 0, reason: 'امتیاز قابل محاسبه نیست' };
  const band = [...bands].sort((a, b) => b.minScore - a.minScore).find((b) => score >= b.minScore);
  return band ? { coefficient: band.coefficient, reason: `امتیاز ${score.toLocaleString('fa-IR')} ≥ ${band.minScore.toLocaleString('fa-IR')}` } : { coefficient: 0, reason: 'امتیاز به کمترین بازه نرسیده است' };
}
