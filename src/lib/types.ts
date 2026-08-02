export interface FiveThreeOneMethod {
  type: '531';
  trainingMax: number;
  currentCycle: number;
  currentWeek: number; // 1-4
  increment?: number; // kg added to the TM at the end of each 4-week cycle (default 2.5)
  // Set when a deload recommendation forces this exercise straight to week 4 out of its
  // normal order (see src/lib/deload.ts) — remembers which week to resume once that
  // forced week is completed, instead of treating it as a natural cycle-end (which would
  // wrongly advance the cycle and bump the Training Max). Cleared once consumed.
  deloadResumeWeek?: number;
  // Set after resuming from a forced deload: the next NATURAL week 4 is skipped (jumps
  // straight into a new cycle instead) so two deloads don't land within the same stretch.
  // Cleared once consumed.
  skipNextDeload?: boolean;
}

// One mini-series within a cluster series: its own rep count and its own %TM,
// so wave-loading / pyramid schemes (varying reps and intensity per mini-series)
// are representable, not just a flat uniform scheme.
export interface ClusterMiniSeries {
  reps: number;
  percentage: number; // fraction of TM, e.g. 0.85
}

// Defaults (4 series x [2,2,2 reps @ 90%], 20s/3min rest) live in src/lib/cluster.ts
// and apply whenever a field below is missing — keeps old saved data (TM-only) working.
// `parametrizeAtSession` = true : no default pattern persisted, all params live in-session.
export interface ClusterMethod {
  type: 'cluster';
  trainingMax: number;
  numSeries?: number;
  miniSeries?: ClusterMiniSeries[]; // structure of one series, repeated numSeries times
  restMiniSeries?: number; // seconds, between mini-series within a series
  restSeries?: number; // seconds, between series
  parametrizeAtSession?: boolean;
}

// Defaults (10min, 2 reps/min, %TM from a duration/reps formula) live in src/lib/emom.ts
// and apply whenever a field below is missing — keeps old saved data (TM-only) working.
export interface EMOMMethod {
  type: 'emom';
  trainingMax: number;
  durationMinutes?: number;
  repsPerMinute?: number;
  percentage?: number; // fraction of TM
  parametrizeAtSession?: boolean;
}

export type ExerciseMethod = FiveThreeOneMethod | ClusterMethod | EMOMMethod;

export type ExerciseEquipment = 'barre' | 'halteres' | 'machine' | 'smith' | 'poulie';

export const EQUIPMENT_LABELS: Record<ExerciseEquipment, string> = {
  barre: 'Barre',
  halteres: 'Haltères',
  machine: 'Machine',
  smith: 'Smith',
  poulie: 'Poulie',
};

// Drop set: not a standing "method" like 531/Cluster/EMOM (those generate every set
// upfront from a Training Max) — a drop set instead cascades live, in-session, below
// whichever regular set she's actually doing, computed from ITS actual weight/reps.
// Presence of this field on an Exercise only pre-configures the step%/step-reps used
// and auto-adds the first cascade at session start; the "+ Drop set" button itself is
// always available on any regular exercise card regardless (see dropset.ts).
export interface DropSetConfig {
  stepPercentage?: number; // fraction of the base weight shed per stage, default 0.15
  stepReps?: number; // reps shed per stage (from the base reps), default 2
}

// Only meaningful for the 5 standard barbell/bodyweight lifts (see StandardMovement in
// strengthStandards.ts) — gates the "1RM ?" live-session button and the TrueOneRepMax
// tracking in ExerciseHistory. Undefined/'hypertrophie' keeps today's behavior (estimated
// 1RM only, no extra UI) — 'force' is an opt-in per exercise, not a global setting.
export type TrainingFocus = 'force' | 'hypertrophie';

export interface Exercise {
  id: string;
  name: string;
  sets: number;
  reps: number;
  weight?: number;
  supersetGroupId?: string; // shared id between the 2 partners
  supersetRole?: 'A' | 'B';
  method?: ExerciseMethod; // optional per-exercise training method (5/3/1, later cluster/EMOM)
  unilateral?: boolean; // display-only attribute (execution mode)
  equipment?: ExerciseEquipment; // display-only attribute (equipment tag)
  trainingFocus?: TrainingFocus;
  dropSet?: DropSetConfig;
  // "As many reps as possible" — configured ahead of time in Réglages (like dropSet),
  // not toggled mid-set: every set built for this exercise starts with no pre-filled
  // target, she logs whatever she actually got.
  amrap?: boolean;
  // Free-text reminder left during a session (via the lightbulb button in WorkoutTab),
  // surfaced as a banner above this exercise's card next time it's trained. Cleared
  // manually (dismiss button on the banner), not auto-cleared after being shown once.
  reminderNote?: string;
}

export interface WorkoutType {
  id: string;
  name: string;
  color: string;
  exercises: Exercise[];
  hidden?: boolean;
  programId?: string; // multi-program grouping; migrated on load if absent
}

