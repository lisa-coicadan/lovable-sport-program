import { describe, it, expect } from 'vitest';
import { getMiniSeriesWeight, getClusterConfig, CLUSTER_DEFAULT_MINI_SERIES, CLUSTER_DEFAULT_SERIES, CLUSTER_DEFAULT_REST_MINI_SERIES, CLUSTER_DEFAULT_REST_SERIES } from './cluster';

describe('getMiniSeriesWeight', () => {
  it('computes a %TM, rounded to the nearest 2.5kg', () => {
    expect(getMiniSeriesWeight(100, 0.9)).toBe(90);
  });

  it('rounds down/up to the nearest 2.5kg', () => {
    // 90 * 0.9 = 81 -> rounds to 80
    expect(getMiniSeriesWeight(90, 0.9)).toBe(80);
    // 92 * 0.9 = 82.8 -> rounds to 82.5
    expect(getMiniSeriesWeight(92, 0.9)).toBe(82.5);
  });

  it('returns 0 for a zero training max', () => {
    expect(getMiniSeriesWeight(0, 0.9)).toBe(0);
  });
});

describe('getClusterConfig', () => {
  it('falls back to defaults for legacy TM-only saved data', () => {
    const config = getClusterConfig({ type: 'cluster', trainingMax: 100 });
    expect(config.numSeries).toBe(CLUSTER_DEFAULT_SERIES);
    expect(config.miniSeries).toEqual(CLUSTER_DEFAULT_MINI_SERIES);
    expect(config.restMiniSeries).toBe(CLUSTER_DEFAULT_REST_MINI_SERIES);
    expect(config.restSeries).toBe(CLUSTER_DEFAULT_REST_SERIES);
  });

  it('uses explicit fields when present', () => {
    const custom = [{ reps: 3, percentage: 0.8 }];
    const config = getClusterConfig({
      type: 'cluster', trainingMax: 100, numSeries: 2, miniSeries: custom, restMiniSeries: 15, restSeries: 120,
    });
    expect(config.numSeries).toBe(2);
    expect(config.miniSeries).toBe(custom);
    expect(config.restMiniSeries).toBe(15);
    expect(config.restSeries).toBe(120);
  });
});
