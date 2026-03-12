import { useState, useMemo, useCallback } from 'react';
import { SessionLog, SetLog, AppData, calculate1RM } from '@/lib/types';
import { ArrowLeft, Trash2, Pencil, Share2, Plus, X, TrendingUp, TrendingDown, Minus, Check, ChevronRight } from 'lucide-react';

interface SessionDetailViewProps {
  session: SessionLog;
  data: AppData;
  onClose: () => void;
  onUpdate: (updated: SessionLog) => void;
  onDelete?: (sessionId: string) => void;
}

const SessionDetailView = ({ session, data, onClose, onUpdate, onDelete }: SessionDetailViewProps) => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [editing, setEditing] = useState(false);

  // Edit state
  const [editSets, setEditSets] = useState<SetLog[]>([]);
  const [editDuration, setEditDuration] = useState(0);
  const [editDifficulty, setEditDifficulty] = useState(5);
  const [editNotes, setEditNotes] = useState('');
  const [editDate, setEditDate] = useState('');

  // Only completed sets for display
  const completedSets = useMemo(() => session.sets.filter(s => s.completed), [session.sets]);
  const totalVolume = completedSets.reduce((acc, s) => acc + s.weight * s.reps, 0);

  const getLastPerformance = useCallback((exerciseName: string, excludeSessionId: string) => {
    for (let i = data.sessions.length - 1; i >= 0; i--) {
      const s = data.sessions[i];
      if (s.id === excludeSessionId) continue;
      const matchingSets = s.sets.filter(set => set.exerciseName === exerciseName && set.completed && set.weight > 0);
      if (matchingSets.length > 0) {
        const best = matchingSets.reduce((b, set) => set.weight > b.weight ? set : b, matchingSets[0]);
        return { weight: best.weight, reps: best.reps, date: s.date };
      }
    }
    return null;
  }, [data.sessions]);

  // Group sets by exercise
  const groupSets = (sets: SetLog[]) => {
    const map: Record<string, SetLog[]> = {};
    sets.forEach(s => {
      if (!map[s.exerciseName]) map[s.exerciseName] = [];
      map[s.exerciseName].push(s);
    });
    return Object.entries(map);
  };

  const groupedExercises = useMemo(() => groupSets(completedSets), [completedSets]);

  // Progression vs last session of same type
  const progressions = useMemo(() => {
    const lastSession = data.sessions
      .filter(s => s.workoutTypeId === session.workoutTypeId && s.id !== session.id)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!lastSession) return {};

    const result: Record<string, { weightDiff: number; repDiff: number; e1rmDiff: number }> = {};
    groupedExercises.forEach(([name, sets]) => {
      const bestSet = sets.reduce((best, s) => calculate1RM(s.weight, s.reps) > calculate1RM(best.weight, best.reps) ? s : best, sets[0]);
      const lastSets = lastSession.sets.filter(s => s.exerciseName === name && s.completed && s.weight > 0);
      if (lastSets.length === 0) return;
      const lastBest = lastSets.reduce((best, s) => calculate1RM(s.weight, s.reps) > calculate1RM(best.weight, best.reps) ? s : best, lastSets[0]);
      result[name] = {
        weightDiff: bestSet.weight - lastBest.weight,
        repDiff: bestSet.reps - lastBest.reps,
        e1rmDiff: Math.round((calculate1RM(bestSet.weight, bestSet.reps) - calculate1RM(lastBest.weight, lastBest.reps)) * 10) / 10,
      };
    });
    return result;
  }, [data.sessions, session, groupedExercises]);

  const sessionDate = new Date(session.date + 'T00:00:00').toLocaleDateString('default', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const getColorForType = () => {
    const wt = data.workoutTypes.find(w => w.id === session.workoutTypeId);
    return wt?.color || '84 81% 44%';
  };

  // --- Edit mode helpers ---
  const enterEditMode = () => {
    setEditSets([...completedSets]);
    setEditDuration(session.duration || 0);
    setEditDifficulty(session.difficulty || 5);
    setEditNotes(session.notes || '');
    setEditDate(session.date);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const saveEdit = () => {
    onUpdate({
      ...session,
      date: editDate,
      sets: editSets,
      duration: editDuration,
      difficulty: editDifficulty,
      notes: editNotes,
    });
    setEditing(false);
  };

  const updateEditSet = (index: number, field: 'reps' | 'weight', value: string) => {
    const updated = [...editSets];
    updated[index][field] = value === '' ? 0 : (field === 'weight' ? parseFloat(value) || 0 : parseInt(value) || 0);
    setEditSets(updated);
  };

  const removeEditSet = (index: number) => {
    setEditSets(prev => prev.filter((_, i) => i !== index));
  };

  const addEditSet = (exerciseId: string, exerciseName: string) => {
    const existing = editSets.filter(s => s.exerciseId === exerciseId);
    const lastSet = existing[existing.length - 1];
    let insertIndex = editSets.length;
    for (let i = editSets.length - 1; i >= 0; i--) {
      if (editSets[i].exerciseId === exerciseId) { insertIndex = i + 1; break; }
    }
    const newSet: SetLog = {
      exerciseId,
      exerciseName,
      setNumber: existing.length + 1,
      reps: lastSet?.reps || 10,
      weight: lastSet?.weight || 0,
      completed: true,
    };
    const updated = [...editSets];
    updated.splice(insertIndex, 0, newSet);
    setEditSets(updated);
  };

  const addNewExercise = () => {
    const newId = `edit-${Date.now()}`;
    setEditSets(prev => [...prev, {
      exerciseId: newId,
      exerciseName: 'New Exercise',
      setNumber: 1,
      reps: 10,
      weight: 0,
      completed: true,
    }]);
  };

  const updateEditExerciseName = (exerciseId: string, name: string) => {
    setEditSets(prev => prev.map(s => s.exerciseId === exerciseId ? { ...s, exerciseName: name } : s));
  };

  const removeExercise = (exerciseId: string) => {
    setEditSets(prev => prev.filter(s => s.exerciseId !== exerciseId));
  };

  // --- Share ---
  const handleShare = async () => {
    const text = `${session.workoutTypeName} — ${sessionDate}\n\n` +
      groupedExercises.map(([name, sets]) => {
        const best = sets.reduce((b, s) => calculate1RM(s.weight, s.reps) > calculate1RM(b.weight, b.reps) ? s : b, sets[0]);
        return `${name}: ${best.weight}kg × ${best.reps} (1RM: ${calculate1RM(best.weight, best.reps)}kg)`;
      }).join('\n') +
      `\n\nDuration: ${session.duration || '?'} min | RPE: ${session.difficulty || '?'}/10` +
      (session.notes ? `\n${session.notes}` : '');

    if (navigator.share) {
      try { await navigator.share({ text }); } catch {}
    } else {
      try { await navigator.clipboard.writeText(text); } catch {}
    }
  };

  // =========== EDIT MODE ===========
  if (editing) {
    const editGrouped = groupSets(editSets);
    return (
      <div className="px-4 pt-12 pb-24 animate-slide-up">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={cancelEdit} className="text-muted-foreground touch-target p-1">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-bold text-foreground flex-1">Edit Session</h1>
        </div>

        {/* Date */}
        <div className="glass-card p-4 mb-4">
          <label className="text-xs text-muted-foreground mb-1.5 block">Date</label>
          <input
            type="date"
            value={editDate}
            onChange={e => setEditDate(e.target.value)}
            className="w-full bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none"
          />
        </div>

        {/* Exercises */}
        <div className="space-y-4 mb-4">
          {editGrouped.map(([name, sets]) => {
            const exerciseId = sets[0].exerciseId;
            const isTemp = exerciseId.startsWith('edit-');
            const globalIndices = sets.map(s => editSets.indexOf(s));

            return (
              <div key={exerciseId} className="glass-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  {isTemp ? (
                    <input
                      value={name}
                      onChange={e => updateEditExerciseName(exerciseId, e.target.value)}
                      className="bg-transparent text-foreground font-semibold outline-none flex-1 text-sm"
                      placeholder="Exercise name"
                    />
                  ) : (
                    <h3 className="text-sm font-semibold text-foreground flex-1">{name}</h3>
                  )}
                  <button onClick={() => removeExercise(exerciseId)} className="text-destructive p-1">
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="space-y-2">
                  {sets.map((s, localIdx) => {
                    const gi = globalIndices[localIdx];
                    return (
                      <div key={gi} className="flex items-center gap-2 bg-secondary/50 rounded-xl px-3 py-2.5">
                        <span className="text-xs text-muted-foreground w-8">S{localIdx + 1}</span>
                        <input
                          type="number"
                          value={s.weight || ''}
                          onChange={e => updateEditSet(gi, 'weight', e.target.value)}
                          className="w-16 bg-transparent text-foreground text-sm text-center outline-none font-mono"
                          placeholder="kg"
                        />
                        <span className="text-muted-foreground text-xs">kg ×</span>
                        <input
                          type="number"
                          value={s.reps || ''}
                          onChange={e => updateEditSet(gi, 'reps', e.target.value)}
                          className="w-12 bg-transparent text-foreground text-sm text-center outline-none font-mono"
                          placeholder="reps"
                        />
                        <button onClick={() => removeEditSet(gi)} className="text-muted-foreground p-1 active:text-destructive ml-auto">
                          <X size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={() => addEditSet(exerciseId, name)}
                  className="flex items-center gap-1 text-primary text-xs font-medium py-1.5 mt-2"
                >
                  <Plus size={12} /> Add set
                </button>
              </div>
            );
          })}
        </div>

        <button
          onClick={addNewExercise}
          className="w-full glass-card p-3 flex items-center justify-center gap-2 text-primary text-sm font-medium mb-4 transition-transform active:scale-95"
        >
          <Plus size={16} /> Add exercise
        </button>

        {/* Duration */}
        <div className="glass-card p-4 mb-4">
          <label className="text-xs text-muted-foreground mb-1.5 block">Duration (minutes)</label>
          <input
            type="number"
            value={editDuration || ''}
            onChange={e => setEditDuration(e.target.value === '' ? 0 : parseInt(e.target.value))}
            className="w-full bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none font-mono text-center text-lg"
          />
        </div>

        {/* RPE */}
        <div className="glass-card p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs text-muted-foreground">RPE</label>
            <span className="text-sm font-bold text-foreground">{editDifficulty}/10</span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            value={editDifficulty}
            onChange={e => setEditDifficulty(parseInt(e.target.value))}
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
            value={editNotes}
            onChange={e => setEditNotes(e.target.value)}
            placeholder="How did the session go?"
            className="w-full bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none resize-none min-h-[80px]"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={cancelEdit}
            className="flex-1 bg-secondary text-secondary-foreground font-semibold py-4 rounded-2xl text-sm transition-transform active:scale-95"
          >
            Cancel
          </button>
          <button
            onClick={saveEdit}
            className="flex-1 bg-primary text-primary-foreground font-semibold py-4 rounded-2xl text-sm flex items-center justify-center gap-2 transition-transform active:scale-95"
          >
            Save Changes <Check size={18} />
          </button>
        </div>
      </div>
    );
  }

  // =========== READ-ONLY MODE ===========
  return (
    <div className="px-4 pt-12 pb-24 animate-slide-up">
      {/* Delete confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 animate-fade-in">
          <div className="glass-card p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold text-foreground mb-2">Delete session?</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Are you sure you want to delete this session? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 bg-secondary text-secondary-foreground font-medium py-2.5 rounded-xl text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => { onDelete?.(session.id); onClose(); }}
                className="flex-1 bg-destructive text-destructive-foreground font-medium py-2.5 rounded-xl text-sm"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <button onClick={onClose} className="text-muted-foreground touch-target p-1">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-foreground flex-1">{session.workoutTypeName}</h1>
        {onDelete && (
          <button
            onClick={() => setShowConfirm(true)}
            className="p-2 text-destructive hover:bg-destructive/10 rounded-xl transition-colors"
          >
            <Trash2 size={20} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 mb-6 ml-9">
        <p className="text-xs text-muted-foreground">{sessionDate}</p>
        <span
          className="text-[10px] font-medium px-2 py-0.5 rounded-full"
          style={{
            backgroundColor: `hsl(${getColorForType()} / 0.15)`,
            color: `hsl(${getColorForType()})`,
          }}
        >
          {session.workoutTypeName}
        </span>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="glass-card p-3 text-center">
          <p className="text-2xl font-bold text-primary">{completedSets.length}</p>
          <p className="text-[10px] text-muted-foreground">Sets</p>
        </div>
        <div className="glass-card p-3 text-center">
          <p className="text-2xl font-bold text-foreground">{Math.round(totalVolume)}</p>
          <p className="text-[10px] text-muted-foreground">Total kg</p>
        </div>
        <div className="glass-card p-3 text-center">
          <p className="text-2xl font-bold text-foreground">{session.duration || '—'}</p>
          <p className="text-[10px] text-muted-foreground">Minutes</p>
        </div>
      </div>

      {/* Exercises */}
      {groupedExercises.length > 0 && (
        <div className="space-y-3 mb-6">
          {groupedExercises.map(([name, sets]) => {
            const best = sets.reduce((b, s) => calculate1RM(s.weight, s.reps) > calculate1RM(b.weight, b.reps) ? s : b, sets[0]);
            const e1rm = calculate1RM(best.weight, best.reps);
            const prog = progressions[name];
            const lastPerf = getLastPerformance(name, session.id);

            return (
              <div key={name} className="glass-card p-4">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-semibold text-foreground">{name}</h3>
                  {e1rm > 0 && (
                    <span className="text-xs text-warning font-medium">1RM: {e1rm} kg</span>
                  )}
                </div>
                {lastPerf && (
                  <p className="text-[10px] text-muted-foreground mb-2">
                    Last time: {lastPerf.weight}kg × {lastPerf.reps} — {new Date(lastPerf.date + 'T00:00:00').toLocaleDateString('default', { month: 'short', day: 'numeric' })}
                  </p>
                )}
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

      {/* RPE & Notes (read-only) */}
      {session.difficulty && (
        <div className="glass-card p-4 mb-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">RPE</span>
            <span className="text-sm font-bold text-foreground">{session.difficulty}/10</span>
          </div>
        </div>
      )}
      {session.notes && (
        <div className="glass-card p-4 mb-6">
          <p className="text-xs text-muted-foreground mb-1">Notes</p>
          <p className="text-sm text-foreground">{session.notes}</p>
        </div>
      )}

      {/* Bottom action buttons — Edit + Share */}
      <div className="flex gap-3">
        <button
          onClick={enterEditMode}
          className="flex-1 bg-secondary text-foreground font-semibold py-4 rounded-2xl text-sm flex items-center justify-center gap-2 transition-transform active:scale-95"
        >
          <Pencil size={16} /> Edit Session
        </button>
        <button
          onClick={handleShare}
          className="flex-1 bg-primary text-primary-foreground font-semibold py-4 rounded-2xl text-sm flex items-center justify-center gap-2 transition-transform active:scale-95"
        >
          <Share2 size={16} /> Share Recap
        </button>
      </div>
    </div>
  );
};

export default SessionDetailView;
