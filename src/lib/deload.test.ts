import { describe, it, expect } from 'vitest';
import {
  getConsecutiveTrainingWeeks,
  getFatigueCriterion,
  getTonnageStagnationCriterion,
  getFiveThreeOneCurrentWeek,
  evaluateDeloadCriteria,
  shouldShowDeloadRecommendation,
  applyDeloadToWeight,
  applyDeloadToTrainingMax,
  getDeloadSetCount,
  buildDeloadAcceptPatch,
  buildDeloadDismissPatch,
  consumeDeloadOnSessionSave,
  getDeloadTargetWorkoutTypes,
  buildManualDeloadPatch,
  buildDeloadDeactivatePatch,
  getActiveDeload,
} from './deload';
import { AppData, SessionLog, WorkoutType, DEFAULT_APP_DATA } from './types';

function session(overrides: Partial<SessionLog> & { date: string }): SessionLog {
  return {
    id: `s-${overrides.date}-${Math.random()}`,
    workoutTypeId: 'wt1',
    workoutTypeName: 'Full body',
    sets: [],
    startTime: new Date(overrides.date + 'T10:00:00').getTime(),
    ...overrides,
  };
}

function data(overrides: Partial<AppData>): AppData {
  return { ...DEFAULT_APP_DATA, ...overrides };
}

describe('getConsecutiveTrainingWeeks', () => {
  it('counts trailing consecutive weeks with at least one session', () => {
    // Mondays: 2026-06-01, 06-08, 06-15, 06-22 (4 consecutive weeks)
    const sessions = [
      session({ date: '2026-06-02' }),
      session({ date: '2026-06-09' }),
      session({ date: '2026-06-16' }),
      session({ date: '2026-06-23' }),
    ];
    expect(getConsecutiveTrainingWeeks(sessions, undefined)).toBe(4);
  });

  it('stops at a gap week', () => {
    const sessions = [
      session({ date: '2026-06-02' }), // week of 06-01
      session({ date: '2026-06-23' }), // week of 06-22, gap in between
    ];
    expect(getConsecutiveTrainingWeeks(sessions, undefined)).toBe(1);
  });

  it('only counts sessions after the given date', () => {
    const sessions = [
      session({ date: '2026-05-01' }),
      session({ date: '2026-06-02' }),
      session({ date: '2026-06-09' }),
    ];
    expect(getConsecutiveTrainingWeeks(sessions, '2026-05-15')).toBe(2);
  });

  it('returns 0 with no sessions', () => {
    expect(getConsecutiveTrainingWeeks([], undefined)).toBe(0);
  });
});

describe('getFatigueCriterion', () => {
  const now = new Date('2026-06-20T12:00:00');

  it('triggers avgTrue with >=4 rated sessions in the last 14 days averaging >=7.8', () => {
    const sessions = [
      session({ date: '2026-06-19', difficulty: 8 }),
      session({ date: '2026-06-17', difficulty: 8 }),
      session({ date: '2026-06-15', difficulty: 7.5 }),
      session({ date: '2026-06-10', difficulty: 7.7 }),
    ];
    const result = getFatigueCriterion(sessions, now);
    expect(result.avgTrue).toBe(true);
    expect(result.avgValue).toBeCloseTo(7.8, 1);
  });

  it('does not trigger avgTrue with fewer than 4 rated sessions', () => {
    const sessions = [
      session({ date: '2026-06-19', difficulty: 10 }),
      session({ date: '2026-06-17', difficulty: 10 }),
      session({ date: '2026-06-15', difficulty: 10 }),
    ];
    expect(getFatigueCriterion(sessions, now).avgTrue).toBe(false);
  });

  it('triggers consecutiveTrue with the 3 most recent rated sessions all >= 8.5', () => {
    const sessions = [
      session({ date: '2026-06-01', difficulty: 3 }),
      session({ date: '2026-06-10', difficulty: 9 }),
      session({ date: '2026-06-15', difficulty: 8.5 }),
      session({ date: '2026-06-19', difficulty: 9.5 }),
    ];
    expect(getFatigueCriterion(sessions, now).consecutiveTrue).toBe(true);
  });

  it('does not trigger consecutiveTrue if any of the last 3 is below 8.5', () => {
    const sessions = [
      session({ date: '2026-06-10', difficulty: 9 }),
      session({ date: '2026-06-15', difficulty: 5 }),
      session({ date: '2026-06-19', difficulty: 9.5 }),
    ];
    expect(getFatigueCriterion(sessions, now).consecutiveTrue).toBe(false);
  });
});

