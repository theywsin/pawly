import { isWorkingDay, jalaliMonthLength, toJalali, utcToZoned, zonedToUtc, type WorkCalendar } from '@mohandesyar/persian';

export interface DutySchedule {
  recurrence: 'daily' | 'weekly' | 'monthly';
  weekdays: number[];
  month_day: number | null;
  skip_days_off: boolean;
}

const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/**
 * Whether a recurring duty falls on `day`. Monthly duties use the Jalali day of month, capped at the month's
 * last day (a duty on the 31st runs on the 30th or 29th in shorter months). Days off are skipped when asked.
 */
export function dutyOccursOn(d: DutySchedule, day: string, cal: WorkCalendar): boolean {
  if (d.skip_days_off && !isWorkingDay(day, cal)) return false;
  if (d.recurrence === 'daily') return true;
  if (d.recurrence === 'weekly') return d.weekdays.includes(weekday(day));
  const [y, m, dd] = day.split('-').map(Number) as [number, number, number];
  const j = toJalali(y, m, dd);
  return j.jd === Math.min(d.month_day ?? 1, jalaliMonthLength(j.jy, j.jm));
}

/** UTC instant of `time` (HH:MM) on `day` in the organisation's time zone. */
export const dueAt = (day: string, time: string, tz = 'Asia/Tehran') => zonedToUtc(day, time, tz);

/** Minutes late after the start of work, or 0 within the grace period. */
export function lateMinutes(checkInUtc: string, workStart: string, graceMinutes: number, tz = 'Asia/Tehran'): number {
  const local = utcToZoned(checkInUtc, tz);
  const [h, m] = local.time.split(':').map(Number) as [number, number];
  const [sh, sm] = workStart.split(':').map(Number) as [number, number];
  const late = h * 60 + m - (sh * 60 + sm);
  return late > graceMinutes ? late : 0;
}

/** A 1–5 score as a 0–100 figure (5 → 100, 1 → 20). */
export const scorePercent = (avg: number | null) => (avg === null ? null : Math.round(avg * 20 * 10) / 10);

export interface Components {
  onTimeRate: number | null;
  averageScore: number | null;
  attendanceRate: number | null;
  reportRate: number | null;
}

/** Weights of the overall performance figure; a missing component's weight is shared by the others. */
export const WEIGHTS: Record<keyof Components, number> = { onTimeRate: 40, averageScore: 30, attendanceRate: 20, reportRate: 10 };

export function performance(c: Components): number | null {
  let sum = 0;
  let weight = 0;
  for (const k of Object.keys(WEIGHTS) as (keyof Components)[]) {
    const v = c[k];
    if (v === null || Number.isNaN(v)) continue;
    sum += v * WEIGHTS[k];
    weight += WEIGHTS[k];
  }
  return weight === 0 ? null : Math.round((sum / weight) * 10) / 10;
}

export const percent = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 1000) / 10);

export const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v);
