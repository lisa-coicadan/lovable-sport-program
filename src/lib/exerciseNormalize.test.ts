import { describe, it, expect } from 'vitest';
import { normalizeExerciseName, isPrTracked, PR_TRACKED_CANONICAL } from './exerciseNormalize';

describe('normalizeExerciseName', () => {
  it('maps spelling variants to the same canonical name', () => {
    expect(normalizeExerciseName('squat')).toBe('Squat');
    expect(normalizeExerciseName('Back Squat')).toBe('Squat');
    expect(normalizeExerciseName('5/3/1 Squat')).toBe('Squat');
    expect(normalizeExerciseName('SQUAT')).toBe('Squat');
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
