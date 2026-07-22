import { describe, it, expect } from 'vitest';
import { parseSessionNotes } from './notesParser';

describe('parseSessionNotes', () => {
  it('parses the session name from the first non-exercise line', () => {
    const result = parseSessionNotes('Push\nDéveloppé couché : 3x8');
    expect(result.sessionName).toBe('Push');
  });

  it('strips a "séance N :" prefix from the session name', () => {
    expect(parseSessionNotes('séance 1 : Push\nDéveloppé couché : 3x8').sessionName).toBe('Push');
    expect(parseSessionNotes('Séance : Pull\nTractions : 3x8').sessionName).toBe('Pull');
  });

  it('always treats the first non-blank line as the session name, even if it looks like an exercise', () => {
    const result = parseSessionNotes('Développé couché : 3x8');
    expect(result.sessionName).toBe('Développé couché : 3x8');
    expect(result.exercises).toHaveLength(0);
  });

  it('accepts "Nom : SxR", "Nom SxR" and "SxR Nom" order', () => {
    const result = parseSessionNotes(
      'Push\nDéveloppé couché : 3x8\nDéveloppé militaire 4x12\n3x10 Overhead press'
    );
    expect(result.exercises).toEqual([
      { name: 'Développé couché', sets: 3, reps: 8 },
      { name: 'Développé militaire', sets: 4, reps: 12 },
      { name: 'Overhead press', sets: 3, reps: 10 },
    ]);
  });

  it('recognizes weight only when followed by "kg"', () => {
    const result = parseSessionNotes(
      'Push\nDéveloppé militaire : 4x12 @10kg\ndev militaire 4x12 à 10kg\nSquat 3x5 40'
    );
    expect(result.exercises[0]).toEqual({ name: 'Développé militaire', sets: 4, reps: 12, weight: 10 });
    expect(result.exercises[1]).toEqual({ name: 'dev militaire', sets: 4, reps: 12, weight: 10 });
    // "40" with no "kg" must NOT be read as a weight
    expect(result.exercises[2]).toEqual({ name: 'Squat 40', sets: 3, reps: 5 });
  });

  it('parses a superset where both sides state their own sets x reps', () => {
    const result = parseSessionNotes(
      'Push\nOverhead press 3x12 + Élévations latérales 3x10'
    );
    expect(result.exercises).toHaveLength(2);
    const [a, b] = result.exercises;
    expect(a).toMatchObject({ name: 'Overhead press', sets: 3, reps: 12, supersetRole: 'A' });
    expect(b).toMatchObject({ name: 'Élévations latérales', sets: 3, reps: 10, supersetRole: 'B' });
    expect(a.supersetGroupId).toBe(b.supersetGroupId);
  });

  it('parses a superset where the second clause has only a rep count (inherits sets from the first)', () => {
    const result = parseSessionNotes(
      'Push\n3x 12 overhead press + 10 élévations laterales'
    );
    expect(result.exercises).toHaveLength(2);
    const [a, b] = result.exercises;
    expect(a).toMatchObject({ name: 'overhead press', sets: 3, reps: 12 });
    expect(b).toMatchObject({ name: 'élévations laterales', sets: 3, reps: 10 });
    expect(a.supersetGroupId).toBe(b.supersetGroupId);
  });

  it('flags lines that match no pattern instead of guessing', () => {
    const result = parseSessionNotes(
      'Push\nDéveloppé couché : 3x8\nne pas oublier de bien manger avant\nune ligne sans aucun chiffre'
    );
    expect(result.exercises).toHaveLength(1);
    expect(result.unrecognizedLines).toEqual([
      'ne pas oublier de bien manger avant',
      'une ligne sans aucun chiffre',
    ]);
  });

  it('accepts bullet markers on exercise lines', () => {
    const result = parseSessionNotes('Push\n- Développé couché : 3x8\n* Dips : 3x10\n• Squat 4x5');
    expect(result.exercises.map(e => e.name)).toEqual(['Développé couché', 'Dips', 'Squat']);
  });

  it('ignores blank lines', () => {
    const result = parseSessionNotes('Push\n\n\nDéveloppé couché : 3x8\n\n');
    expect(result.exercises).toHaveLength(1);
    expect(result.unrecognizedLines).toHaveLength(0);
  });

  it('handles a fully empty input', () => {
    const result = parseSessionNotes('');
    expect(result).toEqual({ sessionName: null, exercises: [], unrecognizedLines: [] });
  });

  it('reads a lone "Nx" as sets with reps left unknown (0, to fill in)', () => {
    const result = parseSessionNotes('Pull\n4x tractions');
    expect(result.exercises).toEqual([{ name: 'tractions', sets: 4, reps: 0 }]);
  });

  it('reads a lone "xN" as reps with sets left unknown (0, to fill in)', () => {
    const result = parseSessionNotes('Pull\nx12 tractions');
    expect(result.exercises).toEqual([{ name: 'tractions', sets: 0, reps: 12 }]);
  });

  it('strips checklist-style brackets from any line, including the session name', () => {
    const result = parseSessionNotes('[ ] Push\n[x] Développé couché : 3x8\n[]Dips : 3x10');
    expect(result.sessionName).toBe('Push');
    expect(result.exercises).toEqual([
      { name: 'Développé couché', sets: 3, reps: 8 },
      { name: 'Dips', sets: 3, reps: 10 },
    ]);
  });
});
