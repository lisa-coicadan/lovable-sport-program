import { useMemo } from 'react';
import { AppData, calculate1RM } from '@/lib/types';
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

const ExerciseHistory = ({ exerciseName, data, onClose }: ExerciseHistoryProps) => {
  const history = useMemo(() => {
    const entries: HistoryEntry[] = [];
    data.sessions
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach(session => {
        const matchingSets = session.sets.filter(
          s => s.exerciseName === exerciseName && s.completed && s.weight > 0
        );
        matchingSets.forEach(s => {
          entries.push({
            date: session.date,
            weight: s.weight,
            reps: s.reps,
            e1rm: calculate1RM(s.weight, s.reps),
          });
        });
      });
    return entries;
  }, [data.sessions, exerciseName]);

  const chartData = useMemo(() => {
    const byDate: Record<string, number> = {};
    history.forEach(h => {
      if (!byDate[h.date] || h.e1rm > byDate[h.date]) {
        byDate[h.date] = h.e1rm;
      }
    });
    return Object.entries(byDate).map(([date, e1rm]) => ({
      date: new Date(date).toLocaleDateString('default', { month: 'short', day: 'numeric' }),
      e1rm,
    }));
  }, [history]);

  const currentPR = history.length > 0 ? Math.max(...history.map(h => h.e1rm)) : 0;
  const chartStyle = { fontSize: 10, fill: 'hsl(240 5% 55%)' };

  const groupedByDate = useMemo(() => {
    const map: Record<string, HistoryEntry[]> = {};
    history.forEach(h => {
      if (!map[h.date]) map[h.date] = [];
      map[h.date].push(h);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [history]);

  return (
    <div className="px-4 pt-12 pb-24 animate-slide-up">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onClose} className="text-muted-foreground touch-target p-1">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-foreground">{exerciseName}</h1>
          {currentPR > 0 && (
            <p className="text-xs text-warning font-medium">PR: {currentPR} kg (est. 1RM)</p>
          )}
        </div>
      </div>

      {chartData.length > 1 && (
        <div className="glass-card p-4 mb-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Estimated 1RM Trend</h3>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 4% 20%)" />
              <XAxis dataKey="date" tick={chartStyle} axisLine={false} tickLine={false} />
              <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={40} />
              <Tooltip
                contentStyle={{ background: 'hsl(240 5% 11%)', border: '1px solid hsl(240 4% 20%)', borderRadius: 12, fontSize: 12 }}
                labelStyle={{ color: 'hsl(0 0% 95%)' }}
              />
              <Line type="monotone" dataKey="e1rm" stroke="hsl(38 92% 50%)" strokeWidth={2.5} dot={{ r: 3, fill: 'hsl(38 92% 50%)' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {history.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <p className="text-muted-foreground">No history yet for this exercise.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groupedByDate.map(([date, sets]) => (
            <div key={date} className="glass-card p-4">
              <p className="text-xs text-muted-foreground mb-2">
                {new Date(date + 'T00:00:00').toLocaleDateString('default', { weekday: 'short', month: 'long', day: 'numeric' })}
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
      )}
    </div>
  );
};

export default ExerciseHistory;
