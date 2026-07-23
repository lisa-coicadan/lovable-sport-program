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
  it('applies the formula: 92% - 2%/min above 6min - 7%/rep above 1/min', () => {
    // 92 - 2*(10-6) - 7*(2-1) = 92 - 8 - 7 = 77
    expect(getDefaultEmomPercentage(10, 2)).toBeCloseTo(0.77);
    // 92 - 2*(10-6) - 7*(4-1) = 92 - 8 - 21 = 63
    expect(getDefaultEmomPercentage(10, 4)).toBeCloseTo(0.63);
  });

  it('clamps to the 90% upper bound for short/low-rep sessions', () => {
    // 92 - 2*(5-6) - 0 = 94, clamps to 90
    expect(getDefaultEmomPercentage(5, 1)).toBeCloseTo(0.9);
  });

  it('clamps to the 40% lower bound for long/high-rep sessions', () => {
    // 92 - 2*(30-6) - 7*(4-1) = 92 - 48 - 21 = 23, clamps to 40
    expect(getDefaultEmomPercentage(30, 4)).toBeCloseTo(0.4);
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
