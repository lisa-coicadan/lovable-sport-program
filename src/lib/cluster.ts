import { ClusterMethod, ClusterMiniSeries } from './types';
import { roundWeightSmart } from './weightRounding';

// Cluster training: a heavy set broken into mini-series with short intra-series rest
// (10-30s) to preserve speed/power, longer rest between series. Defaults below apply
// whenever the corresponding ClusterMethod field is missing (keeps old TM-only saved
// data working) — everything is otherwise editable per exercise in Settings.

export const CLUSTER_DEFAULT_SERIES = 4;
export const CLUSTER_DEFAULT_MINI_SERIES: ClusterMiniSeries[] = [
  { reps: 2, percentage: 0.9 },
  { reps: 2, percentage: 0.9 },
  { reps: 2, percentage: 0.9 },
];
export const CLUSTER_DEFAULT_REST_MINI_SERIES = 20; // seconds
export const CLUSTER_DEFAULT_REST_SERIES = 180; // seconds

// Reference formats she validated (85-95% TM range), selectable as a starting point
// in Settings before any manual tweaking.
export const CLUSTER_PRESETS: { key: string; label: string; miniSeries: ClusterMiniSeries[] }[] = [
  {
    key: 'wave',
    label: 'Wave Loading (2-2-1-1)',
    miniSeries: [
      { reps: 2, percentage: 0.85 },
      { reps: 2, percentage: 0.875 },
      { reps: 1, percentage: 0.9 },
      { reps: 1, percentage: 0.925 },
    ],
  },
  {
    key: 'uniform',
    label: 'Volume uniforme (3x2)',
    miniSeries: [
      { reps: 2, percentage: 0.85 },
      { reps: 2, percentage: 0.85 },
      { reps: 2, percentage: 0.85 },
    ],
  },
  {
    key: 'pyramid',
    label: 'Pyramide ascendante (1-2-3)',
    miniSeries: [
      { reps: 1, percentage: 0.9 },
      { reps: 2, percentage: 0.875 },
      { reps: 3, percentage: 0.85 },
    ],
  },
];

export interface ClusterConfig {
  numSeries: number;
  miniSeries: ClusterMiniSeries[];
  restMiniSeries: number;
  restSeries: number;
}

export function getClusterConfig(method: ClusterMethod): ClusterConfig {
  return {
    numSeries: method.numSeries ?? CLUSTER_DEFAULT_SERIES,
    miniSeries: method.miniSeries && method.miniSeries.length > 0 ? method.miniSeries : CLUSTER_DEFAULT_MINI_SERIES,
    restMiniSeries: method.restMiniSeries ?? CLUSTER_DEFAULT_REST_MINI_SERIES,
    restSeries: method.restSeries ?? CLUSTER_DEFAULT_REST_SERIES,
  };
}

export function getMiniSeriesWeight(trainingMax: number, percentage: number): number {
  return roundWeightSmart(trainingMax * percentage);
}
