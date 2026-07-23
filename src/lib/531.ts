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
    weight: roundToNearest(trainingMax * s.percentage, 2.5),
  }));
}

export function getWeekLabel(week: number): string {
  const labels = ['Semaine 1 — 5 reps', 'Semaine 2 — 3 reps', 'Semaine 3 — 5/3/1', 'Semaine 4 — Deload'];
  return labels[week - 1] || labels[0];
}

function roundToNearest(value: number, nearest: number): number {
  return Math.round(value / nearest) * nearest;
}
