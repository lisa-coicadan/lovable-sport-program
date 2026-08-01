import { Gender } from './types';

// Static reference data supplied by Lisa (records_et_standards_complet.xlsx, generated
// from public sources — FFForce / StreetLiftings.fr). No backend: this is bundled with
// the app like any other constant, compared locally against her own bodyweight/gender
// (src/lib/types.ts AppData.gender), nothing leaves the device.

// Movement keys match the canonical `base` names produced by
// src/lib/exerciseNormalize.ts's splitEquipmentVariant — only the barbell/no-equipment
// variant is compared (machine/assisted variants have different load characteristics).
export type StandardMovement = 'Squat' | 'Développé couché' | 'Soulevé de terre' | 'Tractions lestées' | 'Dips lestés';

export const STANDARD_MOVEMENTS: StandardMovement[] = [
  'Squat', 'Développé couché', 'Soulevé de terre', 'Tractions lestées', 'Dips lestés',
];

export interface FranceRecordRow {
  gender: Gender;
  categoryLabel: string;
  // Powerlifting-style weight class: 'under' means bodyweight <= boundKg qualifies,
  // 'over' means bodyweight > boundKg qualifies (open/unbounded top class).
  direction: 'under' | 'over';
  boundKg: number;
  movement: StandardMovement;
  recordKg: number;
  holder: string;
  year: number;
  source: string;
}

