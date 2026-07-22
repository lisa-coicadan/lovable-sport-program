import { useState, useRef } from 'react';
import { AppData, WorkoutType, Exercise, WORKOUT_COLORS, BodyWeightLog, DEFAULT_APP_DATA } from '@/lib/types';
import { linkSuperset, unlinkSuperset, buildExerciseBlocks, flattenBlocks, ExerciseBlock } from '@/lib/superset';
import { parseSessionNotes, NOTES_SYNTAX_HELP } from '@/lib/notesParser';
import { ArrowLeft, Plus, Trash2, EyeOff, RotateCcw, Scale, Link2, Link2Off, Download, Upload, Database, AlertTriangle, FileText } from 'lucide-react';
import { SortableList, DragHandle } from './SortableBlock';
import { loadData, saveData } from '@/lib/storage';
import { toast } from '@/hooks/use-toast';



interface SettingsPanelProps {
  data: AppData;
  onUpdateData: (partial: Partial<AppData>) => void;
  onUpdate531: (cycle: number, week: number, tm: number) => void;
  onClose: () => void;
}

const SettingsPanel = ({ data, onUpdateData, onUpdate531, onClose }: SettingsPanelProps) => {
  const [workoutTypes, setWorkoutTypes] = useState<WorkoutType[]>([...data.workoutTypes]);
  const [tm, setTm] = useState(data.fiveThreeOne.trainingMax);
  const [cycle, setCycle] = useState(data.fiveThreeOne.currentCycle);
  const [week, setWeek] = useState(data.fiveThreeOne.currentWeek);
  const [squatSessionId, setSquatSessionId] = useState(data.squatSessionId);
  const [bodyWeight, setBodyWeight] = useState('');
  const [weeklyGoal, setWeeklyGoal] = useState(data.weeklyGoal);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesText, setNotesText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleParseNotes = () => {
    const result = parseSessionNotes(notesText);
    if (result.exercises.length === 0) {
      toast({
        title: 'Aucun exercice reconnu',
        description: 'Vérifie le format (voir l\'aide juste au-dessus) et réessaie.',
        variant: 'destructive',
      });
      return;
    }
    const colorIdx = workoutTypes.length % WORKOUT_COLORS.length;
    const newType: WorkoutType = {
      id: `wt${Date.now()}`,
      name: result.sessionName || 'Nouvelle séance',
      color: WORKOUT_COLORS[colorIdx],
      exercises: result.exercises.map((e, i) => ({
        id: `e${Date.now()}-${i}`,
        name: e.name,
        sets: e.sets,
        reps: e.reps,
        weight: e.weight,
        supersetGroupId: e.supersetGroupId,
        supersetRole: e.supersetRole,
      })),
    };
    setWorkoutTypes([...workoutTypes, newType]);
    setNotesText('');
    setNotesOpen(false);
    if (result.unrecognizedLines.length > 0) {
      toast({
        title: `Séance créée (${result.exercises.length} exercice${result.exercises.length > 1 ? 's' : ''})`,
        description: `${result.unrecognizedLines.length} ligne(s) non reconnue(s), à ajouter à la main : ${result.unrecognizedLines.join(' / ')}`,
      });
    } else {
      toast({
        title: 'Séance créée',
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
      const confirmed = window.confirm(
        `Restaurer cette sauvegarde ?\n\n• ${imported.sessions.length} séances\n• ${imported.workoutTypes.length} types de séance\n\nCela remplacera les données actuelles de cet appareil.`
      );
      if (!confirmed) return;
      saveData(imported);
      toast({ title: 'Sauvegarde restaurée', description: 'Rechargement…' });
      setTimeout(() => window.location.reload(), 400);
    } catch (err) {
      toast({ title: 'Import impossible', description: 'Fichier JSON invalide.', variant: 'destructive' });
    }
  };

  const handleReset = () => {
    const confirmed = window.confirm(
      `Réinitialiser complètement l'app ?\n\n` +
      `Ceci supprime définitivement TOUTES les données de cet appareil ` +
      `(${data.sessions?.length || 0} séances, programmes, réglages) et relance l'écran d'initialisation.\n\n` +
      `As-tu bien exporté une sauvegarde JSON récente ? Cette action est irréversible.`
    );
    if (!confirmed) return;
    onUpdateData(DEFAULT_APP_DATA);
  };


  const save = () => {
    const partial: Partial<AppData> = { workoutTypes, squatSessionId, weeklyGoal };
    
    // Add body weight log if entered
    if (bodyWeight) {
      const newLog: BodyWeightLog = {
        date: new Date().toISOString().split('T')[0],
        weight: parseFloat(bodyWeight),
      };
      partial.bodyWeightLogs = [...(data.bodyWeightLogs || []), newLog];
    }
    
    onUpdateData(partial);
    onUpdate531(cycle, week, tm);
    onClose();
  };

  const addWorkoutType = () => {
    const colorIdx = workoutTypes.length % WORKOUT_COLORS.length;
    setWorkoutTypes([...workoutTypes, {
      id: `wt${Date.now()}`,
      name: '',
      color: WORKOUT_COLORS[colorIdx],
      exercises: [],
    }]);
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

  const updateExercise = (typeIndex: number, exIndex: number, field: keyof Exercise, value: string | number) => {
    const updated = [...workoutTypes];
    const ex = updated[typeIndex].exercises[exIndex];
    (ex as any)[field] = value;
    // Keep sets synced between superset partners
    if (field === 'sets' && ex.supersetGroupId) {
      updated[typeIndex].exercises = updated[typeIndex].exercises.map(e =>
        e.supersetGroupId === ex.supersetGroupId ? { ...e, sets: ex.sets } : e
      );
    }
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
    <div className="px-4 pt-12 pb-24 animate-slide-up">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onClose} className="text-muted-foreground touch-target p-1">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold text-foreground">Settings</h1>
      </div>

      {/* Body Weight */}
      <div className="glass-card p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Scale size={16} className="text-primary" />
          <h3 className="text-sm font-bold text-foreground">Log Body Weight</h3>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            value={bodyWeight}
            onChange={e => setBodyWeight(e.target.value)}
            className="flex-1 bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none font-mono text-center"
            placeholder="e.g. 75"
          />
          <span className="text-sm text-muted-foreground">kg</span>
        </div>
        {(data.bodyWeightLogs || []).length > 0 && (
          <p className="text-[10px] text-muted-foreground mt-2">
            Last: {data.bodyWeightLogs.sort((a, b) => b.date.localeCompare(a.date))[0].weight} kg
          </p>
        )}
      </div>

      {/* Weekly Goal */}
      <div className="glass-card p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-foreground">Weekly Goal</span>
          <span className="text-sm font-bold text-primary">{weeklyGoal} sessions</span>
        </div>
        <input
          type="range"
          min={1}
          max={7}
          value={weeklyGoal}
          onChange={e => setWeeklyGoal(parseInt(e.target.value))}
          className="w-full accent-primary h-2"
        />
      </div>

      {/* 5/3/1 Settings */}
      <div className="glass-card p-4 mb-6">
        <h3 className="text-sm font-bold text-primary mb-4">5/3/1 Squat Program</h3>
        
        <div className="mb-4">
          <label className="text-xs text-muted-foreground mb-1.5 block">Training Max (kg)</label>
          <input
            type="number"
            value={tm || ''}
            onChange={e => setTm(e.target.value === '' ? 0 : parseFloat(e.target.value))}
            className="w-full bg-secondary text-foreground text-2xl font-bold rounded-xl px-4 py-3 text-center outline-none"
          />
          <p className="text-[10px] text-muted-foreground mt-1 text-center">
            Next cycle TM: {tm + 2.5} kg
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Cycle</label>
            <div className="flex items-center gap-2">
              <button onClick={() => setCycle(Math.max(1, cycle - 1))} className="bg-secondary text-foreground rounded-lg w-10 h-10 text-lg font-bold touch-target">-</button>
              <span className="text-foreground text-lg font-bold flex-1 text-center">{cycle}</span>
              <button onClick={() => setCycle(cycle + 1)} className="bg-secondary text-foreground rounded-lg w-10 h-10 text-lg font-bold touch-target">+</button>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Week</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4].map(w => (
                <button
                  key={w}
                  onClick={() => setWeek(w)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                    week === w ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                  }`}
                >
                  {w === 4 ? 'D' : `W${w}`}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-2 block">Squat session</label>
          <div className="grid grid-cols-2 gap-1.5">
            {workoutTypes.filter(t => !t.hidden).map(type => (
              <button
                key={type.id}
                onClick={() => setSquatSessionId(type.id)}
                className={`py-2 rounded-lg text-xs font-medium transition-all ${
                  squatSessionId === type.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
                }`}
              >
                {type.name || 'Unnamed'}
              </button>
            ))}
            <button
              onClick={() => setSquatSessionId(null)}
              className={`py-2 rounded-lg text-xs font-medium transition-all ${
                squatSessionId === null ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
              }`}
            >
              None
            </button>
          </div>
        </div>
      </div>

      {/* Active Sessions */}
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Active Sessions</h3>
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
                    placeholder="Session name"
                  />
                  <button onClick={() => toggleHide(ti)} className="text-muted-foreground p-1 touch-target" title="Hide">
                    <EyeOff size={16} />
                  </button>
                  <button onClick={() => deleteType(ti)} className="text-destructive p-1 touch-target" title="Delete">
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                  <span className="text-[10px] text-muted-foreground mr-1">Color</span>
                  {WORKOUT_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => updateTypeColor(ti, c)}
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${type.color === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: `hsl(${c})` }}
                      aria-label="Select color"
                    />
                  ))}
                </div>
                <div className="space-y-1.5">
                  {(() => {
                    const blocks = buildExerciseBlocks(type.exercises);

                    const renderRow = (ex: Exercise, opts?: { hideSets?: boolean }) => {
                      const ei = type.exercises.findIndex(e => e.id === ex.id);
                      return (
                        <div className="flex items-center gap-1.5 flex-1">
                          <input
                            value={ex.name}
                            onChange={e => updateExercise(ti, ei, 'name', e.target.value)}
                            className="flex-1 min-w-0 bg-secondary text-foreground rounded-lg px-2.5 py-1.5 text-sm outline-none"
                            placeholder="Exercise"
                          />
                          {opts?.hideSets ? (
                            <span className="text-[10px] text-muted-foreground w-10 text-center">shared</span>
                          ) : (
                            <input
                              type="number"
                              value={ex.sets || ''}
                              onChange={e => updateExercise(ti, ei, 'sets', e.target.value === '' ? '' as any : parseInt(e.target.value) || 0)}
                              className="w-10 bg-secondary text-foreground rounded-lg px-1 py-1.5 text-sm text-center outline-none"
                              placeholder="S"
                            />
                          )}
                          <span className="text-muted-foreground text-xs">×</span>
                          <input
                            type="number"
                            value={ex.reps || ''}
                            onChange={e => updateExercise(ti, ei, 'reps', e.target.value === '' ? '' as any : parseInt(e.target.value) || 0)}
                            className="w-10 bg-secondary text-foreground rounded-lg px-1 py-1.5 text-sm text-center outline-none"
                            placeholder="R"
                          />
                          <input
                            type="number"
                            value={ex.weight || ''}
                            onChange={e => updateExercise(ti, ei, 'weight', e.target.value === '' ? 0 : parseFloat(e.target.value) || 0)}
                            className="w-12 bg-secondary text-foreground rounded-lg px-1 py-1.5 text-sm text-center outline-none"
                            placeholder="kg"
                          />
                          <button onClick={() => removeExercise(ti, ei)} className="text-muted-foreground p-1">
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
                                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                      <span>Series</span>
                                      <input
                                        type="number"
                                        value={a.sets || ''}
                                        onChange={e => updateExercise(ti, aIdx, 'sets', e.target.value === '' ? '' as any : parseInt(e.target.value) || 0)}
                                        className="w-10 bg-secondary text-foreground rounded-md px-1 py-0.5 text-xs text-center outline-none"
                                      />
                                    </div>
                                    <button
                                      onClick={() => unlinkExerciseSuperset(ti, block.key)}
                                      className="text-muted-foreground p-1 active:text-destructive"
                                      title="Unlink"
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
                          const freePartners = type.exercises.filter(e => e.id !== ex.id && !e.supersetGroupId);
                          return (
                            <div className="space-y-1 mb-1.5">
                              <div className="flex items-center gap-1">
                                <DragHandle />
                                {renderRow(ex)}
                              </div>
                              {freePartners.length > 0 && (
                                <details className="pl-6">
                                  <summary className="text-[10px] text-muted-foreground cursor-pointer flex items-center gap-1 py-0.5">
                                    <Link2 size={10} /> Link as superset
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
                            </div>
                          );
                        }}
                      </SortableList>
                    );
                  })()}

                  <button onClick={() => addExercise(ti)} className="flex items-center gap-1 text-primary text-xs font-medium py-1">
                    <Plus size={12} /> Add exercise
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
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">Hidden Sessions</h3>
          <div className="space-y-2">
            {hiddenTypes.map(type => {
              const ti = workoutTypes.findIndex(t => t.id === type.id);
              return (
                <div key={type.id} className="glass-card p-3 opacity-60 flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `hsl(${type.color})` }} />
                  <span className="text-foreground text-sm flex-1">{type.name || 'Unnamed'}</span>
                  <button onClick={() => toggleHide(ti)} className="text-primary p-1 touch-target" title="Restore">
                    <RotateCcw size={16} />
                  </button>
                  <button onClick={() => deleteType(ti)} className="text-destructive p-1 touch-target" title="Delete permanently">
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
        <Plus size={16} /> Add new session type
      </button>

      {/* Create a session from freeform notes */}
      <div className="glass-card p-4 mb-6">
        <button
          onClick={() => setNotesOpen(v => !v)}
          className="w-full flex items-center justify-center gap-2 text-primary text-sm font-medium"
        >
          <FileText size={16} /> Créer une séance depuis des notes
        </button>
        {notesOpen && (
          <div className="mt-3">
            <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap bg-secondary rounded-lg p-2.5 mb-2">
              {NOTES_SYNTAX_HELP}
            </pre>
            <textarea
              value={notesText}
              onChange={e => setNotesText(e.target.value)}
              placeholder={'Push\nDéveloppé couché : 3x8\nDéveloppé militaire 4x12 @10kg'}
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
            <Download size={14} /> Export
          </button>
          <button
            onClick={handleImportClick}
            className="flex items-center justify-center gap-1.5 bg-secondary text-foreground rounded-xl py-2.5 text-sm font-medium active:scale-95 transition-transform"
          >
            <Upload size={14} /> Import
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
        className="w-full bg-primary text-primary-foreground font-semibold py-4 rounded-2xl touch-target text-lg transition-transform active:scale-95"
      >
        Save Settings
      </button>
    </div>
  );
};

export default SettingsPanel;
