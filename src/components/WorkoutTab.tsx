import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AppData, WorkoutType, SetLog, SessionLog, FiveThreeOneMethod, ClusterMethod, EMOMMethod, ExerciseMethod, Exercise, calculate1RM, CardioSession, CardioActivityType, DeloadType, DeloadIntensity } from '@/lib/types';
import { getWeekSets, getWeekLabel, computeNextFiveThreeOneWeekState } from '@/lib/531';
import { getClusterConfig, getMiniSeriesWeight } from '@/lib/cluster';
import { getEmomConfig, getEmomWeight } from '@/lib/emom';
import { buildExerciseBlocks } from '@/lib/superset';
import { isBodyweightOptionalExercise, weightFieldValue } from '@/lib/exerciseNormalize';
import { getDropSetConfig, getDropSetStage } from '@/lib/dropset';
import { compareCardioSession, formatCardioDuration, formatPace } from '@/lib/cardio';
import {
  shouldShowDeloadRecommendation, DeloadCriteria, buildDeloadAcceptPatch, buildDeloadDismissPatch,
  consumeDeloadOnSessionSave, getDeloadTargetWorkoutTypes, applyDeloadToWeight, applyDeloadToTrainingMax,
  getDeloadSetCount, shouldReduceSets,
} from '@/lib/deload';
import RestTimer, { RestTimerHandle } from './RestTimer';
import EmomTimer from './EmomTimer';
import ExerciseHistory from './ExerciseHistory';
import SessionSummary from './SessionSummary';
import SettingsPanel from './SettingsPanel';
import { Check, ChevronRight, ArrowLeft, Settings, History, Plus, Trash2, ChevronDown, Timer, Pencil, TrendingDown, Activity, Footprints, Waves, Bike, Lightbulb, Gauge, X } from 'lucide-react';
import { SortableList, DragHandle } from './SortableBlock';
import SetDots from './SetDots';


interface WorkoutTabProps {
  data: AppData;
  onSaveSession: (session: SessionLog) => void;
  onUpdateData: (partial: Partial<AppData>) => void;
  selectedDate?: string | null;
  onClearSelectedDate?: () => void;
  // Reports the live session's completed-sets fraction (0-1), or null when no session is
  // in progress — lets BottomTabBar show a progress strip even while she's on another tab.
  onProgressChange?: (progress: number | null) => void;
}

type Mode = 'select' | 'recap' | 'summary' | 'settings' | 'history' | 'cardio';

// "1.0.0" -> "1.0" (patch caché, voir vite.config.ts pour l'injection du meta tag et
// .claude/hooks/version-bump/ pour l'incrémentation auto à chaque commit) — sert à
// vérifier à distance quelle version un appareil fait vraiment tourner.
const APP_VERSION = document
  .querySelector('meta[name="app-version"]')
  ?.getAttribute('content')
  ?.split('.')
  .slice(0, 2)
  .join('.');

export const CARDIO_ACTIVITY_TYPES: { type: CardioActivityType; icon: typeof Footprints }[] = [
  { type: 'Course à pied', icon: Footprints },
  { type: 'Natation', icon: Waves },
  { type: 'Vélo', icon: Bike },
  { type: 'Autre', icon: Activity },
];

// Cluster/EMOM are session-level techniques, not a standing program like 5/3/1: the
// exercise's configured method (from Settings) is just the default for a new session,
// swappable here without touching that default. Never persisted — resets each time the
// select screen is (re)entered.
type MethodOverride = 'default' | 'none' | 'cluster' | 'emom';

