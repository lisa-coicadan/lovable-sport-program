#!/usr/bin/env node
/**
 * Generates a realistic, valid AppData JSON fixture for the "verification"
 * skill's full test pass: 4 weeks of history mixing strength (531, cluster,
 * EMOM, drop set, AMRAP, assisted/negative reps, superset) and cardio.
 *
 * Deliberately deterministic (dates computed from "today", no Math.random)
 * so a failed run is reproducible. Values are realistic but not physically
 * exact (weight rounding, EMOM/cluster %TM math) — this fixture is for
 * exercising every screen/feature, not for validating the load-calculation
 * formulas themselves (those have their own Vitest suites in src/lib/*.test.ts).
 *
 * Usage: node generate-fixture.mjs [output-path]
 *   No arg / "-"  -> prints JSON to stdout
 *   A path        -> writes JSON to that file
 *
 * Import into the running app for a manual pass via the browser:
 *   localStorage.setItem('fitness-tracker-data', <contents of the file>)
 *   then reload. (Key must match src/lib/storage.ts's STORAGE_KEY.)
 */

import fs from 'node:fs';

const STORAGE_KEY = 'fitness-tracker-data';
const TODAY = new Date();

function isoDate(daysAgo) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function round5(n) {
  return Math.round(n * 2) / 2; // nearest 0.5kg — good enough for a fixture, not the real rounding rules
}

function set(exerciseId, exerciseName, setNumber, reps, weight, extra = {}) {
  return { exerciseId, exerciseName, setNumber, reps, weight, completed: true, ...extra };
}

// --- Exercises -------------------------------------------------------------

const SQUAT_TM = 92.5; // mid-cycle 2, week 3 — exercises the 531 progression display
const BENCH_TM = 70; // cluster, left at defaults (no numSeries/miniSeries set)
const ROW_TM = 60; // EMOM, left at defaults (no duration/reps/percentage set)

const exSquat = { id: 'ex-squat', name: 'Squat', sets: 3, reps: 1, equipment: 'barre',
  method: { type: '531', trainingMax: SQUAT_TM, currentCycle: 2, currentWeek: 3 } };

const exBench = { id: 'ex-bench', name: 'Développé couché', sets: 4, reps: 2, equipment: 'barre',
  method: { type: 'cluster', trainingMax: BENCH_TM } };

const exDips = { id: 'ex-dips', name: 'Dips lestés', sets: 4, reps: 6,
  dropSet: { stepPercentage: 0.15, stepReps: 2 } };

const exOhp = { id: 'ex-ohp', name: 'Développé militaire', sets: 3, reps: 8,
  supersetGroupId: 'ss-push', supersetRole: 'A' };
const exLatRaise = { id: 'ex-lat-raise', name: 'Élévations latérales', sets: 3, reps: 12,
  supersetGroupId: 'ss-push', supersetRole: 'B' };

const exPullup = { id: 'ex-pullup', name: 'Tractions lestées', sets: 4, reps: 6, amrap: true };

const exRow = { id: 'ex-row', name: 'Rowing barre', sets: 5, reps: 2, equipment: 'barre',
  method: { type: 'emom', trainingMax: ROW_TM } };

const exDeadlift = { id: 'ex-deadlift', name: 'Soulevé de terre', sets: 3, reps: 5, equipment: 'barre' };
const exLunges = { id: 'ex-lunges', name: 'Fentes', sets: 3, reps: 10, unilateral: true };

const workoutTypes = [
  { id: 'wt-squat', name: 'Squat', color: '189 94% 55%', programId: 'prog-verif', exercises: [exSquat] },
  { id: 'wt-push', name: 'Push', color: '262 83% 66%', programId: 'prog-verif', exercises: [exBench, exDips, exOhp, exLatRaise] },
  { id: 'wt-pull', name: 'Pull', color: '322 100% 60%', programId: 'prog-verif', exercises: [exPullup, exRow] },
  { id: 'wt-legs', name: 'Legs', color: '38 92% 52%', programId: 'prog-verif', exercises: [exDeadlift, exLunges] },
];

