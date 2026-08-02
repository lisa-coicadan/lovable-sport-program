import { describe, it, expect } from 'vitest';
import { getFranceRecord, getRecordMessage, getLevel, getLevelMessage, isForceFocusExercise } from './strengthStandards';

describe('getFranceRecord', () => {
  it('picks the smallest fitting "under" category', () => {
    const r = getFranceRecord('F', 55, 'Squat');
    expect(r?.categoryLabel).toBe('-57 kg');
    expect(r?.holder).toBe('Melodie Anthouard');
  });

  it('picks the exact boundary category (inclusive)', () => {
    const r = getFranceRecord('F', 47, 'Squat');
    expect(r?.categoryLabel).toBe('-47 kg');
  });

  it('falls back to the open "over" category above every bound', () => {
    const r = getFranceRecord('F', 75, 'Tractions lestées');
    expect(r?.categoryLabel).toBe('+70 kg');
  });

  it('returns null on a genuine gap in the source data', () => {
    // No French FA record listed above -83kg for men in the source sheet.
    expect(getFranceRecord('H', 90, 'Squat')).toBeNull();
  });
});

describe('getRecordMessage', () => {
  it('reports the remaining gap to the record', () => {
    const record = { gender: 'F' as const, categoryLabel: '-57 kg', direction: 'under' as const, boundKg: 57, movement: 'Tractions lestées' as const, recordKg: 55, holder: 'Lylia Ammour', year: 2026, source: 'StreetLiftings.fr' };
    expect(getRecordMessage(record, 32.5)).toBe('Plus que 22.5 kg pour atteindre le record de France (55 kg, détenu par Lylia Ammour en 2026).');
  });

  it('congratulates when the record is beaten', () => {
    const record = { gender: 'F' as const, categoryLabel: '-57 kg', direction: 'under' as const, boundKg: 57, movement: 'Tractions lestées' as const, recordKg: 55, holder: 'Lylia Ammour', year: 2026, source: 'StreetLiftings.fr' };
    expect(getRecordMessage(record, 60)).toContain('dépassé le record de France');
  });
});

describe('getLevel / getLevelMessage', () => {
  it('classifies a ratio into the highest tier reached', () => {
    expect(getLevel('H', 'Squat', 1.6)).toBe('intermediaire');
    expect(getLevel('H', 'Squat', 2.2)).toBe('avance');
    expect(getLevel('H', 'Squat', 2.6)).toBe('elite');
    expect(getLevel('H', 'Squat', 0.5)).toBeNull();
  });

  it('treats a negative (assisted) ratio as "débutant" for women\'s tractions lestées', () => {
    expect(getLevel('F', 'Tractions lestées', -0.2)).toBe('debutant');
  });

  it('has no such no-floor exemption for men (assisted still falls below débutant)', () => {
    expect(getLevel('H', 'Tractions lestées', -0.2)).toBeNull();
  });

  it('formats a level message', () => {
    expect(getLevelMessage('avance')).toBe('Tu es dans le top 15%, niveau Avancé.');
  });
});

describe('isForceFocusExercise', () => {
  it('is false for a standard movement with neither the toggle nor a method', () => {
    expect(isForceFocusExercise({ name: 'Squat' })).toBe(false);
  });

  it('is true for a standard movement with the manual Force toggle', () => {
    expect(isForceFocusExercise({ name: 'Squat', trainingFocus: 'force' })).toBe(true);
  });

  it('is true for a standard movement with any method, even without the manual toggle', () => {
    expect(isForceFocusExercise({ name: 'Squat', method: { type: '531', trainingMax: 100, currentCycle: 1, currentWeek: 1 } })).toBe(true);
  });

  it('is false for a non-standard movement even with a method', () => {
    expect(isForceFocusExercise({ name: 'Développé militaire', method: { type: '531', trainingMax: 50, currentCycle: 1, currentWeek: 1 } })).toBe(false);
  });

  it('matches an equipment variant of a standard movement', () => {
    expect(isForceFocusExercise({ name: 'Développé couché haltères', trainingFocus: 'force' })).toBe(true);
  });
});
