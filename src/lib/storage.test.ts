import { describe, it, expect, beforeEach } from 'vitest';
import { loadData, saveData } from './storage';
import { AppData } from './types';

const STORAGE_KEY = 'fitness-tracker-data';

describe('loadData — legacy 5/3/1 migration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns defaults on a fresh install (no stored data)', () => {
    const data = loadData();
    expect(data.workoutTypes).toEqual([]);
    expect(data.squatSessionId).toBeUndefined();
    expect(data.fiveThreeOne).toBeUndefined();
  });

  it('migrates a legacy global 5/3/1 config into a real exercise, preserving TM/cycle/week', () => {
    const legacy = {
      workoutTypes: [
        { id: '3', name: 'jambes (squat)', color: '330 81% 60%', exercises: [{ id: 'e1', name: 'RDL barre', sets: 3, reps: 8 }] },
      ],
      sessions: [],
      fiveThreeOne: { trainingMax: 90, currentCycle: 2, currentWeek: 3, startDate: '2026-03-08' },
      squatSessionId: '3',
      weeklyGoal: 4,
      setupComplete: true,
      restDuration: 90,
      bodyWeightLogs: [],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

    const data = loadData();

    expect(data.squatSessionId).toBeUndefined();
    expect(data.fiveThreeOne).toBeUndefined();

    const type = data.workoutTypes.find(t => t.id === '3')!;
    const migrated = type.exercises.find(e => e.method?.type === '531');
    expect(migrated).toBeDefined();
    expect(migrated!.method).toEqual({ type: '531', trainingMax: 90, currentCycle: 2, currentWeek: 3, increment: 2.5 });
    expect(migrated!.name).toBe('5/3/1 Squat');

    // The pre-existing exercise in that session must be untouched
    expect(type.exercises.find(e => e.id === 'e1')).toMatchObject({ name: 'RDL barre', sets: 3, reps: 8 });
  });

  it('is idempotent — does not duplicate the migrated exercise on a second load', () => {
    const legacy = {
      workoutTypes: [{ id: '3', name: 'Legs', color: '330 81% 60%', exercises: [] }],
      sessions: [],
      fiveThreeOne: { trainingMax: 90, currentCycle: 1, currentWeek: 1, startDate: '2026-03-08' },
      squatSessionId: '3',
      weeklyGoal: 4,
      setupComplete: true,
      restDuration: 90,
      bodyWeightLogs: [],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

    const first = loadData();
    saveData(first);
    const second = loadData();

    const type = second.workoutTypes.find(t => t.id === '3')!;
    expect(type.exercises.filter(e => e.method?.type === '531')).toHaveLength(1);
  });

  it('strips legacy fields without crashing when squatSessionId points to a missing workout type', () => {
    const legacy = {
      workoutTypes: [],
      sessions: [],
      fiveThreeOne: { trainingMax: 90, currentCycle: 1, currentWeek: 1, startDate: '2026-03-08' },
      squatSessionId: 'does-not-exist',
      weeklyGoal: 4,
      setupComplete: true,
      restDuration: 90,
      bodyWeightLogs: [],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

    const data = loadData();
    expect(data.squatSessionId).toBeUndefined();
    expect(data.fiveThreeOne).toBeUndefined();
    expect(data.workoutTypes).toEqual([]);
  });

  it('leaves already-modern data (no legacy fields) untouched', () => {
    const modern: AppData = {
      workoutTypes: [{
        id: 'w1', name: 'Legs', color: '330 81% 60%',
        exercises: [{ id: 'e1', name: 'Squat', sets: 3, reps: 5, method: { type: '531', trainingMax: 100, currentCycle: 1, currentWeek: 1 } }],
      }],
      sessions: [],
      weeklyGoal: 4,
      setupComplete: true,
      restDuration: 90,
      bodyWeightLogs: [],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(modern));

    const data = loadData();
    expect(data.workoutTypes).toEqual(modern.workoutTypes);
  });
});
