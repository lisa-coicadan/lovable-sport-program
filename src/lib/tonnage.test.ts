import { describe, it, expect } from 'vitest';
import { computeSetTonnage, resolveBodyWeightAtDate, computeBodyweightAdjustedE1RM, computeEffectiveLoadAtOneRep } from './tonnage';
import { calculate1RM } from './types';

describe('resolveBodyWeightAtDate', () => {
  const logs = [
    { date: '2026-01-01', weight: 60 },
    { date: '2026-03-01', weight: 62 },
    { date: '2026-06-01', weight: 58 },
  ];

  it('picks the most recent log on or before the given date', () => {
    expect(resolveBodyWeightAtDate(logs, '2026-04-15')).toBe(62);
    expect(resolveBodyWeightAtDate(logs, '2026-03-01')).toBe(62);
  });

  it('does not use a log that postdates the given date', () => {
    // A bodyweight logged in June must never rewrite an April session's tonnage.
    expect(resolveBodyWeightAtDate(logs, '2026-04-15')).not.toBe(58);
  });

  it('falls back to the earliest log if the date predates all logs', () => {
    expect(resolveBodyWeightAtDate(logs, '2025-12-01')).toBe(60);
  });

  it('returns undefined when there are no logs', () => {
    expect(resolveBodyWeightAtDate([], '2026-04-15')).toBeUndefined();
    expect(resolveBodyWeightAtDate(undefined, '2026-04-15')).toBeUndefined();
  });
});

describe('computeSetTonnage', () => {
  it('is unaffected for regular (non-bodyweight-driven) exercises', () => {
    expect(computeSetTonnage({ weight: 100, reps: 5, exerciseName: 'Squat' }, 70)).toBe(500);
    expect(computeSetTonnage({ weight: 100, reps: 5, exerciseName: 'Squat' }, undefined)).toBe(500);
  });

  it('counts full bodyweight for a bodyweight-only (0kg) pull-up/dip set', () => {
    expect(computeSetTonnage({ weight: 0, reps: 8, exerciseName: 'Tractions lestées' }, 70)).toBe(560);
    expect(computeSetTonnage({ weight: 0, reps: 6, exerciseName: 'Dips lestés' }, 70)).toBe(420);
  });

  it('adds a weighted vest/belt load on top of bodyweight', () => {
    expect(computeSetTonnage({ weight: 20, reps: 5, exerciseName: 'Tractions lestées' }, 70)).toBe(450);
  });

  it('subtracts assistance (negative weight) from bodyweight', () => {
    expect(computeSetTonnage({ weight: -20, reps: 10, exerciseName: 'Tractions élastique' }, 70)).toBe(500);
  });

  it('clamps effective weight at 0 when assistance exceeds bodyweight', () => {
    expect(computeSetTonnage({ weight: -100, reps: 10, exerciseName: 'Dips élastique' }, 70)).toBe(0);
  });

  it('only counts 65% of bodyweight for pompes', () => {
    expect(computeSetTonnage({ weight: 0, reps: 20, exerciseName: 'Pompes' }, 70)).toBe(910); // 0.65*70*20
  });

  it('adds a weighted vest load on top of the 65% pompes fraction', () => {
    expect(computeSetTonnage({ weight: 10, reps: 10, exerciseName: 'Pompes' }, 70)).toBe(555); // (0.65*70+10)*10
  });

  it('treats missing bodyweight data as 0 rather than throwing', () => {
    expect(computeSetTonnage({ weight: 0, reps: 8, exerciseName: 'Tractions lestées' }, undefined)).toBe(0);
  });
});

