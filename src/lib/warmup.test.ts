import { describe, it, expect } from 'vitest';
import { getWarmupPercentages } from './warmup';

describe('getWarmupPercentages', () => {
  it('returns an empty array for 0 or fewer', () => {
    expect(getWarmupPercentages(0)).toEqual([]);
    expect(getWarmupPercentages(-1)).toEqual([]);
  });

  it('matches the coach protocol for 1 to 5 stages', () => {
    expect(getWarmupPercentages(1)).toEqual([0.5]);
    expect(getWarmupPercentages(2)).toEqual([0.45, 0.7]);
    expect(getWarmupPercentages(3)).toEqual([0.4, 0.6, 0.8]);
    expect(getWarmupPercentages(4)).toEqual([0.35, 0.55, 0.75, 0.9]);
    expect(getWarmupPercentages(5)).toEqual([0.3, 0.45, 0.6, 0.75, 0.9]);
  });

  it('holds at 90% for stages beyond the 5-stage protocol', () => {
    expect(getWarmupPercentages(6)).toEqual([0.3, 0.45, 0.6, 0.75, 0.9, 0.9]);
    expect(getWarmupPercentages(7)).toEqual([0.3, 0.45, 0.6, 0.75, 0.9, 0.9, 0.9]);
  });
});
