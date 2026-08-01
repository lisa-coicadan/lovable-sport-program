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

export interface FatigueCriterion {
  avgTrue: boolean;
  avgValue: number | null;
  consecutiveTrue: boolean;
}

export function getFatigueCriterion(sessions: SessionLog[], now: Date): FatigueCriterion {
  const rated = sessions.filter(s => s.difficulty !== undefined);

  const last14 = rated.filter(s => daysBetween(now, parseISODate(s.date)) < 14);
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
    return sum + s.sets.reduce((setSum, set) => setSum + computeSetTonnage(set, bw), 0);
  }, 0);
}

export function getTonnageStagnationCriterion(
  sessions: SessionLog[],
  bodyWeightLogs: AppData['bodyWeightLogs'],
  now: Date
): boolean {
  const windowA = sessions.filter(s => { const d = daysBetween(now, parseISODate(s.date)); return d >= 0 && d < 14; });
  const windowB = sessions.filter(s => { const d = daysBetween(now, parseISODate(s.date)); return d >= 14 && d < 28; });
  const tonnageB = totalTonnage(windowB, bodyWeightLogs);
  if (tonnageB === 0) return false; // pas assez d'historique pour comparer
  const tonnageA = totalTonnage(windowA, bodyWeightLogs);
  const pctChange = ((tonnageA - tonnageB) / tonnageB) * 100;
  return Math.abs(pctChange) <= 2;
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

  const reasons: string[] = [];
  if (time) reasons.push(`${timeWeeks} semaines d'entraînement consécutives`);
  if (fatigue.avgTrue) reasons.push(`Moyenne RPE : ${fatigue.avgValue!.toFixed(1).replace('.', ',')}`);
  if (fatigue.consecutiveTrue) reasons.push('3 dernières séances très intenses (RPE ≥ 8,5)');
  if (stagnation) reasons.push('Progression ralentie détectée');

  return {
    time, timeWeeks,
    fatigueAvg: fatigue.avgTrue, fatigueAvgValue: fatigue.avgValue,
    fatigueConsecutive: fatigue.consecutiveTrue,
    stagnation,
    anyTrue: time || fatigue.avgTrue || fatigue.consecutiveTrue || stagnation,
    reasons,
  };
}

// Fatigue/stagnation are current, urgent signals — always shown immediately. The time
// criterion alone is preventive, so it's preferably held back to land on the 5/3/1
// program's own deload week (week 4) when one is running and not yet there — but never
// held back indefinitely: past 5 weeks since the last deload it fires regardless.
export function shouldShowDeloadRecommendation(data: AppData, now: Date = new Date()): { show: boolean; criteria: DeloadCriteria } {
  const criteria = evaluateDeloadCriteria(data, now);
  if (data.deload?.active) return { show: false, criteria };
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

export function buildDeloadAcceptPatch(
  data: AppData,
  type: DeloadType,
  intensity: DeloadIntensity,
  now: Date = new Date()
): { workoutTypes: WorkoutType[]; deload: DeloadState } {
  const pendingWorkoutTypeIds = getDeloadTargetWorkoutTypes(data).map(t => t.id);

  // Force every 5/3/1 exercise straight to week 4 — their own deload week — regardless of
  // the Type/Intensity chosen above (that popup only governs normal/Cluster/EMOM
  // exercises). Already-synced exercises already at week 4 are left untouched (nothing to
  // resume afterwards).
  const workoutTypes = data.workoutTypes.map(t => ({
    ...t,
    exercises: t.exercises.map(ex => {
      if (ex.method?.type !== '531' || ex.method.currentWeek === 4) return ex;
      return { ...ex, method: { ...ex.method, currentWeek: 4, deloadResumeWeek: ex.method.currentWeek } };
    }),
  }));

  return {
    workoutTypes,
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

// Called right after a session is saved: shrinks the pending list if that workout type was
// still due, and once every type has been done once, clears the deload automatically and
// stamps lastDeloadCompletedAt (restarting the "4 weeks" criterion) — no user action needed.
export function consumeDeloadOnSessionSave(
  data: AppData,
  workoutTypeId: string,
  now: Date = new Date()
): { deload: DeloadState | undefined; wasDeload: boolean } {
  const active = data.deload?.active;
  if (!active || !active.pendingWorkoutTypeIds.includes(workoutTypeId)) {
    return { deload: data.deload, wasDeload: false };
  }
  const remaining = active.pendingWorkoutTypeIds.filter(id => id !== workoutTypeId);
  if (remaining.length === 0) {
    return { deload: { ...data.deload, active: undefined, lastDeloadCompletedAt: toISODate(now) }, wasDeload: true };
  }
  return { deload: { ...data.deload, active: { ...active, pendingWorkoutTypeIds: remaining } }, wasDeload: true };
}