// --- Sessions: 4 weeks, oldest first ---------------------------------------
// Mon=Squat, Wed=Push, Fri=Pull, Sat=Legs, Tue+Sun=cardio (alternating activity).
// weekIdx 0 = 4 weeks ago .. 3 = this week, so weight/reps can show a mild
// week-over-week progression (exercises the "vs previous session" comparisons).

const sessions = [];
const cardioSessions = [];

for (let weekIdx = 0; weekIdx < 4; weekIdx++) {
  const weekAgoBase = (3 - weekIdx) * 7; // 21, 14, 7, 0 days ago for the Monday of that week
  const progress = weekIdx; // 0..3, nudges weight up slightly each week

  // Squat (531) — Monday
  sessions.push({
    id: `s-squat-${weekIdx}`,
    date: isoDate(weekAgoBase + 6),
    workoutTypeId: 'wt-squat',
    workoutTypeName: 'Squat',
    programId: 'prog-verif',
    programName: 'Programme Vérif',
    sets: [
      set('ex-squat', 'Squat', 1, 5, round5(SQUAT_TM * 0.65 + progress)),
      set('ex-squat', 'Squat', 2, 5, round5(SQUAT_TM * 0.75 + progress)),
      set('ex-squat', 'Squat', 3, 5, round5(SQUAT_TM * 0.85 + progress)),
    ],
    startTime: new Date(`${isoDate(weekAgoBase + 6)}T18:00:00`).getTime(),
    endTime: new Date(`${isoDate(weekAgoBase + 6)}T18:45:00`).getTime(),
    duration: 45,
    difficulty: 4,
  });

  // Push (cluster + drop set + superset) — Wednesday
  const anchorWeight = round5(exDips.sets ? 20 + progress : 20);
  const anchorReps = 6;
  const stage1 = { weight: round5(anchorWeight * (1 - 0.15)), reps: Math.max(1, anchorReps - 2) };
  const stage2 = { weight: round5(anchorWeight * (1 - 0.3)), reps: Math.max(1, anchorReps - 4) };
  sessions.push({
    id: `s-push-${weekIdx}`,
    date: isoDate(weekAgoBase + 4),
    workoutTypeId: 'wt-push',
    workoutTypeName: 'Push',
    programId: 'prog-verif',
    programName: 'Programme Vérif',
    sets: [
      set('ex-bench', 'Développé couché', 1, 2, round5(BENCH_TM * 0.9 + progress)),
      set('ex-bench', 'Développé couché', 2, 2, round5(BENCH_TM * 0.9 + progress)),
      set('ex-bench', 'Développé couché', 3, 2, round5(BENCH_TM * 0.9 + progress)),
      set('ex-dips', 'Dips lestés', 1, anchorReps, anchorWeight),
      set('ex-dips', 'Dips lestés', 2, stage1.reps, stage1.weight, { dropSetStage: 1 }),
      set('ex-dips', 'Dips lestés', 3, stage2.reps, stage2.weight, { dropSetStage: 2 }),
      set('ex-ohp', 'Développé militaire', 1, 8, round5(20 + progress), { supersetGroupId: 'ss-push', supersetRole: 'A' }),
      set('ex-lat-raise', 'Élévations latérales', 1, 12, 8, { supersetGroupId: 'ss-push', supersetRole: 'B' }),
      set('ex-ohp', 'Développé militaire', 2, 8, round5(20 + progress), { supersetGroupId: 'ss-push', supersetRole: 'A' }),
      set('ex-lat-raise', 'Élévations latérales', 2, 12, 8, { supersetGroupId: 'ss-push', supersetRole: 'B' }),
    ],
    startTime: new Date(`${isoDate(weekAgoBase + 4)}T18:00:00`).getTime(),
    endTime: new Date(`${isoDate(weekAgoBase + 4)}T19:00:00`).getTime(),
    duration: 60,
    difficulty: 4,
  });

  // Pull (EMOM + AMRAP + assisted/negative -> bodyweight -> weighted progression) — Friday
  // weekIdx 0-1: assisted (negative = band/machine help), 2: bodyweight, 3: weighted.
  const pullupWeight = weekIdx < 2 ? -10 + progress * 5 : weekIdx === 2 ? 0 : 5;
  sessions.push({
    id: `s-pull-${weekIdx}`,
    date: isoDate(weekAgoBase + 2),
    workoutTypeId: 'wt-pull',
    workoutTypeName: 'Pull',
    programId: 'prog-verif',
    programName: 'Programme Vérif',
    sets: [
      set('ex-pullup', 'Tractions lestées', 1, 6, pullupWeight),
      set('ex-pullup', 'Tractions lestées', 2, 6, pullupWeight),
      set('ex-pullup', 'Tractions lestées', 3, 6, pullupWeight),
      set('ex-pullup', 'Tractions lestées', 4, 8 + progress, pullupWeight, { amrap: true }),
      ...Array.from({ length: 5 }, (_, i) => set('ex-row', 'Rowing barre', i + 1, 2, round5(ROW_TM * 0.7 + progress))),
    ],
    startTime: new Date(`${isoDate(weekAgoBase + 2)}T18:00:00`).getTime(),
    endTime: new Date(`${isoDate(weekAgoBase + 2)}T18:40:00`).getTime(),
    duration: 40,
    difficulty: 5,
  });

  // Legs (plain, unilateral display attribute) — Saturday
  sessions.push({
    id: `s-legs-${weekIdx}`,
    date: isoDate(weekAgoBase + 1),
    workoutTypeId: 'wt-legs',
    workoutTypeName: 'Legs',
    programId: 'prog-verif',
    programName: 'Programme Vérif',
    sets: [
      set('ex-deadlift', 'Soulevé de terre', 1, 5, round5(100 + progress * 2)),
      set('ex-deadlift', 'Soulevé de terre', 2, 5, round5(100 + progress * 2)),
      set('ex-deadlift', 'Soulevé de terre', 3, 5, round5(100 + progress * 2)),
      set('ex-lunges', 'Fentes', 1, 10, 16),
      set('ex-lunges', 'Fentes', 2, 10, 16),
    ],
    startTime: new Date(`${isoDate(weekAgoBase + 1)}T10:00:00`).getTime(),
    endTime: new Date(`${isoDate(weekAgoBase + 1)}T10:35:00`).getTime(),
    duration: 35,
    difficulty: 3,
  });

  // Cardio — Tuesday (run, with distance) + Sunday (swim, duration-only)
  cardioSessions.push({
    id: `c-run-${weekIdx}`,
    date: isoDate(weekAgoBase + 5),
    activityType: 'Course à pied',
    durationMinutes: 32 + progress,
    distanceKm: 5 + progress * 0.2,
    difficulty: 3,
  });
  cardioSessions.push({
    id: `c-swim-${weekIdx}`,
    date: isoDate(weekAgoBase),
    activityType: 'Natation',
    durationMinutes: 40,
    difficulty: 2,
  });
}

const bodyWeightLogs = [
  { date: isoDate(21), weight: 62.5 },
  { date: isoDate(14), weight: 62.3 },
  { date: isoDate(7), weight: 62.0 },
  { date: isoDate(0), weight: 61.8 },
];

const appData = {
  workoutTypes,
  sessions,
  weeklyGoal: 4,
  setupComplete: true,
  restDuration: 90,
  bodyWeightLogs,
  programs: [{ id: 'prog-verif', name: 'Programme Vérif' }],
  activeProgramId: 'prog-verif',
  gender: 'F',
  heightCm: 165,
  cardioSessions,
  cardioWeeklyGoal: 2,
};

const json = JSON.stringify(appData, null, 2);
const outPath = process.argv[2];
if (!outPath || outPath === '-') {
  process.stdout.write(json + '\n');
} else {
  fs.writeFileSync(outPath, json);
  console.error(`Fixture written to ${outPath} (${sessions.length} séances muscu, ${cardioSessions.length} cardio, storage key "${STORAGE_KEY}")`);
}
