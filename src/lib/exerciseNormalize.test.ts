import { describe, it, expect } from 'vitest';
import { normalizeExerciseName, isPrTracked, PR_TRACKED_CANONICAL, splitEquipmentVariant, isBodyweightOptionalExercise, weightFieldValue, bodyweightTonnageFraction } from './exerciseNormalize';

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
    expect(splitEquipmentVariant('Développé couché barre')).toEqual({
      base: 'Développé couché', variantLabel: 'à la barre',
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

describe('weightFieldValue', () => {
  it('shows 0 for a bodyweight-only pull-up/dip set instead of blanking the field', () => {
    expect(weightFieldValue(0, 'Tractions lestées')).toBe(0);
    expect(weightFieldValue(0, 'Dips lestés')).toBe(0);
    expect(weightFieldValue(0, 'Tractions assistées')).toBe(0);
  });

  it('keeps a negative (assisted) weight visible', () => {
    expect(weightFieldValue(-15, 'Tractions lestées')).toBe(-15);
  });

  it('keeps a positive weight visible for any exercise', () => {
    expect(weightFieldValue(50, 'Squat')).toBe(50);
    expect(weightFieldValue(20, 'Tractions lestées')).toBe(20);
  });

  it('blanks a 0kg field for every other (non-bodyweight-optional) exercise', () => {
    expect(weightFieldValue(0, 'Squat')).toBe('');
    expect(weightFieldValue(0, 'Développé couché')).toBe('');
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
