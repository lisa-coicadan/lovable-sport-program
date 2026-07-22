import { describe, it, expect } from 'vitest';
import { getWeekSets, getWeekLabel } from './531';

describe('getWeekSets', () => {
  it('computes week 1 (5s) sets rounded to nearest 2.5kg', () => {
    const sets = getWeekSets(100, 1);
    expect(sets).toEqual([
      { percentage: 0.65, reps: '5', weight: 65 },
      { percentage: 0.75, reps: '5', weight: 75 },
      { percentage: 0.85, reps: '5+', weight: 85 },
    ]);
  });

  it('computes week 2 (3s) sets', () => {
    const sets = getWeekSets(100, 2);
    expect(sets.map(s => s.reps)).toEqual(['3', '3', '3+']);
    expect(sets.map(s => s.weight)).toEqual([70, 80, 90]);
  });

  it('computes week 3 (5/3/1) sets', () => {
    const sets = getWeekSets(100, 3);
    expect(sets.map(s => s.reps)).toEqual(['5', '3', '1+']);
  });

  it('computes week 4 (deload) sets', () => {
    const sets = getWeekSets(100, 4);
    expect(sets.map(s => s.weight)).toEqual([40, 50, 60]);
  });

  it('rounds weights to the nearest 2.5kg', () => {
    const sets = getWeekSets(103, 1);
    // 103 * 0.65 = 66.95 -> rounds to 67.5
    expect(sets[0].weight).toBe(67.5);
  });

  it('falls back to week 1 scheme for an out-of-range week', () => {
    expect(getWeekSets(100, 5)).toEqual(getWeekSets(100, 1));
    expect(getWeekSets(100, 0)).toEqual(getWeekSets(100, 1));
  });
});

describe('getWeekLabel', () => {
  it('returns the correct label for weeks 1-4', () => {
    expect(getWeekLabel(1)).toBe('Week 1 — 5s');
    expect(getWeekLabel(2)).toBe('Week 2 — 3s');
    expect(getWeekLabel(3)).toBe('Week 3 — 5/3/1');
    expect(getWeekLabel(4)).toBe('Week 4 — Deload');
  });

  it('falls back to week 1 label for an out-of-range week', () => {
    expect(getWeekLabel(9)).toBe('Week 1 — 5s');
  });
});
