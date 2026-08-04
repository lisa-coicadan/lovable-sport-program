import { DropSetConfig } from './types';

// Drop set: unlike Cluster/EMOM (a Training-Max-driven method generating every set
// upfront), a drop set cascades live in-session from whichever regular set she's
// actually doing (P0/R0 = weight/reps of that anchor set), not a standing TM. Each
// stage is computed relative to the ORIGINAL anchor, not the previous stage — stage 2
// is P0 x 0.70, not (stage 1 weight) x 0.85 again.
export const DROPSET_DEFAULT_STEP_PERCENTAGE = 0.15; // -15% of the anchor weight per stage
export const DROPSET_DEFAULT_STEP_REPS = 2; // -2 reps of the anchor reps per stage
export const DROPSET_MIN_REPS = 1;

export interface ResolvedDropSetConfig {
  stepPercentage: number;
  stepReps: number;
}

export function getDropSetConfig(config: DropSetConfig | undefined): ResolvedDropSetConfig {
  return {
    stepPercentage: config?.stepPercentage ?? DROPSET_DEFAULT_STEP_PERCENTAGE,
    stepReps: config?.stepReps ?? DROPSET_DEFAULT_STEP_REPS,
  };
}

export function getDropSetStage(
  anchorWeight: number,
  anchorReps: number,
  stage: number,
  config: ResolvedDropSetConfig
): { weight: number; reps: number } {
  // A drop set must get EASIER at every stage — for a normal (positive) load that means a
  // lower number, but for an assisted rep (negative weight = assistance against
  // bodyweight, see isBodyweightOptionalExercise in exerciseNormalize.ts) easier means
  // MORE assistance, i.e. a MORE negative number. Multiplying a negative anchor by
  // (1 - step) moves it toward zero — less assistance, harder, the wrong direction — so
  // the delta is sized from the anchor's magnitude and always subtracted, which pushes a
  // positive anchor down and a negative one further down (more negative) alike.
  const delta = Math.abs(anchorWeight) * config.stepPercentage * stage;
  const weight = roundDropSetWeight(anchorWeight - delta);
  const reps = Math.max(DROPSET_MIN_REPS, anchorReps - config.stepReps * stage);
  return { weight, reps };
}

// Like roundWeightSmart, but doesn't clamp negative values to 0 — needed here since an
// assisted rep's weight is legitimately negative (see above), unlike every other caller of
// roundWeightSmart where weight is always an absolute non-negative load.
function roundDropSetWeight(value: number): number {
  const abs = Math.abs(value);
  const nearest = abs < 15 ? 0.5 : abs < 40 ? 1 : 2.5;
  return Math.round(value / nearest) * nearest;
}
