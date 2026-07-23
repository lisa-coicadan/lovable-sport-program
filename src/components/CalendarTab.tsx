import { useState, useMemo } from 'react';
import { AppData, SessionLog } from '@/lib/types';
import { ChevronLeft, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import SessionDetailView from './SessionDetailView';

interface CalendarTabProps {
  data: AppData;
  onDaySelect: (date: string) => void;
  onUpdateSession: (updated: SessionLog) => void;
  onDeleteSession?: (sessionId: string) => void;
}

const CalendarTab = ({ data, onDaySelect, onUpdateSession, onDeleteSession }: CalendarTabProps) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [viewingSession, setViewingSession] = useState<SessionLog | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  const thisMonthSessions = data.sessions.filter(s => {
    const d = new Date(s.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));
  const monthName = currentMonth.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
  const weekdays = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const today = new Date().toISOString().split('T')[0];

  // Every day click opens the day sheet
  const handleDayClick = (dateStr: string) => {
    setSelectedDate(dateStr);
  };

  const handleDeleteFromList = (sessionId: string) => {
    onDeleteSession?.(sessionId);
    setConfirmDeleteId(null);
  };

  if (viewingSession) {
    return (
      <SessionDetailView
        session={viewingSession}
        data={data}
        onClose={() => setViewingSession(null)}
        onUpdate={(updated) => {
          onUpdateSession(updated);
          setViewingSession(null);
        }}
        onDelete={(sessionId) => {
          onDeleteSession?.(sessionId);
          setViewingSession(null);
          setSelectedDate(null);
        }}
      />
    );
  }

  // Day bottom sheet
  if (selectedDate) {
    const daySessions = sessionsByDate[selectedDate] || [];
    const dateLabel = new Date(selectedDate + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', month: 'long', day: 'numeric' });

    return (
      <div className="px-4 pt-12 pb-24 animate-slide-up">
        {/* Delete confirmation modal */}
        {confirmDeleteId && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 animate-fade-in">
            <div className="glass-card p-6 max-w-sm w-full">
              <h3 className="text-lg font-bold text-foreground mb-2">Supprimer la séance ?</h3>
              <p className="text-sm text-muted-foreground mb-6">
                Es-tu sûre de vouloir supprimer cette séance ? Cette action est irréversible.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="flex-1 bg-secondary text-secondary-foreground font-medium py-2.5 rounded-xl text-sm"
                >
                  Annuler
                </button>
                <button
                  onClick={() => handleDeleteFromList(confirmDeleteId)}
                  className="flex-1 bg-destructive text-destructive-foreground font-medium py-2.5 rounded-xl text-sm"
                >
                  Supprimer
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedDate(null)} className="text-muted-foreground touch-target p-1">
              <ChevronLeft size={20} />
            </button>
            <h1 className="text-xl font-bold text-foreground">{dateLabel}</h1>
          </div>
        </div>

        {daySessions.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-sm mb-4">Aucune séance ce jour-là</p>
          </div>
        )}

        <div className="space-y-3 mb-6">
          {daySessions.map(session => (
            <div
              key={session.id}
              className="glass-card p-4 flex items-center gap-3 transition-transform active:scale-[0.98]"
            >
              <button
                onClick={() => setViewingSession(session)}
                className="flex-1 text-left"
              >
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `hsl(${getColorForType(session.workoutTypeId)})` }} />
                  <span className="text-foreground font-semibold text-sm">{session.workoutTypeName}</span>
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground ml-6">
                  {session.duration && <span>{session.duration} min</span>}
                  <span>{session.sets.filter(s => s.completed).length}/{session.sets.length} séries</span>
                  {session.difficulty && <span>RPE {session.difficulty}/10</span>}
                </div>
              </button>
              <button
                onClick={() => setConfirmDeleteId(session.id)}
                className="p-2 text-muted-foreground hover:text-destructive transition-colors rounded-xl"
              >
                <Trash2 size={16} />
              </button>
              <button
                onClick={() => setViewingSession(session)}
                className="p-1 text-muted-foreground"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={() => {
            onDaySelect(selectedDate);
          }}
          className="w-full btn-neon font-semibold py-4 rounded-2xl text-sm flex items-center justify-center gap-2 transition-transform active:scale-95"
        >
          <Plus size={18} /> Ajouter une séance
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 pt-12 pb-24 animate-slide-up">
      <h1 className="text-2xl font-bold text-foreground mb-4">Calendrier</h1>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="glass-card p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-medium text-muted-foreground">Cette semaine</span>
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
        <div className="glass-card p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-medium text-muted-foreground">Ce mois-ci</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-primary">{thisMonthSessions.length}</span>
            <span className="text-[10px] text-muted-foreground">séances</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="touch-target p-2 text-muted-foreground">
          <ChevronLeft size={20} />
        </button>
        <span className="text-lg font-semibold text-foreground">{monthName}</span>
        <button onClick={nextMonth} className="touch-target p-2 text-muted-foreground">
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-2">
        {weekdays.map(d => (
          <div key={d} className="text-center text-xs text-muted-foreground font-medium py-1">{d}</div>
        ))}
      </div>

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
                isToday && sessions.length === 0 ? 'bg-primary/20 ring-1 ring-primary' : isToday ? 'ring-1 ring-primary' : 'active:bg-secondary'
              }`}
              style={sessions.length > 0 ? {
                backgroundColor: `hsl(${getColorForType(sessions[0].workoutTypeId)} / 0.25)`,
              } : undefined}
            >
              <span className={`text-sm ${isToday ? 'font-bold text-primary' : sessions.length > 0 ? 'font-semibold text-foreground' : 'text-foreground'}`}>
                {dayNum}
              </span>
              {sessions.length > 1 && (
                <div className="flex gap-0.5 mt-0.5">
                  {sessions.slice(1, 4).map((s, si) => (
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
