import { describe, it, expect } from 'vitest';
import { getEmomWeight, getDefaultEmomPercentage, getEmomConfig, EMOM_DEFAULT_DURATION_MINUTES, EMOM_DEFAULT_REPS_PER_MINUTE } from './emom';

describe('getEmomWeight', () => {
  it('computes a %TM, rounded to the nearest 2.5kg', () => {
    expect(getEmomWeight(100, 0.9)).toBe(90);
  });

  it('rounds down/up to the nearest 2.5kg', () => {
    expect(getEmomWeight(90, 0.9)).toBe(80);
    expect(getEmomWeight(92, 0.9)).toBe(82.5);
  });

  it('returns 0 for a zero training max', () => {
    expect(getEmomWeight(0, 0.9)).toBe(0);
  });
});

describe('getDefaultEmomPercentage', () => {
  it('applies the formula and clamps to the 1-2 reps/min bounds', () => {
    // 82 - 1*(10/5) - 0 = 80, within [78, 85]
    expect(getDefaultEmomPercentage(10, 2)).toBeCloseTo(0.8);
  });

  it('clamps to the 3-4 reps/min bounds', () => {
    // 82 - 1*(10/5) - 2*(4-2) = 76, within [72, 78]
    expect(getDefaultEmomPercentage(10, 4)).toBeCloseTo(0.76);
  });

  it('never exceeds the upper bound for very short/low-rep sessions', () => {
    // 82 - 1*(5/5) - 0 = 81, within [78, 85]
    expect(getDefaultEmomPercentage(5, 1)).toBeCloseTo(0.81);
  });

  it('never drops below the lower bound for long/high-rep sessions', () => {
    // 82 - 1*(30/5) - 2*(4-2) = 72, clamps to 72
    expect(getDefaultEmomPercentage(30, 4)).toBeCloseTo(0.72);
  });
});

describe('getEmomConfig', () => {
  it('falls back to defaults for legacy TM-only saved data', () => {
    const config = getEmomConfig({ type: 'emom', trainingMax: 100 });
    expect(config.durationMinutes).toBe(EMOM_DEFAULT_DURATION_MINUTES);
    expect(config.repsPerMinute).toBe(EMOM_DEFAULT_REPS_PER_MINUTE);
    expect(config.percentage).toBeCloseTo(getDefaultEmomPercentage(EMOM_DEFAULT_DURATION_MINUTES, EMOM_DEFAULT_REPS_PER_MINUTE));
  });

  it('uses explicit fields when present', () => {
    const config = getEmomConfig({ type: 'emom', trainingMax: 100, durationMinutes: 15, repsPerMinute: 3, percentage: 0.77 });
    expect(config.durationMinutes).toBe(15);
    expect(config.repsPerMinute).toBe(3);
    expect(config.percentage).toBe(0.77);
  });
});
