import { describe, it, expect } from 'vitest';
import { normalizeExerciseName, isPrTracked, PR_TRACKED_CANONICAL, splitEquipmentVariant, isBodyweightOptionalExercise, formatWeightDisplay, bodyweightTonnageFraction, resolveSetVariant, resolveSetVariantName, detectEquipmentFromName, detectUnilateralFromName, withNameDetectedTags } from './exerciseNormalize';

describe('normalizeExerciseName', () => {
  it('maps spelling variants to the same canonical name', () => {
    expect(normalizeExerciseName('squat')).toBe('Squat');
    expect(normalizeExerciseName('Back Squat')).toBe('Squat');
    expect(normalizeExerciseName('5/3/1 Squat')).toBe('Squat');
    expect(normalizeExerciseName('SQUAT')).toBe('Squat');
  });

  it('isolates Squat variants as distinct analytical entities (never merged with Squat)', () => {
    expect(normalizeExerciseName('Front Squat')).toBe('Front Squat');
    expect(normalizeExerciseName('front squat')).toBe('Front Squat');
    expect(normalizeExerciseName('Hack Squat')).toBe('Hack Squat');
    expect(normalizeExerciseName('Split Squat')).toBe('Split Squat');
    expect(normalizeExerciseName('Bulgarian Split Squat')).toBe('Bulgarian Split Squat');
    expect(normalizeExerciseName('Goblet Squat')).toBe('Goblet Squat');
    // and none of them collapses to plain Squat
    expect(normalizeExerciseName('front squat')).not.toBe('Squat');
    expect(normalizeExerciseName('hack squat')).not.toBe('Squat');
  });

  it('groups Squat pendule with Hack Squat, not with plain Squat', () => {
    expect(normalizeExerciseName('Squat pendule')).toBe('Hack Squat');
    expect(normalizeExerciseName('squat pendule')).not.toBe('Squat');
  });

  it('groups Leg press with Hack Squat, so renaming "Hack squat ou leg press" to just "Leg press" keeps its history', () => {
    expect(normalizeExerciseName('Hack squat ou leg press')).toBe('Hack Squat');
    expect(normalizeExerciseName('Leg press')).toBe('Hack Squat');
    expect(normalizeExerciseName('Presse à cuisses')).toBe('Hack Squat');
  });

  it('isolates single-leg press from bilateral Leg press/Hack Squat (not comparable loads)', () => {
    expect(normalizeExerciseName('Single leg press')).toBe('Leg press unilatéral');
    expect(normalizeExerciseName('Single press')).toBe('Leg press unilatéral');
    expect(normalizeExerciseName('single leg press')).not.toBe('Hack Squat');
  });

  it('maps pompes/push-up spelling variants to the same canonical name', () => {
    expect(normalizeExerciseName('pompes')).toBe('Pompes');
    expect(normalizeExerciseName('Pompe')).toBe('Pompes');
    expect(normalizeExerciseName('push up')).toBe('Pompes');
    expect(normalizeExerciseName('push-up')).toBe('Pompes');
  });


  it('maps barbell-qualified variants to the canonical (barbell) name', () => {
    expect(normalizeExerciseName('Développé couché barre')).toBe('Développé couché');
    expect(normalizeExerciseName('bench press bb')).toBe('Développé couché');
  });

  it('recognizes bare "Bench" and "Deadlift" (no barre/bb suffix) as the same canonical lift', () => {
    expect(normalizeExerciseName('Bench')).toBe('Développé couché');
    expect(normalizeExerciseName('bench')).toBe('Développé couché');
    expect(normalizeExerciseName('Deadlift')).toBe('Soulevé de terre');
    expect(normalizeExerciseName('deadlift')).toBe('Soulevé de terre');
  });

  it('keeps non-barbell equipment variants distinct from the canonical lift', () => {
    expect(normalizeExerciseName('Développé couché haltères')).toBe('Développé couché haltères');
    expect(normalizeExerciseName('dev couche dumbbell')).toBe('Développé couché haltères');
    expect(normalizeExerciseName('Développé couché machine')).toBe('Développé couché machine');
  });

  it('normalizes accents, case and separators before matching', () => {
    expect(normalizeExerciseName('  Tractions-lestées  ')).toBe('Tractions lestées');
    expect(normalizeExerciseName('pull-up')).toBe('Tractions lestées');
  });

  it('returns the trimmed original name for unrecognized exercises', () => {
    expect(normalizeExerciseName('  Curl biceps  ')).toBe('Curl biceps');
  });

  it('handles empty input', () => {
    expect(normalizeExerciseName('')).toBe('');
  });

  it('expands common abbreviations even for non-canonical exercises', () => {
    expect(normalizeExerciseName('dev militaire')).toBe('Développé militaire');
    expect(normalizeExerciseName('Développé militaire')).toBe('Développé militaire');
    expect(normalizeExerciseName('DEV MILITAIRE')).toBe('Développé militaire');
    expect(normalizeExerciseName('élévation lat')).toBe('Élévation latérale');
    expect(normalizeExerciseName('row uni')).toBe('Row unilatéral');
    expect(normalizeExerciseName('row unilatéral')).toBe('Row unilatéral');
  });

  it('preserves accents on words untouched by abbreviation expansion', () => {
    expect(normalizeExerciseName('rowing bûcheron')).toBe('Rowing bûcheron');
    expect(normalizeExerciseName('ROWING BÛCHERON')).toBe('Rowing bûcheron');
  });

  it('never treats a case difference as a different exercise', () => {
    expect(normalizeExerciseName('curl biceps')).toBe(normalizeExerciseName('CURL BICEPS'));
  });

  it('generalizes equipment-variant suffixing to any exercise, not just canonical lifts', () => {
    expect(normalizeExerciseName('curl haltere')).toBe('Curl haltères');
    expect(normalizeExerciseName('Curl haltère')).toBe('Curl haltères');
    expect(normalizeExerciseName('curl poulie')).toBe('Curl poulie');
    expect(normalizeExerciseName('curl machine')).toBe('Curl machine');
  });

  it('treats the barbell variant of a non-canonical exercise as the plain/default name', () => {
    expect(normalizeExerciseName('curl barre')).toBe('Curl');
  });

  it('does not auto-convert equipment variants into a single shared number (kept distinct)', () => {
    expect(normalizeExerciseName('curl haltere')).not.toBe(normalizeExerciseName('curl barre'));
  });
});

