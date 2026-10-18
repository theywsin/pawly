/** ISO date plus whole years; 29 February falls back to 28 February in a common year. */
export function addYears(iso: string, years: number) {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y + years, m - 1, d));
  if (t.getUTCMonth() !== m - 1) t.setUTCDate(0);
  return t.toISOString().slice(0, 10);
}

/** Tags as entered: split on Persian or Latin commas, trimmed, de-duplicated, empty ones dropped. */
export function parseTags(text: string) {
  return [...new Set(text.split(/[،,]/).map((x) => x.trim()).filter(Boolean))];
}
