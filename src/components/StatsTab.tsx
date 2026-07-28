import { useMemo, useState } from 'react';
import { AppData, SessionLog, calculate1RM, WORKOUT_COLORS, CardioActivityType, resolveProgramName } from '@/lib/types';
import { normalizeExerciseName } from '@/lib/exerciseNormalize';
import { calculatePaceMinPerKm, formatCardioDuration, formatPace, formatCardioDistance } from '@/lib/cardio';
import { Trophy, Scale, Crown, ChevronDown, Search, X, Plus } from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts';
import RangeButtons, { RangeFilter, rangeWeeks, rangeCutoffDate } from './RangeButtons';
import ExerciseHistory from './ExerciseHistory';
import SessionDetailView from './SessionDetailView';

interface StatsTabProps {
  data: AppData;
  onUpdateSession: (updated: SessionLog) => void;
  onDeleteSession?: (sessionId: string) => void;
}

type PR = { name: string; e1rm: number; weight: number; reps: number; date: string };
type DotRenderProps = { cx: number; cy: number; index: number; payload: { id: string; programName?: string; isCardio?: boolean } };
type E1rmDotProps = { cx: number; cy: number; index: number; payload: { date: number; e1rm: number; weight: number; reps: number } };

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
const rangeMonths = (range: RangeFilter): number | null => (range === '1m' ? 1 : range === '3m' ? 3 : null);

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

