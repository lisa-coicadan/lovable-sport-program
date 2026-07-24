import { useMemo } from 'react';
import { AppData, calculate1RM } from '@/lib/types';
import { splitEquipmentVariant } from '@/lib/exerciseNormalize';
import { ArrowLeft } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

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

const chartStyle = { fontSize: 10, fill: 'hsl(240 8% 58%)' };

const ExerciseHistory = ({ exerciseName, data, onClose }: ExerciseHistoryProps) => {
  // Group by base exercise (equipment-agnostic) so e.g. "Développé couché", "Développé
  // couché haltères" and "Développé couché machine" all show up under one screen — but
  // each equipment variant keeps its own PR/history, since their loads aren't comparable.
  const base = useMemo(() => splitEquipmentVariant(exerciseName).base, [exerciseName]);

  const variantGroups = useMemo(() => {
    const groups = new Map<string, VariantGroup>();
    data.sessions
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach(session => {
        session.sets
          .filter(s => s.completed && s.weight > 0)
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
  }, [data.sessions, base]);

  const overallPR = useMemo(() => {
    const all = variantGroups.flatMap(g => g.history);
    return all.length > 0 ? Math.max(...all.map(h => h.e1rm)) : 0;
  }, [variantGroups]);

  const showSubGroups = variantGroups.length > 1;

  return (
    <div className="px-4 pt-12 pb-24 animate-slide-up">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onClose} className="text-muted-foreground touch-target p-1">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-foreground">{base}</h1>
          {overallPR > 0 && (
            <p className="text-xs text-warning font-medium">Record : {overallPR} kg (1RM est.)</p>
          )}
        </div>
      </div>

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
  const chartData = useMemo(() => {
    const byDate: Record<string, number> = {};
    group.history.forEach(h => {
      if (!byDate[h.date] || h.e1rm > byDate[h.date]) byDate[h.date] = h.e1rm;
    });
    return Object.entries(byDate).map(([date, e1rm]) => ({
      date: new Date(date + 'T00:00:00').toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' }),
      e1rm,
    }));
  }, [group.history]);

  const groupedByDate = useMemo(() => {
    const map: Record<string, HistoryEntry[]> = {};
    group.history.forEach(h => {
      if (!map[h.date]) map[h.date] = [];
      map[h.date].push(h);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [group.history]);

  const pr = group.history.length > 0 ? Math.max(...group.history.map(h => h.e1rm)) : 0;

  return (
    <div className="mb-4">
      {showHeader && (
        <div className="flex items-center justify-between mb-2 px-1">
          <h3 className="text-sm font-semibold text-foreground">{group.label ?? 'Sans précision'}</h3>
          {pr > 0 && <span className="text-xs text-warning font-medium">Record : {pr} kg</span>}
        </div>
      )}

      {chartData.length > 1 && (
        <div className="glass-card p-4 mb-3">
          <h4 className="text-xs font-semibold text-muted-foreground mb-3">Évolution du 1RM estimé</h4>
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 12% 20%)" />
              <XAxis dataKey="date" tick={chartStyle} axisLine={false} tickLine={false} />
              <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={40} />
              <Tooltip
                contentStyle={{ background: 'hsl(240 14% 9%)', border: '1px solid hsl(240 12% 20%)', borderRadius: 10, fontSize: 12 }}
                labelStyle={{ color: 'hsl(0 0% 95%)' }}
              />
              <Line type="monotone" dataKey="e1rm" stroke="hsl(38 92% 55%)" strokeWidth={2.5} dot={{ r: 3, fill: 'hsl(38 92% 55%)' }} />
            </LineChart>
          </ResponsiveContainer>
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
