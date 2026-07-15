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

const formatHM = (mins: number) => {
  if (!mins || mins <= 0) return '0min';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${String(m).padStart(2, '0')}`;
};

const StatsTab = ({ data }: StatsTabProps) => {
  const [difficultyFilter, setDifficultyFilter] = useState<string | null>(null);
  const [volumeFilter, setVolumeFilter] = useState<string | null>(null);
  const [weeklyRange, setWeeklyRange] = useState<'4' | '16' | 'all'>('16');

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

  const squatPR = prByName['Squat'];
  const otherPRs = useMemo(() => {
    return Object.values(prByName)
      .filter(p => p.name !== 'Squat')
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);
  }, [prByName]);

  // Weekly frequency — include empty weeks
  const weeklyData = useMemo(() => {
    const mondayOf = (d: Date) => {
      const day = d.getDay();
      const diff = d.getDate() - (day === 0 ? 6 : day - 1);
      const m = new Date(d);
      m.setDate(diff);
      m.setHours(0, 0, 0, 0);
      return m;
    };
    const countByWeek = new Map<string, number>();
    data.sessions.forEach(s => {
      const m = mondayOf(new Date(s.date + 'T00:00:00'));
      const key = m.toISOString().split('T')[0];
      countByWeek.set(key, (countByWeek.get(key) || 0) + 1);
    });

    const nowMonday = mondayOf(new Date());
    let firstMonday: Date;
    if (weeklyRange === 'all') {
      if (data.sessions.length === 0) {
        firstMonday = new Date(nowMonday);
        firstMonday.setDate(firstMonday.getDate() - 7 * 3);
      } else {
        const earliest = data.sessions.map(s => s.date).sort()[0];
        firstMonday = mondayOf(new Date(earliest + 'T00:00:00'));
      }
    } else {
      const n = weeklyRange === '4' ? 4 : 16;
      firstMonday = new Date(nowMonday);
      firstMonday.setDate(firstMonday.getDate() - 7 * (n - 1));
    }

    const out: { week: string; sessions: number; goal: number }[] = [];
    const cursor = new Date(firstMonday);
    while (cursor <= nowMonday) {
      const key = cursor.toISOString().split('T')[0];
      out.push({
        week: cursor.toLocaleDateString('default', { month: 'short', day: 'numeric' }),
        sessions: countByWeek.get(key) || 0,
        goal: data.weeklyGoal,
      });
      cursor.setDate(cursor.getDate() + 7);
    }
    return out;
  }, [data.sessions, data.weeklyGoal, weeklyRange]);

  // Volume per session (filterable by workout type)
  const volumeData = useMemo(() => {
    return data.sessions
      .filter(s => !volumeFilter || s.workoutTypeId === volumeFilter)
      .slice(-10)
      .map(s => {
        const volume = s.sets.reduce((acc, set) => acc + set.reps * set.weight, 0);
        return {
          date: new Date(s.date).toLocaleDateString('default', { month: 'short', day: 'numeric' }),
          volume,
          type: s.workoutTypeName,
        };
      });
  }, [data.sessions, volumeFilter]);

  // Difficulty over time — only sessions from June 2026 onward (RPE /5 scale)
  const difficultyData = useMemo(() => {
    return data.sessions
      .filter(s => s.date >= RPE_CUTOFF)
      .filter(s => s.difficulty && s.difficulty > 0)
      .filter(s => !difficultyFilter || s.workoutTypeId === difficultyFilter)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-20)
      .map(s => ({
        date: new Date(s.date).toLocaleDateString('default', { month: 'short', day: 'numeric' }),
        difficulty: s.difficulty || 0,
        type: s.workoutTypeName,
      }));
  }, [data.sessions, difficultyFilter]);

  // Weekly training time
  const weeklyTimeData = useMemo(() => {
    const weeks: Record<string, number> = {};
    data.sessions.filter(s => s.duration).forEach(s => {
      const d = new Date(s.date);
      const dayOfWeek = d.getDay();
      const diff = d.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
      const monday = new Date(d);
      monday.setDate(diff);
      const key = monday.toISOString().split('T')[0];
      weeks[key] = (weeks[key] || 0) + (s.duration || 0);
    });
    return Object.entries(weeks)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-8)
      .map(([week, minutes]) => ({
        week: new Date(week).toLocaleDateString('default', { month: 'short', day: 'numeric' }),
        minutes,
      }));
  }, [data.sessions]);

  // Monthly training time
  const monthlyTimeData = useMemo(() => {
    const months: Record<string, number> = {};
    data.sessions.filter(s => s.duration).forEach(s => {
      const d = new Date(s.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months[key] = (months[key] || 0) + (s.duration || 0);
    });
    return Object.entries(months)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, minutes]) => ({
        month: new Date(month + '-01').toLocaleDateString('default', { month: 'short' }),
        minutes,
      }));
  }, [data.sessions]);

  const currentWeekTime = weeklyTimeData.length > 0 ? weeklyTimeData[weeklyTimeData.length - 1]?.minutes || 0 : 0;
  const prevWeekTime = weeklyTimeData.length > 1 ? weeklyTimeData[weeklyTimeData.length - 2]?.minutes || 0 : 0;
  const latestBodyWeight = (data.bodyWeightLogs || []).sort((a, b) => b.date.localeCompare(a.date))[0];

  const chartStyle = { fontSize: 10, fill: 'hsl(240 5% 55%)' };
  const tooltipStyle = { background: 'hsl(240 5% 11%)', border: '1px solid hsl(240 4% 20%)', borderRadius: 12, fontSize: 12 };
  const noData = data.sessions.length === 0;
  const activeTypes = data.workoutTypes.filter(t => !t.hidden);

  return (
    <div className="px-4 pt-12 pb-24 animate-slide-up">
      <h1 className="text-2xl font-bold text-foreground mb-6">Stats</h1>

      {noData && (
        <div className="glass-card p-8 text-center">
          <p className="text-muted-foreground">Complete your first workout to see stats here!</p>
        </div>
      )}

      {/* Latest body weight */}
      {latestBodyWeight && (
        <div className="glass-card p-4 mb-4 flex items-center gap-3">
          <Scale size={18} className="text-primary" />
          <div>
            <p className="text-2xl font-bold text-foreground">{latestBodyWeight.weight} kg</p>
            <p className="text-[10px] text-muted-foreground">
              Body weight — {new Date(latestBodyWeight.date).toLocaleDateString('default', { month: 'short', day: 'numeric' })}
            </p>
          </div>
        </div>
      )}

      {/* Squat PR — isolated */}
      {squatPR && (
        <div className="glass-card p-4 mb-4 border border-warning/40 bg-warning/5">
          <div className="flex items-center gap-2 mb-2">
            <Crown size={16} className="text-warning" />
            <h3 className="text-sm font-semibold text-foreground">Record Squat</h3>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-warning">{squatPR.e1rm} kg</span>
            <span className="text-sm text-muted-foreground">1RM théorique</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {squatPR.reps} × {squatPR.weight} kg — il y a {daysAgo(squatPR.date)} jour{daysAgo(squatPR.date) > 1 ? 's' : ''}
          </p>
        </div>
      )}

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
            <h3 className="text-sm font-semibold text-foreground">Weekly Sessions</h3>
            <div className="flex gap-1">
              {([['4', '4w'], ['16', '16w'], ['all', 'All']] as const).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setWeeklyRange(v)}
                  className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                    weeklyRange === v ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
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
          <h3 className="text-sm font-semibold text-foreground mb-3">Session Volume (kg)</h3>
          <div className="flex gap-1 mb-3 flex-wrap">
            <button
              onClick={() => setVolumeFilter(null)}
              className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                !volumeFilter ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
              }`}
            >
              All
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
            <p className="text-xs text-muted-foreground text-center py-8">No data for this session type</p>
          )}
        </div>
      )}

      {/* Difficulty Over Time */}
      {difficultyData.length > 0 && (
        <div className="glass-card p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">Perceived Effort (RPE /5)</h3>
          </div>
          <div className="flex gap-1 mb-3 flex-wrap">
            <button
              onClick={() => setDifficultyFilter(null)}
              className={`px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                !difficultyFilter ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
              }`}
            >
              All
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
          <h3 className="text-sm font-semibold text-foreground mb-2">Weekly Training Time</h3>
          <div className="flex gap-4 mb-3">
            <div className="text-center">
              <p className="text-lg font-bold text-foreground">{currentWeekTime} min</p>
              <p className="text-[10px] text-muted-foreground">This week</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-muted-foreground">{prevWeekTime} min</p>
              <p className="text-[10px] text-muted-foreground">Last week</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={weeklyTimeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 4% 20%)" />
              <XAxis dataKey="week" tick={chartStyle} axisLine={false} tickLine={false} />
              <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={35} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'hsl(0 0% 95%)' }} formatter={(value: number) => [`${value} min`, 'Time']} />
              <Bar dataKey="minutes" fill="hsl(174 72% 46%)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Monthly Training Time */}
      {monthlyTimeData.length > 0 && (
        <div className="glass-card p-4 mb-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Monthly Training Time</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={monthlyTimeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 4% 20%)" />
              <XAxis dataKey="month" tick={chartStyle} axisLine={false} tickLine={false} />
              <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={35} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'hsl(0 0% 95%)' }} formatter={(value: number) => [`${value} min`, 'Time']} />
              <Bar dataKey="minutes" fill="hsl(38 92% 50%)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default StatsTab;
