import { useState, useRef } from 'react';
import { AppData, WorkoutType, Exercise, ExerciseMethod, Program, WORKOUT_COLORS, BodyWeightLog, DEFAULT_APP_DATA } from '@/lib/types';
import { linkSuperset, unlinkSuperset, buildExerciseBlocks, flattenBlocks, ExerciseBlock } from '@/lib/superset';
import { parseSessionNotes, NOTES_SYNTAX_HELP, NOTES_SYNTAX_HELP_FILL } from '@/lib/notesParser';
import { getEmomConfig, getEmomWeight, getDefaultEmomPercentage } from '@/lib/emom';
import { getClusterConfig, getMiniSeriesWeight, CLUSTER_PRESETS } from '@/lib/cluster';
import { estimateOneRepMax, estimateTrainingMax } from '@/lib/trainingMax';
import { ArrowLeft, Plus, Trash2, EyeOff, Eye, Scale, Link2, Link2Off, Download, Upload, Database, AlertTriangle, FileText, Zap, Timer, Clock, Layers, Check, Calculator } from 'lucide-react';
import { SortableList, DragHandle } from './SortableBlock';
import { loadData, saveData } from '@/lib/storage';
import { toast } from '@/hooks/use-toast';



// French names for WORKOUT_COLORS, same order, so color-swatch buttons can carry a
// distinguishing aria-label instead of the identical "Choisir une couleur" for all eight.
const WORKOUT_COLOR_NAMES = ['cyan', 'violet', 'magenta', 'ambre', 'indigo', 'turquoise', 'rouge', 'jaune'];

// Training Max input with the same "je connais mon TM" / "calculer" toggle as the
// onboarding wizard (SetupWizard's methodParams step) — lets her recompute a TM from a
// recent heavy set (weight x reps -> Brzycki 1RM -> 90%) directly in Réglages instead of
// only at setup time.
const TrainingMaxField = ({ trainingMax, onChange }: { trainingMax: number; onChange: (tm: number) => void }) => {
  const [mode, setMode] = useState<'direct' | 'compute'>('direct');
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const oneRM = estimateOneRepMax(parseFloat(weight) || 0, parseInt(reps) || 0);
  const computedTm = estimateTrainingMax(oneRM);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-muted-foreground">Training Max (kg)</span>
        <button
          onClick={() => setMode(m => m === 'direct' ? 'compute' : 'direct')}
          className="text-[10px] text-primary flex items-center gap-1"
        >
          <Calculator size={10} /> {mode === 'direct' ? 'Recalculer' : 'Saisie directe'}
        </button>
      </div>
      {mode === 'direct' ? (
        <input
          type="number"
          value={trainingMax || ''}
          onChange={e => onChange(e.target.value === '' ? 0 : parseFloat(e.target.value))}
          className="w-full bg-background/60 text-foreground text-lg font-bold rounded-lg px-2 py-2 text-center outline-none"
        />
      ) : (
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <input
              type="number"
              value={weight}
              onChange={e => setWeight(e.target.value)}
              placeholder="kg"
              className="flex-1 min-w-0 bg-background/60 text-foreground rounded-lg px-2 py-1.5 text-sm text-center outline-none font-mono"
            />
            <span className="text-xs text-muted-foreground">×</span>
            <input
              type="number"
              value={reps}
              onChange={e => setReps(e.target.value)}
              placeholder="reps"
              className="flex-1 min-w-0 bg-background/60 text-foreground rounded-lg px-2 py-1.5 text-sm text-center outline-none font-mono"
            />
          </div>
          {oneRM > 0 && (
            <p className="text-[10px] text-muted-foreground mb-1.5">
              1RM estimée : {oneRM} kg → TM (90%) : <span className="text-primary font-bold">{computedTm} kg</span>
            </p>
          )}
          <button
            onClick={() => { onChange(computedTm); setMode('direct'); }}
            disabled={computedTm <= 0}
            className="w-full bg-primary/15 text-primary rounded-lg py-1.5 text-xs font-medium disabled:opacity-40"
          >
            Utiliser ce TM
          </button>
        </div>
      )}
    </div>
  );
};

interface SettingsPanelProps {
  data: AppData;
  onUpdateData: (partial: Partial<AppData>) => void;
  onClose: () => void;
}