// Transcribed from sheet "Records de France" — Force Athlétique (Squat/Développé
// couché/Soulevé de terre) and Street Lifting (Tractions/Dips lestés) categories. Some
// weight ranges have gaps in the source (e.g. no French national FA record listed above
// -83kg men or -63kg women) — getFranceRecord returns null rather than guessing.
export const FRANCE_RECORDS: FranceRecordRow[] = [
  // Femmes — Force Athlétique
  { gender: 'F', categoryLabel: '-47 kg', direction: 'under', boundKg: 47, movement: 'Squat', recordKg: 115, holder: 'Elodie Esposito', year: 2021, source: 'FFForce' },
  { gender: 'F', categoryLabel: '-47 kg', direction: 'under', boundKg: 47, movement: 'Développé couché', recordKg: 85, holder: 'Stephanie Legard', year: 2019, source: 'FFForce' },
  { gender: 'F', categoryLabel: '-47 kg', direction: 'under', boundKg: 47, movement: 'Soulevé de terre', recordKg: 145, holder: 'Elodie Esposito', year: 2021, source: 'FFForce' },
  { gender: 'F', categoryLabel: '-52 kg', direction: 'under', boundKg: 52, movement: 'Squat', recordKg: 135, holder: 'Alison Huet', year: 2021, source: 'FFForce' },
  { gender: 'F', categoryLabel: '-52 kg', direction: 'under', boundKg: 52, movement: 'Développé couché', recordKg: 85.5, holder: 'Alison Huet', year: 2021, source: 'FFForce' },
  { gender: 'F', categoryLabel: '-52 kg', direction: 'under', boundKg: 52, movement: 'Soulevé de terre', recordKg: 165, holder: 'Alison Huet', year: 2021, source: 'FFForce' },
  { gender: 'F', categoryLabel: '-57 kg', direction: 'under', boundKg: 57, movement: 'Squat', recordKg: 150, holder: 'Melodie Anthouard', year: 2019, source: 'FFForce' },
  { gender: 'F', categoryLabel: '-57 kg', direction: 'under', boundKg: 57, movement: 'Développé couché', recordKg: 107.5, holder: 'Melodie Anthouard', year: 2019, source: 'FFForce' },
  { gender: 'F', categoryLabel: '-57 kg', direction: 'under', boundKg: 57, movement: 'Soulevé de terre', recordKg: 180, holder: 'Melodie Anthouard', year: 2019, source: 'FFForce' },
  { gender: 'F', categoryLabel: '-63 kg', direction: 'under', boundKg: 63, movement: 'Squat', recordKg: 165, holder: 'Chloé Esposito', year: 2022, source: 'FFForce' },
  { gender: 'F', categoryLabel: '-63 kg', direction: 'under', boundKg: 63, movement: 'Développé couché', recordKg: 115, holder: 'Chloé Esposito', year: 2022, source: 'FFForce' },
  { gender: 'F', categoryLabel: '-63 kg', direction: 'under', boundKg: 63, movement: 'Soulevé de terre', recordKg: 195, holder: 'Chloé Esposito', year: 2022, source: 'FFForce' },
  // Femmes — Street Lifting
  { gender: 'F', categoryLabel: '-52 kg', direction: 'under', boundKg: 52, movement: 'Tractions lestées', recordKg: 44, holder: 'Céline Chatelain', year: 2024, source: 'StreetLiftings.fr' },
  { gender: 'F', categoryLabel: '-52 kg', direction: 'under', boundKg: 52, movement: 'Dips lestés', recordKg: 65, holder: 'Ludivine Compain', year: 2025, source: 'StreetLiftings.fr' },
  { gender: 'F', categoryLabel: '-57 kg', direction: 'under', boundKg: 57, movement: 'Tractions lestées', recordKg: 55, holder: 'Lylia Ammour', year: 2026, source: 'StreetLiftings.fr' },
  { gender: 'F', categoryLabel: '-57 kg', direction: 'under', boundKg: 57, movement: 'Dips lestés', recordKg: 77.5, holder: 'Lylia Ammour', year: 2026, source: 'StreetLiftings.fr' },
  { gender: 'F', categoryLabel: '-63 kg', direction: 'under', boundKg: 63, movement: 'Tractions lestées', recordKg: 45, holder: 'Lylia Ammour', year: 2024, source: 'StreetLiftings.fr' },
  { gender: 'F', categoryLabel: '-63 kg', direction: 'under', boundKg: 63, movement: 'Dips lestés', recordKg: 72.5, holder: 'Maëlle Vioulac', year: 2026, source: 'StreetLiftings.fr' },
  { gender: 'F', categoryLabel: '-70 kg', direction: 'under', boundKg: 70, movement: 'Tractions lestées', recordKg: 55, holder: 'Florence Wong', year: 2025, source: 'StreetLiftings.fr' },
  { gender: 'F', categoryLabel: '-70 kg', direction: 'under', boundKg: 70, movement: 'Dips lestés', recordKg: 80.5, holder: 'Guilhemette De Malleray', year: 2026, source: 'StreetLiftings.fr' },
  { gender: 'F', categoryLabel: '+70 kg', direction: 'over', boundKg: 70, movement: 'Tractions lestées', recordKg: 33.5, holder: 'Eliza Puech', year: 2026, source: 'StreetLiftings.fr' },
  { gender: 'F', categoryLabel: '+70 kg', direction: 'over', boundKg: 70, movement: 'Dips lestés', recordKg: 85, holder: 'Eliza Puech', year: 2026, source: 'StreetLiftings.fr' },
  // Hommes — Force Athlétique
  { gender: 'H', categoryLabel: '-66 kg', direction: 'under', boundKg: 66, movement: 'Squat', recordKg: 210, holder: 'Virgilio Manuel', year: 2015, source: 'FFForce' },
  { gender: 'H', categoryLabel: '-66 kg', direction: 'under', boundKg: 66, movement: 'Développé couché', recordKg: 175, holder: 'Virgilio Manuel', year: 2015, source: 'FFForce' },
  { gender: 'H', categoryLabel: '-66 kg', direction: 'under', boundKg: 66, movement: 'Soulevé de terre', recordKg: 250, holder: 'Virgilio Manuel', year: 2015, source: 'FFForce' },
  { gender: 'H', categoryLabel: '-74 kg', direction: 'under', boundKg: 74, movement: 'Squat', recordKg: 240, holder: 'Bastien Poyet', year: 2019, source: 'FFForce' },
  { gender: 'H', categoryLabel: '-74 kg', direction: 'under', boundKg: 74, movement: 'Développé couché', recordKg: 205, holder: 'Bastien Poyet', year: 2019, source: 'FFForce' },
  { gender: 'H', categoryLabel: '-74 kg', direction: 'under', boundKg: 74, movement: 'Soulevé de terre', recordKg: 285, holder: 'Bastien Poyet', year: 2019, source: 'FFForce' },
  { gender: 'H', categoryLabel: '-83 kg', direction: 'under', boundKg: 83, movement: 'Squat', recordKg: 270, holder: 'Geraud Dupont', year: 2022, source: 'FFForce' },
  { gender: 'H', categoryLabel: '-83 kg', direction: 'under', boundKg: 83, movement: 'Développé couché', recordKg: 222.5, holder: 'Geraud Dupont', year: 2022, source: 'FFForce' },
  { gender: 'H', categoryLabel: '-83 kg', direction: 'under', boundKg: 83, movement: 'Soulevé de terre', recordKg: 310, holder: 'Geraud Dupont', year: 2022, source: 'FFForce' },
  // Hommes — Street Lifting
  { gender: 'H', categoryLabel: '-66 kg', direction: 'under', boundKg: 66, movement: 'Tractions lestées', recordKg: 95, holder: 'Florent Geschlecht', year: 2026, source: 'StreetLiftings.fr' },
  { gender: 'H', categoryLabel: '-66 kg', direction: 'under', boundKg: 66, movement: 'Dips lestés', recordKg: 143.25, holder: 'Julien Capdeville', year: 2025, source: 'StreetLiftings.fr' },
  { gender: 'H', categoryLabel: '-73 kg', direction: 'under', boundKg: 73, movement: 'Tractions lestées', recordKg: 108, holder: 'Aubin Chevillard', year: 2024, source: 'StreetLiftings.fr' },
  { gender: 'H', categoryLabel: '-73 kg', direction: 'under', boundKg: 73, movement: 'Dips lestés', recordKg: 158, holder: 'Johan Sanon', year: 2025, source: 'StreetLiftings.fr' },
  { gender: 'H', categoryLabel: '-80 kg', direction: 'under', boundKg: 80, movement: 'Tractions lestées', recordKg: 106, holder: 'Aubin Chevillard', year: 2025, source: 'StreetLiftings.fr' },
  { gender: 'H', categoryLabel: '-80 kg', direction: 'under', boundKg: 80, movement: 'Dips lestés', recordKg: 161.25, holder: 'Aubin Chevillard', year: 2025, source: 'StreetLiftings.fr' },
  { gender: 'H', categoryLabel: '-87 kg', direction: 'under', boundKg: 87, movement: 'Tractions lestées', recordKg: 125, holder: 'Ludovic Adigery', year: 2026, source: 'StreetLiftings.fr' },
  { gender: 'H', categoryLabel: '-87 kg', direction: 'under', boundKg: 87, movement: 'Dips lestés', recordKg: 182.5, holder: 'Clément Vysavat', year: 2026, source: 'StreetLiftings.fr' },
  { gender: 'H', categoryLabel: '-94 kg', direction: 'under', boundKg: 94, movement: 'Tractions lestées', recordKg: 125, holder: 'Ludovic Adigery', year: 2026, source: 'StreetLiftings.fr' },
  { gender: 'H', categoryLabel: '-94 kg', direction: 'under', boundKg: 94, movement: 'Dips lestés', recordKg: 180.25, holder: 'Théo Gouttetoquet', year: 2026, source: 'StreetLiftings.fr' },
  { gender: 'H', categoryLabel: '+101 kg', direction: 'over', boundKg: 101, movement: 'Tractions lestées', recordKg: 142, holder: 'Farouk Lahiadi', year: 2025, source: 'StreetLiftings.fr' },
  { gender: 'H', categoryLabel: '+101 kg', direction: 'over', boundKg: 101, movement: 'Dips lestés', recordKg: 160, holder: 'Farouk Lahiadi', year: 2025, source: 'StreetLiftings.fr' },
];