const formatRestLabel = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${mins}m` : `${mins}m${rest.toString().padStart(2, '0')}`;
};

// Generates the SetLog rows for one exercise given whichever method actually applies
// (its configured default, or a live session override) — shared by the initial session
// build and by the in-session method switch, so both stay in sync.
const buildSetsForExercise = (ex: Exercise, method: ExerciseMethod | undefined, lastWeight: number): SetLog[] => {
  if (method?.type === '531') {
    const weekSets = getWeekSets(method.trainingMax, method.currentWeek);
    return weekSets.map((s, i) => ({
      exerciseId: ex.id, exerciseName: ex.name, setNumber: i + 1,
      reps: parseInt(s.reps) || 1, weight: s.weight, completed: false,
    }));
  }
  if (method?.type === 'cluster') {
    const { numSeries, miniSeries } = getClusterConfig(method);
    const result: SetLog[] = [];
    let i = 0;
    for (let s = 0; s < numSeries; s++) {
      miniSeries.forEach(m => {
        result.push({
          exerciseId: ex.id, exerciseName: ex.name, setNumber: ++i,
          reps: m.reps, weight: getMiniSeriesWeight(method.trainingMax, m.percentage), completed: false,
        });
      });
    }
    return result;
  }
  if (method?.type === 'emom') {
    const { durationMinutes, repsPerMinute, percentage } = getEmomConfig(method);
    const weight = getEmomWeight(method.trainingMax, percentage);
    const result: SetLog[] = [];
    for (let i = 0; i < durationMinutes; i++) {
      result.push({ exerciseId: ex.id, exerciseName: ex.name, setNumber: i + 1, reps: repsPerMinute, weight, completed: false });
    }
    return result;
  }
  const result: SetLog[] = [];
  for (let i = 0; i < ex.sets; i++) {
    result.push({
      exerciseId: ex.id, exerciseName: ex.name, setNumber: i + 1,
      reps: ex.amrap ? 0 : ex.reps, weight: lastWeight, completed: false,
      amrap: ex.amrap || undefined,
    });
  }
  return result;
};

// Cluster = purple, EMOM = blue, Normal = pink — same hue mapping as the onboarding wizard.
const METHOD_OPT_HUE: Record<'cluster' | 'emom' | 'none', string> = {
  cluster: 'bg-accent-purple text-primary-foreground',
  emom: 'bg-accent-blue text-primary-foreground',
  none: 'bg-primary text-primary-foreground',
};

// Cluster/EMOM/Normal picker shown once the session is live, on the exercise's own card.
const MethodPickerRow = ({ active, onSelect }: { active: 'cluster' | 'emom' | 'none'; onSelect: (opt: 'cluster' | 'emom' | 'none') => void }) => (
  <div className="flex gap-1.5 mb-3">
    {(['cluster', 'emom', 'none'] as const).map(opt => (
      <button
        key={opt}
        onClick={() => onSelect(opt)}
        className={`flex-1 min-h-11 flex items-center justify-center rounded-lg text-xs font-medium transition-all ${
          active === opt ? METHOD_OPT_HUE[opt] : 'bg-secondary text-muted-foreground'
        }`}
      >
        {opt === 'cluster' ? 'Cluster' : opt === 'emom' ? 'EMOM' : 'Normal'}
      </button>
    ))}
  </div>
);

const WorkoutTab = ({ data, onSaveSession, onUpdateData, selectedDate, onClearSelectedDate, onProgressChange }: WorkoutTabProps) => {
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
  const [clusterAutoTimer, setClusterAutoTimer] = useState(false);
  const [methodOverrides, setMethodOverrides] = useState<Record<string, MethodOverride>>({});
  const [showAbandonConfirm, setShowAbandonConfirm] = useState(false);
  const [reminderNoteEditor, setReminderNoteEditor] = useState<{ exerciseId: string; name: string; draft: string } | null>(null);
  // RPE per exercise, filled live during the session (not in the end-of-session recap,
  // which only asks for one session-wide value) — merged into the SessionLog at
  // finishWorkout(). Reset whenever a session starts/ends, same lifecycle as sets/etc.
  const [exerciseDifficulty, setExerciseDifficulty] = useState<Record<string, number>>({});
  const [difficultyEditor, setDifficultyEditor] = useState<{ exerciseId: string; name: string; draft: number } | null>(null);
  // Renaming a regular exercise mid-session (e.g. "Hack squat ou leg press" -> whichever
  // one she actually did today) reuses updateExerciseName below — the card's displayed
  // name already reads live from `sets`, not from the WorkoutType template, so this is
  // session-only by construction, no separate override map needed.
  const [renamingExerciseId, setRenamingExerciseId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Which exercise's "après quelle série ?" drop-set picker is currently open — a drop
  // set can cascade from ANY regular series, not just the last one, so tapping "Drop
  // set" opens a small chip picker instead of assuming a fixed anchor.
  const [dropSetPickerFor, setDropSetPickerFor] = useState<string | null>(null);
  // Type/Intensity popup shown after tapping "Accepter" on the deload recommendation
  // banner — defaults match the spec's "(recommandé)" picks.
  const [deloadPopupOpen, setDeloadPopupOpen] = useState(false);
  const [deloadTypeDraft, setDeloadTypeDraft] = useState<DeloadType>('both');
  const [deloadIntensityDraft, setDeloadIntensityDraft] = useState<DeloadIntensity>('medium');
  const restTimerRef = useRef<RestTimerHandle>(null);

  // Cardio logging is a simple after-the-fact form (not an interactive session like the
  // rest of this component) — its own small state block, reset whenever the form closes.
  const [cardioActivityType, setCardioActivityType] = useState<CardioActivityType>('Course à pied');
  const [cardioCustomLabel, setCardioCustomLabel] = useState('');
  const [cardioDurationMin, setCardioDurationMin] = useState('');
  const [cardioDurationSec, setCardioDurationSec] = useState('');
  const [cardioDistance, setCardioDistance] = useState('');
  const [cardioDifficulty, setCardioDifficulty] = useState(5);
  const [cardioRecapOpen, setCardioRecapOpen] = useState(false);

  const resetCardioForm = () => {
    setCardioActivityType('Course à pied');
    setCardioCustomLabel('');
    setCardioDurationMin('');
    setCardioDurationSec('');
    setCardioDistance('');
    setCardioDifficulty(3);
    setCardioRecapOpen(false);
  };

  const cardioDurationMinutes = (parseInt(cardioDurationMin, 10) || 0) + (parseInt(cardioDurationSec, 10) || 0) / 60;
  const cardioDistanceRaw = cardioDistance.trim() === '' ? undefined : parseFloat(cardioDistance) || undefined;
  const cardioDistanceKm = cardioDistanceRaw === undefined ? undefined : cardioActivityType === 'Natation' ? cardioDistanceRaw / 1000 : cardioDistanceRaw;

  const saveCardioSession = () => {
    if (cardioDurationMinutes <= 0) return;
    const session: CardioSession = {
      id: `cardio-${Date.now()}`,
      date: selectedDate || new Date().toISOString().split('T')[0],
      activityType: cardioActivityType,
      customActivityLabel: cardioActivityType === 'Autre' ? cardioCustomLabel.trim() || undefined : undefined,
      durationMinutes: cardioDurationMinutes,
      distanceKm: cardioDistanceKm,
      difficulty: cardioDifficulty,
    };
    onUpdateData({ cardioSessions: [...(data.cardioSessions || []), session] });
    resetCardioForm();
    setMode('select');
    onClearSelectedDate?.();
  };

  // Resolves the full method (preset/rest times/duration included, not just TM) that
  // applies for a given override choice — reusing the exercise's own configured method
  // whenever its type already matches, so toggling away and back restores it exactly,
  // and only synthesizing a bare-defaults method when switching to a technique the
  // exercise wasn't already configured for.
  const resolveOverrideMethod = (ex: Exercise, opt: 'cluster' | 'emom' | 'none'): ExerciseMethod | undefined => {
    if (opt === 'none') return undefined;
    if (ex.method?.type === opt) return ex.method;
    return { type: opt, trainingMax: ex.method?.trainingMax ?? 60 };
  };

  // Resolves what method actually applies to this exercise for the session about to
  // start: the per-session override if she picked one, otherwise the exercise's
  // configured default. Only cluster/emom exercises get an override control — 5/3/1
  // stays a standing program, always following its configured state.
  const getEffectiveMethod = useCallback((ex: Exercise): ExerciseMethod | undefined => {
    const override = methodOverrides[ex.id];
    if (!override || override === 'default') return ex.method;
    return resolveOverrideMethod(ex, override as 'cluster' | 'emom' | 'none');
  }, [methodOverrides]);

  // Switches an exercise's technique for the current session only (never touches its
  // configured default) and regenerates its live sets in place, at the same position
  // in the flat `sets` array, so ordering and other exercises are undisturbed.
  const applyMethodOverride = (ex: Exercise, opt: 'cluster' | 'emom' | 'none') => {
    const currentType = getEffectiveMethod(ex)?.type ?? 'none';
    if (currentType === opt) return;
    setMethodOverrides(prev => ({ ...prev, [ex.id]: opt }));
    const effectiveMethod = resolveOverrideMethod(ex, opt);
    setSets(prev => {
      const idx = prev.findIndex(s => s.exerciseId === ex.id);
      if (idx === -1) return prev;
      const insertAt = prev.slice(0, idx).filter(s => s.exerciseId !== ex.id).length;
      const filtered = prev.filter(s => s.exerciseId !== ex.id);
      const fresh = buildSetsForExercise(ex, effectiveMethod, 0);
      const result = [...filtered];
      result.splice(insertAt, 0, ...fresh);
      return result;
    });
  };

  // "Ajouter une séance" on a Calendar day sets `selectedDate` and switches to this tab —
  // she means "let me pick a workout type for that date," not whatever screen (Réglages,
  // Historique...) this component happened to be parked on from earlier browsing. Only
  // resets when no session is actually in progress, so it can't silently drop live sets.
  useEffect(() => {
    if (selectedDate && !selectedType) setMode('select');
  }, [selectedDate, selectedType]);

  useEffect(() => {
    if (mode !== 'recap') return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [mode]);

  useEffect(() => {
    if (!onProgressChange) return;
    if (mode !== 'recap' || sets.length === 0) {
      onProgressChange(null);
      return;
    }
    onProgressChange(sets.filter(s => s.completed).length / sets.length);
  }, [mode, sets, onProgressChange]);

  const activeProgramId = data.activeProgramId ?? null;
  const activeTypes = data.workoutTypes.filter(t =>
    !t.hidden && (!activeProgramId || !t.programId || t.programId === activeProgramId)
  );

  // Get last performance for an exercise (most recent session containing it)
  const getLastPerformance = useCallback((exerciseName: string) => {
    for (let i = data.sessions.length - 1; i >= 0; i--) {
      const s = data.sessions[i];
      const matchingSets = s.sets.filter(set => set.exerciseName === exerciseName && set.completed && (set.weight > 0 || isBodyweightOptionalExercise(exerciseName)));
      if (matchingSets.length > 0) {
        const best = matchingSets.reduce((b, set) => set.weight > b.weight ? set : b, matchingSets[0]);
        return { weight: best.weight, reps: best.reps, date: s.date };
      }
    }
    return null;
  }, [data.sessions]);

  // Most recent RPE logged for this exercise (by exerciseId, stable across mid-session
  // renames — unlike getLastPerformance above, which has to match by name), scanning
  // newest-first. Used both to prefill the picker and to power the "augmente la charge"
  // nudge below.
  const getLastExerciseDifficulty = useCallback((exerciseId: string): number | null => {
    for (let i = data.sessions.length - 1; i >= 0; i--) {
      const val = data.sessions[i].exerciseDifficulty?.[exerciseId];
      if (val !== undefined) return val;
    }
    return null;
  }, [data.sessions]);

  // Absolute record (heaviest weight ever lifted) for an exercise, by exact name match
  const getAbsoluteRecord = useCallback((exerciseName: string) => {
    let best: { weight: number; reps: number } | null = null;
    data.sessions.forEach(s => {
      s.sets.forEach(set => {
        if (set.exerciseName !== exerciseName || !set.completed) return;
        if (set.weight <= 0 && !isBodyweightOptionalExercise(exerciseName)) return;
        if (!best || set.weight > best.weight || (set.weight === best.weight && set.reps > best.reps)) {
          best = { weight: set.weight, reps: set.reps };
        }
      });
    });
    return best;
  }, [data.sessions]);

  // Get last session weights for pre-fill
  const getLastSessionWeights = useCallback((typeId: string, exercises: Exercise[]) => {
    const lastSession = data.sessions
      .filter(s => s.workoutTypeId === typeId)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!lastSession) return {};

    // A logged set's exerciseId can outlive a session-only rename (e.g. she swapped
    // "Développé incliné" for "Développé couché" just for that one session, without
    // touching the exercise's configured default) — matching by id alone would then pull
    // that other exercise's weight into today's "Développé incliné" pre-fill. Only trust
    // a logged weight when the exercise's CURRENT name still matches what was logged.
    const currentNameById = new Map(exercises.map(e => [e.id, e.name]));

    const weights: Record<string, number> = {};
    // Keep overwriting as we walk the sets in order, so each exercise ends up with its
    // LAST completed set's weight, not its first — if she started light and worked up to
    // 12kg×10, the next session should pre-fill 12kg, not the 10kg she warmed up with.
    // Drop-set stages are excluded: they're a deliberately lighter cascade below the real
    // working weight, never a sensible baseline for the next session.
    lastSession.sets.forEach(s => {
      if (
        s.completed && !s.dropSetStage && (s.weight > 0 || isBodyweightOptionalExercise(s.exerciseName)) &&
        currentNameById.get(s.exerciseId) === s.exerciseName
      ) {
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
    setMethodOverrides({});
    setRenamingExerciseId(null);
    setDropSetPickerFor(null);
    setExerciseDifficulty({});
    setDifficultyEditor(null);

    const initialWeeks: Record<string, number> = {};
    type.exercises.forEach(ex => {
      if (ex.method?.type === '531') initialWeeks[ex.id] = ex.method.currentWeek;
    });
    setSelectedWeeks(initialWeeks);

    const lastWeights = getLastSessionWeights(type.id, type.exercises);
    const initialSets: SetLog[] = [];

    // 5/3/1 exercises are never adjusted here: their deload is applied by forcing
    // currentWeek straight to 4 at accept time (buildDeloadAcceptPatch), so they just read
    // like any other week by the time a session actually starts. Cluster/EMOM only ever
    // get a charge (Training Max) cut, never a volume one (no clean equivalent — see
    // getDeloadSetCount's doc comment); regular exercises get whichever of the two the
    // chosen deload type calls for.
    const deloadActive = data.deload?.active;
    const isDeloadPending = !!deloadActive?.pendingWorkoutTypeIds.includes(type.id);
    const deloadReduceCharge = isDeloadPending && deloadActive!.type !== 'volume';
    const deloadReduceSets = isDeloadPending && shouldReduceSets(deloadActive!.type);
    const deloadWeight = (w: number) => deloadReduceCharge ? applyDeloadToWeight(w, deloadActive!.type, deloadActive!.intensity) : w;
    const deloadSets = (n: number) => deloadReduceSets ? getDeloadSetCount(n, deloadActive!.intensity) : n;

    const exerciseMap = new Map(type.exercises.map(e => [e.id, e]));
    buildExerciseBlocks(type.exercises).forEach(block => {
      if (block.isSuperset) {
        const a = exerciseMap.get(block.exerciseIds[0])!;
        const b = exerciseMap.get(block.exerciseIds[1])!;
        const sharedSets = deloadSets(a.sets);
        const aWeight = deloadWeight(lastWeights[a.id] || a.weight || 0);
        const bWeight = deloadWeight(lastWeights[b.id] || b.weight || 0);
        for (let i = 0; i < sharedSets; i++) {
          initialSets.push({
            exerciseId: a.id,
            exerciseName: a.name,
            setNumber: i + 1,
            reps: a.amrap ? 0 : a.reps,
            weight: aWeight,
            completed: false,
            supersetGroupId: a.supersetGroupId,
            supersetRole: 'A',
            amrap: a.amrap || undefined,
          });
          initialSets.push({
            exerciseId: b.id,
            exerciseName: b.name,
            setNumber: i + 1,
            reps: b.amrap ? 0 : b.reps,
            weight: bWeight,
            completed: false,
            supersetGroupId: b.supersetGroupId,
            supersetRole: 'B',
            amrap: b.amrap || undefined,
          });
        }
      } else {
        // Session always starts from each exercise's configured default method — the
        // live picker to switch Cluster/EMOM/Normal only appears once inside the session.
        const ex = exerciseMap.get(block.exerciseIds[0])!;
        const lastWeight = lastWeights[ex.id] || 0;
        let effectiveEx = ex;
        let effectiveWeight = lastWeight;
        if (isDeloadPending && ex.method?.type !== '531') {
          if (ex.method?.type === 'cluster' || ex.method?.type === 'emom') {
            if (deloadReduceCharge) {
              effectiveEx = { ...ex, method: { ...ex.method, trainingMax: applyDeloadToTrainingMax(ex.method.trainingMax, deloadActive!.type, deloadActive!.intensity) } };
            }
          } else if (!ex.method) {
            effectiveWeight = deloadWeight(lastWeight);
            effectiveEx = { ...ex, sets: deloadSets(ex.sets) };
          }
        }
        const exSets = buildSetsForExercise(effectiveEx, effectiveEx.method, effectiveWeight);
        initialSets.push(...exSets);
        // Pre-configured drop set (Settings): auto-cascade stage 1 below the last
        // regular set so it's ready without having to tap "+ Drop set" first.
        if (!ex.method && ex.dropSet) {
          const anchor = exSets[exSets.length - 1];
          if (anchor) {
            const config = getDropSetConfig(ex.dropSet);
            const { weight, reps } = getDropSetStage(anchor.weight, anchor.reps, 1, config);
            initialSets.push({
              exerciseId: ex.id, exerciseName: ex.name, setNumber: anchor.setNumber + 1,
              reps, weight, completed: false, dropSetStage: 1,
            });
          }
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
    } else if (field === 'weight') {
      const parsed = parseFloat(value) || 0;
      // The mobile numeric keypad for <input type="number"> rarely offers a minus key, so
      // she can't just type "-20" — instead, the +/- toggle button sets the sign and this
      // preserves it while she types the magnitude (onFocus selects-all, so each edit here
      // sees a bare digit string with no sign of its own). An explicitly typed "-" (on
      // devices whose keypad does have one) always wins over the preserved sign.
      const typedNegative = value.trim().startsWith('-');
      const wasNegative = updated[index].weight < 0;
      updated[index][field] = typedNegative ? parsed : (wasNegative ? -Math.abs(parsed) : parsed);
    } else {
      updated[index][field] = parseInt(value) || 0;
    }
    setSets(updated);
  };

  // Tractions/dips: a negative weight materializes band/machine assistance. Toggling from
  // exactly 0 has nothing to negate (-0 === 0), which read as "the button does nothing" —
  // jump to -1 instead so the switch to assisted mode is always visible; she then edits
  // the magnitude via the weight field, sign preserved by updateSet above.
  const toggleWeightSign = (index: number) => {
    const updated = [...sets];
    const w = updated[index].weight;
    updated[index].weight = w === 0 ? -1 : -w;
    setSets(updated);
  };

  // Propagate first-set weight to remaining empty sets when user leaves the field
  const propagateWeightOnBlur = (index: number) => {
    const currentSet = sets[index];
    if (!currentSet || currentSet.setNumber !== 1) return;
    if (currentSet.weight <= 0 && !isBodyweightOptionalExercise(currentSet.exerciseName)) return;
    const updated = [...sets];
    for (let i = index + 1; i < updated.length; i++) {
      // Drop-set rows keep their own computed (discounted) weight — never overwritten by
      // this. Completed sets are already logged and protected too — only sync forward
      // into sets she hasn't finished yet. Everything else in between syncs to whatever
      // she just set on the first set, whether it was empty or already pre-filled with a
      // different value — editing set 1 is meant to carry through to the rest.
      if (updated[i].exerciseId === currentSet.exerciseId && !updated[i].dropSetStage && !updated[i].completed) {
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
      reps: lastSet?.amrap ? 0 : (lastSet?.reps || 10),
      weight: lastSet?.weight || 0,
      completed: false,
      amrap: lastSet?.amrap || undefined,
    };
    
    const updated = [...sets];
    updated.splice(insertIndex, 0, newSet);
    setSets(updated);
  };

  // Cascades one more drop-set stage below a SPECIFIC series (anchorIdx) — any series,
  // not just the last one. Always computed from that anchor's own weight/reps, never
  // from a previous drop stage, matching getDropSetStage's "always relative to P0/R0"
  // rule. Stays scoped to that anchor's own cascade even if other series (plain or
  // another anchor's drops) sit further down the exercise: it only walks forward while
  // rows are drop-set rows, stopping at the first plain series, which is always the
  // boundary of this cascade since new rows are only ever inserted right after it.
  const addDropSet = (exerciseId: string, exerciseName: string, anchorIdx: number) => {
    const anchor = sets[anchorIdx];
    if (!anchor) return;
    let insertIdx = anchorIdx + 1;
    let stage = 0;
    while (insertIdx < sets.length && sets[insertIdx].exerciseId === exerciseId && sets[insertIdx].dropSetStage) {
      stage = Math.max(stage, sets[insertIdx].dropSetStage!);
      insertIdx++;
    }
    stage += 1;
    const ex = selectedType?.exercises.find(e => e.id === exerciseId);
    const config = getDropSetConfig(ex?.dropSet);
    const { weight, reps } = getDropSetStage(anchor.weight, anchor.reps, stage, config);
    const newSet: SetLog = {
      exerciseId, exerciseName, setNumber: anchor.setNumber + stage,
      reps, weight, completed: false, dropSetStage: stage,
    };
    const updated = [...sets];
    updated.splice(insertIdx, 0, newSet);
    setSets(updated);
  };

  // Add new exercise to session
  const addExerciseToSession = () => {
    const newId = `temp-${Date.now()}`;
    setSets(prev => [...prev, {
      exerciseId: newId,
      exerciseName: 'Nouvel exercice',
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

  // Renames an exercise for this session only — used both for temp exercises (freely
  // named) and for regular ones (e.g. picking which variant of "Hack squat ou leg press"
  // she actually did today). The WorkoutType template is never touched; only this live
  // `sets` array, which is what every card/history lookup below reads its name from.
  const updateExerciseName = (exerciseId: string, name: string) => {
    setSets(prev => prev.map(s => s.exerciseId === exerciseId ? { ...s, exerciseName: name } : s));
  };

  // Unlike updateExerciseName above, this persists to the WorkoutType template itself
  // (not just the live session) — the whole point is that the note survives past this
  // session and resurfaces at the start of the next one for the same exercise.
  const setExerciseReminderNote = (exerciseId: string, note: string | undefined) => {
    const workoutTypes = data.workoutTypes.map(t => ({
      ...t,
      exercises: t.exercises.map(ex => ex.id === exerciseId ? { ...ex, reminderNote: note } : ex),
    }));
    onUpdateData({ workoutTypes });
    // selectedType is a snapshot taken at startWorkout(), not a live view of
    // data.workoutTypes — without this, the banner/icon wouldn't update until the
    // session restarts even though the note already persisted correctly above.
    setSelectedType(prev => prev ? {
      ...prev,
      exercises: prev.exercises.map(ex => ex.id === exerciseId ? { ...ex, reminderNote: note } : ex),
    } : prev);
  };

  // Plain helper functions (not components) so they don't get a fresh type identity
  // every render — called inline as {renderReminderNoteButton(ex)}, not <Foo ex={ex} />.
  const renderReminderNoteButton = (ex: Exercise) => (
    <button
      type="button"
      onClick={() => setReminderNoteEditor({ exerciseId: ex.id, name: ex.name, draft: ex.reminderNote || '' })}
      className={`touch-target p-1.5 shrink-0 rounded-lg transition-colors ${
        ex.reminderNote ? 'text-warning' : 'text-muted-foreground/50 active:text-warning'
      }`}
      aria-label={ex.reminderNote ? `Modifier la note pour ${ex.name}` : `Ajouter une note pour ${ex.name}`}
      title="Note pour la prochaine séance"
    >
      <Lightbulb size={14} fill={ex.reminderNote ? 'currentColor' : 'none'} />
    </button>
  );

  const renderReminderNoteBanner = (ex: Exercise) => !ex.reminderNote ? null : (
    <div className="flex items-start gap-2 bg-warning/10 border border-warning/30 rounded-lg px-3 py-2 mb-3">
      <Lightbulb size={14} className="text-warning shrink-0 mt-0.5" fill="currentColor" />
      <p className="text-xs text-foreground/90 flex-1">{ex.reminderNote}</p>
      <button
        onClick={() => setExerciseReminderNote(ex.id, undefined)}
        className="touch-target p-1 -mt-1 -mr-1 text-muted-foreground active:text-foreground shrink-0"
        aria-label={`Effacer la note de ${ex.name}`}
      >
        <X size={14} />
      </button>
    </div>
  );

  // Always labeled "RPE" (not just an icon whose meaning only showed up in a title
  // tooltip, useless on touch) — and once rated, shows the value next to it, a color
  // change alone gave no way to see what she'd actually entered without reopening the
  // editor, unlike the reminder note button which has its own banner showing the full text.
  const renderDifficultyButton = (ex: Exercise) => {
    const current = exerciseDifficulty[ex.id];
    return (
      <button
        type="button"
        onClick={() => setDifficultyEditor({ exerciseId: ex.id, name: ex.name, draft: current ?? 5 })}
        className={`touch-target flex items-center gap-1 px-1.5 shrink-0 rounded-lg text-[11px] font-medium transition-colors ${
          current !== undefined ? 'text-accent-blue' : 'text-muted-foreground/50 active:text-accent-blue'
        }`}
        aria-label={current !== undefined ? `RPE ${current}/10 pour ${ex.name}` : `Noter le RPE pour ${ex.name}`}
        title="RPE de l'exercice"
      >
        <Gauge size={14} />
        <span>{current !== undefined ? `RPE ${current}/10` : 'RPE'}</span>
      </button>
    );
  };

  // Auto-derived (not manually dismissed like the reminder banner) — hides itself once
  // she's rated this exercise for the current session, since at that point it's no longer
  // "last time" advice but this session's own number.
  const renderLowRpeBanner = (ex: Exercise) => {
    if (exerciseDifficulty[ex.id] !== undefined) return null;
    const last = getLastExerciseDifficulty(ex.id);
    if (last === null || last >= 6) return null;
    return (
      <div className="flex items-start gap-2 bg-warning/10 border border-warning/30 rounded-lg px-3 py-2 mb-3">
        <Gauge size={14} className="text-warning shrink-0 mt-0.5" />
        <p className="text-xs text-foreground/90 flex-1">RPE faible la dernière fois ({last}/10) — pense à augmenter la charge.</p>
      </div>
    );
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
      programId: selectedType.programId,
      programName: data.programs?.find(p => p.id === selectedType.programId)?.name,
      sets: finalSets,
      startTime,
      endTime,
      duration: Math.round((endTime - startTime) / 60000) || 60,
      exerciseDifficulty: Object.keys(exerciseDifficulty).length > 0 ? exerciseDifficulty : undefined,
    };

    setPendingSession(session);
    setMode('summary');
  };

  const handleSummaryComplete = (session: SessionLog) => {
    // Stamped here (not in finishWorkout) so it reflects whether this workout type was
    // still pending in the active deload at the moment it's actually saved — powers the
    // orange "Deload" day highlight in Calendrier (see consumeDeloadOnSessionSave below
    // for how the pending list itself is shrunk).
    const wasDeloadPending = !!data.deload?.active?.pendingWorkoutTypeIds.includes(session.workoutTypeId);
    const finalSession = wasDeloadPending ? { ...session, isDeload: true } : session;
    onSaveSession(finalSession);

    const updatePatch: { workoutTypes?: WorkoutType[]; deload?: AppData['deload'] } = {};

    if (selectedType) {
      const progressed = selectedType.exercises.filter(
        ex => ex.method?.type === '531' && session.sets.some(s => s.exerciseId === ex.id)
      );
      if (progressed.length > 0) {
        // All 5/3/1 exercises across the whole app are kept in lockstep on the same
        // week/cycle (never independently drifting) — advancing from whichever exercise
        // was actually progressed today is applied to every 5/3/1 exercise, not just the
        // ones in this session. Training Max stays per-exercise (each lift has its own),
        // only bumped for a given exercise when the shared cycle actually advances.
        const shared = computeNextFiveThreeOneWeekState(progressed[0].method as FiveThreeOneMethod);
        updatePatch.workoutTypes = data.workoutTypes.map(t => ({
          ...t,
          exercises: t.exercises.map(ex => {
            if (ex.method?.type !== '531') return ex;
            const m = ex.method;
            return {
              ...ex,
              method: {
                ...m,
                currentWeek: shared.currentWeek,
                currentCycle: shared.currentCycle,
                deloadResumeWeek: shared.deloadResumeWeek,
                skipNextDeload: shared.skipNextDeload,
                trainingMax: shared.cycleAdvanced ? m.trainingMax + (m.increment ?? 2.5) : m.trainingMax,
              },
            };
          }),
        }));
      }
    }

    if (wasDeloadPending) {
      const { deload } = consumeDeloadOnSessionSave(data, session.workoutTypeId);
      updatePatch.deload = deload;
    }

    if (updatePatch.workoutTypes || updatePatch.deload) {
      onUpdateData(updatePatch);
    }

    setMode('select');
    setSelectedType(null);
    setSets([]);
    setPendingSession(null);
    setMethodOverrides({});
    setRenamingExerciseId(null);
    setDropSetPickerFor(null);
    setExerciseDifficulty({});
    onClearSelectedDate?.();
  };

  // RestTimer is rendered alongside EVERY mode below that can be reached mid-session
  // (not just 'recap') — Réglages/Historique/Récap are each their own early `return`,
  // and a component that isn't in the returned tree unmounts; RestTimer's cleanup
  // effect would then silently cancel any scheduled beep and lose the running
  // countdown. Real bug she hit: open the exercise History mid-rest (now one tap away
  // via the History icon) and the beep never fires, with no error to explain why.
  // Keeping RestTimer at the same position (right after the screen's own root) in
  // every branch lets React's reconciliation preserve the same instance across mode
  // switches instead of remounting it.
  if (mode === 'summary' && pendingSession) {
    return (
      <>
        <SessionSummary
          session={pendingSession}
          previousSessions={data.sessions}
          workoutTypes={data.workoutTypes}
          gender={data.gender}
          bodyWeightLogs={data.bodyWeightLogs}
          onSave={handleSummaryComplete}
          onBack={() => setMode(selectedType ? 'recap' : 'select')}
        />
        {selectedType && <RestTimer ref={restTimerRef} defaultSeconds={restDuration} />}
      </>
    );
  }

  if (mode === 'history' && historyExercise) {
    return (
      <>
        <ExerciseHistory
          exerciseName={historyExercise}
          data={data}
          onClose={() => { setHistoryExercise(null); setMode(selectedType ? 'recap' : 'select'); }}
        />
        {selectedType && <RestTimer ref={restTimerRef} defaultSeconds={restDuration} />}
      </>
    );
  }

  // Settings only ever opens from this screen (see the two setMode('settings') calls
  // below), so it's rendered as a `fixed` overlay ON TOP of this same screen rather than
  // replacing it — keeping the Séance picker mounted underneath is what lets the swipe-
  // to-close gesture in SettingsPanel reveal it sliding back into view instead of a plain
  // background. selectedType is always null here (starting a session switches to 'recap'),
  // so the RestTimer condition below is dead in practice but kept for symmetry with the
  // other mode branches that share it.
  if (mode === 'select' || mode === 'settings') {
    const fiveThreeOneExercises = activeTypes.flatMap(type =>
      type.exercises
        .filter(ex => ex.method?.type === '531')
        .map(ex => ({ type, exercise: ex, method: ex.method as FiveThreeOneMethod }))
    );
    const deloadRec = shouldShowDeloadRecommendation(data);
    const pendingDeloadIds = data.deload?.active?.pendingWorkoutTypeIds;
    return (
      <>
      <div className="px-4 pt-12 pb-24 animate-slide-up">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-baseline gap-2">
            <h1 className="text-2xl font-bold text-foreground">Séance</h1>
            {APP_VERSION && (
              <span className="text-[10px] text-muted-foreground">v{APP_VERSION}</span>
            )}
          </div>
          <button
            onClick={() => setMode('settings')}
            className="touch-target p-2 text-muted-foreground"
            aria-label="Réglages"
          >
            <Settings size={20} />
          </button>
        </div>

        {/* Logging retroactively from a specific Calendar day — without this banner, this
            screen looks identical to the normal "start a session" picker, so there's no
            way to tell she's about to log for a past date instead of today. */}
        {selectedDate && (
          <div className="flex items-center justify-between gap-2 bg-primary/10 border border-primary/30 rounded-xl px-3 py-2 mb-4">
            <span className="text-xs text-primary font-medium">
              Séance pour le {new Date(selectedDate + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
            <button
              onClick={() => onClearSelectedDate?.()}
              className="text-[10px] text-muted-foreground underline shrink-0"
            >
              Aujourd'hui
            </button>
          </div>
        )}

        {/* Deload recommendation — see src/lib/deload.ts for the trigger criteria. Shown
            above the 5/3/1 block so it's the first thing she sees on this screen. */}
        {deloadRec.show && (
          <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 mb-4">
            <p className="text-sm font-semibold text-warning mb-2">
              💪 Une semaine de récupération est recommandée
            </p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5">Pourquoi ?</p>
            <ul className="space-y-1 mb-3">
              {deloadRec.criteria.reasons.map((reason, i) => (
                <li key={i} className="text-xs text-foreground/90 flex items-start gap-1.5">
                  <Check size={12} className="text-warning shrink-0 mt-0.5" /> {reason}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                onClick={() => onUpdateData({ deload: buildDeloadDismissPatch(data) })}
                className="flex-1 bg-secondary text-secondary-foreground font-medium py-2 rounded-lg text-xs touch-target"
              >
                Ignorer
              </button>
              <button
                onClick={() => { setDeloadTypeDraft('both'); setDeloadIntensityDraft('medium'); setDeloadPopupOpen(true); }}
                className="flex-1 btn-neon font-medium py-2 rounded-lg text-xs touch-target"
              >
                Accepter
              </button>
            </div>
          </div>
        )}

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
                    <span className="text-sm text-primary font-bold">{s.weight} kg</span>
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
        <p className="text-sm text-muted-foreground mb-3">Choisis une séance</p>
        {activeTypes.length === 0 ? (
          <div className="glass-card p-6 text-center">
            <p className="text-sm text-foreground font-medium mb-1">Aucune séance configurée</p>
            <p className="text-xs text-muted-foreground mb-4">
              Crée un type de séance dans les réglages pour pouvoir t'entraîner.
            </p>
            <button
              onClick={() => setMode('settings')}
              className="btn-neon font-medium py-2.5 px-5 rounded-xl text-sm inline-flex items-center gap-1.5 touch-target transition-transform active:scale-95"
            >
              <Settings size={14} /> Aller aux réglages
            </button>
          </div>
        ) : (
        <div className="space-y-2">
          {activeTypes.map(type => {
            const isDeloadPending = !!pendingDeloadIds?.includes(type.id);
            return (
            <div key={type.id} className={`glass-card p-4 ${isDeloadPending ? 'border-warning/40 bg-warning/5' : ''}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `hsl(${type.color})` }} />
                <span className="text-foreground font-semibold flex-1">{type.name}</span>
                {isDeloadPending && (
                  <span className="text-[10px] font-medium text-warning bg-warning/10 px-2 py-0.5 rounded-full">Deload</span>
                )}
                {type.exercises.some(e => e.method?.type === '531') && (
                  <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">5/3/1</span>
                )}
                {type.exercises.some(e => e.method?.type === 'cluster') && (
                  <span className="text-[10px] font-medium text-accent-purple bg-accent-purple/10 px-2 py-0.5 rounded-full">Cluster</span>
                )}
                {type.exercises.some(e => e.method?.type === 'emom') && (
                  <span className="text-[10px] font-medium text-accent-blue bg-accent-blue/10 px-2 py-0.5 rounded-full">EMOM</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                {type.exercises.map(e => e.name).join(' · ')}
              </p>
              <button
                onClick={() => startWorkout(type)}
                className="w-full btn-neon font-medium py-2.5 rounded-xl text-sm flex items-center justify-center gap-1.5 touch-target transition-transform active:scale-95"
              >
                <Check size={14} /> Démarrer la séance
              </button>
            </div>
            );
          })}
        </div>
        )}

        {/* Cardio is a simple after-the-fact log (duration/distance/RPE), not an
            interactive session — its own entry point rather than mixed into the
            sets×reps workout types above. */}
        <button
          onClick={() => setMode('cardio')}
          className="w-full glass-card p-4 mt-4 mb-6 flex items-center gap-3 border-accent-blue/30 active:scale-[0.99] transition-transform"
        >
          <Activity size={18} className="text-accent-blue shrink-0" />
          <span className="text-sm font-medium text-foreground">Activité cardio</span>
          <span className="text-xs text-muted-foreground ml-auto">Course, natation...</span>
        </button>
      </div>
      {mode === 'settings' && (
        <>
          <SettingsPanel
            data={data}
            onUpdateData={onUpdateData}
            onClose={() => setMode('select')}
          />
          {selectedType && <RestTimer ref={restTimerRef} defaultSeconds={restDuration} />}
        </>
      )}
      {deloadPopupOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 animate-fade-in"
          onClick={() => setDeloadPopupOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="deload-popup-title"
            className="glass-card p-6 max-w-sm w-full"
            onClick={e => e.stopPropagation()}
          >
            <h3 id="deload-popup-title" className="text-lg font-bold text-foreground mb-4">Semaine de récupération</h3>

            <p className="text-xs text-muted-foreground mb-2">Type de deload</p>
            <div className="space-y-2 mb-4">
              {([
                { value: 'charges', label: 'Diminuer les charges' },
                { value: 'volume', label: 'Diminuer le volume' },
                { value: 'both', label: 'Les deux (recommandé)' },
              ] as { value: DeloadType; label: string }[]).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setDeloadTypeDraft(opt.value)}
                  className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-left transition-colors touch-target ${
                    deloadTypeDraft === opt.value ? 'bg-warning/15 text-warning border border-warning/40' : 'bg-secondary text-foreground border border-transparent'
                  }`}
                  aria-pressed={deloadTypeDraft === opt.value}
                >
                  <span className={`w-4 h-4 rounded-full border-2 shrink-0 ${deloadTypeDraft === opt.value ? 'border-warning bg-warning' : 'border-muted-foreground'}`} />
                  {opt.label}
                </button>
              ))}
            </div>

            <p className="text-xs text-muted-foreground mb-2">Intensité</p>
            <div className="space-y-2 mb-6">
              {([
                { value: 'light', label: 'Léger' },
                { value: 'medium', label: 'Moyen (recommandé)' },
              ] as { value: DeloadIntensity; label: string }[]).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setDeloadIntensityDraft(opt.value)}
                  className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-left transition-colors touch-target ${
                    deloadIntensityDraft === opt.value ? 'bg-warning/15 text-warning border border-warning/40' : 'bg-secondary text-foreground border border-transparent'
                  }`}
                  aria-pressed={deloadIntensityDraft === opt.value}
                >
                  <span className={`w-4 h-4 rounded-full border-2 shrink-0 ${deloadIntensityDraft === opt.value ? 'border-warning bg-warning' : 'border-muted-foreground'}`} />
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setDeloadPopupOpen(false)}
                className="flex-1 bg-secondary text-secondary-foreground font-medium py-2.5 rounded-xl text-sm touch-target"
              >
                Annuler
              </button>
              <button
                onClick={() => {
                  onUpdateData(buildDeloadAcceptPatch(data, deloadTypeDraft, deloadIntensityDraft));
                  setDeloadPopupOpen(false);
                }}
                className="flex-1 btn-neon font-medium py-2.5 rounded-xl text-sm touch-target"
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
      </>
    );
  }

  if (mode === 'cardio' && cardioRecapOpen) {
    const activityLabel = cardioActivityType === 'Autre' ? (cardioCustomLabel.trim() || 'Autre') : cardioActivityType;
    const previousSessions = (data.cardioSessions || []).filter(s => s.activityType === cardioActivityType);
    const comparison = compareCardioSession({ durationMinutes: cardioDurationMinutes, distanceKm: cardioDistanceKm }, previousSessions);
    const verdictLabel = (metric: 'distance' | 'pace' | 'duration') => metric === 'distance' ? 'la distance' : metric === 'pace' ? "l'allure" : 'la durée';
    return (
      <div className="px-4 pt-12 pb-24 animate-slide-up">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => setCardioRecapOpen(false)}
            className="touch-target p-1 text-muted-foreground"
            aria-label="Retour au formulaire"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-bold text-foreground">Récap</h1>
        </div>

        {comparison.headline ? (
          <div className={`glass-card p-4 mb-4 border ${comparison.headline.improved ? 'border-success/40 bg-success/5' : 'border-warning/40 bg-warning/5'}`}>
            <p className={`text-sm font-semibold ${comparison.headline.improved ? 'text-success' : 'text-warning'}`}>
              {comparison.headline.improved ? '📈 Mieux que la dernière fois' : '📉 En dessous de la dernière fois'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">D'après {verdictLabel(comparison.headline.metric)}</p>
          </div>
        ) : (
          <div className="glass-card p-4 mb-4">
            <p className="text-sm text-foreground">Première séance de {activityLabel} enregistrée — rien à comparer pour l'instant.</p>
          </div>
        )}

        <div className="glass-card p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            {(() => { const Icon = CARDIO_ACTIVITY_TYPES.find(a => a.type === cardioActivityType)?.icon || Activity; return <Icon size={16} className="text-accent-blue" />; })()}
            <span className="text-sm font-semibold text-foreground">{activityLabel}</span>
          </div>
          <div className="space-y-3">
            {comparison.pace && (
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Allure</span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-foreground">{formatPace(comparison.pace.current)}</span>
                    {comparison.pace.changePercent !== null && (
                      <span className={`text-[10px] font-semibold ${comparison.pace.changePercent >= 0 ? 'text-success' : 'text-warning'}`}>
                        {comparison.pace.changePercent >= 0 ? '▲' : '▼'} {Math.abs(Math.round(comparison.pace.changePercent))}%
                      </span>
                    )}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {comparison.pace.last !== null && `Dernière : ${formatPace(comparison.pace.last)}`}
                  {comparison.pace.last !== null && comparison.pace.average !== null && ' · '}
                  {comparison.pace.average !== null && `Moyenne : ${formatPace(comparison.pace.average)}`}
                </p>
              </div>
            )}
            {comparison.distance && (
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Distance</span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-foreground">{comparison.distance.current} km</span>
                    {comparison.distance.changePercent !== null && (
                      <span className={`text-[10px] font-semibold ${comparison.distance.changePercent >= 0 ? 'text-success' : 'text-warning'}`}>
                        {comparison.distance.changePercent >= 0 ? '▲' : '▼'} {Math.abs(Math.round(comparison.distance.changePercent))}%
                      </span>
                    )}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {comparison.distance.last !== null && `Dernière : ${comparison.distance.last} km`}
                  {comparison.distance.last !== null && comparison.distance.average !== null && ' · '}
                  {comparison.distance.average !== null && `Moyenne : ${Math.round(comparison.distance.average * 100) / 100} km`}
                </p>
              </div>
            )}
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Durée</span>
                <span className="text-sm font-bold text-foreground">{formatCardioDuration(comparison.duration.current)}</span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {comparison.duration.last !== null && `Dernière : ${formatCardioDuration(comparison.duration.last)}`}
                {comparison.duration.last !== null && comparison.duration.average !== null && ' · '}
                {comparison.duration.average !== null && `Moyenne : ${formatCardioDuration(comparison.duration.average)}`}
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setCardioRecapOpen(false)}
            className="flex-1 bg-secondary text-secondary-foreground font-medium py-2.5 rounded-xl text-sm touch-target"
          >
            Modifier
          </button>
          <button
            onClick={saveCardioSession}
            className="flex-1 btn-neon font-medium py-2.5 rounded-xl text-sm flex items-center justify-center gap-1.5 touch-target transition-transform active:scale-95"
          >
            <Check size={14} /> Valider
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'cardio') {
    const canSave = cardioDurationMinutes > 0;
    return (
      <div className="px-4 pt-12 pb-24 animate-slide-up">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => { resetCardioForm(); setMode('select'); }}
            className="touch-target p-1 text-muted-foreground"
            aria-label="Retour"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-bold text-foreground">Activité cardio</h1>
        </div>

        <div className="glass-card p-4 mb-4">
          <label className="text-xs text-muted-foreground mb-2 block">Type d'activité</label>
          <div className="grid grid-cols-4 gap-2">
            {CARDIO_ACTIVITY_TYPES.map(({ type, icon: Icon }) => (
              <button
                key={type}
                onClick={() => { setCardioActivityType(type); setCardioDistance(''); }}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-xl text-[10px] font-medium transition-colors ${
                  cardioActivityType === type ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/40' : 'bg-secondary text-muted-foreground border border-transparent'
                }`}
                aria-pressed={cardioActivityType === type}
              >
                <Icon size={16} />
                {type}
              </button>
            ))}
          </div>
          {cardioActivityType === 'Autre' && (
            <input
              value={cardioCustomLabel}
              onChange={e => setCardioCustomLabel(e.target.value)}
              placeholder="Quel type d'activité ?"
              className="w-full bg-secondary text-foreground rounded-lg px-3 py-2 text-sm outline-none mt-3"
            />
          )}
        </div>

        <div className="glass-card p-4 mb-4">
          <label className="text-xs text-muted-foreground mb-1.5 block">Durée</label>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              inputMode="numeric"
              value={cardioDurationMin}
              onChange={e => setCardioDurationMin(e.target.value)}
              placeholder="30"
              className="w-full bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none font-mono text-center text-lg"
              aria-label="Minutes"
            />
            <span className="text-muted-foreground text-xs shrink-0">min</span>
            <input
              type="number"
              inputMode="numeric"
              value={cardioDurationSec}
              onChange={e => setCardioDurationSec(e.target.value)}
              placeholder="00"
              className="w-full bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none font-mono text-center text-lg"
              aria-label="Secondes"
            />
            <span className="text-muted-foreground text-xs shrink-0">sec</span>
          </div>
        </div>

        <div className="glass-card p-4 mb-4">
          <label className="text-xs text-muted-foreground mb-1.5 block">
            Distance ({cardioActivityType === 'Natation' ? 'm' : 'km'}) — facultatif
          </label>
          <input
            type="number"
            inputMode="decimal"
            value={cardioDistance}
            onChange={e => setCardioDistance(e.target.value)}
            placeholder={cardioActivityType === 'Natation' ? '400' : '5'}
            className="w-full bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none font-mono text-center text-lg"
          />
        </div>

        <div className="glass-card p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs text-muted-foreground">Comment tu t'es sentie ?</label>
            <span className="text-sm font-bold text-foreground">{cardioDifficulty}/10</span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            value={cardioDifficulty}
            onChange={e => setCardioDifficulty(parseInt(e.target.value))}
            className="w-full accent-accent-blue h-2"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>Facile</span>
            <span>Difficile</span>
          </div>
        </div>

        <button
          onClick={() => setCardioRecapOpen(true)}
          disabled={!canSave}
          className="w-full btn-neon font-medium py-2.5 rounded-xl text-sm flex items-center justify-center gap-1.5 touch-target transition-transform active:scale-95 disabled:opacity-40"
        >
          <ChevronRight size={14} /> Voir le récap
        </button>
      </div>
    );
  }

  // Live or Recap Mode
  const fiveThreeOneExerciseIds = new Set(
    (selectedType?.exercises || []).filter(ex => ex.method?.type === '531').map(ex => ex.id)
  );
  const clusterExerciseIds = new Set(
    (selectedType?.exercises || []).filter(ex => getEffectiveMethod(ex)?.type === 'cluster').map(ex => ex.id)
  );
  const emomExerciseIds = new Set(
    (selectedType?.exercises || []).filter(ex => getEffectiveMethod(ex)?.type === 'emom').map(ex => ex.id)
  );
  const regularSets = sets
    .map((s, i) => ({ ...s, globalIdx: i }))
    .filter(s => !fiveThreeOneExerciseIds.has(s.exerciseId) && !clusterExerciseIds.has(s.exerciseId) && !emomExerciseIds.has(s.exerciseId));
  // Exercises with a configured Cluster/EMOM default that are currently overridden to
  // "Normal" for this session — still get the picker on their (now regular) card so
  // switching back doesn't require restarting the session.
  const methodConfigMap = new Map(
    (selectedType?.exercises || []).filter(ex => ex.method?.type === 'cluster' || ex.method?.type === 'emom').map(ex => [ex.id, ex])
  );

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

  const doAbandon = () => {
    setMode('select');
    setSelectedType(null);
    setSets([]);
    setMethodOverrides({});
    setRenamingExerciseId(null);
    setDropSetPickerFor(null);
    setExerciseDifficulty({});
  };

  const abandonSession = () => {
    if (sets.some(s => s.completed)) {
      setShowAbandonConfirm(true);
      return;
    }
    doAbandon();
  };

  return (
    <>
    <div className="px-4 pt-12 pb-24 animate-slide-up">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={abandonSession} className="text-muted-foreground touch-target p-1" aria-label="Abandonner la séance">
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
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Aperçu de la séance prévue</span>
            <ChevronDown
              size={16}
              className={`text-muted-foreground transition-transform ${previewOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {previewOpen && (
            <div className="px-3 pb-3 space-y-1">
              {(() => {
                const previewMap = new Map(selectedType.exercises.map(e => [e.id, e]));
                // Cluster/EMOM don't use the plain sets×reps fields (those stay at their
                // generic default even once a method is applied) — each method has its own
                // real structure to summarize instead: EMOM as "duration' × reps/minute",
                // Cluster as "series × total reps" (the mini-series reps summed, e.g. a
                // 2-2-2 scheme reads as "3 × 6").
                const volumeLabel = (ex: Exercise): string => {
                  if (ex.method?.type === '531') {
                    return 'Méthode 5-3-1';
                  }
                  if (ex.method?.type === 'emom') {
                    const { durationMinutes, repsPerMinute } = getEmomConfig(ex.method);
                    return `EMOM ${durationMinutes}' × ${repsPerMinute}`;
                  }
                  if (ex.method?.type === 'cluster') {
                    const { numSeries, miniSeries } = getClusterConfig(ex.method);
                    const totalReps = miniSeries.reduce((acc, m) => acc + m.reps, 0);
                    return `${numSeries} × ${totalReps}`;
                  }
                  return `${ex.sets} × ${ex.reps}`;
                };
                // Dot color: method hue when the exercise carries one (matches the
                // primary/purple/blue convention used everywhere else for 5/3/1/Cluster/
                // EMOM), magenta for supersets, cyan as the neutral default otherwise —
                // replaces the previous flat gray list.
                const rows = buildExerciseBlocks(selectedType.exercises).map(block => {
                  if (block.isSuperset) {
                    const a = previewMap.get(block.exerciseIds[0])!;
                    const b = previewMap.get(block.exerciseIds[1])!;
                    return { label: `${a.name} + ${b.name}`, volume: `${a.sets} × ${a.reps} / ${b.reps}`, dot: 'hsl(var(--primary))' };
                  }
                  const ex = previewMap.get(block.exerciseIds[0])!;
                  // 531/Cluster get their own hue; EMOM and plain exercises share the
                  // neutral cyan default since EMOM's blue already matches that hue.
                  const dot = ex.method?.type === '531' ? 'hsl(var(--primary))'
                    : ex.method?.type === 'cluster' ? 'hsl(var(--accent-purple))'
                    : 'hsl(var(--accent-blue))';
                  return { label: ex.name, volume: volumeLabel(ex), dot };
                });
                return rows.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs py-1">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: r.dot, boxShadow: `0 0 4px ${r.dot}` }}
                    />
                    <span className="text-foreground/80 truncate flex-1 pr-2">{r.label}</span>
                    <span className="font-mono shrink-0" style={{ color: r.dot }}>{r.volume}</span>
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
              <button
                onClick={() => { setHistoryExercise(ex.name); setMode('history'); }}
                className="min-h-11 flex items-center gap-1.5 group"
              >
                <h3 className="text-sm font-bold text-primary">{ex.name}</h3>
                <History size={12} className="text-primary/70 group-active:text-primary" />
              </button>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs text-muted-foreground">Cycle {method.currentCycle}</span>
                {renderReminderNoteButton(ex)}
                {renderDifficultyButton(ex)}
              </div>
            </div>
            {renderReminderNoteBanner(ex)}
            {renderLowRpeBanner(ex)}
            <SetDots states={liveSets.map(s => sets[s.globalIdx].completed)} className="mb-3" />
            <div className="flex gap-1.5 mb-4">
              {[1, 2, 3, 4].map(w => (
                <button
                  key={w}
                  onClick={() => updateWeekSelection(ex.id, w)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    week === w ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                  }`}
                >
                  {w === 4 ? 'Deload' : `S${w}`}
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
                      sets[globalIdx].completed ? 'bg-success/10 border border-success/25' : 'bg-secondary/50'
                    }`}
                  >
                    <span className="text-xs text-muted-foreground w-6">S{localIdx + 1}</span>
                    <input
                      type="number"
                      value={sets[globalIdx].weight || ''}
                      onChange={e => updateSet(globalIdx, 'weight', e.target.value)}
                      className="w-14 bg-transparent text-foreground text-sm text-center outline-none font-mono"
                      placeholder="kg"
                      aria-label={`Poids série ${localIdx + 1}, ${ex.name} (kg)`}
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
                          aria-label={`Répétitions AMRAP série ${localIdx + 1}, ${ex.name}`}
                        />
                        <span className="text-[10px] text-primary font-bold">AMRAP</span>
                      </div>
                    ) : (
                      <span className="text-sm text-foreground font-mono w-12 text-center">
                        {weekSetsForDisplay[localIdx]?.reps}
                      </span>
                    )}
                    {realE1rm > 0 && sets[globalIdx].completed && (
                      <span className="text-[10px] text-primary ml-1">{realE1rm}kg</span>
                    )}
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {Math.round((weekSetsForDisplay[localIdx]?.percentage || 0) * 100)}%
                    </span>
                    <button
                      onClick={() => toggleSet(globalIdx)}
                      className={`touch-target rounded-lg p-2 transition-colors ${
                        sets[globalIdx].completed ? 'text-success glow-success' : 'text-muted-foreground active:text-success'
                      }`}
                      aria-label={sets[globalIdx].completed ? `Série ${localIdx + 1} validée` : `Valider la série ${localIdx + 1}`}
                      aria-pressed={sets[globalIdx].completed}
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

      {/* Cluster Block(s) in session — rest timers (manual, or auto via the per-block toggle) */}
      {selectedType && selectedType.exercises.filter(ex => getEffectiveMethod(ex)?.type === 'cluster').map(ex => {
        const method = getEffectiveMethod(ex) as ClusterMethod;
        const { numSeries, miniSeries, restMiniSeries, restSeries } = getClusterConfig(method);
        const liveSets = sets
          .map((s, i) => ({ ...s, globalIdx: i }))
          .filter(s => s.exerciseId === ex.id);
        if (liveSets.length === 0) return null;
        const miniPerSeries = miniSeries.length;

        const onTapMiniSeries = (globalIdx: number, seriesIdx: number, miniIdx: number) => {
          const wasCompleted = sets[globalIdx].completed;
          toggleSet(globalIdx);
          if (wasCompleted || !clusterAutoTimer) return;
          const isLastMiniInSeries = miniIdx === miniPerSeries - 1;
          const isLastSeries = seriesIdx === numSeries - 1;
          if (!isLastMiniInSeries) {
            restTimerRef.current?.startWithDuration(restMiniSeries);
          } else if (!isLastSeries) {
            restTimerRef.current?.startWithDuration(restSeries);
          }
        };

        return (
          <div key={ex.id} className="glass-card p-4 mb-4 border-accent-purple/30">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => { setHistoryExercise(ex.name); setMode('history'); }}
                className="min-h-11 flex items-center gap-1.5 group"
              >
                <h3 className="text-sm font-bold text-accent-purple">{ex.name}</h3>
                <History size={12} className="text-accent-purple/70 group-active:text-accent-purple" />
              </button>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs text-muted-foreground">TM {method.trainingMax} kg</span>
                {renderReminderNoteButton(ex)}
                {renderDifficultyButton(ex)}
              </div>
            </div>
            {renderReminderNoteBanner(ex)}
            {renderLowRpeBanner(ex)}
            <MethodPickerRow active="cluster" onSelect={opt => applyMethodOverride(ex, opt)} />
            <label className="flex items-center justify-between mb-3 -mt-1 cursor-pointer">
              <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Timer size={12} className="text-primary" /> Chrono automatique
              </span>
              <input
                type="checkbox"
                checked={clusterAutoTimer}
                onChange={e => setClusterAutoTimer(e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
            </label>
            <div className="space-y-2">
              {Array.from({ length: numSeries }).map((_, seriesIdx) => {
                const seriesSets = liveSets.slice(seriesIdx * miniPerSeries, (seriesIdx + 1) * miniPerSeries);
                const allDone = seriesSets.every(s => sets[s.globalIdx].completed);
                return (
                  <div
                    key={seriesIdx}
                    className={`rounded-xl p-2.5 border transition-all ${
                      allDone ? 'bg-success/15 border-success/40' : 'bg-secondary/40 border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-semibold text-muted-foreground">Série {seriesIdx + 1}</span>
                      {seriesIdx < numSeries - 1 && (
                        <button
                          onClick={() => restTimerRef.current?.startWithDuration(restSeries)}
                          className="touch-target text-[10px] text-primary font-medium flex items-center gap-1"
                        >
                          <Timer size={10} /> Repos {formatRestLabel(restSeries)}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {seriesSets.map((s, miniIdx) => (
                        <div key={s.globalIdx} className="flex items-center gap-1.5 flex-1">
                          <button
                            onClick={() => onTapMiniSeries(s.globalIdx, seriesIdx, miniIdx)}
                            className={`flex-1 min-h-11 flex items-center justify-center rounded-lg text-xs font-mono font-medium transition-colors ${
                              sets[s.globalIdx].completed ? 'bg-success text-success-foreground' : 'bg-background/60 text-foreground'
                            }`}
                            aria-pressed={sets[s.globalIdx].completed}
                          >
                            {sets[s.globalIdx].weight}kg × {sets[s.globalIdx].reps}
                          </button>
                          {miniIdx < seriesSets.length - 1 && (
                            <button
                              onClick={() => restTimerRef.current?.startWithDuration(restMiniSeries)}
                              className="touch-target inline-flex items-center justify-center text-muted-foreground active:text-primary shrink-0"
                              title={`Repos ${formatRestLabel(restMiniSeries)}`}
                              aria-label={`Repos ${formatRestLabel(restMiniSeries)}`}
                            >
                              <Timer size={12} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* EMOM Block(s) in session — continuous auto-beeping countdown, one card per exercise using the method */}
      {selectedType && selectedType.exercises.filter(ex => getEffectiveMethod(ex)?.type === 'emom').map(ex => {
        const method = getEffectiveMethod(ex) as EMOMMethod;
        const { durationMinutes } = getEmomConfig(method);
        const liveSets = sets
          .map((s, i) => ({ ...s, globalIdx: i }))
          .filter(s => s.exerciseId === ex.id);
        if (liveSets.length === 0) return null;

        const handleMinuteComplete = (minuteNumber: number) => {
          const target = liveSets[minuteNumber - 1];
          if (target && !sets[target.globalIdx].completed) toggleSet(target.globalIdx);
        };

        return (
          <div key={ex.id} className="glass-card p-4 mb-4 border-accent-blue/30">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => { setHistoryExercise(ex.name); setMode('history'); }}
                className="min-h-11 flex items-center gap-1.5 group"
              >
                <h3 className="text-sm font-bold text-accent-blue">{ex.name}</h3>
                <History size={12} className="text-accent-blue/70 group-active:text-accent-blue" />
              </button>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs text-muted-foreground">TM {method.trainingMax} kg</span>
                {renderReminderNoteButton(ex)}
                {renderDifficultyButton(ex)}
              </div>
            </div>
            {renderReminderNoteBanner(ex)}
            {renderLowRpeBanner(ex)}
            <MethodPickerRow active="emom" onSelect={opt => applyMethodOverride(ex, opt)} />
            <div className="mb-3">
              <EmomTimer totalMinutes={durationMinutes} onMinuteComplete={handleMinuteComplete} />
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {liveSets.map((s, minuteIdx) => (
                <button
                  key={s.globalIdx}
                  onClick={() => toggleSet(s.globalIdx)}
                  className={`min-h-11 rounded-lg py-2 text-[11px] font-mono font-medium transition-colors ${
                    sets[s.globalIdx].completed ? 'bg-success text-success-foreground' : 'bg-secondary/50 text-foreground'
                  }`}
                >
                  Min {minuteIdx + 1}
                  <br />
                  <span className={sets[s.globalIdx].completed ? '' : 'text-primary font-bold'}>{sets[s.globalIdx].weight}kg</span>×{sets[s.globalIdx].reps}
                </button>
              ))}
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
            const pinnedIdxs = sets.map((_, i) => i).filter(i =>
              fiveThreeOneExerciseIds.has(sets[i].exerciseId) || clusterExerciseIds.has(sets[i].exerciseId) || emomExerciseIds.has(sets[i].exerciseId)
            );
            const idxsByKey = new Map<string, number[]>();
            blocks.forEach(b => {
              const key = b.kind === 'superset' ? b.groupId : b.exerciseId;
              const idxs = b.kind === 'superset'
                ? b.series.flatMap(s => [s.aIdx, s.bIdx])
                : b.entries.map(e => e.globalIdx);
              idxsByKey.set(key, idxs);
            });
            const newRegular = newOrder.flatMap(item => (idxsByKey.get(item.key) || []).map(i => sets[i]));
            const pinnedSets = pinnedIdxs.map(i => sets[i]);
            setSets([...pinnedSets, ...newRegular]);
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
            // One reminder note per superset (not one per exercise inside it) — attached
            // to the A exercise, same "A is canonical for the pair" convention as sets
            // count above. Absent for a temp/ad-hoc exercise with no template to attach to.
            const templateAEx = selectedType?.exercises.find(e => e.id === block.aId);
            return (
              <div key={block.groupId} className="glass-card p-4 border border-primary/40 bg-primary/5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1">
                    <DragHandle />
                    <span className="text-[10px] font-bold text-primary tracking-wider">SUPERSET</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">{block.series.length} séries</span>
                    {templateAEx && renderReminderNoteButton(templateAEx)}
                    {templateAEx && renderDifficultyButton(templateAEx)}
                  </div>
                </div>
                {templateAEx && renderReminderNoteBanner(templateAEx)}
                {templateAEx && renderLowRpeBanner(templateAEx)}

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
                          bothDone ? 'bg-success/15 border-success/40' : 'bg-secondary/40 border-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] font-semibold text-muted-foreground">Série {localIdx + 1}</span>
                          <button
                            onClick={() => toggleSeries(serie.aIdx, serie.bIdx)}
                            className={`touch-target rounded-lg p-1.5 transition-colors ${
                              bothDone ? 'text-success glow-success' : 'text-muted-foreground active:text-success'
                            }`}
                            aria-label={bothDone ? `Série ${localIdx + 1} validée` : `Valider la série ${localIdx + 1}`}
                            aria-pressed={bothDone}
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
                            <button
                              onClick={() => { setHistoryExercise(row.name); setMode('history'); }}
                              className="min-h-11 flex items-center gap-1 flex-1 min-w-0 group"
                            >
                              <span className="text-xs text-foreground/80 truncate group-active:text-primary transition-colors">{row.name}</span>
                              <History size={11} className="text-muted-foreground/70 group-active:text-primary shrink-0" />
                            </button>
                            {isBodyweightOptionalExercise(row.name) && (
                              <button
                                type="button"
                                onClick={() => toggleWeightSign(row.idx)}
                                className="w-5 h-5 shrink-0 rounded-md bg-background/60 text-muted-foreground text-[10px] leading-none font-bold"
                                aria-label={sets[row.idx].weight < 0 ? 'Assisté (élastique/machine) — repasser en lesté' : 'Lesté — passer en assisté (élastique/machine)'}
                                title={sets[row.idx].weight < 0 ? 'Assisté' : 'Lesté'}
                              >
                                {sets[row.idx].weight < 0 ? '−' : '+'}
                              </button>
                            )}
                            <input
                              type="number"
                              value={weightFieldValue(sets[row.idx].weight, row.name)}
                              onChange={e => updateSet(row.idx, 'weight', e.target.value)}
                              onFocus={e => e.target.select()}
                              onBlur={() => propagateWeightOnBlur(row.idx)}
                              className="w-14 bg-background/60 rounded-md text-foreground text-sm text-center outline-none font-mono py-1"
                              placeholder="kg"
                              aria-label={`Poids série ${localIdx + 1}, ${row.name} (kg)`}
                            />
                            <span className="text-muted-foreground text-xs">×</span>
                            <input
                              type="number"
                              value={sets[row.idx].reps || ''}
                              onChange={e => updateSet(row.idx, 'reps', e.target.value)}
                              className={`w-12 bg-background/60 rounded-md text-sm text-center outline-none font-mono py-1 ${
                                sets[row.idx].amrap ? 'text-accent-purple placeholder:text-accent-purple/70' : 'text-foreground'
                              }`}
                              aria-label={`Répétitions série ${localIdx + 1}, ${row.name}`}
                              placeholder={sets[row.idx].amrap ? 'Max' : 'reps'}
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
          const methodEx = methodConfigMap.get(exerciseId);
          // Reminder notes persist on the WorkoutType template — a temp exercise (added
          // ad hoc for this session only, never saved to the template) has nothing to
          // attach a note to, so it just doesn't get the button.
          const templateEx = !isTemp ? selectedType?.exercises.find(e => e.id === exerciseId) : undefined;
          // "Série N" numbers only the plain rows, skipping over any interleaved drop-set
          // rows — a drop set inserted after Série 2 must not bump the plain Série 3 that
          // follows it to "Série 4". Shared between the row list and the picker chips
          // below so both always agree.
          const seriesNumberByGlobalIdx = new Map<number, number>();
          // Every drop-set row (and its own anchor) maps back to the anchor's globalIdx —
          // needed so "+ Drop set", rendered under the *last* stage of a cascade, still
          // cascades off the original reference set (P0/R0), never off a prior drop stage.
          const anchorGlobalIdxByGlobalIdx = new Map<number, number>();
          {
            let seriesCounter = 0;
            let currentAnchor = -1;
            exerciseSets.forEach(e => {
              if (!sets[e.globalIdx].dropSetStage) {
                seriesNumberByGlobalIdx.set(e.globalIdx, ++seriesCounter);
                currentAnchor = e.globalIdx;
              }
              anchorGlobalIdxByGlobalIdx.set(e.globalIdx, currentAnchor);
            });
          }

          return (
            <div key={exerciseId} className="glass-card p-4">
              <div className="flex items-center gap-1.5 mb-1">
                <DragHandle />

                {isTemp ? (
                  <input
                    value={name}
                    onChange={e => updateExerciseName(exerciseId, e.target.value)}
                    className="bg-transparent text-foreground font-semibold outline-none flex-1 text-sm"
                    placeholder="Nom de l'exercice"
                  />
                ) : renamingExerciseId === exerciseId ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={() => { updateExerciseName(exerciseId, renameValue.trim() || name); setRenamingExerciseId(null); }}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    className="bg-transparent text-foreground font-semibold outline-none flex-1 text-sm border-b border-primary/40"
                    placeholder="Nom de l'exercice"
                  />
                ) : (
                  <>
                    {/* History and Modifier kept apart (not two adjacent icons) so a
                        mid-set thumb doesn't mis-tap one for the other: History sits
                        before the name, Modifier after it. */}
                    <button
                      onClick={() => { setHistoryExercise(name); setMode('history'); }}
                      className="min-h-11 flex items-center p-1 text-muted-foreground active:text-primary shrink-0"
                      aria-label={`Historique de ${name}`}
                      title="Historique"
                    >
                      <History size={14} />
                    </button>
                    <h3 className="text-sm font-semibold text-foreground truncate min-w-0 flex-1">{name}</h3>
                    <button
                      onClick={() => { setRenamingExerciseId(exerciseId); setRenameValue(name); }}
                      className="touch-target p-1 text-muted-foreground active:text-primary shrink-0"
                      aria-label={`Changer le nom de ${name} pour cette séance`}
                      title="Renommer pour cette séance (ex. quel équipement utilisé)"
                    >
                      <Pencil size={12} />
                    </button>
                  </>
                )}
              </div>

              {/* Second row for the per-exercise action buttons (drop set, note, RPE) —
                  crammed onto the name row, their 44px touch targets left almost no room
                  for the name itself and it was truncating down to 2-3 letters. */}
              <div className="flex items-center gap-1.5 mb-1">
                {/* Reveals a "+ Drop set" trigger under each plain series below — lets her
                    cascade from any of them, not just the last one. */}
                <button
                  onClick={() => setDropSetPickerFor(dropSetPickerFor === exerciseId ? null : exerciseId)}
                  className={`min-h-9 flex items-center gap-1 px-2 shrink-0 rounded-lg text-[11px] font-medium transition-colors ${
                    dropSetPickerFor === exerciseId ? 'bg-warning/20 text-warning' : 'text-warning/70 active:text-warning'
                  }`}
                  aria-label="Activer le mode drop set pour cet exercice"
                  aria-pressed={dropSetPickerFor === exerciseId}
                  title="Drop set"
                >
                  <TrendingDown size={14} /> Drop set
                </button>
                <div className="flex items-center gap-1.5 ml-auto">
                  {templateEx && renderReminderNoteButton(templateEx)}
                  {templateEx && renderDifficultyButton(templateEx)}
                </div>
              </div>

              {templateEx && renderReminderNoteBanner(templateEx)}
              {templateEx && renderLowRpeBanner(templateEx)}

              {methodEx && <MethodPickerRow active="none" onSelect={opt => applyMethodOverride(methodEx, opt)} />}

              <SetDots states={exerciseSets.map(e => sets[e.globalIdx].completed)} className="mb-2 ml-6" />

              {(lastPerf || absRecord) && (() => {
                // Highlighting when she's already at her all-time best on this exercise —
                // same color as "Max" so it jumps out instead of blending into the muted text.
                const lastIsMax = !!(lastPerf && absRecord && lastPerf.weight === absRecord.weight && lastPerf.reps === absRecord.reps);
                return (
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-2">
                    {lastPerf && (
                      <p className="text-[10px] text-muted-foreground">
                        Dernière: <span className={`font-medium ${lastIsMax ? 'text-primary' : 'text-foreground/80'}`}>{lastPerf.weight}kg × {lastPerf.reps}</span>
                      </p>
                    )}
                    {absRecord && (
                      <p className="text-[10px] text-muted-foreground">
                        Max: <span className="text-primary font-medium">{absRecord.weight}kg × {absRecord.reps}</span>
                      </p>
                    )}
                  </div>
                );
              })()}

              <div className="space-y-2">
                {exerciseSets.map((s, idx) => {
                  const globalIdx = s.globalIdx;
                  const stage = sets[globalIdx].dropSetStage;
                  const rowLabel = stage ? `Drop ${stage}` : `Série ${seriesNumberByGlobalIdx.get(globalIdx)}`;
                  const nextEntry = exerciseSets[idx + 1];
                  const isLastOfCascade = !nextEntry || !sets[nextEntry.globalIdx].dropSetStage;
                  return (
                    <div key={globalIdx}>
                      <div
                        className={`flex items-center gap-2 rounded-xl px-3 py-2.5 transition-all ${stage ? 'ml-4' : ''} ${
                          sets[globalIdx].completed ? 'bg-success/10 border border-success/25' : 'bg-secondary/50'
                        }`}
                      >
                        <span className={`text-xs w-12 shrink-0 ${stage ? 'text-warning font-medium' : 'text-muted-foreground'}`}>
                          {rowLabel}
                        </span>
                        {isBodyweightOptionalExercise(name) && (
                          <button
                            type="button"
                            onClick={() => toggleWeightSign(globalIdx)}
                            className="w-5 h-5 shrink-0 rounded-md bg-secondary text-muted-foreground text-[10px] leading-none font-bold"
                            aria-label={sets[globalIdx].weight < 0 ? 'Assisté (élastique/machine) — repasser en lesté' : 'Lesté — passer en assisté (élastique/machine)'}
                            title={sets[globalIdx].weight < 0 ? 'Assisté' : 'Lesté'}
                          >
                            {sets[globalIdx].weight < 0 ? '−' : '+'}
                          </button>
                        )}
                        <input
                          type="number"
                          value={weightFieldValue(sets[globalIdx].weight, name)}
                          onChange={e => updateSet(globalIdx, 'weight', e.target.value)}
                          onFocus={e => e.target.select()}
                          onBlur={() => propagateWeightOnBlur(globalIdx)}
                          className="w-16 bg-transparent text-foreground text-sm text-center outline-none font-mono"
                          placeholder="kg"
                          aria-label={`Poids ${rowLabel}, ${name} (kg)`}
                        />
                        <span className="text-muted-foreground text-xs shrink-0 whitespace-nowrap">kg ×</span>
                        <input
                          type="number"
                          value={sets[globalIdx].reps || ''}
                          onChange={e => updateSet(globalIdx, 'reps', e.target.value)}
                          className={`w-12 bg-transparent text-sm text-center outline-none font-mono ${
                            sets[globalIdx].amrap ? 'text-accent-purple placeholder:text-accent-purple/70' : 'text-foreground'
                          }`}
                          placeholder={sets[globalIdx].amrap ? 'Max' : 'reps'}
                          aria-label={`Répétitions ${rowLabel}, ${name}`}
                        />
                        <button
                          onClick={() => removeSet(globalIdx)}
                          className="touch-target inline-flex items-center justify-center text-muted-foreground active:text-destructive"
                          aria-label={`Supprimer ${rowLabel}`}
                        >
                          <Trash2 size={14} />
                        </button>
                        <button
                          onClick={() => toggleSet(globalIdx)}
                          className={`touch-target rounded-lg p-2 transition-colors ${
                            sets[globalIdx].completed ? 'text-success glow-success' : 'text-muted-foreground active:text-success'
                          }`}
                          aria-label={sets[globalIdx].completed ? `${rowLabel} validée` : `Valider ${rowLabel}`}
                          aria-pressed={sets[globalIdx].completed}
                        >
                          <Check size={18} />
                        </button>
                      </div>
                      {dropSetPickerFor === exerciseId && isLastOfCascade && (
                        <button
                          onClick={() => addDropSet(exerciseId, name, anchorGlobalIdxByGlobalIdx.get(globalIdx) ?? globalIdx)}
                          className="w-full min-h-9 flex items-center justify-center gap-1 text-warning text-[10px] font-medium mt-1"
                        >
                          <TrendingDown size={10} /> + Drop set
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <button
                onClick={() => addSetToExercise(exerciseId, name)}
                className="min-h-11 flex items-center gap-1 text-primary text-xs font-medium mt-2"
              >
                <Plus size={12} /> Ajouter une série
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
        <Plus size={16} /> Ajouter un exercice
      </button>

      <button
        onClick={finishWorkout}
        className="w-full btn-neon font-semibold py-4 rounded-2xl touch-target text-lg flex items-center justify-center gap-2 transition-transform active:scale-95"
      >
        Terminer la séance <ChevronRight size={20} />
      </button>

    </div>

    {/* Floating rest timer — rendered outside the animated wrapper so position:fixed
        stays anchored to the viewport (an animated `transform` ancestor makes iOS Safari
        treat `fixed` descendants as if they were `absolute` to that ancestor instead) */}
    {mode === 'recap' && (
      <RestTimer ref={restTimerRef} defaultSeconds={restDuration} />
    )}

    {showAbandonConfirm && (
      <div
        className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 animate-fade-in"
        onClick={() => setShowAbandonConfirm(false)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="abandon-title"
          className="glass-card p-6 max-w-sm w-full"
          onClick={e => e.stopPropagation()}
        >
          <h3 id="abandon-title" className="text-lg font-bold text-foreground mb-2">
            Voulez-vous vraiment quitter cette séance ?
          </h3>
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => setShowAbandonConfirm(false)}
              className="flex-1 bg-secondary text-secondary-foreground font-medium py-2.5 rounded-xl text-sm touch-target"
            >
              Annuler
            </button>
            <button
              onClick={() => { setShowAbandonConfirm(false); doAbandon(); }}
              className="flex-1 bg-destructive text-destructive-foreground font-medium py-2.5 rounded-xl text-sm touch-target"
            >
              Oui
            </button>
          </div>
        </div>
      </div>
    )}

    {reminderNoteEditor && (
      <div
        className="fixed inset-0 bg-black/60 z-50 overflow-y-auto animate-fade-in"
        onClick={() => setReminderNoteEditor(null)}
      >
        {/* Centered (not bottom-anchored) now that BottomTabBar hides itself whenever a
            text field is focused (see Index.tsx) — the keyboard accessory bar no longer
            has anything to collide with. min-h-full + overflow-y-auto on the parent is
            kept so the card stays scrollable into view on very short viewports. */}
        <div className="min-h-full flex items-center justify-center p-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reminder-note-title"
            className="glass-card p-6 max-w-sm w-full"
            onClick={e => e.stopPropagation()}
          >
            <h3 id="reminder-note-title" className="text-sm font-bold text-foreground mb-1 flex items-center gap-1.5">
              <Lightbulb size={14} className="text-warning" /> Note — {reminderNoteEditor.name}
            </h3>
            <p className="text-[11px] text-muted-foreground mb-3">
              S'affichera au-dessus de cet exercice à ta prochaine séance de ce type.
            </p>
            <textarea
              autoFocus
              value={reminderNoteEditor.draft}
              onChange={e => setReminderNoteEditor({ ...reminderNoteEditor, draft: e.target.value })}
              placeholder="Ex. augmenter la charge de 2,5 kg la prochaine fois"
              rows={3}
              className="w-full bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none resize-none mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => setReminderNoteEditor(null)}
                className="flex-1 bg-secondary text-secondary-foreground font-medium py-2.5 rounded-xl text-sm touch-target"
              >
                Annuler
              </button>
              <button
                onClick={() => {
                  const trimmed = reminderNoteEditor.draft.trim();
                  setExerciseReminderNote(reminderNoteEditor.exerciseId, trimmed === '' ? undefined : trimmed);
                  setReminderNoteEditor(null);
                }}
                className="flex-1 btn-neon font-medium py-2.5 rounded-xl text-sm touch-target"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      </div>
    )}

    {difficultyEditor && (
      <div
        className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 animate-fade-in"
        onClick={() => setDifficultyEditor(null)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="difficulty-editor-title"
          className="glass-card p-6 max-w-sm w-full"
          onClick={e => e.stopPropagation()}
        >
          <h3 id="difficulty-editor-title" className="text-sm font-bold text-foreground mb-3 flex items-center gap-1.5">
            <Gauge size={14} className="text-accent-blue" /> RPE — {difficultyEditor.name}
          </h3>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">Comment tu t'es sentie sur cet exercice ?</span>
            <span className="text-sm font-bold text-foreground">{difficultyEditor.draft}/10</span>
          </div>
          <input
            autoFocus
            type="range"
            min={1}
            max={10}
            value={difficultyEditor.draft}
            onChange={e => setDifficultyEditor({ ...difficultyEditor, draft: parseInt(e.target.value) })}
            className="w-full accent-accent-blue h-2 mb-1"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mb-4">
            <span>Facile</span>
            <span>Difficile</span>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setDifficultyEditor(null)}
              className="flex-1 bg-secondary text-secondary-foreground font-medium py-2.5 rounded-xl text-sm touch-target"
            >
              Annuler
            </button>
            <button
              onClick={() => {
                setExerciseDifficulty(prev => ({ ...prev, [difficultyEditor.exerciseId]: difficultyEditor.draft }));
                setDifficultyEditor(null);
              }}
              className="flex-1 btn-neon font-medium py-2.5 rounded-xl text-sm touch-target"
            >
              Enregistrer
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default WorkoutTab;
