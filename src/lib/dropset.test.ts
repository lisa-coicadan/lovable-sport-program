import { describe, it, expect } from 'vitest';
import { getDropSetConfig, getDropSetStage, DROPSET_DEFAULT_STEP_PERCENTAGE, DROPSET_DEFAULT_STEP_REPS } from './dropset';

describe('getDropSetConfig', () => {
  it('falls back to defaults when no config is given', () => {
    expect(getDropSetConfig(undefined)).toEqual({
      stepPercentage: DROPSET_DEFAULT_STEP_PERCENTAGE,
      stepReps: DROPSET_DEFAULT_STEP_REPS,
    });
  });

  it('uses explicit fields when present', () => {
    expect(getDropSetConfig({ stepPercentage: 0.2, stepReps: 3 })).toEqual({
      stepPercentage: 0.2,
      stepReps: 3,
    });
  });
});

describe('getDropSetStage', () => {
  const config = getDropSetConfig(undefined);

  it('matches the reference example: 45kg x 10 reps, stage 1', () => {
    // 45 * 0.85 = 38.25 -> rounds to 38 (nearest 1kg step, load < 40)
    expect(getDropSetStage(45, 10, 1, config)).toEqual({ weight: 38, reps: 8 });
  });

  it('matches the reference example: 45kg x 10 reps, stage 2', () => {
    // 45 - 45*0.15*2 = 31.5 -> rounds to 32 (nearest 1kg step)
    expect(getDropSetStage(45, 10, 2, config)).toEqual({ weight: 32, reps: 6 });
  });

  it('is always relative to the anchor, not the previous stage', () => {
    const stage1 = getDropSetStage(100, 10, 1, config);
    const stage2 = getDropSetStage(100, 10, 2, config);
    expect(stage1.weight).toBe(85);
    expect(stage2.weight).toBe(70);
  });

  it('never drops reps below 1', () => {
    expect(getDropSetStage(50, 2, 5, config).reps).toBe(1);
  });

  it('respects a custom step config', () => {
    const custom = getDropSetConfig({ stepPercentage: 0.2, stepReps: 3 });
    expect(getDropSetStage(100, 10, 1, custom)).toEqual({ weight: 80, reps: 7 });
  });

  it('gets MORE negative (more assisted, easier) for an assisted exercise, not less', () => {
    // -20kg assistance -> stage 1 must be a bigger assist (more negative), never smaller
    const stage1 = getDropSetStage(-20, 10, 1, config);
    const stage2 = getDropSetStage(-20, 10, 2, config);
    expect(stage1.weight).toBeLessThan(-20);
    expect(stage2.weight).toBeLessThan(stage1.weight);
  });

  it('does not clamp an assisted (negative) weight to 0', () => {
    expect(getDropSetStage(-20, 10, 1, config).weight).toBe(-23);
  });
});
