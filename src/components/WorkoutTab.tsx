import { useState } from 'react';
import { AppData, WorkoutType, SetLog, SessionLog } from '@/lib/types';
import { getWeekSets, getWeekLabel } from '@/lib/531';
import RestTimer from './RestTimer';
import { Check, Clock, ChevronRight, ArrowLeft } from 'lucide-react';

interface WorkoutTabProps {
  data: AppData;
  onSaveSession: (session: SessionLog) => void;
  onUpdate531: (cycle: number, week: number, tm: number) => void;
}

type Mode = 'select' | 'live' | 'recap';

const WorkoutTab = ({ data, onSaveSession, onUpdate531 }: WorkoutTabProps) => {
  const [mode, setMode] = useState<Mode>('select');
  const [selectedType, setSelectedType] = useState<WorkoutType | null>(null);
  const [sets, setSets] = useState<SetLog[]>([]);
  const [currentSetIndex, setCurrentSetIndex] = useState(0);
  const [startTime] = useState(Date.now());
  const [showTimer, setShowTimer] = useState(false);
  const [selectedWeek, setSelectedWeek] = useState(data.fiveThreeOne.currentWeek);
  const [amrapReps, setAmrapReps] = useState<Record<number, number>>({});

  const isSquatSession = (type: WorkoutType) => type.id === data.squatSessionId;

  const startWorkout = (type: WorkoutType, workoutMode: 'live' | 'recap') => {
    setSelectedType(type);
    setMode(workoutMode);
    setSelectedWeek(data.fiveThreeOne.currentWeek);
    setAmrapReps({});

    const initialSets: SetLog[] = [];

    // Add 5/3/1 sets first if this is the squat session
    if (isSquatSession(type)) {
      const fiveThreeOneSets = getWeekSets(data.fiveThreeOne.trainingMax, data.fiveThreeOne.currentWeek);
      fiveThreeOneSets.forEach((s, i) => {
        initialSets.push({
          exerciseId: '531-squat',
          exerciseName: `5/3/1 Squat`,
          setNumber: i + 1,
          reps: parseInt(s.reps) || 1,
          weight: s.weight,
          completed: false,
        });
      });
    }

    type.exercises.forEach(ex => {
      // Skip regular squat if 5/3/1 is handling it
      for (let i = 0; i < ex.sets; i++) {
        initialSets.push({
          exerciseId: ex.id,
          exerciseName: ex.name,
          setNumber: i + 1,
          reps: ex.reps,
          weight: ex.weight || 0,
          completed: false,
        });
      }
    });
    setSets(initialSets);
    setCurrentSetIndex(0);
    setShowTimer(false);
  };

  const toggleSet = (index: number) => {
    const updated = [...sets];
    updated[index].completed = !updated[index].completed;
    setSets(updated);
    if (mode === 'live' && updated[index].completed) {
      setShowTimer(true);
      setCurrentSetIndex(index + 1);
    }
  };

  const updateSet = (index: number, field: 'reps' | 'weight', value: number) => {
    const updated = [...sets];
    updated[index][field] = value;
    setSets(updated);
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

    // Apply AMRAP reps
    const finalSets = sets.map((s, i) => {
      if (amrapReps[i] !== undefined) {
        return { ...s, reps: amrapReps[i] };
      }
      return s;
    });

    const session: SessionLog = {
      id: `s${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      workoutTypeId: selectedType.id,
      workoutTypeName: selectedType.name,
      sets: finalSets,
      startTime,
      endTime,
      duration: Math.round((endTime - startTime) / 60000),
    };
    onSaveSession(session);

    // Advance 5/3/1 if squat session
    if (isSquatSession(selectedType)) {
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
  };

  const fiveThreeOneSets = getWeekSets(data.fiveThreeOne.trainingMax, data.fiveThreeOne.currentWeek);
  const weekLabel = getWeekLabel(data.fiveThreeOne.currentWeek);

  if (mode === 'select') {
    return (
      <div className="px-4 pt-12 pb-24 animate-slide-up">
        <h1 className="text-2xl font-bold text-foreground mb-6">Workout</h1>

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
          {data.workoutTypes.map(type => (
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
              <div className="flex gap-2">
                <button
                  onClick={() => startWorkout(type, 'live')}
                  className="flex-1 bg-primary text-primary-foreground font-medium py-2.5 rounded-xl text-sm flex items-center justify-center gap-1.5 touch-target transition-transform active:scale-95"
                >
                  <Clock size={14} /> Live
                </button>
                <button
                  onClick={() => startWorkout(type, 'recap')}
                  className="flex-1 bg-secondary text-secondary-foreground font-medium py-2.5 rounded-xl text-sm flex items-center justify-center gap-1.5 touch-target transition-transform active:scale-95"
                >
                  <Check size={14} /> Recap
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Live or Recap Mode — separate 5/3/1 sets from regular sets
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
  const isAmrap = (setIdx: number) => {
    const repsStr = currentFiveThreeOneSets[setIdx]?.reps;
    return repsStr?.includes('+');
  };

  return (
    <div className="px-4 pt-12 pb-24 animate-slide-up">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setMode('select')} className="text-muted-foreground touch-target p-1">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-foreground">{selectedType?.name}</h1>
        <span className="text-xs text-muted-foreground ml-auto">
          {mode === 'live' ? 'Live Mode' : 'Recap Mode'}
        </span>
      </div>

      {mode === 'live' && showTimer && (
        <div className="mb-4">
          <RestTimer defaultSeconds={60} onComplete={() => setShowTimer(false)} />
        </div>
      )}

      {/* 5/3/1 Block in session */}
      {selectedType && isSquatSession(selectedType) && fiveThreeOneLiveSets.length > 0 && (
        <div className="glass-card p-4 mb-4 border-primary/30">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-primary">5/3/1 Squat</h3>
            <span className="text-xs text-muted-foreground">Cycle {data.fiveThreeOne.currentCycle}</span>
          </div>

          {/* Week selector */}
          <div className="flex gap-1.5 mb-4">
            {[1, 2, 3, 4].map(w => (
              <button
                key={w}
                onClick={() => updateWeekSelection(w)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selectedWeek === w
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground'
                }`}
              >
                {w === 4 ? 'Deload' : `W${w}`}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {fiveThreeOneLiveSets.map((s, localIdx) => {
              const globalIdx = s.globalIdx;
              const isActive = mode === 'live' && globalIdx === currentSetIndex;
              const amrap = isAmrap(localIdx);
              return (
                <div
                  key={globalIdx}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2.5 transition-all ${
                    sets[globalIdx].completed
                      ? 'bg-primary/10'
                      : isActive
                      ? 'bg-secondary ring-1 ring-primary'
                      : 'bg-secondary/50'
                  }`}
                >
                  <span className="text-xs text-muted-foreground w-8">
                    Set {localIdx + 1}
                  </span>
                  <span className="text-sm text-foreground font-mono w-16 text-center">
                    {sets[globalIdx].weight} kg
                  </span>
                  <span className="text-muted-foreground text-xs">×</span>
                  {amrap ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={amrapReps[globalIdx] ?? sets[globalIdx].reps}
                        onChange={e => setAmrapReps(prev => ({ ...prev, [globalIdx]: parseInt(e.target.value) || 0 }))}
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
                  <span className="text-[10px] text-muted-foreground ml-1">
                    {Math.round((currentFiveThreeOneSets[localIdx]?.percentage || 0) * 100)}%
                  </span>
                  <button
                    onClick={() => toggleSet(globalIdx)}
                    className={`ml-auto touch-target rounded-lg p-2 transition-colors ${
                      sets[globalIdx].completed
                        ? 'text-primary'
                        : 'text-muted-foreground active:text-primary'
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
      <div className="space-y-4 mb-6">
        {Object.entries(groupedSets).map(([name, exerciseSets]) => (
          <div key={name} className="glass-card p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">{name}</h3>
            <div className="space-y-2">
              {exerciseSets.map((s, localIdx) => {
                const globalIdx = s.globalIdx;
                const isActive = mode === 'live' && globalIdx === currentSetIndex;
                return (
                  <div
                    key={globalIdx}
                    className={`flex items-center gap-2 rounded-xl px-3 py-2.5 transition-all ${
                      sets[globalIdx].completed
                        ? 'bg-primary/10'
                        : isActive
                        ? 'bg-secondary ring-1 ring-primary'
                        : 'bg-secondary/50'
                    }`}
                  >
                    <span className="text-xs text-muted-foreground w-8">
                      Set {localIdx + 1}
                    </span>
                    <input
                      type="number"
                      value={sets[globalIdx].weight}
                      onChange={e => updateSet(globalIdx, 'weight', parseFloat(e.target.value) || 0)}
                      className="w-16 bg-transparent text-foreground text-sm text-center outline-none font-mono"
                      placeholder="kg"
                    />
                    <span className="text-muted-foreground text-xs">kg ×</span>
                    <input
                      type="number"
                      value={sets[globalIdx].reps}
                      onChange={e => updateSet(globalIdx, 'reps', parseInt(e.target.value) || 0)}
                      className="w-12 bg-transparent text-foreground text-sm text-center outline-none font-mono"
                      placeholder="reps"
                    />
                    <button
                      onClick={() => toggleSet(globalIdx)}
                      className={`ml-auto touch-target rounded-lg p-2 transition-colors ${
                        sets[globalIdx].completed
                          ? 'text-primary'
                          : 'text-muted-foreground active:text-primary'
                      }`}
                    >
                      <Check size={18} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={finishWorkout}
        className="w-full bg-primary text-primary-foreground font-semibold py-4 rounded-2xl touch-target text-lg flex items-center justify-center gap-2 transition-transform active:scale-95"
      >
        Finish Workout <ChevronRight size={20} />
      </button>
    </div>
  );
};

export default WorkoutTab;
