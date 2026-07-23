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
    },
  };

  const workoutTypes = cleaned.workoutTypes.map((t, i) =>
    i === typeIndex ? { ...t, exercises: [migratedExercise, ...t.exercises] } : t
  );

  return { ...cleaned, workoutTypes };
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APP_DATA };
    const parsed = { ...DEFAULT_APP_DATA, ...JSON.parse(raw) };
    return migrateLegacyFiveThreeOne(parsed);
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
