// Shared by Cluster, EMOM and 531 weight calculations. Picks a rounding granularity
// based on the load itself: a flat 2.5kg step is a huge relative jump on a light load
// (e.g. a 5-10kg Training Max), so light loads round finer (0.5kg/1kg), mid loads keep
// the standard 2.5kg gym increment, and heavy loads (100kg+) round to 5kg — mirrors a
// typical plate progression (~2-6% jumps at every tier).
export function roundWeightSmart(value: number): number {
  if (value <= 0) return 0;
  const nearest = value < 15 ? 0.5 : value < 40 ? 1 : value < 100 ? 2.5 : 5;
  return Math.round(value / nearest) * nearest;
}
