import { addDays, daysBetween, isoToJalali, toPersianDigits } from '@mohandesyar/persian';

const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

export interface GanttRow {
  id: string;
  name: string;
  depth: number;
  leaf: boolean;
  start: string | null;
  finish: string | null;
  progress: number;
  critical: boolean;
  milestone: boolean;
}

/** Month starts (Jalali) between two ISO dates, as day offsets from `from`. */
function monthTicks(from: string, to: string) {
  const ticks: { day: number; label: string }[] = [];
  const total = daysBetween(from, to);
  for (let d = 0; d <= total; d++) {
    const j = isoToJalali(addDays(from, d))!;
    const [y, m, day] = j.split('/').map(Number) as [number, number, number];
    if (day === 1 || d === 0) ticks.push({ day: d, label: `${MONTHS[m - 1]} ${toPersianDigits(String(y).slice(2))}` });
  }
  return ticks;
}

/**
 * Right-to-left Gantt: time runs from right (start) to left. Planned bars, actual progress overlay,
 * critical activities in the danger colour, today line. Summary rows are drawn as thin brackets.
 */
export function Gantt({ rows, today }: { rows: GanttRow[]; today: string }) {
  const dated = rows.filter((r) => r.start && r.finish);
  if (!dated.length) return <p className="text-sm text-muted">برای نمایش نمودار گانت، تاریخ شروع پروژه و فعالیت‌ها را تعریف کنید.</p>;
  const from = dated.map((r) => r.start!).sort()[0]!;
  const to = [...dated.map((r) => r.finish!), today].sort().at(-1)!;
  const days = daysBetween(from, to) + 1;
  const dayW = Math.max(2, Math.min(24, 900 / days));
  const chartW = days * dayW;
  const rowH = 28;
  const head = 30;
  const height = head + rows.length * rowH;
  const x = (iso: string) => chartW - daysBetween(from, iso) * dayW; // RTL: day 0 at the right edge
  const ticks = monthTicks(from, to);
  const todayX = daysBetween(from, today) >= 0 && today <= to ? x(today) : null;
  return (
    <div className="flex overflow-hidden rounded-lg border border-border bg-surface">
      {/* Names as HTML (proper RTL text), rows aligned with the chart. */}
      <ul className="w-56 shrink-0 border-e border-border text-xs" style={{ paddingTop: head }} aria-label="فعالیت‌ها">
        {rows.map((r) => (
          <li key={r.id} className={`truncate px-2 leading-7 ${r.leaf ? '' : 'font-bold'}`} style={{ height: rowH, paddingInlineStart: `${0.5 + r.depth * 0.75}rem` }} title={r.name}>
            {r.name}
          </li>
        ))}
      </ul>
      {/* RTL scroller: opens at the right edge, where the project starts. */}
      <div className="min-w-0 flex-1 overflow-x-auto">
        <svg width={chartW + 4} height={height} role="img" aria-label="نمودار گانت برنامه زمان‌بندی" className="text-[11px]" style={{ direction: 'ltr' }}>
          {ticks.map((t) => (
            <g key={t.day}>
              <line x1={chartW - t.day * dayW} x2={chartW - t.day * dayW} y1={20} y2={height} className="stroke-border" />
              <text x={chartW - t.day * dayW - 3} y={14} textAnchor="end" className="fill-muted">{t.label}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const y = head + i * rowH;
            if (!r.start || !r.finish) return null;
            const x1 = x(r.finish) - dayW;
            const x2 = x(r.start);
            const w = Math.max(dayW, x2 - x1);
            if (r.milestone) {
              const cx = x(r.start);
              return <polygon key={r.id} points={`${cx},${y + 6} ${cx + 7},${y + 13} ${cx},${y + 20} ${cx - 7},${y + 13}`} className={r.critical ? 'fill-danger' : 'fill-text'}><title>{r.name}</title></polygon>;
            }
            if (!r.leaf) return <rect key={r.id} x={x1} y={y + 10} width={w} height={6} rx={1} className="fill-text/70"><title>{r.name}</title></rect>;
            return (
              <g key={r.id}>
                <rect x={x1} y={y + 6} width={w} height={14} rx={3} className={r.critical ? 'fill-danger/25 stroke-danger' : 'fill-primary/20 stroke-primary'} />
                {r.progress > 0 && <rect x={x2 - (w * r.progress) / 100} y={y + 6} width={(w * r.progress) / 100} height={14} rx={3} className={r.critical ? 'fill-danger' : 'fill-primary'} />}
                <title>{`${r.name}: ${toPersianDigits(Math.round(r.progress))}٪`}</title>
              </g>
            );
          })}
          {todayX !== null && <line x1={todayX} x2={todayX} y1={20} y2={height} className="stroke-warning" strokeWidth={2} strokeDasharray="4 3"><title>امروز</title></line>}
        </svg>
      </div>
    </div>
  );
}

/** Planned vs actual cumulative physical progress (S-curve). */
export function SCurve({ points }: { points: { date: string; planned: number; actual: number | null }[] }) {
  if (points.length < 2) return null;
  const W = 640;
  const H = 220;
  const pad = 32;
  const px = (i: number) => W - pad - (i / (points.length - 1)) * (W - 2 * pad); // RTL
  const py = (v: number) => H - pad - (v / 100) * (H - 2 * pad);
  const line = (vals: (number | null)[]) =>
    vals.map((v, i) => (v === null ? null : `${px(i)},${py(v)}`)).filter(Boolean).join(' ');
  const last = points.at(-1)!;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-2xl" role="img" aria-label={`منحنی پیشرفت: برنامه‌ای ${Math.round(last.planned)}٪`}>
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={pad} x2={W - pad} y1={py(v)} y2={py(v)} className="stroke-border" />
            <text x={W - pad + 4} y={py(v) + 4} className="fill-muted text-[10px]">{toPersianDigits(v)}٪</text>
          </g>
        ))}
        <polyline points={line(points.map((p) => p.planned))} fill="none" className="stroke-primary" strokeWidth={2} strokeDasharray="6 4" />
        <polyline points={line(points.map((p) => p.actual))} fill="none" className="stroke-success" strokeWidth={2.5} />
        <text x={W - pad} y={H - 8} textAnchor="end" className="fill-muted text-[10px]">{toPersianDigits(isoToJalali(points[0]!.date) ?? '')}</text>
        <text x={pad} y={H - 8} textAnchor="start" className="fill-muted text-[10px]">{toPersianDigits(isoToJalali(last.date) ?? '')}</text>
      </svg>
      <figcaption className="mt-2 flex gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-primary" /> برنامه‌ای</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-5 bg-success" /> واقعی</span>
      </figcaption>
    </figure>
  );
}
