import { describe, it, expect } from 'vitest';
import { getWeekSets, getWeekLabel, computeNextFiveThreeOneWeekState } from './531';

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

  it('rounds to the nearest 5kg once the load reaches 100kg (heavy-lifter tier)', () => {
    const sets = getWeekSets(205, 4);
    // 205*0.40=82 (<100 -> nearest 2.5kg: 82.5), 205*0.50=102.5 and 205*0.60=123
    // (both >=100 -> nearest 5kg: 102.5 -> 105, 123 -> 125 — a flat 2.5kg rounding
    // would have given 102.5 and 122.5 for those last two instead).
    expect(sets.map(s => s.weight)).toEqual([82.5, 105, 125]);
  });

  it('rounds finer (0.5/1kg) for a low Training Max, e.g. a bodyweight-assisted 531 exercise', () => {
    const sets = getWeekSets(10, 1);
    // 10 * 0.65 = 6.5 (<15 -> nearest 0.5), 10 * 0.75 = 7.5, 10 * 0.85 = 8.5
    expect(sets.map(s => s.weight)).toEqual([6.5, 7.5, 8.5]);
  });

  it('falls back to week 1 scheme for an out-of-range week', () => {
    expect(getWeekSets(100, 5)).toEqual(getWeekSets(100, 1));
    expect(getWeekSets(100, 0)).toEqual(getWeekSets(100, 1));
  });
});

describe('getWeekLabel', () => {
  it('returns the correct label for weeks 1-4', () => {
    expect(getWeekLabel(1)).toBe('Semaine 1 — 5 reps');
    expect(getWeekLabel(2)).toBe('Semaine 2 — 3 reps');
    expect(getWeekLabel(3)).toBe('Semaine 3 — 5/3/1');
    expect(getWeekLabel(4)).toBe('Semaine 4 — Deload');
  });

  it('falls back to week 1 label for an out-of-range week', () => {
    expect(getWeekLabel(9)).toBe('Semaine 1 — 5 reps');
  });
});

describe('computeNextFiveThreeOneWeekState', () => {
  it('advances week normally within a cycle', () => {
    expect(computeNextFiveThreeOneWeekState({ currentWeek: 1, currentCycle: 2 }))
      .toEqual({ currentWeek: 2, currentCycle: 2, cycleAdvanced: false });
    expect(computeNextFiveThreeOneWeekState({ currentWeek: 2, currentCycle: 2 }))
      .toEqual({ currentWeek: 3, currentCycle: 2, cycleAdvanced: false });
  });

  it('advances to a new cycle after the natural week 4', () => {
    expect(computeNextFiveThreeOneWeekState({ currentWeek: 4, currentCycle: 2 }))
      .toEqual({ currentWeek: 1, currentCycle: 3, cycleAdvanced: true });
  });

  it('resumes the saved week instead of advancing the cycle after a forced deload', () => {
    expect(computeNextFiveThreeOneWeekState({ currentWeek: 4, currentCycle: 2, deloadResumeWeek: 2 }))
      .toEqual({ currentWeek: 2, currentCycle: 2, skipNextDeload: true, cycleAdvanced: false });
  });

  it('skips the next natural week 4 and jumps to a new cycle when resuming from week 3', () => {
    expect(computeNextFiveThreeOneWeekState({ currentWeek: 3, currentCycle: 2, skipNextDeload: true }))
      .toEqual({ currentWeek: 1, currentCycle: 3, skipNextDeload: false, cycleAdvanced: true });
  });

  it('carries skipNextDeload forward untouched until week 3 is reached', () => {
    expect(computeNextFiveThreeOneWeekState({ currentWeek: 2, currentCycle: 2, skipNextDeload: true }))
      .toEqual({ currentWeek: 3, currentCycle: 2, skipNextDeload: true, cycleAdvanced: false });
  });
});