describe('getTonnageStagnationCriterion', () => {
  const now = new Date('2026-06-29T12:00:00');
  const set = (weight: number, reps: number) => ({ exerciseId: 'e1', exerciseName: 'Squat', setNumber: 1, reps, weight, completed: true });

  it('detects stagnation when tonnage change is within +-2%, and reports the percentage', () => {
    const sessions = [
      session({ date: '2026-06-25', sets: [set(100, 10)] }), // window A: 1000
      session({ date: '2026-06-11', sets: [set(101, 10)] }), // window B: 1010 (~-1%)
    ];
    const result = getTonnageStagnationCriterion(sessions, [], now);
    expect(result.stagnant).toBe(true);
    expect(result.pctChange).toBeCloseTo(-1, 0);
  });

  it('does not detect stagnation with a real change', () => {
    const sessions = [
      session({ date: '2026-06-25', sets: [set(150, 10)] }),
      session({ date: '2026-06-11', sets: [set(100, 10)] }),
    ];
    const result = getTonnageStagnationCriterion(sessions, [], now);
    expect(result.stagnant).toBe(false);
    expect(result.pctChange).toBe(50);
  });

  it('returns false with a null pctChange when there is no data in the prior window', () => {
    const sessions = [session({ date: '2026-06-25', sets: [set(100, 10)] })];
    const result = getTonnageStagnationCriterion(sessions, [], now);
    expect(result.stagnant).toBe(false);
    expect(result.pctChange).toBeNull();
  });
});

describe('getFiveThreeOneCurrentWeek', () => {
  it('finds the week from the first 531 exercise', () => {
    const workoutTypes: WorkoutType[] = [{
      id: 't1', name: 'A', color: '0 0% 0%',
      exercises: [{ id: 'e1', name: 'Squat', sets: 3, reps: 5, method: { type: '531', trainingMax: 100, currentCycle: 1, currentWeek: 3 } }],
    }];
    expect(getFiveThreeOneCurrentWeek(workoutTypes)).toBe(3);
  });

  it('returns null with no 531 exercise', () => {
    const workoutTypes: WorkoutType[] = [{ id: 't1', name: 'A', color: '0 0% 0%', exercises: [] }];
    expect(getFiveThreeOneCurrentWeek(workoutTypes)).toBeNull();
  });
});

describe('evaluateDeloadCriteria reasons', () => {
  it('states the fatigue-avg window explicitly, not just the value', () => {
    const now = new Date('2026-06-29T12:00:00');
    const sessions = [
      session({ date: '2026-06-25', difficulty: 8 }),
      session({ date: '2026-06-22', difficulty: 8 }),
      session({ date: '2026-06-19', difficulty: 7.5 }),
      session({ date: '2026-06-16', difficulty: 8.5 }),
    ];
    const { reasons } = evaluateDeloadCriteria(data({ sessions }), now);
    expect(reasons).toContain('Moyenne RPE des 2 dernières semaines : 8,0');
  });

  it('states the tonnage stagnation percentage explicitly, not just a generic label', () => {
    const now = new Date('2026-06-29T12:00:00');
    const set = (weight: number, reps: number) => ({ exerciseId: 'e1', exerciseName: 'Squat', setNumber: 1, reps, weight, completed: true });
    const sessions = [
      session({ date: '2026-06-25', sets: [set(100, 10)] }), // window A: 1000
      session({ date: '2026-06-11', sets: [set(101, 10)] }), // window B: 1010 (~-1%)
    ];
    const { reasons } = evaluateDeloadCriteria(data({ sessions }), now);
    expect(reasons.some(r => r.includes('%') && r.includes('Progression ralentie'))).toBe(true);
  });
});

