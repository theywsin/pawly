/**
 * Money arithmetic for progress statements (صورت‌وضعیت). Amounts are rial integers as bigint (never
 * float); percentages arrive as numeric strings with up to 4 decimals ("10", "2.5", "10.0000").
 */

const SCALE = 10_000n; // 4 decimal places of a percent

/** Parses "12.3456" → 123456n (percent × 10⁴). Throws on anything that is not a 0–100 percent. */
export function pctUnits(pct: string | number): bigint {
  const s = String(pct).trim();
  const m = /^(\d{1,3})(?:\.(\d{1,4})\d*)?$/.exec(s);
  if (!m) throw new RangeError(`invalid percent: ${s}`);
  const units = BigInt(m[1]!) * SCALE + BigInt((m[2] ?? '').padEnd(4, '0'));
  if (units > 100n * SCALE) throw new RangeError(`percent above 100: ${s}`);
  return units;
}

/** `pct` percent of a non-negative amount, rounded half up to whole rial. */
export function percentOf(amount: bigint, pct: string | number): bigint {
  if (amount < 0n) throw new RangeError('amount must be non-negative');
  const den = 100n * SCALE;
  return (amount * pctUnits(pct) * 2n + den) / (2n * den);
}

export interface StatementRates {
  goodPerformancePct: string;
  insurancePct: string;
  taxPct: string;
  vatPct: string;
  prepaymentRecoveryPct: string;
}

export interface StatementInput {
  cumulativeGross: bigint;
  /** Cumulative gross of the previous non-rejected statement (0 for the first). */
  previousCumulative: bigint;
  /** Prepayment not yet recovered by earlier statements. */
  prepaymentRemaining: bigint;
  otherDeductions: bigint;
}

export interface StatementAmounts {
  periodGross: bigint;
  goodPerformance: bigint;
  insurance: bigint;
  tax: bigint;
  prepaymentRecovery: bigint;
  otherDeductions: bigint;
  vat: bigint;
  netPayable: bigint;
}

/**
 * Period gross = cumulative − previous cumulative. Retentions (good performance, insurance), income tax and
 * prepayment recovery (capped at what remains) are deducted from the period gross; VAT is added on it.
 */
export function computeStatement(input: StatementInput, rates: StatementRates): StatementAmounts {
  if (input.cumulativeGross < input.previousCumulative) throw new RangeError('CUMULATIVE_DECREASED');
  if (input.otherDeductions < 0n || input.prepaymentRemaining < 0n) throw new RangeError('NEGATIVE_INPUT');
  const periodGross = input.cumulativeGross - input.previousCumulative;
  const goodPerformance = percentOf(periodGross, rates.goodPerformancePct);
  const insurance = percentOf(periodGross, rates.insurancePct);
  const tax = percentOf(periodGross, rates.taxPct);
  const recovery = percentOf(periodGross, rates.prepaymentRecoveryPct);
  const prepaymentRecovery = recovery < input.prepaymentRemaining ? recovery : input.prepaymentRemaining;
  const vat = percentOf(periodGross, rates.vatPct);
  const netPayable = periodGross - goodPerformance - insurance - tax - prepaymentRecovery - input.otherDeductions + vat;
  return { periodGross, goodPerformance, insurance, tax, prepaymentRecovery, otherDeductions: input.otherDeductions, vat, netPayable };
}

/** Current contract amount: initial plus every amendment's signed delta. */
export function currentAmount(initial: bigint, deltas: readonly bigint[]): bigint {
  return deltas.reduce((a, d) => a + d, initial);
}