describe('isPrTracked', () => {
  it('tracks PRs only for barbell/weighted canonical variants', () => {
    expect(isPrTracked('Squat')).toBe(true);
    expect(isPrTracked('back squat')).toBe(true);
    expect(isPrTracked('Développé couché haltères')).toBe(false);
  });

  it('does not track PRs for exercises outside the canonical list (e.g. RDL)', () => {
    expect(isPrTracked('RDL')).toBe(false);
    expect(PR_TRACKED_CANONICAL).not.toContain('RDL');
  });

  it('does not track PRs for unrecognized exercises', () => {
    expect(isPrTracked('Curl biceps')).toBe(false);
  });
});

describe('splitEquipmentVariant', () => {
  it('splits a canonical lift with an equipment suffix into base + variant label', () => {
    expect(splitEquipmentVariant('Développé couché haltères')).toEqual({
      base: 'Développé couché', variantLabel: 'aux haltères',
    });
    // Must equal EQUIPMENT_LABELS.barre exactly (not a separate "à la barre" phrasing) —
    // resolveSetVariant relies on this to unify legacy name-inferred barbell sets with
    // sets tagged via the structured `equipment: 'barre'` field into the same group.
    expect(splitEquipmentVariant('Développé couché barre')).toEqual({
      base: 'Développé couché', variantLabel: 'Barre',
    });
    expect(splitEquipmentVariant('Développé couché machine')).toEqual({
      base: 'Développé couché', variantLabel: 'à la machine',
    });
  });

  it('generalizes to any exercise, not just canonical lifts', () => {
    expect(splitEquipmentVariant('curl haltere')).toEqual({ base: 'Curl', variantLabel: 'aux haltères' });
    expect(splitEquipmentVariant('curl poulie')).toEqual({ base: 'Curl', variantLabel: 'à la poulie' });
  });

  it('returns a null variant label when no equipment is mentioned', () => {
    expect(splitEquipmentVariant('Développé couché')).toEqual({ base: 'Développé couché', variantLabel: null });
    expect(splitEquipmentVariant('rowing bûcheron')).toEqual({ base: 'Rowing bûcheron', variantLabel: null });
  });

  it('handles empty input', () => {
    expect(splitEquipmentVariant('')).toEqual({ base: '', variantLabel: null });
  });

  it('recognizes the "assisté" equipment variant, distinct from "élastique"', () => {
    expect(splitEquipmentVariant('Tractions assistées')).toEqual({ base: 'Tractions lestées', variantLabel: 'assisté' });
    expect(splitEquipmentVariant('Dips assisté')).toEqual({ base: 'Dips lestés', variantLabel: 'assisté' });
    expect(splitEquipmentVariant('Tractions élastique')).toEqual({ base: 'Tractions lestées', variantLabel: 'à l\'élastique' });
  });
});