describe('shouldShowDeloadRecommendation', () => {
  it('holds back a time-only trigger until the 5/3/1 reaches week 4', () => {
    const sessions = [
      session({ date: '2026-06-02' }), session({ date: '2026-06-09' }),
      session({ date: '2026-06-16' }), session({ date: '2026-06-23' }),
    ];
    const workoutTypes: WorkoutType[] = [{
      id: 't1', name: 'A', color: '0 0% 0%',
      exercises: [{ id: 'e1', name: 'Squat', sets: 3, reps: 5, method: { type: '531', trainingMax: 100, currentCycle: 1, currentWeek: 2 } }],
    }];
    const result = shouldShowDeloadRecommendation(data({ sessions, workoutTypes }), new Date('2026-06-24'));
    expect(result.criteria.time).toBe(true);
    expect(result.show).toBe(false);
  });

  it('shows once the 5/3/1 reaches week 4', () => {
    const sessions = [
      session({ date: '2026-06-02' }), session({ date: '2026-06-09' }),
      session({ date: '2026-06-16' }), session({ date: '2026-06-23' }),
    ];
    const workoutTypes: WorkoutType[] = [{
      id: 't1', name: 'A', color: '0 0% 0%',
      exercises: [{ id: 'e1', name: 'Squat', sets: 3, reps: 5, method: { type: '531', trainingMax: 100, currentCycle: 1, currentWeek: 4 } }],
    }];
    const result = shouldShowDeloadRecommendation(data({ sessions, workoutTypes }), new Date('2026-06-24'));
    expect(result.show).toBe(true);
  });

  it('never holds back a fatigue-driven trigger, 5/3/1 alignment or not', () => {
    const sessions = [
      session({ date: '2026-06-20', difficulty: 9 }),
      session({ date: '2026-06-21', difficulty: 9 }),
      session({ date: '2026-06-22', difficulty: 9 }),
    ];
    const workoutTypes: WorkoutType[] = [{
      id: 't1', name: 'A', color: '0 0% 0%',
      exercises: [{ id: 'e1', name: 'Squat', sets: 3, reps: 5, method: { type: '531', trainingMax: 100, currentCycle: 1, currentWeek: 1 } }],
    }];
    const result = shouldShowDeloadRecommendation(data({ sessions, workoutTypes }), new Date('2026-06-22'));
    expect(result.criteria.fatigueConsecutive).toBe(true);
    expect(result.show).toBe(true);
  });

  it('does not show while a deload is already active', () => {
    const d = data({
      sessions: [session({ date: '2026-06-20', difficulty: 9 }), session({ date: '2026-06-21', difficulty: 9 }), session({ date: '2026-06-22', difficulty: 9 })],
      deload: { active: { type: 'both', intensity: 'medium', pendingWorkoutTypeIds: ['t1'], acceptedAt: '2026-06-22' } },
    });
    expect(shouldShowDeloadRecommendation(d, new Date('2026-06-22')).show).toBe(false);
  });

  it('does not show while snoozed', () => {
    const d = data({
      sessions: [session({ date: '2026-06-20', difficulty: 9 }), session({ date: '2026-06-21', difficulty: 9 }), session({ date: '2026-06-22', difficulty: 9 })],
      deload: { dismissedUntil: '2026-06-25' },
    });
    expect(shouldShowDeloadRecommendation(d, new Date('2026-06-22')).show).toBe(false);
  });
});

describe('applyDeloadToWeight', () => {
  it('reduces a positive weight by the charges fraction, then rounds to the nearest step (2.5kg here)', () => {
    expect(applyDeloadToWeight(100, 'charges', 'light')).toBe(92.5); // 92 -> nearest 2.5
    expect(applyDeloadToWeight(100, 'charges', 'medium')).toBe(87.5); // 88 -> nearest 2.5
    expect(applyDeloadToWeight(100, 'both', 'light')).toBe(95); // 95 already on the grid
    expect(applyDeloadToWeight(100, 'both', 'medium')).toBe(92.5); // 92 -> nearest 2.5
  });

  it('leaves weight untouched for a volume-only deload', () => {
    expect(applyDeloadToWeight(100, 'volume', 'medium')).toBe(100);
  });

  it('increases assistance magnitude for a negative (assisted) weight, never reduces it', () => {
    // -20kg of assistance should become MORE negative (more assisted = easier), not less.
    const result = applyDeloadToWeight(-20, 'charges', 'light');
    expect(result).toBeLessThan(-20);
  });

  it('leaves 0 untouched', () => {
    expect(applyDeloadToWeight(0, 'charges', 'medium')).toBe(0);
  });
});

describe('applyDeloadToTrainingMax', () => {
  it('reduces by the charges fraction and rounds', () => {
    expect(applyDeloadToTrainingMax(100, 'charges', 'medium')).toBe(87.5); // 88 -> nearest 2.5
  });

  it('is untouched for volume type', () => {
    expect(applyDeloadToTrainingMax(100, 'volume', 'medium')).toBe(100);
  });
});

