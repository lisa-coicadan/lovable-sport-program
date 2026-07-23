// Onboarding TM calculator: estimate a Training Max from a recent heavy set (weight x reps)
// when the exact TM isn't already known. Brzycki formula for the 1RM estimate, then the
// standard 90% TM convention — distinct from the app's Epley-based `calculate1RM` in
// types.ts, which tracks e1RM progression on completed sets, not TM estimation.

export function estimateOneRepMax(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return Math.round(weight * 10) / 10;
  return Math.round((weight / (1.0278 - 0.0278 * reps)) * 10) / 10;
}

export function estimateTrainingMax(oneRepMax: number): number {
  return Math.round(oneRepMax * 0.9 * 10) / 10;
}