// Picks the smallest "under" category her bodyweight fits into, or the "over" (open)
// category if she exceeds every "under" bound. Returns null on a genuine gap in the
// source data (e.g. no FA record listed above -83kg for men) rather than guessing.
export function getFranceRecord(gender: Gender, bodyweightKg: number, movement: StandardMovement): FranceRecordRow | null {
  const rows = FRANCE_RECORDS.filter(r => r.gender === gender && r.movement === movement);
  const underRows = rows.filter(r => r.direction === 'under').sort((a, b) => a.boundKg - b.boundKg);
  const fitting = underRows.find(r => bodyweightKg <= r.boundKg);
  if (fitting) return fitting;
  const overRow = rows.find(r => r.direction === 'over' && bodyweightKg > r.boundKg);
  return overRow ?? null;
}

export function getRecordMessage(record: FranceRecordRow, oneRepMax: number): string {
  const ecart = Math.round((record.recordKg - oneRepMax) * 10) / 10;
  if (ecart <= 0) {
    return `Tu as dépassé le record de France (${record.recordKg} kg, détenu par ${record.holder} en ${record.year}) !`;
  }
  return `Plus que ${ecart} kg pour atteindre le record de France (${record.recordKg} kg, détenu par ${record.holder} en ${record.year}).`;
}

