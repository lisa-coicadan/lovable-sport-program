import { useState } from 'react';
import { AppData, WorkoutType, Exercise, ExerciseMethod, FiveThreeOneMethod, ClusterMethod, EMOMMethod, WORKOUT_COLORS } from '@/lib/types';
import { CLUSTER_PRESETS } from '@/lib/cluster';
import { getDefaultEmomPercentage } from '@/lib/emom';
import { estimateOneRepMax, estimateTrainingMax } from '@/lib/trainingMax';
import { parseSessionNotes, NOTES_SYNTAX_HELP } from '@/lib/notesParser';
import { Plus, Trash2, ChevronRight, ChevronLeft, Check, Zap, Timer, Clock, FileText, X, Calculator } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

type WizStep = 'welcome' | 'list' | 'build' | 'notes' | 'goal' | 'methodParams' | 'recap';
type MethodType = '531' | 'cluster' | 'emom';

const METHOD_LABELS: Record<MethodType, string> = { '531': '5/3/1', cluster: 'Cluster', emom: 'EMOM' };
const METHOD_ICONS: Record<MethodType, typeof Zap> = { '531': Zap, cluster: Timer, emom: Clock };
const METHOD_HUES: Record<MethodType, string> = { '531': 'text-primary bg-primary/10 border-primary/20', cluster: 'text-accent-purple bg-accent-purple/10 border-accent-purple/20', emom: 'text-accent-blue bg-accent-blue/10 border-accent-blue/20' };

const defaultMethodFor = (type: MethodType): ExerciseMethod => {
  if (type === '531') return { type: '531', trainingMax: 0, currentCycle: 1, currentWeek: 1, increment: 2.5 };
  if (type === 'cluster') return { type: 'cluster', trainingMax: 0, miniSeries: CLUSTER_PRESETS[1].miniSeries };
  return { type: 'emom', trainingMax: 0 };
};

