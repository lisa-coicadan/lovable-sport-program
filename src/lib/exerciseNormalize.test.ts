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