describe('Muscle up recognition', () => {
  it('normalizes "muscle up", "MU" and equipment variants to the canonical name', () => {
    expect(normalizeExerciseName('muscle up')).toBe('Muscle up');
    expect(normalizeExerciseName('MU')).toBe('Muscle up');
    expect(normalizeExerciseName('muscleup')).toBe('Muscle up');
    expect(normalizeExerciseName('Muscle up élastique')).toBe('Muscle up élastique');
    expect(normalizeExerciseName('Muscle up assisté')).toBe('Muscle up assisté');
    expect(splitEquipmentVariant('Muscle up élastique')).toEqual({ base: 'Muscle up', variantLabel: 'à l\'élastique' });
  });

  it('is bodyweight-optional (like tractions/dips), full bodyweight fraction', () => {
    expect(isBodyweightOptionalExercise('Muscle up')).toBe(true);
    expect(bodyweightTonnageFraction('Muscle up')).toBe(1);
  });

  it('is NOT in the France-record-tracked canonical list — no official record for it', () => {
    expect(PR_TRACKED_CANONICAL).not.toContain('Muscle up');
    expect(isPrTracked('Muscle up')).toBe(false);
  });
});

describe('isBodyweightOptionalExercise', () => {
  it('is true for tractions and dips regardless of equipment suffix', () => {
    expect(isBodyweightOptionalExercise('Tractions')).toBe(true);
    expect(isBodyweightOptionalExercise('Tractions lestées')).toBe(true);
    expect(isBodyweightOptionalExercise('Tractions assistées')).toBe(true);
    expect(isBodyweightOptionalExercise('Tractions élastique')).toBe(true);
    expect(isBodyweightOptionalExercise('Dips')).toBe(true);
    expect(isBodyweightOptionalExercise('Dips assistés')).toBe(true);
  });

  it('is true for pompes', () => {
    expect(isBodyweightOptionalExercise('Pompes')).toBe(true);
    expect(isBodyweightOptionalExercise('pompes')).toBe(true);
    expect(isBodyweightOptionalExercise('push up')).toBe(true);
  });

  it('is false for every other exercise', () => {
    expect(isBodyweightOptionalExercise('Squat')).toBe(false);
    expect(isBodyweightOptionalExercise('Développé couché')).toBe(false);
    expect(isBodyweightOptionalExercise('Curl biceps')).toBe(false);
  });
});