// Progress stepper: Séances -> Objectif -> (Méthodes) -> Récap
const WizardProgress = ({ step, total }: { step: number; total: number }) => (
  <div className="flex items-center gap-1.5 mb-6 ml-8">
    {Array.from({ length: total }).map((_, i) => (
      <div
        key={i}
        className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
          i + 1 <= step ? 'bg-primary' : 'bg-secondary'
        }`}
      />
    ))}
  </div>
);

interface SetupWizardProps {
  onComplete: (data: Partial<AppData>) => void;
}

const SetupWizard = ({ onComplete }: SetupWizardProps) => {
  const [step, setStep] = useState<WizStep>('welcome');
  const [workoutTypes, setWorkoutTypes] = useState<WorkoutType[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [expandedMethodFor, setExpandedMethodFor] = useState<string | null>(null);
  const [weeklyGoal, setWeeklyGoal] = useState(4);
  const [notesText, setNotesText] = useState('');
  const [tmMode, setTmMode] = useState<Record<string, 'direct' | 'compute'>>({});
  const [tmInputs, setTmInputs] = useState<Record<string, { weight: number; reps: number }>>({});

  const taggedExercises = workoutTypes.flatMap(t =>
    t.exercises.filter(e => e.method).map(e => ({ typeId: t.id, typeName: t.name, exercise: e }))
  );

  // ---- Build-step helpers (operate on workoutTypes[editingIndex]) ----
  const addExercise = () => {
    if (editingIndex === null) return;
    setWorkoutTypes(prev => prev.map((t, i) => i === editingIndex
      ? { ...t, exercises: [...t.exercises, { id: `e${Date.now()}`, name: '', sets: 3, reps: 10 }] }
      : t));
  };

  const removeExercise = (exIndex: number) => {
    if (editingIndex === null) return;
    setWorkoutTypes(prev => prev.map((t, i) => i === editingIndex
      ? { ...t, exercises: t.exercises.filter((_, ei) => ei !== exIndex) }
      : t));
  };

  const updateExercise = <K extends keyof Exercise>(exIndex: number, field: K, value: Exercise[K]) => {
    if (editingIndex === null) return;
    setWorkoutTypes(prev => prev.map((t, i) => i === editingIndex
      ? { ...t, exercises: t.exercises.map((e, ei) => ei === exIndex ? { ...e, [field]: value } : e) }
      : t));
  };

  const setExerciseMethod = (exIndex: number, methodType: MethodType | null) => {
    if (editingIndex === null) return;
    setWorkoutTypes(prev => prev.map((t, i) => {
      if (i !== editingIndex) return t;
      return {
        ...t,
        exercises: t.exercises.map((e, ei) => {
          if (ei !== exIndex) return e;
          if (methodType === null) {
            const { method, ...rest } = e;
            return rest;
          }
          return { ...e, method: defaultMethodFor(methodType) };
        }),
      };
    }));
    setExpandedMethodFor(null);
  };

  const updateTypeName = (name: string) => {
    if (editingIndex === null) return;
    setWorkoutTypes(prev => prev.map((t, i) => i === editingIndex ? { ...t, name } : t));
  };

  const startNewWorkout = () => {
    const color = WORKOUT_COLORS[workoutTypes.length % WORKOUT_COLORS.length];
    setWorkoutTypes(prev => [...prev, { id: `t${Date.now()}`, name: '', color, exercises: [] }]);
    setEditingIndex(workoutTypes.length);
    setStep('build');
  };

  const editWorkout = (i: number) => {
    setEditingIndex(i);
    setStep('build');
  };

  const finishBuild = () => {
    if (editingIndex === null) { setStep('list'); return; }
    setWorkoutTypes(prev => {
      const cleaned = prev.map((t, i) => i === editingIndex ? { ...t, exercises: t.exercises.filter(e => e.name.trim() !== '') } : t);
      const current = cleaned[editingIndex];
      if (current.name.trim() === '' && current.exercises.length === 0) {
        return cleaned.filter((_, i) => i !== editingIndex);
      }
      return cleaned.map((t, i) => i === editingIndex ? { ...t, name: t.name.trim() || 'Séance' } : t);
    });
    setEditingIndex(null);
    setExpandedMethodFor(null);
    setStep('list');
  };

  const deleteWorkout = (i: number) => {
    setWorkoutTypes(prev => prev.filter((_, idx) => idx !== i));
  };

  const parseNotes = () => {
    const result = parseSessionNotes(notesText);
    if (result.exercises.length === 0) {
      toast({
        title: 'Aucun exercice reconnu',
        description: 'Vérifie le format (voir l\'aide juste au-dessus) et réessaie.',
        variant: 'destructive',
      });
      return;
    }
    const color = WORKOUT_COLORS[workoutTypes.length % WORKOUT_COLORS.length];
    const exercises: Exercise[] = result.exercises.map((e, i) => ({
      id: `e${Date.now()}-${i}`,
      name: e.name,
      sets: e.sets,
      reps: e.reps,
      weight: e.weight,
      supersetGroupId: e.supersetGroupId,
      supersetRole: e.supersetRole,
    }));
    setWorkoutTypes(prev => [...prev, { id: `t${Date.now()}`, name: result.sessionName || 'Nouvelle séance', color, exercises }]);
    setEditingIndex(workoutTypes.length);
    setNotesText('');
    if (result.unrecognizedLines.length > 0) {
      toast({
        title: `Séance créée (${result.exercises.length} exercice${result.exercises.length > 1 ? 's' : ''})`,
        description: `${result.unrecognizedLines.length} ligne(s) non reconnue(s), à ajouter à la main : ${result.unrecognizedLines.join(' / ')}`,
      });
    }
    setStep('build');
  };

  // ---- Method-params step helpers ----
  const updateMethodField = (typeId: string, exId: string, patch: Record<string, unknown>) => {
    setWorkoutTypes(prev => prev.map(t => t.id !== typeId ? t : {
      ...t,
      exercises: t.exercises.map(e => e.id !== exId || !e.method ? e : { ...e, method: { ...e.method, ...patch } as ExerciseMethod }),
    }));
  };

  const setDirectTM = (exId: string, typeId: string, value: number) => {
    setTmMode(prev => ({ ...prev, [exId]: 'direct' }));
    updateMethodField(typeId, exId, { trainingMax: value });
  };

  const setComputeInputs = (exId: string, typeId: string, weight: number, reps: number) => {
    setTmInputs(prev => ({ ...prev, [exId]: { weight, reps } }));
    const tm = estimateTrainingMax(estimateOneRepMax(weight, reps));
    updateMethodField(typeId, exId, { trainingMax: tm });
  };

  const handleFinish = () => {
    onComplete({ workoutTypes, weeklyGoal, setupComplete: true });
  };

  // ============================================================ Step 0 — Welcome
  if (step === 'welcome') {
    return (
      <div className="relative min-h-screen bg-background flex flex-col items-center justify-center px-6 overflow-hidden animate-slide-up">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[15%] left-[30%] w-64 h-64 bg-primary/25 rounded-full blur-3xl" />
          <div className="absolute top-[22%] right-[20%] w-56 h-56 bg-accent-purple/20 rounded-full blur-3xl" />
          <div className="absolute top-[30%] left-[45%] w-48 h-48 bg-accent-blue/15 rounded-full blur-3xl" />
        </div>

        <div className="relative text-center mb-10">
          <div className="relative w-24 h-24 mx-auto mb-6">
            <div className="absolute inset-0 bg-primary/30 rounded-full blur-2xl animate-pulse-glow" />
            <div className="relative w-24 h-24 rounded-3xl glass-card border-primary/20 flex items-center justify-center text-5xl">
              💪
            </div>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-foreground mb-2">Lisa Muscu</h1>
          <p className="text-muted-foreground">Ton compagnon fitness personnel</p>
          <p className="text-sm text-muted-foreground/80 mt-4 max-w-xs mx-auto leading-relaxed">
            Suis tes séances, active le 5/3/1, le Cluster ou l'EMOM sur les exercices de ton choix, et progresse — tout en une seule app.
          </p>

          <div className="flex items-center justify-center gap-2 mt-6">
            {([
              { icon: Zap, label: '5/3/1', hue: METHOD_HUES['531'] },
              { icon: Timer, label: 'Cluster', hue: METHOD_HUES.cluster },
              { icon: Clock, label: 'EMOM', hue: METHOD_HUES.emom },
            ] as const).map(({ icon: Icon, label, hue }) => (
              <span
                key={label}
                className={`flex items-center gap-1.5 text-xs font-medium rounded-full px-3 py-1.5 border ${hue}`}
              >
                <Icon size={12} /> {label}
              </span>
            ))}
          </div>
        </div>

        <button
          onClick={() => setStep('list')}
          className="relative w-full max-w-xs btn-neon font-semibold py-4 rounded-2xl touch-target text-lg transition-transform active:scale-95"
        >
          Commencer
        </button>
      </div>
    );
  }

  // ============================================================ Step — Tes séances (list)
  if (step === 'list') {
    return (
      <div className="min-h-screen bg-background px-4 pt-12 pb-8 animate-slide-up">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={() => setStep('welcome')} className="text-muted-foreground p-1"><ChevronLeft size={20} /></button>
          <h2 className="text-2xl font-bold text-foreground">Tes séances</h2>
        </div>
        <p className="text-muted-foreground text-sm mb-3 ml-8">Crée tes modèles de séance, avec ou sans méthode d'entraînement</p>
        <WizardProgress step={1} total={4} />

        {workoutTypes.length > 0 && (
          <div className="space-y-3 mb-6">
            {workoutTypes.map((type, i) => (
              <button
                key={type.id}
                onClick={() => editWorkout(i)}
                className="w-full glass-card p-4 text-left flex items-center gap-3"
              >
                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: `hsl(${type.color})` }} />
                <div className="flex-1 min-w-0">
                  <p className="text-foreground font-semibold">{type.name || 'Sans titre'}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {type.exercises.map(e => e.name).filter(Boolean).join(' · ') || 'Aucun exercice'}
                  </p>
                </div>
                <span
                  onClick={e => { e.stopPropagation(); deleteWorkout(i); }}
                  className="text-muted-foreground p-1.5 active:text-destructive"
                >
                  <Trash2 size={16} />
                </span>
              </button>
            ))}
          </div>
        )}

        <button
          onClick={() => setStep('notes')}
          className="w-full glass-card p-4 mb-3 flex items-center gap-3 text-left border-accent-purple/30"
        >
          <div className="w-10 h-10 rounded-xl bg-accent-purple/10 flex items-center justify-center text-accent-purple shrink-0">
            <FileText size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">Créer une nouvelle séance à partir des notes</p>
            <p className="text-xs text-muted-foreground">Colle tes notes d'entraînement, on les transforme en séance</p>
          </div>
        </button>

        <button
          onClick={startNewWorkout}
          className="w-full glass-card p-4 mb-8 flex items-center gap-3 text-left"
        >
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <Plus size={18} />
          </div>
          <p className="text-sm font-semibold text-foreground">Créer une nouvelle séance</p>
        </button>

        <button
          onClick={() => setStep('goal')}
          disabled={workoutTypes.length === 0}
          className="w-full btn-neon font-semibold py-4 rounded-2xl touch-target text-lg flex items-center justify-center gap-2 transition-transform active:scale-95 disabled:opacity-40"
        >
          Suivant <ChevronRight size={20} />
        </button>
      </div>
    );
  }

  // ============================================================ Step — Créer depuis les notes
  if (step === 'notes') {
    return (
      <div className="min-h-screen bg-background px-4 pt-12 pb-8 animate-slide-up">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={() => setStep('list')} className="text-muted-foreground p-1"><ChevronLeft size={20} /></button>
          <h2 className="text-2xl font-bold text-foreground">Depuis tes notes</h2>
        </div>
        <p className="text-muted-foreground text-sm mb-3 ml-8">Colle tes notes — tu pourras tout corriger ensuite</p>
        <WizardProgress step={1} total={4} />

        <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap bg-secondary rounded-lg p-3 mb-4">
          {NOTES_SYNTAX_HELP}
        </pre>

        <textarea
          value={notesText}
          onChange={e => setNotesText(e.target.value)}
          placeholder={'Push\nDéveloppé couché : 3x8\nDéveloppé militaire 4x12 à 10kg'}
          rows={8}
          className="w-full bg-secondary text-foreground rounded-xl px-3 py-3 text-sm outline-none resize-none min-h-[160px] mb-6 font-mono"
        />

        <button
          onClick={parseNotes}
          disabled={notesText.trim() === ''}
          className="w-full btn-neon font-semibold py-4 rounded-2xl touch-target text-lg flex items-center justify-center gap-2 transition-transform active:scale-95 disabled:opacity-40"
        >
          Générer la séance <ChevronRight size={20} />
        </button>
      </div>
    );
  }

  // ============================================================ Step — Build one workout
  if (step === 'build') {
    const type = editingIndex !== null ? workoutTypes[editingIndex] : null;
    if (!type) { setStep('list'); return null; }

    return (
      <div className="min-h-screen bg-background px-4 pt-12 pb-8 animate-slide-up">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={finishBuild} className="text-muted-foreground p-1"><ChevronLeft size={20} /></button>
          <h2 className="text-2xl font-bold text-foreground">Séance</h2>
        </div>
        <p className="text-muted-foreground text-sm mb-3 ml-8">Ajoute les exercices, et une méthode si tu veux la travailler en force</p>
        <WizardProgress step={1} total={4} />

        <div className="glass-card p-4 mb-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `hsl(${type.color})` }} />
            <input
              value={type.name}
              onChange={e => updateTypeName(e.target.value)}
              className="bg-transparent text-foreground font-semibold text-lg outline-none flex-1"
              placeholder="Nom de la séance"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            {type.exercises.map((ex, ei) => {
              const methodType = ex.method?.type as MethodType | undefined;
              const isExpanded = expandedMethodFor === ex.id;
              return (
                <div key={ex.id} className="bg-secondary/40 rounded-xl p-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={ex.name}
                      onChange={e => updateExercise(ei, 'name', e.target.value)}
                      className="flex-1 bg-secondary text-foreground rounded-lg px-3 py-2 text-sm outline-none"
                      placeholder="Nom de l'exercice"
                    />
                    <input
                      type="number"
                      value={ex.sets || ''}
                      onChange={e => updateExercise(ei, 'sets', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                      className="w-14 bg-secondary text-foreground rounded-lg px-2 py-2 text-sm text-center outline-none"
                      placeholder="Séries"
                    />
                    <span className="text-muted-foreground text-xs">×</span>
                    <input
                      type="number"
                      value={ex.reps || ''}
                      onChange={e => updateExercise(ei, 'reps', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)}
                      className="w-14 bg-secondary text-foreground rounded-lg px-2 py-2 text-sm text-center outline-none"
                      placeholder="Reps"
                    />
                    <button onClick={() => removeExercise(ei)} className="text-muted-foreground p-1 shrink-0">
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <button
                    onClick={() => setExpandedMethodFor(isExpanded ? null : ex.id)}
                    className={`mt-1.5 w-full flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold border transition-all ${
                      methodType ? METHOD_HUES[methodType] : 'text-muted-foreground bg-secondary border-dashed border-border'
                    }`}
                  >
                    {methodType ? (() => { const Icon = METHOD_ICONS[methodType]; return <Icon size={13} />; })() : <Plus size={13} />}
                    {methodType ? `Méthode : ${METHOD_LABELS[methodType]}` : 'Ajouter une méthode d\'entraînement (5/3/1, Cluster, EMOM)'}
                  </button>

                  {isExpanded && (
                    <div className="flex gap-1.5 mt-1.5">
                      {(['531', 'cluster', 'emom'] as const).map(mt => (
                        <button
                          key={mt}
                          onClick={() => setExerciseMethod(ei, mt)}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                            methodType === mt ? METHOD_HUES[mt] : 'bg-secondary text-muted-foreground border-transparent'
                          }`}
                        >
                          {METHOD_LABELS[mt]}
                        </button>
                      ))}
                      {methodType && (
                        <button
                          onClick={() => setExerciseMethod(ei, null)}
                          className="px-2.5 rounded-lg text-xs font-medium bg-secondary text-muted-foreground"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <button onClick={addExercise} className="flex items-center gap-1 text-primary text-sm font-medium py-1">
              <Plus size={14} /> Ajouter un exercice
            </button>
          </div>
        </div>

        <button
          onClick={finishBuild}
          className="w-full btn-neon font-semibold py-4 rounded-2xl touch-target text-lg flex items-center justify-center gap-2 transition-transform active:scale-95"
        >
          Terminé <Check size={20} />
        </button>
      </div>
    );
  }

  // ============================================================ Step — Objectif hebdo
  if (step === 'goal') {
    return (
      <div className="min-h-screen bg-background px-4 pt-12 pb-8 animate-slide-up">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={() => setStep('list')} className="text-muted-foreground p-1"><ChevronLeft size={20} /></button>
          <h2 className="text-2xl font-bold text-foreground">Ton objectif</h2>
        </div>
        <p className="text-muted-foreground text-sm mb-3 ml-8">Combien de séances par semaine vises-tu ?</p>
        <WizardProgress step={2} total={4} />

        <div className="glass-card p-6 mb-8">
          <p className="text-center text-5xl font-bold text-primary mb-6">{weeklyGoal}</p>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7].map(n => (
              <button
                key={n}
                onClick={() => setWeeklyGoal(n)}
                className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  weeklyGoal === n ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground mt-3">séances / semaine</p>
        </div>

        <button
          onClick={() => setStep(taggedExercises.length > 0 ? 'methodParams' : 'recap')}
          className="w-full btn-neon font-semibold py-4 rounded-2xl touch-target text-lg flex items-center justify-center gap-2 transition-transform active:scale-95"
        >
          Suivant <ChevronRight size={20} />
        </button>
      </div>
    );
  }

  // ============================================================ Step — Method params (TM + specifics)
  if (step === 'methodParams') {
    return (
      <div className="min-h-screen bg-background px-4 pt-12 pb-8 animate-slide-up">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={() => setStep('goal')} className="text-muted-foreground p-1"><ChevronLeft size={20} /></button>
          <h2 className="text-2xl font-bold text-foreground">Réglages des méthodes</h2>
        </div>
        <p className="text-muted-foreground text-sm mb-3 ml-8">
          Renseigne le Training Max de chaque exercice — modifiable à tout moment dans Réglages
        </p>
        <WizardProgress step={3} total={4} />

        <div className="space-y-4 mb-8">
          {taggedExercises.map(({ typeId, typeName, exercise }) => {
            const method = exercise.method!;
            const methodType = method.type as MethodType;
            const Icon = METHOD_ICONS[methodType];
            const mode = tmMode[exercise.id] ?? 'direct';
            const inputs = tmInputs[exercise.id] ?? { weight: 0, reps: 0 };
            const computedOneRM = estimateOneRepMax(inputs.weight, inputs.reps);

            return (
              <div key={exercise.id} className="glass-card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`flex items-center gap-1 text-[10px] font-medium rounded-full px-2 py-0.5 border ${METHOD_HUES[methodType]}`}>
                    <Icon size={10} /> {METHOD_LABELS[methodType]}
                  </span>
                  <span className="text-sm font-semibold text-foreground">{exercise.name}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{typeName}</span>
                </div>

                <div className="flex gap-1.5 mb-3">
                  <button
                    onClick={() => setTmMode(prev => ({ ...prev, [exercise.id]: 'direct' }))}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      mode === 'direct' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                    }`}
                  >
                    Je connais mon TM
                  </button>
                  <button
                    onClick={() => setTmMode(prev => ({ ...prev, [exercise.id]: 'compute' }))}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-all ${
                      mode === 'compute' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                    }`}
                  >
                    <Calculator size={12} /> Calculer
                  </button>
                </div>

                {mode === 'direct' ? (
                  <div className="flex items-center gap-2 mb-1">
                    <input
                      type="number"
                      value={method.trainingMax || ''}
                      onChange={e => setDirectTM(exercise.id, typeId, e.target.value === '' ? 0 : parseFloat(e.target.value))}
                      className="w-24 bg-secondary text-foreground rounded-lg px-2 py-2 text-sm text-center outline-none font-mono"
                      placeholder="TM"
                    />
                    <span className="text-xs text-muted-foreground">kg de Training Max</span>
                  </div>
                ) : (
                  <div className="mb-1">
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="number"
                        value={inputs.weight || ''}
                        onChange={e => setComputeInputs(exercise.id, typeId, e.target.value === '' ? 0 : parseFloat(e.target.value), inputs.reps)}
                        className="w-20 bg-secondary text-foreground rounded-lg px-2 py-2 text-sm text-center outline-none font-mono"
                        placeholder="kg"
                      />
                      <span className="text-muted-foreground text-xs">×</span>
                      <input
                        type="number"
                        value={inputs.reps || ''}
                        onChange={e => setComputeInputs(exercise.id, typeId, inputs.weight, e.target.value === '' ? 0 : parseInt(e.target.value))}
                        className="w-16 bg-secondary text-foreground rounded-lg px-2 py-2 text-sm text-center outline-none font-mono"
                        placeholder="reps"
                      />
                      <span className="text-xs text-muted-foreground">reps max récentes</span>
                    </div>
                    {computedOneRM > 0 && (
                      <p className="text-xs text-muted-foreground">
                        1RM estimée : <span className="text-foreground font-medium">{computedOneRM} kg</span> → TM (90%) : <span className="text-primary font-bold">{method.trainingMax} kg</span>
                      </p>
                    )}
                  </div>
                )}

                {methodType === 'cluster' && (() => {
                  const clusterMethod = method as ClusterMethod;
                  const currentMini = clusterMethod.miniSeries ?? CLUSTER_PRESETS[1].miniSeries;
                  return (
                    <div className="flex gap-1.5 mt-3">
                      {CLUSTER_PRESETS.map(preset => {
                        const active = JSON.stringify(preset.miniSeries) === JSON.stringify(currentMini);
                        return (
                          <button
                            key={preset.key}
                            onClick={() => updateMethodField(typeId, exercise.id, { miniSeries: preset.miniSeries })}
                            className={`flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all ${
                              active ? 'bg-accent-purple text-primary-foreground' : 'bg-secondary text-muted-foreground'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}

                {methodType === 'emom' && (() => {
                  const emomMethod = method as EMOMMethod;
                  const duration = emomMethod.durationMinutes ?? 10;
                  const reps = emomMethod.repsPerMinute ?? 2;
                  const pct = Math.round(getDefaultEmomPercentage(duration, reps) * 100);
                  return (
                    <div className="flex items-center gap-2 mt-3">
                      <input
                        type="number"
                        value={duration}
                        onChange={e => updateMethodField(typeId, exercise.id, { durationMinutes: parseInt(e.target.value) || 1 })}
                        className="w-16 bg-secondary text-foreground rounded-lg px-2 py-1.5 text-xs text-center outline-none font-mono"
                      />
                      <span className="text-xs text-muted-foreground">min ×</span>
                      <input
                        type="number"
                        value={reps}
                        onChange={e => updateMethodField(typeId, exercise.id, { repsPerMinute: parseInt(e.target.value) || 1 })}
                        className="w-14 bg-secondary text-foreground rounded-lg px-2 py-1.5 text-xs text-center outline-none font-mono"
                      />
                      <span className="text-xs text-muted-foreground">reps/min</span>
                      <span className="text-[10px] text-accent-blue font-medium ml-auto">≈{pct}% TM</span>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>

        <button
          onClick={() => setStep('recap')}
          className="w-full btn-neon font-semibold py-4 rounded-2xl touch-target text-lg flex items-center justify-center gap-2 transition-transform active:scale-95"
        >
          Suivant <ChevronRight size={20} />
        </button>
      </div>
    );
  }

  // ============================================================ Step — Recap
  return (
    <div className="min-h-screen bg-background px-4 pt-12 pb-8 animate-slide-up">
      <div className="flex items-center gap-3 mb-1">
        <button onClick={() => setStep(taggedExercises.length > 0 ? 'methodParams' : 'goal')} className="text-muted-foreground p-1"><ChevronLeft size={20} /></button>
        <h2 className="text-2xl font-bold text-foreground">C'est prêt !</h2>
      </div>
      <p className="text-muted-foreground text-sm mb-3 ml-8">Vérifie ta configuration</p>
      <WizardProgress step={4} total={4} />

      <div className="glass-card p-4 mb-3 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Objectif hebdo</span>
        <span className="text-foreground font-bold">{weeklyGoal} séances / semaine</span>
      </div>

      <div className="space-y-3 mb-6">
        {workoutTypes.map(type => (
          <div key={type.id} className="glass-card p-4">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `hsl(${type.color})` }} />
              <span className="text-foreground font-semibold">{type.name}</span>
              {(['531', 'cluster', 'emom'] as const).map(mt => type.exercises.some(e => e.method?.type === mt) && (
                <span key={mt} className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${METHOD_HUES[mt]}`}>{METHOD_LABELS[mt]}</span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground ml-6">
              {type.exercises.map(e => e.name).filter(Boolean).join(' · ') || 'Aucun exercice'}
            </p>
          </div>
        ))}
      </div>

      {taggedExercises.length > 0 ? (
        <div className="glass-card p-4 mb-4">
          {taggedExercises.map(({ exercise }) => (
            <div key={exercise.id} className="flex items-center justify-between mb-1 last:mb-0">
              <span className="text-sm text-muted-foreground">{exercise.name} — TM</span>
              <span className="text-foreground font-bold">{(exercise.method as FiveThreeOneMethod | ClusterMethod | EMOMMethod).trainingMax} kg</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="glass-card p-4 mb-4">
          <p className="text-sm text-muted-foreground">Aucune méthode d'entraînement — tu pourras en activer plus tard dans Réglages.</p>
        </div>
      )}

      <p className="text-xs text-muted-foreground mb-8 text-center">
        Tout ceci reste modifiable à tout moment dans Réglages.
      </p>

      <button
        onClick={handleFinish}
        className="w-full btn-neon font-semibold py-4 rounded-2xl touch-target text-lg flex items-center justify-center gap-2 transition-transform active:scale-95"
      >
        <Check size={20} /> Commencer
      </button>
    </div>
  );
};

export default SetupWizard;
