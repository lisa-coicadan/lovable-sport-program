import { useMemo, useState } from 'react';
import { AppData, calculate1RM } from '@/lib/types';
import { normalizeExerciseName } from '@/lib/exerciseNormalize';
import { Trophy, Scale, Crown } from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts';

interface StatsTabProps {
  data: AppData;
}

const RPE_CUTOFF = '2026-06-01';

type PR = { name: string; e1rm: number; weight: number; reps: number; date: string };

const daysAgo = (dateStr: string) => {
  const d = new Date(dateStr + 'T00:00:00');
  const diff = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  return diff;
};

const mondayOf = (d: Date): Date => {
  const day = d.getDay();
  const diff = d.getDate() - (day === 0 ? 6 : day - 1);
  const m = new Date(d);
  m.setDate(diff);
  m.setHours(0, 0, 0, 0);
  return m;
};

const formatHM = (mins: number) => {
  if (!mins || mins <= 0) return '0min';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
};

// 1 mois = 4 semaines pile (pas de semaine coupée) ; 3 mois ≈ 13 semaines.
type RangeFilter = '1m' | '3m' | 'all';
const RANGE_OPTIONS: { value: RangeFilter; label: string }[] = [
  { value: '1m', label: '1 mois' },
  { value: '3m', label: '3 mois' },
  { value: 'all', label: 'Tout' },
];
const rangeWeeks = (range: RangeFilter): number | null => (range === '1m' ? 4 : range === '3m' ? 13 : null);
const rangeMonths = (range: RangeFilter): number | null => (range === '1m' ? 1 : range === '3m' ? 3 : null);
const rangeCutoffDate = (range: RangeFilter): Date | null => {
  const weeks = rangeWeeks(range);
  if (weeks === null) return null;
  const d = new Date();
  d.setDate(d.getDate() - weeks * 7);
  d.setHours(0, 0, 0, 0);
  return d;
};

