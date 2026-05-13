import { useMemo, useState } from 'react';
import { AppData, calculate1RM } from '@/lib/types';
import { normalizeExerciseName, isPrTracked } from '@/lib/exerciseNormalize';
import { Trophy, Scale } from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts';

interface StatsTabProps {
  data: AppData;
}

const StatsTab = ({ data }: StatsTabProps) => {
  const [difficultyFilter, setDifficultyFilter] = useState<string | null>(null);

  // Personal Records — only tracked canonical exercises (Tractions lestées, Dips lestés, Squat, Développé couché)
  const personalRecords = useMemo(() => {
    const prMap: Record<string, { e1rm: number; weight: number; reps: number; date: string }> = {};
    data.sessions.forEach(session => {
      session.sets.filter(s => s.completed && s.weight > 0).forEach(s => {
        if (!isPrTracked(s.exerciseName)) return;
        const canonical = normalizeExerciseName(s.exerciseName);
        const e1rm = calculate1RM(s.weight, s.reps);
        if (!prMap[canonical] || e1rm > prMap[canonical].e1rm) {
          prMap[canonical] = { e1rm, weight: s.weight, reps: s.reps, date: session.date };
        }
      });
    });
    return Object.entries(prMap).sort(([, a], [, b]) => b.e1rm - a.e1rm);
  }, [data.sessions]);

  // TM progression
  const tmData = useMemo(() => {
    const points = [];
    const cycle = data.fiveThreeOne.currentCycle;
    for (let c = 1; c <= cycle; c++) {
      const historicalTm = data.fiveThreeOne.trainingMax - (cycle - c) * 2.5;
      points.push({ cycle: `C${c}`, tm: Math.max(historicalTm, 0) });
    }
    if (points.length === 0) points.push({ cycle: 'C1', tm: data.fiveThreeOne.trainingMax });
    return points;
  }, [data.fiveThreeOne]);

  // Weekly frequency
  const weeklyData = useMemo(() => {
    const weeks: Record<string, number> = {};
    data.sessions.forEach(s => {
      const d = new Date(s.date);
      const dayOfWeek = d.getDay();
      const diff = d.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
      const monday = new Date(d);
      monday.setDate(diff);
      const key = monday.toISOString().split('T')[0];
      weeks[key] = (weeks[key] || 0) + 1;
    });
    return Object.entries(weeks)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-8)
      .map(([week, count]) => ({
        week: new Date(week).toLocaleDateString('default', { month: 'short', day: 'numeric' }),
        sessions: count,
        goal: data.weeklyGoal,
      }));
  }, [data.sessions, data.weeklyGoal]);

  // Volume per session
  const volumeData = useMemo(() => {
    return data.sessions.slice(-10).map(s => {
      const volume = s.sets.reduce((acc, set) => acc + set.reps * set.weight, 0);
      return {
        date: new Date(s.date).toLocaleDateString('default', { month: 'short', day: 'numeric' }),
        volume,
        type: s.workoutTypeName,
      };
    });
  }, [data.sessions]);

  // Difficulty over time
  const difficultyData = useMemo(() => {
    return data.sessions
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

  // Body weight data
  const bodyWeightData = useMemo(() => {
    return (data.bodyWeightLogs || [])
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(l => ({
        date: new Date(l.date).toLocaleDateString('default', { month: 'short', day: 'numeric' }),
        weight: l.weight,
      }));
  }, [data.bodyWeightLogs]);

  // (Body weight vs Squat TM correlation removed per user request)

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

      {/* Personal Records */}
      {personalRecords.length > 0 && (
        <div className="glass-card p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Trophy size={16} className="text-warning" />
            <h3 className="text-sm font-semibold text-foreground">Personal Records</h3>
          </div>
          <div className="space-y-2">
            {personalRecords.slice(0, 6).map(([name, pr]) => (
              <div key={name} className="flex items-center justify-between bg-secondary rounded-lg px-3 py-2">
                <span className="text-sm text-foreground">{name}</span>
                <div className="text-right">
                  <span className="text-sm font-bold text-warning">{pr.e1rm} kg</span>
                  <span className="text-[10px] text-muted-foreground ml-2">({pr.weight}×{pr.reps})</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TM Progression */}
      <div className="glass-card p-4 mb-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Squat TM Progression</h3>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={tmData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 4% 20%)" />
            <XAxis dataKey="cycle" tick={chartStyle} axisLine={false} tickLine={false} />
            <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={40} />
            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'hsl(0 0% 95%)' }} />
            <Line type="monotone" dataKey="tm" stroke="hsl(84 81% 44%)" strokeWidth={2.5} dot={{ r: 4, fill: 'hsl(84 81% 44%)' }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Weekly Frequency */}
      {weeklyData.length > 0 && (
        <div className="glass-card p-4 mb-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Weekly Sessions</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={weeklyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 4% 20%)" />
              <XAxis dataKey="week" tick={chartStyle} axisLine={false} tickLine={false} />
              <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={30} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'hsl(0 0% 95%)' }} />
              <ReferenceLine y={data.weeklyGoal} stroke="hsl(84 81% 44%)" strokeDasharray="4 4" strokeWidth={1.5} />
              <Bar dataKey="sessions" fill="hsl(199 89% 48%)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Volume */}
      {volumeData.length > 0 && (
        <div className="glass-card p-4 mb-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Session Volume (kg)</h3>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={volumeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 4% 20%)" />
              <XAxis dataKey="date" tick={chartStyle} axisLine={false} tickLine={false} />
              <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={45} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'hsl(0 0% 95%)' }} />
              <Line type="monotone" dataKey="volume" stroke="hsl(330 81% 60%)" strokeWidth={2.5} dot={{ r: 3, fill: 'hsl(330 81% 60%)' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Difficulty Over Time */}
      {difficultyData.length > 0 && (
        <div className="glass-card p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">Perceived Effort (RPE)</h3>
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
              <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={30} domain={[0, 10]} />
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

      {/* Body Weight Over Time */}
      {bodyWeightData.length > 1 && (
        <div className="glass-card p-4 mb-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Body Weight</h3>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={bodyWeightData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 4% 20%)" />
              <XAxis dataKey="date" tick={chartStyle} axisLine={false} tickLine={false} />
              <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={40} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'hsl(0 0% 95%)' }} />
              <Line type="monotone" dataKey="weight" stroke="hsl(199 89% 48%)" strokeWidth={2.5} dot={{ r: 3, fill: 'hsl(199 89% 48%)' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Body Weight vs TM Correlation */}
      {correlationData.length > 1 && (
        <div className="glass-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Body Weight vs Squat TM</h3>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={correlationData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 4% 20%)" />
              <XAxis dataKey="date" tick={chartStyle} axisLine={false} tickLine={false} />
              <YAxis yAxisId="bw" tick={chartStyle} axisLine={false} tickLine={false} width={35} />
              <YAxis yAxisId="tm" orientation="right" tick={chartStyle} axisLine={false} tickLine={false} width={35} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'hsl(0 0% 95%)' }} />
              <Line yAxisId="bw" type="monotone" dataKey="bodyWeight" stroke="hsl(199 89% 48%)" strokeWidth={2} dot={false} name="Body Weight" />
              <Line yAxisId="tm" type="monotone" dataKey="tm" stroke="hsl(84 81% 44%)" strokeWidth={2} dot={false} name="Squat TM" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default StatsTab;