const SettingsPanel = ({ data, onUpdateData, onClose }: SettingsPanelProps) => {
  const [workoutTypes, setWorkoutTypes] = useState<WorkoutType[]>([...data.workoutTypes]);
  const [programs, setPrograms] = useState<Program[]>(data.programs && data.programs.length > 0 ? [...data.programs] : []);
  const [activeProgramId, setActiveProgramId] = useState<string | null>(data.activeProgramId ?? (programs[0]?.id ?? null));
  const [bodyWeight, setBodyWeight] = useState('');
  const [weeklyGoal, setWeeklyGoal] = useState(data.weeklyGoal);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesText, setNotesText] = useState('');
  const [notesTargetId, setNotesTargetId] = useState<string | null>(null);
  // window.prompt() is silently disabled by iOS Safari in standalone (home-screen) PWAs —
  // it never shows anything and returns null, so "Nouveau"/"Renommer" would do nothing on
  // her phone. This in-app modal replaces it for both flows.
  const [namePrompt, setNamePrompt] = useState<{ title: string; onSubmit: (name: string) => void } | null>(null);
  const [namePromptValue, setNamePromptValue] = useState('');
  // window.confirm() has the same iOS standalone-PWA reliability issue as window.prompt()
  // above — this in-app modal replaces every window.confirm() in this file.
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel: string; danger?: boolean; onConfirm: () => void } | null>(null);
  const [expandedMethodFor, setExpandedMethodFor] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Program management ----------------------------------------------------------
  const createProgram = () => {
    setNamePromptValue('Nouveau programme');
    setNamePrompt({
      title: 'Nom du nouveau programme',
      onSubmit: name => {
        const p: Program = { id: `p${Date.now()}`, name };
        // Recreate the active program's session names (empty, same color) so she only has
        // to fill in exercises for the new program instead of retyping every session title.
        const previousSessions = workoutTypes.filter(t => t.programId === activeProgramId && !t.hidden);
        const duplicated: WorkoutType[] = previousSessions.map((t, i) => ({
          id: `t${Date.now()}_${i}`,
          name: t.name,
          color: t.color,
          exercises: [],
          programId: p.id,
        }));
        setPrograms(prev => [...prev, p]);
        // The new program becomes active, so its (empty) sessions go on top and the
        // previous program's sessions auto-hide — she'll find them again in "Séances
        // masquées", history/stats untouched, instead of two same-named cards side by side.
        setWorkoutTypes(prev => [
          ...duplicated,
          ...prev.map(t => t.programId === activeProgramId ? { ...t, hidden: true } : t),
        ]);
        setActiveProgramId(p.id);
      },
    });
  };

  const renameActiveProgram = () => {
    const current = programs.find(p => p.id === activeProgramId);
    if (!current) return;
    setNamePromptValue(current.name);
    setNamePrompt({
      title: 'Renommer le programme',
      onSubmit: name => {
        setPrograms(prev => prev.map(p => p.id === activeProgramId ? { ...p, name } : p));
      },
    });
  };

  const deleteActiveProgram = () => {
    if (!activeProgramId || programs.length <= 1) {
      toast({ title: 'Impossible', description: 'Garde au moins un programme.', variant: 'destructive' });
      return;
    }
    const current = programs.find(p => p.id === activeProgramId);
    const owned = workoutTypes.filter(t => t.programId === activeProgramId && !t.hidden).length;
    setConfirmDialog({
      title: 'Supprimer ce programme ?',
      message: `Supprimer "${current?.name}" ? Ses ${owned} séance(s) seront masquées (non supprimées, tu retrouveras leur historique dans Calendrier/Stats).`,
      confirmLabel: 'Supprimer',
      danger: true,
      onConfirm: () => {
        setPrograms(prev => prev.filter(p => p.id !== activeProgramId));
        // Hide owned workoutTypes rather than deleting them — history/stats keep referencing
        // them by id unaffected, they just stop being offered anywhere as selectable.
        const fallback = programs.find(p => p.id !== activeProgramId)!;
        setWorkoutTypes(prev => prev.map(t => t.programId === activeProgramId ? { ...t, hidden: true } : t));
        setActiveProgramId(fallback.id);
      },
    });
  };


  const handleParseNotes = () => {
    // parseSessionNotes always treats line 1 as the session title — when filling an
    // existing shell she shouldn't have to (and if she doesn't, her first real exercise
    // line would be swallowed as the title instead). Prepend the target's own name as a
    // throwaway title line so every line she typed is parsed as an exercise.
    const targetName = notesTargetId ? workoutTypes.find(t => t.id === notesTargetId)?.name : null;
    const result = parseSessionNotes(targetName ? `${targetName}\n${notesText}` : notesText);
    if (result.exercises.length === 0) {
      toast({
        title: 'Aucun exercice reconnu',
        description: 'Vérifie le format (voir l\'aide juste au-dessus) et réessaie.',
        variant: 'destructive',
      });
      return;
    }
    const parsedExercises: Exercise[] = result.exercises.map((e, i) => ({
      id: `e${Date.now()}-${i}`,
      name: e.name,
      sets: e.sets,
      reps: e.reps,
      weight: e.weight,
      supersetGroupId: e.supersetGroupId,
      supersetRole: e.supersetRole,
    }));

    // Filling in an existing empty session shell (e.g. one auto-duplicated when creating
    // a new program) updates it in place instead of creating a second session with the
    // same name.
    if (notesTargetId) {
      setWorkoutTypes(prev => prev.map(t => t.id === notesTargetId ? { ...t, exercises: parsedExercises } : t));
      setNotesTargetId(null);
    } else {
      const colorIdx = workoutTypes.length % WORKOUT_COLORS.length;
      const newType: WorkoutType = {
        id: `wt${Date.now()}`,
        name: result.sessionName || 'Nouvelle séance',
        color: WORKOUT_COLORS[colorIdx],
        exercises: parsedExercises,
        programId: activeProgramId ?? undefined,
      };
      setWorkoutTypes([newType, ...workoutTypes]);
    }
    setNotesText('');
    setNotesOpen(false);
    if (result.unrecognizedLines.length > 0) {
      toast({
        title: `Séance ${notesTargetId ? 'complétée' : 'créée'} (${result.exercises.length} exercice${result.exercises.length > 1 ? 's' : ''})`,
        description: `${result.unrecognizedLines.length} ligne(s) non reconnue(s), à ajouter à la main : ${result.unrecognizedLines.join(' / ')}`,
      });
    } else {
      toast({
        title: notesTargetId ? 'Séance complétée' : 'Séance créée',
        description: `${result.exercises.length} exercice${result.exercises.length > 1 ? 's' : ''} ajouté${result.exercises.length > 1 ? 's' : ''} depuis tes notes.`,
      });
    }
  };

  const handleExport = () => {
    try {
      const current = loadData();
      const payload = {
        __app: 'fittrack',
        __version: 1,
        exportedAt: new Date().toISOString(),
        data: current,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = `fittrack-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: 'Sauvegarde exportée', description: 'Le fichier JSON a été téléchargé.' });
    } catch (e) {
      toast({ title: 'Erreur export', description: String(e), variant: 'destructive' });
    }
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const imported: AppData | undefined =
        parsed?.data && typeof parsed.data === 'object' ? parsed.data :
        (parsed && Array.isArray(parsed.sessions) && Array.isArray(parsed.workoutTypes)) ? parsed :
        undefined;
      if (!imported || !Array.isArray(imported.workoutTypes) || !Array.isArray(imported.sessions)) {
        throw new Error('Fichier invalide');
      }
      setConfirmDialog({
        title: 'Restaurer cette sauvegarde ?',
        message: `${imported.sessions.length} séances\n${imported.workoutTypes.length} types de séance\n\nCela remplacera les données actuelles de cet appareil.`,
        confirmLabel: 'Restaurer',
        danger: true,
        onConfirm: () => {
          saveData(imported);
          toast({ title: 'Sauvegarde restaurée', description: 'Rechargement…' });
          setTimeout(() => window.location.reload(), 400);
        },
      });
    } catch (err) {
      toast({ title: 'Import impossible', description: 'Fichier JSON invalide.', variant: 'destructive' });
    }
  };

  const handleReset = () => {
    setConfirmDialog({
      title: "Réinitialiser complètement l'app ?",
      message:
        `Ceci supprime définitivement TOUTES les données de cet appareil ` +
        `(${data.sessions?.length || 0} séances, programmes, réglages) et relance l'écran d'initialisation.\n\n` +
        `As-tu bien exporté une sauvegarde JSON récente ? Cette action est irréversible.`,
      confirmLabel: 'Réinitialiser',
      danger: true,
      onConfirm: () => onUpdateData(DEFAULT_APP_DATA),
    });
  };


  const save = () => {
    const partial: Partial<AppData> = { workoutTypes, weeklyGoal, programs, activeProgramId };

    // Add body weight log if entered
    if (bodyWeight) {
      const newLog: BodyWeightLog = {
        date: new Date().toISOString().split('T')[0],
        weight: parseFloat(bodyWeight),
      };
      partial.bodyWeightLogs = [...(data.bodyWeightLogs || []), newLog];
    }

    onUpdateData(partial);
    onClose();
  };

  const addWorkoutType = () => {
    const colorIdx = workoutTypes.length % WORKOUT_COLORS.length;
    setWorkoutTypes([{
      id: `wt${Date.now()}`,
      name: '',
      color: WORKOUT_COLORS[colorIdx],
      exercises: [],
      programId: activeProgramId ?? undefined,
    }, ...workoutTypes]);
  };

  const toggleHide = (index: number) => {
    const updated = [...workoutTypes];
    updated[index].hidden = !updated[index].hidden;
    setWorkoutTypes(updated);
  };

  const deleteType = (index: number) => {
    setWorkoutTypes(workoutTypes.filter((_, i) => i !== index));
  };

  const addExercise = (typeIndex: number) => {
    const updated = [...workoutTypes];
    updated[typeIndex].exercises.push({ id: `e${Date.now()}`, name: '', sets: 3, reps: 10 });
    setWorkoutTypes(updated);
  };

  const removeExercise = (typeIndex: number, exIndex: number) => {
    const updated = [...workoutTypes];
    const ex = updated[typeIndex].exercises[exIndex];
    // If in superset, unlink first so the partner survives standalone
    if (ex.supersetGroupId) {
      updated[typeIndex].exercises = unlinkSuperset(updated[typeIndex].exercises, ex.supersetGroupId);
    }
    updated[typeIndex].exercises.splice(exIndex, 1);
    setWorkoutTypes(updated);
  };

  const updateExercise = <K extends keyof Exercise>(typeIndex: number, exIndex: number, field: K, value: Exercise[K]) => {
    const updated = [...workoutTypes];
    const ex = updated[typeIndex].exercises[exIndex];
    ex[field] = value;
    // Keep sets synced between superset partners
    if (field === 'sets' && ex.supersetGroupId) {
      updated[typeIndex].exercises = updated[typeIndex].exercises.map(e =>
        e.supersetGroupId === ex.supersetGroupId ? { ...e, sets: ex.sets } : e
      );
    }
    setWorkoutTypes(updated);
  };

  const updateExerciseMethod = (typeIndex: number, exIndex: number, method: ExerciseMethod | undefined) => {
    const updated = [...workoutTypes];
    updated[typeIndex].exercises[exIndex] = { ...updated[typeIndex].exercises[exIndex], method };
    setWorkoutTypes(updated);
  };

  const linkExerciseSuperset = (typeIndex: number, exId: string, partnerId: string) => {
    const updated = [...workoutTypes];
    updated[typeIndex].exercises = linkSuperset(updated[typeIndex].exercises, exId, partnerId);
    setWorkoutTypes(updated);
  };

  const unlinkExerciseSuperset = (typeIndex: number, groupId: string) => {
    const updated = [...workoutTypes];
    updated[typeIndex].exercises = unlinkSuperset(updated[typeIndex].exercises, groupId);
    setWorkoutTypes(updated);
  };

  const updateTypeName = (index: number, name: string) => {
    const updated = [...workoutTypes];
    updated[index].name = name;
    setWorkoutTypes(updated);
  };

  const updateTypeColor = (index: number, color: string) => {
    const updated = [...workoutTypes];
    updated[index].color = color;
    setWorkoutTypes(updated);
  };

  const hiddenTypes = workoutTypes.filter(t => t.hidden);

  return (
    <>
    <div className="px-4 pt-12 pb-24 animate-slide-up">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onClose} className="text-muted-foreground touch-target p-1" aria-label="Fermer les réglages">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-foreground">Réglages</h1>
      </div>

      {/* Programme actif — multi-program grouping. Sessions history is never filtered
          by program (it stays intact across switches); only the list of active
          workoutTypes shown below and in the Workout tab is filtered. */}
      {programs.length > 0 && (
        <div className="glass-card p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Layers size={16} className="text-primary" />
            <h3 className="text-sm font-bold text-foreground">Programme actif</h3>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {programs.map(p => (
              <button
                key={p.id}
                onClick={() => setActiveProgramId(p.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeProgramId === p.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={createProgram}
              className="flex items-center justify-center gap-1 bg-secondary text-foreground rounded-lg py-2 text-[11px] font-medium active:scale-95 transition-transform"
            >
              <Plus size={12} /> Nouveau
            </button>
            <button
              onClick={renameActiveProgram}
              disabled={!activeProgramId}
              className="bg-secondary text-foreground rounded-lg py-2 text-[11px] font-medium active:scale-95 transition-transform disabled:opacity-40"
            >
              Renommer
            </button>
            <button
              onClick={deleteActiveProgram}
              disabled={!activeProgramId || programs.length <= 1}
              className="bg-secondary text-destructive rounded-lg py-2 text-[11px] font-medium active:scale-95 transition-transform disabled:opacity-40"
            >
              Supprimer
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Seules les séances du programme actif sont affichées dans l'onglet Séance. L'historique reste intact.
          </p>
        </div>
      )}
      <div className="glass-card p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Scale size={16} className="text-primary" />
          <h3 className="text-sm font-bold text-foreground">Bodyweight</h3>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            value={bodyWeight}
            onChange={e => setBodyWeight(e.target.value)}
            className="flex-1 bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none font-mono text-center"
            placeholder="ex. 75"
            aria-label="Bodyweight (kg)"
          />
          <span className="text-sm text-muted-foreground">kg</span>
        </div>
        {(data.bodyWeightLogs || []).length > 0 && (
          <p className="text-[10px] text-muted-foreground mt-2">
            Dernier : {data.bodyWeightLogs.sort((a, b) => b.date.localeCompare(a.date))[0].weight} kg
          </p>
        )}
      </div>

      {/* Weekly Goal */}
      <div className="glass-card p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-foreground">Objectif hebdo</span>
          <span className="text-sm font-bold text-primary">{weeklyGoal} séances</span>
        </div>
        <input
          type="range"
          aria-label="Objectif hebdomadaire de séances"
          min={1}
          max={7}
          value={weeklyGoal}
          onChange={e => setWeeklyGoal(parseInt(e.target.value))}
          className="w-full accent-primary h-2"
        />
      </div>


      {/* Active Sessions */}
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Séances actives</h3>
        <div className="space-y-3">
          {workoutTypes.map((type, ti) => {
            if (type.hidden) return null;
            return (
              <div key={type.id} className="glass-card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `hsl(${type.color})` }} />
                  <input
                    value={type.name}
                    onChange={e => updateTypeName(ti, e.target.value)}
                    className="bg-transparent text-foreground font-semibold outline-none flex-1"
                    placeholder="Nom de la séance"
                  />
                  {programs.length > 1 && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground shrink-0">
                      {programs.find(p => p.id === type.programId)?.name ?? '—'}
                    </span>
                  )}
                  <button onClick={() => toggleHide(ti)} className="text-muted-foreground p-1 touch-target" title="Masquer" aria-label={`Masquer ${type.name || 'cette séance'}`}>
                    <EyeOff size={16} />
                  </button>
                  <button onClick={() => deleteType(ti)} className="text-destructive p-1 touch-target" title="Supprimer" aria-label={`Supprimer ${type.name || 'cette séance'}`}>
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                  <span className="text-[10px] text-muted-foreground mr-1">Couleur</span>
                  {WORKOUT_COLORS.map((c, ci) => (
                    <button
                      key={c}
                      onClick={() => updateTypeColor(ti, c)}
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${type.color === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: `hsl(${c})` }}
                      aria-label={`Couleur ${WORKOUT_COLOR_NAMES[ci] || ci + 1}`}
                      aria-pressed={type.color === c}
                    />
                  ))}
                </div>
                {type.exercises.length === 0 && (
                  notesOpen && notesTargetId === type.id ? (
                    <div className="mb-3 bg-secondary/40 rounded-xl p-3">
                      <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap bg-secondary rounded-lg p-2.5 mb-2">
                        {NOTES_SYNTAX_HELP_FILL}
                      </pre>
                      <textarea
                        autoFocus
                        value={notesText}
                        onChange={e => setNotesText(e.target.value)}
                        placeholder={'Développé couché : 3x8\nDéveloppé militaire 4x12 à 10kg'}
                        rows={6}
                        className="w-full bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none font-mono mb-2"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => { setNotesOpen(false); setNotesText(''); setNotesTargetId(null); }}
                          className="bg-secondary text-secondary-foreground rounded-xl py-2.5 text-sm font-medium active:scale-95 transition-transform"
                        >
                          Annuler
                        </button>
                        <button
                          onClick={handleParseNotes}
                          className="bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-medium active:scale-95 transition-transform"
                        >
                          Remplir la séance
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setNotesTargetId(type.id); setNotesOpen(true); }}
                      className="w-full flex items-center justify-center gap-1.5 bg-primary/10 text-primary rounded-lg py-2 text-xs font-medium mb-3"
                    >
                      <FileText size={12} /> Remplir depuis mes notes
                    </button>
                  )
                )}
                <div className="space-y-1.5">
                  {(() => {
                    const blocks = buildExerciseBlocks(type.exercises);

                    const renderRow = (ex: Exercise, opts?: { hideSets?: boolean }) => {
                      const ei = type.exercises.findIndex(e => e.id === ex.id);
                      const hasMethod = !!ex.method;
                      return (
                        <div className="flex items-center gap-1.5 flex-1">
                          <input
                            value={ex.name}
                            onChange={e => updateExercise(ti, ei, 'name', e.target.value)}
                            className={`flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-sm outline-none ${
                              hasMethod
                                ? 'bg-primary/15 text-primary font-medium border border-primary/40'
                                : 'bg-secondary text-foreground'
                            }`}
                            placeholder="Exercice"
                          />
                          {hasMethod ? (
                            <span className="text-[10px] text-muted-foreground px-1 flex-shrink-0" title="Séries, reps et poids sont calculés automatiquement à partir du Training Max">
                              auto ({ex.method?.type === 'cluster' ? 'Cluster' : ex.method?.type === 'emom' ? 'EMOM' : '5/3/1'})
                            </span>
                          ) : (
                            <>
                              {opts?.hideSets ? (
                                <span className="text-[10px] text-muted-foreground w-10 text-center">partagé</span>
                              ) : (
                                <input
                                  type="number"
                                  value={ex.sets || ''}
                                  onChange={e => updateExercise(ti, ei, 'sets', e.target.value === '' ? '' as any : parseInt(e.target.value) || 0)}
                                  className="w-10 bg-secondary text-foreground rounded-lg px-1 py-1.5 text-sm text-center outline-none"
                                  placeholder="S"
                                  aria-label={`Séries, ${ex.name || 'exercice'}`}
                                />
                              )}
                              <span className="text-muted-foreground text-xs">×</span>
                              <input
                                type="number"
                                value={ex.reps || ''}
                                onChange={e => updateExercise(ti, ei, 'reps', e.target.value === '' ? '' as any : parseInt(e.target.value) || 0)}
                                className="w-10 bg-secondary text-foreground rounded-lg px-1 py-1.5 text-sm text-center outline-none"
                                placeholder="R"
                                aria-label={`Répétitions, ${ex.name || 'exercice'}`}
                              />
                              <input
                                type="number"
                                value={ex.weight || ''}
                                onChange={e => updateExercise(ti, ei, 'weight', e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)}
                                className="w-12 bg-secondary text-foreground rounded-lg px-1 py-1.5 text-sm text-center outline-none"
                                placeholder="kg"
                                aria-label={`Poids, ${ex.name || 'exercice'} (kg)`}
                              />
                            </>
                          )}
                          <button onClick={() => removeExercise(ti, ei)} className="text-muted-foreground p-1" aria-label={`Supprimer ${ex.name || 'cet exercice'}`}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      );
                    };

                    const onReorder = (newBlocks: ExerciseBlock[]) => {
                      const updated = [...workoutTypes];
                      updated[ti] = { ...updated[ti], exercises: flattenBlocks(newBlocks, updated[ti].exercises) };
                      setWorkoutTypes(updated);
                    };

                    return (
                      <SortableList items={blocks} onReorder={onReorder}>
                        {(block) => {
                          if (block.isSuperset) {
                            const [aId, bId] = block.exerciseIds;
                            const a = type.exercises.find(e => e.id === aId)!;
                            const b = type.exercises.find(e => e.id === bId);
                            const aIdx = type.exercises.findIndex(e => e.id === aId);
                            return (
                              <div className="border border-primary/40 bg-primary/5 rounded-xl p-2.5 space-y-1.5 mb-1.5">
                                <div className="flex items-center justify-between mb-1">
                                  <div className="flex items-center gap-1">
                                    <DragHandle />
                                    <span className="text-[10px] font-bold text-primary tracking-wider">SUPERSET</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {!a.method && (
                                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                        <span>Séries</span>
                                        <input
                                          type="number"
                                          value={a.sets || ''}
                                          onChange={e => updateExercise(ti, aIdx, 'sets', e.target.value === '' ? '' as any : parseInt(e.target.value) || 0)}
                                          className="w-10 bg-secondary text-foreground rounded-md px-1 py-0.5 text-xs text-center outline-none"
                                          aria-label={`Nombre de séries, superset ${a.name}${b ? ' + ' + b.name : ''}`}
                                        />
                                      </div>
                                    )}
                                    <button
                                      onClick={() => unlinkExerciseSuperset(ti, block.key)}
                                      className="text-muted-foreground p-1 active:text-destructive"
                                      title="Dissocier"
                                      aria-label={`Dissocier le superset ${a.name}${b ? ' + ' + b.name : ''}`}
                                    >
                                      <Link2Off size={13} />
                                    </button>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-bold text-primary w-4">A</span>
                                  {renderRow(a, { hideSets: true })}
                                </div>
                                {b && (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] font-bold text-primary w-4">B</span>
                                    {renderRow(b, { hideSets: true })}
                                  </div>
                                )}
                              </div>
                            );
                          }
                          const ex = type.exercises.find(e => e.id === block.exerciseIds[0])!;
                          const exIdx = type.exercises.findIndex(e => e.id === ex.id);
                          const freePartners = type.exercises.filter(e => e.id !== ex.id && !e.supersetGroupId);
                          const method531 = ex.method?.type === '531' ? ex.method : null;
                          const methodCluster = ex.method?.type === 'cluster' ? ex.method : null;
                          const methodEmom = ex.method?.type === 'emom' ? ex.method : null;
                          return (
                            <div className="space-y-1 mb-1.5">
                              <div className="flex items-center gap-1">
                                <DragHandle />
                                {renderRow(ex)}
                              </div>
                              {freePartners.length > 0 && (
                                <details className="pl-6">
                                  <summary className="text-[10px] text-muted-foreground cursor-pointer flex items-center gap-1 py-0.5">
                                    <Link2 size={10} /> Associer en superset
                                  </summary>
                                  <div className="flex flex-wrap gap-1 pt-1">
                                    {freePartners.map(p => (
                                      <button
                                        key={p.id}
                                        onClick={() => linkExerciseSuperset(ti, ex.id, p.id)}
                                        className="text-[10px] bg-secondary hover:bg-primary/20 text-foreground px-2 py-1 rounded-md"
                                      >
                                        + {p.name || 'Unnamed'}
                                      </button>
                                    ))}
                                  </div>
                                </details>
                              )}
                              {method531 ? (
                                <div className="rounded-xl p-3 bg-primary/10 border border-primary/30 space-y-2.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-primary flex items-center gap-1">
                                      <span className="relative inline-flex w-3 h-3 items-center justify-center">
                                        <span className="absolute inset-0 bg-primary/50 rounded-full blur-sm animate-pulse-glow" />
                                        <Zap size={12} className="relative" />
                                      </span> 5/3/1 actif
                                    </span>
                                    <button
                                      onClick={() => updateExerciseMethod(ti, exIdx, undefined)}
                                      className="text-[10px] text-muted-foreground underline"
                                    >
                                      Retirer
                                    </button>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <TrainingMaxField
                                        trainingMax={method531.trainingMax}
                                        onChange={tm => updateExerciseMethod(ti, exIdx, { ...method531, trainingMax: tm })}
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[10px] text-muted-foreground block mb-1">
                                        Incrément / cycle (kg)
                                        <input
                                          type="number"
                                          step="0.5"
                                          value={method531.increment ?? 2.5}
                                          onChange={e => updateExerciseMethod(ti, exIdx, {
                                            ...method531,
                                            increment: e.target.value === '' ? 0 : parseFloat(e.target.value),
                                          })}
                                          className="w-full bg-background/60 text-foreground text-lg font-bold rounded-lg px-2 py-2 text-center outline-none mt-1"
                                        />
                                      </label>
                                    </div>
                                  </div>
                                  <div>
                                    <span className="text-[10px] text-muted-foreground block mb-1">Cycle actuel</span>
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => updateExerciseMethod(ti, exIdx, { ...method531, currentCycle: Math.max(1, method531.currentCycle - 1) })}
                                        className="bg-background/60 text-foreground rounded-lg w-9 h-9 text-base font-bold touch-target"
                                        aria-label="Cycle précédent"
                                      >
                                        -
                                      </button>
                                      <span className="text-foreground text-base font-bold flex-1 text-center">{method531.currentCycle}</span>
                                      <button
                                        onClick={() => updateExerciseMethod(ti, exIdx, { ...method531, currentCycle: method531.currentCycle + 1 })}
                                        className="bg-background/60 text-foreground rounded-lg w-9 h-9 text-base font-bold touch-target"
                                        aria-label="Cycle suivant"
                                      >
                                        +
                                      </button>
                                    </div>
                                  </div>
                                  <div>
                                    <span className="text-[10px] text-muted-foreground block mb-1">Semaine</span>
                                    <div className="flex gap-1">
                                      {[1, 2, 3, 4].map(w => (
                                        <button
                                          key={w}
                                          onClick={() => updateExerciseMethod(ti, exIdx, { ...method531, currentWeek: w })}
                                          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                                            method531.currentWeek === w ? 'bg-primary text-primary-foreground' : 'bg-background/60 text-muted-foreground'
                                          }`}
                                          aria-label={w === 4 ? 'Semaine 4, deload' : `Semaine ${w}`}
                                          aria-pressed={method531.currentWeek === w}
                                        >
                                          {w === 4 ? 'D' : `S${w}`}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              ) : methodCluster ? (
                                <div className="rounded-xl p-3 bg-accent-purple/10 border border-accent-purple/30 space-y-2.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-accent-purple flex items-center gap-1">
                                      <span className="relative inline-flex w-3 h-3 items-center justify-center">
                                        <span className="absolute inset-0 bg-accent-purple/50 rounded-full blur-sm animate-pulse-glow" />
                                        <Timer size={12} className="relative" />
                                      </span> Cluster actif
                                    </span>
                                    <button
                                      onClick={() => updateExerciseMethod(ti, exIdx, undefined)}
                                      className="text-[10px] text-muted-foreground underline"
                                    >
                                      Retirer
                                    </button>
                                  </div>
                                  <div>
                                    <TrainingMaxField
                                      trainingMax={methodCluster.trainingMax}
                                      onChange={tm => updateExerciseMethod(ti, exIdx, { ...methodCluster, trainingMax: tm })}
                                    />
                                  </div>
                                  {(() => {
                                    const config = getClusterConfig(methodCluster);
                                    const updateMiniSeries = (next: typeof config.miniSeries) =>
                                      updateExerciseMethod(ti, exIdx, { ...methodCluster, miniSeries: next });
                                    return (
                                      <>
                                        <div>
                                          <label className="text-[10px] text-muted-foreground block mb-1">Formats de référence</label>
                                          <div className="flex flex-wrap gap-1">
                                            {CLUSTER_PRESETS.map(preset => (
                                              <button
                                                key={preset.key}
                                                onClick={() => updateMiniSeries(preset.miniSeries)}
                                                className="text-[10px] bg-background/60 hover:bg-primary/20 text-foreground px-2 py-1 rounded-md"
                                              >
                                                {preset.label}
                                              </button>
                                            ))}
                                          </div>
                                        </div>
                                        <div>
                                          <span className="text-[10px] text-muted-foreground block mb-1">Nombre de séries</span>
                                          <div className="flex items-center gap-2">
                                            <button
                                              onClick={() => updateExerciseMethod(ti, exIdx, { ...methodCluster, numSeries: Math.max(1, config.numSeries - 1) })}
                                              className="bg-background/60 text-foreground rounded-lg w-8 h-8 text-sm font-bold touch-target"
                                              aria-label="Une série de moins"
                                            >
                                              -
                                            </button>
                                            <span className="text-foreground text-sm font-bold flex-1 text-center">{config.numSeries}</span>
                                            <button
                                              onClick={() => updateExerciseMethod(ti, exIdx, { ...methodCluster, numSeries: config.numSeries + 1 })}
                                              className="bg-background/60 text-foreground rounded-lg w-8 h-8 text-sm font-bold touch-target"
                                              aria-label="Une série de plus"
                                            >
                                              +
                                            </button>
                                          </div>
                                        </div>
                                        <div>
                                          <label className="text-[10px] text-muted-foreground block mb-1">Mini-séries (répétées à chaque série)</label>
                                          <div className="space-y-1">
                                            {config.miniSeries.map((m, mi) => (
                                              <div key={mi} className="flex items-center gap-1.5">
                                                <input
                                                  type="number"
                                                  value={m.reps || ''}
                                                  onChange={e => {
                                                    const reps = e.target.value === '' ? 0 : parseInt(e.target.value) || 0;
                                                    updateMiniSeries(config.miniSeries.map((row, i) => i === mi ? { ...row, reps } : row));
                                                  }}
                                                  className="w-12 bg-background/60 text-foreground rounded-md px-1.5 py-1.5 text-xs text-center outline-none"
                                                  placeholder="reps"
                                                  aria-label={`Répétitions, mini-série ${mi + 1}`}
                                                />
                                                <span className="text-muted-foreground text-[10px]">reps ×</span>
                                                <input
                                                  type="number"
                                                  step="0.5"
                                                  value={m.percentage ? Math.round(m.percentage * 1000) / 10 : ''}
                                                  onChange={e => {
                                                    const pct = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                                                    updateMiniSeries(config.miniSeries.map((row, i) => i === mi ? { ...row, percentage: pct / 100 } : row));
                                                  }}
                                                  className="w-14 bg-background/60 text-foreground rounded-md px-1.5 py-1.5 text-xs text-center outline-none"
                                                  placeholder="%TM"
                                                  aria-label={`Pourcentage du Training Max, mini-série ${mi + 1}`}
                                                />
                                                <span className="text-muted-foreground text-[10px]">%TM</span>
                                                <span className="text-[10px] text-primary font-mono ml-auto">
                                                  {getMiniSeriesWeight(methodCluster.trainingMax, m.percentage)}kg
                                                </span>
                                                {config.miniSeries.length > 1 && (
                                                  <button
                                                    onClick={() => updateMiniSeries(config.miniSeries.filter((_, i) => i !== mi))}
                                                    className="text-muted-foreground p-1 active:text-destructive"
                                                    aria-label={`Supprimer la mini-série ${mi + 1}`}
                                                  >
                                                    <Trash2 size={12} />
                                                  </button>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                          <button
                                            onClick={() => updateMiniSeries([...config.miniSeries, { reps: 2, percentage: 0.85 }])}
                                            className="flex items-center gap-1 text-primary text-[10px] font-medium py-1 mt-1"
                                          >
                                            <Plus size={10} /> Ajouter une mini-série
                                          </button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                          <div>
                                            <label className="text-[10px] text-muted-foreground block mb-1">
                                              Repos mini-séries (s)
                                              <input
                                                type="number"
                                                value={config.restMiniSeries || ''}
                                                onChange={e => updateExerciseMethod(ti, exIdx, {
                                                  ...methodCluster,
                                                  restMiniSeries: e.target.value === '' ? 0 : parseInt(e.target.value) || 0,
                                                })}
                                                className="w-full bg-background/60 text-foreground rounded-lg px-2 py-1.5 text-sm text-center outline-none mt-1"
                                              />
                                            </label>
                                          </div>
                                          <div>
                                            <label className="text-[10px] text-muted-foreground block mb-1">
                                              Repos séries (s)
                                              <input
                                                type="number"
                                                value={config.restSeries || ''}
                                                onChange={e => updateExerciseMethod(ti, exIdx, {
                                                  ...methodCluster,
                                                  restSeries: e.target.value === '' ? 0 : parseInt(e.target.value) || 0,
                                                })}
                                                className="w-full bg-background/60 text-foreground rounded-lg px-2 py-1.5 text-sm text-center outline-none mt-1"
                                              />
                                            </label>
                                          </div>
                                        </div>
                                      </>
                                    );
                                  })()}
                                </div>
                              ) : methodEmom ? (
                                <div className="rounded-xl p-3 bg-accent-blue/10 border border-accent-blue/30 space-y-2.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-accent-blue flex items-center gap-1">
                                      <span className="relative inline-flex w-3 h-3 items-center justify-center">
                                        <span className="absolute inset-0 bg-accent-blue/50 rounded-full blur-sm animate-pulse-glow" />
                                        <Clock size={12} className="relative" />
                                      </span> EMOM actif
                                    </span>
                                    <button
                                      onClick={() => updateExerciseMethod(ti, exIdx, undefined)}
                                      className="text-[10px] text-muted-foreground underline"
                                    >
                                      Retirer
                                    </button>
                                  </div>
                                  <div>
                                    <TrainingMaxField
                                      trainingMax={methodEmom.trainingMax}
                                      onChange={tm => updateExerciseMethod(ti, exIdx, { ...methodEmom, trainingMax: tm })}
                                    />
                                  </div>
                                  {(() => {
                                    const config = getEmomConfig(methodEmom);
                                    return (
                                      <>
                                        <div className="grid grid-cols-2 gap-2">
                                          <div>
                                            <label className="text-[10px] text-muted-foreground block mb-1">
                                              Durée (min)
                                              <input
                                                type="number"
                                                value={config.durationMinutes || ''}
                                                onChange={e => {
                                                  const durationMinutes = e.target.value === '' ? 0 : parseInt(e.target.value) || 0;
                                                  updateExerciseMethod(ti, exIdx, {
                                                    ...methodEmom,
                                                    durationMinutes,
                                                    percentage: getDefaultEmomPercentage(durationMinutes, config.repsPerMinute),
                                                  });
                                                }}
                                                className="w-full bg-background/60 text-foreground rounded-lg px-2 py-1.5 text-sm text-center outline-none mt-1"
                                              />
                                            </label>
                                          </div>
                                          <div>
                                            <label className="text-[10px] text-muted-foreground block mb-1">
                                              Reps / minute
                                              <input
                                                type="number"
                                                value={config.repsPerMinute || ''}
                                                onChange={e => {
                                                  const repsPerMinute = e.target.value === '' ? 0 : parseInt(e.target.value) || 0;
                                                  updateExerciseMethod(ti, exIdx, {
                                                    ...methodEmom,
                                                    repsPerMinute,
                                                    percentage: getDefaultEmomPercentage(config.durationMinutes, repsPerMinute),
                                                  });
                                                }}
                                                className="w-full bg-background/60 text-foreground rounded-lg px-2 py-1.5 text-sm text-center outline-none mt-1"
                                              />
                                            </label>
                                          </div>
                                        </div>
                                        <div>
                                          <label className="text-[10px] text-muted-foreground block mb-1">
                                            % du TM (suggéré automatiquement, modifiable)
                                            <input
                                              type="number"
                                              step="0.5"
                                              value={config.percentage ? Math.round(config.percentage * 1000) / 10 : ''}
                                              onChange={e => {
                                                const pct = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0;
                                                updateExerciseMethod(ti, exIdx, { ...methodEmom, percentage: pct / 100 });
                                              }}
                                              className="w-full bg-background/60 text-foreground rounded-lg px-2 py-1.5 text-sm text-center outline-none mt-1"
                                            />
                                          </label>
                                        </div>
                                        <p className="text-[10px] text-muted-foreground">
                                          <span className="text-primary font-bold">{getEmomWeight(methodEmom.trainingMax, config.percentage)}kg</span> × {config.repsPerMinute} chaque minute pendant {config.durationMinutes} min
                                        </p>
                                      </>
                                    );
                                  })()}
                                </div>
                              ) : (
                                <div className="pl-1">
                                  <button
                                    onClick={() => setExpandedMethodFor(expandedMethodFor === ex.id ? null : ex.id)}
                                    className="text-[10px] text-muted-foreground flex items-center gap-1"
                                  >
                                    <Zap size={10} /> Ajouter une méthode
                                  </button>
                                  {expandedMethodFor === ex.id && (
                                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                      <button
                                        onClick={() => { updateExerciseMethod(ti, exIdx, { type: '531', trainingMax: 60, currentCycle: 1, currentWeek: 1, increment: 2.5 }); setExpandedMethodFor(null); }}
                                        className="text-[10px] text-muted-foreground flex items-center gap-1"
                                      >
                                        <Zap size={10} /> 5/3/1
                                      </button>
                                      <button
                                        onClick={() => { updateExerciseMethod(ti, exIdx, { type: 'cluster', trainingMax: 60 }); setExpandedMethodFor(null); }}
                                        className="text-[10px] text-muted-foreground flex items-center gap-1"
                                      >
                                        <Timer size={10} /> Cluster
                                      </button>
                                      <button
                                        onClick={() => { updateExerciseMethod(ti, exIdx, { type: 'emom', trainingMax: 60 }); setExpandedMethodFor(null); }}
                                        className="text-[10px] text-muted-foreground flex items-center gap-1"
                                      >
                                        <Clock size={10} /> EMOM
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        }}
                      </SortableList>
                    );
                  })()}

                  <button onClick={() => addExercise(ti)} className="flex items-center gap-1 text-primary text-xs font-medium py-1">
                    <Plus size={12} /> Ajouter un exercice
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Hidden Sessions */}
      {hiddenTypes.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">Séances masquées</h3>
          <div className="space-y-2">
            {hiddenTypes.map(type => {
              const ti = workoutTypes.findIndex(t => t.id === type.id);
              return (
                <div key={type.id} className="glass-card p-3 opacity-60 flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `hsl(${type.color})` }} />
                  <span className="text-foreground text-sm flex-1">{type.name || 'Sans nom'}</span>
                  <button onClick={() => toggleHide(ti)} className="text-primary p-1 touch-target" title="Restaurer" aria-label={`Restaurer ${type.name || 'cette séance'}`}>
                    <Eye size={16} />
                  </button>
                  <button onClick={() => deleteType(ti)} className="text-destructive p-1 touch-target" title="Supprimer définitivement" aria-label={`Supprimer définitivement ${type.name || 'cette séance'}`}>
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <button
        onClick={addWorkoutType}
        className="w-full glass-card p-3 flex items-center justify-center gap-2 text-primary text-sm font-medium mb-3 transition-transform active:scale-95"
      >
        <Plus size={16} /> Ajouter un type de séance
      </button>

      {/* Create a session from freeform notes */}
      <div className="glass-card p-4 mb-6">
        <button
          onClick={() => { setNotesOpen(v => !v); setNotesTargetId(null); }}
          className="w-full flex items-center justify-center gap-2 text-primary text-sm font-medium"
        >
          <FileText size={16} /> Créer une séance depuis des notes
        </button>
        {notesOpen && !notesTargetId && (
          <div className="mt-3">
            <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap bg-secondary rounded-lg p-2.5 mb-2">
              {NOTES_SYNTAX_HELP}
            </pre>
            <textarea
              value={notesText}
              onChange={e => setNotesText(e.target.value)}
              placeholder={'Push\nDéveloppé couché : 3x8\nDéveloppé militaire 4x12 à 10kg'}
              rows={6}
              className="w-full bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none font-mono mb-2"
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setNotesOpen(false); setNotesText(''); }}
                className="bg-secondary text-secondary-foreground rounded-xl py-2.5 text-sm font-medium active:scale-95 transition-transform"
              >
                Annuler
              </button>
              <button
                onClick={handleParseNotes}
                className="bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-medium active:scale-95 transition-transform"
              >
                Créer la séance
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Backup / Restore */}
      <div className="glass-card p-4 mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Database size={16} className="text-primary" />
          <h3 className="text-sm font-bold text-foreground">Sauvegarde</h3>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Vos données sont stockées uniquement sur cet appareil. Exportez un fichier pour ne rien perdre.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleExport}
            className="flex items-center justify-center gap-1.5 bg-secondary text-foreground rounded-xl py-2.5 text-sm font-medium active:scale-95 transition-transform"
          >
            <Download size={14} /> Exporter
          </button>
          <button
            onClick={handleImportClick}
            className="flex items-center justify-center gap-1.5 bg-secondary text-foreground rounded-xl py-2.5 text-sm font-medium active:scale-95 transition-transform"
          >
            <Upload size={14} /> Importer
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImportFile}
          className="hidden"
        />
        <p className="text-[10px] text-muted-foreground mt-2">
          {(data.sessions?.length || 0)} séances enregistrées sur cet appareil.
        </p>

        <div className="h-px bg-border my-3" />

        <button
          onClick={handleReset}
          className="w-full flex items-center justify-center gap-1.5 bg-destructive/10 text-destructive rounded-xl py-2.5 text-sm font-medium active:scale-95 transition-transform"
        >
          <AlertTriangle size={14} /> Réinitialiser l'app
        </button>
        <p className="text-[10px] text-muted-foreground mt-2">
          Supprime toutes les données locales et relance l'initialisation. Pense à exporter une sauvegarde avant.
        </p>
      </div>


      <button
        onClick={save}
        className="w-full btn-neon font-semibold py-4 rounded-2xl touch-target text-lg transition-transform active:scale-95"
      >
        Enregistrer les réglages
      </button>
    </div>

    {/* Rendered outside the animated wrapper above — same reason RestTimer moved out in
        WorkoutTab: an animated `transform` ancestor makes iOS Safari treat `fixed`
        descendants as if they were `absolute` to that ancestor instead of the viewport. */}
    {namePrompt && (
      <div
        className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 animate-fade-in"
        onClick={() => setNamePrompt(null)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="name-prompt-title"
          className="glass-card p-6 max-w-sm w-full"
          onClick={e => e.stopPropagation()}
        >
          <h3 id="name-prompt-title" className="text-lg font-bold text-foreground mb-3">{namePrompt.title}</h3>
          <input
            autoFocus
            value={namePromptValue}
            onChange={e => setNamePromptValue(e.target.value)}
            className="w-full bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none mb-4"
            placeholder="Nom du programme"
          />
          <div className="flex gap-3">
            <button
              onClick={() => setNamePrompt(null)}
              className="flex-1 bg-secondary text-secondary-foreground font-medium py-2.5 rounded-xl text-sm touch-target"
            >
              Annuler
            </button>
            <button
              onClick={() => {
                const trimmed = namePromptValue.trim();
                if (!trimmed) return;
                namePrompt.onSubmit(trimmed);
                setNamePrompt(null);
              }}
              className="flex-1 btn-neon font-medium py-2.5 rounded-xl text-sm touch-target"
            >
              Valider
            </button>
          </div>
        </div>
      </div>
    )}

    {confirmDialog && (
      <div
        className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 animate-fade-in"
        onClick={() => setConfirmDialog(null)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          className="glass-card p-6 max-w-sm w-full"
          onClick={e => e.stopPropagation()}
        >
          <h3 id="confirm-dialog-title" className="text-lg font-bold text-foreground mb-2">{confirmDialog.title}</h3>
          <p className="text-sm text-muted-foreground mb-6 whitespace-pre-line">{confirmDialog.message}</p>
          <div className="flex gap-3">
            <button
              onClick={() => setConfirmDialog(null)}
              className="flex-1 bg-secondary text-secondary-foreground font-medium py-2.5 rounded-xl text-sm touch-target"
            >
              Annuler
            </button>
            <button
              onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
              className={`flex-1 font-medium py-2.5 rounded-xl text-sm touch-target ${confirmDialog.danger ? 'bg-destructive text-destructive-foreground' : 'btn-neon'}`}
            >
              {confirmDialog.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default SettingsPanel;
