// Cluster training: 4 series of 3 mini-series of 2 reps at 90% of the Training Max,
// with short manual rest between mini-series and longer manual rest between series.

export const CLUSTER_SERIES = 4;
export const CLUSTER_MINI_SERIES = 3;
export const CLUSTER_REPS_PER_MINI_SERIES = 2;
export const CLUSTER_PERCENTAGE = 0.9;
export const CLUSTER_REST_MINI_SERIES = 20; // seconds, between mini-series within a series
export const CLUSTER_REST_SERIES = 180; // seconds, between series (3min)

function roundToNearest(value: number, nearest: number): number {
  return Math.round(value / nearest) * nearest;
}

export function getClusterWeight(trainingMax: number): number {
  return roundToNearest(trainingMax * CLUSTER_PERCENTAGE, 2.5);
}
