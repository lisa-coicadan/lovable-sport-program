import { useEffect, useMemo, useState } from 'react';
import { AppData, ExerciseEquipment, EQUIPMENT_LABELS, calculate1RM } from '@/lib/types';
import { splitEquipmentVariant, isBodyweightOptionalExercise, resolveSetVariant, formatWeightDisplay, formatWeightDisplayFor } from '@/lib/exerciseNormalize';
import { STANDARD_MOVEMENTS, StandardMovement, FORCE_ELIGIBLE_MOVEMENTS, ForceEligibleMovement, getFranceRecord, getRecordMessage, getLevel, getLevelMessage } from '@/lib/strengthStandards';
import { computeBodyweightAdjustedE1RM, computeEffectiveLoadAtOneRep, resolveBodyWeightAtDate } from '@/lib/tonnage';
import { ArrowLeft, Trophy, Dumbbell, Plus, Repeat } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import RangeButtons, { RangeFilter, rangeCutoffDate } from './RangeButtons';

interface ExerciseHistoryProps {
  exerciseName: string;
  data: AppData;
  onUpdateData: (partial: Partial<AppData>) => void;
  onClose: () => void;
}

interface HistoryEntry {
  date: string;
  weight: number;
  reps: number;
  e1rm: number;
  // Same estimated 1RM, but for bodyweight-driven exercises (tractions/dips/pompes)
  // re-expressed as a DELTA from bodyweight (0 = a strict bodyweight rep, negative =
  // net-assisted) — see computeBodyweightAdjustedE1RM. Identical to e1rm for every other
  // exercise. Used for the chart line only; the Record headline/list below and the
  // France-record comparison deliberately keep using the raw e1rm above.
  chartValue: number;
  exerciseId: string;
  // Per-exercise RPE logged live during that session (WorkoutTab), not the session-wide
  // `difficulty` — absent when she didn't rate this exercise that day.
  difficulty?: number;
  // Identifies the exact SetLog this entry came from, so the retroactive
  // unilatéral/équipement editor below can patch precisely that set (and only it) without
  // touching any other session. setIndex is this set's position in session.sets.
  sessionId: string;
  setIndex: number;
  equipment?: ExerciseEquipment;
  unilateral?: boolean;
}

interface VariantGroup {
  label: string | null; // null = no equipment specified ("Sans précision")
  history: HistoryEntry[];
}

type DotProps = { cx: number; cy: number; index: number; payload: { date: number; value: number; weight: number; reps: number } };
type DifficultyDotProps = { cx: number; cy: number; index: number; payload: { date: number; difficulty: number } };

const chartStyle = { fontSize: 10, fill: 'hsl(240 12% 72%)' };
const tooltipStyle = {
  background: 'hsl(240 16% 12%)',
  border: '1px solid hsl(189 94% 55% / 0.35)',
  borderRadius: 10,
  fontSize: 12,
  boxShadow: '0 0 24px -8px hsl(189 94% 55% / 0.35)',
};

// Recharts' default Tooltip content just echoes the raw dataKey ("value : 17.1") — this
// replaces it with the actual set (reps x weight) that produced the point, not just the
// computed 1RM/delta, so tapping a point on mobile is useful without a second dot-click.
const OneRepMaxTooltip = (bodyweightOptional: boolean) => ({ active, payload }: { active?: boolean; payload?: { payload: DotProps['payload'] }[] }) => {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div style={{ ...tooltipStyle, padding: '8px 10px' }}>
      <div style={{ color: 'hsl(0 0% 95%)' }}>
        {new Date(p.date).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })}
      </div>
      <div style={{ color: 'hsl(322 100% 70%)', fontWeight: 600 }}>{formatWeightDisplayFor(p.weight, bodyweightOptional)} × {p.reps}</div>
      <div style={{ color: 'hsl(240 12% 72%)' }}>1RM {p.value} kg</div>
    </div>
  );
};

