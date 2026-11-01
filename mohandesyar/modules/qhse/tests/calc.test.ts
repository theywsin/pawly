import { describe, expect, it } from 'vitest';
import { frequencyRates, inspectionScore, riskRating } from '../backend/src/calc.js';

describe('qhse calc', () => {
  it('rates risks by likelihood × severity', () => {
    expect(riskRating(3, 5)).toEqual({ score: 15, band: 'high' });
    expect(riskRating(2, 4)).toEqual({ score: 8, band: 'medium' });
    expect(riskRating(1, 5)).toEqual({ score: 5, band: 'low' });
  });
  it('scores inspections without n/a items', () => {
    expect(inspectionScore([{ result: 'ok' }, { result: 'ok' }, { result: 'nok' }, { result: 'na' }])).toEqual({ ok: 2, nok: 1, score: 66.7 });
    expect(inspectionScore([{ result: 'na' }]).score).toBeNull();
  });
  it('computes frequency rates per million man-hours', () => {
    expect(frequencyRates(400_000, 1, 3, 20)).toEqual({ ltifr: 2.5, trifr: 7.5, severityRate: 50 });
    expect(frequencyRates(0, 1, 1, 1).ltifr).toBeNull();
  });
});
