// Pace/duration helpers for cardio sessions — CardioSession.durationMinutes is stored as
// a float (whole minutes + seconds/60), computed from separate min/sec form fields, so
// these format it back into a readable "Xmin YY" string rather than fractional minutes.

import type { CardioActivityType } from './types';

export function calculatePaceMinPerKm(durationMinutes: number, distanceKm: number | undefined): number | null {
  if (!distanceKm || distanceKm <= 0 || durationMinutes <= 0) return null;
  return durationMinutes / distanceKm;
}

// Distance is always stored in km (CardioSession.distanceKm), but natation is
// conventionally tracked in meters (pool lengths) — this only changes display,
// never the stored unit.
export function formatCardioDistance(distanceKm: number, activityType: CardioActivityType): string {
  if (activityType === 'Natation') {
    return `${Math.round(distanceKm * 1000)} m`;
  }
  return `${distanceKm} km`;
}

function toMinutesAndSeconds(totalMinutes: number): { m: number; s: number } {
  const totalSeconds = Math.round(totalMinutes * 60);
  return { m: Math.floor(totalSeconds / 60), s: totalSeconds % 60 };
}

export function formatCardioDuration(totalMinutes: number): string {
  const { m, s } = toMinutesAndSeconds(totalMinutes);
  return s === 0 ? `${m} min` : `${m}min${s.toString().padStart(2, '0')}`;
}

export function formatPace(paceMinPerKm: number): string {
  const { m, s } = toMinutesAndSeconds(paceMinPerKm);
  return `${m}min${s.toString().padStart(2, '0')}/km`;
}

export interface CardioComparisonMetric {
  current: number;
  last: number | null;
  average: number | null;
  improved: boolean | null; // vs the last session of the same activity — null when there's no prior session
  // % change vs `last`, sign already normalized so positive always means "better" (pace's
  // is inverted vs the raw arithmetic delta, since a lower min/km is the improvement).
  changePercent: number | null;
}

export interface CardioComparison {
  distance: CardioComparisonMetric | null; // null when this session has no distance logged
  pace: CardioComparisonMetric | null; // null when pace isn't computable (no distance)
  duration: CardioComparisonMetric;
  // The headline "did I do better?" verdict — pace (speed) first, then distance, then
  // duration, using the first one that's actually comparable against a prior session.
  headline: { metric: 'distance' | 'pace' | 'duration'; improved: boolean } | null;
}

const average = (values: number[]): number | null => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);

// `previousSessions` should already be filtered to the same activity type — this just
// finds the most recent one (by date) and averages across all of them.
export function compareCardioSession(
  current: { durationMinutes: number; distanceKm?: number },
  previousSessions: { date: string; durationMinutes: number; distanceKm?: number }[]
): CardioComparison {
  const last = [...previousSessions].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;

  const lastDuration = last ? last.durationMinutes : null;
  const duration: CardioComparisonMetric = {
    current: current.durationMinutes,
    last: lastDuration,
    average: average(previousSessions.map(s => s.durationMinutes)),
    improved: lastDuration !== null ? current.durationMinutes > lastDuration : null,
    changePercent: lastDuration ? ((current.durationMinutes - lastDuration) / lastDuration) * 100 : null,
  };

  let distance: CardioComparisonMetric | null = null;
  if (current.distanceKm !== undefined) {
    const lastDistance = last?.distanceKm ?? null;
    distance = {
      current: current.distanceKm,
      last: lastDistance,
      average: average(previousSessions.map(s => s.distanceKm).filter((d): d is number => d !== undefined)),
      improved: lastDistance !== null ? current.distanceKm > lastDistance : null,
      changePercent: lastDistance ? ((current.distanceKm - lastDistance) / lastDistance) * 100 : null,
    };
  }

  let pace: CardioComparisonMetric | null = null;
  const currentPace = calculatePaceMinPerKm(current.durationMinutes, current.distanceKm);
  if (currentPace !== null) {
    const lastPace = last ? calculatePaceMinPerKm(last.durationMinutes, last.distanceKm) : null;
    pace = {
      current: currentPace,
      last: lastPace,
      average: average(
        previousSessions
          .map(s => calculatePaceMinPerKm(s.durationMinutes, s.distanceKm))
          .filter((p): p is number => p !== null)
      ),
      improved: lastPace !== null ? currentPace < lastPace : null, // lower min/km = faster = better
      // Inverted vs the raw delta: pace dropping (faster) is the improvement, so a lower
      // current-vs-last should read as a POSITIVE percentage here.
      changePercent: lastPace ? ((lastPace - currentPace) / lastPace) * 100 : null,
    };
  }

  const headline: CardioComparison['headline'] =
    pace?.improved != null ? { metric: 'pace', improved: pace.improved }
    : distance?.improved != null ? { metric: 'distance', improved: distance.improved }
    : duration.improved != null ? { metric: 'duration', improved: duration.improved }
    : null;

  return { distance, pace, duration, headline };
}
