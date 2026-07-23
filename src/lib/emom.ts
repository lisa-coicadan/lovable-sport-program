import { EMOMMethod } from './types';
import { roundWeightSmart } from './weightRounding';

// EMOM (Every Minute On the Minute): a fixed number of reps at the start of every
// minute, for a fixed duration, at a %TM tuned to leave 30-40s of rest per minute.
// Defaults below apply whenever the corresponding EMOMMethod field is missing (keeps
// old TM-only saved data working) — everything is otherwise editable in Settings.

export const EMOM_DEFAULT_DURATION_MINUTES = 10;
export const EMOM_DEFAULT_REPS_PER_MINUTE = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Empirical formula: Intensity (%TM) = 92% - 2%/min above 6min - 7%/rep above 1/min,
// clamped to [40%, 90%]. Only used to suggest a starting %TM when duration/reps
// change — always manually overridable.
export function getDefaultEmomPercentage(durationMinutes: number, repsPerMinute: number): number {
  const durationPenalty = 2 * (durationMinutes - 6);
  const repsPenalty = 7 * (repsPerMinute - 1);
  const intensity = 92 - durationPenalty - repsPenalty;
  return clamp(intensity, 40, 90) / 100;
}

export interface EmomConfig {
  durationMinutes: number;
  repsPerMinute: number;
  percentage: number; // fraction of TM
}

export function getEmomConfig(method: EMOMMethod): EmomConfig {
  const durationMinutes = method.durationMinutes ?? EMOM_DEFAULT_DURATION_MINUTES;
  const repsPerMinute = method.repsPerMinute ?? EMOM_DEFAULT_REPS_PER_MINUTE;
  const percentage = method.percentage ?? getDefaultEmomPercentage(durationMinutes, repsPerMinute);
  return { durationMinutes, repsPerMinute, percentage };
}

export function getEmomWeight(trainingMax: number, percentage: number): number {
  return roundWeightSmart(trainingMax * percentage);
}
