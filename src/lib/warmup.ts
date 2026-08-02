// Warm-up ramp protocol supplied by Lisa (coach guidance): the percentage of each stage
// depends on the TOTAL number of warm-up sets planned, not just its position — going from
// 3 to 4 warm-ups shifts every stage's percentage, it doesn't just add a new one at the end.
const WARMUP_TABLE: Record<number, number[]> = {
  1: [0.5],
  2: [0.45, 0.7],
  3: [0.4, 0.6, 0.8],
  4: [0.35, 0.55, 0.75, 0.9],
  5: [0.3, 0.45, 0.6, 0.75, 0.9],
};

const MAX_TABLE_STAGES = 5;

// Beyond the supplied protocol (5 stages) there's no established guidance — keep the
// 5-stage ramp shape and hold at 90% for any further stage rather than inventing a curve.
export function getWarmupPercentages(totalCount: number): number[] {
  if (totalCount <= 0) return [];
  if (totalCount <= MAX_TABLE_STAGES) return WARMUP_TABLE[totalCount];
  return [...WARMUP_TABLE[MAX_TABLE_STAGES], ...Array(totalCount - MAX_TABLE_STAGES).fill(0.9)];
}