describe('getDeloadSetCount', () => {
  it('applies the medium table as given', () => {
    expect([1, 2, 3, 4, 5, 6].map(n => getDeloadSetCount(n, 'medium'))).toEqual([1, 1, 2, 2, 3, 4]);
  });

  it('applies the light table as given', () => {
    expect([1, 2, 3, 4, 5, 6].map(n => getDeloadSetCount(n, 'light'))).toEqual([1, 2, 2, 3, 4, 5]);
  });

  it('extrapolates beyond 6 sets', () => {
    expect(getDeloadSetCount(8, 'medium')).toBeGreaterThanOrEqual(1);
  });
});

describe('getDeloadTargetWorkoutTypes / buildDeloadAcceptPatch', () => {
  it('snapshots the currently active (non-hidden) workout types', () => {
    const workoutTypes: WorkoutType[] = [
      { id: 't1', name: 'A', color: '0 0% 0%', exercises: [] },
      { id: 't2', name: 'B', color: '0 0% 0%', exercises: [], hidden: true },
    ];
    expect(getDeloadTargetWorkoutTypes(data({ workoutTypes })).map(t => t.id)).toEqual(['t1']);
  });

  it('forces a 5/3/1 exercise to week 4 and remembers the resume week', () => {
    const workoutTypes: WorkoutType[] = [{
      id: 't1', name: 'A', color: '0 0% 0%',
      exercises: [{ id: 'e1', name: 'Squat', sets: 3, reps: 5, method: { type: '531', trainingMax: 100, currentCycle: 1, currentWeek: 2 } }],
    }];
    const patch = buildDeloadAcceptPatch(data({ workoutTypes }), 'both', 'medium', new Date('2026-06-24'));
    const method = patch.workoutTypes[0].exercises[0].method as any;
    expect(method.currentWeek).toBe(4);
    expect(method.deloadResumeWeek).toBe(2);
    expect(patch.deload.active?.pendingWorkoutTypeIds).toEqual(['t1']);
  });

  it('leaves a 5/3/1 exercise already on week 4 untouched', () => {
    const workoutTypes: WorkoutType[] = [{
      id: 't1', name: 'A', color: '0 0% 0%',
      exercises: [{ id: 'e1', name: 'Squat', sets: 3, reps: 5, method: { type: '531', trainingMax: 100, currentCycle: 1, currentWeek: 4 } }],
    }];
    const patch = buildDeloadAcceptPatch(data({ workoutTypes }), 'both', 'medium', new Date('2026-06-24'));
    const method = patch.workoutTypes[0].exercises[0].method as any;
    expect(method.deloadResumeWeek).toBeUndefined();
  });
});

describe('buildDeloadDismissPatch', () => {
  it('snoozes for 7 days', () => {
    const patch = buildDeloadDismissPatch(data({}), new Date('2026-06-20'));
    expect(patch.dismissedUntil).toBe('2026-06-27');
  });
});

describe('consumeDeloadOnSessionSave', () => {
  it('shrinks the pending list when a matching workout type is saved', () => {
    const d = data({ deload: { active: { type: 'both', intensity: 'medium', pendingWorkoutTypeIds: ['t1', 't2'], acceptedAt: '2026-06-20' } } });
    const result = consumeDeloadOnSessionSave(d, 't1', new Date('2026-06-21'));
    expect(result.wasDeload).toBe(true);
    expect(result.deload?.active?.pendingWorkoutTypeIds).toEqual(['t2']);
  });

  it('clears the active deload and stamps lastDeloadCompletedAt once the list is empty', () => {
    const d = data({ deload: { active: { type: 'both', intensity: 'medium', pendingWorkoutTypeIds: ['t1'], acceptedAt: '2026-06-20' } } });
    const result = consumeDeloadOnSessionSave(d, 't1', new Date('2026-06-21'));
    expect(result.deload?.active).toBeUndefined();
    expect(result.deload?.lastDeloadCompletedAt).toBe('2026-06-21');
  });

  it('is a no-op for a workout type not in the pending list', () => {
    const d = data({ deload: { active: { type: 'both', intensity: 'medium', pendingWorkoutTypeIds: ['t1'], acceptedAt: '2026-06-20' } } });
    const result = consumeDeloadOnSessionSave(d, 't2', new Date('2026-06-21'));
    expect(result.wasDeload).toBe(false);
    expect(result.deload?.active?.pendingWorkoutTypeIds).toEqual(['t1']);
  });

  it('keeps a manual (expiresAt) deload active for every matching session inside the window, without shrinking the list', () => {
    const d = data({ deload: { active: { type: 'both', intensity: 'medium', pendingWorkoutTypeIds: ['t1'], acceptedAt: '2026-06-20', expiresAt: '2026-06-26' } } });
    const result = consumeDeloadOnSessionSave(d, 't1', new Date('2026-06-22'));
    expect(result.wasDeload).toBe(true);
    expect(result.deload?.active?.pendingWorkoutTypeIds).toEqual(['t1']);
    expect(result.deload?.active?.expiresAt).toBe('2026-06-26');
  });

  it('clears a manual deload once a session lands after expiresAt', () => {
    const d = data({ deload: { active: { type: 'both', intensity: 'medium', pendingWorkoutTypeIds: ['t1'], acceptedAt: '2026-06-20', expiresAt: '2026-06-26' } } });
    const result = consumeDeloadOnSessionSave(d, 't1', new Date('2026-06-27'));
    expect(result.wasDeload).toBe(false);
    expect(result.deload?.active).toBeUndefined();
    expect(result.deload?.lastDeloadCompletedAt).toBe('2026-06-27');
  });
});

