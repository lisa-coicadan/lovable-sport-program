import { useState } from 'react';
import { AppData, WorkoutType, Exercise, WORKOUT_COLORS } from '@/lib/types';
import { Plus, Trash2, ChevronRight, ChevronLeft, Check } from 'lucide-react';

interface SetupWizardProps {
  onComplete: (data: Partial<AppData>) => void;
}

const SetupWizard = ({ onComplete }: SetupWizardProps) => {
  const [step, setStep] = useState(0);
  const [workoutTypes, setWorkoutTypes] = useState<WorkoutType[]>([
    { id: '1', name: 'Push', color: WORKOUT_COLORS[0], exercises: [{ id: 'e1', name: 'Bench Press', sets: 4, reps: 8 }] },
    { id: '2', name: 'Pull', color: WORKOUT_COLORS[1], exercises: [{ id: 'e2', name: 'Barbell Row', sets: 4, reps: 8 }] },
    { id: '3', name: 'Legs', color: WORKOUT_COLORS[2], exercises: [{ id: 'e3', name: 'Squat', sets: 4, reps: 8 }] },
    { id: '4', name: 'Full Body', color: WORKOUT_COLORS[3], exercises: [{ id: 'e4', name: 'Deadlift', sets: 3, reps: 5 }] },
  ]);
  const [trainingMax, setTrainingMax] = useState(100);
  const [squatSessionId, setSquatSessionId] = useState('3');
  const [currentCycle, setCurrentCycle] = useState(1);
  const [currentWeek, setCurrentWeek] = useState(1);

  const addExercise = (typeIndex: number) => {
    const updated = [...workoutTypes];
    updated[typeIndex].exercises.push({ id: `e${Date.now()}`, name: '', sets: 3, reps: 10 });
    setWorkoutTypes(updated);
  };

  const removeExercise = (typeIndex: number, exIndex: number) => {
    const updated = [...workoutTypes];
    updated[typeIndex].exercises.splice(exIndex, 1);
    setWorkoutTypes(updated);
  };

  const updateExercise = (typeIndex: number, exIndex: number, field: keyof Exercise, value: string | number) => {
    const updated = [...workoutTypes];
    (updated[typeIndex].exercises[exIndex] as any)[field] = value;
    setWorkoutTypes(updated);
  };

  const updateTypeName = (index: number, name: string) => {
    const updated = [...workoutTypes];
    updated[index].name = name;
    setWorkoutTypes(updated);
  };

  const handleFinish = () => {
    onComplete({
      workoutTypes,
      fiveThreeOne: {
        trainingMax,
        currentCycle,
        currentWeek,
        startDate: new Date().toISOString().split('T')[0],
      },
      squatSessionId,
      setupComplete: true,
    });
  };

  // Step 0 — Welcome
  if (step === 0) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 animate-slide-up">
        <div className="text-center mb-10">
          <div className="text-5xl mb-4">💪</div>
          <h1 className="text-3xl font-bold text-foreground mb-2">FitTrack</h1>
          <p className="text-muted-foreground mb-1">Your personal fitness companion</p>
          <p className="text-sm text-muted-foreground mt-4 max-w-xs mx-auto">
            Track your workouts, follow the 5/3/1 squat program, and monitor your progress — all in one app.
          </p>
        </div>
        <button
          onClick={() => setStep(1)}
          className="w-full max-w-xs bg-primary text-primary-foreground font-semibold py-4 rounded-2xl touch-target text-lg transition-transform active:scale-95"
        >
          Get Started
        </button>
      </div>
    );
  }

  // Step 1 — Workout types
  if (step === 1) {
    return (
      <div className="min-h-screen bg-background px-4 pt-12 pb-8 animate-slide-up">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={() => setStep(0)} className="text-muted-foreground p-1"><ChevronLeft size={20} /></button>
          <h2 className="text-2xl font-bold text-foreground">Your Workouts</h2>
        </div>
        <p className="text-muted-foreground text-sm mb-6 ml-8">Create your workout templates with exercises</p>
        
        <div className="space-y-4 mb-8">
          {workoutTypes.map((type, ti) => (
            <div key={type.id} className="glass-card p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `hsl(${type.color})` }} />
                <input
                  value={type.name}
                  onChange={e => updateTypeName(ti, e.target.value)}
                  className="bg-transparent text-foreground font-semibold text-lg outline-none flex-1"
                  placeholder="Workout name"
                />
              </div>
              <div className="space-y-2">
                {type.exercises.map((ex, ei) => (
                  <div key={ex.id} className="flex items-center gap-2">
                    <input
                      value={ex.name}
                      onChange={e => updateExercise(ti, ei, 'name', e.target.value)}
                      className="flex-1 bg-secondary text-foreground rounded-lg px-3 py-2 text-sm outline-none"
                      placeholder="Exercise name"
                    />
                    <input
                      type="number"
                      value={ex.sets || ''}
                      onChange={e => updateExercise(ti, ei, 'sets', e.target.value === '' ? '' as any : parseInt(e.target.value) || 0)}
                      className="w-14 bg-secondary text-foreground rounded-lg px-2 py-2 text-sm text-center outline-none"
                      placeholder="Sets"
                    />
                    <span className="text-muted-foreground text-xs">×</span>
                    <input
                      type="number"
                      value={ex.reps || ''}
                      onChange={e => updateExercise(ti, ei, 'reps', e.target.value === '' ? '' as any : parseInt(e.target.value) || 0)}
                      className="w-14 bg-secondary text-foreground rounded-lg px-2 py-2 text-sm text-center outline-none"
                      placeholder="Reps"
                    />
                    <button onClick={() => removeExercise(ti, ei)} className="text-muted-foreground p-1">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button onClick={() => addExercise(ti)} className="flex items-center gap-1 text-primary text-sm font-medium py-1">
                  <Plus size={14} /> Add exercise
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => setStep(2)}
          className="w-full bg-primary text-primary-foreground font-semibold py-4 rounded-2xl touch-target text-lg flex items-center justify-center gap-2 transition-transform active:scale-95"
        >
          Next <ChevronRight size={20} />
        </button>
      </div>
    );
  }

  // Step 2 — 5/3/1 Setup
  if (step === 2) {
    return (
      <div className="min-h-screen bg-background px-4 pt-12 pb-8 animate-slide-up">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={() => setStep(1)} className="text-muted-foreground p-1"><ChevronLeft size={20} /></button>
          <h2 className="text-2xl font-bold text-foreground">5/3/1 Squat Setup</h2>
        </div>
        <p className="text-muted-foreground text-sm mb-6 ml-8">Configure your squat program</p>

        <div className="glass-card p-6 mb-4">
          <label className="text-sm text-muted-foreground mb-2 block">Training Max (kg)</label>
          <input
            type="number"
            value={trainingMax || ''}
            onChange={e => setTrainingMax(e.target.value === '' ? 0 : parseFloat(e.target.value))}
            className="w-full bg-secondary text-foreground text-3xl font-bold rounded-xl px-4 py-4 text-center outline-none"
          />
        </div>

        <div className="glass-card p-6 mb-4">
          <label className="text-sm text-muted-foreground mb-3 block">Which session includes squats?</label>
          <div className="grid grid-cols-2 gap-2">
            {workoutTypes.map(type => (
              <button
                key={type.id}
                onClick={() => setSquatSessionId(type.id)}
                className={`py-3 rounded-xl text-sm font-medium transition-all ${
                  squatSessionId === type.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
                }`}
              >
                {type.name}
              </button>
            ))}
          </div>
        </div>

        <div className="glass-card p-6 mb-4">
          <label className="text-sm text-muted-foreground mb-3 block">Current cycle number</label>
          <div className="flex items-center gap-4">
            <button onClick={() => setCurrentCycle(Math.max(1, currentCycle - 1))} className="bg-secondary text-foreground rounded-xl w-12 h-12 text-xl font-bold touch-target">-</button>
            <span className="text-foreground text-2xl font-bold flex-1 text-center">{currentCycle}</span>
            <button onClick={() => setCurrentCycle(currentCycle + 1)} className="bg-secondary text-foreground rounded-xl w-12 h-12 text-xl font-bold touch-target">+</button>
          </div>
        </div>

        <div className="glass-card p-6 mb-8">
          <label className="text-sm text-muted-foreground mb-3 block">Current week</label>
          <div className="flex gap-2">
            {[1, 2, 3, 4].map(w => (
              <button
                key={w}
                onClick={() => setCurrentWeek(w)}
                className={`flex-1 py-3 rounded-xl text-sm font-medium transition-all ${
                  currentWeek === w ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
                }`}
              >
                {w === 4 ? 'Deload' : `W${w}`}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => setStep(3)}
          className="w-full bg-primary text-primary-foreground font-semibold py-4 rounded-2xl touch-target text-lg flex items-center justify-center gap-2 transition-transform active:scale-95"
        >
          Next <ChevronRight size={20} />
        </button>
      </div>
    );
  }

  // Step 3 — Summary/Confirmation
  return (
    <div className="min-h-screen bg-background px-4 pt-12 pb-8 animate-slide-up">
      <div className="flex items-center gap-3 mb-1">
        <button onClick={() => setStep(2)} className="text-muted-foreground p-1"><ChevronLeft size={20} /></button>
        <h2 className="text-2xl font-bold text-foreground">Ready to go!</h2>
      </div>
      <p className="text-muted-foreground text-sm mb-6 ml-8">Review your setup</p>

      <div className="space-y-3 mb-6">
        {workoutTypes.map(type => (
          <div key={type.id} className="glass-card p-4">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `hsl(${type.color})` }} />
              <span className="text-foreground font-semibold">{type.name}</span>
              {type.id === squatSessionId && (
                <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">5/3/1</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground ml-6">
              {type.exercises.map(e => e.name).filter(Boolean).join(' · ') || 'No exercises'}
            </p>
          </div>
        ))}
      </div>

      <div className="glass-card p-4 mb-8">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm text-muted-foreground">Squat TM</span>
          <span className="text-foreground font-bold">{trainingMax} kg</span>
        </div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm text-muted-foreground">Cycle</span>
          <span className="text-foreground font-bold">{currentCycle}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Week</span>
          <span className="text-foreground font-bold">{currentWeek === 4 ? 'Deload' : `Week ${currentWeek}`}</span>
        </div>
      </div>

      <button
        onClick={handleFinish}
        className="w-full bg-primary text-primary-foreground font-semibold py-4 rounded-2xl touch-target text-lg flex items-center justify-center gap-2 transition-transform active:scale-95"
      >
        <Check size={20} /> Start Training
      </button>
    </div>
  );
};

export default SetupWizard;
