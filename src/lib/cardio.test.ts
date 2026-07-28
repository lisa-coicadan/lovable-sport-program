import { describe, it, expect } from 'vitest';
import { calculatePaceMinPerKm, formatCardioDuration, formatPace, compareCardioSession } from './cardio';

describe('calculatePaceMinPerKm', () => {
  it('computes minutes per km from duration and distance', () => {
    expect(calculatePaceMinPerKm(30, 5)).toBe(6);
    expect(calculatePaceMinPerKm(25.5, 5)).toBe(5.1);
  });

  it('returns null when distance is missing or zero', () => {
    expect(calculatePaceMinPerKm(30, undefined)).toBeNull();
    expect(calculatePaceMinPerKm(30, 0)).toBeNull();
  });

  it('returns null when duration is zero', () => {
    expect(calculatePaceMinPerKm(0, 5)).toBeNull();
  });
});

describe('formatCardioDuration', () => {
  it('formats whole minutes without seconds', () => {
    expect(formatCardioDuration(25)).toBe('25 min');
  });

  it('formats minutes with seconds', () => {
    expect(formatCardioDuration(25.5)).toBe('25min30');
    expect(formatCardioDuration(25 + 5 / 60)).toBe('25min05');
  });
});

describe('formatPace', () => {
  it('formats pace as minutes and seconds per km', () => {
    expect(formatPace(6)).toBe('6min00/km');
    expect(formatPace(5.5)).toBe('5min30/km');
  });
});

describe('compareCardioSession', () => {
  it('reports no headline / all-null metrics with zero prior history', () => {
    const result = compareCardioSession({ durationMinutes: 30, distanceKm: 5 }, []);
    expect(result.headline).toBeNull();
    expect(result.distance?.last).toBeNull();
    expect(result.distance?.average).toBeNull();
    expect(result.duration.last).toBeNull();
  });

  it('prioritizes pace (speed) for the headline when it improved', () => {
    // Same duration, more distance → both pace and distance improve; pace wins the headline.
    const result = compareCardioSession(
      { durationMinutes: 30, distanceKm: 6 },
      [{ date: '2026-07-01', durationMinutes: 30, distanceKm: 5 }]
    );
    expect(result.headline).toEqual({ metric: 'pace', improved: true });
    expect(result.distance).toEqual({ current: 6, last: 5, average: 5, improved: true, changePercent: 20 });
  });

  it('flags a slower pace than last time as not improved', () => {
    const result = compareCardioSession(
      { durationMinutes: 30, distanceKm: 4 },
      [{ date: '2026-07-01', durationMinutes: 30, distanceKm: 5 }]
    );
    expect(result.headline).toEqual({ metric: 'pace', improved: false });
  });

  it('falls back to duration when distance is not logged for this session', () => {
    const result = compareCardioSession(
      { durationMinutes: 40 },
      [{ date: '2026-07-01', durationMinutes: 30, distanceKm: 5 }]
    );
    expect(result.distance).toBeNull();
    expect(result.pace).toBeNull();
    expect(result.headline).toEqual({ metric: 'duration', improved: true });
  });

  it('treats a faster pace (lower min/km) as improved', () => {
    // 30min/5km = 6min/km now vs 30min/4km = 7.5min/km last time — faster now.
    const result = compareCardioSession(
      { durationMinutes: 30, distanceKm: 5 },
      [{ date: '2026-07-01', durationMinutes: 30, distanceKm: 4 }]
    );
    expect(result.pace?.improved).toBe(true);
    expect(result.pace?.current).toBe(6);
    expect(result.pace?.last).toBe(7.5);
    // Pace dropped from 7.5 to 6 (faster) — a positive changePercent, even though the
    // raw arithmetic delta (6-7.5)/7.5 is negative, since faster = improvement here.
    expect(result.pace?.changePercent).toBeCloseTo(20, 5);
  });

  it('picks the most recent session as "last", not just the first in the array', () => {
    const result = compareCardioSession(
      { durationMinutes: 30, distanceKm: 5 },
      [
        { date: '2026-07-01', durationMinutes: 30, distanceKm: 3 },
        { date: '2026-07-15', durationMinutes: 30, distanceKm: 4.5 },
      ]
    );
    expect(result.distance?.last).toBe(4.5);
    expect(result.distance?.average).toBe(3.75);
  });
});
