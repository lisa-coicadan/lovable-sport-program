import { Exercise } from './types';

export function makeSupersetId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `ss-${crypto.randomUUID()}`;
  }
  return `ss-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getSupersetPartner(exercises: Exercise[], exerciseId: string): Exercise | null {
  const ex = exercises.find(e => e.id === exerciseId);
  if (!ex?.supersetGroupId) return null;
  return exercises.find(e => e.id !== exerciseId && e.supersetGroupId === ex.supersetGroupId) || null;
}

export function unlinkSuperset(exercises: Exercise[], groupId: string): Exercise[] {
  return exercises.map(e => {
    if (e.supersetGroupId !== groupId) return e;
    const { supersetGroupId, supersetRole, ...rest } = e;
    return rest as Exercise;
  });
}

export function linkSuperset(exercises: Exercise[], idA: string, idB: string): Exercise[] {
  const groupId = makeSupersetId();
  // sync sets count on the pair (use A's sets as canonical)
  const a = exercises.find(e => e.id === idA);
  const setsCount = a?.sets ?? 4;
  return exercises.map(e => {
    if (e.id === idA) return { ...e, supersetGroupId: groupId, supersetRole: 'A' as const, sets: setsCount };
    if (e.id === idB) return { ...e, supersetGroupId: groupId, supersetRole: 'B' as const, sets: setsCount };
    return e;
  });
}

// Build ordered blocks so each superset counts as one draggable unit.
export interface ExerciseBlock {
  key: string;              // stable id (supersetGroupId or exercise id)
  exerciseIds: string[];    // 1 for single, 2 for superset (A then B)
  isSuperset: boolean;
}

export function buildExerciseBlocks(exercises: Exercise[]): ExerciseBlock[] {
  const seen = new Set<string>();
  const blocks: ExerciseBlock[] = [];
  exercises.forEach(ex => {
    if (seen.has(ex.id)) return;
    if (ex.supersetGroupId) {
      const partner = exercises.find(e => e.id !== ex.id && e.supersetGroupId === ex.supersetGroupId);
      const a = ex.supersetRole === 'B' && partner ? partner : ex;
      const b = a === ex ? partner : ex;
      const ids = b ? [a.id, b.id] : [a.id];
      ids.forEach(id => seen.add(id));
      blocks.push({ key: ex.supersetGroupId, exerciseIds: ids, isSuperset: !!b });
    } else {
      seen.add(ex.id);
      blocks.push({ key: ex.id, exerciseIds: [ex.id], isSuperset: false });
    }
  });
  return blocks;
}

export function flattenBlocks(blocks: ExerciseBlock[], exercises: Exercise[]): Exercise[] {
  const map = new Map(exercises.map(e => [e.id, e]));
  return blocks.flatMap(b => b.exerciseIds.map(id => map.get(id)).filter(Boolean) as Exercise[]);
}