// Builds the list of Mondays to display for a given range: exactly `rangeWeeks` weeks
// ending on the current week for '1m'/'3m', or every week since the earliest reference
// date for 'all' (so charts show real zero-filled weeks, not just weeks with data).
const weekRangeMondays = (range: RangeFilter, referenceDates: string[]): Date[] => {
  const nowMonday = mondayOf(new Date());
  const n = rangeWeeks(range);
  let firstMonday: Date;
  if (n === null) {
    if (referenceDates.length === 0) {
      firstMonday = new Date(nowMonday);
      firstMonday.setDate(firstMonday.getDate() - 7 * 3);
    } else {
      const earliest = [...referenceDates].sort()[0];
      firstMonday = mondayOf(new Date(earliest + 'T00:00:00'));
    }
  } else {
    firstMonday = new Date(nowMonday);
    firstMonday.setDate(firstMonday.getDate() - 7 * (n - 1));
  }
  const out: Date[] = [];
  const cursor = new Date(firstMonday);
  while (cursor <= nowMonday) {
    out.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return out;
};

const RangeButtons = ({ value, onChange }: { value: RangeFilter; onChange: (v: RangeFilter) => void }) => (
  <div className="flex gap-1">
    {RANGE_OPTIONS.map(opt => (
      <button
        key={opt.value}
        onClick={() => onChange(opt.value)}
        className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
          value === opt.value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
        }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

const StatsTab = ({ data }: StatsTabProps) => {
  const [difficultyFilter, setDifficultyFilter] = useState<string | null>(null);
  const [volumeFilter, setVolumeFilter] = useState<string | null>(null);
  const [weeklyRange, setWeeklyRange] = useState<RangeFilter>('all');
  const [volumeRange, setVolumeRange] = useState<RangeFilter>('all');
  const [difficultyRange, setDifficultyRange] = useState<RangeFilter>('all');
  const [weeklyTimeRange, setWeeklyTimeRange] = useState<RangeFilter>('all');
  const [monthlyTimeRange, setMonthlyTimeRange] = useState<RangeFilter>('all');

  // All PRs, grouped by normalized name -> best e1rm ever
  const prByName = useMemo(() => {
    const map: Record<string, PR> = {};
    data.sessions.forEach(session => {
      session.sets.filter(s => s.completed && s.weight > 0 && s.reps > 0).forEach(s => {
        const name = normalizeExerciseName(s.exerciseName);
        const e1rm = calculate1RM(s.weight, s.reps);
        if (!map[name] || e1rm > map[name].e1rm) {
          map[name] = { name, e1rm, weight: s.weight, reps: s.reps, date: session.date };
        }
      });
    });
    return map;
  }, [data.sessions]);

  // Exercises with an active training method (5/3/1, Cluster, EMOM) get their own
  // isolated PR card up top, same treatment the Squat card used to get alone.
  const methodExerciseNames = useMemo(() => {
    const names = new Set<string>();
    data.workoutTypes.forEach(t => t.exercises.forEach(e => {
      if (e.method) names.add(normalizeExerciseName(e.name));
    }));
    return names;
  }, [data.workoutTypes]);

  const methodPRs = useMemo(() => {
    return Array.from(methodExerciseNames)
      .map(name => prByName[name])
      .filter((p): p is PR => !!p)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [methodExerciseNames, prByName]);

  const otherPRs = useMemo(() => {
    return Object.values(prByName)
      .filter(p => !methodExerciseNames.has(p.name))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);
  }, [prByName, methodExerciseNames]);

  // Weekly frequency — include empty weeks
  const weeklyData = useMemo(() => {
    const countByWeek = new Map<string, number>();
    data.sessions.forEach(s => {
      const key = mondayOf(new Date(s.date + 'T00:00:00')).toISOString().split('T')[0];
      countByWeek.set(key, (countByWeek.get(key) || 0) + 1);
    });
    return weekRangeMondays(weeklyRange, data.sessions.map(s => s.date)).map(m => {
      const key = m.toISOString().split('T')[0];
      return {
        week: m.toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' }),
        sessions: countByWeek.get(key) || 0,
        goal: data.weeklyGoal,
      };
    });
  }, [data.sessions, data.weeklyGoal, weeklyRange]);

  // Tonnage per session (filterable by workout type + time range)
  const volumeData = useMemo(() => {
    const cutoff = rangeCutoffDate(volumeRange);
    return data.sessions
      .filter(s => !volumeFilter || s.workoutTypeId === volumeFilter)
      .filter(s => !cutoff || new Date(s.date + 'T00:00:00') >= cutoff)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(s => {
        const volume = s.sets.reduce((acc, set) => acc + set.reps * set.weight, 0);
        return {
          date: new Date(s.date).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' }),
          volume,
          type: s.workoutTypeName,
        };
      });
  }, [data.sessions, volumeFilter, volumeRange]);

  // Difficulty over time — only sessions from June 2026 onward (RPE /5 scale)
  const difficultyData = useMemo(() => {
    const cutoff = rangeCutoffDate(difficultyRange);
    return data.sessions
      .filter(s => s.date >= RPE_CUTOFF)
      .filter(s => s.difficulty && s.difficulty > 0)
      .filter(s => !difficultyFilter || s.workoutTypeId === difficultyFilter)
      .filter(s => !cutoff || new Date(s.date + 'T00:00:00') >= cutoff)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(s => ({
        date: new Date(s.date).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' }),
        difficulty: s.difficulty || 0,
        type: s.workoutTypeName,
      }));
  }, [data.sessions, difficultyFilter, difficultyRange]);

  // Weekly training time — include empty weeks
  const weeklyTimeData = useMemo(() => {
    const withDuration = data.sessions.filter(s => s.duration);
    const minutesByWeek = new Map<string, number>();
    withDuration.forEach(s => {
      const key = mondayOf(new Date(s.date + 'T00:00:00')).toISOString().split('T')[0];
      minutesByWeek.set(key, (minutesByWeek.get(key) || 0) + (s.duration || 0));
    });
    return weekRangeMondays(weeklyTimeRange, withDuration.map(s => s.date)).map(m => {
      const key = m.toISOString().split('T')[0];
      return {
        week: m.toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' }),
        minutes: minutesByWeek.get(key) || 0,
      };
    });
  }, [data.sessions, weeklyTimeRange]);

  // Monthly training time
  const monthlyTimeData = useMemo(() => {
    const months: Record<string, number> = {};
    data.sessions.filter(s => s.duration).forEach(s => {
      const d = new Date(s.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months[key] = (months[key] || 0) + (s.duration || 0);
    });
    const entries = Object.entries(months).sort(([a], [b]) => a.localeCompare(b));
    const n = rangeMonths(monthlyTimeRange);
    const sliced = n === null ? entries : entries.slice(-n);
    return sliced.map(([month, minutes]) => ({
      month: new Date(month + '-01').toLocaleDateString('fr-FR', { month: 'short' }),
      minutes,
    }));
  }, [data.sessions, monthlyTimeRange]);

  const currentWeekTime = weeklyTimeData.length > 0 ? weeklyTimeData[weeklyTimeData.length - 1]?.minutes || 0 : 0;
  const prevWeekTime = weeklyTimeData.length > 1 ? weeklyTimeData[weeklyTimeData.length - 2]?.minutes || 0 : 0;
  const latestBodyWeight = (data.bodyWeightLogs || []).sort((a, b) => b.date.localeCompare(a.date))[0];

  const chartStyle = { fontSize: 10, fill: 'hsl(240 5% 55%)' };
  const tooltipStyle = { background: 'hsl(240 5% 11%)', border: '1px solid hsl(240 4% 20%)', borderRadius: 12, fontSize: 12 };
  const noData = data.sessions.length === 0;
  const activeTypes = data.workoutTypes.filter(t => !t.hidden);

  return (
    <div className="px-4 pt-12 pb-24 animate-slide-up">
      <h1 className="text-2xl font-bold text-foreground mb-6">Statistiques</h1>

      {noData && (
        <div className="glass-card p-8 text-center">
          <p className="text-muted-foreground">Termine ta première séance pour voir tes stats ici !</p>
        </div>
      )}

      {/* Latest body weight */}
      {latestBodyWeight && (
        <div className="glass-card p-4 mb-4 flex items-center gap-3">
          <Scale size={18} className="text-primary" />
          <div>
            <p className="text-2xl font-bold text-foreground">{latestBodyWeight.weight} kg</p>
            <p className="text-[10px] text-muted-foreground">
              Bodyweight — {new Date(latestBodyWeight.date).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })}
            </p>
          </div>
        </div>
      )}

      {/* PRs for exercises with an active training method — isolated, one card each */}
      {methodPRs.map(pr => (
        <div key={pr.name} className="glass-card p-4 mb-4 border border-warning/40 bg-warning/5">
          <div className="flex items-center gap-2 mb-2">
            <span className="relative inline-flex w-4 h-4 items-center justify-center">
              <span className="absolute inset-0 bg-warning/50 rounded-full blur-sm animate-pulse-glow" />
              <Crown size={16} className="relative text-warning" />
            </span>
            <h3 className="text-sm font-semibold text-foreground">Record — {pr.name}</h3>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-warning">{pr.e1rm} kg</span>
            <span className="text-sm text-muted-foreground">1RM théorique</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {pr.reps} × {pr.weight} kg — il y a {daysAgo(pr.date)} jour{daysAgo(pr.date) > 1 ? 's' : ''}
          </p>
        </div>
      ))}

      {/* Top 5 other PRs */}
      {otherPRs.length > 0 && (
        <div className="glass-card p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Trophy size={16} className="text-warning" />
            <h3 className="text-sm font-semibold text-foreground">Derniers records</h3>
          </div>
          <div className="space-y-2">
            {otherPRs.map(pr => {
              const d = daysAgo(pr.date);
              return (
                <div key={pr.name} className="flex items-center justify-between bg-secondary rounded-lg px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground truncate">{pr.name}</p>
                    <p className="text-[10px] text-muted-foreground">Il y a {d} jour{d > 1 ? 's' : ''}</p>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <span className="text-sm font-bold text-warning">{pr.reps} × {pr.weight} kg</span>
                    <p className="text-[10px] text-muted-foreground">1RM {pr.e1rm} kg</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Weekly Frequency */}
      {weeklyData.length > 0 && (
        <div className="glass-card p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">Séances par semaine</h3>
            <RangeButtons value={weeklyRange} onChange={setWeeklyRange} />
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={weeklyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 4% 20%)" />
              <XAxis dataKey="week" tick={chartStyle} axisLine={false} tickLine={false} />
              <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'hsl(0 0% 95%)' }} />
              <ReferenceLine y={data.weeklyGoal} stroke="hsl(84 81% 44%)" strokeDasharray="4 4" strokeWidth={1.5} />
              <Bar dataKey="sessions" fill="hsl(199 89% 48%)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Volume */}
      {(volumeData.length > 0 || volumeFilter) && (
        <div className="glass-card p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">Tonnage par séance (kg)</h3>
            <RangeButtons value={volumeRange} onChange={setVolumeRange} />
          </div>
          <div className="flex gap-1 mb-3 flex-wrap">
            <button
              onClick={() => setVolumeFilter(null)}
              className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                !volumeFilter ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
              }`}
            >
              Tout
            </button>
            {activeTypes.map(t => (
              <button
                key={t.id}
                onClick={() => setVolumeFilter(t.id)}
                className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                  volumeFilter === t.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
          {volumeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={volumeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 4% 20%)" />
                <XAxis dataKey="date" tick={chartStyle} axisLine={false} tickLine={false} />
                <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={45} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'hsl(0 0% 95%)' }} />
                <Line type="monotone" dataKey="volume" stroke="hsl(330 81% 60%)" strokeWidth={2.5} dot={{ r: 3, fill: 'hsl(330 81% 60%)' }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-8">Aucune donnée pour ce type de séance</p>
          )}
        </div>
      )}

      {/* Difficulty Over Time */}
      {difficultyData.length > 0 && (
        <div className="glass-card p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">Effort perçu (RPE /5)</h3>
            <RangeButtons value={difficultyRange} onChange={setDifficultyRange} />
          </div>
          <div className="flex gap-1 mb-3 flex-wrap">
            <button
              onClick={() => setDifficultyFilter(null)}
              className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                !difficultyFilter ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
              }`}
            >
              Tout
            </button>
            {activeTypes.map(t => (
              <button
                key={t.id}
                onClick={() => setDifficultyFilter(t.id)}
                className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                  difficultyFilter === t.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={difficultyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 4% 20%)" />
              <XAxis dataKey="date" tick={chartStyle} axisLine={false} tickLine={false} />
              <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={30} domain={[0, 5]} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'hsl(0 0% 95%)' }} />
              <Line type="monotone" dataKey="difficulty" stroke="hsl(262 83% 58%)" strokeWidth={2.5} dot={{ r: 3, fill: 'hsl(262 83% 58%)' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Weekly Training Time */}
      {weeklyTimeData.length > 0 && (
        <div className="glass-card p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-foreground">Temps d'entraînement hebdo</h3>
            <RangeButtons value={weeklyTimeRange} onChange={setWeeklyTimeRange} />
          </div>
          <div className="flex gap-4 mb-3">
            <div className="text-center">
              <p className="text-lg font-bold text-foreground">{formatHM(currentWeekTime)}</p>
              <p className="text-[10px] text-muted-foreground">Cette semaine</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-muted-foreground">{formatHM(prevWeekTime)}</p>
              <p className="text-[10px] text-muted-foreground">Semaine dernière</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={weeklyTimeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 4% 20%)" />
              <XAxis dataKey="week" tick={chartStyle} axisLine={false} tickLine={false} />
              <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={35} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'hsl(0 0% 95%)' }} formatter={(value: number) => [formatHM(value), 'Temps']} />
              <Bar dataKey="minutes" fill="hsl(174 72% 46%)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Monthly Training Time */}
      {monthlyTimeData.length > 0 && (
        <div className="glass-card p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">Temps d'entraînement mensuel</h3>
            <RangeButtons value={monthlyTimeRange} onChange={setMonthlyTimeRange} />
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={monthlyTimeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 4% 20%)" />
              <XAxis dataKey="month" tick={chartStyle} axisLine={false} tickLine={false} />
              <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={35} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'hsl(0 0% 95%)' }} formatter={(value: number) => [formatHM(value), 'Temps']} />
              <Bar dataKey="minutes" fill="hsl(38 92% 50%)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default StatsTab;