describe('bodyweightTonnageFraction', () => {
  it('is 1 (full bodyweight) for tractions/dips', () => {
    expect(bodyweightTonnageFraction('Tractions lestées')).toBe(1);
    expect(bodyweightTonnageFraction('Dips assistés')).toBe(1);
  });

  it('is 0.65 for pompes', () => {
    expect(bodyweightTonnageFraction('Pompes')).toBe(0.65);
    expect(bodyweightTonnageFraction('pompes')).toBe(0.65);
  });

  it('is 0 for every other exercise', () => {
    expect(bodyweightTonnageFraction('Squat')).toBe(0);
    expect(bodyweightTonnageFraction('Développé couché')).toBe(0);
  });
});

// A completed set is "loggable" (counted in history/PRs) when weight > 0, OR the
// exercise is bodyweight-optional — this is the exact predicate reused throughout
// WorkoutTab/ExerciseHistory/SessionDetailView (weight <= 0 means "not filled in" for
// every other movement, but 0 or negative/assisted is a real value here).
const isLoggableSet = (name: string, weight: number) => weight > 0 || isBodyweightOptionalExercise(name);

describe('formatWeightDisplay', () => {
  it('prefixes "pdc" before the sign for a weighted bodyweight-optional set', () => {
    expect(formatWeightDisplay(10, 'Tractions lestées')).toBe('pdc +10 kg');
    expect(formatWeightDisplay(-5, 'Dips lestés')).toBe('pdc -5 kg');
  });

  it('shows plain "pdc" (no sign) for a strict bodyweight rep', () => {
    expect(formatWeightDisplay(0, 'Tractions lestées')).toBe('pdc');
  });

  it('leaves every other exercise as a plain "<weight> kg"', () => {
    expect(formatWeightDisplay(60, 'Squat')).toBe('60 kg');
    expect(formatWeightDisplay(0, 'Développé couché')).toBe('0 kg');
  });
});

describe('assisted (negative-weight) pull-ups/dips end to end', () => {
  it('counts a bodyweight-only set (0kg) as loggable', () => {
    expect(isLoggableSet('Tractions lestées', 0)).toBe(true);
  });

  it('counts an assisted set (negative weight) as loggable', () => {
    expect(isLoggableSet('Tractions assistées', -15)).toBe(true);
    expect(isLoggableSet('Dips élastique', -20)).toBe(true);
  });

  it('excludes an unfilled 0kg set for every other exercise', () => {
    expect(isLoggableSet('Squat', 0)).toBe(false);
  });
});

describe('resolveSetVariant', () => {
  it('uses the structured fields when present, even if the name suggests something else', () => {
    expect(resolveSetVariant({ exerciseName: 'Développé couché', equipment: 'halteres', unilateral: true }))
      .toEqual({ equipmentLabel: 'Haltères', unilateral: true });
  });

  it('treats an explicit equipment of undefined-but-unilateral-true as structured (no name fallback)', () => {
    expect(resolveSetVariant({ exerciseName: 'Développé couché haltères', unilateral: true }))
      .toEqual({ equipmentLabel: null, unilateral: true });
  });

  it('falls back to name-text parsing when neither structured field is present', () => {
    expect(resolveSetVariant({ exerciseName: 'Développé couché haltères' }))
      .toEqual({ equipmentLabel: 'aux haltères', unilateral: false });
    expect(resolveSetVariant({ exerciseName: 'Développé couché' }))
      .toEqual({ equipmentLabel: null, unilateral: false });
  });
});

