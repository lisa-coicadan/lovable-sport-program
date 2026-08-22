import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AppData, WorkoutType, SetLog, SessionLog, FiveThreeOneMethod, ClusterMethod, EMOMMethod, ExerciseMethod, Exercise, CardioSession, CardioActivityType, DeloadType, DeloadIntensity, PlannedSession, EQUIPMENT_LABELS, ExerciseEquipment, DraftSession } from '@/lib/types';
import { getWeekSets, getWeekLabel, computeNextFiveThreeOneWeekState, FiveThreeOneWeekState } from '@/lib/531';
import { getClusterConfig, getMiniSeriesWeight } from '@/lib/cluster';
import { getEmomConfig, getEmomWeight } from '@/lib/emom';
import { buildExerciseBlocks } from '@/lib/superset';
import { isBodyweightOptionalExercise, splitEquipmentVariant, detectEquipmentFromName, detectUnilateralFromName } from '@/lib/exerciseNormalize';
import { getDropSetConfig, getDropSetStage } from '@/lib/dropset';
import { compareCardioSession, formatCardioDuration, formatCardioDistance, formatPace } from '@/lib/cardio';
import { isForceFocusExercise } from '@/lib/strengthStandards';
import { computeEffectiveLoadAtOneRep, resolveBodyWeightAtDate, computeBodyweightAdjustedE1RM } from '@/lib/tonnage';
import { estimateTrainingMax } from '@/lib/trainingMax';
import { RAMP_STAGES, generateRampPlan, generateBonusStage, getOuvertureGuidance, getFailureGuidance } from '@/lib/oneRepMaxTest';
import { roundWeightSmart } from '@/lib/weightRounding';
import { shouldShowBodyweightReminder, buildBodyweightReminderSnoozePatch } from '@/lib/bodyweightReminder';
import { getWarmupPercentages } from '@/lib/warmup';
import {
  shouldShowDeloadRecommendation, DeloadCriteria, buildDeloadAcceptPatch, buildDeloadDismissPatch, buildDeloadSkipPatch,
  consumeDeloadOnSessionSave, reconcileExpiredDeload, getDeloadTargetWorkoutTypes, applyDeloadToWeight, applyDeloadToTrainingMax,
  getDeloadSetCount, shouldReduceSets, getActiveDeload,
} from '@/lib/deload';
import RestTimer, { RestTimerHandle } from './RestTimer';
import EmomTimer from './EmomTimer';
import ExerciseHistory from './ExerciseHistory';
import SessionSummary from './SessionSummary';
import SettingsPanel from './SettingsPanel';
import { Check, ChevronRight, ArrowLeft, Settings, History, Plus, Trash2, ChevronDown, Timer, Pencil, TrendingDown, Activity, Footprints, Waves, Bike, Lightbulb, Gauge, X, Dumbbell, Repeat, Link2 } from 'lucide-react';
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
  { type: 'Hyrox', icon: Dumbbell },
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
// build and by the in-session method switch, so both stay in sync. `tags` is the
// EFFECTIVE unilatéral/équipement to stamp (session override if any, else the exercise's
// Réglages default) — this is a module-level pure function, so it can't read the
// component's tagOverrides state itself; every caller passes getEffectiveTags(ex).
const buildSetsForExercise = (
  ex: Exercise, method: ExerciseMethod | undefined, lastWeight: number,
  tags: { equipment?: ExerciseEquipment; unilateral?: boolean } = { equipment: ex.equipment, unilateral: ex.unilateral }
): SetLog[] => {
  if (method?.type === '531') {
    const weekSets = getWeekSets(method.trainingMax, method.currentWeek);
    return weekSets.map((s, i) => ({
      exerciseId: ex.id, exerciseName: ex.name, setNumber: i + 1,
      reps: parseInt(s.reps) || 1, weight: s.weight, completed: false,
      equipment: tags.equipment, unilateral: tags.unilateral,
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
          equipment: tags.equipment, unilateral: tags.unilateral,
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
      result.push({
        exerciseId: ex.id, exerciseName: ex.name, setNumber: i + 1, reps: repsPerMinute, weight, completed: false,
        equipment: tags.equipment, unilateral: tags.unilateral,
      });
    }
    return result;
  }
  const result: SetLog[] = [];
  for (let i = 0; i < ex.sets; i++) {
    result.push({
      exerciseId: ex.id, exerciseName: ex.name, setNumber: i + 1,
      reps: ex.amrap ? 0 : ex.reps, weight: lastWeight, completed: false,
      amrap: ex.amrap || undefined,
      equipment: tags.equipment, unilateral: tags.unilateral,
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

// Isolated component so its once-a-second tick only re-renders this badge, not the
// whole (very dense — see CLAUDE.md) WorkoutTab tree it used to live in via a `nowTick`
// state on the parent. That drove a full re-render of the entire recap screen every
// second for the whole session, stacking with RestTimer's own independent 1s interval
// (unsynchronized) and occasionally stalling the main thread long enough for RestTimer's
// wall-clock tick to skip straight from displaying "2" to auto-reset without ever
// showing "1"/"0".
const SessionElapsedBadge = ({ startTime }: { startTime: number }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startTime) / 1000));
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  return (
    <span className="ml-auto text-sm font-mono font-semibold text-primary tabular-nums bg-primary/10 px-2.5 py-1 rounded-lg">
      {mm}:{ss}
    </span>
  );
};

const WorkoutTab = ({ data, onSaveSession, onUpdateData, selectedDate, onClearSelectedDate, onProgressChange }: WorkoutTabProps) => {
  const [mode, setMode] = useState<Mode>('select');
  const [selectedType, setSelectedType] = useState<WorkoutType | null>(null);
  const [sets, setSets] = useState<SetLog[]>([]);
  const [startTime, setStartTime] = useState(Date.now());
  const [selectedWeeks, setSelectedWeeks] = useState<Record<string, number>>({});
  const [amrapReps, setAmrapReps] = useState<Record<number, number>>({});
  // Raw text of a weight field while she's actively typing it (keyed by set index),
  // decoupled from the committed numeric sets[i].weight. Without this, a controlled
  // <input value={sets[i].weight}> gets reformatted back to a bare number on every
  // keystroke — "90," parses fine to 90 and re-renders as "90", silently deleting the
  // decimal separator before she can type the digits after it. Cleared on blur so the
  // field falls back to displaying the canonical committed number once she's done.
  const [weightDraft, setWeightDraft] = useState<Record<number, string>>({});
  // Same pattern as weightDraft, for reps fields — without it, backspacing a reps digit
  // down to empty gets silently reverted back to the last committed number on the very
  // next re-render (the session timer alone re-renders every second), which read as
  // "I have to select-all instead of just deleting" since a plain backspace never stuck.
  const [repsDraft, setRepsDraft] = useState<Record<number, string>>({});
  const [pendingSession, setPendingSession] = useState<SessionLog | null>(null);
  const [historyExercise, setHistoryExercise] = useState<string | null>(null);
  const [restDuration, setRestDuration] = useState(data.restDuration || 90);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [clusterAutoTimer, setClusterAutoTimer] = useState(false);
  const [methodOverrides, setMethodOverrides] = useState<Record<string, MethodOverride>>({});
  // Session-only unilatéral/équipement override, same pattern as methodOverrides above —
  // Réglages now owns the exercise's PLANNED default (see SettingsPanel's "Options
  // avancées"); this only lets her deviate from it for THIS session (e.g. the rack was
  // taken, she used dumbbells instead) without rewriting that default. Never persisted.
  const [tagOverrides, setTagOverrides] = useState<Record<string, { equipment?: ExerciseEquipment; unilateral?: boolean }>>({});
  // Bodyweight for THIS live session's date — feeds computeBodyweightAdjustedE1RM for any
  // live 1RM badge on a bodyweight-optional exercise (tractions/dips/muscle-up/pompes),
  // same resolution rule as everywhere else (most recent log on/before the session date).
  const liveBodyWeight = useMemo(
    () => resolveBodyWeightAtDate(data.bodyWeightLogs, selectedDate || new Date().toISOString().split('T')[0]),
    [data.bodyWeightLogs, selectedDate]
  );
  const [showAbandonConfirm, setShowAbandonConfirm] = useState(false);
  // Set when switching Cluster/EMOM/Normal would silently wipe a drop set on this
  // exercise — see applyMethodOverride/doApplyMethodOverride.
  const [methodSwitchConfirm, setMethodSwitchConfirm] = useState<{ ex: Exercise; opt: 'cluster' | 'emom' | 'none' } | null>(null);
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
  // Which exercise's "lier en superset" picker is open — an explicit button + list
  // (tap the exercise to link, from the OTHER standalone exercises in this session)
  // instead of the drag-to-link gesture this replaced, which she found unintuitive.
  const [linkPickerFor, setLinkPickerFor] = useState<string | null>(null);
  // Type/Intensity popup shown after tapping "Accepter" on the deload recommendation
  // banner — defaults match the spec's "(recommandé)" picks.
  const [deloadPopupOpen, setDeloadPopupOpen] = useState(false);
  const [deloadTypeDraft, setDeloadTypeDraft] = useState<DeloadType>('both');
  const [deloadIntensityDraft, setDeloadIntensityDraft] = useState<DeloadIntensity>('medium');
  // Quick weight entry inline in the bodyweight-reminder banner (select mode) — see
  // src/lib/bodyweightReminder.ts for the ~monthly trigger/snooze logic.
  const [bodyweightDraft, setBodyweightDraft] = useState('');
  // Which exercise's unilatéral/équipement popover is open — see tagOverrides above.
  const [tagsEditorFor, setTagsEditorFor] = useState<string | null>(null);
  // "1RM ?" confirmation on a genuine 1-rep set (Force-focus exercises only, see
  // Exercise.trainingFocus) — the checkbox below is the RPE 9-10 self-report that makes
  // this a TESTED 1RM rather than just another logged set.
  const [trueOneRMConfirm, setTrueOneRMConfirm] = useState<{ exerciseId: string; name: string; globalIdx: number; rpeConfirmed: boolean } | null>(null);
  // Shown right after a true 1RM is saved, only when it implies a different TM than the
  // one currently set on that exercise's method — never automatic (see item 5 design note).
  const [tmUpdatePrompt, setTmUpdatePrompt] = useState<{ exerciseId: string; currentTM: number; newTM: number } | null>(null);
  // "Tester un 1RM" setup panel (target 1RM input) shown before the ramp is generated —
  // once generated, the ramp's own isTestMax sets are the source of truth for whether it's
  // active, so no separate "active" flag is needed here.
  const [testMaxSetupOpen, setTestMaxSetupOpen] = useState<Record<string, boolean>>({});
  const [testMaxTargetDraft, setTestMaxTargetDraft] = useState<Record<string, string>>({});
  const restTimerRef = useRef<RestTimerHandle>(null);

  // Cardio logging is a simple after-the-fact form (not an interactive session like the
  // rest of this component) — its own small state block, reset whenever the form closes.
  const [cardioActivityType, setCardioActivityType] = useState<CardioActivityType>('Course à pied');
  const [cardioCustomLabel, setCardioCustomLabel] = useState('');
  const [cardioDurationMin, setCardioDurationMin] = useState('');
  const [cardioDurationSec, setCardioDurationSec] = useState('');
  const [cardioDistance, setCardioDistance] = useState('');
  const [cardioDifficulty, setCardioDifficulty] = useState(3);
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
  // stays a standing program, always following its configured state, except its week is
  // read as 4 (deload) while a deload is genuinely active and pending for this session's
  // workout type — never persisted, see buildDeloadAcceptPatch's comment in deload.ts.
  const getEffectiveMethod = useCallback((ex: Exercise): ExerciseMethod | undefined => {
    const override = methodOverrides[ex.id];
    if (override && override !== 'default') return resolveOverrideMethod(ex, override as 'cluster' | 'emom' | 'none');
    if (ex.method?.type === '531' && ex.method.currentWeek !== 4 && selectedType) {
      const deloadActive = getActiveDeload(data);
      if (deloadActive?.pendingWorkoutTypeIds.includes(selectedType.id)) {
        return { ...ex.method, currentWeek: 4 };
      }
    }
    return ex.method;
  }, [methodOverrides, data, selectedType]);

  // Switches an exercise's technique for the current session only (never touches its
  // configured default) and regenerates its live sets in place, at the same position
  // in the flat `sets` array, so ordering and other exercises are undisturbed.
  const doApplyMethodOverride = (ex: Exercise, opt: 'cluster' | 'emom' | 'none') => {
    setMethodOverrides(prev => ({ ...prev, [ex.id]: opt }));
    const effectiveMethod = resolveOverrideMethod(ex, opt);
    setSets(prev => {
      const idx = prev.findIndex(s => s.exerciseId === ex.id);
      if (idx === -1) return prev;
      const insertAt = prev.slice(0, idx).filter(s => s.exerciseId !== ex.id).length;
      const filtered = prev.filter(s => s.exerciseId !== ex.id);
      const fresh = buildSetsForExercise(ex, effectiveMethod, 0, getEffectiveTags(ex));
      const result = [...filtered];
      result.splice(insertAt, 0, ...fresh);
      return result;
    });
  };

  const applyMethodOverride = (ex: Exercise, opt: 'cluster' | 'emom' | 'none') => {
    const currentType = getEffectiveMethod(ex)?.type ?? 'none';
    if (currentType === opt) return;
    // Regenerating this exercise's sets for the new method wipes any drop set stage(s)
    // she's added on it (manually, or from a preconfigured dropSet) without carrying them
    // over — ask first instead of losing them silently.
    const hasDropSet = sets.some(s => s.exerciseId === ex.id && s.dropSetStage);
    if (hasDropSet) { setMethodSwitchConfirm({ ex, opt }); return; }
    doApplyMethodOverride(ex, opt);
  };

  // "Ajouter une séance" on a Calendar day sets `selectedDate` and switches to this tab —
  // she means "let me pick a workout type for that date," not whatever screen (Réglages,
  // Historique...) this component happened to be parked on from earlier browsing. Only
  // resets when no session is actually in progress, so it can't silently drop live sets.
  useEffect(() => {
    if (selectedDate && !selectedType) setMode('select');
  }, [selectedDate, selectedType]);

  // Opening an exercise's history from deep in a scrolled-down session card must not
  // inherit that scroll position — WorkoutTab's screens swap in place (not real routes),
  // so without this the page stayed wherever it was and the history view opened looking
  // like it landed at the bottom instead of showing its own top content first.
  useEffect(() => {
    if (mode === 'history') window.scrollTo(0, 0);
  }, [mode, historyExercise]);

  useEffect(() => {
    if (!onProgressChange) return;
    if (mode !== 'recap' || sets.length === 0) {
      onProgressChange(null);
      return;
    }
    onProgressChange(sets.filter(s => s.completed).length / sets.length);
  }, [mode, sets, onProgressChange]);

  // Keeps AppData.draftSession in sync with the live session so nothing is lost if the
  // app gets closed mid-workout or right at the recap screen before she's tapped
  // "Enregistrer" — see DraftSession in types.ts. Covers 'recap' (still logging sets) and
  // 'summary' (reviewing the recap, not yet committed) alike; cleared explicitly in
  // handleSummaryComplete (real save) and doAbandon (she gave up on it).
  useEffect(() => {
    if ((mode !== 'recap' && mode !== 'summary') || !selectedType || sets.length === 0) return;
    const draft: DraftSession = {
      workoutTypeId: selectedType.id,
      sets,
      startTime,
      selectedDate: selectedDate ?? undefined,
      selectedWeeks,
      exerciseDifficulty,
    };
    onUpdateData({ draftSession: draft });
  }, [mode, selectedType, sets, startTime, selectedDate, selectedWeeks, exerciseDifficulty, onUpdateData]);

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
  // nudge below — isDeload lets that nudge skip a session where a low RPE was expected
  // (deload), not a sign she should push harder.
  const getLastExerciseDifficulty = useCallback((exerciseId: string): { value: number; isDeload: boolean } | null => {
    for (let i = data.sessions.length - 1; i >= 0; i--) {
      const session = data.sessions[i];
      const val = session.exerciseDifficulty?.[exerciseId];
      if (val !== undefined) return { value: val, isDeload: !!session.isDeload };
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
    setTagOverrides({});
    setRenamingExerciseId(null);
    setDropSetPickerFor(null);
    setExerciseDifficulty({});
    setDifficultyEditor(null);

    // 5/3/1's own deload week is only forced while a deload is genuinely active and pending
    // for THIS workout type right now — never persisted onto the exercise itself (see
    // deload.ts's buildDeloadAcceptPatch/buildManualDeloadPatch comment). Cluster/EMOM only
    // ever get a charge (Training Max) cut, never a volume one (no clean equivalent — see
    // getDeloadSetCount's doc comment); regular exercises get whichever of the two the
    // chosen deload type calls for.
    const deloadActive = getActiveDeload(data);
    const isDeloadPending = !!deloadActive?.pendingWorkoutTypeIds.includes(type.id);
    const deloadReduceCharge = isDeloadPending && deloadActive!.type !== 'volume';
    const deloadReduceSets = isDeloadPending && shouldReduceSets(deloadActive!.type);
    const deloadWeight = (w: number) => deloadReduceCharge ? applyDeloadToWeight(w, deloadActive!.type, deloadActive!.intensity) : w;
    const deloadSets = (n: number) => deloadReduceSets ? getDeloadSetCount(n, deloadActive!.intensity) : n;
    const effectiveFiveThreeOneWeek = (m: FiveThreeOneMethod) => (isDeloadPending && m.currentWeek !== 4) ? 4 : m.currentWeek;

    const initialWeeks: Record<string, number> = {};
    type.exercises.forEach(ex => {
      if (ex.method?.type === '531') initialWeeks[ex.id] = effectiveFiveThreeOneWeek(ex.method);
    });
    setSelectedWeeks(initialWeeks);

    const lastWeights = getLastSessionWeights(type.id, type.exercises);
    const initialSets: SetLog[] = [];

    const exerciseMap = new Map(type.exercises.map(e => [e.id, e]));
    buildExerciseBlocks(type.exercises).forEach(block => {
      if (block.isSuperset) {
        const a = exerciseMap.get(block.exerciseIds[0])!;
        const b = exerciseMap.get(block.exerciseIds[1])!;
        const sharedSets = deloadSets(a.sets);
        const aWeight = deloadWeight(lastWeights[a.id] || a.weight || 0);
        const bWeight = deloadWeight(lastWeights[b.id] || b.weight || 0);
        // Either side of a superset can have its own pre-configured drop set (Settings) —
        // same auto-cascade-stage-1 behavior as a standalone exercise, just scoped to
        // whichever partner(s) actually have one, and stamped with that partner's own
        // supersetGroupId/role so it stays attached to its side of the pair.
        const aDropConfig = a.dropSet ? getDropSetConfig(a.dropSet) : null;
        const bDropConfig = b.dropSet ? getDropSetConfig(b.dropSet) : null;
        for (let i = 0; i < sharedSets; i++) {
          const aAnchor: SetLog = {
            exerciseId: a.id,
            exerciseName: a.name,
            setNumber: i + 1,
            reps: a.amrap ? 0 : a.reps,
            weight: aWeight,
            completed: false,
            supersetGroupId: a.supersetGroupId,
            supersetRole: 'A',
            amrap: a.amrap || undefined,
            equipment: a.equipment, unilateral: a.unilateral,
          };
          initialSets.push(aAnchor);
          if (aDropConfig) {
            const { weight, reps } = getDropSetStage(aAnchor.weight, aAnchor.reps, 1, aDropConfig);
            initialSets.push({
              exerciseId: a.id, exerciseName: a.name, setNumber: aAnchor.setNumber + 1,
              reps, weight, completed: false, dropSetStage: 1,
              equipment: a.equipment, unilateral: a.unilateral,
              supersetGroupId: a.supersetGroupId, supersetRole: 'A',
            });
          }
          const bAnchor: SetLog = {
            exerciseId: b.id,
            exerciseName: b.name,
            setNumber: i + 1,
            reps: b.amrap ? 0 : b.reps,
            weight: bWeight,
            completed: false,
            supersetGroupId: b.supersetGroupId,
            supersetRole: 'B',
            amrap: b.amrap || undefined,
            equipment: b.equipment, unilateral: b.unilateral,
          };
          initialSets.push(bAnchor);
          if (bDropConfig) {
            const { weight, reps } = getDropSetStage(bAnchor.weight, bAnchor.reps, 1, bDropConfig);
            initialSets.push({
              exerciseId: b.id, exerciseName: b.name, setNumber: bAnchor.setNumber + 1,
              reps, weight, completed: false, dropSetStage: 1,
              equipment: b.equipment, unilateral: b.unilateral,
              supersetGroupId: b.supersetGroupId, supersetRole: 'B',
            });
          }
        }
      } else {
        // Session always starts from each exercise's configured default method — the
        // live picker to switch Cluster/EMOM/Normal only appears once inside the session.
        const ex = exerciseMap.get(block.exerciseIds[0])!;
        const lastWeight = lastWeights[ex.id] || 0;
        let effectiveEx = ex;
        let effectiveWeight = lastWeight;
        if (isDeloadPending) {
          if (ex.method?.type === '531') {
            const effectiveWeek = effectiveFiveThreeOneWeek(ex.method);
            if (effectiveWeek !== ex.method.currentWeek) {
              effectiveEx = { ...ex, method: { ...ex.method, currentWeek: effectiveWeek } };
            }
          } else if (ex.method?.type === 'cluster' || ex.method?.type === 'emom') {
            if (deloadReduceCharge) {
              effectiveEx = { ...ex, method: { ...ex.method, trainingMax: applyDeloadToTrainingMax(ex.method.trainingMax, deloadActive!.type, deloadActive!.intensity) } };
            }
          } else if (!ex.method) {
            effectiveWeight = deloadWeight(lastWeight);
            effectiveEx = { ...ex, sets: deloadSets(ex.sets) };
          }
        }
        const exSets = buildSetsForExercise(effectiveEx, effectiveEx.method, effectiveWeight);
        // Pre-configured drop set (Settings): auto-cascade a stage-1 drop below EVERY
        // regular set of this exercise, not just the last one, so the whole session is
        // ready without tapping "+ Drop set" under each series by hand. Interleaved right
        // after its own anchor (same layout convention as the manual addDropSet below).
        if (!ex.method && ex.dropSet) {
          const config = getDropSetConfig(ex.dropSet);
          exSets.forEach(anchor => {
            initialSets.push(anchor);
            const { weight, reps } = getDropSetStage(anchor.weight, anchor.reps, 1, config);
            initialSets.push({
              exerciseId: ex.id, exerciseName: ex.name, setNumber: anchor.setNumber + 1,
              reps, weight, completed: false, dropSetStage: 1,
              equipment: ex.equipment, unilateral: ex.unilateral,
            });
          });
        } else {
          initialSets.push(...exSets);
        }
      }
    });
    setSets(initialSets);
  };

  // Rehydrates a session AppData.draftSession left behind by a previous visit that never
  // reached the final "Enregistrer" tap (app closed, tab killed, whatever) — restores the
  // exact sets she'd already logged and drops her back into the live session (mode
  // 'recap'), skipping startWorkout's own from-scratch generation (deload/531-week
  // resolution already happened once when the draft was first created; redoing it here
  // could double-apply a deload cut or re-derive a different week if the underlying
  // exercise config changed mid-session).
  const resumeDraftSession = () => {
    const draft = data.draftSession;
    if (!draft) return;
    const type = data.workoutTypes.find(t => t.id === draft.workoutTypeId);
    // The workout type itself was deleted since the draft was written — nothing sane to
    // resume into, so just clear the stale draft instead of silently doing nothing.
    if (!type) { onUpdateData({ draftSession: undefined }); return; }
    setSelectedType(type);
    setSets(draft.sets);
    setStartTime(draft.startTime);
    setSelectedWeeks(draft.selectedWeeks || {});
    setExerciseDifficulty(draft.exerciseDifficulty || {});
    setAmrapReps({});
    setMethodOverrides({});
    setTagOverrides({});
    setMode('recap');
  };

  const discardDraftSession = () => {
    onUpdateData({ draftSession: undefined });
  };

  const toggleSet = (index: number) => {
    const updated = [...sets];
    updated[index].completed = !updated[index].completed;
    setSets(updated);
  };

  const updateSet = (index: number, field: 'reps' | 'weight', value: string) => {
    // A field left momentarily empty must NOT commit to 0 right away — that would force the
    // input back to "0" on every keystroke and fight her typing. Left truly empty on blur, it
    // finalizes to 0 instead (see finalizeWeightOnBlur/finalizeSimpleWeightOnBlur/
    // finalizeRepsOnBlur) — 0kg is a legitimate value on any exercise, not just bodyweight
    // ones, so it must stay displayed once committed.
    if (field === 'weight') {
      // Track exactly what she's typing, independent of the committed number below — a
      // controlled <input value={sets[i].weight}> would otherwise get reformatted back to a
      // bare number on every keystroke: "90," parses fine to 90 and immediately re-renders
      // as "90", deleting the decimal separator before she can type the digits after it.
      // Cleared on blur (finalizeWeightOnBlur/finalizeSimpleWeightOnBlur) so the field falls
      // back to showing the canonical committed number once she's done.
      setWeightDraft(prev => ({ ...prev, [index]: value }));
    } else {
      setRepsDraft(prev => ({ ...prev, [index]: value }));
    }
    if (value === '') return;
    const updated = [...sets];
    if (field === 'weight') {
      const parsed = parseFloat(value.replace(',', '.')) || 0;
      // The mobile numeric keypad for <input type="number"> rarely offers a minus key, so
      // she can't just type "-20" — instead, the +/- toggle button sets the sign and this
      // preserves it while she types the magnitude (onFocus selects-all, so each edit here
      // sees a bare digit string with no sign of its own). An explicitly typed "-" (on
      // devices whose keypad does have one) always wins over the preserved sign.
      const typedNegative = value.trim().startsWith('-');
      const wasNegative = updated[index].weight < 0;
      updated[index][field] = typedNegative ? parsed : (wasNegative ? -Math.abs(parsed) : parsed);
    } else {
      updated[index][field] = parseInt(value.replace(',', '.'), 10) || 0;
    }
    setSets(updated);
  };

  // Only used by the "Tester un 1RM" ramp rows — rpe/failed have no place in the
  // reps/weight-only updateSet above, and there's no other flow that sets them.
  const setRampSetField = (index: number, patch: Partial<Pick<SetLog, 'rpe' | 'failed'>>) => {
    setSets(prev => prev.map((s, i) => i === index ? { ...s, ...patch } : s));
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

  // Weight field left empty on blur finalizes to 0 (an abandoned edit shouldn't leave a
  // stale pre-clear value behind) and propagates set-1's weight to remaining empty sets —
  // merged into one pass over `sets` so the propagate step always reads the just-finalized
  // value instead of stale state from before the blur.
  const finalizeWeightOnBlur = (index: number, rawValue: string) => {
    const updated = [...sets];
    if (rawValue.trim() === '') updated[index] = { ...updated[index], weight: 0 };
    const currentSet = updated[index];
    const touched = [index];
    if (currentSet && currentSet.setNumber === 1 && (currentSet.weight > 0 || isBodyweightOptionalExercise(currentSet.exerciseName))) {
      for (let i = index + 1; i < updated.length; i++) {
        // Drop-set rows keep their own computed (discounted) weight — never overwritten by
        // this. Completed sets are already logged and protected too — only sync forward
        // into sets she hasn't finished yet. Everything else in between syncs to whatever
        // she just set on the first set, whether it was empty or already pre-filled with a
        // different value — editing set 1 is meant to carry through to the rest.
        if (updated[i].exerciseId === currentSet.exerciseId && !updated[i].dropSetStage && !updated[i].completed) {
          updated[i] = { ...updated[i], weight: currentSet.weight };
          touched.push(i);
        }
      }
    }
    setSets(updated);
    // Drop the raw-typing draft for every index just committed above — otherwise a stale
    // draft would keep shadowing the fresh numeric value in the display (see updateSet).
    setWeightDraft(prev => {
      const next = { ...prev };
      let changed = false;
      touched.forEach(i => { if (i in next) { delete next[i]; changed = true; } });
      return changed ? next : prev;
    });
  };

  // Same "empty finalizes to 0 instead of a stale value" fix, for weight fields that never
  // propagate forward (warm-up rows, the 1RM-test ramp, 5/3/1 rows).
  const finalizeSimpleWeightOnBlur = (index: number, rawValue: string) => {
    setWeightDraft(prev => {
      if (!(index in prev)) return prev;
      const next = { ...prev };
      delete next[index];
      return next;
    });
    if (rawValue.trim() !== '') return;
    const updated = [...sets];
    updated[index] = { ...updated[index], weight: 0 };
    setSets(updated);
  };

  // Mirrors finalizeSimpleWeightOnBlur for reps fields — updateSet's guard above (no-op on a
  // transiently-empty value) leaves a truly-abandoned edit uncommitted, so it's finalized to 0
  // here on blur instead.
  const finalizeRepsOnBlur = (index: number, rawValue: string) => {
    setRepsDraft(prev => {
      if (!(index in prev)) return prev;
      const next = { ...prev };
      delete next[index];
      return next;
    });
    if (rawValue.trim() !== '') return;
    const updated = [...sets];
    updated[index] = { ...updated[index], reps: 0 };
    setSets(updated);
  };

  // Weight defaults to 0 whenever nothing meaningful has been entered yet, so an
  // untouched-looking field actually displays "0" until she taps it — selecting that "0"
  // (the old behavior, select-all) still meant noticing and deleting it before typing,
  // mid-set, one-handed. Clearing it outright when it's still 0 makes the field genuinely
  // empty and ready to type into; a real (non-zero) value still gets select()'d as before,
  // which is what updateSet's sign-preservation above expects (it reads the edit as a bare
  // digit string with no sign of its own).
  const onWeightFocus = (e, index: number) => {
    if (sets[index].weight === 0) {
      e.target.value = '';
      // Keeps the field blank across any re-render that happens while she's still
      // focused but hasn't typed anything yet (the imperative clear above only touches
      // this one DOM write) — otherwise the controlled value snaps back to "0".
      setWeightDraft(prev => ({ ...prev, [index]: '' }));
    } else {
      e.target.select();
    }
  };

  // Add extra set to an exercise
  const addSetToExercise = (exerciseId: string, exerciseName: string) => {
    const existingSets = sets.filter(s => s.exerciseId === exerciseId);
    const lastSet = existingSets[existingSets.length - 1];
    let insertIndex = sets.length;
    for (let i = sets.length - 1; i >= 0; i--) {
      if (sets[i].exerciseId === exerciseId) { insertIndex = i + 1; break; }
    }
    // The effective (override-aware) tags, not the last set's — a free/temp exercise with
    // no template entry falls back to whatever the last set already carried.
    const templateEx = selectedType?.exercises.find(e => e.id === exerciseId);
    const effectiveTags = templateEx ? getEffectiveTags(templateEx) : { equipment: lastSet?.equipment, unilateral: lastSet?.unilateral };

    const newSet: SetLog = {
      exerciseId,
      exerciseName,
      setNumber: existingSets.length + 1,
      reps: lastSet?.amrap ? 0 : (lastSet?.reps || 10),
      weight: lastSet?.weight || 0,
      completed: false,
      amrap: lastSet?.amrap || undefined,
      equipment: effectiveTags.equipment, unilateral: effectiveTags.unilateral,
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
      equipment: anchor.equipment, unilateral: anchor.unilateral,
      // Carries the anchor's superset membership forward — a drop set on one side of a
      // superset stays attached to that side (never orphaned into a standalone row).
      supersetGroupId: anchor.supersetGroupId, supersetRole: anchor.supersetRole,
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
    // Drop straight into the same rename flow as the Pencil button (renamingExerciseId/
    // renameValue below) instead of a separate always-on input — once she names it and
    // blurs, it becomes a real exercise card (History button, weight pre-fill via
    // updateExerciseName) exactly like any other, instead of staying a bare text field
    // with no history access for the rest of the session.
    setRenamingExerciseId(newId);
    setRenameValue('');
  };

  // Remove a set
  const removeSet = (index: number) => {
    setSets(prev => prev.filter((_, i) => i !== index));
  };

  // Superset-aware counterparts to addSetToExercise/removeSet above — a "round" is one
  // A+B pair (plus each side's own drop-set cascade, if any). Both sides must move
  // together: the render code's aAnchors[i]/bAnchors[i] pairing is positional, so adding
  // or removing only one side would desync every round after it.
  const addSupersetRound = (block: SupersetBlock) => {
    const lastSerie = block.series[block.series.length - 1];
    const aLast = lastSerie ? sets[lastSerie.aIdx] : undefined;
    const bLast = lastSerie ? sets[lastSerie.bIdx] : undefined;
    const aTemplate = selectedType?.exercises.find(e => e.id === block.aId);
    const bTemplate = selectedType?.exercises.find(e => e.id === block.bId);
    const aTags = aTemplate ? getEffectiveTags(aTemplate) : { equipment: aLast?.equipment, unilateral: aLast?.unilateral };
    const bTags = bTemplate ? getEffectiveTags(bTemplate) : { equipment: bLast?.equipment, unilateral: bLast?.unilateral };
    const newA: SetLog = {
      exerciseId: block.aId, exerciseName: block.aName,
      setNumber: sets.filter(s => s.exerciseId === block.aId).length + 1,
      reps: aLast?.amrap ? 0 : (aLast?.reps || 10),
      weight: aLast?.weight || 0,
      completed: false,
      amrap: aLast?.amrap || undefined,
      supersetGroupId: block.groupId, supersetRole: 'A',
      equipment: aTags.equipment, unilateral: aTags.unilateral,
    };
    const newB: SetLog = {
      exerciseId: block.bId, exerciseName: block.bName,
      setNumber: sets.filter(s => s.exerciseId === block.bId).length + 1,
      reps: bLast?.amrap ? 0 : (bLast?.reps || 10),
      weight: bLast?.weight || 0,
      completed: false,
      amrap: bLast?.amrap || undefined,
      supersetGroupId: block.groupId, supersetRole: 'B',
      equipment: bTags.equipment, unilateral: bTags.unilateral,
    };
    // Appended right after the group's last existing entry (whichever side that is) —
    // nothing follows either new anchor, so dropsAfter's forward scan naturally finds no
    // drops for them yet, regardless of how the two sides happen to be interleaved above.
    const groupIdxs = sets.map((_, i) => i).filter(i => sets[i].supersetGroupId === block.groupId);
    const insertAt = groupIdxs.length > 0 ? Math.max(...groupIdxs) + 1 : sets.length;
    const updated = [...sets];
    updated.splice(insertAt, 0, newA, newB);
    setSets(updated);
  };

  const removeSupersetRound = (serie: SupersetBlock['series'][number]) => {
    const idxs = new Set([serie.aIdx, ...serie.aDropIdxs, serie.bIdx, ...serie.bDropIdxs]);
    setSets(prev => prev.filter((_, i) => !idxs.has(i)));
  };

  // Renames an exercise for this session only — used both for temp exercises (freely
  // named) and for regular ones (e.g. picking which variant of "Hack squat ou leg press"
  // she actually did today, or swapping to a completely different exercise mid-session).
  // The WorkoutType template is never touched; only this live `sets` array, which is what
  // every card/history lookup below reads its name from.
  const updateExerciseName = (exerciseId: string, name: string) => {
    // Equipment/unilatéral get a fresh guess from the NEW name (same detectEquipmentFromName
    // used for a Réglages rename) instead of carrying over whatever the OLD exercise had —
    // renaming "Triceps poulie" to "Pec deck" must not leave "poulie" pre-filled on an
    // exercise that has nothing to do with a poulie. No keyword match in the new name (as
    // with "Pec deck") means it comes out genuinely empty, ready for her to set by hand.
    const detectedEquipment = detectEquipmentFromName(name);
    const detectedUnilateral = detectUnilateralFromName(name) || undefined;
    // Same reasoning applies to weight: whatever's currently in these sets (baked in at
    // session start from the OLD exercise's history, or just left at 0 for a brand new
    // temp exercise) belongs to the exercise she's leaving, not to `name`. Re-pull from
    // THIS exercise's own last performance (0 if it's never been logged before). Only
    // touches sets she hasn't completed yet — one already logged under the old name keeps
    // what she actually did.
    const newWeight = getLastPerformance(name)?.weight ?? 0;
    setSets(prev => prev.map(s => s.exerciseId === exerciseId
      ? { ...s, exerciseName: name, equipment: detectedEquipment, unilateral: detectedUnilateral, weight: s.completed ? s.weight : newWeight }
      : s));
    // The équipement chip/button she actually sees (renderTagsButton/renderTagsPanel)
    // reads getEffectiveTags(templateEx) — tagOverrides if set, else the Réglages
    // template's own default — never the sets[] fields above. Without also replacing
    // the override here, a real (non-temp) exercise's chip would keep showing the OLD
    // exercise's Réglages default (e.g. "poulie") no matter what the sets themselves say.
    setTagOverrides(prev => ({ ...prev, [exerciseId]: { equipment: detectedEquipment, unilateral: detectedUnilateral } }));
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

  // Saves a confirmed 1RM (RPE 9-10 single) into the app-wide history, then — only when
  // this exercise has a method whose Training Max no longer matches — offers to update it
  // (never automatic, see item 5 design note in the conversation this feature came from).
  const confirmTrueOneRM = (exerciseId: string, exerciseName: string, weight: number) => {
    const sessionDate = selectedDate || new Date().toISOString().split('T')[0];
    const bodyWeight = resolveBodyWeightAtDate(data.bodyWeightLogs, sessionDate);
    const effectiveLoad = computeEffectiveLoadAtOneRep({ weight, exerciseName }, bodyWeight);
    const movement = splitEquipmentVariant(exerciseName).base;
    const entry = { id: `true1rm-${Date.now()}`, date: sessionDate, exerciseName: movement, weight: effectiveLoad };
    onUpdateData({ trueOneRepMaxes: [...(data.trueOneRepMaxes || []), entry] });

    const templateEx = selectedType?.exercises.find(e => e.id === exerciseId);
    const currentTM = templateEx?.method?.trainingMax;
    if (currentTM !== undefined) {
      const newTM = estimateTrainingMax(effectiveLoad);
      if (Math.abs(newTM - currentTM) >= 0.5) {
        setTmUpdatePrompt({ exerciseId, currentTM, newTM });
      }
    }
  };

  const applyTmUpdate = () => {
    if (!tmUpdatePrompt) return;
    const { exerciseId, newTM } = tmUpdatePrompt;
    const patchExercise = (ex: Exercise) => ex.id === exerciseId && ex.method ? { ...ex, method: { ...ex.method, trainingMax: newTM } } : ex;
    onUpdateData({ workoutTypes: data.workoutTypes.map(t => ({ ...t, exercises: t.exercises.map(patchExercise) })) });
    // Same reason as setExerciseReminderNote above: selectedType is a snapshot, not live.
    setSelectedType(prev => prev ? { ...prev, exercises: prev.exercises.map(patchExercise) } : prev);
    setTmUpdatePrompt(null);
  };

  // The tags actually in effect for this session — the session-only override if she set
  // one, otherwise the exercise's planned default from Réglages. Used both to display the
  // current unilatéral/équipement state and to stamp every newly-created SetLog.
  const getEffectiveTags = (ex: Exercise): { equipment?: ExerciseEquipment; unilateral?: boolean } =>
    tagOverrides[ex.id] ?? { equipment: ex.equipment, unilateral: ex.unilateral };

  // Session-only — see tagOverrides above. Seeds from the exercise's current default the
  // first time she touches it, so toggling just one field (e.g. unilatéral) doesn't lose
  // the other (e.g. an already-different equipment override).
  const updateTagOverride = (ex: Exercise, patch: Partial<{ equipment: ExerciseEquipment; unilateral: boolean }>) => {
    setTagOverrides(prev => ({
      ...prev,
      [ex.id]: { ...(prev[ex.id] ?? { equipment: ex.equipment, unilateral: ex.unilateral }), ...patch },
    }));
    // Changing the equipment mid-session must also reach the sets already built for this
    // exercise — otherwise the badge shows the new value while every SetLog still carries
    // the stale one. Completed sets are already logged and stay untouched (they reflect
    // what she actually did), same rule as propagateWeightOnBlur/finalizeWeightOnBlur.
    setSets(prev => prev.map(s => (s.exerciseId === ex.id && !s.completed) ? { ...s, ...patch } : s));
  };

  // Opens the target-1RM setup panel, pre-filled from the latest confirmed true 1RM for
  // this movement if any, otherwise reverse-derived from the current TM (TM = 1RM * 0.9).
  const openTestMaxSetup = (ex: Exercise) => {
    const movement = splitEquipmentVariant(ex.name).base;
    const latestTrue = (data.trueOneRepMaxes || [])
      .filter(t => t.exerciseName === movement)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    const method = ex.method as FiveThreeOneMethod | undefined;
    const defaultTarget = latestTrue?.weight ?? (method ? Math.round((method.trainingMax / 0.9) * 10) / 10 : 0);
    setTestMaxTargetDraft(prev => ({ ...prev, [ex.id]: defaultTarget > 0 ? String(defaultTarget) : '' }));
    setTestMaxSetupOpen(prev => ({ ...prev, [ex.id]: true }));
  };

  // Swaps every set belonging to `exerciseId` for `newSets`, keeping them at that
  // exercise's ORIGINAL position in the array rather than appending at the very end —
  // the plain-exercise card's position in "Exercices réguliers" is order-sensitive
  // (see `blocks` below), so a naive filter-then-append made the exercise's whole card
  // jump to the bottom of the list the moment a ramp replaced its normal sets.
  const replaceExerciseSets = (prev: SetLog[], exerciseId: string, newSets: SetLog[]): SetLog[] => {
    const firstIdx = prev.findIndex(s => s.exerciseId === exerciseId);
    const withoutExercise = prev.filter(s => s.exerciseId !== exerciseId);
    const insertAt = firstIdx === -1 ? withoutExercise.length : firstIdx;
    return [...withoutExercise.slice(0, insertAt), ...newSets, ...withoutExercise.slice(insertAt)];
  };

  // Replaces this exercise's normal 5/3/1 sets with the ramp — session-only, the
  // WorkoutType template's week/cycle is never touched here (see isTestMax exclusion in
  // handleSummaryComplete below).
  const startTestMaxRamp = (ex: Exercise) => {
    const target = parseFloat(testMaxTargetDraft[ex.id]) || 0;
    if (target <= 0) return;
    const plan = generateRampPlan(target);
    const tags = getEffectiveTags(ex);
    const rampSets: SetLog[] = plan.map((p, i) => ({
      exerciseId: ex.id, exerciseName: ex.name, setNumber: i + 1,
      reps: p.reps, weight: p.weight, completed: false, isTestMax: true,
      equipment: tags.equipment, unilateral: tags.unilateral,
    }));
    setSets(prev => replaceExerciseSets(prev, ex.id, rampSets));
    setTestMaxSetupOpen(prev => ({ ...prev, [ex.id]: false }));
  };

  // Adds the 102% bonus attempt after a clean "Le PR" success — its own action rather than
  // part of the initial plan, since it only makes sense once she knows 100% went well.
  // Inserted right after this exercise's own last set, not at the global array's end,
  // for the same reordering reason as replaceExerciseSets above.
  const addBonusStage = (ex: Exercise) => {
    const target = parseFloat(testMaxTargetDraft[ex.id]) || 0;
    if (target <= 0) return;
    const bonus = generateBonusStage(target);
    const bonusTags = getEffectiveTags(ex);
    const bonusSet: SetLog = {
      exerciseId: ex.id, exerciseName: ex.name, setNumber: RAMP_STAGES.length + 1,
      reps: bonus.reps, weight: bonus.weight, completed: false, isTestMax: true,
      equipment: bonusTags.equipment, unilateral: bonusTags.unilateral,
    };
    setSets(prev => {
      const lastIdx = prev.reduce((acc, s, i) => (s.exerciseId === ex.id ? i : acc), -1);
      const insertAt = lastIdx === -1 ? prev.length : lastIdx + 1;
      return [...prev.slice(0, insertAt), bonusSet, ...prev.slice(insertAt)];
    });
  };

  // Abandons the ramp and rebuilds this exercise's normal prescribed week sets — she never
  // loses her place in the 5/3/1 program by trying (and backing out of) a test. Uses
  // getEffectiveMethod (not the raw ex.method) so a session-only Cluster/EMOM/Normal
  // override made before starting the test is respected on cancel too, instead of
  // reverting to whatever method the template has configured by default.
  const cancelTestMaxRamp = (ex: Exercise) => {
    const normalSets = buildSetsForExercise(ex, getEffectiveMethod(ex), 0, getEffectiveTags(ex));
    setSets(prev => replaceExerciseSets(prev, ex.id, normalSets));
  };

  // Available on every exercise regardless of method — 531/Cluster/EMOM derive the
  // working weight from their Training Max, a plain exercise anchors on whatever weight
  // is already prefilled/entered on its own first working set instead. No cap on how many
  // can be added — see src/lib/warmup.ts for the percentage table past 5 stages.
  const getWorkingWeight = (ex: Exercise): number => {
    const method = getEffectiveMethod(ex);
    if (method?.type === '531') return getWeekSets(method.trainingMax, method.currentWeek)[0]?.weight ?? 0;
    if (method?.type === 'cluster') {
      const { miniSeries } = getClusterConfig(method);
      return getMiniSeriesWeight(method.trainingMax, miniSeries[0]?.percentage ?? 0.9);
    }
    if (method?.type === 'emom') {
      const { percentage } = getEmomConfig(method);
      return getEmomWeight(method.trainingMax, percentage);
    }
    const firstWorkingSet = sets.find(s => s.exerciseId === ex.id && !s.isWarmup);
    return firstWorkingSet?.weight ?? 0;
  };

  // Warm-up reps default to the exercise's own working reps (coach guidance: same reps as
  // the work sets primes the nervous system for the exact rep range, as long as it never
  // goes to failure) — not a fixed number.
  const getWorkingReps = (ex: Exercise): number => {
    const method = getEffectiveMethod(ex);
    if (method?.type === '531') return parseInt(getWeekSets(method.trainingMax, method.currentWeek)[0]?.reps) || 5;
    if (method?.type === 'cluster') {
      const { miniSeries } = getClusterConfig(method);
      return miniSeries[0]?.reps ?? 5;
    }
    if (method?.type === 'emom') {
      const { repsPerMinute } = getEmomConfig(method);
      return repsPerMinute ?? 5;
    }
    const firstWorkingSet = sets.find(s => s.exerciseId === ex.id && !s.isWarmup);
    return firstWorkingSet?.reps || 5;
  };

  // Every stage's percentage depends on the TOTAL number of warm-up sets (see
  // src/lib/warmup.ts) — going from 3 to 4 warm-ups isn't just "add a 4th", it reshuffles
  // stages 1-3's percentages too. Both add/remove rebuild the whole warm-up block from
  // this exercise's current working weight, but keep each stage's `completed` flag (and any
  // hand-edited reps) by position, so ticking off a warm-up before adding another doesn't
  // get silently undone.
  // `oldCount` is the number of warm-up stages that existed BEFORE this add/remove — used
  // to tell an untouched auto-suggested weight (still equal to what the OLD percentage
  // table would have produced for that position) from one she actually typed in live,
  // which must survive the reshuffle instead of being silently overwritten. Real bug she
  // hit: logging warm-up weights as she went, adding one more warm-up than planned wiped
  // every previously-entered weight back to the auto-suggested figure.
  const rebuildWarmupSets = (ex: Exercise, priorStages: (SetLog | undefined)[], oldCount: number): void => {
    const percentages = getWarmupPercentages(priorStages.length);
    const oldPercentages = getWarmupPercentages(oldCount);
    const workingWeight = getWorkingWeight(ex);
    const workingReps = getWorkingReps(ex);
    const tags = getEffectiveTags(ex);
    const newWarmupSets: SetLog[] = priorStages.map((prior, i) => {
      const suggested = roundWeightSmart(workingWeight * (percentages[i] ?? 0));
      const oldSuggested = prior ? roundWeightSmart(workingWeight * (oldPercentages[i] ?? 0)) : null;
      const weight = prior && prior.weight !== oldSuggested ? prior.weight : suggested;
      return {
        exerciseId: ex.id, exerciseName: ex.name, setNumber: i + 1,
        reps: prior?.reps ?? workingReps,
        weight,
        completed: prior?.completed ?? false,
        isWarmup: true,
        equipment: prior?.equipment ?? tags.equipment, unilateral: prior?.unilateral ?? tags.unilateral,
      };
    });
    setSets(prev => {
      const firstIdx = prev.findIndex(s => s.exerciseId === ex.id);
      const withoutOldWarmups = prev.filter(s => !(s.exerciseId === ex.id && s.isWarmup));
      const insertAt = firstIdx === -1 ? withoutOldWarmups.length : firstIdx;
      return [...withoutOldWarmups.slice(0, insertAt), ...newWarmupSets, ...withoutOldWarmups.slice(insertAt)];
    });
  };

  const addWarmupSet = (ex: Exercise) => {
    const existingWarmups = sets
      .filter(s => s.exerciseId === ex.id && s.isWarmup)
      .sort((a, b) => a.setNumber - b.setNumber);
    rebuildWarmupSets(ex, [...existingWarmups, undefined], existingWarmups.length);
  };

  const removeWarmupSet = (ex: Exercise, indexToRemove: number) => {
    const existingWarmups = sets
      .filter(s => s.exerciseId === ex.id && s.isWarmup)
      .sort((a, b) => a.setNumber - b.setNumber);
    rebuildWarmupSets(ex, existingWarmups.filter((_, i) => i !== indexToRemove), existingWarmups.length);
  };

  // Unilatéral/équipement tap-to-edit — icon button for the exercise's header row, shared
  // by every card type (531/Cluster/EMOM/plain) so it's reachable regardless of method,
  // not just on exercises with no method (see item 5/item 1 of the v2.0/v2.1 lists).
  const renderTagsButton = (ex: Exercise) => {
    return (
      <button
        type="button"
        onClick={() => setTagsEditorFor(tagsEditorFor === ex.id ? null : ex.id)}
        className={`touch-target p-1.5 shrink-0 rounded-lg transition-colors ${
          tagsEditorFor === ex.id ? 'text-accent-blue' : 'text-muted-foreground/50 active:text-accent-blue'
        }`}
        aria-label={`Unilatéral / équipement pour ${ex.name}`}
        aria-pressed={tagsEditorFor === ex.id}
        title="Unilatéral / équipement"
      >
        <Repeat size={14} />
      </button>
    );
  };

  // The popover itself (when open) or the read-only chips (when closed and set) — placed
  // below the header row, same content regardless of card type. Reads/writes the session
  // override (getEffectiveTags/updateTagOverride), never Réglages' planned default.
  const renderTagsPanel = (ex: Exercise) => {
    const effective = getEffectiveTags(ex);
    const isOverridden = !!tagOverrides[ex.id];
    if (tagsEditorFor === ex.id) {
      return (
        <div className="flex items-center gap-3 flex-wrap mb-2 bg-secondary/40 rounded-lg px-2.5 py-2">
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <input
              type="checkbox"
              checked={!!effective.unilateral}
              onChange={e => updateTagOverride(ex, { unilateral: e.target.checked ? true : undefined })}
              className="w-3.5 h-3.5 accent-accent-blue"
            />
            <Repeat size={10} className="text-accent-blue" /> Unilatéral
          </label>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground">Équipement</span>
            <select
              value={effective.equipment ?? ''}
              onChange={e => updateTagOverride(ex, { equipment: e.target.value === '' ? undefined : e.target.value as ExerciseEquipment })}
              className="bg-secondary text-foreground text-[10px] rounded-md px-1.5 py-1 outline-none"
              aria-label={`Équipement de ${ex.name}`}
            >
              <option value="">—</option>
              {(Object.keys(EQUIPMENT_LABELS) as ExerciseEquipment[]).map(eq => (
                <option key={eq} value={eq}>{EQUIPMENT_LABELS[eq]}</option>
              ))}
            </select>
          </div>
          {isOverridden && (
            <button
              type="button"
              onClick={() => setTagOverrides(prev => { const next = { ...prev }; delete next[ex.id]; return next; })}
              className="text-[10px] text-muted-foreground underline"
            >
              Revenir au réglage par défaut
            </button>
          )}
        </div>
      );
    }
    if (!effective.unilateral && !effective.equipment) return null;
    return (
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        {effective.unilateral && (
          <span className="text-[10px] text-accent-blue bg-accent-blue/10 px-2 py-0.5 rounded-full">Unilatéral</span>
        )}
        {effective.equipment && (
          <span className="text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">{EQUIPMENT_LABELS[effective.equipment]}</span>
        )}
        {isOverridden && (
          <span className="text-[9px] text-warning/80">(pour cette séance)</span>
        )}
      </div>
    );
  };

  // Shared across the 531/Cluster/EMOM cards below — same muted row style regardless of
  // which method the working sets underneath use, since a warm-up set isn't tied to that
  // method's own structure (no percentage-of-TM label, no mini-series/minute grouping).
  const renderWarmupSection = (ex: Exercise) => {
    const warmupSets = sets.map((s, i) => ({ ...s, globalIdx: i })).filter(s => s.exerciseId === ex.id && s.isWarmup);
    return (
      <div className="mb-3">
        {warmupSets.map((s, i) => (
          <div
            key={s.globalIdx}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 mb-1.5 transition-all ${
              sets[s.globalIdx].completed ? 'bg-success/10 border border-success/25' : 'bg-secondary/25 border border-border/40'
            }`}
          >
            <span className="text-xs text-muted-foreground w-16 shrink-0">Éch. {i + 1}</span>
            <input
              type="text"
              inputMode="decimal"
              value={weightDraft[s.globalIdx] ?? sets[s.globalIdx].weight}
              onChange={e => updateSet(s.globalIdx, 'weight', e.target.value)}
              onFocus={e => onWeightFocus(e, s.globalIdx)}
              onBlur={e => finalizeSimpleWeightOnBlur(s.globalIdx, e.target.value)}
              className="w-14 bg-transparent text-foreground text-sm text-center outline-none font-mono"
              placeholder="kg"
              aria-label={`Poids échauffement ${i + 1}, ${ex.name} (kg)`}
            />
            <span className="text-muted-foreground text-xs">kg ×</span>
            <input
              type="number"
              value={repsDraft[s.globalIdx] ?? (sets[s.globalIdx].reps || '')}
              onChange={e => updateSet(s.globalIdx, 'reps', e.target.value)}
              onFocus={e => e.target.select()}
              onBlur={e => finalizeRepsOnBlur(s.globalIdx, e.target.value)}
              className="w-10 bg-transparent text-foreground text-sm text-center outline-none font-mono"
              aria-label={`Répétitions échauffement ${i + 1}, ${ex.name}`}
            />
            <button
              onClick={() => removeWarmupSet(ex, i)}
              className="touch-target inline-flex items-center justify-center text-muted-foreground active:text-destructive ml-auto"
              aria-label={`Supprimer échauffement ${i + 1}`}
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={() => toggleSet(s.globalIdx)}
              className={`touch-target rounded-lg p-1.5 transition-colors ${
                sets[s.globalIdx].completed ? 'text-success glow-success' : 'text-muted-foreground active:text-success'
              }`}
              aria-label={sets[s.globalIdx].completed ? `Échauffement ${i + 1} validé` : `Valider l'échauffement ${i + 1}`}
              aria-pressed={sets[s.globalIdx].completed}
            >
              <Check size={16} />
            </button>
          </div>
        ))}
        <button
          onClick={() => addWarmupSet(ex)}
          className="min-h-9 flex items-center gap-1 text-muted-foreground text-[11px] font-medium"
        >
          <Plus size={10} /> Échauffement{warmupSets.length > 0 ? ` (${warmupSets.length})` : ''}
        </button>
      </div>
    );
  };

  // "Tester un 1RM" trigger (button + target-weight setup panel) — shared by every card
  // type (531/Cluster/EMOM/plain), since isForceFocusExercise no longer depends on which
  // method (if any) the exercise uses. Hidden once the ramp itself is active (isTestMaxActive)
  // to avoid stacking a second setup panel on top of the ramp rows.
  const renderTestMaxTrigger = (ex: Exercise, isTestMaxActive: boolean) => {
    if (!isForceFocusExercise(ex) || isTestMaxActive) return null;
    return testMaxSetupOpen[ex.id] ? (
      <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 mb-3">
        <label className="text-xs text-muted-foreground block mb-1.5">1RM visé (kg)</label>
        <input
          type="number"
          autoFocus
          value={testMaxTargetDraft[ex.id] ?? ''}
          onChange={e => setTestMaxTargetDraft(prev => ({ ...prev, [ex.id]: e.target.value }))}
          className="w-full bg-background/60 text-foreground rounded-lg px-3 py-2 text-sm outline-none font-mono mb-2"
        />
        <div className="flex gap-2">
          <button
            onClick={() => setTestMaxSetupOpen(prev => ({ ...prev, [ex.id]: false }))}
            className="flex-1 bg-secondary text-secondary-foreground font-medium py-2 rounded-lg text-xs touch-target"
          >
            Annuler
          </button>
          <button
            onClick={() => startTestMaxRamp(ex)}
            className="flex-1 btn-neon font-medium py-2 rounded-lg text-xs touch-target"
          >
            Démarrer
          </button>
        </div>
      </div>
    ) : (
      <button
        onClick={() => openTestMaxSetup(ex)}
        className="w-full mb-3 flex items-center justify-center gap-1.5 text-warning text-xs font-medium py-2 rounded-lg bg-warning/10"
      >
        🎯 Tester un 1RM
      </button>
    );
  };

  // The ramp itself, once active — same rows/guidance/PR-confirm/cancel regardless of
  // which card type triggered it. `liveSets` must already exclude warm-up rows (every
  // caller's liveSets/exerciseSets already does, for its own reasons).
  const renderTestMaxRamp = (ex: Exercise, liveSets: { globalIdx: number }[]) => {
    const prStage = liveSets.find(s => sets[s.globalIdx].isTestMax && sets[s.globalIdx].setNumber === RAMP_STAGES.length);
    const prSucceeded = !!prStage && sets[prStage.globalIdx].completed && !sets[prStage.globalIdx].failed;
    const hasBonusStage = liveSets.some(s => sets[s.globalIdx].setNumber === RAMP_STAGES.length + 1);
    return (
      <div className="space-y-2">
        {liveSets.map(s => {
          const globalIdx = s.globalIdx;
          const set = sets[globalIdx];
          const stage = RAMP_STAGES[set.setNumber - 1];
          const label = stage?.label ?? 'Tentative bonus';
          const isMaxAttempt = set.setNumber >= RAMP_STAGES.length; // "Le PR" and any bonus
          return (
            <div key={globalIdx}>
              <div
                className={`rounded-xl px-3 py-2.5 transition-all ${
                  set.completed ? (set.failed ? 'bg-destructive/10 border border-destructive/25' : 'bg-success/10 border border-success/25') : 'bg-secondary/50'
                }`}
              >
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="text-[10px] text-muted-foreground w-16 shrink-0">{label}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={weightDraft[globalIdx] ?? set.weight}
                    onChange={e => updateSet(globalIdx, 'weight', e.target.value)}
                    onFocus={e => onWeightFocus(e, globalIdx)}
                    onBlur={e => finalizeSimpleWeightOnBlur(globalIdx, e.target.value)}
                    className="w-14 bg-transparent text-foreground text-sm text-center outline-none font-mono"
                    placeholder="kg"
                    aria-label={`Poids ${label}, ${ex.name} (kg)`}
                  />
                  <span className="text-muted-foreground text-xs">×</span>
                  <input
                    type="number"
                    value={repsDraft[globalIdx] ?? (set.reps || '')}
                    onChange={e => updateSet(globalIdx, 'reps', e.target.value)}
                    onFocus={e => e.target.select()}
                    onBlur={e => finalizeRepsOnBlur(globalIdx, e.target.value)}
                    className="w-10 bg-transparent text-foreground text-sm text-center outline-none font-mono"
                    aria-label={`Répétitions ${label}, ${ex.name}`}
                  />
                  <div className="flex items-center gap-1.5 ml-auto">
                    <button
                      onClick={() => { setRampSetField(globalIdx, { failed: false }); if (!set.completed) toggleSet(globalIdx); }}
                      className={`touch-target rounded-lg p-2 transition-colors ${
                        set.completed && !set.failed ? 'text-success glow-success' : 'text-muted-foreground active:text-success'
                      }`}
                      aria-label={`${label} réussie`}
                    >
                      <Check size={18} />
                    </button>
                    <button
                      onClick={() => { setRampSetField(globalIdx, { failed: true }); if (!set.completed) toggleSet(globalIdx); }}
                      className={`touch-target rounded-lg p-2 transition-colors ${
                        set.completed && set.failed ? 'text-destructive' : 'text-muted-foreground active:text-destructive'
                      }`}
                      aria-label={`${label} échouée`}
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground shrink-0">RPE</span>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={1}
                    value={set.rpe ?? 0}
                    onChange={e => setRampSetField(globalIdx, { rpe: parseInt(e.target.value) })}
                    className="flex-1 accent-accent-blue"
                    aria-label={`RPE ${label}, ${ex.name}`}
                  />
                  <span className="text-xs text-accent-blue font-mono w-5 text-right shrink-0">{set.rpe ?? '—'}</span>
                </div>
              </div>
              {stage?.key === 'ouverture' && set.completed && set.rpe !== undefined && getOuvertureGuidance(set.rpe) && (
                <p className="text-[11px] text-warning bg-warning/10 border border-warning/30 rounded-lg px-3 py-2 mt-1.5">
                  {getOuvertureGuidance(set.rpe)}
                </p>
              )}
              {set.completed && set.failed && (
                <p className="text-[11px] text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2 mt-1.5">
                  {getFailureGuidance()}
                </p>
              )}
              {isMaxAttempt && set.completed && !set.failed && set.reps === 1 && (
                <button
                  onClick={() => setTrueOneRMConfirm({ exerciseId: ex.id, name: ex.name, globalIdx, rpeConfirmed: false })}
                  className="w-full mt-1.5 touch-target flex items-center justify-center gap-1 rounded-lg text-xs font-medium text-warning bg-warning/10 py-1.5"
                >
                  1RM ?
                </button>
              )}
            </div>
          );
        })}
        {prSucceeded && !hasBonusStage && (
          <button
            onClick={() => addBonusStage(ex)}
            className="w-full min-h-11 flex items-center justify-center gap-1 text-warning text-xs font-medium"
          >
            <Plus size={12} /> Tentative bonus (102%)
          </button>
        )}
        <button
          onClick={() => cancelTestMaxRamp(ex)}
          className="w-full min-h-9 flex items-center justify-center text-muted-foreground text-[11px] mt-1"
        >
          Annuler le test — reprendre les séries normales
        </button>
      </div>
    );
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
    // A low RPE during a deload is expected (that's the point of a deload), not a sign
    // to push harder next time — skip the nudge entirely for that session.
    if (last === null || last.value > 7 || last.isDeload) return null;
    return (
      <div className="flex items-start gap-2 bg-warning/10 border border-warning/30 rounded-lg px-3 py-2 mb-3">
        <Gauge size={14} className="text-warning shrink-0 mt-0.5" />
        <p className="text-xs text-foreground/90 flex-1">RPE faible la dernière fois ({last.value}/10) — pense à augmenter la charge.</p>
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
    const wasDeloadPending = !!getActiveDeload(data)?.pendingWorkoutTypeIds.includes(session.workoutTypeId);
    const finalSession = wasDeloadPending ? { ...session, isDeload: true } : session;
    onSaveSession(finalSession);

    const updatePatch: { workoutTypes?: WorkoutType[]; deload?: AppData['deload']; plannedSessions?: PlannedSession[] } = {};

    const matchingPlanned = data.plannedSessions?.find(p => p.date === session.date && p.workoutTypeId === session.workoutTypeId);
    if (matchingPlanned) {
      updatePatch.plannedSessions = (data.plannedSessions || []).filter(p => p.id !== matchingPlanned.id);
    }

    if (selectedType) {
      const progressed = selectedType.exercises.filter(
        // isTestMax sets (see "Tester un 1RM", src/lib/oneRepMaxTest.ts) don't count as
        // having progressed this exercise's normal week — a max test on Squat alone must
        // never advance the shared week/cycle that every 5/3/1 exercise stays in lockstep on.
        ex => ex.method?.type === '531' && session.sets.some(s => s.exerciseId === ex.id && !s.isTestMax)
      );
      if (progressed.length > 0) {
        // All 5/3/1 exercises across the whole app are kept in lockstep on the same
        // week/cycle (never independently drifting) — advancing from whichever exercise
        // was actually progressed today is applied to every 5/3/1 exercise, not just the
        // ones in this session. Training Max stays per-exercise (each lift has its own),
        // only bumped for a given exercise when the shared cycle actually advances.
        const baseMethod = progressed[0].method as FiveThreeOneMethod;
        // The forced deload week is only ever committed to storage HERE, at the moment a
        // session actually happens while a deload is genuinely active/pending — never
        // eagerly at accept/activate time (see deload.ts). A deload window she never
        // trains 531 during never touches baseMethod.currentWeek at all.
        const methodForAdvance: FiveThreeOneWeekState = (wasDeloadPending && baseMethod.currentWeek !== 4)
          ? { currentWeek: 4, currentCycle: baseMethod.currentCycle, deloadResumeWeek: baseMethod.currentWeek }
          : baseMethod;
        const shared = computeNextFiveThreeOneWeekState(methodForAdvance);
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
    } else {
      // Closes out a manual deload that lapsed without ever being consumed (she didn't log
      // a session for one of its pending workout types before it expired) — otherwise
      // lastDeloadCompletedAt never gets stamped and the consecutive-weeks count keeps
      // counting from before that deload ever happened.
      const reconciled = reconcileExpiredDeload(data);
      if (reconciled) updatePatch.deload = reconciled;
    }

    // Always fires (not gated like the other fields above) — a real session was just
    // saved, so whatever draft led up to it is done and must be cleared unconditionally.
    onUpdateData({ ...updatePatch, draftSession: undefined });

    setMode('select');
    setSelectedType(null);
    setSets([]);
    setPendingSession(null);
    setMethodOverrides({});
    setTagOverrides({});
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
    // No RestTimer here (unlike every other mid-session mode) — the session is over, and
    // the floating timer button lingering over the recap read as clutter/confusion. If
    // she taps "back" into 'recap', RestTimer remounts fresh (any rest countdown that was
    // running resets) — an acceptable tradeoff for an edge case vs. the timer visibly
    // sitting on top of the final recap every single time.
    return (
      <SessionSummary
        session={pendingSession}
        previousSessions={data.sessions}
        workoutTypes={data.workoutTypes}
        gender={data.gender}
        bodyWeightLogs={data.bodyWeightLogs}
        onSave={handleSummaryComplete}
        onBack={() => setMode(selectedType ? 'recap' : 'select')}
      />
    );
  }

  if (mode === 'history' && historyExercise) {
    return (
      <>
        <ExerciseHistory
          exerciseName={historyExercise}
          data={data}
          onUpdateData={onUpdateData}
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
    const showBodyweightReminder = shouldShowBodyweightReminder(data);
    const pendingDeloadIds = getActiveDeload(data)?.pendingWorkoutTypeIds;
    const todayISO = new Date().toISOString().split('T')[0];
    const plannedTodayTypeId = data.plannedSessions?.find(p => p.date === todayISO)?.workoutTypeId;
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

        {/* Séance en cours never actually saved (app closed before "Enregistrer") — see
            DraftSession/resumeDraftSession. Shown above everything else on this screen
            since picking it back up matters more than anything below. */}
        {data.draftSession && (() => {
          const draftType = data.workoutTypes.find(t => t.id === data.draftSession!.workoutTypeId);
          const elapsedMin = Math.max(0, Math.round((Date.now() - data.draftSession.startTime) / 60000));
          return (
            <div className="bg-primary/10 border border-primary/30 rounded-xl p-4 mb-4">
              <p className="text-sm font-semibold text-foreground mb-1">
                ⏱️ Séance en cours — {draftType?.name ?? 'séance'}
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                Commencée il y a {elapsedMin < 1 ? 'moins d\'1 min' : `${elapsedMin} min`}, jamais enregistrée.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={resumeDraftSession}
                  className="flex-1 btn-neon font-medium py-2 rounded-lg text-xs touch-target"
                >
                  Reprendre
                </button>
                <button
                  onClick={discardDraftSession}
                  className="bg-secondary text-secondary-foreground font-medium py-2 px-3 rounded-lg text-xs touch-target"
                >
                  Abandonner
                </button>
              </div>
            </div>
          );
        })()}

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

        {/* Bodyweight-update reminder — ~monthly, non-blocking, only ever shown here (never
            mid-set) since this screen is the one moment where she isn't already mid-session.
            See src/lib/bodyweightReminder.ts for the trigger/snooze logic. */}
        {showBodyweightReminder && (
          <div className="bg-secondary/60 border border-border rounded-xl p-4 mb-4">
            <p className="text-sm font-semibold text-foreground mb-3">⚖️ Poids à jour ?</p>
            <div className="flex gap-2">
              <input
                type="number"
                inputMode="decimal"
                value={bodyweightDraft}
                onChange={e => setBodyweightDraft(e.target.value)}
                placeholder={data.bodyWeightLogs?.length ? `${[...data.bodyWeightLogs].sort((a, b) => b.date.localeCompare(a.date))[0].weight} kg` : 'kg'}
                className="w-20 bg-input border border-border rounded-lg px-2 py-2 text-sm text-foreground text-center"
              />
              <button
                onClick={() => {
                  const weight = parseFloat(bodyweightDraft);
                  if (!weight || weight <= 0) return;
                  const newLog = { date: new Date().toISOString().split('T')[0], weight };
                  onUpdateData({ bodyWeightLogs: [...(data.bodyWeightLogs || []), newLog] });
                  setBodyweightDraft('');
                }}
                disabled={!bodyweightDraft}
                className="flex-1 btn-neon font-medium py-2 rounded-lg text-xs touch-target disabled:opacity-40"
              >
                Enregistrer
              </button>
              <button
                onClick={() => onUpdateData({ bodyweightReminderSnoozedUntil: buildBodyweightReminderSnoozePatch().bodyweightReminderSnoozedUntil })}
                className="bg-secondary text-secondary-foreground font-medium py-2 px-3 rounded-lg text-xs touch-target"
              >
                Plus tard
              </button>
            </div>
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
                title="On te reproposera un deload la semaine prochaine"
              >
                Plus tard
              </button>
              <button
                onClick={() => onUpdateData({ deload: buildDeloadSkipPatch(data) })}
                className="flex-1 bg-secondary text-secondary-foreground font-medium py-2 rounded-lg text-xs touch-target"
                title="Tu continues normalement, sans réduire charges/séries"
              >
                Pas besoin
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
        {fiveThreeOneExercises.map(({ type, exercise, method }) => {
          // Same live "effective week" rule as startWorkout — a deload pending for this
          // exercise's workout type previews as week 4 without ever touching method.currentWeek.
          const effectiveWeek = (method.currentWeek !== 4 && pendingDeloadIds?.includes(type.id)) ? 4 : method.currentWeek;
          const weekSets = getWeekSets(method.trainingMax, effectiveWeek);
          const weekLabel = getWeekLabel(effectiveWeek);
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
            const isPlannedToday = plannedTodayTypeId === type.id;
            return (
            <div
              key={type.id}
              className={`glass-card p-4 ${isDeloadPending ? 'border-warning/40 bg-warning/5' : isPlannedToday ? 'border-2' : ''}`}
              style={isPlannedToday && !isDeloadPending ? { borderColor: `hsl(${type.color})` } : undefined}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `hsl(${type.color})` }} />
                <span className="text-foreground font-semibold flex-1">{type.name}</span>
                {isPlannedToday && (
                  <span
                    className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ color: `hsl(${type.color})`, backgroundColor: `hsl(${type.color} / 0.1)` }}
                  >
                    Prévue aujourd'hui
                  </span>
                )}
                {isDeloadPending && (
                  <span className="text-[10px] font-medium text-warning bg-warning/10 px-2 py-0.5 rounded-full">Deload</span>
                )}
                {type.exercises.some(e => e.method?.type === '531') && (
                  <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">5/3/1</span>
                )}
                {/* --accent-purple text at its own lightness (66%) on a 10%-tint of itself
                    lands at 4.49:1, just under the 4.5:1 AA floor — lightened to 72% here
                    (~5.9:1), same fix already applied in SetupWizard.tsx. */}
                {type.exercises.some(e => e.method?.type === 'cluster') && (
                  <span className="text-[10px] font-medium text-[hsl(262_83%_72%)] bg-accent-purple/10 px-2 py-0.5 rounded-full">Cluster</span>
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
                    <span className="text-sm font-bold text-foreground">{formatCardioDistance(comparison.distance.current, cardioActivityType)}</span>
                    {comparison.distance.changePercent !== null && (
                      <span className={`text-[10px] font-semibold ${comparison.distance.changePercent >= 0 ? 'text-success' : 'text-warning'}`}>
                        {comparison.distance.changePercent >= 0 ? '▲' : '▼'} {Math.abs(Math.round(comparison.distance.changePercent))}%
                      </span>
                    )}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {comparison.distance.last !== null && `Dernière : ${formatCardioDistance(comparison.distance.last, cardioActivityType)}`}
                  {comparison.distance.last !== null && comparison.distance.average !== null && ' · '}
                  {comparison.distance.average !== null && `Moyenne : ${formatCardioDistance(comparison.distance.average, cardioActivityType)}`}
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
    .filter(s => !s.isWarmup && !fiveThreeOneExerciseIds.has(s.exerciseId) && !clusterExerciseIds.has(s.exerciseId) && !emomExerciseIds.has(s.exerciseId));
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
    series: { aIdx: number; aDropIdxs: number[]; bIdx: number; bDropIdxs: number[] }[];
  };
  const blocks: (SingleBlock | SupersetBlock)[] = [];
  const seenSingle = new Set<string>();
  const seenSuperset = new Set<string>();
  regularSets.forEach(s => {
    if (s.supersetGroupId) {
      if (seenSuperset.has(s.supersetGroupId)) return;
      seenSuperset.add(s.supersetGroupId);
      // Order-preserving (globalIdx ascending, matching `sets`) so each anchor's own drop
      // cascade — inserted immediately after it, same convention as the standalone
      // exercise cascade and addDropSet — can be picked up by scanning forward from it.
      const groupEntries = regularSets.filter(r => r.supersetGroupId === s.supersetGroupId).sort((a, b) => a.globalIdx - b.globalIdx);
      const aAnchors = groupEntries.filter(r => r.supersetRole === 'A' && !r.dropSetStage);
      const bAnchors = groupEntries.filter(r => r.supersetRole === 'B' && !r.dropSetStage);
      const first = aAnchors[0] || groupEntries[0];
      const secondSample = bAnchors[0];
      const dropsAfter = (anchorGlobalIdx: number, role: 'A' | 'B'): number[] => {
        const pos = groupEntries.findIndex(r => r.globalIdx === anchorGlobalIdx);
        const drops: number[] = [];
        for (let i = pos + 1; i < groupEntries.length; i++) {
          if (groupEntries[i].supersetRole === role && groupEntries[i].dropSetStage) drops.push(groupEntries[i].globalIdx);
          else break;
        }
        return drops;
      };
      const series = aAnchors.map((a, i) => ({
        aIdx: a.globalIdx,
        aDropIdxs: dropsAfter(a.globalIdx, 'A'),
        bIdx: bAnchors[i]?.globalIdx ?? -1,
        bDropIdxs: bAnchors[i] ? dropsAfter(bAnchors[i].globalIdx, 'B') : [],
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
    setTagOverrides({});
    setRenamingExerciseId(null);
    setDropSetPickerFor(null);
    setExerciseDifficulty({});
    onUpdateData({ draftSession: undefined });
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
        <SessionElapsedBadge startTime={startTime} />
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
          .filter(s => s.exerciseId === ex.id && !s.isWarmup);
        if (liveSets.length === 0) return null;
        const week = selectedWeeks[ex.id] ?? method.currentWeek;
        const weekSetsForDisplay = getWeekSets(method.trainingMax, week);
        const isAmrap = (setIdx: number) => weekSetsForDisplay[setIdx]?.reps?.includes('+');
        const isTestMaxActive = liveSets.some(s => sets[s.globalIdx].isTestMax);

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
                {renderTagsButton(ex)}
                {renderReminderNoteButton(ex)}
                {renderDifficultyButton(ex)}
              </div>
            </div>
            {renderTagsPanel(ex)}
            {renderReminderNoteBanner(ex)}
            {renderLowRpeBanner(ex)}
            {!isTestMaxActive && renderWarmupSection(ex)}

            {renderTestMaxTrigger(ex, isTestMaxActive)}

            {isTestMaxActive ? renderTestMaxRamp(ex, liveSets) : (
              <>
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
                    const realE1rm = (actualWeight > 0 || isBodyweightOptionalExercise(ex.name)) && actualReps > 0
                      ? computeBodyweightAdjustedE1RM({ weight: actualWeight, reps: actualReps, exerciseName: ex.name }, liveBodyWeight)
                      : 0;

                    return (
                      <div
                        key={globalIdx}
                        className={`flex items-center gap-2 rounded-xl px-3 py-2.5 transition-all ${
                          sets[globalIdx].completed ? 'bg-success/10 border border-success/25' : 'bg-secondary/50'
                        }`}
                      >
                        <span className="text-xs text-muted-foreground w-6">S{localIdx + 1}</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={weightDraft[globalIdx] ?? sets[globalIdx].weight}
                          onChange={e => updateSet(globalIdx, 'weight', e.target.value)}
                          onFocus={e => onWeightFocus(e, globalIdx)}
                          onBlur={e => finalizeSimpleWeightOnBlur(globalIdx, e.target.value)}
                          className="w-14 bg-transparent text-foreground text-sm text-center outline-none font-mono"
                          placeholder="kg"
                          aria-label={`Poids série ${localIdx + 1}, ${ex.name} (kg)`}
                        />
                        <span className="text-muted-foreground text-xs">×</span>
                        {amrap ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={repsDraft[globalIdx] ?? (amrapReps[globalIdx] !== undefined ? (amrapReps[globalIdx] || '') : (sets[globalIdx].reps || ''))}
                              onChange={e => {
                                // Same repsDraft pattern as updateSet: without it, a plain
                                // backspace-to-empty gets reverted on the next re-render
                                // (the guard below skips committing an empty value).
                                setRepsDraft(prev => ({ ...prev, [globalIdx]: e.target.value }));
                                if (e.target.value === '') return;
                                setAmrapReps(prev => ({ ...prev, [globalIdx]: parseInt(e.target.value, 10) || 0 }));
                              }}
                              onFocus={e => e.target.select()}
                              onBlur={e => {
                                setRepsDraft(prev => {
                                  if (!(globalIdx in prev)) return prev;
                                  const next = { ...prev };
                                  delete next[globalIdx];
                                  return next;
                                });
                                if (e.target.value.trim() !== '') return;
                                setAmrapReps(prev => ({ ...prev, [globalIdx]: 0 }));
                              }}
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
              </>
            )}
          </div>
        );
      })}

      {/* Cluster Block(s) in session — rest timers (manual, or auto via the per-block toggle) */}
      {selectedType && selectedType.exercises.filter(ex => getEffectiveMethod(ex)?.type === 'cluster').map(ex => {
        const method = getEffectiveMethod(ex) as ClusterMethod;
        const { numSeries, miniSeries, restMiniSeries, restSeries } = getClusterConfig(method);
        const liveSets = sets
          .map((s, i) => ({ ...s, globalIdx: i }))
          .filter(s => s.exerciseId === ex.id && !s.isWarmup);
        if (liveSets.length === 0) return null;
        const miniPerSeries = miniSeries.length;
        const isTestMaxActive = liveSets.some(s => sets[s.globalIdx].isTestMax);

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
                {renderTagsButton(ex)}
                {renderReminderNoteButton(ex)}
                {renderDifficultyButton(ex)}
              </div>
            </div>
            {renderTagsPanel(ex)}
            {renderReminderNoteBanner(ex)}
            {renderLowRpeBanner(ex)}
            {!isTestMaxActive && renderWarmupSection(ex)}
            {renderTestMaxTrigger(ex, isTestMaxActive)}
            {isTestMaxActive ? renderTestMaxRamp(ex, liveSets) : (
              <>
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
              </>
            )}
          </div>
        );
      })}

      {/* EMOM Block(s) in session — continuous auto-beeping countdown, one card per exercise using the method */}
      {selectedType && selectedType.exercises.filter(ex => getEffectiveMethod(ex)?.type === 'emom').map(ex => {
        const method = getEffectiveMethod(ex) as EMOMMethod;
        const { durationMinutes } = getEmomConfig(method);
        const liveSets = sets
          .map((s, i) => ({ ...s, globalIdx: i }))
          .filter(s => s.exerciseId === ex.id && !s.isWarmup);
        if (liveSets.length === 0) return null;
        const isTestMaxActive = liveSets.some(s => sets[s.globalIdx].isTestMax);

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
                {renderTagsButton(ex)}
                {renderReminderNoteButton(ex)}
                {renderDifficultyButton(ex)}
              </div>
            </div>
            {renderTagsPanel(ex)}
            {renderReminderNoteBanner(ex)}
            {renderLowRpeBanner(ex)}
            {!isTestMaxActive && renderWarmupSection(ex)}
            {renderTestMaxTrigger(ex, isTestMaxActive)}
            {isTestMaxActive ? renderTestMaxRamp(ex, liveSets) : (
              <>
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
              </>
            )}
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
                ? b.series.flatMap(s => [s.aIdx, ...s.aDropIdxs, s.bIdx, ...s.bDropIdxs])
                : b.entries.map(e => e.globalIdx);
              idxsByKey.set(key, idxs);
            });
            const newRegular = newOrder.flatMap(item => (idxsByKey.get(item.key) || []).map(i => sets[i]));
            const pinnedSets = pinnedIdxs.map(i => sets[i]);
            setSets([...pinnedSets, ...newRegular]);
          };
          // Merges two currently-standalone exercises into one superset for the rest of
          // this session — existing sets on each side keep their own logged weight/reps
          // (just gain a shared supersetGroupId/role), the shorter side is padded up to
          // match the longer one's round count by repeating its own last round, same
          // convention addSupersetRound already uses when adding a fresh round.
          const linkExercisesIntoSuperset = (aId: string, bId: string) => {
            const groupId = `ss-${Date.now()}`;
            setSets(prev => {
              const aAnchors = prev.filter(s => s.exerciseId === aId && !s.dropSetStage);
              const bAnchors = prev.filter(s => s.exerciseId === bId && !s.dropSetStage);
              const roundCount = Math.max(aAnchors.length, bAnchors.length);
              const tagged = prev.map(s => {
                if (s.exerciseId === aId) return { ...s, supersetGroupId: groupId, supersetRole: 'A' as const };
                if (s.exerciseId === bId) return { ...s, supersetGroupId: groupId, supersetRole: 'B' as const };
                return s;
              });
              const padded = [...tagged];
              const addRounds = (exerciseId: string, role: 'A' | 'B', existing: SetLog[]) => {
                if (existing.length === 0) return;
                const name = existing[0].exerciseName;
                for (let i = existing.length; i < roundCount; i++) {
                  const lastOfThis = [...padded].reverse().find(s => s.exerciseId === exerciseId && !s.dropSetStage);
                  padded.push({
                    exerciseId, exerciseName: name, setNumber: i + 1,
                    reps: lastOfThis?.reps ?? 10, weight: lastOfThis?.weight ?? 0,
                    completed: false, supersetGroupId: groupId, supersetRole: role,
                    equipment: lastOfThis?.equipment, unilateral: lastOfThis?.unilateral,
                  });
                }
              };
              addRounds(aId, 'A', aAnchors);
              addRounds(bId, 'B', bAnchors);
              return padded;
            });
            setLinkPickerFor(null);
          };
          return (
            <>
            <SortableList items={sortableBlocks} onReorder={reorderBlocks}>
              {({ block }) => {

          if (block.kind === 'superset') {
            // A round's Check completes BOTH sides together, each side along with its own
            // drop-set cascade (if any) — same "anchor + its drops validate as one group"
            // convention as the standalone exercise cascade (toggleCascade).
            const toggleSeries = (serie: SupersetBlock['series'][number]) => {
              const allIdxs = [serie.aIdx, ...serie.aDropIdxs, serie.bIdx, ...serie.bDropIdxs];
              const allDone = allIdxs.every(i => sets[i].completed);
              const updated = [...sets];
              allIdxs.forEach(i => { updated[i] = { ...updated[i], completed: !allDone }; });
              setSets(updated);
            };
            // One reminder note per superset (not one per exercise inside it) — attached
            // to the A exercise, same "A is canonical for the pair" convention as sets
            // count above. Absent for a temp/ad-hoc exercise with no template to attach to.
            const templateAEx = selectedType?.exercises.find(e => e.id === block.aId);
            const templateBEx = selectedType?.exercises.find(e => e.id === block.bId);
            return (
              <div key={block.groupId} className="glass-card p-4 border border-primary/40 bg-primary/5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1">
                    <DragHandle />
                    <span className="text-[10px] font-bold text-primary tracking-wider">SUPERSET</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/* Same on/off toggle as a plain exercise's "Drop set" button — reveals
                        the "+ Drop set" trigger under A and B in every round below, instead
                        of that trigger being shown unconditionally on every round by default. */}
                    <button
                      onClick={() => setDropSetPickerFor(dropSetPickerFor === block.groupId ? null : block.groupId)}
                      className={`min-h-9 flex items-center gap-1 px-2 shrink-0 rounded-lg text-[11px] font-medium transition-colors ${
                        dropSetPickerFor === block.groupId ? 'bg-warning/20 text-warning' : 'text-warning/70 active:text-warning'
                      }`}
                      aria-label="Activer le mode drop set pour ce superset"
                      aria-pressed={dropSetPickerFor === block.groupId}
                      title="Drop set"
                    >
                      <TrendingDown size={14} />
                    </button>
                    <span className="text-[10px] text-muted-foreground">{block.series.length} séries</span>
                    {templateAEx && renderReminderNoteButton(templateAEx)}
                    {templateAEx && renderDifficultyButton(templateAEx)}
                  </div>
                </div>
                {templateAEx && renderReminderNoteBanner(templateAEx)}
                {templateAEx && renderLowRpeBanner(templateAEx)}

                <div className="flex items-center gap-1 text-xs text-foreground font-semibold mb-3 flex-wrap">
                  <span className="text-primary">A</span>
                  {renamingExerciseId === block.aId ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => { updateExerciseName(block.aId, renameValue.trim() || block.aName); setRenamingExerciseId(null); }}
                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      className="bg-transparent text-foreground font-semibold outline-none border-b border-primary/40 min-w-0 flex-1"
                      placeholder="Nom de l'exercice"
                    />
                  ) : (
                    <button
                      onClick={() => { setRenamingExerciseId(block.aId); setRenameValue(block.aName); }}
                      className="min-h-8 flex items-center gap-1 min-w-0 active:text-primary transition-colors"
                      title="Renommer pour cette séance"
                    >
                      <span className="truncate">{block.aName}</span>
                      <Pencil size={10} className="text-muted-foreground shrink-0" />
                    </button>
                  )}
                  <span className="text-muted-foreground">+</span>
                  <span className="text-primary">B</span>
                  {renamingExerciseId === block.bId ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => { updateExerciseName(block.bId, renameValue.trim() || block.bName); setRenamingExerciseId(null); }}
                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      className="bg-transparent text-foreground font-semibold outline-none border-b border-primary/40 min-w-0 flex-1"
                      placeholder="Nom de l'exercice"
                    />
                  ) : (
                    <button
                      onClick={() => { setRenamingExerciseId(block.bId); setRenameValue(block.bName); }}
                      className="min-h-8 flex items-center gap-1 min-w-0 active:text-primary transition-colors"
                      title="Renommer pour cette séance"
                    >
                      <span className="truncate">{block.bName}</span>
                      <Pencil size={10} className="text-muted-foreground shrink-0" />
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  {block.series.map((serie, localIdx) => {
                    const allIdxs = [serie.aIdx, ...serie.aDropIdxs, serie.bIdx, ...serie.bDropIdxs];
                    const allDone = allIdxs.every(i => sets[i].completed);
                    return (
                      <div
                        key={localIdx}
                        className={`rounded-xl p-2.5 border transition-all ${
                          allDone ? 'bg-success/15 border-success/40' : 'bg-secondary/40 border-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] font-semibold text-muted-foreground">Série {localIdx + 1}</span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => removeSupersetRound(serie)}
                              className="touch-target inline-flex items-center justify-center text-muted-foreground active:text-destructive"
                              aria-label={`Supprimer la série ${localIdx + 1} (${block.aName} + ${block.bName})`}
                            >
                              <Trash2 size={14} />
                            </button>
                            <button
                              onClick={() => toggleSeries(serie)}
                              className={`touch-target rounded-lg p-1.5 transition-colors ${
                                allDone ? 'text-success glow-success' : 'text-muted-foreground active:text-success'
                              }`}
                              aria-label={allDone ? `Série ${localIdx + 1} validée` : `Valider la série ${localIdx + 1}`}
                              aria-pressed={allDone}
                            >
                              <Check size={18} />
                            </button>
                          </div>
                        </div>
                        {[
                          { role: 'A' as const, name: block.aName, idx: serie.aIdx, dropIdxs: serie.aDropIdxs, templateEx: templateAEx },
                          { role: 'B' as const, name: block.bName, idx: serie.bIdx, dropIdxs: serie.bDropIdxs, templateEx: templateBEx },
                        ].map(row => (
                          <div key={row.role}>
                            <div className="flex items-center gap-2 py-1">
                              <span className="text-[10px] font-bold text-primary w-4">{row.role}</span>
                              <button
                                onClick={() => { setHistoryExercise(row.name); setMode('history'); }}
                                className="min-h-11 flex items-center gap-1 flex-1 min-w-0 group"
                              >
                                <span className="text-xs text-foreground/80 truncate group-active:text-primary transition-colors">{row.name}</span>
                                <History size={11} className="text-muted-foreground/70 group-active:text-primary shrink-0" />
                              </button>
                              {/* Fixed-width slot reserved whether or not this row actually shows the
                                  pdc toggle — A and B rarely share the same exercise, so one being
                                  bodyweight-optional and the other not used to shift everything after
                                  it (weight/reps/équipement) out of alignment between the two rows. */}
                              <div className="w-9 shrink-0 flex items-center gap-1">
                                {isBodyweightOptionalExercise(row.name) && (
                                  <>
                                    <span className="text-[9px] text-muted-foreground shrink-0">pdc</span>
                                    <button
                                      type="button"
                                      onClick={() => toggleWeightSign(row.idx)}
                                      className="w-5 h-5 shrink-0 rounded-md bg-background/60 text-muted-foreground text-[10px] leading-none font-bold"
                                      aria-label={sets[row.idx].weight < 0 ? 'Assisté (élastique/machine) — repasser en lesté' : 'Lesté — passer en assisté (élastique/machine)'}
                                      title={sets[row.idx].weight < 0 ? 'Assisté' : 'Lesté'}
                                    >
                                      {sets[row.idx].weight < 0 ? '−' : '+'}
                                    </button>
                                  </>
                                )}
                              </div>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={weightDraft[row.idx] ?? sets[row.idx].weight}
                                onChange={e => updateSet(row.idx, 'weight', e.target.value)}
                                onFocus={e => onWeightFocus(e, row.idx)}
                                onBlur={e => finalizeWeightOnBlur(row.idx, e.target.value)}
                                className="w-14 bg-background/60 rounded-md text-foreground text-sm text-center outline-none font-mono py-1"
                                placeholder="kg"
                                aria-label={`Poids série ${localIdx + 1}, ${row.name} (kg)`}
                              />
                              <span className="text-muted-foreground text-xs">×</span>
                              <input
                                type="number"
                                value={repsDraft[row.idx] ?? (sets[row.idx].reps || '')}
                                onChange={e => updateSet(row.idx, 'reps', e.target.value)}
                                onFocus={e => e.target.select()}
                                onBlur={e => finalizeRepsOnBlur(row.idx, e.target.value)}
                                className={`w-12 bg-background/60 rounded-md text-sm text-center outline-none font-mono py-1 ${
                                  sets[row.idx].amrap ? 'text-accent-purple placeholder:text-accent-purple/70' : 'text-foreground'
                                }`}
                                aria-label={`Répétitions série ${localIdx + 1}, ${row.name}`}
                                placeholder={sets[row.idx].amrap ? 'Max' : 'reps'}
                              />
                              {row.templateEx && renderTagsButton(row.templateEx)}
                            </div>
                            {row.templateEx && renderTagsPanel(row.templateEx)}
                            {row.dropIdxs.map((dropIdx, dropI) => (
                              <div key={dropIdx} className="flex items-center gap-2 py-1 ml-4">
                                <span className="text-[10px] font-bold text-warning w-4">Δ</span>
                                <span className="flex-1 min-w-0 text-[11px] text-warning font-medium truncate">Drop {dropI + 1}</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={weightDraft[dropIdx] ?? sets[dropIdx].weight}
                                  onChange={e => updateSet(dropIdx, 'weight', e.target.value)}
                                  onFocus={e => onWeightFocus(e, dropIdx)}
                                  onBlur={e => finalizeSimpleWeightOnBlur(dropIdx, e.target.value)}
                                  className="w-14 bg-background/60 rounded-md text-foreground text-sm text-center outline-none font-mono py-1"
                                  placeholder="kg"
                                  aria-label={`Poids Drop ${dropI + 1} ${row.role}, ${row.name} (kg)`}
                                />
                                <span className="text-muted-foreground text-xs">×</span>
                                <input
                                  type="number"
                                  value={repsDraft[dropIdx] ?? (sets[dropIdx].reps || '')}
                                  onChange={e => updateSet(dropIdx, 'reps', e.target.value)}
                                  onFocus={e => e.target.select()}
                                  onBlur={e => finalizeRepsOnBlur(dropIdx, e.target.value)}
                                  className="w-12 bg-background/60 rounded-md text-sm text-center outline-none font-mono py-1 text-foreground"
                                  aria-label={`Répétitions Drop ${dropI + 1} ${row.role}, ${row.name}`}
                                />
                                <button
                                  onClick={() => removeSet(dropIdx)}
                                  className="touch-target inline-flex items-center justify-center text-muted-foreground active:text-destructive"
                                  aria-label={`Supprimer Drop ${dropI + 1} ${row.role}`}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            ))}
                            {dropSetPickerFor === block.groupId && (
                              <button
                                onClick={() => addDropSet(row.role === 'A' ? block.aId : block.bId, row.name, row.idx)}
                                className="w-full min-h-8 flex items-center justify-center gap-1 text-warning text-[10px] font-medium ml-4"
                              >
                                <TrendingDown size={10} /> + Drop set
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={() => addSupersetRound(block)}
                  className="w-full min-h-11 flex items-center justify-center gap-1 text-primary text-xs font-medium mt-3"
                >
                  <Plus size={12} /> Ajouter une série
                </button>
              </div>
            );
          }

          const { exerciseId, name, entries: exerciseSets } = block;
          const isTestMaxActive = exerciseSets.some(s => sets[s.globalIdx].isTestMax);
          const lastPerf = getLastPerformance(name);
          const absRecord = getAbsoluteRecord(name);
          const isTemp = exerciseId.startsWith('temp-');
          const methodEx = methodConfigMap.get(exerciseId);
          // Reminder notes persist on the WorkoutType template — a temp exercise (added
          // ad hoc for this session only, never saved to the template) has nothing to
          // attach a note to, so it just doesn't get the button.
          const templateEx = !isTemp ? selectedType?.exercises.find(e => e.id === exerciseId) : undefined;
          // RPE has no such constraint — it's local session state keyed by exerciseId
          // (exerciseDifficulty), not persisted on the template — so a temp exercise gets
          // a lightweight stand-in Exercise just to satisfy renderDifficultyButton's shape.
          const rpeEx: Exercise = templateEx ?? { id: exerciseId, name, sets: 0, reps: 0 };
          // Other standalone exercises in this session she could link this one with — the
          // "Lier" button/list replacing the drag-to-link gesture (found unintuitive).
          // 531/cluster/emom exercises are pinned/rendered separately and never appear in
          // `blocks`, so they're naturally excluded here too, same as before.
          const linkTargets = blocks.filter((b): b is SingleBlock => b.kind === 'single' && b.exerciseId !== exerciseId);
          // "Série N" numbers only the plain rows, skipping over any interleaved drop-set
          // rows — a drop set inserted after Série 2 must not bump the plain Série 3 that
          // follows it to "Série 4". Shared between the row list and the picker chips
          // below so both always agree.
          const seriesNumberByGlobalIdx = new Map<number, number>();
          // Every drop-set row (and its own anchor) maps back to the anchor's globalIdx —
          // needed so "+ Drop set", rendered under the *last* stage of a cascade, still
          // cascades off the original reference set (P0/R0), never off a prior drop stage.
          const anchorGlobalIdxByGlobalIdx = new Map<number, number>();
          // A series + its drop(s) is validated as ONE unit (a bit like a superset pairs
          // A+B under one checkmark) — this maps an anchor's globalIdx to every globalIdx
          // in its own cascade (itself included), so toggling the anchor's Check marks the
          // whole group done/undone together instead of each stage needing its own tap.
          const cascadeGlobalIdxsByAnchor = new Map<number, number[]>();
          {
            let seriesCounter = 0;
            let currentAnchor = -1;
            exerciseSets.forEach(e => {
              if (!sets[e.globalIdx].dropSetStage) {
                seriesNumberByGlobalIdx.set(e.globalIdx, ++seriesCounter);
                currentAnchor = e.globalIdx;
                cascadeGlobalIdxsByAnchor.set(currentAnchor, [currentAnchor]);
              } else if (currentAnchor !== -1) {
                cascadeGlobalIdxsByAnchor.get(currentAnchor)!.push(e.globalIdx);
              }
              anchorGlobalIdxByGlobalIdx.set(e.globalIdx, currentAnchor);
            });
          }
          const toggleCascade = (idxs: number[]) => {
            const allDone = idxs.every(i => sets[i].completed);
            setSets(prev => {
              const updated = [...prev];
              idxs.forEach(i => { updated[i] = { ...updated[i], completed: !allDone }; });
              return updated;
            });
          };

          return (
            <div key={exerciseId} className="glass-card p-4">
              <div className="flex items-center gap-1.5 mb-1">
                <DragHandle />

                {renamingExerciseId === exerciseId ? (
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
                {linkTargets.length > 0 && (
                  <button
                    onClick={() => setLinkPickerFor(linkPickerFor === exerciseId ? null : exerciseId)}
                    className={`min-h-9 flex items-center gap-1 px-2 shrink-0 rounded-lg text-[11px] font-medium transition-colors ${
                      linkPickerFor === exerciseId ? 'bg-primary/20 text-primary' : 'text-primary/70 active:text-primary'
                    }`}
                    aria-label="Lier cet exercice à un autre en superset"
                    aria-pressed={linkPickerFor === exerciseId}
                    title="Lier en superset"
                  >
                    <Link2 size={14} /> Lier
                  </button>
                )}
                <div className="flex items-center gap-1.5 ml-auto">
                  {/* Équipement/unilatéral and échauffement are session-local state keyed
                      by exerciseId (tagOverrides/sets), same as RPE above — no template
                      needed, so a temp exercise gets them too via the rpeEx stand-in.
                      Note stays template-only: its whole point is resurfacing next time
                      this exercise is trained, which a temp (this-session-only) exercise
                      has no "next time" for. */}
                  {renderTagsButton(rpeEx)}
                  {templateEx && renderReminderNoteButton(templateEx)}
                  {renderDifficultyButton(rpeEx)}
                </div>
              </div>

              {linkPickerFor === exerciseId && (
                <div className="mb-3 p-2 rounded-lg bg-primary/5 border border-primary/20 space-y-0.5">
                  <p className="text-[10px] text-muted-foreground px-1.5 mb-1">Lier avec :</p>
                  {linkTargets.map(b => (
                    <button
                      key={b.exerciseId}
                      onClick={() => linkExercisesIntoSuperset(exerciseId, b.exerciseId)}
                      className="w-full min-h-9 flex items-center px-1.5 rounded-lg text-xs text-foreground text-left active:bg-primary/10 transition-colors"
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              )}

              {renderTagsPanel(rpeEx)}

              {templateEx && renderReminderNoteBanner(templateEx)}
              {templateEx && renderLowRpeBanner(templateEx)}
              {!isTestMaxActive && renderWarmupSection(rpeEx)}
              {templateEx && renderTestMaxTrigger(templateEx, isTestMaxActive)}

              {!isTestMaxActive && methodEx && <MethodPickerRow active="none" onSelect={opt => applyMethodOverride(methodEx, opt)} />}

              {isTestMaxActive && templateEx ? renderTestMaxRamp(templateEx, exerciseSets) : (
              <>
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
                {(() => {
                  // Groups each anchor series with its own drop-set cascade (if any) into
                  // one array per group — exerciseSets is already ordered so a drop always
                  // immediately follows its anchor (same convention as addDropSet). Purely a
                  // rendering grouping: doesn't touch which rows are individually draggable
                  // (none are, at the set level — only whole exercises/supersets are, via
                  // the SortableList a few levels up), so this can't affect reordering.
                  const cascadeGroups: (typeof exerciseSets)[] = [];
                  exerciseSets.forEach(s => {
                    if (!sets[s.globalIdx].dropSetStage) cascadeGroups.push([s]);
                    else cascadeGroups[cascadeGroups.length - 1]?.push(s);
                  });
                  return cascadeGroups.map(group => {
                    const anchorIdx = group[0].globalIdx;
                    const groupIdxs = cascadeGlobalIdxsByAnchor.get(anchorIdx) ?? [anchorIdx];
                    const groupDone = groupIdxs.every(i => sets[i].completed);
                    return (
                      <div
                        key={anchorIdx}
                        className={`rounded-xl p-2.5 border transition-all ${
                          groupDone ? 'bg-success/10 border-success/25' : 'bg-secondary/40 border-transparent'
                        }`}
                      >
                        {group.map((s, gi) => {
                          const globalIdx = s.globalIdx;
                          const stage = sets[globalIdx].dropSetStage;
                          const rowLabel = stage ? `Drop ${stage}` : `Série ${seriesNumberByGlobalIdx.get(globalIdx)}`;
                          return (
                            <div key={globalIdx} className={`flex items-center gap-1 py-1 ${stage ? 'ml-4' : ''} ${gi > 0 ? 'mt-1' : ''}`}>
                              <span className={`text-xs shrink-0 whitespace-nowrap ${stage ? 'text-warning font-medium' : 'text-muted-foreground'}`}>
                                {rowLabel}
                              </span>
                              {isBodyweightOptionalExercise(name) && (
                                <button
                                  type="button"
                                  onClick={() => toggleWeightSign(globalIdx)}
                                  className="w-5 h-5 shrink-0 rounded-md bg-background/60 text-muted-foreground text-[10px] leading-none font-bold"
                                  aria-label={sets[globalIdx].weight < 0 ? 'Poids du corps, assisté (élastique/machine) — repasser en lesté' : 'Poids du corps, lesté — passer en assisté (élastique/machine)'}
                                  title={sets[globalIdx].weight < 0 ? 'Assisté' : 'Lesté'}
                                >
                                  {sets[globalIdx].weight < 0 ? '−' : '+'}
                                </button>
                              )}
                              <input
                                type="text"
                                inputMode="decimal"
                                value={weightDraft[globalIdx] ?? sets[globalIdx].weight}
                                onChange={e => updateSet(globalIdx, 'weight', e.target.value)}
                                onFocus={e => onWeightFocus(e, globalIdx)}
                                onBlur={e => finalizeWeightOnBlur(globalIdx, e.target.value)}
                                className="w-12 min-w-0 bg-background/60 rounded-md text-foreground text-sm text-center outline-none font-mono py-1"
                                placeholder="kg"
                                aria-label={`Poids ${rowLabel}, ${name} (kg)`}
                              />
                              <span className="text-muted-foreground text-[10px] shrink-0 whitespace-nowrap">kg ×</span>
                              <input
                                type="number"
                                value={repsDraft[globalIdx] ?? (sets[globalIdx].reps || '')}
                                onChange={e => updateSet(globalIdx, 'reps', e.target.value)}
                                onFocus={e => e.target.select()}
                                onBlur={e => finalizeRepsOnBlur(globalIdx, e.target.value)}
                                className={`w-9 min-w-0 bg-background/60 rounded-md text-sm text-center outline-none font-mono py-1 ${
                                  sets[globalIdx].amrap ? 'text-accent-purple placeholder:text-accent-purple/70' : 'text-foreground'
                                }`}
                                placeholder={sets[globalIdx].amrap ? 'Max' : 'reps'}
                                aria-label={`Répétitions ${rowLabel}, ${name}`}
                              />
                              {templateEx && isForceFocusExercise(templateEx) && sets[globalIdx].reps === 1 && (
                                <button
                                  onClick={() => setTrueOneRMConfirm({ exerciseId, name, globalIdx, rpeConfirmed: false })}
                                  className="touch-target shrink-0 flex items-center gap-0.5 px-1.5 rounded-lg text-[10px] font-medium text-warning bg-warning/10"
                                  aria-label={`Valider cette série comme vrai 1RM pour ${name}`}
                                  title="1RM testé ?"
                                >
                                  1RM ?
                                </button>
                              )}
                              <button
                                onClick={() => removeSet(globalIdx)}
                                className="touch-target inline-flex items-center justify-center text-muted-foreground active:text-destructive"
                                aria-label={`Supprimer ${rowLabel}`}
                              >
                                <Trash2 size={14} />
                              </button>
                              {/* One Check for the whole group (on the anchor row only) — now
                                  that anchor + drops share a single visual block, a second
                                  (passive, non-interactive) Check echoed on every drop row
                                  read as "two checkmarks, only one of them works." */}
                              {!stage && (
                                <button
                                  onClick={() => toggleCascade(groupIdxs)}
                                  className={`touch-target rounded-lg p-2 ml-auto transition-colors ${
                                    groupDone ? 'text-success glow-success' : 'text-muted-foreground active:text-success'
                                  }`}
                                  aria-label={groupDone ? `${rowLabel}${groupIdxs.length > 1 ? ' et son drop set' : ''} validée` : `Valider ${rowLabel}${groupIdxs.length > 1 ? ' et son drop set' : ''}`}
                                  aria-pressed={groupDone}
                                >
                                  <Check size={18} />
                                </button>
                              )}
                            </div>
                          );
                        })}
                        {dropSetPickerFor === exerciseId && (
                          <button
                            onClick={() => addDropSet(exerciseId, name, anchorIdx)}
                            className="w-full min-h-9 flex items-center justify-center gap-1 text-warning text-[10px] font-medium mt-1"
                          >
                            <TrendingDown size={10} /> + Drop set
                          </button>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
              <button
                onClick={() => addSetToExercise(exerciseId, name)}
                className="min-h-11 flex items-center gap-1 text-primary text-xs font-medium mt-2"
              >
                <Plus size={12} /> Ajouter une série
              </button>
              </>
              )}
            </div>
          );
              }}
            </SortableList>
            </>
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

    {methodSwitchConfirm && (
      <div
        className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 animate-fade-in"
        onClick={() => setMethodSwitchConfirm(null)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="method-switch-title"
          className="glass-card p-6 max-w-sm w-full"
          onClick={e => e.stopPropagation()}
        >
          <h3 id="method-switch-title" className="text-lg font-bold text-foreground mb-2">
            Changer de méthode va effacer le drop set en cours sur cet exercice. Continuer ?
          </h3>
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => setMethodSwitchConfirm(null)}
              className="flex-1 bg-secondary text-secondary-foreground font-medium py-2.5 rounded-xl text-sm touch-target"
            >
              Annuler
            </button>
            <button
              onClick={() => { const c = methodSwitchConfirm; setMethodSwitchConfirm(null); if (c) doApplyMethodOverride(c.ex, c.opt); }}
              className="flex-1 bg-destructive text-destructive-foreground font-medium py-2.5 rounded-xl text-sm touch-target"
            >
              Oui, changer
            </button>
          </div>
        </div>
      </div>
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
            <span>Échec</span>
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

    {trueOneRMConfirm && (
      <div
        className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 animate-fade-in"
        onClick={() => setTrueOneRMConfirm(null)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="true-1rm-title"
          className="glass-card p-6 max-w-sm w-full"
          onClick={e => e.stopPropagation()}
        >
          <h3 id="true-1rm-title" className="text-sm font-bold text-foreground mb-1 flex items-center gap-1.5">
            🏆 Vrai 1RM — {trueOneRMConfirm.name}
          </h3>
          <p className="text-[11px] text-muted-foreground mb-4">
            {sets[trueOneRMConfirm.globalIdx].weight} kg × 1 — à valider uniquement si c'était un vrai maximum.
          </p>
          <label className="flex items-start gap-2 text-sm text-foreground mb-4">
            <input
              type="checkbox"
              checked={trueOneRMConfirm.rpeConfirmed}
              onChange={e => setTrueOneRMConfirm({ ...trueOneRMConfirm, rpeConfirmed: e.target.checked })}
              className="w-4 h-4 mt-0.5 accent-warning shrink-0"
            />
            RPE 9-10 sur cette série (proche de l'échec)
          </label>
          <div className="flex gap-3">
            <button
              onClick={() => setTrueOneRMConfirm(null)}
              className="flex-1 bg-secondary text-secondary-foreground font-medium py-2.5 rounded-xl text-sm touch-target"
            >
              Annuler
            </button>
            <button
              disabled={!trueOneRMConfirm.rpeConfirmed}
              onClick={() => {
                confirmTrueOneRM(trueOneRMConfirm.exerciseId, trueOneRMConfirm.name, sets[trueOneRMConfirm.globalIdx].weight);
                setTrueOneRMConfirm(null);
              }}
              className="flex-1 btn-neon font-medium py-2.5 rounded-xl text-sm touch-target disabled:opacity-40"
            >
              Confirmer
            </button>
          </div>
        </div>
      </div>
    )}

    {tmUpdatePrompt && (
      <div
        className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 animate-fade-in"
        onClick={() => setTmUpdatePrompt(null)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="tm-update-title"
          className="glass-card p-6 max-w-sm w-full"
          onClick={e => e.stopPropagation()}
        >
          <h3 id="tm-update-title" className="text-sm font-bold text-foreground mb-2">Mettre à jour le TM ?</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Ce vrai 1RM implique un Training Max de <span className="text-foreground font-medium">{tmUpdatePrompt.newTM} kg</span>, différent de celui enregistré (<span className="text-foreground font-medium">{tmUpdatePrompt.currentTM} kg</span>).
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setTmUpdatePrompt(null)}
              className="flex-1 bg-secondary text-secondary-foreground font-medium py-2.5 rounded-xl text-sm touch-target"
            >
              Non
            </button>
            <button
              onClick={applyTmUpdate}
              className="flex-1 btn-neon font-medium py-2.5 rounded-xl text-sm touch-target"
            >
              Mettre à jour
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default WorkoutTab;
