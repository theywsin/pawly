/** Risk rating = likelihood × severity (1–25) with the usual bands. */
export function riskRating(likelihood: number, severity: number) {
  const score = likelihood * severity;
  const band = score >= 15 ? 'high' : score >= 8 ? 'medium' : 'low';
  return { score, band } as const;
}

/** Share of applicable items that passed (n/a excluded); null when nothing applies. */
export function inspectionScore(results: { result: 'ok' | 'nok' | 'na' }[]) {
  const ok = results.filter((r) => r.result === 'ok').length;
  const nok = results.filter((r) => r.result === 'nok').length;
  return { ok, nok, score: ok + nok === 0 ? null : Math.round((ok / (ok + nok)) * 1000) / 10 };
}

/**
 * Frequency rates per 1,000,000 man-hours (OSHA uses 200,000; ILO/ISO 45001 practice in Iran commonly
 * 1,000,000). LTIFR counts injuries with at least one lost day or a fatality; TRIFR counts every injury.
 * Severity rate = lost days per 1,000,000 hours. Null without man-hours.
 */
export function frequencyRates(hours: number, lti: number, recordable: number, lostDays: number) {
  if (!(hours > 0)) return { ltifr: null, trifr: null, severityRate: null };
  const r = (n: number) => Math.round((n * 1_000_000 * 100) / hours) / 100;
  return { ltifr: r(lti), trifr: r(recordable), severityRate: r(lostDays) };
}
