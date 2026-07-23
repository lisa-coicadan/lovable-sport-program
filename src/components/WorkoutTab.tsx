import { useState, useEffect, useCallback, useMemo } from 'react';
import { AppData, WorkoutType, SetLog, SessionLog, FiveThreeOneMethod, calculate1RM } from '@/lib/types';
import { getWeekSets, getWeekLabel } from '@/lib/531';
import { buildExerciseBlocks } from '@/lib/superset';
import RestTimer from './RestTimer';
import ExerciseHistory from './ExerciseHistory';
import SessionSummary from './SessionSummary';
import SettingsPanel from './SettingsPanel';
import { Check, ChevronRight, ArrowLeft, Settings, History, Plus, Trash2, ChevronDown } from 'lucide-react';
import { SortableList, DragHandle } from './SortableBlock';


interface WorkoutTabProps {
  data: AppData;
  onSaveSession: (session: SessionLog) => void;
  onUpdateData: (partial: Partial<AppData>) => void;
  selectedDate?: string | null;
}

type Mode = 'select' | 'recap' | 'summary' | 'settings' | 'history';

const WorkoutTab = ({ data, onSaveSession, onUpdateData, selectedDate }: WorkoutTabProps) => {
  const [mode, setMode] = useState<Mode>('select');
  const [selectedType, setSelectedType] = useState<WorkoutType | null>(null);
  const [sets, setSets] = useState<SetLog[]>([]);
  const [startTime, setStartTime] = useState(Date.now());
  const [selectedWeeks, setSelectedWeeks] = useState<Record<string, number>>({});
  const [amrapReps, setAmrapReps] = useState<Record<number, number>>({});
  const [pendingSession, setPendingSession] = useState<SessionLog | null>(null);
  const [historyExercise, setHistoryExercise] = useState<string | null>(null);
  const [restDuration, setRestDuration] = useState(data.restDuration || 90);
  const [nowTick, setNowTick] = useState(Date.now());
  const [previewOpen, setPreviewOpen] = useState(true);

  useEffect(() => {
    if (mode !== 'recap') return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [mode]);

  const activeTypes = data.workoutTypes.filter(t => !t.hidden);

  // Get last performance for an exercise (most recent session containing it)
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

  // Absolute record (heaviest weight ever lifted) for an exercise, by exact name match
  const getAbsoluteRecord = useCallback((exerciseName: string) => {
    let best: { weight: number; reps: number } | null = null;
    data.sessions.forEach(s => {
      s.sets.forEach(set => {
        if (set.exerciseName !== exerciseName || !set.completed || set.weight <= 0) return;
        if (!best || set.weight > best.weight || (set.weight === best.weight && set.reps > best.reps)) {
          best = { weight: set.weight, reps: set.reps };
        }
      });
    });
    return best;
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
    setAmrapReps({});

    const initialWeeks: Record<string, number> = {};
    type.exercises.forEach(ex => {
      if (ex.method?.type === '531') initialWeeks[ex.id] = ex.method.currentWeek;
    });
    setSelectedWeeks(initialWeeks);

    const lastWeights = getLastSessionWeights(type.id);
    const initialSets: SetLog[] = [];

    const exerciseMap = new Map(type.exercises.map(e => [e.id, e]));
    buildExerciseBlocks(type.exercises).forEach(block => {
      if (block.isSuperset) {
        const a = exerciseMap.get(block.exerciseIds[0])!;
        const b = exerciseMap.get(block.exerciseIds[1])!;
        for (let i = 0; i < a.sets; i++) {
          initialSets.push({
            exerciseId: a.id,
            exerciseName: a.name,
            setNumber: i + 1,
            reps: a.reps,
            weight: lastWeights[a.id] || a.weight || 0,
            completed: false,
            supersetGroupId: a.supersetGroupId,
            supersetRole: 'A',
          });
          initialSets.push({
            exerciseId: b.id,
            exerciseName: b.name,
            setNumber: i + 1,
            reps: b.reps,
            weight: lastWeights[b.id] || b.weight || 0,
            completed: false,
            supersetGroupId: b.supersetGroupId,
            supersetRole: 'B',
          });
        }
      } else {
        const ex = exerciseMap.get(block.exerciseIds[0])!;
        // 5/3/1 exercises get their weekly-percentage sets instead of the flat sets×reps
        if (ex.method?.type === '531') {
          const weekSets = getWeekSets(ex.method.trainingMax, ex.method.currentWeek);
          weekSets.forEach((s, i) => {
            initialSets.push({
              exerciseId: ex.id,
              exerciseName: ex.name,
              setNumber: i + 1,
              reps: parseInt(s.reps) || 1,
              weight: s.weight,
              completed: false,
            });
          });
          return;
        }
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
    setSets(updated);
  };

  // Propagate first-set weight to remaining empty sets when user leaves the field
  const propagateWeightOnBlur = (index: number) => {
    const currentSet = sets[index];
    if (!currentSet || currentSet.setNumber !== 1 || currentSet.weight <= 0) return;
    const updated = [...sets];
    for (let i = index + 1; i < updated.length; i++) {
      if (updated[i].exerciseId === currentSet.exerciseId && updated[i].weight === 0) {
        updated[i].weight = currentSet.weight;
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

  const updateWeekSelection = (exerciseId: string, week: number) => {
    setSelectedWeeks(prev => ({ ...prev, [exerciseId]: week }));
    const ex = selectedType?.exercises.find(e => e.id === exerciseId);
    if (ex?.method?.type !== '531') return;
    const weekSets = getWeekSets(ex.method.trainingMax, week);
    const updated = [...sets];
    let idx = 0;
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].exerciseId === exerciseId) {
        if (idx < weekSets.length) {
          updated[i].weight = weekSets[idx].weight;
          updated[i].reps = parseInt(weekSets[idx].reps) || 1;
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
      duration: Math.round((endTime - startTime) / 60000) || 60,
    };
    
    setPendingSession(session);
    setMode('summary');
  };

  const handleSummaryComplete = (session: SessionLog) => {
    onSaveSession(session);

    if (selectedType) {
      const progressed = selectedType.exercises.filter(
        ex => ex.method?.type === '531' && session.sets.some(s => s.exerciseId === ex.id)
      );
      if (progressed.length > 0) {
        const workoutTypes = data.workoutTypes.map(t => {
          if (t.id !== selectedType.id) return t;
          return {
            ...t,
            exercises: t.exercises.map(ex => {
              if (ex.method?.type !== '531' || !progressed.some(p => p.id === ex.id)) return ex;
              const m = ex.method;
              const next: FiveThreeOneMethod = m.currentWeek < 4
                ? { ...m, currentWeek: m.currentWeek + 1 }
                : { ...m, currentCycle: m.currentCycle + 1, currentWeek: 1, trainingMax: m.trainingMax + (m.increment ?? 2.5) };
              return { ...ex, method: next };
            }),
          };
        });
        onUpdateData({ workoutTypes });
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

  if (mode === 'select') {
    const fiveThreeOneExercises = activeTypes.flatMap(type =>
      type.exercises
        .filter(ex => ex.method?.type === '531')
        .map(ex => ({ type, exercise: ex, method: ex.method as FiveThreeOneMethod }))
    );

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

        {/* 5/3/1 Block — one card per exercise using the method, if any */}
        {fiveThreeOneExercises.map(({ exercise, method }) => {
          const weekSets = getWeekSets(method.trainingMax, method.currentWeek);
          const weekLabel = getWeekLabel(method.currentWeek);
          return (
            <div key={exercise.id} className="glass-card p-4 mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold text-primary">{exercise.name}</span>
                <span className="text-xs text-muted-foreground">Cycle {method.currentCycle}</span>
              </div>
              <p className="text-sm text-foreground font-medium mb-3">{weekLabel}</p>
              <div className="space-y-1.5">
                {weekSets.map((s, i) => (
                  <div key={i} className="flex items-center justify-between bg-secondary rounded-lg px-3 py-2">
                    <span className="text-sm text-foreground">{s.weight} kg</span>
                    <span className="text-sm text-muted-foreground">× {s.reps}</span>
                    <span className="text-xs text-muted-foreground">{Math.round(s.percentage * 100)}%</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">TM: {method.trainingMax} kg</p>
            </div>
          );
        })}

        {/* Session Selection */}
        <p className="text-sm text-muted-foreground mb-3">Choose a session</p>
        <div className="space-y-2">
          {activeTypes.map(type => (
            <div key={type.id} className="glass-card p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `hsl(${type.color})` }} />
                <span className="text-foreground font-semibold flex-1">{type.name}</span>
                {type.exercises.some(e => e.method?.type === '531') && (
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
  const fiveThreeOneExerciseIds = new Set(
    (selectedType?.exercises || []).filter(ex => ex.method?.type === '531').map(ex => ex.id)
  );
  const regularSets = sets
    .map((s, i) => ({ ...s, globalIdx: i }))
    .filter(s => !fiveThreeOneExerciseIds.has(s.exerciseId));

  // Build ordered blocks (single exercise or superset pair)
  type SingleBlock = { kind: 'single'; exerciseId: string; name: string; entries: { globalIdx: number; set: SetLog }[] };
  type SupersetBlock = {
    kind: 'superset';
    groupId: string;
    aId: string; aName: string;
    bId: string; bName: string;
    series: { aIdx: number; bIdx: number }[];
  };
  const blocks: (SingleBlock | SupersetBlock)[] = [];
  const seenSingle = new Set<string>();
  const seenSuperset = new Set<string>();
  regularSets.forEach(s => {
    if (s.supersetGroupId) {
      if (seenSuperset.has(s.supersetGroupId)) return;
      seenSuperset.add(s.supersetGroupId);
      const groupEntries = regularSets.filter(r => r.supersetGroupId === s.supersetGroupId);
      const aEntries = groupEntries.filter(r => r.supersetRole === 'A').sort((a, b) => a.setNumber - b.setNumber);
      const bEntries = groupEntries.filter(r => r.supersetRole === 'B').sort((a, b) => a.setNumber - b.setNumber);
      const first = aEntries[0] || groupEntries[0];
      const secondSample = bEntries[0];
      const series = aEntries.map((a, i) => ({
        aIdx: a.globalIdx,
        bIdx: bEntries[i]?.globalIdx ?? -1,
      })).filter(x => x.bIdx !== -1);
      blocks.push({
        kind: 'superset',
        groupId: s.supersetGroupId,
        aId: first.exerciseId, aName: first.exerciseName,
        bId: secondSample?.exerciseId || '', bName: secondSample?.exerciseName || '',
        series,
      });
    } else {
      if (seenSingle.has(s.exerciseId)) return;
      seenSingle.add(s.exerciseId);
      const entries = regularSets.filter(r => r.exerciseId === s.exerciseId).map(r => ({ globalIdx: r.globalIdx, set: r }));
      blocks.push({ kind: 'single', exerciseId: s.exerciseId, name: s.exerciseName, entries });
    }
  });

  return (
    <div className="px-4 pt-12 pb-24 animate-slide-up">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => { setMode('select'); setSelectedType(null); setSets([]); }} className="text-muted-foreground touch-target p-1">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-foreground">{selectedType?.name}</h1>
        {(() => {
          const elapsed = Math.max(0, Math.floor((nowTick - startTime) / 1000));
          const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
          const ss = String(elapsed % 60).padStart(2, '0');
          return (
            <span className="ml-auto text-sm font-mono font-semibold text-primary tabular-nums bg-primary/10 px-2.5 py-1 rounded-lg">
              {mm}:{ss}
            </span>
          );
        })()}
      </div>

      {/* Session preview (collapsible accordion) */}
      {selectedType && selectedType.exercises.length > 0 && (
        <div className="glass-card mb-4 overflow-hidden">
          <button
            onClick={() => setPreviewOpen(v => !v)}
            className="w-full flex items-center justify-between p-3 touch-target"
          >
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Aperçu séance</span>
            <ChevronDown
              size={16}
              className={`text-muted-foreground transition-transform ${previewOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {previewOpen && (
            <div className="px-3 pb-3 space-y-1">
              {(() => {
                const previewMap = new Map(selectedType.exercises.map(e => [e.id, e]));
                const rows = buildExerciseBlocks(selectedType.exercises).map(block => {
                  if (block.isSuperset) {
                    const a = previewMap.get(block.exerciseIds[0])!;
                    const b = previewMap.get(block.exerciseIds[1])!;
                    return { label: `${a.name} + ${b.name}`, volume: `${a.sets} × ${a.reps} / ${b.reps}` };
                  }
                  const ex = previewMap.get(block.exerciseIds[0])!;
                  return { label: ex.name, volume: `${ex.sets} × ${ex.reps}` };
                });
                return rows.map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-xs py-1">
                    <span className="text-foreground/80 truncate flex-1 pr-2">{r.label}</span>
                    <span className="text-muted-foreground font-mono shrink-0">{r.volume}</span>
                  </div>
                ));
              })()}
            </div>
          )}
        </div>
      )}

      {/* 5/3/1 Block(s) in session — editable weights, one card per exercise using the method */}
      {selectedType && selectedType.exercises.filter(ex => ex.method?.type === '531').map(ex => {
        const method = ex.method as FiveThreeOneMethod;
        const liveSets = sets
          .map((s, i) => ({ ...s, globalIdx: i }))
          .filter(s => s.exerciseId === ex.id);
        if (liveSets.length === 0) return null;
        const week = selectedWeeks[ex.id] ?? method.currentWeek;
        const weekSetsForDisplay = getWeekSets(method.trainingMax, week);
        const isAmrap = (setIdx: number) => weekSetsForDisplay[setIdx]?.reps?.includes('+');

        return (
          <div key={ex.id} className="glass-card p-4 mb-4 border-primary/30">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-primary">{ex.name}</h3>
              <span className="text-xs text-muted-foreground">Cycle {method.currentCycle}</span>
            </div>
            <div className="flex gap-1.5 mb-4">
              {[1, 2, 3, 4].map(w => (
                <button
                  key={w}
                  onClick={() => updateWeekSelection(ex.id, w)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    week === w ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                  }`}
                >
                  {w === 4 ? 'Deload' : `W${w}`}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {liveSets.map((s, localIdx) => {
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
                        {weekSetsForDisplay[localIdx]?.reps}
                      </span>
                    )}
                    {realE1rm > 0 && sets[globalIdx].completed && (
                      <span className="text-[10px] text-warning ml-1">{realE1rm}kg</span>
                    )}
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {Math.round((weekSetsForDisplay[localIdx]?.percentage || 0) * 100)}%
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
        );
      })}

      {/* Regular exercises + Supersets */}
      <div className="space-y-4 mb-4">
        {(() => {
          const sortableBlocks = blocks.map(b => ({
            key: b.kind === 'superset' ? b.groupId : b.exerciseId,
            block: b,
          }));
          const reorderBlocks = (newOrder: typeof sortableBlocks) => {
            const fiveIdxs = sets.map((_, i) => i).filter(i => fiveThreeOneExerciseIds.has(sets[i].exerciseId));
            const idxsByKey = new Map<string, number[]>();
            blocks.forEach(b => {
              const key = b.kind === 'superset' ? b.groupId : b.exerciseId;
              const idxs = b.kind === 'superset'
                ? b.series.flatMap(s => [s.aIdx, s.bIdx])
                : b.entries.map(e => e.globalIdx);
              idxsByKey.set(key, idxs);
            });
            const newRegular = newOrder.flatMap(item => (idxsByKey.get(item.key) || []).map(i => sets[i]));
            const fiveSets = fiveIdxs.map(i => sets[i]);
            setSets([...fiveSets, ...newRegular]);
          };
          return (
            <SortableList items={sortableBlocks} onReorder={reorderBlocks}>
              {({ block }) => {

          if (block.kind === 'superset') {
            const toggleSeries = (aIdx: number, bIdx: number) => {
              const bothDone = sets[aIdx].completed && sets[bIdx].completed;
              const updated = [...sets];
              updated[aIdx] = { ...updated[aIdx], completed: !bothDone };
              updated[bIdx] = { ...updated[bIdx], completed: !bothDone };
              setSets(updated);
            };
            return (
              <div key={block.groupId} className="glass-card p-4 border border-primary/40 bg-primary/5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1">
                    <DragHandle />
                    <span className="text-[10px] font-bold text-primary tracking-wider">SUPERSET</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{block.series.length} séries</span>
                </div>

                <div className="flex items-center gap-2 text-xs text-foreground font-semibold mb-3">
                  <span className="text-primary">A</span><span>{block.aName}</span>
                  <span className="text-muted-foreground">+</span>
                  <span className="text-primary">B</span><span>{block.bName}</span>
                </div>

                <div className="space-y-3">
                  {block.series.map((serie, localIdx) => {
                    const aDone = sets[serie.aIdx].completed;
                    const bDone = sets[serie.bIdx].completed;
                    const bothDone = aDone && bDone;
                    return (
                      <div
                        key={localIdx}
                        className={`rounded-xl p-2.5 border transition-all ${
                          bothDone ? 'bg-primary/15 border-primary/40' : 'bg-secondary/40 border-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] font-semibold text-muted-foreground">Série {localIdx + 1}</span>
                          <button
                            onClick={() => toggleSeries(serie.aIdx, serie.bIdx)}
                            className={`touch-target rounded-lg p-1.5 transition-colors ${
                              bothDone ? 'text-primary' : 'text-muted-foreground active:text-primary'
                            }`}
                          >
                            <Check size={18} />
                          </button>
                        </div>
                        {[
                          { role: 'A', name: block.aName, idx: serie.aIdx },
                          { role: 'B', name: block.bName, idx: serie.bIdx },
                        ].map(row => (
                          <div key={row.role} className="flex items-center gap-2 py-1">
                            <span className="text-[10px] font-bold text-primary w-4">{row.role}</span>
                            <span className="text-xs text-foreground/80 flex-1 truncate">{row.name}</span>
                            <input
                              type="number"
                              value={sets[row.idx].weight || ''}
                              onChange={e => updateSet(row.idx, 'weight', e.target.value)}
                              onBlur={() => propagateWeightOnBlur(row.idx)}
                              className="w-14 bg-background/60 rounded-md text-foreground text-sm text-center outline-none font-mono py-1"
                              placeholder="kg"
                            />
                            <span className="text-muted-foreground text-xs">×</span>
                            <input
                              type="number"
                              value={sets[row.idx].reps || ''}
                              onChange={e => updateSet(row.idx, 'reps', e.target.value)}
                              className="w-12 bg-background/60 rounded-md text-foreground text-sm text-center outline-none font-mono py-1"
                              placeholder="reps"
                            />
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          }

          const { exerciseId, name, entries: exerciseSets } = block;
          const lastPerf = getLastPerformance(name);
          const absRecord = getAbsoluteRecord(name);
          const isTemp = exerciseId.startsWith('temp-');

          return (
            <div key={exerciseId} className="glass-card p-4">
              <div className="flex items-center gap-1.5 mb-1">
                <DragHandle />

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

              {(lastPerf || absRecord) && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-2">
                  {lastPerf && (
                    <p className="text-[10px] text-muted-foreground">
                      Dernière: <span className="text-foreground/80 font-medium">{lastPerf.weight}kg × {lastPerf.reps}</span>
                    </p>
                  )}
                  {absRecord && (
                    <p className="text-[10px] text-muted-foreground">
                      Max: <span className="text-warning font-medium">{absRecord.weight}kg × {absRecord.reps}</span>
                    </p>
                  )}
                </div>
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
                        onBlur={() => propagateWeightOnBlur(globalIdx)}
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
              }}
            </SortableList>
          );
        })()}

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
