import { describe, expect, it } from 'vitest';
import { actualPercent, computeCpm, CycleError, plannedPercent } from '../backend/src/cpm.js';

const fs = (p: string, s: string, lag = 0) => ({ predecessorId: p, successorId: s, type: 'FS' as const, lag });

describe('critical path', () => {
  it('textbook network: durations, floats and the critical path', () => {
    // A(3) → B(4) → D(2); A → C(2) → D. Critical: A-B-D (9 days); C has 2 days float.
    const { results, projectDuration } = computeCpm(
      [{ id: 'A', duration: 3 }, { id: 'B', duration: 4 }, { id: 'C', duration: 2 }, { id: 'D', duration: 2 }],
      [fs('A', 'B'), fs('A', 'C'), fs('B', 'D'), fs('C', 'D')],
    );
    expect(projectDuration).toBe(9);
    expect(results.get('A')).toEqual({ es: 0, ef: 3, ls: 0, lf: 3, totalFloat: 0, critical: true });
    expect(results.get('B')).toMatchObject({ es: 3, ef: 7, totalFloat: 0, critical: true });
    expect(results.get('C')).toMatchObject({ es: 3, ef: 5, ls: 5, lf: 7, totalFloat: 2, critical: false });
    expect(results.get('D')).toMatchObject({ es: 7, ef: 9, critical: true });
  });

  it('honours lags and all four dependency types', () => {
    const acts = [{ id: 'P', duration: 5 }, { id: 'S', duration: 3 }];
    const run = (type: 'FS' | 'SS' | 'FF' | 'SF', lag: number) => computeCpm(acts, [{ predecessorId: 'P', successorId: 'S', type, lag }]).results.get('S')!;
    expect(run('FS', 2)).toMatchObject({ es: 7, ef: 10 });
    expect(run('SS', 1)).toMatchObject({ es: 1, ef: 4 });
    expect(run('FF', 0)).toMatchObject({ es: 2, ef: 5 });
    expect(run('SF', 4)).toMatchObject({ es: 1, ef: 4 });
    expect(run('FS', -2)).toMatchObject({ es: 3, ef: 6 }); // lead (overlap)
  });

  it('never schedules before the project start and handles milestones', () => {
    const { results, projectDuration } = computeCpm([{ id: 'M', duration: 0 }, { id: 'X', duration: 4 }], [{ predecessorId: 'X', successorId: 'M', type: 'FS', lag: 0 }, ]);
    expect(results.get('M')).toMatchObject({ es: 4, ef: 4, critical: true });
    expect(projectDuration).toBe(4);
    const neg = computeCpm([{ id: 'A', duration: 2 }, { id: 'B', duration: 2 }], [{ predecessorId: 'A', successorId: 'B', type: 'SS', lag: -10 }]);
    expect(neg.results.get('B')!.es).toBe(0);
  });

  it('independent chains: the shorter one gets float', () => {
    const { results } = computeCpm([{ id: 'A', duration: 10 }, { id: 'B', duration: 4 }], []);
    expect(results.get('A')!.critical).toBe(true);
    expect(results.get('B')).toMatchObject({ totalFloat: 6, critical: false });
  });

  it('rejects cycles and names the activities involved', () => {
    try {
      computeCpm([{ id: 'A', duration: 1 }, { id: 'B', duration: 1 }, { id: 'C', duration: 1 }], [fs('A', 'B'), fs('B', 'C'), fs('C', 'B')]);
      expect.fail('expected a cycle');
    } catch (e) {
      expect(e).toBeInstanceOf(CycleError);
      expect((e as CycleError).ids.sort()).toEqual(['B', 'C']);
    }
  });

  it('planned and actual weighted progress', () => {
    const items = [{ es: 0, duration: 10, weight: 3 }, { es: 10, duration: 10, weight: 1 }, { es: 20, duration: 0, weight: 0 }];
    expect(plannedPercent(items, -1)).toBe(0);
    expect(plannedPercent(items, 4)).toBeCloseTo(37.5); // 5/10 of weight 3 of 4
    expect(plannedPercent(items, 14)).toBeCloseTo(87.5);
    expect(plannedPercent(items, 30)).toBe(100);
    expect(actualPercent([{ percent: 50, weight: 3 }, { percent: 100, weight: 1 }])).toBeCloseTo(62.5);
    expect(actualPercent([])).toBe(0);
  });
});