// A training program groups workout types together so switching program shows only
// its own list of sessions. Sessions (history) are never filtered by program — they
// stay visible across programs so the history is always intact.
export interface Program {
  id: string;
  name: string;
}

export interface SetLog {
  exerciseId: string;
  exerciseName: string;
  setNumber: number;
  reps: number;
  weight: number;
  completed: boolean;
  supersetGroupId?: string;
  supersetRole?: 'A' | 'B';
  dropSetStage?: number; // 1, 2, ... — present only on auto-generated drop-set rows, cascading below their anchor set
  amrap?: boolean; // "as many reps as possible" — no pre-filled target, she logs whatever she actually got
  // Fields below are only ever set by the "Tester un 1RM" ramp (see src/lib/oneRepMaxTest.ts)
  // — a dedicated PR-testing flow, distinct from the normal per-exercise RPE
  // (SessionLog.exerciseDifficulty) which is a single session-wide value per exercise, not
  // per set. Absent on every other set in the app.
  rpe?: number; // 1-10, self-reported effort on THIS ramp stage specifically
  failed?: boolean; // explicit miss on a max attempt — distinct from `completed` (not done yet)
  // Marks a set as belonging to a 1RM-test ramp rather than the exercise's normal
  // prescribed sets — excluded from the shared 5/3/1 week/cycle advance in WorkoutTab's
  // handleSummaryComplete, so testing a max on one exercise never desyncs its week/cycle
  // from every other 5/3/1 exercise (which stay in lockstep, see computeNextFiveThreeOneWeekState).
  isTestMax?: boolean;
}

export interface SessionLog {
  id: string;
  date: string; // YYYY-MM-DD
  workoutTypeId: string;
  workoutTypeName: string;
  programId?: string;
  programName?: string; // snapshot at log time, mirrors workoutTypeName's pattern
  sets: SetLog[];
  startTime: number;
  endTime?: number;
  duration?: number; // minutes
  difficulty?: number; // 1-10, overall session feel (filled in the end-of-session recap)
  // Per-exercise RPE (1-10), filled live during the session (WorkoutTab), keyed by
  // exerciseId — distinct from `difficulty` above, which is a single session-wide value.
  // Optional/sparse: only exercises she actually rated are present.
  exerciseDifficulty?: Record<string, number>;
  notes?: string;
  // Set at save time when this session's workoutTypeId was still pending in an active
  // deload (see src/lib/deload.ts) — surfaces the orange "Deload" highlight in Calendrier
  // for this specific day, independently of whatever deload state is active *now*.
  isDeload?: boolean;
}

// @deprecated legacy global 5/3/1 config, replaced by Exercise.method. Kept only so
// storage.ts can migrate old data on load — nothing else reads this anymore.
export interface FiveThreeOneConfig {
  trainingMax: number;
  currentCycle: number;
  currentWeek: number; // 1-4
  startDate: string;
}

export interface BodyWeightLog {
  date: string;
  weight: number;
}

// Cardio/endurance activities (course, natation, ...) don't fit the sets×reps model at
// all, so they're logged as their own kind of entry rather than shoehorned into
// SessionLog/Exercise — a simple after-the-fact log, not an interactive in-session
// tracker like WorkoutTab. Distance is optional (some sessions are duration-only, e.g.
// swimming without a tracked distance); pace is derived at display time, never stored.
export type CardioActivityType = 'Course à pied' | 'Natation' | 'Vélo' | 'Autre';

export interface CardioSession {
  id: string;
  date: string; // YYYY-MM-DD
  activityType: CardioActivityType;
  customActivityLabel?: string; // only when activityType === 'Autre'
  durationMinutes: number;
  distanceKm?: number;
  difficulty?: number; // RPE /10, same scale as SessionLog.difficulty
  notes?: string;
}

// A session picked ahead of time on a future calendar day, purely for visibility — no
// sets/weights, just a marker. Auto-removed the day after its date passes regardless of
// whether it was actually done (see pruneExpiredPlannedSessions in storage.ts), and removed
// immediately once the matching session is logged (see WorkoutTab's handleSummaryComplete).
export interface PlannedSession {
  id: string;
  date: string; // YYYY-MM-DD, always a future date at creation time
  workoutTypeId: string;
}

// A tested (not estimated) 1RM — a single rep actually performed at RPE 9-10, either
// confirmed live from a logged set (see the "1RM ?" button in WorkoutTab) or entered
// manually from ExerciseHistory. Kept as its own timestamped history (not a single current
// value) so it can be tracked alongside the estimated 1RM over time. `weight` is the
// effective absolute load at that rep (bodyweight-adjusted for tractions/dips lestés — see
// computeEffectiveLoadAtOneRep in tonnage.ts), never a delta.
export interface TrueOneRepMax {
  id: string;
  date: string; // YYYY-MM-DD
  exerciseName: string; // the base movement name, e.g. 'Squat', 'Tractions lestées'
  weight: number;
}

