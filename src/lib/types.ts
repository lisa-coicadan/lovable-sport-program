export interface Exercise {
  id: string;
  name: string;
  sets: number;
  reps: number;
  weight?: number;
  supersetGroupId?: string; // shared id between the 2 partners
  supersetRole?: 'A' | 'B';
}

export interface WorkoutType {
  id: string;
  name: string;
  color: string;
  exercises: Exercise[];
  hidden?: boolean;
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
  fiveThreeOne: FiveThreeOneConfig;
  squatSessionId: string;
  weeklyGoal: number;
  setupComplete: boolean;
  restDuration: number; // seconds
  bodyWeightLogs: BodyWeightLog[];
}

export const WORKOUT_COLORS = [
  '84 81% 44%',   // lime green
  '199 89% 48%',  // blue
  '330 81% 60%',  // pink
  '38 92% 50%',   // orange
  '262 83% 58%',  // purple
  '174 72% 46%',  // teal
  '0 72% 51%',    // red
  '45 93% 47%',   // yellow
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
  squatSessionId: '3',
  weeklyGoal: 4,
  setupComplete: false,
  restDuration: 90,
  bodyWeightLogs: [],
};

export function calculate1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}
