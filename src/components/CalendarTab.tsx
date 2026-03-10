import { useState, useMemo } from 'react';
import { AppData, SessionLog } from '@/lib/types';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import SessionDetailView from './SessionDetailView';

interface CalendarTabProps {
  data: AppData;
  onDaySelect: (date: string) => void;
  onUpdateSession: (updated: SessionLog) => void;
}

const CalendarTab = ({ data, onDaySelect, onUpdateSession }: CalendarTabProps) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [viewingSession, setViewingSession] = useState<SessionLog | null>(null);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const adjustedFirst = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;

  const sessionsByDate = useMemo(() => {
    const map: Record<string, SessionLog[]> = {};
    data.sessions.forEach(s => {
      if (!map[s.date]) map[s.date] = [];
      map[s.date].push(s);
    });
    return map;
  }, [data.sessions]);

  const getColorForType = (typeId: string) => {
    const wt = data.workoutTypes.find(w => w.id === typeId);
    return wt?.color || '84 81% 44%';
  };

  // Weekly goal
  const now = new Date();
  const startOfWeek = new Date(now);
  const day = startOfWeek.getDay();
  startOfWeek.setDate(startOfWeek.getDate() - (day === 0 ? 6 : day - 1));
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  const thisWeekSessions = data.sessions.filter(s => {
    const d = new Date(s.date);
    return d >= startOfWeek && d < endOfWeek;
  });

  const weekProgress = Math.min(thisWeekSessions.length / data.weeklyGoal, 1);

  // Monthly count
  const thisMonthSessions = data.sessions.filter(s => {
    const d = new Date(s.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));
  const monthName = currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' });
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const today = new Date().toISOString().split('T')[0];

  const handleDayClick = (dateStr: string) => {
    const sessions = sessionsByDate[dateStr] || [];
    if (sessions.length > 0) {
      setSelectedDate(dateStr);
    } else {
      onDaySelect(dateStr);
    }
  };

  if (viewingSession) {
    return (
      <SessionDetailView
        session={viewingSession}
        onClose={() => setViewingSession(null)}
        onUpdate={(updated) => {
          onUpdateSession(updated);
          setViewingSession(null);
        }}
      />
    );
  }

  if (selectedDate) {
    const daySessions = sessionsByDate[selectedDate] || [];
    return (
      <div className="px-4 pt-12 pb-24 animate-slide-up">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setSelectedDate(null)} className="text-muted-foreground touch-target p-1">
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-xl font-bold text-foreground">
            {new Date(selectedDate + 'T00:00:00').toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' })}
          </h1>
        </div>
        <div className="space-y-3">
          {daySessions.map(session => (
            <button
              key={session.id}
              onClick={() => setViewingSession(session)}
              className="w-full glass-card p-4 text-left transition-transform active:scale-[0.98]"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `hsl(${getColorForType(session.workoutTypeId)})` }} />
                <span className="text-foreground font-semibold">{session.workoutTypeName}</span>
                <ChevronRight size={16} className="text-muted-foreground ml-auto" />
              </div>
              <div className="flex gap-4 text-xs text-muted-foreground">
                {session.duration && <span>{session.duration} min</span>}
                <span>{session.sets.filter(s => s.completed).length}/{session.sets.length} sets</span>
                {session.difficulty && <span>RPE {session.difficulty}/10</span>}
              </div>
              {session.notes && (
                <p className="text-xs text-muted-foreground mt-2 line-clamp-1">{session.notes}</p>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-12 pb-24 animate-slide-up">
      <h1 className="text-2xl font-bold text-foreground mb-4">Calendar</h1>

      {/* Weekly + Monthly progress side by side */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {/* Weekly */}
        <div className="glass-card p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-medium text-muted-foreground">This Week</span>
            <span className="text-xs font-bold text-foreground">
              {thisWeekSessions.length}/{data.weeklyGoal}
            </span>
          </div>
          <div className="h-2 bg-progress-track rounded-full overflow-hidden">
            <div
              className="h-full bg-progress-fill rounded-full transition-all duration-500"
              style={{ width: `${weekProgress * 100}%` }}
            />
          </div>
        </div>

        {/* Monthly */}
        <div className="glass-card p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-medium text-muted-foreground">This Month</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-primary">{thisMonthSessions.length}</span>
            <span className="text-[10px] text-muted-foreground">sessions</span>
          </div>
        </div>
      </div>

      {/* Month Nav */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="touch-target p-2 text-muted-foreground">
          <ChevronLeft size={20} />
        </button>
        <span className="text-lg font-semibold text-foreground">{monthName}</span>
        <button onClick={nextMonth} className="touch-target p-2 text-muted-foreground">
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Weekday Headers */}
      <div className="grid grid-cols-7 mb-2">
        {weekdays.map(d => (
          <div key={d} className="text-center text-xs text-muted-foreground font-medium py-1">{d}</div>
        ))}
      </div>

      {/* Days */}
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: adjustedFirst }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const dayNum = i + 1;
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
          const sessions = sessionsByDate[dateStr] || [];
          const isToday = dateStr === today;

          return (
            <button
              key={dayNum}
              onClick={() => handleDayClick(dateStr)}
              className={`relative aspect-square flex flex-col items-center justify-center rounded-xl transition-colors touch-target ${
                isToday ? 'bg-primary/20 ring-1 ring-primary' : 'active:bg-secondary'
              }`}
            >
              <span className={`text-sm ${isToday ? 'font-bold text-primary' : 'text-foreground'}`}>
                {dayNum}
              </span>
              {sessions.length > 0 && (
                <div className="flex gap-0.5 mt-0.5">
                  {sessions.slice(0, 3).map((s, si) => (
                    <div
                      key={si}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: `hsl(${getColorForType(s.workoutTypeId)})` }}
                    />
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-6">
        {data.workoutTypes.filter(t => !t.hidden).map(wt => (
          <div key={wt.id} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: `hsl(${wt.color})` }} />
            <span className="text-xs text-muted-foreground">{wt.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CalendarTab;
