/**
 * Critical path method on calendar days (no work calendar: every day counts — A33).
 * An activity occupies days [es, ef) counted from the project start (day 0); a milestone has duration 0.
 * Dependencies with lag (days, may be negative):
 *   FS: succ.es ≥ pred.ef + lag     SS: succ.es ≥ pred.es + lag
 *   FF: succ.ef ≥ pred.ef + lag     SF: succ.ef ≥ pred.es + lag
 */

export type DepType = 'FS' | 'SS' | 'FF' | 'SF';

export interface CpmActivity {
  id: string;
  duration: number;
}

export interface CpmDependency {
  predecessorId: string;
  successorId: string;
  type: DepType;
  lag: number;
}

export interface CpmResult {
  es: number;
  ef: number;
  ls: number;
  lf: number;
  totalFloat: number;
  critical: boolean;
}

export class CycleError extends Error {
  constructor(readonly ids: string[]) {
    super('CYCLE');
  }
}

/** Topological order (Kahn); throws CycleError listing the activities on a cycle. */
export function topoOrder(ids: readonly string[], deps: readonly CpmDependency[]): string[] {
  const indeg = new Map(ids.map((id) => [id, 0]));
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const d of deps) {
    if (!indeg.has(d.predecessorId) || !indeg.has(d.successorId)) throw new Error(`dependency references unknown activity`);
    out.get(d.predecessorId)!.push(d.successorId);
    indeg.set(d.successorId, indeg.get(d.successorId)! + 1);
  }
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of out.get(id)!) {
      indeg.set(s, indeg.get(s)! - 1);
      if (indeg.get(s) === 0) queue.push(s);
    }
  }
  if (order.length !== ids.length) throw new CycleError(ids.filter((id) => indeg.get(id)! > 0));
  return order;
}

export function computeCpm(activities: readonly CpmActivity[], deps: readonly CpmDependency[]): { results: Map<string, CpmResult>; projectDuration: number } {
  const dur = new Map(activities.map((a) => [a.id, Math.max(0, Math.trunc(a.duration))]));
  const order = topoOrder(
    activities.map((a) => a.id),
    deps,
  );
  const preds = new Map<string, CpmDependency[]>(activities.map((a) => [a.id, []]));
  const succs = new Map<string, CpmDependency[]>(activities.map((a) => [a.id, []]));
  for (const d of deps) {
    preds.get(d.successorId)!.push(d);
    succs.get(d.predecessorId)!.push(d);
  }

  // Forward pass. Activities never start before the project start (es ≥ 0).
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const id of order) {
    const d = dur.get(id)!;
    let start = 0;
    for (const p of preds.get(id)!) {
      const pes = es.get(p.predecessorId)!;
      const pef = ef.get(p.predecessorId)!;
      const bound = p.type === 'FS' ? pef + p.lag : p.type === 'SS' ? pes + p.lag : p.type === 'FF' ? pef + p.lag - d : pes + p.lag - d;
      if (bound > start) start = bound;
    }
    es.set(id, start);
    ef.set(id, start + d);
  }
  const projectDuration = Math.max(0, ...[...ef.values()]);

  // Backward pass from the project finish.
  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const d = dur.get(id)!;
    let finish = projectDuration;
    for (const s of succs.get(id)!) {
      const sls = ls.get(s.successorId)!;
      const slf = lf.get(s.successorId)!;
      const bound = s.type === 'FS' ? sls - s.lag : s.type === 'SS' ? sls - s.lag + d : s.type === 'FF' ? slf - s.lag : slf - s.lag + d;
      if (bound < finish) finish = bound;
    }
    lf.set(id, finish);
    ls.set(id, finish - d);
  }

  const results = new Map<string, CpmResult>();
  for (const id of order) {
    const totalFloat = ls.get(id)! - es.get(id)!;
    results.set(id, { es: es.get(id)!, ef: ef.get(id)!, ls: ls.get(id)!, lf: lf.get(id)!, totalFloat, critical: totalFloat <= 0 });
  }
  return { results, projectDuration };
}

/**
 * Planned physical progress (0–100) at day offset `day` (0 = project start, inclusive): each activity
 * progresses linearly over its planned days; milestones count as done from their date. Weighted by `weight`.
 */
export function plannedPercent(items: readonly { es: number; duration: number; weight: number }[], day: number): number {
  let total = 0;
  let done = 0;
  for (const a of items) {
    if (a.weight <= 0) continue;
    total += a.weight;
    const frac = a.duration === 0 ? (day >= a.es ? 1 : 0) : Math.min(1, Math.max(0, (day - a.es + 1) / a.duration));
    done += a.weight * frac;
  }
  return total === 0 ? 0 : (done / total) * 100;
}

/** Weighted actual progress (0–100) from each activity's reported percent. */
export function actualPercent(items: readonly { percent: number; weight: number }[]): number {
  let total = 0;
  let done = 0;
  for (const a of items) {
    if (a.weight <= 0) continue;
    total += a.weight;
    done += a.weight * Math.min(100, Math.max(0, a.percent));
  }
  return total === 0 ? 0 : done / total;
}
