import { useMemo } from 'react';
import { AppData } from '@/lib/types';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts';

interface StatsTabProps {
  data: AppData;
}

const StatsTab = ({ data }: StatsTabProps) => {
  // TM progression
  const tmData = useMemo(() => {
    const points = [];
    let tm = data.fiveThreeOne.trainingMax;
    const cycle = data.fiveThreeOne.currentCycle;
    // Show historical TM (working backward)
    for (let c = 1; c <= cycle; c++) {
      const historicalTm = data.fiveThreeOne.trainingMax - (cycle - c) * 2.5;
      points.push({ cycle: `C${c}`, tm: Math.max(historicalTm, 0) });
    }
    if (points.length === 0) points.push({ cycle: 'C1', tm });
    return points;
  }, [data.fiveThreeOne]);

  // Weekly frequency
  const weeklyData = useMemo(() => {
    const weeks: Record<string, number> = {};
    data.sessions.forEach(s => {
      const d = new Date(s.date);
      const day = d.getDay();
      const diff = d.getDate() - (day === 0 ? 6 : day - 1);
      const monday = new Date(d.setDate(diff));
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

  // Duration
  const durationData = useMemo(() => {
    return data.sessions
      .filter(s => s.duration)
      .slice(-10)
      .map(s => ({
        date: new Date(s.date).toLocaleDateString('default', { month: 'short', day: 'numeric' }),
        duration: s.duration || 0,
      }));
  }, [data.sessions]);

  const chartStyle = {
    fontSize: 10,
    fill: 'hsl(240 5% 55%)',
  };

  const noData = data.sessions.length === 0;

  return (
    <div className="px-4 pt-12 pb-24 animate-slide-up">
      <h1 className="text-2xl font-bold text-foreground mb-6">Stats</h1>

      {noData && (
        <div className="glass-card p-8 text-center">
          <p className="text-muted-foreground">Complete your first workout to see stats here!</p>
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
            <Tooltip
              contentStyle={{ background: 'hsl(240 5% 11%)', border: '1px solid hsl(240 4% 20%)', borderRadius: 12, fontSize: 12 }}
              labelStyle={{ color: 'hsl(0 0% 95%)' }}
            />
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
              <Tooltip
                contentStyle={{ background: 'hsl(240 5% 11%)', border: '1px solid hsl(240 4% 20%)', borderRadius: 12, fontSize: 12 }}
                labelStyle={{ color: 'hsl(0 0% 95%)' }}
              />
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
              <Tooltip
                contentStyle={{ background: 'hsl(240 5% 11%)', border: '1px solid hsl(240 4% 20%)', borderRadius: 12, fontSize: 12 }}
                labelStyle={{ color: 'hsl(0 0% 95%)' }}
              />
              <Line type="monotone" dataKey="volume" stroke="hsl(330 81% 60%)" strokeWidth={2.5} dot={{ r: 3, fill: 'hsl(330 81% 60%)' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Duration */}
      {durationData.length > 0 && (
        <div className="glass-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Session Duration (min)</h3>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={durationData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 4% 20%)" />
              <XAxis dataKey="date" tick={chartStyle} axisLine={false} tickLine={false} />
              <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={35} />
              <Tooltip
                contentStyle={{ background: 'hsl(240 5% 11%)', border: '1px solid hsl(240 4% 20%)', borderRadius: 12, fontSize: 12 }}
                labelStyle={{ color: 'hsl(0 0% 95%)' }}
              />
              <Line type="monotone" dataKey="duration" stroke="hsl(38 92% 50%)" strokeWidth={2.5} dot={{ r: 3, fill: 'hsl(38 92% 50%)' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default StatsTab;