const ExerciseHistory = ({ exerciseName, data, onUpdateData, onClose }: ExerciseHistoryProps) => {
  // Group by base exercise (equipment-agnostic) so e.g. "Développé couché", "Développé
  // couché haltères" and "Développé couché machine" all show up under one screen — but
  // each equipment variant keeps its own PR/history, since their loads aren't comparable.
  const base = useMemo(() => splitEquipmentVariant(exerciseName).base, [exerciseName]);
  // Tractions/dips are meaningfully loggable at 0kg (bodyweight) or negative (assisted) —
  // everywhere else, weight <= 0 just means "not filled in", so it stays excluded.
  const bodyweightOptional = useMemo(() => isBodyweightOptionalExercise(exerciseName), [exerciseName]);

  const variantGroups = useMemo(() => {
    const groups = new Map<string, VariantGroup>();
    data.sessions
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach(session => {
        const sessionBodyWeight = resolveBodyWeightAtDate(data.bodyWeightLogs, session.date);
        session.sets.forEach((s, setIndex) => {
          if (!(s.completed && (s.weight > 0 || bodyweightOptional))) return;
          if (splitEquipmentVariant(s.exerciseName).base !== base) return;
          // Structured fields (equipment/unilateral) drive grouping when present, falling
          // back to parsing the name's text for sets logged before those fields existed —
          // see resolveSetVariant. Unilatéral is now its own axis, composed with equipment
          // into one label (e.g. "aux haltères · unilatéral").
          const variant = resolveSetVariant(s);
          const labelParts = [variant.equipmentLabel, variant.unilateral ? 'unilatéral' : null].filter((p): p is string => !!p);
          const label = labelParts.length > 0 ? labelParts.join(' · ') : null;
          const key = label ?? '__default__';
          if (!groups.has(key)) groups.set(key, { label, history: [] });
          groups.get(key)!.history.push({
            date: session.date,
            weight: s.weight,
            reps: s.reps,
            e1rm: calculate1RM(s.weight, s.reps),
            chartValue: computeBodyweightAdjustedE1RM(s, sessionBodyWeight),
            exerciseId: s.exerciseId,
            difficulty: session.exerciseDifficulty?.[s.exerciseId],
            sessionId: session.id,
            setIndex,
            equipment: s.equipment,
            unilateral: s.unilateral,
          });
        });
      });
    return [...groups.values()];
  }, [data.sessions, base, bodyweightOptional]);

  // The headline "Record" number alone doesn't say what weight×reps produced it — she has
  // to go dig through the list below to find it. Keep the actual best set alongside it.
  const overallPRSet = useMemo(() => {
    const all = variantGroups.flatMap(g => g.history);
    return all.length > 0 ? all.reduce((best, h) => (h.e1rm > best.e1rm ? h : best), all[0]) : null;
  }, [variantGroups]);
  const overallPR = overallPRSet?.e1rm ?? 0;

  const showSubGroups = variantGroups.length > 1;

  // Record de France / niveau-percentile only make sense for the barbell variant
  // (machine/poulie/haltères/élastique loads aren't comparable to the standards, which
  // assume free weights or a weighted belt) — pool BOTH a set with no equipment tag at
  // all (defaults to barbell) AND one explicitly tagged "Barre", so tagging a set barre
  // after the fact doesn't silently drop it out of the comparison. Excludes "unilatéral"
  // (bilateral is what the standards are calibrated against) even when untagged/barbell.
  const isStandardMovement = STANDARD_MOVEMENTS.includes(base as StandardMovement);
  // Vrai 1RM tracking is offered more broadly (see FORCE_ELIGIBLE_MOVEMENTS) — Muscle up
  // gets the same testing/PR feature set as the 5 record-tracked lifts, just without the
  // France-record/niveau panel above (isStandardMovement stays strict for that).
  const isForceEligible = FORCE_ELIGIBLE_MOVEMENTS.includes(base as ForceEligibleMovement);
  const defaultVariantGroups = useMemo(
    () => variantGroups.filter(g => g.label === null || g.label === EQUIPMENT_LABELS.barre),
    [variantGroups]
  );
  const defaultVariantPR = useMemo(() => {
    const history = defaultVariantGroups.flatMap(g => g.history);
    if (history.length === 0) return 0;
    return Math.max(...history.map(h => h.e1rm));
  }, [defaultVariantGroups]);
  const latestBodyweight = useMemo(() => {
    const logs = data.bodyWeightLogs || [];
    if (logs.length === 0) return null;
    return logs.slice().sort((a, b) => b.date.localeCompare(a.date))[0].weight;
  }, [data.bodyWeightLogs]);

  // Tested (not estimated) 1RM history for this movement — see TrueOneRepMax in types.ts.
  // Independent of the Force/Hypertrophie toggle (that only gates the live-session "1RM ?"
  // shortcut) — manually logging a real test is always available for these 5 lifts.
  const trueOneRepMaxHistory = useMemo(() => {
    return (data.trueOneRepMaxes || [])
      .filter(t => t.exerciseName === base)
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [data.trueOneRepMaxes, base]);
  const latestTrueOneRM = trueOneRepMaxHistory[0];

  const [showAddTrueOneRM, setShowAddTrueOneRM] = useState(false);
  const [addTrueOneRMDraft, setAddTrueOneRMDraft] = useState({ date: new Date().toISOString().split('T')[0], weight: '' });

  // Retroactive unilatéral/équipement edit for a specific PAST set — patches only that one
  // SetLog (identified by sessionId + its position in session.sets), never the exercise
  // template or any other session.
  const updateSetVariant = (sessionId: string, setIndexes: number[], patch: { equipment?: ExerciseEquipment; unilateral?: boolean }) => {
    const sessions = data.sessions.map(s => {
      if (s.id !== sessionId) return s;
      return { ...s, sets: s.sets.map((set, i) => setIndexes.includes(i) ? { ...set, ...patch } : set) };
    });
    onUpdateData({ sessions });
  };

  return (
    <>
    <div className="px-4 pt-12 pb-24 animate-slide-up">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onClose} className="text-muted-foreground touch-target p-1">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-foreground">{base}</h1>
          {overallPR > 0 && overallPRSet && (
            <p className="text-xs text-primary font-medium">
              Record : {overallPR} kg (1RM est.) — {formatWeightDisplay(overallPRSet.weight, base)} × {overallPRSet.reps}
            </p>
          )}
        </div>
      </div>

      {isStandardMovement && defaultVariantPR > 0 && (
        <div className="glass-card p-4 mb-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Trophy size={14} className="text-primary" />
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Niveau & record de France</h3>
          </div>
          {!data.gender || !latestBodyweight ? (
            <p className="text-xs text-muted-foreground">
              Renseigne ton sexe et ton poids dans Réglages pour voir ton niveau et ta comparaison au record de France.
            </p>
          ) : (() => {
            const movement = base as StandardMovement;
            const ratio = defaultVariantPR / latestBodyweight;
            const level = getLevel(data.gender, movement, ratio);
            const record = getFranceRecord(data.gender, latestBodyweight, movement);
            return (
              <div className="space-y-1.5">
                {level && (
                  <p className="text-sm text-primary font-semibold">{getLevelMessage(level)}</p>
                )}
                {record && (
                  <p className="text-[10px] text-muted-foreground">
                    Catégorie de poids : <span className="text-foreground/80 font-medium">{record.categoryLabel}</span>
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {record ? getRecordMessage(record, defaultVariantPR) : 'Pas de record de France référencé pour ta catégorie de poids sur cet exercice.'}
                </p>
                <p className="text-[10px] text-muted-foreground/70">
                  Basé sur ton 1RM estimé ({defaultVariantPR} kg) et ton dernier poids enregistré ({latestBodyweight} kg).
                </p>
              </div>
            );
          })()}
        </div>
      )}

      {isForceEligible && (
        <div className="glass-card p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Dumbbell size={14} className="text-warning" />
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Vrai 1RM (testé)</h3>
            </div>
            <button
              onClick={() => { setAddTrueOneRMDraft({ date: new Date().toISOString().split('T')[0], weight: '' }); setShowAddTrueOneRM(true); }}
              className="touch-target p-1 text-warning"
              aria-label="Ajouter un vrai 1RM"
            >
              <Plus size={16} />
            </button>
          </div>
          {latestTrueOneRM ? (
            <div className="space-y-1">
              <p className="text-sm text-foreground font-semibold">
                {latestTrueOneRM.weight} kg{' '}
                <span className="text-xs text-muted-foreground font-normal">
                  — {new Date(latestTrueOneRM.date + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                </span>
              </p>
              {defaultVariantPR > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  1RM estimé : {defaultVariantPR} kg ({latestTrueOneRM.weight >= defaultVariantPR ? '+' : ''}
                  {Math.round((latestTrueOneRM.weight - defaultVariantPR) * 10) / 10} kg d'écart)
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Aucun vrai 1RM enregistré — valide une série à 1 rep en séance (mode Force dans Réglages) ou ajoute-le ici.
            </p>
          )}
        </div>
      )}

      {variantGroups.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <p className="text-muted-foreground">Pas encore d'historique pour cet exercice.</p>
        </div>
      ) : (
        variantGroups.map(group => (
          <VariantSection key={group.label ?? '__default__'} group={group} showHeader={showSubGroups} bodyweightOptional={bodyweightOptional} onUpdateSetVariant={updateSetVariant} />
        ))
      )}
    </div>

    {showAddTrueOneRM && (
      <div
        className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 animate-fade-in"
        onClick={() => setShowAddTrueOneRM(false)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-true-1rm-title"
          className="glass-card p-6 max-w-sm w-full"
          onClick={e => e.stopPropagation()}
        >
          <h3 id="add-true-1rm-title" className="text-sm font-bold text-foreground mb-1">Ajouter un vrai 1RM — {base}</h3>
          <p className="text-[11px] text-muted-foreground mb-4">
            {bodyweightOptional
              ? 'Poids ajouté (0 = poids de corps, négatif = assisté), comme en séance — pas le total.'
              : 'Charge totale soulevée pour cette unique répétition.'}
          </p>
          <div className="space-y-3 mb-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Date</label>
              <input
                type="date"
                value={addTrueOneRMDraft.date}
                onChange={e => setAddTrueOneRMDraft({ ...addTrueOneRMDraft, date: e.target.value })}
                className="w-full bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Poids (kg)</label>
              <input
                autoFocus
                type="number"
                value={addTrueOneRMDraft.weight}
                onChange={e => setAddTrueOneRMDraft({ ...addTrueOneRMDraft, weight: e.target.value })}
                className="w-full bg-secondary text-foreground rounded-xl px-3 py-2.5 text-sm outline-none font-mono"
                placeholder="kg"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowAddTrueOneRM(false)}
              className="flex-1 bg-secondary text-secondary-foreground font-medium py-2.5 rounded-xl text-sm touch-target"
            >
              Annuler
            </button>
            <button
              disabled={addTrueOneRMDraft.weight === ''}
              onClick={() => {
                const enteredWeight = parseFloat(addTrueOneRMDraft.weight) || 0;
                const bodyWeight = resolveBodyWeightAtDate(data.bodyWeightLogs, addTrueOneRMDraft.date);
                const effectiveLoad = computeEffectiveLoadAtOneRep({ weight: enteredWeight, exerciseName: base }, bodyWeight);
                const entry = { id: `true1rm-${Date.now()}`, date: addTrueOneRMDraft.date, exerciseName: base, weight: effectiveLoad };
                onUpdateData({ trueOneRepMaxes: [...(data.trueOneRepMaxes || []), entry] });
                setShowAddTrueOneRM(false);
              }}
              className="flex-1 btn-neon font-medium py-2.5 rounded-xl text-sm touch-target disabled:opacity-40"
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

interface VariantSectionProps {
  group: VariantGroup;
  showHeader: boolean;
  bodyweightOptional: boolean;
  onUpdateSetVariant: (sessionId: string, setIndexes: number[], patch: { equipment?: ExerciseEquipment; unilateral?: boolean }) => void;
}

const VariantSection = ({ group, showHeader, bodyweightOptional, onUpdateSetVariant }: VariantSectionProps) => {
  const [range, setRange] = useState<RangeFilter>('3m');
  const [selected, setSelected] = useState<DotProps['payload'] | null>(null);
  // Which date's retroactive unilatéral/équipement editor is open — keyed by date string,
  // since a VariantSection's groupedByDate list is one card per date.
  const [editingDate, setEditingDate] = useState<string | null>(null);

  const chartData = useMemo(() => {
    const cutoff = rangeCutoffDate(range);
    const byDate: Record<string, HistoryEntry> = {};
    group.history.forEach(h => {
      if (cutoff && new Date(h.date + 'T00:00:00') < cutoff) return;
      if (!byDate[h.date] || h.chartValue > byDate[h.date].chartValue) byDate[h.date] = h;
    });
    return Object.values(byDate)
      .map(h => ({ date: new Date(h.date + 'T00:00:00').getTime(), value: h.chartValue, weight: h.weight, reps: h.reps }))
      .sort((a, b) => a.date - b.date);
  }, [group.history, range]);

  // One point per session date (not per set — RPE is a single value per exercise per
  // session, already the same across every set of that exercise that day).
  const difficultyChartData = useMemo(() => {
    const cutoff = rangeCutoffDate(range);
    const byDate: Record<string, number> = {};
    group.history.forEach(h => {
      if (h.difficulty === undefined) return;
      if (cutoff && new Date(h.date + 'T00:00:00') < cutoff) return;
      byDate[h.date] = h.difficulty;
    });
    return Object.entries(byDate)
      .map(([date, difficulty]) => ({ date: new Date(date + 'T00:00:00').getTime(), difficulty }))
      .sort((a, b) => a.date - b.date);
  }, [group.history, range]);

  useEffect(() => setSelected(null), [range]);

  const groupedByDate = useMemo(() => {
    const map: Record<string, HistoryEntry[]> = {};
    group.history.forEach(h => {
      if (!map[h.date]) map[h.date] = [];
      map[h.date].push(h);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [group.history]);

  const prSet = group.history.length > 0
    ? group.history.reduce((best, h) => (h.e1rm > best.e1rm ? h : best), group.history[0])
    : null;
  const pr = prSet?.e1rm ?? 0;

  return (
    <div className="mb-4">
      {showHeader && (
        <div className="flex items-center justify-between mb-2 px-1">
          <h3 className="text-sm font-semibold text-foreground">{group.label ?? 'Sans précision'}</h3>
          {pr > 0 && prSet && (
            <span className="text-xs text-primary font-medium">Record : {pr} kg — {formatWeightDisplayFor(prSet.weight, bodyweightOptional)} × {prSet.reps}</span>
          )}
        </div>
      )}

      {group.history.length > 1 && (
        <div className="glass-card p-4 mb-3">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-muted-foreground">
              Évolution du 1RM estimé{bodyweightOptional ? ' (relatif au poids de corps)' : ''}
            </h4>
            <RangeButtons value={range} onChange={setRange} />
          </div>
          {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 12% 20%)" />
              <XAxis
                dataKey="date"
                type="number"
                domain={['dataMin', 'dataMax']}
                scale="time"
                tickFormatter={(ts: number) => new Date(ts).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })}
                tick={chartStyle} axisLine={false} tickLine={false}
              />
              <YAxis
                domain={bodyweightOptional ? [(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)] : undefined}
                tick={chartStyle} axisLine={false} tickLine={false} width={40}
              />
              <Tooltip content={OneRepMaxTooltip(bodyweightOptional)} />
              {bodyweightOptional && (
                <ReferenceLine y={0} stroke="hsl(240 12% 45%)" strokeDasharray="4 4" strokeWidth={1}
                  label={{ value: 'Poids de corps', position: 'insideBottomLeft', fill: 'hsl(240 12% 60%)', fontSize: 9 }} />
              )}
              <Line
                type="monotone"
                dataKey="value"
                stroke="hsl(322 100% 60%)"
                strokeWidth={2.5}
                dot={(props: DotProps) => (
                  <circle
                    key={`dot-${props.index}`}
                    cx={props.cx}
                    cy={props.cy}
                    r={3}
                    fill="hsl(322 100% 60%)"
                    onClick={() => setSelected(props.payload)}
                    style={{ cursor: 'pointer' }}
                  />
                )}
                style={{ filter: 'drop-shadow(0 0 5px hsl(322 100% 60% / 0.6))' }}
              />
            </LineChart>
          </ResponsiveContainer>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-6">Pas assez de données sur cette période</p>
          )}
          {selected && (
            <p className="text-xs text-primary font-medium text-center mt-2">
              {new Date(selected.date).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })} : {formatWeightDisplayFor(selected.weight, bodyweightOptional)} × {selected.reps}
              {' '}(1RM {selected.value} kg)
            </p>
          )}
        </div>
      )}

      {difficultyChartData.length > 1 && (
        <div className="glass-card p-4 mb-3">
          <h4 className="text-xs font-semibold text-muted-foreground mb-3">Ressenti (RPE)</h4>
          <ResponsiveContainer width="100%" height={100}>
            <LineChart data={difficultyChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 12% 20%)" />
              <XAxis
                dataKey="date"
                type="number"
                domain={['dataMin', 'dataMax']}
                scale="time"
                tickFormatter={(ts: number) => new Date(ts).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })}
                tick={chartStyle} axisLine={false} tickLine={false}
              />
              <YAxis domain={[0, 10]} tick={chartStyle} axisLine={false} tickLine={false} width={22} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={{ color: 'hsl(0 0% 95%)' }}
                formatter={(value: number) => [`${value}/10`, 'RPE']}
                labelFormatter={(ts: number) => new Date(ts).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })}
              />
              <Line
                type="monotone"
                dataKey="difficulty"
                stroke="hsl(262 83% 66%)"
                strokeWidth={2}
                dot={(props: DifficultyDotProps) => (
                  <circle key={`rpe-dot-${props.index}`} cx={props.cx} cy={props.cy} r={2.5} fill="hsl(262 83% 66%)" />
                )}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="space-y-3">
        {groupedByDate.map(([date, sets]) => {
          const isEditing = editingDate === date;
          const representative = sets[0];
          // A date normally maps to one session for this exercise — grouped defensively by
          // sessionId anyway (rare same-day double session) so the patch never touches sets
          // it wasn't shown for.
          const patchAllSets = (patch: { equipment?: ExerciseEquipment; unilateral?: boolean }) => {
            const bySession = new Map<string, number[]>();
            sets.forEach(s => {
              if (!bySession.has(s.sessionId)) bySession.set(s.sessionId, []);
              bySession.get(s.sessionId)!.push(s.setIndex);
            });
            bySession.forEach((setIndexes, sessionId) => onUpdateSetVariant(sessionId, setIndexes, patch));
          };
          return (
            <div key={date} className="glass-card p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground">
                  {new Date(date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', month: 'long', day: 'numeric' })}
                </p>
                <button
                  type="button"
                  onClick={() => setEditingDate(isEditing ? null : date)}
                  className="touch-target p-1 text-muted-foreground active:text-accent-blue"
                  aria-label="Modifier unilatéral / équipement pour cette séance"
                  aria-pressed={isEditing}
                  title="Unilatéral / équipement"
                >
                  <Repeat size={14} />
                </button>
              </div>
              {isEditing ? (
                <div className="flex items-center gap-3 flex-wrap mb-2 bg-secondary/40 rounded-lg px-2.5 py-2">
                  <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={!!representative.unilateral}
                      onChange={e => patchAllSets({ unilateral: e.target.checked ? true : undefined })}
                      className="w-3.5 h-3.5 accent-accent-blue"
                    />
                    <Repeat size={10} className="text-accent-blue" /> Unilatéral
                  </label>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">Équipement</span>
                    <select
                      value={representative.equipment ?? ''}
                      onChange={e => patchAllSets({ equipment: e.target.value === '' ? undefined : e.target.value as ExerciseEquipment })}
                      className="bg-secondary text-foreground text-[10px] rounded-md px-1.5 py-1 outline-none"
                      aria-label="Équipement utilisé ce jour-là"
                    >
                      <option value="">—</option>
                      {(Object.keys(EQUIPMENT_LABELS) as ExerciseEquipment[]).map(eq => (
                        <option key={eq} value={eq}>{EQUIPMENT_LABELS[eq]}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (representative.equipment || representative.unilateral) ? (
                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  {representative.unilateral && (
                    <span className="text-[10px] text-accent-blue bg-accent-blue/10 px-2 py-0.5 rounded-full">Unilatéral</span>
                  )}
                  {representative.equipment && (
                    <span className="text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">{EQUIPMENT_LABELS[representative.equipment]}</span>
                  )}
                </div>
              ) : null}
              <div className="space-y-1">
                {sets.map((s, i) => (
                  <div key={i} className="flex items-center justify-between bg-secondary rounded-lg px-3 py-2">
                    <span className="text-sm text-foreground font-mono">{formatWeightDisplayFor(s.weight, bodyweightOptional)} × {s.reps}</span>
                    <span className="text-xs text-muted-foreground">1RM: {bodyweightOptional ? s.chartValue : s.e1rm} kg</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ExerciseHistory;
