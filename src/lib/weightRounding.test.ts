import { describe, it, expect } from 'vitest';
import { roundWeightSmart } from './weightRounding';

describe('roundWeightSmart', () => {
  it('rounds heavy loads (>=40kg) to the nearest 2.5kg', () => {
    expect(roundWeightSmart(81)).toBe(80);
    expect(roundWeightSmart(82.8)).toBe(82.5);
  });

  it('rounds mid loads (15-40kg) to the nearest 1kg', () => {
    expect(roundWeightSmart(17)).toBe(17);
    expect(roundWeightSmart(20.75)).toBe(21);
  });

  it('rounds light loads (<15kg) to the nearest 0.5kg', () => {
    expect(roundWeightSmart(9)).toBe(9);
    expect(roundWeightSmart(8.3)).toBe(8.5);
  });

  it('returns 0 for a zero or negative value', () => {
    expect(roundWeightSmart(0)).toBe(0);
    expect(roundWeightSmart(-5)).toBe(0);
  });
});
