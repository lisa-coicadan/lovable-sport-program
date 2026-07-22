import { describe, it, expect } from 'vitest';
import { calculate1RM } from './types';

describe('calculate1RM', () => {
  it('applies the Epley formula, rounded to 1 decimal', () => {
    expect(calculate1RM(100, 5)).toBe(116.7); // 100 * (1 + 5/30)
    expect(calculate1RM(100, 1)).toBe(103.3);
  });

  it('returns 0 for non-positive weight or reps', () => {
    expect(calculate1RM(0, 5)).toBe(0);
    expect(calculate1RM(100, 0)).toBe(0);
    expect(calculate1RM(-10, 5)).toBe(0);
    expect(calculate1RM(100, -1)).toBe(0);
  });
});
