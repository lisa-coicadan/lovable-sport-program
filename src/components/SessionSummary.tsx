import { useState, useMemo, useRef } from 'react';
import { SessionLog, WorkoutType, calculate1RM, Gender, BodyWeightLog } from '@/lib/types';
import { isBodyweightOptionalExercise, splitEquipmentVariant } from '@/lib/exerciseNormalize';
import { STANDARD_MOVEMENTS, LEVEL_ORDER, LevelKey, getFranceRecord, getRecordMessage, getLevel, getLevelMessage } from '@/lib/strengthStandards';
import { ArrowLeft, ChevronRight, Share2, TrendingUp, TrendingDown, Minus, Trophy } from 'lucide-react';

interface SessionSummaryProps {
  session: SessionLog;
  previousSessions?: SessionLog[];
  workoutTypes?: WorkoutType[];
  gender?: Gender;
  bodyWeightLogs?: BodyWeightLog[];
  onSave: (session: SessionLog) => void;
  onBack: () => void;
  readOnly?: boolean;
}

const SessionSummary = ({ session, previousSessions = [], workoutTypes = [], gender, bodyWeightLogs = [], onSave, onBack, readOnly = false }: SessionSummaryProps) => {
  const [duration, setDuration] = useState(session.duration || 0);
  const [difficulty, setDifficulty] = useState(session.difficulty || 3);
  const [notes, setNotes] = useState(session.notes || '');
  const recapRef = useRef<HTMLDivElement>(null);

  const completedSets = session.sets.filter(s => s.completed);
  const totalVolume = completedSets.reduce((acc, s) => acc + s.weight * s.reps, 0);

  // 1RM is only a meaningful headline number for exercises actively following a
  // structured method (5/3/1, Cluster, EMOM) — for everything else, volume (already
  // compared above vs last session / vs average) is the metric that matters.
  const methodExerciseNames = useMemo(() => {
    const names = new Set<string>();
    workoutTypes.forEach(t => t.exercises.forEach(e => { if (e.method) names.add(e.name); }));
    return names;
  }, [workoutTypes]);

  // Group completed sets by exercise
  const groupedExercises = useMemo(() => {
    const map: Record<string, typeof completedSets> = {};
    completedSets.forEach(s => {
      if (!map[s.exerciseName]) map[s.exerciseName] = [];
      map[s.exerciseName].push(s);
    });
    return Object.entries(map);
  }, [completedSets]);

  // Last session of same type (for volume comparison and per-exercise progression)
  const lastSameTypeSession = useMemo(() => {
    return previousSessions
      .filter(s => s.workoutTypeId === session.workoutTypeId && s.id !== session.id)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
  }, [previousSessions, session]);

  const lastTotalVolume = useMemo(() => {
    if (!lastSameTypeSession) return 0;
    return lastSameTypeSession.sets
      .filter(s => s.completed)
      .reduce((acc, s) => acc + s.weight * s.reps, 0);
  }, [lastSameTypeSession]);

  const volumePct = lastTotalVolume > 0
    ? Math.round(((totalVolume - lastTotalVolume) / lastTotalVolume) * 100)
    : null;

  // Historical average tonnage across ALL past sessions of the same type (excluding this one),
  // so a big session that beats one bad previous session doesn't feel like a real breakthrough
  // if it's still below her long-term average.
  const { avgTonnage, avgSampleSize, avgPct } = useMemo(() => {
    const past = previousSessions.filter(s => s.workoutTypeId === session.workoutTypeId && s.id !== session.id);
    if (past.length === 0) return { avgTonnage: 0, avgSampleSize: 0, avgPct: null as number | null };
    const total = past.reduce((acc, s) => acc + s.sets.filter(x => x.completed).reduce((a, x) => a + x.weight * x.reps, 0), 0);
    const avg = total / past.length;
    return {
      avgTonnage: Math.round(avg),
      avgSampleSize: past.length,
      avgPct: avg > 0 ? Math.round(((totalVolume - avg) / avg) * 100) : null,
    };
  }, [previousSessions, session.workoutTypeId, session.id, totalVolume]);

  // Progression vs last session of same type
  const progressions = useMemo(() => {
    if (!lastSameTypeSession) return {};

    const result: Record<string, { weightDiff: number; repDiff: number; e1rmDiff: number }> = {};

    groupedExercises.forEach(([name, sets]) => {
      const bestSet = sets.reduce((best, s) => {
        const e1rm = calculate1RM(s.weight, s.reps);
        return e1rm > calculate1RM(best.weight, best.reps) ? s : best;
      }, sets[0]);

      const lastSets = lastSameTypeSession.sets.filter(s => s.exerciseName === name && s.completed && (s.weight > 0 || isBodyweightOptionalExercise(name)));
      if (lastSets.length === 0) return;

      const lastBest = lastSets.reduce((best, s) => {
        const e1rm = calculate1RM(s.weight, s.reps);
        return e1rm > calculate1RM(best.weight, best.reps) ? s : best;
      }, lastSets[0]);

      result[name] = {
        weightDiff: bestSet.weight - lastBest.weight,
        repDiff: bestSet.reps - lastBest.reps,
        e1rmDiff: Math.round((calculate1RM(bestSet.weight, bestSet.reps) - calculate1RM(lastBest.weight, lastBest.reps)) * 10) / 10,
      };
    });
    return result;
  }, [lastSameTypeSession, groupedExercises]);

  // Level-up detection (amélioration uniquement) — for each of the 5 movements the
  // Record de France / niveau feature recognizes (src/lib/strengthStandards.ts), compare
  // the tier reached BEFORE this session (best e1RM across previousSessions) vs AFTER
  // (best e1RM including this session's new sets). Only the barbell/no-equipment variant
  // counts, same rule as the ExerciseHistory panel. Silently produces nothing if she
  // hasn't set her gender/bodyweight in Réglages yet.
  const latestBodyweight = useMemo(() => {
    if (bodyWeightLogs.length === 0) return null;
    return bodyWeightLogs.slice().sort((a, b) => b.date.localeCompare(a.date))[0].weight;
  }, [bodyWeightLogs]);

  const levelUps = useMemo(() => {
    if (!gender || !latestBodyweight) return [];
    const results: { movement: string; level: LevelKey; record: ReturnType<typeof getFranceRecord>; newPR: number }[] = [];
    STANDARD_MOVEMENTS.forEach(movement => {
      const isDefaultVariant = (exerciseName: string) => {
        const split = splitEquipmentVariant(exerciseName);
        return split.base === movement && split.variantLabel === null;
      };
      const qualifies = (exerciseName: string, completed: boolean, weight: number) =>
        completed && isDefaultVariant(exerciseName) && (weight > 0 || isBodyweightOptionalExercise(exerciseName));

      const newSets = session.sets.filter(s => qualifies(s.exerciseName, s.completed, s.weight));
      if (newSets.length === 0) return;
      const newPR = Math.max(...newSets.map(s => calculate1RM(s.weight, s.reps)));

      const prevSets = previousSessions.flatMap(s => s.sets.filter(x => qualifies(x.exerciseName, x.completed, x.weight)));
      const previousPR = prevSets.length > 0 ? Math.max(...prevSets.map(s => calculate1RM(s.weight, s.reps))) : 0;
      if (newPR <= previousPR) return;

      const levelBefore = getLevel(gender, movement, previousPR / latestBodyweight);
      const levelAfter = getLevel(gender, movement, newPR / latestBodyweight);
      if (!levelAfter) return;
      const beforeIdx = levelBefore ? LEVEL_ORDER.indexOf(levelBefore) : -1;
      if (LEVEL_ORDER.indexOf(levelAfter) <= beforeIdx) return;

      results.push({ movement, level: levelAfter, record: getFranceRecord(gender, latestBodyweight, movement), newPR });
    });
    return results;
  }, [gender, latestBodyweight, session.sets, previousSessions]);

  const handleSave = () => {
    onSave({ ...session, duration: duration || 60, difficulty, notes });
  };

  const handleShare = async () => {
    const text = `${session.workoutTypeName} — ${new Date(session.date + 'T00:00:00').toLocaleDateString('fr-FR', { month: 'long', day: 'numeric', year: 'numeric' })}\n\n` +
      groupedExercises.map(([name, sets]) => {
        const best = sets.reduce((b, s) => calculate1RM(s.weight, s.reps) > calculate1RM(b.weight, b.reps) ? s : b, sets[0]);
        return `${name}: ${best.weight}kg × ${best.reps} (1RM: ${calculate1RM(best.weight, best.reps)}kg)`;
      }).join('\n') +
      `\n\nDurée : ${duration || session.duration || 60} min | RPE : ${difficulty || session.difficulty || '?'}/5` +
      (notes ? `\n${notes}` : '');

    if (navigator.share) {
      try { await navigator.share({ text }); } catch { /* user cancelled the share sheet */ }
    } else {
      try { await navigator.clipboard.writeText(text); } catch { /* clipboard permission denied */ }
    }
  };

  const sessionDate = new Date(session.date + 'T00:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });

  return (
    <div className="px-4 pt-12 pb-24 animate-slide-up" ref={recapRef}>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-muted-foreground touch-target p-1">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-foreground">
            {readOnly ? session.workoutTypeName : 'Séance terminée ! 🎉'}
          </h1>
          <p className="text-xs text-muted-foreground">{sessionDate}</p>
        </div>
        <button onClick={handleShare} className="touch-target p-2 text-primary">
          <Share2 size={18} />
        </button>
      </div>

      {!readOnly && levelUps.length > 0 && (
        <div className="glass-card p-4 mb-6 border border-primary/40 bg-primary/5">
          <div className="flex items-center gap-1.5 mb-2">
            <Trophy size={16} className="text-primary" />
            <h3 className="text-sm font-bold text-primary">Nouveau niveau !</h3>
          </div>
          <div className="space-y-2.5">
            {levelUps.map(({ movement, level, record, newPR }) => (
              <div key={movement}>
                <p className="text-sm text-foreground font-semibold">
                  {movement} — {getLevelMessage(level)}
                </p>
                {record && (
                  <p className="text-xs text-muted-foreground">
                    Catégorie {record.categoryLabel} : {getRecordMessage(record, newPR)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="glass-card p-3 text-center">
          <p className="text-2xl font-bold text-primary">{completedSets.length}</p>
          <p className="text-[10px] text-muted-foreground">Séries faites</p>
        </div>
        <div className="glass-card p-3 text-center">
          <p className="text-2xl font-bold text-foreground">{Math.round(totalVolume)}</p>
          <p className="text-[10px] text-muted-foreground">Total kg</p>
        </div>
        <div className="glass-card p-3 text-center">
          <p className="text-2xl font-bold text-foreground">{readOnly ? (session.duration || '—') : duration}</p>
          <p className="text-[10px] text-muted-foreground">Minutes</p>
        </div>
      </div>

      {/* Total tonnage vs last session of same type */}
      {volumePct !== null && (
        <div className="glass-card p-4 mb-6 flex items-center gap-3">
          {volumePct > 0 ? (
            <TrendingUp size={20} className="text-success shrink-0" />
          ) : volumePct < 0 ? (
            <TrendingDown size={20} className="text-destructive shrink-0" />
          ) : (
            <Minus size={20} className="text-muted-foreground shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-bold ${volumePct > 0 ? 'text-success' : volumePct < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
              {volumePct > 0 ? '+' : ''}{volumePct}% de volume
            </p>
            <p className="text-[10px] text-muted-foreground">
              vs dernière séance {session.workoutTypeName} ({Math.round(lastTotalVolume)} kg)
            </p>
          </div>
        </div>
      )}

      {/* Total tonnage vs historical average of same type */}
      {avgPct !== null && avgSampleSize > 0 && (
        <div className="glass-card p-4 mb-6 flex items-center gap-3">
          {avgPct > 0 ? (
            <TrendingUp size={20} className="text-success shrink-0" />
          ) : avgPct < 0 ? (
            <TrendingDown size={20} className="text-destructive shrink-0" />
          ) : (
            <Minus size={20} className="text-muted-foreground shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-bold ${avgPct > 0 ? 'text-success' : avgPct < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
              {avgPct > 0 ? '+' : ''}{avgPct}% vs moyenne
            </p>
            <p className="text-[10px] text-muted-foreground">
              Moyenne {session.workoutTypeName} : {avgTonnage} kg sur {avgSampleSize} séance{avgSampleSize > 1 ? 's' : ''}
            </p>
          </div>
        </div>
      )}

      {/* Exercises with 1RM and progression */}
      {groupedExercises.length > 0 && (
        <div className="space-y-3 mb-6">
          {groupedExercises.map(([name, sets]) => {
            const best = sets.reduce((b, s) => calculate1RM(s.weight, s.reps) > calculate1RM(b.weight, b.reps) ? s : b, sets[0]);
            const e1rm = calculate1RM(best.weight, best.reps);
            const prog = progressions[name];
            const hasMethod = methodExerciseNames.has(name);

            return (
              <div key={name} className="glass-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-foreground">{name}</h3>
                  {hasMethod && e1rm > 0 && (
                    <span className="text-xs text-primary font-medium">1RM: {e1rm} kg</span>
                  )}
                </div>
                <div className="space-y-1.5 mb-2">
                  {sets.map((s, i) => (
                    <div key={i} className="flex items-center justify-between bg-secondary rounded-lg px-3 py-2">
                      <span className="text-xs text-muted-foreground">Série {i + 1}</span>
                      <span className="text-sm text-foreground font-mono">{s.weight} kg × {s.reps}</span>
                    </div>
                  ))}
                </div>
                {prog && (
                  <div className="flex items-center gap-2 mt-2">
                    {prog.e1rmDiff > 0 ? (
                      <TrendingUp size={12} className="text-success" />
                    ) : prog.e1rmDiff < 0 ? (
                      <TrendingDown size={12} className="text-destructive" />
                    ) : (
                      <Minus size={12} className="text-muted-foreground" />
                    )}
                    <span className={`text-xs font-medium ${
                      prog.e1rmDiff > 0 ? 'text-success' : prog.e1rmDiff < 0 ? 'text-destructive' : 'text-muted-foreground'
                    }`}>
                      {prog.weightDiff !== 0 && `${prog.weightDiff > 0 ? '+' : ''}${prog.weightDiff}kg`}
                      {prog.repDiff !== 0 && ` ${prog.repDiff > 0 ? '+' : ''}${prog.repDiff} rep${Math.abs(prog.repDiff) > 1 ? 's' : ''}`}
                      {prog.weightDiff === 0 && prog.repDiff === 0 && 'Identique à la dernière fois'}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!readOnly && (
        <>
          {/* Duration */}
          <div className="glass-card p-4 mb-4">
            <label className="text-xs text-muted-foreground mb-1.5 block">Durée (minutes)</label>
            <input
              type="number"
              value={duration || ''}
              onChange={e => setDuration(e.target.value === '' ? 0 : parseInt(e.target.value))}
              className="w-full bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none font-mono text-center text-lg"
            />
          </div>

          {/* Difficulty 1-5 */}
          <div className="glass-card p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs text-muted-foreground">Comment tu t'es sentie ?</label>
              <span className="text-sm font-bold text-foreground">{difficulty}/5</span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              value={difficulty}
              onChange={e => setDifficulty(parseInt(e.target.value))}
              className="w-full accent-primary h-2"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>Facile</span>
              <span>Difficile</span>
            </div>
          </div>

          {/* Notes */}
          <div className="glass-card p-4 mb-6">
            <label className="text-xs text-muted-foreground mb-1.5 block">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Comment s'est passée la séance ?"
              className="w-full bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none resize-none min-h-[80px]"
            />
          </div>

          <button
            onClick={handleSave}
            className="w-full btn-neon font-semibold py-4 rounded-2xl touch-target text-lg flex items-center justify-center gap-2 transition-transform active:scale-95"
          >
            Enregistrer la séance <ChevronRight size={20} />
          </button>
        </>
      )}

      {readOnly && session.difficulty && (
        <div className="glass-card p-4 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">RPE</span>
            <span className="text-sm font-bold text-foreground">{session.difficulty}/5</span>
          </div>
        </div>
      )}

      {readOnly && session.notes && (
        <div className="glass-card p-4 mb-4">
          <p className="text-xs text-muted-foreground mb-1">Notes</p>
          <p className="text-sm text-foreground">{session.notes}</p>
        </div>
      )}
    </div>
  );
};

export default SessionSummary;
