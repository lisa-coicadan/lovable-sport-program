import { describe, it, expect } from 'vitest';
import { Exercise } from './types';
import {
  buildExerciseBlocks,
  getSupersetPartner,
  linkSuperset,
  unlinkSuperset,
  flattenBlocks,
} from './superset';

const exercise = (overrides: Partial<Exercise> & { id: string }): Exercise => ({
  name: overrides.id,
  sets: 3,
  reps: 10,
  ...overrides,
});

describe('linkSuperset / unlinkSuperset', () => {
  it('links two exercises with a shared group id and A/B roles, syncing set count from A', () => {
    const exercises = [
      exercise({ id: 'a', sets: 4 }),
      exercise({ id: 'b', sets: 2 }),
      exercise({ id: 'c' }),
    ];
    const linked = linkSuperset(exercises, 'a', 'b');
    const a = linked.find(e => e.id === 'a')!;
    const b = linked.find(e => e.id === 'b')!;
    const c = linked.find(e => e.id === 'c')!;

    expect(a.supersetRole).toBe('A');
    expect(b.supersetRole).toBe('B');
    expect(a.supersetGroupId).toBe(b.supersetGroupId);
    expect(b.sets).toBe(4); // synced from A
    expect(c.supersetGroupId).toBeUndefined();
  });

  it('removes the superset link fields from both partners', () => {
    const linked = linkSuperset([exercise({ id: 'a' }), exercise({ id: 'b' })], 'a', 'b');
    const groupId = linked[0].supersetGroupId!;
    const unlinked = unlinkSuperset(linked, groupId);
    unlinked.forEach(e => {
      expect(e.supersetGroupId).toBeUndefined();
      expect(e.supersetRole).toBeUndefined();
    });
  });
});

describe('getSupersetPartner', () => {
  it('returns the linked partner regardless of which id is queried', () => {
    const linked = linkSuperset([exercise({ id: 'a' }), exercise({ id: 'b' })], 'a', 'b');
    expect(getSupersetPartner(linked, 'a')?.id).toBe('b');
    expect(getSupersetPartner(linked, 'b')?.id).toBe('a');
  });

  it('returns null for an exercise with no superset link', () => {
    const exercises = [exercise({ id: 'a' })];
    expect(getSupersetPartner(exercises, 'a')).toBeNull();
  });
});

describe('buildExerciseBlocks / flattenBlocks', () => {
  it('groups a linked pair into a single superset block ordered A then B', () => {
    const linked = linkSuperset(
      [exercise({ id: 'a', name: 'Dips' }), exercise({ id: 'b', name: 'Tractions' })],
      'a',
      'b'
    );
    const blocks = buildExerciseBlocks(linked);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].isSuperset).toBe(true);
    expect(blocks[0].exerciseIds).toEqual(['a', 'b']);
  });

  it('keeps unlinked exercises as their own single blocks, preserving order', () => {
    const exercises = [exercise({ id: 'x' }), exercise({ id: 'y' })];
    const blocks = buildExerciseBlocks(exercises);
    expect(blocks).toEqual([
      { key: 'x', exerciseIds: ['x'], isSuperset: false },
      { key: 'y', exerciseIds: ['y'], isSuperset: false },
    ]);
  });

  it('flattenBlocks round-trips back to the original exercise list order', () => {
    const linked = linkSuperset(
      [exercise({ id: 'a' }), exercise({ id: 'b' }), exercise({ id: 'c' })],
      'a',
      'b'
    );
    const blocks = buildExerciseBlocks(linked);
    expect(flattenBlocks(blocks, linked).map(e => e.id)).toEqual(['a', 'b', 'c']);
  });
});
