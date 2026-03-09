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

  const startWorkout = (type: WorkoutType, workoutMode: 'live' | 'recap') => {
    setSelectedType(type);
    setMode(workoutMode);

    const initialSets: SetLog[] = [];
    type.exercises.forEach(ex => {
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

  const completeSet = (index: number) => {
    const updated = [...sets];
    updated[index].completed = true;
    setSets(updated);
    if (mode === 'live') {
      setShowTimer(true);
      setCurrentSetIndex(index + 1);
    }
  };

  const updateSet = (index: number, field: 'reps' | 'weight', value: number) => {
    const updated = [...sets];
    updated[index][field] = value;
    setSets(updated);
  };

  const finishWorkout = () => {
    if (!selectedType) return;
    const endTime = Date.now();
    const session: SessionLog = {
      id: `s${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      workoutTypeId: selectedType.id,
      workoutTypeName: selectedType.name,
      sets: sets,
      startTime,
      endTime,
      duration: Math.round((endTime - startTime) / 60000),
    };
    onSaveSession(session);

    // Advance 5/3/1
    const { currentWeek, currentCycle, trainingMax } = data.fiveThreeOne;
    if (currentWeek < 4) {
      onUpdate531(currentCycle, currentWeek + 1, trainingMax);
    } else {
      onUpdate531(currentCycle + 1, 1, trainingMax + 2.5);
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

  // Live or Recap Mode
  const groupedSets: Record<string, SetLog[]> = {};
  sets.forEach((s, i) => {
    if (!groupedSets[s.exerciseName]) groupedSets[s.exerciseName] = [];
    groupedSets[s.exerciseName].push({ ...s, setNumber: i });
  });

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

      <div className="space-y-4 mb-6">
        {Object.entries(groupedSets).map(([name, exerciseSets]) => (
          <div key={name} className="glass-card p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">{name}</h3>
            <div className="space-y-2">
              {exerciseSets.map((s) => {
                const globalIdx = s.setNumber;
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
                      Set {exerciseSets.indexOf(s) + 1}
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
                      onClick={() => completeSet(globalIdx)}
                      disabled={sets[globalIdx].completed}
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