describe('resolveSetVariantName', () => {
  it('matches splitEquipmentVariant/resolveSetVariant when name and structured fields agree', () => {
    expect(resolveSetVariantName({ exerciseName: 'Développé couché haltères' })).toBe('Développé couché aux haltères');
    expect(resolveSetVariantName({ exerciseName: 'Développé couché' })).toBe('Développé couché');
  });

  it('gives priority to the structured fields over the name text (the StatsTab/ExerciseHistory conflict this fixes)', () => {
    // Name says nothing about equipment, structured field says haltères — must NOT be
    // grouped as the plain barbell/canonical "Développé couché" the way
    // normalizeExerciseName(name) alone would. Structured path uses the plain
    // EQUIPMENT_LABELS ("Haltères"), not the text-fallback's phrased "aux haltères".
    expect(resolveSetVariantName({ exerciseName: 'Développé couché', equipment: 'halteres' }))
      .toBe('Développé couché Haltères');
    // Name says haltères, structured field explicitly overrides to barre — must land in
    // the barbell bucket, matching ExerciseHistory/SessionSummary's France-record logic.
    expect(resolveSetVariantName({ exerciseName: 'Développé couché haltères', equipment: 'barre' }))
      .toBe('Développé couché Barre');
  });

  it('composes unilateral into the label', () => {
    expect(resolveSetVariantName({ exerciseName: 'Développé couché', equipment: 'halteres', unilateral: true }))
      .toBe('Développé couché Haltères · unilatéral');
  });
});

describe('detectEquipmentFromName', () => {
  it('detects the 5 structured equipment values from keywords in the name', () => {
    expect(detectEquipmentFromName('Curl haltères')).toBe('halteres');
    expect(detectEquipmentFromName('Développé couché barre')).toBe('barre');
    expect(detectEquipmentFromName('Développé couché Smith')).toBe('smith');
    expect(detectEquipmentFromName('Curl machine')).toBe('machine');
    expect(detectEquipmentFromName('Curl poulie')).toBe('poulie');
  });

  it('returns undefined for keywords with no structured equivalent (élastique/assisté)', () => {
    expect(detectEquipmentFromName('Tractions élastique')).toBeUndefined();
    expect(detectEquipmentFromName('Dips assisté')).toBeUndefined();
  });

  it('returns undefined when no equipment keyword is present', () => {
    expect(detectEquipmentFromName('Curl biceps')).toBeUndefined();
    expect(detectEquipmentFromName('')).toBeUndefined();
  });
});

describe('detectUnilateralFromName', () => {
  it('detects "uni"/"unilat"/"unilatéral" tokens regardless of accent/case', () => {
    expect(detectUnilateralFromName('Curl uni')).toBe(true);
    expect(detectUnilateralFromName('Row unilat')).toBe(true);
    expect(detectUnilateralFromName('Rowing unilatéral')).toBe(true);
    expect(detectUnilateralFromName('ROWING UNILATERAL')).toBe(true);
  });

  it('is false when no such keyword is present', () => {
    expect(detectUnilateralFromName('Développé couché haltères')).toBe(false);
    expect(detectUnilateralFromName('')).toBe(false);
  });
});

describe('withNameDetectedTags', () => {
  it('fills in equipment/unilateral from the name when both are still unset', () => {
    expect(withNameDetectedTags({ name: 'Curl haltères' })).toEqual({ name: 'Curl haltères', equipment: 'halteres', unilateral: undefined });
    expect(withNameDetectedTags({ name: 'Row unilatéral' })).toEqual({ name: 'Row unilatéral', equipment: undefined, unilateral: true });
  });

  it('never overrides an already-explicit manual choice, even if it disagrees with the name', () => {
    expect(withNameDetectedTags({ name: 'Développé couché haltères', equipment: 'barre' }))
      .toEqual({ name: 'Développé couché haltères', equipment: 'barre', unilateral: undefined });
    expect(withNameDetectedTags({ name: 'Curl haltères', unilateral: false }))
      .toEqual({ name: 'Curl haltères', equipment: 'halteres', unilateral: false });
  });

  it('is a no-op when nothing is detected and nothing was set', () => {
    const ex = { name: 'Curl biceps' };
    expect(withNameDetectedTags(ex)).toEqual({ name: 'Curl biceps', equipment: undefined, unilateral: undefined });
  });
});
