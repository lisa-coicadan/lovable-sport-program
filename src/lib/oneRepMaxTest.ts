import { roundWeightSmart } from './weightRounding';

// A dedicated PR-testing ramp (see item 5 of the personalization roadmap conversation) —
// distinct from the normal 5/3/1 week sets, which are volume/intensity work, not a true-max
// attempt. Percentages/reps/RPE targets are a coach-supplied protocol; deliberately excludes
// rest-time guidance and general advice per her instruction — only the load progression and
// the RPE-driven adjustments she asked for (per-stage RPE, success/failure, adapt next load).
export interface RampStage {
  key: string;
  label: string;
  percentage: number; // fraction of the targeted 1RM
  reps: number;
}

export const RAMP_STAGES: RampStage[] = [
  { key: 'mobilisation', label: 'Mobilisation', percentage: 0.35, reps: 9 },
  { key: 'activation', label: 'Activation', percentage: 0.5, reps: 5 },
  { key: 'montee', label: 'Montée en charge', percentage: 0.6, reps: 3 },
  { key: 'alerte', label: 'Alerte nerveuse', percentage: 0.7, reps: 2 },
  { key: 'dernier', label: 'Dernier échauffement', percentage: 0.8, reps: 1 },
  { key: 'ouverture', label: 'Ouverture', percentage: 0.9, reps: 1 },
  { key: 'pr', label: 'Le PR', percentage: 1.0, reps: 1 },
];

export interface RampSetPlan {
  key: string;
  label: string;
  weight: number;
  reps: number;
}

export function generateRampPlan(targetOneRepMax: number): RampSetPlan[] {
  if (targetOneRepMax <= 0) return [];
  return RAMP_STAGES.map(s => ({
    key: s.key,
    label: s.label,
    weight: roundWeightSmart(targetOneRepMax * s.percentage),
    reps: s.reps,
  }));
}

// A bonus attempt beyond the planned 100% PR stage, offered only when "Ouverture" (90%)
// felt easy — 102-105% per the coach protocol, using the low end (102%) since the
// "Ouverture" RPE already decided the 100% target was worth pushing on.
export function generateBonusStage(targetOneRepMax: number): RampSetPlan {
  return { key: 'bonus', label: 'Tentative bonus', weight: roundWeightSmart(targetOneRepMax * 1.02), reps: 1 };
}

// Guidance shown right after rating RPE on the "Ouverture" (90%) stage — purely a
// suggestion, the actual 100% weight stays freely editable.
export function getOuvertureGuidance(rpe: number): string | null {
  if (rpe <= 8) {
    return 'Ça monte facile — tu peux viser plus haut pour ton 100% (+2,5 à +5%), ou garder ton objectif et prévoir une tentative bonus ensuite.';
  }
  if (rpe >= 9.5) {
    return 'C\'est lourd — ajuste ton 100% à la baisse, ou vise ton ancien record pour sécuriser une barre solide plutôt que de risquer l\'échec.';
  }
  return null;
}

// Guidance shown after marking the "Le PR" (or bonus) stage as failed — the coach protocol
// is explicit that a failed max attempt should never be retried in the same session.
export function getFailureGuidance(): string {
  return 'Échec — ne retente pas cette charge dans cette séance. Si c\'était de justesse, tu peux baisser de 3 à 5% pour valider une répétition propre puis t\'arrêter là. Sinon, range les barres pour aujourd\'hui.';
}
