// EMOM (Every Minute On the Minute): 2 reps at the start of every minute for 10 minutes,
// at 90% of the Training Max. One continuous countdown, auto-beeping every minute.

export const EMOM_DURATION_MINUTES = 10;
export const EMOM_REPS_PER_MINUTE = 2;
export const EMOM_PERCENTAGE = 0.9;

function roundToNearest(value: number, nearest: number): number {
  return Math.round(value / nearest) * nearest;
}

export function getEmomWeight(trainingMax: number): number {
  return roundToNearest(trainingMax * EMOM_PERCENTAGE, 2.5);
}