export type Gender = 'F' | 'H';

// Deload week recommendation (see src/lib/deload.ts for the detection/application logic).
// Tracked globally (not per-program): one recommendation/active deload at a time.
export type DeloadType = 'charges' | 'volume' | 'both';
export type DeloadIntensity = 'light' | 'medium';

export interface DeloadState {
  // Present while a deload is in progress: the workout types it applies to haven't all
  // been completed once yet. Cleared automatically (and lastDeloadCompletedAt stamped)
  // once pendingWorkoutTypeIds empties out — no user action needed.
  active?: {
    type: DeloadType;
    intensity: DeloadIntensity;
    pendingWorkoutTypeIds: string[]; // snapshot of activeTypes ids at acceptance; shrinks as each is completed once
    acceptedAt: string; // ISO date
    // Set only for a manually-activated deload (Réglages, "Activer un deload") that runs
    // for a fixed number of days rather than "once per workout type" — while set, every
    // session up to and including this date counts as deload regardless of
    // pendingWorkoutTypeIds, and the deload auto-expires the day after (see getActiveDeload/
    // consumeDeloadOnSessionSave in deload.ts) instead of being consumed type-by-type.
    expiresAt?: string; // ISO date, inclusive
  };
  lastDeloadCompletedAt?: string; // ISO date — anchors the "4 weeks since last deload" criterion
  dismissedUntil?: string; // ISO date — set by "Ignorer", snoozes the banner for 7 days
}

export interface AppData {
  workoutTypes: WorkoutType[];
  sessions: SessionLog[];
  weeklyGoal: number;
  setupComplete: boolean;
  restDuration: number; // seconds
  bodyWeightLogs: BodyWeightLog[];
  programs?: Program[]; // multi-program support; migrated on load if absent
  activeProgramId?: string | null;
  // Optional profile used only for the "Record de France" / niveau-percentile comparison
  // (src/lib/strengthStandards.ts) — genuinely optional, no default/migration needed since
  // every reader already guards on their presence.
  gender?: Gender;
  // Separate from workoutTypes/sessions on purpose — cardio isn't counted in
  // `weeklyGoal`/`sessions`'s strength stats, it has its own goal + tracking.
  cardioSessions?: CardioSession[];
  cardioWeeklyGoal?: number;
  // Sessions picked ahead of time on a future calendar day, for visibility only — see
  // PlannedSession above.
  plannedSessions?: PlannedSession[];
  // Tested 1RM history for the 5 standard lifts — see TrueOneRepMax above.
  trueOneRepMaxes?: TrueOneRepMax[];
  // @deprecated legacy fields — migrated into a per-exercise `method` on load (see
  // src/lib/storage.ts). New AppData never sets these; only present on old stored JSON.
  fiveThreeOne?: FiveThreeOneConfig;
  squatSessionId?: string | null;
  // One-time migration marker: RPE moved from a 1-5 scale to 1-10 (see migrateRpeScale
  // in src/lib/storage.ts). A doubled value is indistinguishable in shape from one
  // already on /10, so this flag is the only way to make the migration idempotent.
  rpeScaleV2?: boolean;
  deload?: DeloadState;
}

export const WORKOUT_COLORS = [
  '189 94% 55%',  // cyan-turquoise (= --accent-blue / --ring)
  '262 83% 66%',  // violet (= --accent-purple)
  '322 100% 60%', // magenta (= --primary)
  '38 92% 52%',   // amber (= --warning)
  '231 90% 65%',  // indigo
  '174 88% 50%',  // teal
  '356 88% 58%',  // red (= --destructive)
  '54 95% 58%',   // yellow
];

export const DEFAULT_APP_DATA: AppData = {
  workoutTypes: [],
  sessions: [],
  weeklyGoal: 4,
  setupComplete: false,
  restDuration: 90,
  bodyWeightLogs: [],
  programs: [],
  activeProgramId: null,
  cardioSessions: [],
  cardioWeeklyGoal: 2,
  plannedSessions: [],
  trueOneRepMaxes: [],
};

// `SessionLog.programName` is a snapshot frozen at log time (survives a deleted/renamed
// workoutType). But day to day, she wants Stats/Calendar/session badges to reflect
// wherever that workout type is assigned RIGHT NOW — reassigning or renaming a program
// should immediately show up on old sessions too, not just new ones. Falls back to the
// frozen snapshot only when the live chain is broken (workoutType or program deleted).
export function resolveProgramName(
  session: { workoutTypeId: string; programName?: string },
  data: Pick<AppData, 'workoutTypes' | 'programs'>
): string | undefined {
  const workoutType = data.workoutTypes.find(t => t.id === session.workoutTypeId);
  if (workoutType?.programId) {
    const program = (data.programs || []).find(p => p.id === workoutType.programId);
    if (program) return program.name;
  }
  return session.programName;
}

export function calculate1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}
