export interface FiveThreeOneMethod {
  type: '531';
  trainingMax: number;
  currentCycle: number;
  currentWeek: number; // 1-4
  increment?: number; // kg added to the TM at the end of each 4-week cycle (default 2.5)
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
}

export interface SessionLog {
  id: string;
  date: string; // YYYY-MM-DD
  workoutTypeId: string;
  workoutTypeName: string;
  sets: SetLog[];
  startTime: number;
  endTime?: number;
  duration?: number; // minutes
  difficulty?: number; // 1-10
  notes?: string;
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

export interface AppData {
  workoutTypes: WorkoutType[];
  sessions: SessionLog[];
  weeklyGoal: number;
  setupComplete: boolean;
  restDuration: number; // seconds
  bodyWeightLogs: BodyWeightLog[];
  programs?: Program[]; // multi-program support; migrated on load if absent
  activeProgramId?: string | null;
  // @deprecated legacy fields — migrated into a per-exercise `method` on load (see
  // src/lib/storage.ts). New AppData never sets these; only present on old stored JSON.
  fiveThreeOne?: FiveThreeOneConfig;
  squatSessionId?: string | null;
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
};

export function calculate1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}
