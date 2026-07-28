import { useEffect, useMemo, useState } from 'react';
import { AppData, calculate1RM } from '@/lib/types';
import { splitEquipmentVariant, isBodyweightOptionalExercise } from '@/lib/exerciseNormalize';
import { STANDARD_MOVEMENTS, StandardMovement, getFranceRecord, getRecordMessage, getLevel, getLevelMessage } from '@/lib/strengthStandards';
import { ArrowLeft, Trophy } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import RangeButtons, { RangeFilter, rangeCutoffDate } from './RangeButtons';

interface ExerciseHistoryProps {
  exerciseName: string;
  data: AppData;
  onClose: () => void;
}

interface HistoryEntry {
  date: string;
  weight: number;
  reps: number;
  e1rm: number;
}

interface VariantGroup {
  label: string | null; // null = no equipment specified ("Sans précision")
  history: HistoryEntry[];
}

type DotProps = { cx: number; cy: number; index: number; payload: { date: number; e1rm: number; weight: number; reps: number } };

const chartStyle = { fontSize: 10, fill: 'hsl(240 12% 72%)' };
const tooltipStyle = {
  background: 'hsl(240 16% 12%)',
  border: '1px solid hsl(189 94% 55% / 0.35)',
  borderRadius: 10,
  fontSize: 12,
  boxShadow: '0 0 24px -8px hsl(189 94% 55% / 0.35)',
};

const ExerciseHistory = ({ exerciseName, data, onClose }: ExerciseHistoryProps) => {
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
        session.sets
          .filter(s => s.completed && (s.weight > 0 || bodyweightOptional))
          .forEach(s => {
            const split = splitEquipmentVariant(s.exerciseName);
            if (split.base !== base) return;
            const key = split.variantLabel ?? '__default__';
            if (!groups.has(key)) groups.set(key, { label: split.variantLabel, history: [] });
            groups.get(key)!.history.push({
              date: session.date,
              weight: s.weight,
              reps: s.reps,
              e1rm: calculate1RM(s.weight, s.reps),
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

  // Record de France / niveau-percentile only make sense for the barbell/no-equipment
  // variant (machine-assisted or elastic-assisted loads aren't comparable to the
  // standards, which assume free weights or a weighted belt).
  const isStandardMovement = STANDARD_MOVEMENTS.includes(base as StandardMovement);
  const defaultVariantGroup = useMemo(() => variantGroups.find(g => g.label === null), [variantGroups]);
  const defaultVariantPR = useMemo(() => {
    if (!defaultVariantGroup || defaultVariantGroup.history.length === 0) return 0;
    return Math.max(...defaultVariantGroup.history.map(h => h.e1rm));
  }, [defaultVariantGroup]);
  const latestBodyweight = useMemo(() => {
    const logs = data.bodyWeightLogs || [];
    if (logs.length === 0) return null;
    return logs.slice().sort((a, b) => b.date.localeCompare(a.date))[0].weight;
  }, [data.bodyWeightLogs]);

  return (
    <div className="px-4 pt-12 pb-24 animate-slide-up">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onClose} className="text-muted-foreground touch-target p-1">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-foreground">{base}</h1>
          {overallPR > 0 && overallPRSet && (
            <p className="text-xs text-primary font-medium">
              Record : {overallPR} kg (1RM est.) — {overallPRSet.weight} kg × {overallPRSet.reps}
            </p>
          )}
        </div>
      </div>

      {isStandardMovement && defaultVariantGroup && defaultVariantGroup.history.length > 0 && (
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

      {variantGroups.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <p className="text-muted-foreground">Pas encore d'historique pour cet exercice.</p>
        </div>
      ) : (
        variantGroups.map(group => (
          <VariantSection key={group.label ?? '__default__'} group={group} showHeader={showSubGroups} />
        ))
      )}
    </div>
  );
};

const VariantSection = ({ group, showHeader }: { group: VariantGroup; showHeader: boolean }) => {
  const [range, setRange] = useState<RangeFilter>('3m');
  const [selected, setSelected] = useState<DotProps['payload'] | null>(null);

  const chartData = useMemo(() => {
    const cutoff = rangeCutoffDate(range);
    const byDate: Record<string, HistoryEntry> = {};
    group.history.forEach(h => {
      if (cutoff && new Date(h.date + 'T00:00:00') < cutoff) return;
      if (!byDate[h.date] || h.e1rm > byDate[h.date].e1rm) byDate[h.date] = h;
    });
    return Object.values(byDate)
      .map(h => ({ date: new Date(h.date + 'T00:00:00').getTime(), e1rm: h.e1rm, weight: h.weight, reps: h.reps }))
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
            <span className="text-xs text-primary font-medium">Record : {pr} kg — {prSet.weight} kg × {prSet.reps}</span>
          )}
        </div>
      )}

      {group.history.length > 1 && (
        <div className="glass-card p-4 mb-3">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-muted-foreground">Évolution du 1RM estimé</h4>
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
              <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={40} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={{ color: 'hsl(0 0% 95%)' }}
                labelFormatter={(ts: number) => new Date(ts).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })}
              />
              <Line
                type="monotone"
                dataKey="e1rm"
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
              {new Date(selected.date).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })} : {selected.weight} kg × {selected.reps} (1RM {selected.e1rm} kg)
            </p>
          )}
        </div>
      )}

      <div className="space-y-3">
        {groupedByDate.map(([date, sets]) => (
          <div key={date} className="glass-card p-4">
            <p className="text-xs text-muted-foreground mb-2">
              {new Date(date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', month: 'long', day: 'numeric' })}
            </p>
            <div className="space-y-1">
              {sets.map((s, i) => (
                <div key={i} className="flex items-center justify-between bg-secondary rounded-lg px-3 py-2">
                  <span className="text-sm text-foreground font-mono">{s.weight} kg × {s.reps}</span>
                  <span className="text-xs text-muted-foreground">1RM: {s.e1rm} kg</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ExerciseHistory;
