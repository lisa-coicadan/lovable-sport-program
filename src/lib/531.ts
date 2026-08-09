import { roundWeightSmart } from './weightRounding';

export interface FiveThreeOneSet {
  percentage: number;
  reps: string;
  weight: number;
}

const WEEK_SCHEMES: { percentage: number; reps: string }[][] = [
  // Week 1: 5s
  [
    { percentage: 0.65, reps: '5' },
    { percentage: 0.75, reps: '5' },
    { percentage: 0.85, reps: '5+' },
  ],
  // Week 2: 3s
  [
    { percentage: 0.70, reps: '3' },
    { percentage: 0.80, reps: '3' },
    { percentage: 0.90, reps: '3+' },
  ],
  // Week 3: 5/3/1
  [
    { percentage: 0.75, reps: '5' },
    { percentage: 0.85, reps: '3' },
    { percentage: 0.95, reps: '1+' },
  ],
  // Week 4: Deload
  [
    { percentage: 0.40, reps: '5' },
    { percentage: 0.50, reps: '5' },
    { percentage: 0.60, reps: '5' },
  ],
];

export function getWeekSets(trainingMax: number, week: number): FiveThreeOneSet[] {
  const scheme = WEEK_SCHEMES[week - 1] || WEEK_SCHEMES[0];
  return scheme.map(s => ({
    ...s,
    weight: roundWeightSmart(trainingMax * s.percentage),
  }));
}

export function getWeekLabel(week: number): string {
  const labels = ['Semaine 1 — 5 reps', 'Semaine 2 — 3 reps', 'Semaine 3 — 5/3/1', 'Semaine 4 — Deload'];
  return labels[week - 1] || labels[0];
}

export interface FiveThreeOneWeekState {
  currentWeek: number;
  currentCycle: number;
  deloadResumeWeek?: number;
  skipNextDeload?: boolean;
}

export interface FiveThreeOneWeekAdvance extends FiveThreeOneWeekState {
  // True when this advance represents a natural (or skip-forced) cycle end — the caller
  // uses this to decide whether to bump each exercise's own Training Max, since TM stays
  // per-exercise even though the week/cycle itself is kept in sync across every 5/3/1
  // exercise (see applySyncedFiveThreeOneAdvance in WorkoutTab.tsx / SettingsPanel.tsx).
  cycleAdvanced: boolean;
}

// Computes the next week/cycle after completing a session for ONE 5/3/1 exercise —
// callers are responsible for applying the result to every 5/3/1 exercise app-wide, since
// their weeks must always stay synchronized (never let two 5/3/1 lifts drift onto
// different weeks).
export function computeNextFiveThreeOneWeekState(m: FiveThreeOneWeekState): FiveThreeOneWeekAdvance {
  if (m.deloadResumeWeek) {
    // Just completed a forced (off-cycle) deload week — resume where we left off instead
    // of treating it as a cycle-end, and remember to skip the next natural deload so two
    // deloads don't land close together.
    return { currentWeek: m.deloadResumeWeek, currentCycle: m.currentCycle, skipNextDeload: true, cycleAdvanced: false };
  }
  if (m.currentWeek === 3 && m.skipNextDeload) {
    // The next natural deload (week 4) is being skipped — jump straight into a new cycle,
    // as if week 4 had been completed.
    return { currentWeek: 1, currentCycle: m.currentCycle + 1, skipNextDeload: false, cycleAdvanced: true };
  }
  if (m.currentWeek < 4) {
    // skipNextDeload (if set while not yet at week 3) must carry through untouched —
    // otherwise it'd be silently dropped before it ever gets to fire.
    return { currentWeek: m.currentWeek + 1, currentCycle: m.currentCycle, skipNextDeload: m.skipNextDeload, cycleAdvanced: false };
  }
  return { currentWeek: 1, currentCycle: m.currentCycle + 1, cycleAdvanced: true };
}

