import { DropSetConfig } from './types';
import { roundWeightSmart } from './weightRounding';

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
  const weight = roundWeightSmart(anchorWeight * (1 - config.stepPercentage * stage));
  const reps = Math.max(DROPSET_MIN_REPS, anchorReps - config.stepReps * stage);
  return { weight, reps };
}