// --- Standards / niveaux (percentiles), sheet "Standards & Niveaux" ---------------

export type LevelKey = 'debutant' | 'novice' | 'intermediaire' | 'avance' | 'elite';

export const LEVEL_ORDER: LevelKey[] = ['debutant', 'novice', 'intermediaire', 'avance', 'elite'];

export const LEVEL_LABELS: Record<LevelKey, { name: string; percentLabel: string }> = {
  debutant: { name: 'Débutant', percentLabel: 'top 80%' },
  novice: { name: 'Novice', percentLabel: 'top 60%' },
  intermediaire: { name: 'Intermédiaire', percentLabel: 'top 40%' },
  avance: { name: 'Avancé', percentLabel: 'top 15%' },
  elite: { name: 'Élite', percentLabel: 'top 2-5%' },
};

// Ratio = 1RM estimé / poids de corps for Squat/Développé couché/Soulevé de terre
// (multiplier of bodyweight); for Tractions/Dips lestés, ratio = charge ajoutée / poids
// de corps (SetLog.weight is already the added load, 0 = bodyweight, negative =
// assisted — see isBodyweightOptionalExercise) — both read the same way: ratio vs. a
// fraction-of-bodyweight threshold.
type LevelThresholds = Record<LevelKey, number>;

// -999 marks "no floor" — women's Tractions lestées "Débutant" tier is explicitly
// reached even assisted (negative ratio), per the source sheet ("0% (Assistées)").
const NO_FLOOR = -999;

export const LEVEL_THRESHOLDS: Record<Gender, Record<StandardMovement, LevelThresholds>> = {
  F: {
    'Squat': { debutant: 0.65, novice: 0.85, intermediaire: 1.10, avance: 1.50, elite: 1.85 },
    'Développé couché': { debutant: 0.35, novice: 0.50, intermediaire: 0.65, avance: 0.95, elite: 1.25 },
    'Soulevé de terre': { debutant: 0.80, novice: 1.05, intermediaire: 1.30, avance: 1.75, elite: 2.15 },
    'Dips lestés': { debutant: 0, novice: 0.05, intermediaire: 0.15, avance: 0.40, elite: 0.70 },
    'Tractions lestées': { debutant: NO_FLOOR, novice: 0, intermediaire: 0.10, avance: 0.30, elite: 0.50 },
  },
  H: {
    'Squat': { debutant: 1.00, novice: 1.25, intermediaire: 1.60, avance: 2.10, elite: 2.60 },
    'Développé couché': { debutant: 0.75, novice: 1.00, intermediaire: 1.25, avance: 1.65, elite: 2.05 },
    'Soulevé de terre': { debutant: 1.20, novice: 1.50, intermediaire: 1.90, avance: 2.40, elite: 3.00 },
    'Dips lestés': { debutant: 0.15, novice: 0.30, intermediaire: 0.55, avance: 0.90, elite: 1.30 },
    'Tractions lestées': { debutant: 0.10, novice: 0.20, intermediaire: 0.40, avance: 0.70, elite: 1.00 },
  },
};

// Highest tier whose threshold the ratio has reached/crossed, or null if it's below
// even the "débutant" floor (only possible for movements without a NO_FLOOR débutant).
export function getLevel(gender: Gender, movement: StandardMovement, ratio: number): LevelKey | null {
  const thresholds = LEVEL_THRESHOLDS[gender][movement];
  let reached: LevelKey | null = null;
  for (const level of LEVEL_ORDER) {
    if (ratio >= thresholds[level]) reached = level;
  }
  return reached;
}

export function getLevelMessage(level: LevelKey): string {
  const { name, percentLabel } = LEVEL_LABELS[level];
  return `Tu es dans le ${percentLabel}, niveau ${name}.`;
}
