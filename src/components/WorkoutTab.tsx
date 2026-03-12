import { useState, useEffect, useCallback, useMemo } from 'react';
import { AppData, WorkoutType, SetLog, SessionLog, calculate1RM } from '@/lib/types';
import { getWeekSets, getWeekLabel } from '@/lib/531';
import RestTimer from './RestTimer';
import ExerciseHistory from './ExerciseHistory';
import SessionSummary from './SessionSummary';
import SettingsPanel from './SettingsPanel';
import { Check, ChevronRight, ArrowLeft, Settings, History, Plus, Trash2 } from 'lucide-react';

interface WorkoutTabProps {
  data: AppData;
  onSaveSession: (session: SessionLog) => void;
  onUpdate531: (cycle: number, week: number, tm: number) => void;
  onUpdateData: (partial: Partial<AppData>) => void;
  selectedDate?: string | null;
}

type Mode = 'select' | 'recap' | 'summary' | 'settings' | 'history';

const WorkoutTab = ({ data, onSaveSession, onUpdate531, onUpdateData, selectedDate }: WorkoutTabProps) => {
  const [mode, setMode] = useState<Mode>('select');
  const [selectedType, setSelectedType] = useState<WorkoutType | null>(null);
  const [sets, setSets] = useState<SetLog[]>([]);
  const [startTime, setStartTime] = useState(Date.now());
  const [selectedWeek, setSelectedWeek] = useState(data.fiveThreeOne.currentWeek);
  const [amrapReps, setAmrapReps] = useState<Record<number, number>>({});
  const [pendingSession, setPendingSession] = useState<SessionLog | null>(null);
  const [historyExercise, setHistoryExercise] = useState<string | null>(null);
  const [restDuration, setRestDuration] = useState(data.restDuration || 90);

  const isSquatSession = (type: WorkoutType) => type.id === data.squatSessionId;
  const activeTypes = data.workoutTypes.filter(t => !t.hidden);

  // Get last performance for an exercise
  const getLastPerformance = useCallback((exerciseName: string) => {
    for (let i = data.sessions.length - 1; i >= 0; i--) {
      const s = data.sessions[i];
      const matchingSets = s.sets.filter(set => set.exerciseName === exerciseName && set.completed && set.weight > 0);
      if (matchingSets.length > 0) {
        const best = matchingSets.reduce((b, set) => set.weight > b.weight ? set : b, matchingSets[0]);
        return { weight: best.weight, reps: best.reps, date: s.date };
      }
    }
    return null;
  }, [data.sessions]);

  // Get last session weights for pre-fill
  const getLastSessionWeights = useCallback((typeId: string) => {
    const lastSession = data.sessions
      .filter(s => s.workoutTypeId === typeId)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!lastSession) return {};
    
    const weights: Record<string, number> = {};
    lastSession.sets.forEach(s => {
      if (s.completed && s.weight > 0 && !weights[s.exerciseId]) {
        weights[s.exerciseId] = s.weight;
      }
    });
    return weights;
  }, [data.sessions]);

  const startWorkout = (type: WorkoutType) => {
    setSelectedType(type);
    setMode('recap');
    setStartTime(Date.now());
    setSelectedWeek(data.fiveThreeOne.currentWeek);
    setAmrapReps({});

    const lastWeights = getLastSessionWeights(type.id);
    const initialSets: SetLog[] = [];

    if (isSquatSession(type)) {
      const fiveThreeOneSets = getWeekSets(data.fiveThreeOne.trainingMax, data.fiveThreeOne.currentWeek);
      fiveThreeOneSets.forEach((s, i) => {
        initialSets.push({
          exerciseId: '531-squat',
          exerciseName: '5/3/1 Squat',
          setNumber: i + 1,
          reps: parseInt(s.reps) || 1,
          weight: s.weight,
          completed: false,
        });
      });
    }

    type.exercises.forEach(ex => {
      const lastWeight = lastWeights[ex.id] || 0;
      for (let i = 0; i < ex.sets; i++) {
        initialSets.push({
          exerciseId: ex.id,
          exerciseName: ex.name,
          setNumber: i + 1,
          reps: ex.reps,
          weight: lastWeight,
          completed: false,
        });
      }
    });
    setSets(initialSets);
  };

  const toggleSet = (index: number) => {
    const updated = [...sets];
    updated[index].completed = !updated[index].completed;
    setSets(updated);
  };

  const updateSet = (index: number, field: 'reps' | 'weight', value: string) => {
    const updated = [...sets];
    if (value === '') {
      updated[index][field] = 0;
    } else {
      updated[index][field] = field === 'weight' ? parseFloat(value) || 0 : parseInt(value) || 0;
    }
    
    // Auto-fill weight for remaining sets of same exercise
    if (field === 'weight' && value !== '') {
      const currentSet = updated[index];
      if (currentSet.setNumber === 1) {
        const numericValue = parseFloat(value) || 0;
        for (let i = index + 1; i < updated.length; i++) {
          if (updated[i].exerciseId === currentSet.exerciseId && updated[i].weight === 0) {
            updated[i].weight = numericValue;
          }
        }
      }
    }
    
    setSets(updated);
  };

  // Add extra set to an exercise
  const addSetToExercise = (exerciseId: string, exerciseName: string) => {
    const existingSets = sets.filter(s => s.exerciseId === exerciseId);
    const lastSet = existingSets[existingSets.length - 1];
    let insertIndex = sets.length;
    for (let i = sets.length - 1; i >= 0; i--) {
      if (sets[i].exerciseId === exerciseId) { insertIndex = i + 1; break; }
    }
    
    const newSet: SetLog = {
      exerciseId,
      exerciseName,
      setNumber: existingSets.length + 1,
      reps: lastSet?.reps || 10,
      weight: lastSet?.weight || 0,
      completed: false,
    };
    
    const updated = [...sets];
    updated.splice(insertIndex, 0, newSet);
    setSets(updated);
  };

  // Add new exercise to session
  const addExerciseToSession = () => {
    const newId = `temp-${Date.now()}`;
    setSets(prev => [...prev, {
      exerciseId: newId,
      exerciseName: 'New Exercise',
      setNumber: 1,
      reps: 10,
      weight: 0,
      completed: false,
    }]);
  };

  // Remove a set
  const removeSet = (index: number) => {
    setSets(prev => prev.filter((_, i) => i !== index));
  };

  // Update exercise name for temp exercises
  const updateExerciseName = (exerciseId: string, name: string) => {
    setSets(prev => prev.map(s => s.exerciseId === exerciseId ? { ...s, exerciseName: name } : s));
  };

  const updateWeekSelection = (week: number) => {
    setSelectedWeek(week);
    if (!selectedType || !isSquatSession(selectedType)) return;
    const fiveThreeOneSets = getWeekSets(data.fiveThreeOne.trainingMax, week);
    const updated = [...sets];
    let idx = 0;
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].exerciseId === '531-squat') {
        if (idx < fiveThreeOneSets.length) {
          updated[i].weight = fiveThreeOneSets[idx].weight;
          updated[i].reps = parseInt(fiveThreeOneSets[idx].reps) || 1;
        }
        idx++;
      }
    }
    setSets(updated);
  };

  const finishWorkout = () => {
    if (!selectedType) return;
    const endTime = Date.now();

    const finalSets = sets.map((s, i) => {
      if (amrapReps[i] !== undefined) {
        return { ...s, reps: amrapReps[i] };
      }
      return s;
    });

    const sessionDate = selectedDate || new Date().toISOString().split('T')[0];

    const session: SessionLog = {
      id: `s${Date.now()}`,
      date: sessionDate,
      workoutTypeId: selectedType.id,
      workoutTypeName: selectedType.name,
      sets: finalSets,
      startTime,
      endTime,
      duration: Math.round((endTime - startTime) / 60000),
    };
    
    setPendingSession(session);
    setMode('summary');
  };

  const handleSummaryComplete = (session: SessionLog) => {
    onSaveSession(session);

    if (selectedType && isSquatSession(selectedType)) {
      const { currentWeek, currentCycle, trainingMax } = data.fiveThreeOne;
      if (currentWeek < 4) {
        onUpdate531(currentCycle, currentWeek + 1, trainingMax);
      } else {
        onUpdate531(currentCycle + 1, 1, trainingMax + 2.5);
      }
    }

    setMode('select');
    setSelectedType(null);
    setSets([]);
    setPendingSession(null);
  };

  if (mode === 'summary' && pendingSession) {
    return (
      <SessionSummary
        session={pendingSession}
        previousSessions={data.sessions}
        onSave={handleSummaryComplete}
        onBack={() => setMode(selectedType ? 'recap' : 'select')}
      />
    );
  }

  if (mode === 'settings') {
    return (
      <SettingsPanel
        data={data}
        onUpdateData={onUpdateData}
        onUpdate531={onUpdate531}
        onClose={() => setMode('select')}
      />
    );
  }

  if (mode === 'history' && historyExercise) {
    return (
      <ExerciseHistory
        exerciseName={historyExercise}
        data={data}
        onClose={() => { setHistoryExercise(null); setMode(selectedType ? 'recap' : 'select'); }}
      />
    );
  }

  const fiveThreeOneSets = getWeekSets(data.fiveThreeOne.trainingMax, data.fiveThreeOne.currentWeek);
  const weekLabel = getWeekLabel(data.fiveThreeOne.currentWeek);

  if (mode === 'select') {
    return (
      <div className="px-4 pt-12 pb-24 animate-slide-up">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-foreground">Workout</h1>
          <button
            onClick={() => setMode('settings')}
            className="touch-target p-2 text-muted-foreground"
          >
            <Settings size={20} />
          </button>
        </div>

        {/* 5/3/1 Block */}
        <div className="glass-card p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-primary">5/3/1 Squat</span>
            <span className="text-xs text-muted-foreground">Cycle {data.fiveThreeOne.currentCycle}</span>
          </div>
          <p className="text-sm text-foreground font-medium mb-3">{weekLabel}</p>
          <div className="space-y-1.5">
            {fiveThreeOneSets.map((s, i) => (
              <div key={i} className="flex items-center justify-between bg-secondary rounded-lg px-3 py-2">
                <span className="text-sm text-foreground">{s.weight} kg</span>
                <span className="text-sm text-muted-foreground">× {s.reps}</span>
                <span className="text-xs text-muted-foreground">{Math.round(s.percentage * 100)}%</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">TM: {data.fiveThreeOne.trainingMax} kg</p>
        </div>

        {/* Session Selection */}
        <p className="text-sm text-muted-foreground mb-3">Choose a session</p>
        <div className="space-y-2">
          {activeTypes.map(type => (
            <div key={type.id} className="glass-card p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `hsl(${type.color})` }} />
                <span className="text-foreground font-semibold flex-1">{type.name}</span>
                {isSquatSession(type) && (
                  <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">5/3/1</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                {type.exercises.map(e => e.name).join(' · ')}
              </p>
              <button
                onClick={() => startWorkout(type)}
                className="w-full bg-primary text-primary-foreground font-medium py-2.5 rounded-xl text-sm flex items-center justify-center gap-1.5 touch-target transition-transform active:scale-95"
              >
                <Check size={14} /> Start Session
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Live or Recap Mode
  const fiveThreeOneLiveSets = sets
    .map((s, i) => ({ ...s, globalIdx: i }))
    .filter(s => s.exerciseId === '531-squat');
  const regularSets = sets
    .map((s, i) => ({ ...s, globalIdx: i }))
    .filter(s => s.exerciseId !== '531-squat');

  const groupedSets: Record<string, { globalIdx: number; set: SetLog }[]> = {};
  regularSets.forEach(s => {
    if (!groupedSets[s.exerciseName]) groupedSets[s.exerciseName] = [];
    groupedSets[s.exerciseName].push({ globalIdx: s.globalIdx, set: s });
  });

  const currentFiveThreeOneSets = getWeekSets(data.fiveThreeOne.trainingMax, selectedWeek);
  const isAmrap = (setIdx: number) => currentFiveThreeOneSets[setIdx]?.reps?.includes('+');

  return (
    <div className="px-4 pt-12 pb-24 animate-slide-up">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => { setMode('select'); setSelectedType(null); setSets([]); }} className="text-muted-foreground touch-target p-1">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-foreground">{selectedType?.name}</h1>
        <span className="text-xs text-muted-foreground ml-auto">Recap</span>
      </div>

      {/* 5/3/1 Block in session — editable weights */}
      {selectedType && isSquatSession(selectedType) && fiveThreeOneLiveSets.length > 0 && (
        <div className="glass-card p-4 mb-4 border-primary/30">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-primary">5/3/1 Squat</h3>
            <span className="text-xs text-muted-foreground">Cycle {data.fiveThreeOne.currentCycle}</span>
          </div>
          <div className="flex gap-1.5 mb-4">
            {[1, 2, 3, 4].map(w => (
              <button
                key={w}
                onClick={() => updateWeekSelection(w)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selectedWeek === w ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                }`}
              >
                {w === 4 ? 'Deload' : `W${w}`}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {fiveThreeOneLiveSets.map((s, localIdx) => {
              const globalIdx = s.globalIdx;
              const amrap = isAmrap(localIdx);
              const actualWeight = sets[globalIdx].weight;
              const actualReps = amrapReps[globalIdx] !== undefined ? amrapReps[globalIdx] : sets[globalIdx].reps;
              const realE1rm = actualWeight > 0 && actualReps > 0 ? calculate1RM(actualWeight, actualReps) : 0;
              
              return (
                <div
                  key={globalIdx}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2.5 transition-all ${
                    sets[globalIdx].completed ? 'bg-primary/10' : 'bg-secondary/50'
                  }`}
                >
                  <span className="text-xs text-muted-foreground w-6">S{localIdx + 1}</span>
                  <input
                    type="number"
                    value={sets[globalIdx].weight || ''}
                    onChange={e => updateSet(globalIdx, 'weight', e.target.value)}
                    className="w-14 bg-transparent text-foreground text-sm text-center outline-none font-mono"
                    placeholder="kg"
                  />
                  <span className="text-muted-foreground text-xs">×</span>
                  {amrap ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={amrapReps[globalIdx] !== undefined ? (amrapReps[globalIdx] || '') : (sets[globalIdx].reps || '')}
                        onChange={e => setAmrapReps(prev => ({ ...prev, [globalIdx]: e.target.value === '' ? 0 : parseInt(e.target.value) || 0 }))}
                        className="w-12 bg-primary/10 text-primary text-sm text-center outline-none font-mono rounded-lg py-1 border border-primary/30"
                        placeholder="reps"
                      />
                      <span className="text-[10px] text-primary font-bold">AMRAP</span>
                    </div>
                  ) : (
                    <span className="text-sm text-foreground font-mono w-12 text-center">
                      {currentFiveThreeOneSets[localIdx]?.reps}
                    </span>
                  )}
                  {realE1rm > 0 && sets[globalIdx].completed && (
                    <span className="text-[10px] text-warning ml-1">{realE1rm}kg</span>
                  )}
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {Math.round((currentFiveThreeOneSets[localIdx]?.percentage || 0) * 100)}%
                  </span>
                  <button
                    onClick={() => toggleSet(globalIdx)}
                    className={`touch-target rounded-lg p-2 transition-colors ${
                      sets[globalIdx].completed ? 'text-primary' : 'text-muted-foreground active:text-primary'
                    }`}
                  >
                    <Check size={18} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Regular exercises */}
      <div className="space-y-4 mb-4">
        {Object.entries(groupedSets).map(([name, exerciseSets]) => {
          const exerciseId = exerciseSets[0].set.exerciseId;
          const lastPerf = getLastPerformance(name);
          const isTemp = exerciseId.startsWith('temp-');

          return (
            <div key={name} className="glass-card p-4">
              <div className="flex items-center gap-1.5 mb-1">
                {isTemp ? (
                  <input
                    value={name}
                    onChange={e => updateExerciseName(exerciseId, e.target.value)}
                    className="bg-transparent text-foreground font-semibold outline-none flex-1 text-sm"
                    placeholder="Exercise name"
                  />
                ) : (
                  <button
                    onClick={() => { setHistoryExercise(name); setMode('history'); }}
                    className="flex items-center gap-1.5 group"
                  >
                    <h3 className="text-sm font-semibold text-foreground group-active:text-primary transition-colors">{name}</h3>
                    <History size={12} className="text-muted-foreground group-active:text-primary" />
                  </button>
                )}
              </div>
              
              {/* Last performance reference */}
              {lastPerf && (
                <p className="text-[10px] text-muted-foreground mb-2">
                  Last time: {lastPerf.weight}kg × {lastPerf.reps} — {new Date(lastPerf.date + 'T00:00:00').toLocaleDateString('default', { month: 'short', day: 'numeric' })}
                </p>
              )}

              <div className="space-y-2">
                {exerciseSets.map((s, localIdx) => {
                  const globalIdx = s.globalIdx;
                  return (
                    <div
                      key={globalIdx}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2.5 transition-all ${
                        sets[globalIdx].completed ? 'bg-primary/10' : 'bg-secondary/50'
                      }`}
                    >
                      <span className="text-xs text-muted-foreground w-8">Set {localIdx + 1}</span>
                      <input
                        type="number"
                        value={sets[globalIdx].weight || ''}
                        onChange={e => updateSet(globalIdx, 'weight', e.target.value)}
                        className="w-16 bg-transparent text-foreground text-sm text-center outline-none font-mono"
                        placeholder="kg"
                      />
                      <span className="text-muted-foreground text-xs">kg ×</span>
                      <input
                        type="number"
                        value={sets[globalIdx].reps || ''}
                        onChange={e => updateSet(globalIdx, 'reps', e.target.value)}
                        className="w-12 bg-transparent text-foreground text-sm text-center outline-none font-mono"
                        placeholder="reps"
                      />
                      <button
                        onClick={() => removeSet(globalIdx)}
                        className="text-muted-foreground p-1 active:text-destructive"
                      >
                        <Trash2 size={14} />
                      </button>
                      <button
                        onClick={() => toggleSet(globalIdx)}
                        className={`touch-target rounded-lg p-2 transition-colors ${
                          sets[globalIdx].completed ? 'text-primary' : 'text-muted-foreground active:text-primary'
                        }`}
                      >
                        <Check size={18} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <button
                onClick={() => addSetToExercise(exerciseId, name)}
                className="flex items-center gap-1 text-primary text-xs font-medium py-1.5 mt-2"
              >
                <Plus size={12} /> Add set
              </button>
            </div>
          );
        })}
      </div>

      {/* Add exercise button */}
      <button
        onClick={addExerciseToSession}
        className="w-full glass-card p-3 flex items-center justify-center gap-2 text-primary text-sm font-medium mb-6 transition-transform active:scale-95"
      >
        <Plus size={16} /> Add exercise
      </button>

      <button
        onClick={finishWorkout}
        className="w-full bg-primary text-primary-foreground font-semibold py-4 rounded-2xl touch-target text-lg flex items-center justify-center gap-2 transition-transform active:scale-95"
      >
        Finish Workout <ChevronRight size={20} />
      </button>

      {/* Floating rest timer */}
      {mode === 'recap' && (
        <RestTimer defaultSeconds={restDuration} />
      )}
    </div>
  );
};

export default WorkoutTab;