const StatsTab = ({ data, onUpdateSession, onDeleteSession }: StatsTabProps) => {
  const [volumeFilter, setVolumeFilter] = useState<string | null>(null);
  const [weeklyRange, setWeeklyRange] = useState<RangeFilter>('all');
  const [volumeRange, setVolumeRange] = useState<RangeFilter>('3m');
  const [difficultyRange, setDifficultyRange] = useState<RangeFilter>('3m');
  const [difficultySourceFilter, setDifficultySourceFilter] = useState<'all' | 'strength' | 'cardio'>('all');
  const [paceRange, setPaceRange] = useState<RangeFilter>('3m');
  const [paceActivityFilter, setPaceActivityFilter] = useState<CardioActivityType | null>(null);
  const [weeklyTimeRange, setWeeklyTimeRange] = useState<RangeFilter>('all');
  const [monthlyTimeRange, setMonthlyTimeRange] = useState<RangeFilter>('all');
  const [e1rmOpen, setE1rmOpen] = useState(false);
  const [selectedE1rmPoint, setSelectedE1rmPoint] = useState<Record<string, E1rmDotProps['payload']>>({});
  const [historyExercise, setHistoryExercise] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [viewingSession, setViewingSession] = useState<SessionLog | null>(null);
  const [previewSessionId, setPreviewSessionId] = useState<{ chart: 'volume' | 'difficulty'; id: string; cx: number; cy: number } | null>(null);

  // Every distinct exercise name ever logged, regardless of weight (so bodyweight-only
  // tractions/dips are searchable too) — the candidate list for "rechercher un exercice".
  const allLoggedExerciseNames = useMemo(() => {
    const set = new Set<string>();
    data.sessions.forEach(session => session.sets.forEach(s => set.add(normalizeExerciseName(s.exerciseName))));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [data.sessions]);

  const searchResults = useMemo(() => {
    const q = exerciseSearch.trim().toLowerCase();
    if (!q) return [];
    return allLoggedExerciseNames.filter(n => n.toLowerCase().includes(q)).slice(0, 8);
  }, [allLoggedExerciseNames, exerciseSearch]);

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

  // Evolution of the best e1RM reached in each session, for every exercise that has
  // an active 5/3/1 / Cluster / EMOM method — one line chart each so she can see whether
  // the structured programming is actually driving progress.
  const methodE1rmEvolution = useMemo(() => {
    const byName: Record<string, { date: string; e1rm: number; weight: number; reps: number }[]> = {};
    methodExerciseNames.forEach(name => { byName[name] = []; });
    data.sessions.forEach(session => {
      const bestByName: Record<string, { e1rm: number; weight: number; reps: number }> = {};
      session.sets.forEach(s => {
        if (!s.completed || s.weight <= 0 || s.reps <= 0) return;
        const canon = normalizeExerciseName(s.exerciseName);
        if (!methodExerciseNames.has(canon)) return;
        const e1 = calculate1RM(s.weight, s.reps);
        if (!bestByName[canon] || e1 > bestByName[canon].e1rm) bestByName[canon] = { e1rm: e1, weight: s.weight, reps: s.reps };
      });
      Object.entries(bestByName).forEach(([name, best]) => {
        byName[name].push({ date: session.date, ...best });
      });
    });
    return Object.entries(byName)
      .filter(([, points]) => points.length >= 2)
      .map(([name, points]) => ({
        name,
        points: points
          .sort((a, b) => a.date.localeCompare(b.date))
          .map(p => ({ date: new Date(p.date).getTime(), e1rm: p.e1rm, weight: p.weight, reps: p.reps })),
      }));
  }, [methodExerciseNames, data.sessions]);

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

  // Tonnage per session (filterable by session NAME + time range — grouped by name rather
  // than by workoutTypeId so that e.g. "Push" from an older program and "Push" from the
  // current one land under the same filter button and can be compared, each point still
  // carrying its own programName for the tooltip/dot color below).
  const volumeData = useMemo(() => {
    const cutoff = rangeCutoffDate(volumeRange);
    return data.sessions
      .filter(s => !volumeFilter || s.workoutTypeName === volumeFilter)
      .filter(s => !cutoff || new Date(s.date + 'T00:00:00') >= cutoff)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(s => {
        const volume = s.sets.reduce((acc, set) => acc + set.reps * set.weight, 0);
        return {
          id: s.id,
          date: new Date(s.date).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' }),
          volume,
          type: s.workoutTypeName,
          programName: resolveProgramName(s, data),
        };
      });
  }, [data, volumeFilter, volumeRange]);

  // Assigns a stable color per distinct programName encountered (in order of first
  // appearance) so points from different programs are visually distinguishable at a glance.
  // `startIndex` lets a caller reserve the first palette slot(s) for something else — the
  // RPE chart reserves accent-blue (index 0) for cardio, so a program can never coincidentally
  // land on the exact same hue used for the cardio marker.
  const programColorFor = (points: { programName?: string }[], startIndex = 0) => {
    const colors = new Map<string, string>();
    points.forEach(p => {
      if (p.programName && !colors.has(p.programName)) {
        colors.set(p.programName, WORKOUT_COLORS[(startIndex + colors.size) % WORKOUT_COLORS.length]);
      }
    });
    return colors;
  };
  const volumeProgramColors = useMemo(() => programColorFor(volumeData), [volumeData]);

  // Difficulty over time — cardio isn't counted in weeklyGoal/tonnage, but RPE is
  // tracked on the same /10 scale — worth seeing on the same effort-over-time chart,
  // just visually distinct (cardio's accent-blue vs a program color) so the two aren't
  // mistaken for each other.
  const difficultyData = useMemo(() => {
    const cutoff = rangeCutoffDate(difficultyRange);
    const strengthPoints = difficultySourceFilter === 'cardio' ? [] : data.sessions
      .filter(s => s.difficulty && s.difficulty > 0)
      .filter(s => !cutoff || new Date(s.date + 'T00:00:00') >= cutoff)
      .map(s => ({ rawDate: s.date, id: s.id, difficulty: s.difficulty || 0, type: s.workoutTypeName, programName: resolveProgramName(s, data), isCardio: false }));
    const cardioPoints = difficultySourceFilter === 'strength' ? [] : (data.cardioSessions || [])
      .filter(s => s.difficulty && s.difficulty > 0)
      .filter(s => !cutoff || new Date(s.date + 'T00:00:00') >= cutoff)
      .map(s => ({ rawDate: s.date, id: s.id, difficulty: s.difficulty || 0, type: s.activityType, programName: undefined as string | undefined, isCardio: true }));
    return [...strengthPoints, ...cardioPoints]
      .sort((a, b) => a.rawDate.localeCompare(b.rawDate))
      .map(p => ({
        id: p.id,
        date: new Date(p.rawDate).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' }),
        difficulty: p.difficulty,
        type: p.type,
        programName: p.programName,
        isCardio: p.isCardio,
      }));
  }, [data, difficultyRange, difficultySourceFilter]);
  const difficultyProgramColors = useMemo(() => programColorFor(difficultyData, 1), [difficultyData]);

  const cardioActivityTypesPresent = useMemo(() => {
    const set = new Set<CardioActivityType>();
    (data.cardioSessions || []).forEach(s => set.add(s.activityType));
    return Array.from(set);
  }, [data.cardioSessions]);

  // Pace only exists for sessions with a distance logged (it's optional) — everything
  // without one just doesn't have a point on this chart.
  const paceData = useMemo(() => {
    const cutoff = rangeCutoffDate(paceRange);
    return (data.cardioSessions || [])
      .filter(s => !paceActivityFilter || s.activityType === paceActivityFilter)
      .filter(s => !cutoff || new Date(s.date + 'T00:00:00') >= cutoff)
      .map(s => ({ rawDate: s.date, pace: calculatePaceMinPerKm(s.durationMinutes, s.distanceKm), activityType: s.activityType }))
      .filter((p): p is { rawDate: string; pace: number; activityType: CardioActivityType } => p.pace !== null)
      .sort((a, b) => a.rawDate.localeCompare(b.rawDate))
      .map(p => ({
        date: new Date(p.rawDate).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' }),
        pace: Math.round(p.pace * 100) / 100,
        activityType: p.activityType,
      }));
  }, [data.cardioSessions, paceRange, paceActivityFilter]);

  // Weekly training time — include empty weeks. Counts both strength sessions and
  // cardio sessions, since cardio time is training time too.
  const weeklyTimeData = useMemo(() => {
    const withDuration = data.sessions.filter(s => s.duration);
    const cardioSessions = data.cardioSessions || [];
    const minutesByWeek = new Map<string, number>();
    withDuration.forEach(s => {
      const key = mondayOf(new Date(s.date + 'T00:00:00')).toISOString().split('T')[0];
      minutesByWeek.set(key, (minutesByWeek.get(key) || 0) + (s.duration || 0));
    });
    cardioSessions.forEach(s => {
      const key = mondayOf(new Date(s.date + 'T00:00:00')).toISOString().split('T')[0];
      minutesByWeek.set(key, (minutesByWeek.get(key) || 0) + s.durationMinutes);
    });
    return weekRangeMondays(weeklyTimeRange, [...withDuration.map(s => s.date), ...cardioSessions.map(s => s.date)]).map(m => {
      const key = m.toISOString().split('T')[0];
      return {
        week: m.toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' }),
        minutes: minutesByWeek.get(key) || 0,
      };
    });
  }, [data.sessions, data.cardioSessions, weeklyTimeRange]);

  // Monthly training time — same, strength + cardio combined.
  const monthlyTimeData = useMemo(() => {
    const months: Record<string, number> = {};
    data.sessions.filter(s => s.duration).forEach(s => {
      const d = new Date(s.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months[key] = (months[key] || 0) + (s.duration || 0);
    });
    (data.cardioSessions || []).forEach(s => {
      const d = new Date(s.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months[key] = (months[key] || 0) + s.durationMinutes;
    });
    const entries = Object.entries(months).sort(([a], [b]) => a.localeCompare(b));
    const n = rangeMonths(monthlyTimeRange);
    const sliced = n === null ? entries : entries.slice(-n);
    return sliced.map(([month, minutes]) => ({
      month: new Date(month + '-01').toLocaleDateString('fr-FR', { month: 'short' }),
      minutes,
    }));
  }, [data.sessions, data.cardioSessions, monthlyTimeRange]);

  const currentWeekTime = weeklyTimeData.length > 0 ? weeklyTimeData[weeklyTimeData.length - 1]?.minutes || 0 : 0;
  const prevWeekTime = weeklyTimeData.length > 1 ? weeklyTimeData[weeklyTimeData.length - 2]?.minutes || 0 : 0;
  const latestBodyWeight = (data.bodyWeightLogs || []).sort((a, b) => b.date.localeCompare(a.date))[0];

  const chartStyle = { fontSize: 10, fill: 'hsl(240 12% 72%)' };
  const tooltipStyle = {
    background: 'hsl(240 16% 12%)',
    border: '1px solid hsl(189 94% 55% / 0.35)',
    borderRadius: 10,
    fontSize: 12,
    boxShadow: '0 0 24px -8px hsl(189 94% 55% / 0.35)',
  };
  const noData = data.sessions.length === 0;
  const activeTypes = data.workoutTypes.filter(t => !t.hidden);
  // Deduplicated by name for the Tonnage/RPE filter buttons: a session name reused across
  // programs (e.g. "Push") should offer a single filter button, not one per program.
  const activeTypeNames = Array.from(new Set(activeTypes.map(t => t.name))).filter(Boolean);

  if (viewingSession) {
    return (
      <SessionDetailView
        session={viewingSession}
        data={data}
        onClose={() => setViewingSession(null)}
        onUpdate={(updated) => { onUpdateSession(updated); setViewingSession(null); }}
        onDelete={(sessionId) => { onDeleteSession?.(sessionId); setViewingSession(null); }}
      />
    );
  }

  if (historyExercise) {
    return <ExerciseHistory exerciseName={historyExercise} data={data} onClose={() => setHistoryExercise(null)} />;
  }

  return (
    <div className="px-4 pt-12 pb-24 animate-slide-up">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">Statistiques</h1>
        <button
          onClick={() => { setSearchOpen(v => !v); if (searchOpen) setExerciseSearch(''); }}
          className="min-h-11 min-w-11 flex items-center justify-center text-muted-foreground active:text-primary"
          aria-label="Rechercher un exercice"
          aria-pressed={searchOpen}
        >
          {searchOpen ? <X size={18} /> : <Search size={18} />}
        </button>
      </div>

      {searchOpen && (
        <div className="glass-card p-3 mb-4">
          <input
            autoFocus
            value={exerciseSearch}
            onChange={e => setExerciseSearch(e.target.value)}
            placeholder="Rechercher un exercice..."
            className="w-full bg-secondary/50 rounded-lg px-3 py-2 text-sm text-foreground outline-none"
          />
          {exerciseSearch.trim() !== '' && (
            searchResults.length > 0 ? (
              <div className="mt-2 space-y-1">
                {searchResults.map(n => (
                  <button
                    key={n}
                    onClick={() => setHistoryExercise(n)}
                    className="w-full text-left min-h-11 flex items-center px-2 rounded-lg text-sm text-foreground active:bg-secondary/60"
                  >
                    {n}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground mt-2 px-2">Aucun exercice trouvé.</p>
            )
          )}
        </div>
      )}

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
        <div key={pr.name} className="glass-card record-card p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="relative inline-flex w-4 h-4 items-center justify-center">
              <span className="absolute inset-0 bg-primary/50 rounded-full blur-sm animate-pulse-glow" />
              <Crown size={16} className="relative text-primary" />
            </span>
            <h3 className="text-sm font-semibold text-foreground">Record — {pr.name}</h3>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-primary text-glow-primary">{pr.e1rm} kg</span>
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
            <Trophy size={16} className="text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Derniers records</h3>
          </div>
          <div className="space-y-2">
            {otherPRs.map(pr => {
              const d = daysAgo(pr.date);
              return (
                <div key={pr.name} className="flex items-center justify-between bg-secondary rounded-lg px-3 py-2 border border-primary/15">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground truncate">{pr.name}</p>
                    <p className="text-[10px] text-muted-foreground">Il y a {d} jour{d > 1 ? 's' : ''}</p>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <span className="text-sm font-bold text-primary">{pr.reps} × {pr.weight} kg</span>
                    <p className="text-[10px] text-muted-foreground">1RM {pr.e1rm} kg</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 1RM evolution per exercise with an active method */}
      {methodE1rmEvolution.length > 0 && (
        <div className="glass-card mb-4 overflow-hidden">
          <button
            onClick={() => setE1rmOpen(v => !v)}
            className="w-full flex items-center justify-between p-4 touch-target"
          >
            <span className="text-sm font-semibold text-foreground">Progression 1RM (méthodes)</span>
            <ChevronDown size={16} className={`text-muted-foreground transition-transform ${e1rmOpen ? 'rotate-180' : ''}`} />
          </button>
          {e1rmOpen && (
          <div className="px-4 pb-4 space-y-4">
            {methodE1rmEvolution.map(({ name, points }) => (
              <div key={name}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-foreground">{name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {points[0].e1rm} → <span className="text-primary font-bold">{points[points.length - 1].e1rm}</span> kg
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={100}>
                  <LineChart data={points} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 12% 20%)" />
                    <XAxis
                      dataKey="date"
                      type="number"
                      domain={['dataMin', 'dataMax']}
                      scale="time"
                      tickFormatter={(ts: number) => new Date(ts).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })}
                      tick={chartStyle} axisLine={false} tickLine={false}
                    />
                    <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={30} domain={['auto', 'auto']} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={{ color: 'hsl(0 0% 95%)' }}
                      formatter={(v: number, _name: string, item: { payload: E1rmDotProps['payload'] }) =>
                        [`${v} kg (${item.payload.weight} kg × ${item.payload.reps})`, '1RM']
                      }
                      labelFormatter={(ts: number) => new Date(ts).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })}
                    />
                    <Line
                      type="monotone"
                      dataKey="e1rm"
                      stroke="hsl(322 100% 60%)"
                      strokeWidth={2.5}
                      dot={(props: E1rmDotProps) => (
                        <circle
                          key={`e1rm-dot-${name}-${props.index}`}
                          cx={props.cx}
                          cy={props.cy}
                          r={2}
                          fill="hsl(322 100% 60%)"
                          onClick={() => setSelectedE1rmPoint(prev => ({ ...prev, [name]: props.payload }))}
                          style={{ cursor: 'pointer' }}
                        />
                      )}
                      style={{ filter: 'drop-shadow(0 0 5px hsl(322 100% 60% / 0.7))' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
                {selectedE1rmPoint[name] && (
                  <p className="text-[10px] text-primary font-medium text-center mt-1">
                    {new Date(selectedE1rmPoint[name].date).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })} : {selectedE1rmPoint[name].weight} kg × {selectedE1rmPoint[name].reps}
                  </p>
                )}
              </div>
            ))}
          </div>
          )}
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
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 12% 20%)" />
              <XAxis dataKey="week" tick={chartStyle} axisLine={false} tickLine={false} />
              <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'hsl(0 0% 95%)' }} />
              <ReferenceLine y={data.weeklyGoal} stroke="hsl(38 92% 52%)" strokeDasharray="4 4" strokeWidth={1.5} />
              <Bar
                dataKey="sessions"
                fill="hsl(189 94% 55%)"
                radius={[4, 4, 0, 0]}
                style={{ filter: 'drop-shadow(0 0 5px hsl(189 94% 55% / 0.55))' }}
              />
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
              className={`touch-target inline-flex items-center justify-center px-2 rounded-lg text-[10px] font-medium transition-colors ${
                !volumeFilter ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
              }`}
            >
              Tout
            </button>
            {activeTypeNames.map(name => (
              <button
                key={name}
                onClick={() => setVolumeFilter(name)}
                className={`touch-target inline-flex items-center justify-center px-2 rounded-lg text-[10px] font-medium transition-colors ${
                  volumeFilter === name ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
          {volumeData.length > 0 ? (
            <div className="relative">
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={volumeData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 12% 20%)" />
                  <XAxis dataKey="date" tick={chartStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={45} />
                  <Line
                    type="monotone"
                    dataKey="volume"
                    stroke="hsl(322 100% 60%)"
                    strokeWidth={2.5}
                    dot={(props: DotRenderProps) => {
                      // Neutral gray fallback (not in WORKOUT_COLORS) for points with no
                      // resolvable program — otherwise it could coincide with a real
                      // program's assigned color and become indistinguishable from it.
                      const color = volumeProgramColors.get(props.payload.programName) || '240 8% 58%';
                      return (
                        <g
                          key={`vdot-${props.index}`}
                          onClick={() => setPreviewSessionId({ chart: 'volume', id: props.payload.id, cx: props.cx, cy: props.cy })}
                          style={{ cursor: 'pointer' }}
                        >
                          {/* Invisible larger circle as the real tap target — the visible
                              3px dot alone is far too small to hit reliably with a thumb. */}
                          <circle cx={props.cx} cy={props.cy} r={14} fill="transparent" />
                          <circle cx={props.cx} cy={props.cy} r={3} fill={`hsl(${color})`} />
                        </g>
                      );
                    }}
                    style={{ filter: 'drop-shadow(0 0 5px hsl(322 100% 60% / 0.6))' }}
                  />
                </LineChart>
              </ResponsiveContainer>
              {previewSessionId?.chart === 'volume' && (() => {
                const session = data.sessions.find(s => s.id === previewSessionId.id);
                if (!session) return null;
                const point = volumeData.find(p => p.id === previewSessionId.id);
                return (
                  <div
                    style={{ left: previewSessionId.cx, top: previewSessionId.cy, transform: 'translate(-50%, calc(-100% - 10px))' }}
                    className="absolute z-10 w-36"
                  >
                    <div style={tooltipStyle} className="px-2 py-1.5 relative">
                      <button
                        onClick={() => setPreviewSessionId(null)}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-secondary flex items-center justify-center text-muted-foreground"
                        aria-label="Fermer"
                      >
                        <X size={9} />
                      </button>
                      <p style={{ color: 'hsl(0 0% 95%)' }} className="text-[11px] mb-0.5">{point?.date}</p>
                      <p className="text-xs font-semibold mb-1" style={{ color: 'hsl(322 100% 60%)' }}>{point?.volume} kg</p>
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="min-w-0">
                          <p className="text-[9px] text-foreground/80 truncate">{session.workoutTypeName}</p>
                          {resolveProgramName(session, data) && <p className="text-[8px] text-muted-foreground truncate">{resolveProgramName(session, data)}</p>}
                        </div>
                        <button
                          onClick={() => { setViewingSession(session); setPreviewSessionId(null); }}
                          className="shrink-0 w-6 h-6 flex items-center justify-center bg-primary/80 text-primary-foreground rounded-md"
                          aria-label="Voir la séance complète"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-8">Aucune donnée pour ce type de séance</p>
          )}
        </div>
      )}

      {/* Difficulty Over Time */}
      {(data.sessions.some(s => s.difficulty && s.difficulty > 0) ||
        (data.cardioSessions || []).some(s => s.difficulty && s.difficulty > 0)) && (
        <div className="glass-card p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">Effort perçu (RPE /10)</h3>
            <RangeButtons value={difficultyRange} onChange={setDifficultyRange} />
          </div>
          <div className="flex gap-1 mb-3">
            {([['all', 'Tout'], ['strength', 'Muscu'], ['cardio', 'Cardio']] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setDifficultySourceFilter(key)}
                className={`touch-target inline-flex items-center justify-center px-2 rounded-lg text-[10px] font-medium transition-colors ${
                  difficultySourceFilter === key ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {difficultyData.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">Aucune donnée pour ce filtre</p>
          ) : (
          <div className="relative">
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={difficultyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 12% 20%)" />
                <XAxis dataKey="date" tick={chartStyle} axisLine={false} tickLine={false} />
                <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={30} domain={[0, 10]} />
                <Line
                  type="monotone"
                  dataKey="difficulty"
                  stroke="hsl(262 83% 66%)"
                  strokeWidth={2.5}
                  dot={(props: DotRenderProps) => {
                    const color = props.payload.isCardio ? '189 94% 55%' : (difficultyProgramColors.get(props.payload.programName) || '240 8% 58%');
                    return (
                      <g
                        key={`ddot-${props.index}`}
                        onClick={() => setPreviewSessionId({ chart: 'difficulty', id: props.payload.id, cx: props.cx, cy: props.cy })}
                        style={{ cursor: 'pointer' }}
                      >
                        <circle cx={props.cx} cy={props.cy} r={14} fill="transparent" />
                        <circle cx={props.cx} cy={props.cy} r={3} fill={`hsl(${color})`} />
                      </g>
                    );
                  }}
                  style={{ filter: 'drop-shadow(0 0 5px hsl(262 83% 66% / 0.6))' }}
                />
              </LineChart>
            </ResponsiveContainer>
            {previewSessionId?.chart === 'difficulty' && (() => {
              const point = difficultyData.find(p => p.id === previewSessionId.id);
              if (!point) return null;
              const session = point.isCardio ? undefined : data.sessions.find(s => s.id === previewSessionId.id);
              const cardio = point.isCardio ? (data.cardioSessions || []).find(s => s.id === previewSessionId.id) : undefined;
              if (!session && !cardio) return null;
              const dotColor = point.isCardio ? 'hsl(189 94% 55%)' : 'hsl(262 83% 66%)';
              return (
                <div
                  style={{ left: previewSessionId.cx, top: previewSessionId.cy, transform: 'translate(-50%, calc(-100% - 10px))' }}
                  className="absolute z-10 w-36"
                >
                  <div style={tooltipStyle} className="px-2 py-1.5 relative">
                    <button
                      onClick={() => setPreviewSessionId(null)}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-secondary flex items-center justify-center text-muted-foreground"
                      aria-label="Fermer"
                    >
                      <X size={9} />
                    </button>
                    <p style={{ color: 'hsl(0 0% 95%)' }} className="text-[11px] mb-0.5">{point.date}</p>
                    <p className="text-xs font-semibold mb-1" style={{ color: dotColor }}>RPE {point.difficulty}/10</p>
                    {session && (
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="min-w-0">
                          <p className="text-[9px] text-foreground/80 truncate">{session.workoutTypeName}</p>
                          {resolveProgramName(session, data) && <p className="text-[8px] text-muted-foreground truncate">{resolveProgramName(session, data)}</p>}
                        </div>
                        <button
                          onClick={() => { setViewingSession(session); setPreviewSessionId(null); }}
                          className="shrink-0 w-6 h-6 flex items-center justify-center bg-primary/80 text-primary-foreground rounded-md"
                          aria-label="Voir la séance complète"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    )}
                    {cardio && (
                      <p className="text-[9px] text-foreground/80">
                        {cardio.activityType === 'Autre' ? (cardio.customActivityLabel || 'Autre') : cardio.activityType} · {formatCardioDuration(cardio.durationMinutes)}
                        {cardio.distanceKm !== undefined && ` · ${formatCardioDistance(cardio.distanceKm, cardio.activityType)}`}
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
          )}
        </div>
      )}

      {/* Cardio Pace Over Time — only sessions with a distance logged have a point here */}
      {cardioActivityTypesPresent.length > 0 && (
        <div className="glass-card p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">Allure cardio (min/km)</h3>
            <RangeButtons value={paceRange} onChange={setPaceRange} />
          </div>
          <div className="flex gap-1 mb-3 flex-wrap">
            <button
              onClick={() => setPaceActivityFilter(null)}
              className={`touch-target inline-flex items-center justify-center px-2 rounded-lg text-[10px] font-medium transition-colors ${
                !paceActivityFilter ? 'bg-accent-blue text-primary-foreground' : 'bg-secondary text-muted-foreground'
              }`}
            >
              Tout
            </button>
            {cardioActivityTypesPresent.map(type => (
              <button
                key={type}
                onClick={() => setPaceActivityFilter(type)}
                className={`touch-target inline-flex items-center justify-center px-2 rounded-lg text-[10px] font-medium transition-colors ${
                  paceActivityFilter === type ? 'bg-accent-blue text-primary-foreground' : 'bg-secondary text-muted-foreground'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
          {paceData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={paceData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 12% 20%)" />
                <XAxis dataKey="date" tick={chartStyle} axisLine={false} tickLine={false} />
                <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={35} tickFormatter={(v: number) => v.toFixed(1)} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelStyle={{ color: 'hsl(0 0% 95%)' }}
                  formatter={(v: number) => [formatPace(v), 'Allure']}
                />
                <Line
                  type="monotone"
                  dataKey="pace"
                  stroke="hsl(189 94% 55%)"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: 'hsl(189 94% 55%)' }}
                  style={{ filter: 'drop-shadow(0 0 5px hsl(189 94% 55% / 0.6))' }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-8">Aucune séance avec une distance renseignée pour ce filtre</p>
          )}
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
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 12% 20%)" />
              <XAxis dataKey="week" tick={chartStyle} axisLine={false} tickLine={false} />
              <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={35} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'hsl(0 0% 95%)' }} formatter={(value: number) => [formatHM(value), 'Temps']} />
              <Bar
                dataKey="minutes"
                fill="hsl(189 94% 55%)"
                radius={[4, 4, 0, 0]}
                style={{ filter: 'drop-shadow(0 0 5px hsl(189 94% 55% / 0.55))' }}
              />
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
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(240 12% 20%)" />
              <XAxis dataKey="month" tick={chartStyle} axisLine={false} tickLine={false} />
              <YAxis tick={chartStyle} axisLine={false} tickLine={false} width={35} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'hsl(0 0% 95%)' }} formatter={(value: number) => [formatHM(value), 'Temps']} />
              <Bar
                dataKey="minutes"
                fill="hsl(262 83% 66%)"
                radius={[4, 4, 0, 0]}
                style={{ filter: 'drop-shadow(0 0 5px hsl(262 83% 66% / 0.5))' }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default StatsTab;
