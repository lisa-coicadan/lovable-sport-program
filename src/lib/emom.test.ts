import { describe, it, expect } from 'vitest';
import { getEmomWeight } from './emom';

describe('getEmomWeight', () => {
  it('computes 90% of the training max, rounded to the nearest 2.5kg', () => {
    expect(getEmomWeight(100)).toBe(90);
  });

  it('rounds down/up to the nearest 2.5kg', () => {
    // 90 * 0.9 = 81 -> rounds to 80
    expect(getEmomWeight(90)).toBe(80);
    // 92 * 0.9 = 82.8 -> rounds to 82.5
    expect(getEmomWeight(92)).toBe(82.5);
  });

  it('returns 0 for a zero training max', () => {
    expect(getEmomWeight(0)).toBe(0);
  });
});
