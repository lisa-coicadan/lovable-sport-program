export interface Exercise {
  id: string;
  name: string;
  sets: number;
  reps: number;
  weight?: number;
}

export interface WorkoutType {
  id: string;
  name: string;
  color: string;
  exercises: Exercise[];
}

export interface SetLog {
  exerciseId: string;
  exerciseName: string;
  setNumber: number;
  reps: number;
  weight: number;
  completed: boolean;
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
  difficulty?: number; // 1-5
  notes?: string;
}

export interface FiveThreeOneConfig {
  trainingMax: number;
  currentCycle: number;
  currentWeek: number; // 1-4
  startDate: string;
}

export interface AppData {
  workoutTypes: WorkoutType[];
  sessions: SessionLog[];
  fiveThreeOne: FiveThreeOneConfig;
  squatSessionId: string;
  weeklyGoal: number;
  setupComplete: boolean;
}

export const WORKOUT_COLORS = [
  '84 81% 44%',   // lime green
  '199 89% 48%',  // blue
  '330 81% 60%',  // pink
  '38 92% 50%',   // orange
];

export const DEFAULT_APP_DATA: AppData = {
  workoutTypes: [],
  sessions: [],
  fiveThreeOne: {
    trainingMax: 100,
    currentCycle: 1,
    currentWeek: 1,
    startDate: new Date().toISOString().split('T')[0],
  },
  weeklyGoal: 4,
  setupComplete: false,
};
