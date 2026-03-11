import { useState, useMemo, useRef } from 'react';
import { SessionLog, AppData, calculate1RM } from '@/lib/types';
import { ArrowLeft, ChevronRight, Share2, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface SessionSummaryProps {
  session: SessionLog;
  previousSessions?: SessionLog[];
  onSave: (session: SessionLog) => void;
  onBack: () => void;
  readOnly?: boolean;
}

const SessionSummary = ({ session, previousSessions = [], onSave, onBack, readOnly = false }: SessionSummaryProps) => {
  const [duration, setDuration] = useState(session.duration || 0);
  const [difficulty, setDifficulty] = useState(session.difficulty || 5);
  const [notes, setNotes] = useState(session.notes || '');
  const recapRef = useRef<HTMLDivElement>(null);

  const completedSets = session.sets.filter(s => s.completed);
  const totalVolume = completedSets.reduce((acc, s) => acc + s.weight * s.reps, 0);

  // Group completed sets by exercise
  const groupedExercises = useMemo(() => {
    const map: Record<string, typeof completedSets> = {};
    completedSets.forEach(s => {
      if (!map[s.exerciseName]) map[s.exerciseName] = [];
      map[s.exerciseName].push(s);
    });
    return Object.entries(map);
  }, [completedSets]);

  // Progression vs last session of same type
  const progressions = useMemo(() => {
    const lastSession = previousSessions
      .filter(s => s.workoutTypeId === session.workoutTypeId && s.id !== session.id)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!lastSession) return {};

    const result: Record<string, { weightDiff: number; repDiff: number; e1rmDiff: number }> = {};
    
    groupedExercises.forEach(([name, sets]) => {
      const bestSet = sets.reduce((best, s) => {
        const e1rm = calculate1RM(s.weight, s.reps);
        return e1rm > calculate1RM(best.weight, best.reps) ? s : best;
      }, sets[0]);
      
      const lastSets = lastSession.sets.filter(s => s.exerciseName === name && s.completed && s.weight > 0);
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
  }, [previousSessions, session, groupedExercises]);

  const handleSave = () => {
    onSave({ ...session, duration, difficulty, notes });
  };

  const handleShare = async () => {
    const text = `${session.workoutTypeName} — ${new Date(session.date + 'T00:00:00').toLocaleDateString('default', { month: 'long', day: 'numeric', year: 'numeric' })}\n\n` +
      groupedExercises.map(([name, sets]) => {
        const best = sets.reduce((b, s) => calculate1RM(s.weight, s.reps) > calculate1RM(b.weight, b.reps) ? s : b, sets[0]);
        return `${name}: ${best.weight}kg × ${best.reps} (1RM: ${calculate1RM(best.weight, best.reps)}kg)`;
      }).join('\n') +
      `\n\nDuration: ${duration || session.duration || '?'} min | RPE: ${difficulty || session.difficulty || '?'}/10` +
      (notes ? `\n${notes}` : '');

    if (navigator.share) {
      try { await navigator.share({ text }); } catch {}
    } else {
      try { await navigator.clipboard.writeText(text); } catch {}
    }
  };

  const sessionDate = new Date(session.date + 'T00:00:00').toLocaleDateString('default', {
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
            {readOnly ? session.workoutTypeName : 'Session Complete! 🎉'}
          </h1>
          <p className="text-xs text-muted-foreground">{sessionDate}</p>
        </div>
        <button onClick={handleShare} className="touch-target p-2 text-primary">
          <Share2 size={18} />
        </button>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="glass-card p-3 text-center">
          <p className="text-2xl font-bold text-primary">{completedSets.length}</p>
          <p className="text-[10px] text-muted-foreground">Sets Done</p>
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

      {/* Exercises with 1RM and progression */}
      {groupedExercises.length > 0 && (
        <div className="space-y-3 mb-6">
          {groupedExercises.map(([name, sets]) => {
            const best = sets.reduce((b, s) => calculate1RM(s.weight, s.reps) > calculate1RM(b.weight, b.reps) ? s : b, sets[0]);
            const e1rm = calculate1RM(best.weight, best.reps);
            const prog = progressions[name];

            return (
              <div key={name} className="glass-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-foreground">{name}</h3>
                  {e1rm > 0 && (
                    <span className="text-xs text-warning font-medium">1RM: {e1rm} kg</span>
                  )}
                </div>
                <div className="space-y-1.5 mb-2">
                  {sets.map((s, i) => (
                    <div key={i} className="flex items-center justify-between bg-secondary rounded-lg px-3 py-2">
                      <span className="text-xs text-muted-foreground">Set {i + 1}</span>
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
                      {prog.weightDiff === 0 && prog.repDiff === 0 && 'Same as last time'}
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
            <label className="text-xs text-muted-foreground mb-1.5 block">Duration (minutes)</label>
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
              <label className="text-xs text-muted-foreground">How did you feel?</label>
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
              <span>Easy</span>
              <span>Hard</span>
            </div>
          </div>

          {/* Notes */}
          <div className="glass-card p-4 mb-6">
            <label className="text-xs text-muted-foreground mb-1.5 block">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="How did the session go?"
              className="w-full bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none resize-none min-h-[80px]"
            />
          </div>

          <button
            onClick={handleSave}
            className="w-full bg-primary text-primary-foreground font-semibold py-4 rounded-2xl touch-target text-lg flex items-center justify-center gap-2 transition-transform active:scale-95"
          >
            Save Session <ChevronRight size={20} />
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