describe('buildManualDeloadPatch', () => {
  it('sets an expiresAt covering exactly the chosen number of days (inclusive)', () => {
    const workoutTypes: WorkoutType[] = [{ id: 't1', name: 'A', color: '0 0% 0%', exercises: [] }];
    const patch = buildManualDeloadPatch(data({ workoutTypes }), 'both', 'medium', 5, new Date('2026-06-20'));
    expect(patch.deload.active?.acceptedAt).toBe('2026-06-20');
    expect(patch.deload.active?.expiresAt).toBe('2026-06-24'); // 20,21,22,23,24 = 5 days
  });

  it('forces 5/3/1 exercises to week 4 just like the recommendation-accept flow', () => {
    const workoutTypes: WorkoutType[] = [{
      id: 't1', name: 'A', color: '0 0% 0%',
      exercises: [{ id: 'e1', name: 'Squat', sets: 3, reps: 5, method: { type: '531', trainingMax: 100, currentCycle: 1, currentWeek: 2 } }],
    }];
    const patch = buildManualDeloadPatch(data({ workoutTypes }), 'both', 'medium', 7, new Date('2026-06-20'));
    const method = patch.workoutTypes[0].exercises[0].method as any;
    expect(method.currentWeek).toBe(4);
    expect(method.deloadResumeWeek).toBe(2);
  });

  it('treats a days value below 1 as 1 day', () => {
    const patch = buildManualDeloadPatch(data({}), 'both', 'medium', 0, new Date('2026-06-20'));
    expect(patch.deload.active?.expiresAt).toBe('2026-06-20');
  });
});

describe('buildDeloadDeactivatePatch', () => {
  it('clears the active deload without stamping lastDeloadCompletedAt', () => {
    const d = data({ deload: { active: { type: 'both', intensity: 'medium', pendingWorkoutTypeIds: ['t1'], acceptedAt: '2026-06-20', expiresAt: '2026-06-26' } } });
    const patch = buildDeloadDeactivatePatch(d);
    expect(patch.active).toBeUndefined();
    expect(patch.lastDeloadCompletedAt).toBeUndefined();
  });
});

describe('getActiveDeload', () => {
  it('returns the active deload when there is no expiresAt', () => {
    const d = data({ deload: { active: { type: 'both', intensity: 'medium', pendingWorkoutTypeIds: ['t1'], acceptedAt: '2026-06-20' } } });
    expect(getActiveDeload(d, new Date('2026-07-01'))?.pendingWorkoutTypeIds).toEqual(['t1']);
  });

  it('returns the active manual deload while within the window', () => {
    const d = data({ deload: { active: { type: 'both', intensity: 'medium', pendingWorkoutTypeIds: ['t1'], acceptedAt: '2026-06-20', expiresAt: '2026-06-26' } } });
    expect(getActiveDeload(d, new Date('2026-06-26'))).toBeDefined();
  });

  it('returns undefined once a manual deload has expired, even without a session save', () => {
    const d = data({ deload: { active: { type: 'both', intensity: 'medium', pendingWorkoutTypeIds: ['t1'], acceptedAt: '2026-06-20', expiresAt: '2026-06-26' } } });
    expect(getActiveDeload(d, new Date('2026-06-27'))).toBeUndefined();
  });

  it('returns undefined when there is no active deload', () => {
    expect(getActiveDeload(data({}), new Date('2026-06-27'))).toBeUndefined();
  });
});
