import { describe, it, expect } from 'vitest';
import { generateRampPlan, generateBonusStage, getOuvertureGuidance, getFailureGuidance, RAMP_STAGES } from './oneRepMaxTest';

describe('generateRampPlan', () => {
  it('produces one stage per RAMP_STAGES entry, in order', () => {
    const plan = generateRampPlan(100);
    expect(plan.map(p => p.key)).toEqual(RAMP_STAGES.map(s => s.key));
  });

  it('scales weights from the target 1RM using each stage percentage, rounded smart', () => {
    const plan = generateRampPlan(100);
    expect(plan.find(p => p.key === 'ouverture')?.weight).toBe(90);
    expect(plan.find(p => p.key === 'pr')?.weight).toBe(100);
    expect(plan.find(p => p.key === 'mobilisation')?.weight).toBe(35);
  });

  it('carries the reps from the coach protocol unchanged', () => {
    const plan = generateRampPlan(100);
    expect(plan.find(p => p.key === 'pr')?.reps).toBe(1);
    expect(plan.find(p => p.key === 'mobilisation')?.reps).toBe(9);
  });

  it('returns an empty plan for a non-positive target', () => {
    expect(generateRampPlan(0)).toEqual([]);
    expect(generateRampPlan(-10)).toEqual([]);
  });
});

describe('generateBonusStage', () => {
  it('targets 102% of the 1RM for 1 rep, rounded smart like every other stage', () => {
    const bonus = generateBonusStage(100);
    // 100 * 1.02 = 102 -> roundWeightSmart's 100kg+ tier snaps to the nearest 5kg
    expect(bonus.weight).toBe(100);
    expect(bonus.reps).toBe(1);
  });
});

describe('getOuvertureGuidance', () => {
  it('suggests going heavier when RPE is easy (<= 8)', () => {
    expect(getOuvertureGuidance(7)).toMatch(/viser plus haut/);
    expect(getOuvertureGuidance(8)).toMatch(/viser plus haut/);
  });

  it('suggests backing off when RPE is very high (>= 9.5)', () => {
    expect(getOuvertureGuidance(9.5)).toMatch(/ajuste ton 100% à la baisse/);
    expect(getOuvertureGuidance(10)).toMatch(/ajuste ton 100% à la baisse/);
  });

  it('stays quiet in the expected RPE range', () => {
    expect(getOuvertureGuidance(8.5)).toBeNull();
    expect(getOuvertureGuidance(9)).toBeNull();
  });
});

describe('getFailureGuidance', () => {
  it('always warns against retrying the same charge this session', () => {
    expect(getFailureGuidance()).toMatch(/ne retente pas/);
  });
});
