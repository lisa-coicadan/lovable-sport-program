import { AppData, DeloadIntensity, DeloadState, DeloadType, SessionLog, WorkoutType } from './types';
import { computeSetTonnage, resolveBodyWeightAtDate } from './tonnage';
import { roundWeightSmart } from './weightRounding';

const DAY_MS = 24 * 60 * 60 * 1000;

// SessionLog.date strings are written elsewhere in the app via
// `new Date().toISOString().split('T')[0]` (a UTC calendar date) — parsed back here with a
// 'Z' suffix (UTC) rather than local time, and all arithmetic below stays UTC-based (getUTC*/
// setUTC*), so a date string round-trips to itself regardless of the machine's own
// timezone. Mixing local-time parsing with UTC serialization here would silently shift
// dates by a day depending on where the app happens to run.
function parseISODate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00Z');
}

function toISODate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / DAY_MS);
}

// Monday-start week key (matches the convention already used for weekly aggregation in
// StatsTab/CalendarTab) — two dates in the same Monday-Sunday span map to the same key.
function mondayKey(dateStr: string): string {
  const d = parseISODate(dateStr);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return toISODate(d);
}

// ---------------------------------------------------------------------------------------
// Critère 1 — Temps : semaines d'entraînement consécutives depuis le dernier deload.
// ---------------------------------------------------------------------------------------

// Counts the trailing run of consecutive Monday-weeks (each with >=1 strength session)
// ending at the most recent week that actually has a session — an in-progress week with
// zero sessions so far isn't a "gap", it just hasn't been decided yet.
export function getConsecutiveTrainingWeeks(sessions: SessionLog[], sinceDate: string | undefined): number {
  const weeks = new Set(
    sessions.filter(s => !sinceDate || s.date > sinceDate).map(s => mondayKey(s.date))
  );
  if (weeks.size === 0) return 0;
  const latest = [...weeks].sort().pop()!;
  let count = 0;
  let cursor = parseISODate(latest);
  while (weeks.has(toISODate(cursor))) {
    count++;
    cursor = new Date(cursor.getTime() - 7 * DAY_MS);
  }
  return count;
}

// ---------------------------------------------------------------------------------------
// Critère 2 — Fatigue (RPE), sur SessionLog.difficulty (RPE de fin de séance, pas le RPE
// par exercice) : deux sous-conditions indépendantes, chacune peut déclencher seule.
// ---------------------------------------------------------------------------------------

const FATIGUE_WINDOW_DAYS = 14;

export interface FatigueCriterion {
  avgTrue: boolean;
  avgValue: number | null;
  consecutiveTrue: boolean;
}

export function getFatigueCriterion(sessions: SessionLog[], now: Date): FatigueCriterion {
  const rated = sessions.filter(s => s.difficulty !== undefined);

  const last14 = rated.filter(s => daysBetween(now, parseISODate(s.date)) < FATIGUE_WINDOW_DAYS);
  const avgValue = last14.length >= 4
    ? Math.round((last14.reduce((sum, s) => sum + (s.difficulty ?? 0), 0) / last14.length) * 10) / 10
    : null;
  const avgTrue = avgValue !== null && avgValue >= 7.8;

  const mostRecent3 = [...rated].sort((a, b) => b.date.localeCompare(a.date) || (b.startTime - a.startTime)).slice(0, 3);
  const consecutiveTrue = mostRecent3.length === 3 && mostRecent3.every(s => (s.difficulty ?? 0) >= 8.5);

  return { avgTrue, avgValue, consecutiveTrue };
}

// ---------------------------------------------------------------------------------------
// Critère 3 — Progression ralentie : tonnage moyen des 2 dernières semaines vs des 2
// semaines précédentes, stagnation si la variation est comprise entre -2% et +2%.
// ---------------------------------------------------------------------------------------

function totalTonnage(sessions: SessionLog[], bodyWeightLogs: AppData['bodyWeightLogs']): number {
  return sessions.reduce((sum, s) => {
    const bw = resolveBodyWeightAtDate(bodyWeightLogs, s.date);
    // Warm-up sets aren't real training volume — a session that's mostly warm-up
    // shouldn't read as "stagnant progression" just because its working tonnage was low.
    return sum + s.sets.filter(set => !set.isWarmup).reduce((setSum, set) => setSum + computeSetTonnage(set, bw), 0);
  }, 0);
}

export interface TonnageStagnationCriterion {
  stagnant: boolean;
  pctChange: number | null; // tonnage window A (0-13j) vs B (14-27j), null si B est vide (pas assez d'historique)
}

