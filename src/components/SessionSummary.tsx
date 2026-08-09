import { useState, useMemo, useRef } from 'react';
import { SessionLog, SetLog, WorkoutType, Gender, BodyWeightLog, EQUIPMENT_LABELS, ExerciseMethod } from '@/lib/types';
import { isBodyweightOptionalExercise, splitEquipmentVariant, resolveSetVariant, formatWeightDisplay } from '@/lib/exerciseNormalize';
import { computeSetTonnage, resolveBodyWeightAtDate, computeBodyweightAdjustedE1RM } from '@/lib/tonnage';
import { STANDARD_MOVEMENTS, LEVEL_ORDER, LevelKey, getFranceRecord, getRecordMessage, getLevel, getLevelMessage } from '@/lib/strengthStandards';
import { getClusterConfig } from '@/lib/cluster';
import { getEmomConfig } from '@/lib/emom';
import { ArrowLeft, ChevronRight, Share2, TrendingUp, TrendingDown, Minus, Trophy } from 'lucide-react';

// One-line summary of what a method's config actually means for this session — 531's
// week/cycle (the one piece of state that actually advances between sessions), Cluster's
// round×mini-series shape, EMOM's duration/pace — so the recap says more than just "1RM".
function methodDetailLabel(method: ExerciseMethod): string {
  if (method.type === '531') return `5/3/1 — semaine ${method.currentWeek}/4, cycle ${method.currentCycle}`;
  if (method.type === 'cluster') {
    const { numSeries, miniSeries } = getClusterConfig(method);
    return `Cluster — ${numSeries} séries de ${miniSeries.length} mini-séries`;
  }
  const { durationMinutes, repsPerMinute, percentage } = getEmomConfig(method);
  return `EMOM — ${durationMinutes} min, ${repsPerMinute} reps/min @ ${Math.round(percentage * 100)}% TM`;
}

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
  const [difficulty, setDifficulty] = useState(session.difficulty || 5);
  const [notes, setNotes] = useState(session.notes || '');
  const recapRef = useRef<HTMLDivElement>(null);

  const completedSets = session.sets.filter(s => s.completed);
  const sessionBodyWeight = useMemo(
    () => resolveBodyWeightAtDate(bodyWeightLogs, session.date),
    [bodyWeightLogs, session.date]
  );
  // Warm-up sets stay in completedSets (grouped/displayed like any other) but don't
  // count toward tonnage — a warm-up ramp isn't real training volume.
  const totalVolume = completedSets.filter(s => !s.isWarmup).reduce((acc, s) => acc + computeSetTonnage(s, sessionBodyWeight), 0);

  // 1RM is only a meaningful headline number for exercises actively following a
  // structured method (5/3/1, Cluster, EMOM) — for everything else, volume (already
  // compared above vs last session / vs average) is the metric that matters. Keyed by
  // name -> the method itself (not just a Set) so its week/cycle/config can be shown too.
  const methodByName = useMemo(() => {
    const map = new Map<string, ExerciseMethod>();
    workoutTypes.forEach(t => t.exercises.forEach(e => { if (e.method) map.set(e.name, e.method); }));
    return map;
  }, [workoutTypes]);
  const methodExerciseNames = useMemo(() => new Set(methodByName.keys()), [methodByName]);

  // Group completed sets by exercise
  const groupedExercises = useMemo(() => {
    const map: Record<string, typeof completedSets> = {};
    completedSets.forEach(s => {
      if (!map[s.exerciseName]) map[s.exerciseName] = [];
      map[s.exerciseName].push(s);
    });
    return Object.entries(map);
  }, [completedSets]);

  // "Séries faites" counts logical rounds, not raw SetLog rows — an EMOM's whole per-
  // minute block is ONE round (its mini-reps aren't independent sets), and a Cluster
  // round is its configured mini-series bundled together, not each mini-series counted
  // on its own. Counting every EMOM minute / cluster mini-series as its own "série" wildly
  // overstated the total for these two methods. Tonnage is unaffected (already a sum).
  const logicalSetsCount = useMemo(() => {
    let count = 0;
    groupedExercises.forEach(([name, exSets]) => {
      const method = methodByName.get(name);
      if (method?.type === 'emom') {
        if (exSets.length > 0) count += 1;
        return;
      }
      if (method?.type === 'cluster') {
        const miniLen = getClusterConfig(method).miniSeries.length || 1;
        count += new Set(exSets.map(s => Math.floor((s.setNumber - 1) / miniLen))).size;
        return;
      }
      count += exSets.length;
    });
    return count;
  }, [groupedExercises, methodByName]);

  // A deload or PR-test session's tonnage isn't comparable to a normal session (deload
  // deliberately cuts load/volume, a PR test swaps working sets for a handful of near-max
  // singles) — excluded from the reference pool so a normal session is never silently
  // compared against one, and skipped as the "current" session's own comparison below.
  const isSpecialSession = !!session.isDeload || session.sets.some(s => s.isTestMax);
  const comparableSessions = useMemo(
    () => previousSessions.filter(s => !s.isDeload && !s.sets.some(x => x.isTestMax)),
    [previousSessions]
  );

  // Last session of same type (for volume comparison and per-exercise progression)
  const lastSameTypeSession = useMemo(() => {
    return comparableSessions
      .filter(s => s.workoutTypeId === session.workoutTypeId && s.id !== session.id)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
  }, [comparableSessions, session]);

  const lastTotalVolume = useMemo(() => {
    if (!lastSameTypeSession) return 0;
    const bw = resolveBodyWeightAtDate(bodyWeightLogs, lastSameTypeSession.date);
    return lastSameTypeSession.sets
      .filter(s => s.completed && !s.isWarmup)
      .reduce((acc, s) => acc + computeSetTonnage(s, bw), 0);
  }, [lastSameTypeSession, bodyWeightLogs]);

  const volumePct = lastTotalVolume > 0
    ? Math.round(((totalVolume - lastTotalVolume) / lastTotalVolume) * 100)
    : null;

  // Historical average tonnage across ALL past sessions of the same type (excluding this one),
  // so a big session that beats one bad previous session doesn't feel like a real breakthrough
  // if it's still below her long-term average.
  const { avgTonnage, avgSampleSize, avgPct } = useMemo(() => {
    const past = comparableSessions.filter(s => s.workoutTypeId === session.workoutTypeId && s.id !== session.id);
    if (past.length === 0) return { avgTonnage: 0, avgSampleSize: 0, avgPct: null as number | null };
    const total = past.reduce((acc, s) => {
      const bw = resolveBodyWeightAtDate(bodyWeightLogs, s.date);
      return acc + s.sets.filter(x => x.completed && !x.isWarmup).reduce((a, x) => a + computeSetTonnage(x, bw), 0);
    }, 0);
    const avg = total / past.length;
    return {
      avgTonnage: Math.round(avg),
      avgSampleSize: past.length,
      avgPct: avg > 0 ? Math.round(((totalVolume - avg) / avg) * 100) : null,
    };
  }, [comparableSessions, session.workoutTypeId, session.id, totalVolume, bodyWeightLogs]);

  // Progression vs last session of same type
  const progressions = useMemo(() => {
    if (!lastSameTypeSession) return {};

    const result: Record<string, { weightDiff: number; repDiff: number; e1rmDiff: number }> = {};
    const lastBodyWeight = resolveBodyWeightAtDate(bodyWeightLogs, lastSameTypeSession.date);

    groupedExercises.forEach(([name, sets]) => {
      const bestSet = sets.reduce((best, s) => {
        const e1rm = computeBodyweightAdjustedE1RM(s, sessionBodyWeight);
        return e1rm > computeBodyweightAdjustedE1RM(best, sessionBodyWeight) ? s : best;
      }, sets[0]);

      const lastSets = lastSameTypeSession.sets.filter(s => s.exerciseName === name && s.completed && (s.weight > 0 || isBodyweightOptionalExercise(name)));
      if (lastSets.length === 0) return;

      const lastBest = lastSets.reduce((best, s) => {
        const e1rm = computeBodyweightAdjustedE1RM(s, lastBodyWeight);
        return e1rm > computeBodyweightAdjustedE1RM(best, lastBodyWeight) ? s : best;
      }, lastSets[0]);

      result[name] = {
        weightDiff: bestSet.weight - lastBest.weight,
        repDiff: bestSet.reps - lastBest.reps,
        e1rmDiff: Math.round((computeBodyweightAdjustedE1RM(bestSet, sessionBodyWeight) - computeBodyweightAdjustedE1RM(lastBest, lastBodyWeight)) * 10) / 10,
      };
    });
    return result;
  }, [lastSameTypeSession, groupedExercises, sessionBodyWeight, bodyWeightLogs]);

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
      // Barbell (or untagged, which defaults to barbell) only, same rule as the
      // ExerciseHistory panel — reads the structured equipment/unilateral tag
      // (resolveSetVariant), not just whether the exercise NAME happens to contain an
      // equipment word, so a set tagged "Haltères" via the in-session chips doesn't get
      // miscounted as a barbell PR just because its name is still "Développé couché".
      const qualifies = (s: SetLog) => {
        if (!s.completed || splitEquipmentVariant(s.exerciseName).base !== movement) return false;
        const variant = resolveSetVariant(s);
        if (variant.unilateral) return false;
        if (variant.equipmentLabel !== null && variant.equipmentLabel !== EQUIPMENT_LABELS.barre) return false;
        return s.weight > 0 || isBodyweightOptionalExercise(s.exerciseName);
      };

      const newSets = session.sets.filter(qualifies);
      if (newSets.length === 0) return;
      const newPR = Math.max(...newSets.map(s => computeBodyweightAdjustedE1RM(s, sessionBodyWeight)));

      // Each past set needs the bodyweight AT ITS OWN session date, not a single shared
      // value — computeBodyweightAdjustedE1RM is a no-op for non-bodyweight-optional
      // movements, so this stays correct for Squat/DC/SDT too.
      const prevSets = previousSessions.flatMap(s => {
        const bw = resolveBodyWeightAtDate(bodyWeightLogs, s.date);
        return s.sets.filter(qualifies).map(set => computeBodyweightAdjustedE1RM(set, bw));
      });
      const previousPR = prevSets.length > 0 ? Math.max(...prevSets) : 0;
      if (newPR <= previousPR) return;

      const levelBefore = getLevel(gender, movement, previousPR / latestBodyweight);
      const levelAfter = getLevel(gender, movement, newPR / latestBodyweight);
      if (!levelAfter) return;
      const beforeIdx = levelBefore ? LEVEL_ORDER.indexOf(levelBefore) : -1;
      if (LEVEL_ORDER.indexOf(levelAfter) <= beforeIdx) return;

      results.push({ movement, level: levelAfter, record: getFranceRecord(gender, latestBodyweight, movement), newPR });
    });
    return results;
  }, [gender, latestBodyweight, session.sets, previousSessions, sessionBodyWeight, bodyWeightLogs]);

  const handleSave = () => {
    onSave({ ...session, duration: duration || 60, difficulty, notes });
  };

  const handleShare = async () => {
    const text = `${session.workoutTypeName} — ${new Date(session.date + 'T00:00:00').toLocaleDateString('fr-FR', { month: 'long', day: 'numeric', year: 'numeric' })}\n\n` +
      groupedExercises.map(([name, sets]) => {
        const best = sets.reduce((b, s) => computeBodyweightAdjustedE1RM(s, sessionBodyWeight) > computeBodyweightAdjustedE1RM(b, sessionBodyWeight) ? s : b, sets[0]);
        return `${name}: ${formatWeightDisplay(best.weight, name)} × ${best.reps} (1RM: ${computeBodyweightAdjustedE1RM(best, sessionBodyWeight)}kg)`;
      }).join('\n') +
      `\n\nDurée : ${duration || session.duration || 60} min | RPE : ${difficulty || session.difficulty || '?'}/10` +
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
          <p className="text-2xl font-bold text-primary">{logicalSetsCount}</p>
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

      {/* Deload/PR-test sessions skip the tonnage comparisons below entirely — the number
          means something different by design, comparing it would just be misleading. */}
      {isSpecialSession && (
        <div className="glass-card p-4 mb-6 flex items-center gap-3">
          <span className="text-xl shrink-0">{session.isDeload ? '↘' : '🎯'}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-muted-foreground">
              {session.isDeload ? 'Séance deload' : 'Séance avec test de PR'}
            </p>
            <p className="text-[10px] text-muted-foreground">Le volume n'est pas comparable à une séance normale.</p>
          </div>
        </div>
      )}

      {/* Total tonnage vs last session of same type */}
      {!isSpecialSession && volumePct !== null && (
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
      {!isSpecialSession && avgPct !== null && avgSampleSize > 0 && (
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
            const best = sets.reduce((b, s) => computeBodyweightAdjustedE1RM(s, sessionBodyWeight) > computeBodyweightAdjustedE1RM(b, sessionBodyWeight) ? s : b, sets[0]);
            const e1rm = computeBodyweightAdjustedE1RM(best, sessionBodyWeight);
            const prog = progressions[name];
            const method = methodByName.get(name);
            const hasMethod = !!method;
            const methodColorClass = method?.type === 'cluster' ? 'text-accent-purple' : method?.type === 'emom' ? 'text-accent-blue' : 'text-primary';

            return (
              <div key={name} className="glass-card p-4">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-semibold text-foreground">{name}</h3>
                  {hasMethod && e1rm > 0 && (
                    <span className="text-xs text-primary font-medium">1RM: {e1rm} kg</span>
                  )}
                </div>
                {method && (
                  <p className={`text-[10px] font-medium mb-1.5 ${methodColorClass}`}>{methodDetailLabel(method)}</p>
                )}
                <div className="space-y-1.5 mb-2">
                  {sets.map((s, i) => (
                    <div key={i} className="flex items-center justify-between bg-secondary rounded-lg px-3 py-2">
                      <span className="text-xs text-muted-foreground">Série {i + 1}</span>
                      <span className="text-sm text-foreground font-mono">{formatWeightDisplay(s.weight, name)} × {s.reps}</span>
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

          {/* Difficulty 1-10 */}
          <div className="glass-card p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs text-muted-foreground">Comment tu t'es sentie ?</label>
              <span className="text-sm font-bold text-foreground">{difficulty}/10</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
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
            <span className="text-sm font-bold text-foreground">{session.difficulty}/10</span>
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
