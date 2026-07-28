import { AppData, DEFAULT_APP_DATA, Exercise } from './types';

const STORAGE_KEY = 'fitness-tracker-data';

// Migrates the legacy global 5/3/1 config (AppData.fiveThreeOne + squatSessionId) into a
// real per-exercise `method` on the matching workout type, preserving the user's actual
// TM/cycle/week progress. Idempotent — safe to run on every load.
function migrateLegacyFiveThreeOne(data: AppData): AppData {
  if (!data.squatSessionId || !data.fiveThreeOne) return data;

  const { fiveThreeOne, squatSessionId, ...rest } = data;
  const cleaned = rest as AppData;

  const typeIndex = cleaned.workoutTypes.findIndex(t => t.id === squatSessionId);
  if (typeIndex === -1) return cleaned;

  const alreadyMigrated = cleaned.workoutTypes[typeIndex].exercises.some(e => e.method?.type === '531');
  if (alreadyMigrated) return cleaned;

  const migratedExercise: Exercise = {
    id: '531-squat',
    name: '5/3/1 Squat',
    sets: 3,
    reps: 1,
    method: {
      type: '531',
      trainingMax: fiveThreeOne.trainingMax,
      currentCycle: fiveThreeOne.currentCycle,
      currentWeek: fiveThreeOne.currentWeek,
      increment: 2.5,
    },
  };

  const workoutTypes = cleaned.workoutTypes.map((t, i) =>
    i === typeIndex ? { ...t, exercises: [migratedExercise, ...t.exercises] } : t
  );

  return { ...cleaned, workoutTypes };
}

// If the loaded data doesn't have any program yet, create a default "Mon programme"
// that owns every existing workoutType, and mark it as active. Idempotent — a second
// pass with programs already present is a no-op beyond the orphan sweep below. Never
// touches sessions (history).
function migrateToPrograms(data: AppData): AppData {
  const hasPrograms = Array.isArray(data.programs) && data.programs.length > 0;
  if (hasPrograms) {
    // Ensure activeProgramId is valid; fallback to first program.
    const stillValid = data.activeProgramId && data.programs!.some(p => p.id === data.activeProgramId);
    const activeProgramId = stillValid ? data.activeProgramId! : data.programs![0].id;
    // Sweep any workoutType still missing a programId (bug, edge case, legacy data) onto
    // the active program — otherwise it would silently show up under every program instead
    // of belonging to exactly one (see WorkoutTab's `!t.programId` fallback in its filter).
    const workoutTypes = data.workoutTypes.map(t => t.programId ? t : { ...t, programId: activeProgramId });
    return { ...data, activeProgramId, workoutTypes };
  }
  if (!data.setupComplete && (!data.workoutTypes || data.workoutTypes.length === 0)) {
    // No prior program, no prior workouts — SetupWizard will create both.
    return { ...data, programs: [], activeProgramId: null };
  }
  const defaultProgram = { id: `p${Date.now()}`, name: 'Mon programme' };
  const workoutTypes = (data.workoutTypes || []).map(t => t.programId ? t : { ...t, programId: defaultProgram.id });
  return { ...data, programs: [defaultProgram], activeProgramId: defaultProgram.id, workoutTypes };
}

// Backfills a permanent snapshot of the program name onto each session, taken from the
// workout type it was logged under (workoutTypeId -> workoutType.programId -> program name).
// Best-effort for sessions logged before this field existed; every session logged from
// now on gets an accurate snapshot at creation time (see WorkoutTab.finishWorkout).
// Idempotent — never overwrites a session that already has a programName.
function migrateSessionProgramNames(data: AppData): AppData {
  if (!data.sessions.some(s => !s.programName)) return data;
  const programNameById = new Map((data.programs || []).map(p => [p.id, p.name]));
  const typeById = new Map(data.workoutTypes.map(t => [t.id, t]));
  const sessions = data.sessions.map(s => {
    if (s.programName) return s;
    const programId = typeById.get(s.workoutTypeId)?.programId;
    const programName = programId ? programNameById.get(programId) : undefined;
    return programId && programName ? { ...s, programId, programName } : s;
  });
  return { ...data, sessions };
}

// RPE moved from a 1-5 scale to 1-10 — doubles every already-logged value once so
// history keeps its relative meaning ("5/5 max effort" becomes "10/10 max effort").
// Guarded by rpeScaleV2 since a doubled value looks identical in shape to one already
// on /10 — without the flag, every load would double it again.
function migrateRpeScale(data: AppData): AppData {
  if (data.rpeScaleV2) return data;
  const sessions = data.sessions.map(s => s.difficulty ? { ...s, difficulty: s.difficulty * 2 } : s);
  const cardioSessions = (data.cardioSessions || []).map(s => s.difficulty ? { ...s, difficulty: s.difficulty * 2 } : s);
  return { ...data, sessions, cardioSessions, rpeScaleV2: true };
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APP_DATA };
    const parsed = { ...DEFAULT_APP_DATA, ...JSON.parse(raw) };
    return migrateRpeScale(migrateSessionProgramNames(migrateToPrograms(migrateLegacyFiveThreeOne(parsed))));
  } catch {
    return { ...DEFAULT_APP_DATA };
  }
}

export function saveData(data: AppData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function updateData(updater: (data: AppData) => AppData): AppData {
  const data = loadData();
  const updated = updater(data);
  saveData(updated);
  return updated;
}