export function getTonnageStagnationCriterion(
  sessions: SessionLog[],
  bodyWeightLogs: AppData['bodyWeightLogs'],
  now: Date
): TonnageStagnationCriterion {
  const windowA = sessions.filter(s => { const d = daysBetween(now, parseISODate(s.date)); return d >= 0 && d < 14; });
  const windowB = sessions.filter(s => { const d = daysBetween(now, parseISODate(s.date)); return d >= 14 && d < 28; });
  const tonnageB = totalTonnage(windowB, bodyWeightLogs);
  if (tonnageB === 0) return { stagnant: false, pctChange: null }; // pas assez d'historique pour comparer
  const tonnageA = totalTonnage(windowA, bodyWeightLogs);
  const pctChange = Math.round(((tonnageA - tonnageB) / tonnageB) * 1000) / 10;
  return { stagnant: Math.abs(pctChange) <= 2, pctChange };
}

// ---------------------------------------------------------------------------------------
// Alignement 5/3/1 : toutes les semaines 5/3/1 sont toujours synchronisées (voir 531.ts /
// WorkoutTab.tsx), donc le premier exercice 5/3/1 trouvé reflète l'état partagé.
// ---------------------------------------------------------------------------------------

export function getFiveThreeOneCurrentWeek(workoutTypes: WorkoutType[]): number | null {
  for (const t of workoutTypes) {
    for (const ex of t.exercises) {
      if (ex.method?.type === '531') return ex.method.currentWeek;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// Évaluation globale des critères + construction des raisons affichées.
// ---------------------------------------------------------------------------------------

export interface DeloadCriteria {
  time: boolean;
  timeWeeks: number;
  fatigueAvg: boolean;
  fatigueAvgValue: number | null;
  fatigueConsecutive: boolean;
  stagnation: boolean;
  anyTrue: boolean;
  reasons: string[];
}

export function evaluateDeloadCriteria(data: AppData, now: Date = new Date()): DeloadCriteria {
  const timeWeeks = getConsecutiveTrainingWeeks(data.sessions, data.deload?.lastDeloadCompletedAt);
  const time = timeWeeks >= 4;
  const fatigue = getFatigueCriterion(data.sessions, now);
  const stagnation = getTonnageStagnationCriterion(data.sessions, data.bodyWeightLogs, now);
  const fatigueWindowWeeks = FATIGUE_WINDOW_DAYS / 7;

  const reasons: string[] = [];
  if (time) reasons.push(`${timeWeeks} semaines d'entraînement consécutives`);
  if (fatigue.avgTrue) {
    reasons.push(`Moyenne RPE des ${fatigueWindowWeeks} dernières semaines : ${fatigue.avgValue!.toFixed(1).replace('.', ',')}`);
  }
  if (fatigue.consecutiveTrue) reasons.push('3 dernières séances très intenses (RPE ≥ 8,5)');
  if (stagnation.stagnant && stagnation.pctChange !== null) {
    const signed = `${stagnation.pctChange >= 0 ? '+' : ''}${stagnation.pctChange.toFixed(1).replace('.', ',')}%`;
    reasons.push(`Progression ralentie : tonnage quasi stable sur 2 semaines (${signed})`);
  }

  return {
    time, timeWeeks,
    fatigueAvg: fatigue.avgTrue, fatigueAvgValue: fatigue.avgValue,
    fatigueConsecutive: fatigue.consecutiveTrue,
    stagnation: stagnation.stagnant,
    anyTrue: time || fatigue.avgTrue || fatigue.consecutiveTrue || stagnation.stagnant,
    reasons,
  };
}

// Fatigue/stagnation are current, urgent signals — always shown immediately. The time
// criterion alone is preventive, so it's preferably held back to land on the 5/3/1
// program's own deload week (week 4) when one is running and not yet there — but never
// held back indefinitely: past 5 weeks since the last deload it fires regardless.
export function shouldShowDeloadRecommendation(data: AppData, now: Date = new Date()): { show: boolean; criteria: DeloadCriteria } {
  const criteria = evaluateDeloadCriteria(data, now);
  if (getActiveDeload(data, now)) return { show: false, criteria };
  if (data.deload?.dismissedUntil && toISODate(now) < data.deload.dismissedUntil) return { show: false, criteria };
  if (!criteria.anyTrue) return { show: false, criteria };
  if (criteria.fatigueAvg || criteria.fatigueConsecutive || criteria.stagnation) return { show: true, criteria };

  const week531 = getFiveThreeOneCurrentWeek(data.workoutTypes);
  if (week531 !== null && week531 !== 4 && criteria.timeWeeks < 5) {
    return { show: false, criteria };
  }
  return { show: true, criteria };
}

// ---------------------------------------------------------------------------------------
// Réduction des charges / séries appliquée aux exercices normaux, Cluster et EMOM.
// Le 5/3/1 n'utilise jamais ceci : il est forcé directement en semaine 4 (son propre
// mécanisme de deload), voir buildDeloadAcceptPatch.
// ---------------------------------------------------------------------------------------

const CHARGE_REDUCTION: Record<DeloadIntensity, { charges: number; both: number }> = {
  light: { charges: 0.08, both: 0.05 },
  medium: { charges: 0.12, both: 0.08 },
};

export function getDeloadChargeFraction(type: DeloadType, intensity: DeloadIntensity): number {
  if (type === 'volume') return 0;
  return CHARGE_REDUCTION[intensity][type === 'both' ? 'both' : 'charges'];
}

// Rounds while preserving sign — roundWeightSmart clamps negatives to 0, which would
// silently erase assistance (band/machine) on assisted tractions/dips.
function roundSigned(value: number): number {
  if (value === 0) return 0;
  return Math.sign(value) * roundWeightSmart(Math.abs(value));
}

// Reduces "how hard this is" by `fraction`, not the raw number — for an assisted rep
// (negative weight = assistance subtracted from bodyweight), lightening the exercise
// means MORE assistance (more negative), not multiplying a negative number towards zero.
export function applyDeloadToWeight(weight: number, type: DeloadType, intensity: DeloadIntensity): number {
  const fraction = getDeloadChargeFraction(type, intensity);
  if (fraction === 0 || weight === 0) return weight;
  return roundSigned(weight - Math.abs(weight) * fraction);
}

export function applyDeloadToTrainingMax(trainingMax: number, type: DeloadType, intensity: DeloadIntensity): number {
  const fraction = getDeloadChargeFraction(type, intensity);
  if (fraction === 0) return trainingMax;
  return roundWeightSmart(trainingMax * (1 - fraction));
}

export function shouldReduceSets(type: DeloadType): boolean {
  return type === 'volume' || type === 'both';
}

// 1 set is never worth cutting further; beyond 6 (not really used in this app) the ~40%/
// ~17% ratio of the last tabulated step is applied and rounded, floor 1.
const SET_REDUCTION_TABLE: Record<DeloadIntensity, number[]> = {
  // index = original set count (0 unused)
  light: [0, 1, 2, 2, 3, 4, 5],
  medium: [0, 1, 1, 2, 2, 3, 4],
};

export function getDeloadSetCount(originalSets: number, intensity: DeloadIntensity): number {
  if (originalSets <= 0) return originalSets;
  const table = SET_REDUCTION_TABLE[intensity];
  if (originalSets < table.length) return table[originalSets];
  const ratio = table[6] / 6;
  return Math.max(1, Math.round(originalSets * ratio));
}

// ---------------------------------------------------------------------------------------
// Transitions d'état : accepter / ignorer / consommer une séance.
// ---------------------------------------------------------------------------------------

// Which workout types a deload applies to: exactly what's shown in the Séance picker for
// the active program right now (mirrors WorkoutTab's `activeTypes` filter).
export function getDeloadTargetWorkoutTypes(data: AppData): WorkoutType[] {
  const activeProgramId = data.activeProgramId ?? null;
  return data.workoutTypes.filter(t =>
    !t.hidden && (!activeProgramId || !t.programId || t.programId === activeProgramId)
  );
}

// A 5/3/1 exercise's own week/cycle is NEVER mutated just because a deload gets accepted or
// activated — only while a deload is genuinely active and pending for its workout type does
// it get read as week 4 (see the live "effective week" resolution in WorkoutTab, mirroring
// how cluster/EMOM/normal get their charge/volume cut live rather than persisted). The actual
// currentWeek/deloadResumeWeek transition is only committed once a session covering that
// exercise is actually logged while the deload is active (see computeNextFiveThreeOneWeekState
// usage in WorkoutTab's handleSummaryComplete) — so a deload window she never trains 531
// during leaves its week completely untouched, instead of getting stuck on week 4 forever.
export function buildDeloadAcceptPatch(
  data: AppData,
  type: DeloadType,
  intensity: DeloadIntensity,
  now: Date = new Date()
): { deload: DeloadState } {
  const pendingWorkoutTypeIds = getDeloadTargetWorkoutTypes(data).map(t => t.id);

  return {
    deload: {
      ...data.deload,
      active: { type, intensity, pendingWorkoutTypeIds, acceptedAt: toISODate(now) },
    },
  };
}

export function buildDeloadDismissPatch(data: AppData, now: Date = new Date()): DeloadState {
  const dismissedUntil = new Date(now.getTime() + 7 * DAY_MS);
  return { ...data.deload, dismissedUntil: toISODate(dismissedUntil) };
}

// "Sans deload" — she kept training through the recommendation instead of actually taking
// a lighter week (felt fine) — resets the clock (lastDeloadCompletedAt) exactly like a real
// deload would, so the "X semaines consécutives" criterion restarts from today, but touches
// no weights/sets/5-3-1 week: the next session is unaffected. Distinct from "Ignorer"
// (buildDeloadDismissPatch above), which only snoozes the banner for 7 days without
// resetting the streak, so the recommendation reappears with the same (or a bigger) week
// count once the snooze expires.
export function buildDeloadSkipPatch(data: AppData, now: Date = new Date()): DeloadState {
  return { ...data.deload, active: undefined, dismissedUntil: undefined, lastDeloadCompletedAt: toISODate(now) };
}

// Manual activation (Réglages, "Activer un deload") : runs for a fixed number of days
// instead of "once per workout type" — every session logged through expiresAt (inclusive)
// counts as deload, whichever workout type it is.
export function buildManualDeloadPatch(
  data: AppData,
  type: DeloadType,
  intensity: DeloadIntensity,
  days: number,
  now: Date = new Date()
): { deload: DeloadState } {
  const pendingWorkoutTypeIds = getDeloadTargetWorkoutTypes(data).map(t => t.id);
  const expiresAt = toISODate(new Date(now.getTime() + Math.max(1, days) * DAY_MS - DAY_MS));

  return {
    deload: {
      ...data.deload,
      active: { type, intensity, pendingWorkoutTypeIds, acceptedAt: toISODate(now), expiresAt },
    },
  };
}

// Ends a manually-activated deload immediately (Réglages, "Désactiver") — unlike "Ignorer"
// on the recommendation banner (buildDeloadDismissPatch), this clears an already-active
// deload rather than snoozing a not-yet-accepted recommendation, and doesn't stamp
// lastDeloadCompletedAt since it wasn't actually carried through.
export function buildDeloadDeactivatePatch(data: AppData): DeloadState {
  return { ...data.deload, active: undefined };
}

// A manual (expiresAt-bound) deload is only "active" through its last day — read through
// this everywhere UI/session-building needs to know "is a deload in effect right now",
// instead of data.deload?.active directly, so an expired manual deload silently stops
// applying/showing badges without needing a session save to notice (consumeDeloadOnSessionSave
// only runs when a session is actually logged).
export function getActiveDeload(data: AppData, now: Date = new Date()): DeloadState['active'] | undefined {
  const active = data.deload?.active;
  if (!active) return undefined;
  if (active.expiresAt && toISODate(now) > active.expiresAt) return undefined;
  return active;
}

// Called right after a session is saved. Two modes:
// - Recommendation-accept (no expiresAt): shrinks the pending list, and once every type has
//   been done once, clears the deload and stamps lastDeloadCompletedAt.
// - Manual (expiresAt set): stays active for every session in the date window regardless of
//   workout type — not consumed type-by-type — and is cleared (with lastDeloadCompletedAt
//   stamped) once a session lands after expiresAt.
export function consumeDeloadOnSessionSave(
  data: AppData,
  workoutTypeId: string,
  now: Date = new Date()
): { deload: DeloadState | undefined; wasDeload: boolean } {
  const active = data.deload?.active;
  if (!active || !active.pendingWorkoutTypeIds.includes(workoutTypeId)) {
    return { deload: data.deload, wasDeload: false };
  }

  if (active.expiresAt) {
    if (toISODate(now) > active.expiresAt) {
      return { deload: { ...data.deload, active: undefined, lastDeloadCompletedAt: toISODate(now) }, wasDeload: false };
    }
    return { deload: data.deload, wasDeload: true };
  }

  const remaining = active.pendingWorkoutTypeIds.filter(id => id !== workoutTypeId);
  if (remaining.length === 0) {
    return { deload: { ...data.deload, active: undefined, lastDeloadCompletedAt: toISODate(now) }, wasDeload: true };
  }
  return { deload: { ...data.deload, active: { ...active, pendingWorkoutTypeIds: remaining } }, wasDeload: true };
}