describe('computeBodyweightAdjustedE1RM', () => {
  it('is identical to calculate1RM for regular (non-bodyweight-driven) exercises', () => {
    expect(computeBodyweightAdjustedE1RM({ weight: 100, reps: 5, exerciseName: 'Squat' }, 70))
      .toBe(calculate1RM(100, 5));
  });

  it('reads ~0 for a strict bodyweight rep at very low reps (no meaningful delta)', () => {
    // At reps=1, Epley's rep-scaling factor is ~1, so a pure bodyweight rep should be
    // close to the bodyweight-delta of 0 (small positive noise from the reps factor).
    const value = computeBodyweightAdjustedE1RM({ weight: 0, reps: 1, exerciseName: 'Tractions lestées' }, 60);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(3);
  });

  it('is positive and reps-scaled for a weighted (vest) set, matching the effective-load formula', () => {
    const bw = 60;
    const value = computeBodyweightAdjustedE1RM({ weight: 20, reps: 5, exerciseName: 'Tractions lestées' }, bw);
    expect(value).toBe(Math.round((calculate1RM(bw + 20, 5) - bw) * 10) / 10);
    expect(value).toBeGreaterThan(20); // Epley's rep-scaling pushes it above the raw added weight
  });

  it('is negative for a heavily-assisted set, and NOT simply the raw negative weight (reps-scaled via the true effective load)', () => {
    const bw = 60;
    const value = computeBodyweightAdjustedE1RM({ weight: -40, reps: 5, exerciseName: 'Tractions élastique' }, bw);
    expect(value).toBeLessThan(0);
    expect(value).toBe(Math.round((calculate1RM(bw - 40, 5) - bw) * 10) / 10);
    expect(value).not.toBe(-40);
  });

  it('can read ABOVE 0 for a lightly-assisted but high-rep set — Epley legitimately projects past bodyweight, unlike a naive "just show the raw assistance" reading', () => {
    // 10 reps at only -10kg assistance is a strong feat: Epley's rep-scaling projects a
    // 1RM equivalent above bodyweight, not a small negative dip — this is exactly the
    // nonlinear behavior a raw-weight-delta chart would fail to capture.
    const bw = 60;
    const value = computeBodyweightAdjustedE1RM({ weight: -10, reps: 10, exerciseName: 'Tractions élastique' }, bw);
    expect(value).toBeGreaterThan(0);
  });

  it('scales the pompes fraction (0.65) the same way as tonnage', () => {
    const bw = 60;
    const value = computeBodyweightAdjustedE1RM({ weight: 0, reps: 10, exerciseName: 'Pompes' }, bw);
    expect(value).toBe(Math.round((calculate1RM(0.65 * bw, 10) - 0.65 * bw) * 10) / 10);
  });

  it('treats missing bodyweight data as 0 rather than throwing', () => {
    const value = computeBodyweightAdjustedE1RM({ weight: 0, reps: 8, exerciseName: 'Tractions lestées' }, undefined);
    expect(value).toBe(0);
  });
});

describe('computeEffectiveLoadAtOneRep', () => {
  it('is just the raw weight for a non-bodyweight exercise — no formula needed at 1 rep', () => {
    expect(computeEffectiveLoadAtOneRep({ weight: 140, exerciseName: 'Squat' }, 70)).toBe(140);
  });

  it('adds the bodyweight fraction for a strict-bodyweight true 1RM (0 added weight)', () => {
    const value = computeEffectiveLoadAtOneRep({ weight: 0, exerciseName: 'Tractions lestées' }, 70);
    expect(value).toBe(70); // fraction 1.0 for tractions lestées
  });

  it('adds the added weight on top of the bodyweight contribution', () => {
    const value = computeEffectiveLoadAtOneRep({ weight: 20, exerciseName: 'Tractions lestées' }, 70);
    expect(value).toBe(90);
  });

  it('scales the pompes fraction (0.65) the same way as tonnage/e1RM', () => {
    const value = computeEffectiveLoadAtOneRep({ weight: 0, exerciseName: 'Pompes' }, 60);
    expect(value).toBe(0.65 * 60);
  });

  it('subtracts assistance (negative weight) from the bodyweight contribution', () => {
    const value = computeEffectiveLoadAtOneRep({ weight: -20, exerciseName: 'Tractions lestées' }, 70);
    expect(value).toBe(50);
  });

  it('treats missing bodyweight data as 0 rather than throwing', () => {
    expect(computeEffectiveLoadAtOneRep({ weight: 0, exerciseName: 'Tractions lestées' }, undefined)).toBe(0);
  });
});
