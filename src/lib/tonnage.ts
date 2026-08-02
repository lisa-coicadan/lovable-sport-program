import { BodyWeightLog, SetLog, calculate1RM } from './types';
import { bodyweightTonnageFraction } from './exerciseNormalize';

// Resolves the bodyweight to use for a session on a given date: the most recent logged
// bodyweight ON OR BEFORE that date, never the current/latest one — so tonnage for past
// sessions stays stable when bodyweight is logged later, instead of being silently
// rewritten every time she weighs in. Falls back to the earliest available log if every
// log postdates the session (no data yet at that point in time): an approximate figure
// beats treating a bodyweight-driven exercise as if it carried no load at all.
export function resolveBodyWeightAtDate(logs: BodyWeightLog[] | undefined, date: string): number | undefined {
  if (!logs || logs.length === 0) return undefined;
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
  let best: BodyWeightLog | undefined;
  for (const log of sorted) {
    if (log.date <= date) best = log;
    else break;
  }
  return (best ?? sorted[0]).weight;
}

// Real kg moved for one set. For tractions/dips/pompes, `weight` is logged as an addition
// to (or, negative, an assistance against) bodyweight rather than the total load — see
// bodyweightTonnageFraction — so the effective load is bodyweight*fraction + weight,
// clamped at 0 (a heavily band-assisted rep can't move negative kg). Every other exercise
// logs `weight` as the total load already. `bodyWeightKg` should come from
// resolveBodyWeightAtDate for the set's own session date, not the current bodyweight.
export function computeSetTonnage(
  set: Pick<SetLog, 'weight' | 'reps' | 'exerciseName'>,
  bodyWeightKg: number | undefined
): number {
  const fraction = bodyweightTonnageFraction(set.exerciseName);
  if (fraction === 0) return set.weight * set.reps;
  const effectiveWeight = Math.max(0, (bodyWeightKg ?? 0) * fraction + set.weight);
  return effectiveWeight * set.reps;
}

// Estimated 1RM for the exercise-history chart, expressed as a DELTA from bodyweight
// (0 = a strict bodyweight rep) so it reads on the same axis she already thinks in —
// added weight positive, assistance negative — rather than an absolute kg figure.
// Deliberately NOT the same number as HistoryEntry.e1rm / the France-record "niveau"
// ratio (src/lib/strengthStandards.ts), which keep using calculate1RM on the raw logged
// `weight` — those thresholds were calibrated against that raw-delta number, and
// recalibrating them is a separate task. This is for the chart line only.
//
// Epley's rep-scaling is applied to the TRUE total effective load (bodyweight*fraction +
// weight), then the bodyweight contribution is subtracted back out for display — applying
// Epley directly to a negative (assisted) delta has no physical meaning, since the
// rep-difficulty of an assisted rep scales with the actual weight moved (bodyweight minus
// assistance), not with the assistance amount alone.
export function computeBodyweightAdjustedE1RM(
  set: Pick<SetLog, 'weight' | 'reps' | 'exerciseName'>,
  bodyWeightKg: number | undefined
): number {
  const fraction = bodyweightTonnageFraction(set.exerciseName);
  if (fraction === 0) return calculate1RM(set.weight, set.reps);
  const bwContribution = (bodyWeightKg ?? 0) * fraction;
  const effectiveLoad = bwContribution + set.weight;
  return Math.round((calculate1RM(effectiveLoad, set.reps) - bwContribution) * 10) / 10;
}

// Total absolute load actually moved for a genuine 1-rep max (a TESTED 1RM, not an
// estimate — no Epley extrapolation needed, the set itself IS the 1RM). For tractions/dips
// lestés, `weight` is logged as a delta from bodyweight, so the real load a true 1RM
// represents is bodyweight*fraction + weight, same as computeSetTonnage/
// computeBodyweightAdjustedE1RM above — everywhere else `weight` already is the total load.
export function computeEffectiveLoadAtOneRep(
  set: Pick<SetLog, 'weight' | 'exerciseName'>,
  bodyWeightKg: number | undefined
): number {
  const fraction = bodyweightTonnageFraction(set.exerciseName);
  if (fraction === 0) return set.weight;
  return Math.round(((bodyWeightKg ?? 0) * fraction + set.weight) * 10) / 10;
}
