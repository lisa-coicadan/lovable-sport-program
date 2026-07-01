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
