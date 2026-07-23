import { EMOMMethod } from './types';

// EMOM (Every Minute On the Minute): a fixed number of reps at the start of every
// minute, for a fixed duration, at a %TM tuned to leave 30-40s of rest per minute.
// Defaults below apply whenever the corresponding EMOMMethod field is missing (keeps
// old TM-only saved data working) — everything is otherwise editable in Settings.

export const EMOM_DEFAULT_DURATION_MINUTES = 10;
export const EMOM_DEFAULT_REPS_PER_MINUTE = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Empirical formula: Intensity (%TM) = 82% - (1% per 5min of duration) - (2% per rep
// above 2/min), then clamped to the validated bounds for that rep range. Only used to
// suggest a starting %TM when duration/reps change — always manually overridable.
export function getDefaultEmomPercentage(durationMinutes: number, repsPerMinute: number): number {
  const tranches5min = durationMinutes / 5;
  const raw = 82 - 1 * tranches5min - 2 * Math.max(0, repsPerMinute - 2);
  const [min, max] = repsPerMinute <= 2 ? [78, 85] : [72, 78];
  return clamp(raw, min, max) / 100;
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

function roundToNearest(value: number, nearest: number): number {
  return Math.round(value / nearest) * nearest;
}

export function getEmomWeight(trainingMax: number, percentage: number): number {
  return roundToNearest(trainingMax * percentage, 2.5);
}
