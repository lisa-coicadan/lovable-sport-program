import { useState, useMemo, useEffect, useRef } from 'react';
import { AppData, SessionLog, CardioSession, CardioActivityType, PlannedSession, resolveProgramName } from '@/lib/types';
import { ChevronLeft, ChevronRight, Plus, Trash2, X, Activity } from 'lucide-react';
import { formatCardioDuration, calculatePaceMinPerKm, formatPace, formatCardioDistance } from '@/lib/cardio';
import SessionDetailView from './SessionDetailView';
import { CARDIO_ACTIVITY_TYPES } from './WorkoutTab';
import { useSwipeToClose } from '@/hooks/useSwipeToClose';

interface CalendarTabProps {
  data: AppData;
  onDaySelect: (date: string) => void;
  onUpdateSession: (updated: SessionLog) => void;
  onDeleteSession?: (sessionId: string) => void;
  onDeleteCardioSession?: (cardioSessionId: string) => void;
  onUpdateCardioSession?: (updated: CardioSession) => void;
  onUpdateData: (partial: Partial<AppData>) => void;
}

// Draft shape mirrors WorkoutTab's cardio logging form fields (min/sec split, distance in
// the activity's display unit rather than the stored km) so editing reuses the exact same
// parsing/display conventions as logging.
interface CardioEditDraft {
  activityType: CardioActivityType;
  customLabel: string;
  durationMin: string;
  durationSec: string;
  distance: string;
  difficulty: number;
  date: string;
  notes: string;
}

const CalendarTab = ({ data, onDaySelect, onUpdateSession, onDeleteSession, onDeleteCardioSession, onUpdateCardioSession, onUpdateData }: CalendarTabProps) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [viewingSession, setViewingSession] = useState<SessionLog | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteCardioId, setConfirmDeleteCardioId] = useState<string | null>(null);
  const [editingCardio, setEditingCardio] = useState<CardioSession | null>(null);
  const [cardioDraft, setCardioDraft] = useState<CardioEditDraft | null>(null);
  // Reveals the "which séance ?" picker for a test-1RM day plan — separate from the normal
  // planning pills so picking a type there doesn't ambiguously mean "normal" vs "test".
  const [testMaxPickerOpen, setTestMaxPickerOpen] = useState(false);

  const openCardioEdit = (cardio: CardioSession) => {
    const totalSeconds = Math.round(cardio.durationMinutes * 60);
    const distanceDisplay = cardio.distanceKm === undefined
      ? ''
      : String(cardio.activityType === 'Natation' ? Math.round(cardio.distanceKm * 1000) : cardio.distanceKm);
    setEditingCardio(cardio);
    setCardioDraft({
      activityType: cardio.activityType,
      customLabel: cardio.customActivityLabel || '',
      durationMin: String(Math.floor(totalSeconds / 60)),
      durationSec: String(totalSeconds % 60),
      distance: distanceDisplay,
      difficulty: cardio.difficulty ?? 5,
      date: cardio.date,
      notes: cardio.notes || '',
    });
  };

  const saveCardioEdit = () => {
    if (!editingCardio || !cardioDraft) return;
    const durationMinutes = (parseInt(cardioDraft.durationMin, 10) || 0) + (parseInt(cardioDraft.durationSec, 10) || 0) / 60;
    if (durationMinutes <= 0) return;
    const distanceRaw = cardioDraft.distance.trim() === '' ? undefined : parseFloat(cardioDraft.distance) || undefined;
    const distanceKm = distanceRaw === undefined ? undefined : cardioDraft.activityType === 'Natation' ? distanceRaw / 1000 : distanceRaw;
    onUpdateCardioSession?.({
      ...editingCardio,
      activityType: cardioDraft.activityType,
      customActivityLabel: cardioDraft.activityType === 'Autre' ? cardioDraft.customLabel.trim() || undefined : undefined,
      durationMinutes,
      distanceKm,
      difficulty: cardioDraft.difficulty,
      date: cardioDraft.date,
      notes: cardioDraft.notes.trim() || undefined,
    });
    setEditingCardio(null);
    setCardioDraft(null);
  };
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  // Swipe-to-close on the day view — same left-edge-swipe-right gesture as Réglages→Séance
  // (see useSwipeToClose). No dirty-state concern here, so no canClose/onBlocked needed.
  const { panelRef, handleTouchStart, handleTouchEnd, panelStyle } = useSwipeToClose({
    onClose: () => setSelectedDate(null),
  });

  // Default focus to the safe action, and let Escape back out — same expectations any
  // confirm dialog needs, easy to miss when a modal is hand-rolled instead of using a
  // shared primitive.
  useEffect(() => {
    if (!confirmDeleteId) return;
    cancelDeleteRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmDeleteId(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirmDeleteId]);

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

  const cardioByDate = useMemo(() => {
    const map: Record<string, CardioSession[]> = {};
    (data.cardioSessions || []).forEach(s => {
      if (!map[s.date]) map[s.date] = [];
      map[s.date].push(s);
    });
    return map;
  }, [data.cardioSessions]);

  const getColorForType = (typeId: string) => {
    const wt = data.workoutTypes.find(w => w.id === typeId);
    return wt?.color || '189 94% 55%';
  };

  const activeWorkoutTypes = data.workoutTypes.filter(
    t => !t.hidden && (!data.activeProgramId || !t.programId || t.programId === data.activeProgramId)
  );

  // One planned entry per day — a fresh pick on an already-planned day replaces it.
  const plannedByDate = useMemo(() => {
    const map: Record<string, PlannedSession> = {};
    (data.plannedSessions || []).forEach(p => { map[p.date] = p; });
    return map;
  }, [data.plannedSessions]);

  const setPlannedSession = (date: string, workoutTypeId: string, testMaxMode?: boolean) => {
    const others = (data.plannedSessions || []).filter(p => p.date !== date);
    onUpdateData({ plannedSessions: [...others, { id: `planned-${Date.now()}`, date, workoutTypeId, ...(testMaxMode ? { testMaxMode: true } : {}) }] });
  };

  const removePlannedSession = (date: string) => {
    onUpdateData({ plannedSessions: (data.plannedSessions || []).filter(p => p.date !== date) });
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

  // `?? 2` (not `||`) — 0 is a deliberate "no cardio goal" choice, not a missing value.
  const cardioWeeklyGoal = data.cardioWeeklyGoal ?? 2;
  const thisWeekCardioSessions = (data.cardioSessions || []).filter(s => {
    const d = new Date(s.date);
    return d >= startOfWeek && d < endOfWeek;
  });
  const cardioWeekProgress = cardioWeeklyGoal > 0 ? Math.min(thisWeekCardioSessions.length / cardioWeeklyGoal, 1) : 0;

  const thisMonthSessions = data.sessions.filter(s => {
    const d = new Date(s.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  // Unlike the weekly goal above (strength-only, cardio has its own goal/bar), this is a
  // simple activity total for the month — cardio belongs in it too.
  const thisMonthCardioSessions = (data.cardioSessions || []).filter(s => {
    const d = new Date(s.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const lastMonthRef = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthSessions = data.sessions.filter(s => {
    const d = new Date(s.date);
    return d.getMonth() === lastMonthRef.getMonth() && d.getFullYear() === lastMonthRef.getFullYear();
  });
  const lastMonthCardioSessions = (data.cardioSessions || []).filter(s => {
    const d = new Date(s.date);
    return d.getMonth() === lastMonthRef.getMonth() && d.getFullYear() === lastMonthRef.getFullYear();
  });

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));
  const monthName = currentMonth.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
  const weekdays = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const today = new Date().toISOString().split('T')[0];

  // Every day click opens the day sheet
  const handleDayClick = (dateStr: string) => {
    setTestMaxPickerOpen(false);
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
    const dayCardioSessions = cardioByDate[selectedDate] || [];
    const dateLabel = new Date(selectedDate + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', month: 'long', day: 'numeric' });
    const isFutureDate = selectedDate > today;
    const isToday = selectedDate === today;
    const plannedForDay = plannedByDate[selectedDate];

    return (
      <div
        ref={panelRef}
        className="px-4 pt-12 pb-24 animate-slide-up"
        style={panelStyle}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Delete confirmation modal */}
        {confirmDeleteId && (
          <div
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 animate-fade-in"
            onClick={() => setConfirmDeleteId(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-session-title"
              className="glass-card p-6 max-w-sm w-full"
              onClick={e => e.stopPropagation()}
            >
              <h3 id="delete-session-title" className="text-lg font-bold text-foreground mb-2">Supprimer la séance ?</h3>
              <p className="text-sm text-muted-foreground mb-6">
                Es-tu sûre de vouloir supprimer cette séance ? Cette action est irréversible.
              </p>
              <div className="flex gap-3">
                <button
                  ref={cancelDeleteRef}
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

        {confirmDeleteCardioId && (
          <div
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 animate-fade-in"
            onClick={() => setConfirmDeleteCardioId(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-cardio-title"
              className="glass-card p-6 max-w-sm w-full"
              onClick={e => e.stopPropagation()}
            >
              <h3 id="delete-cardio-title" className="text-lg font-bold text-foreground mb-2">Supprimer l'activité ?</h3>
              <p className="text-sm text-muted-foreground mb-6">
                Es-tu sûre de vouloir supprimer cette activité cardio ? Cette action est irréversible.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDeleteCardioId(null)}
                  className="flex-1 bg-secondary text-secondary-foreground font-medium py-2.5 rounded-xl text-sm"
                >
                  Annuler
                </button>
                <button
                  onClick={() => { onDeleteCardioSession?.(confirmDeleteCardioId); setConfirmDeleteCardioId(null); }}
                  className="flex-1 bg-destructive text-destructive-foreground font-medium py-2.5 rounded-xl text-sm"
                >
                  Supprimer
                </button>
              </div>
            </div>
          </div>
        )}

        {editingCardio && cardioDraft && (
          <div
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 animate-fade-in"
            onClick={() => { setEditingCardio(null); setCardioDraft(null); }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-cardio-title"
              className="glass-card p-5 max-w-sm w-full max-h-[85vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 id="edit-cardio-title" className="text-lg font-bold text-foreground">Modifier l'activité</h3>
                <button
                  onClick={() => { setEditingCardio(null); setCardioDraft(null); }}
                  aria-label="Fermer"
                  className="text-muted-foreground p-1"
                >
                  <X size={18} />
                </button>
              </div>

              <label className="text-xs text-muted-foreground mb-1.5 block">Type d'activité</label>
              <select
                value={cardioDraft.activityType}
                onChange={e => setCardioDraft({ ...cardioDraft, activityType: e.target.value as CardioActivityType })}
                className="w-full bg-secondary text-foreground rounded-lg px-3 py-2 text-sm outline-none mb-3"
              >
                {CARDIO_ACTIVITY_TYPES.map(({ type }) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              {cardioDraft.activityType === 'Autre' && (
                <input
                  value={cardioDraft.customLabel}
                  onChange={e => setCardioDraft({ ...cardioDraft, customLabel: e.target.value })}
                  placeholder="Quel type d'activité ?"
                  className="w-full bg-secondary text-foreground rounded-lg px-3 py-2 text-sm outline-none mb-3"
                />
              )}

              <label className="text-xs text-muted-foreground mb-1.5 block">Date</label>
              <input
                type="date"
                value={cardioDraft.date}
                onChange={e => setCardioDraft({ ...cardioDraft, date: e.target.value })}
                className="w-full bg-secondary text-foreground rounded-lg px-3 py-2 text-sm outline-none mb-3"
              />

              <label className="text-xs text-muted-foreground mb-1.5 block">Durée</label>
              <div className="flex items-center gap-1.5 mb-3">
                <input
                  type="number"
                  inputMode="numeric"
                  value={cardioDraft.durationMin}
                  onChange={e => setCardioDraft({ ...cardioDraft, durationMin: e.target.value })}
                  className="w-full bg-secondary text-foreground rounded-lg px-3 py-2 text-sm outline-none font-mono text-center"
                  aria-label="Minutes"
                />
                <span className="text-muted-foreground text-xs shrink-0">min</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={cardioDraft.durationSec}
                  onChange={e => setCardioDraft({ ...cardioDraft, durationSec: e.target.value })}
                  className="w-full bg-secondary text-foreground rounded-lg px-3 py-2 text-sm outline-none font-mono text-center"
                  aria-label="Secondes"
                />
                <span className="text-muted-foreground text-xs shrink-0">sec</span>
              </div>

              <label className="text-xs text-muted-foreground mb-1.5 block">
                Distance ({cardioDraft.activityType === 'Natation' ? 'm' : 'km'}) — facultatif
              </label>
              <input
                type="number"
                inputMode="decimal"
                value={cardioDraft.distance}
                onChange={e => setCardioDraft({ ...cardioDraft, distance: e.target.value })}
                className="w-full bg-secondary text-foreground rounded-lg px-3 py-2 text-sm outline-none font-mono text-center mb-3"
              />

              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted-foreground">Comment tu t'es sentie ?</label>
                <span className="text-sm font-bold text-foreground">{cardioDraft.difficulty}/10</span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                value={cardioDraft.difficulty}
                onChange={e => setCardioDraft({ ...cardioDraft, difficulty: parseInt(e.target.value) })}
                className="w-full accent-accent-blue h-2 mb-3"
              />

              <label className="text-xs text-muted-foreground mb-1.5 block">Notes</label>
              <textarea
                value={cardioDraft.notes}
                onChange={e => setCardioDraft({ ...cardioDraft, notes: e.target.value })}
                rows={2}
                className="w-full bg-secondary text-foreground rounded-lg px-3 py-2 text-sm outline-none mb-4 resize-none"
              />

              <div className="flex gap-3">
                <button
                  onClick={() => { setEditingCardio(null); setCardioDraft(null); }}
                  className="flex-1 bg-secondary text-secondary-foreground font-medium py-2.5 rounded-xl text-sm"
                >
                  Annuler
                </button>
                <button
                  onClick={saveCardioEdit}
                  disabled={(parseInt(cardioDraft.durationMin, 10) || 0) + (parseInt(cardioDraft.durationSec, 10) || 0) <= 0}
                  className="flex-1 btn-neon font-medium py-2.5 rounded-xl text-sm disabled:opacity-40"
                >
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedDate(null)} aria-label="Retour au calendrier" className="text-muted-foreground touch-target p-1">
              <ChevronLeft size={20} />
            </button>
            <h1 className="text-xl font-bold text-foreground">{dateLabel}</h1>
          </div>
        </div>

        {daySessions.length === 0 && dayCardioSessions.length === 0 && (
          <div className="glass-card p-8 text-center mb-6">
            <p className="text-muted-foreground text-sm">Aucune séance ce jour-là</p>
          </div>
        )}

        {dayCardioSessions.length > 0 && (
          <div className="space-y-3 mb-6">
            {dayCardioSessions.map(cardio => (
              <div key={cardio.id} className="glass-card p-4 flex items-center gap-3 border-accent-blue/30">
                <Activity size={16} className="text-accent-blue shrink-0" />
                <button onClick={() => openCardioEdit(cardio)} className="flex-1 text-left">
                  <span className="text-foreground font-semibold text-sm">
                    {cardio.activityType === 'Autre' ? (cardio.customActivityLabel || 'Autre') : cardio.activityType}
                  </span>
                  <div className="flex gap-4 text-xs text-muted-foreground mt-1">
                    <span>{formatCardioDuration(cardio.durationMinutes)}</span>
                    {cardio.distanceKm !== undefined && <span>{formatCardioDistance(cardio.distanceKm, cardio.activityType)}</span>}
                    {(() => {
                      const pace = calculatePaceMinPerKm(cardio.durationMinutes, cardio.distanceKm);
                      return pace !== null && <span>{formatPace(pace)}</span>;
                    })()}
                    {cardio.difficulty && <span>RPE {cardio.difficulty}/10</span>}
                  </div>
                </button>
                <button
                  onClick={() => setConfirmDeleteCardioId(cardio.id)}
                  aria-label={`Supprimer l'activité ${cardio.activityType}`}
                  className="p-2 text-muted-foreground hover:text-destructive transition-colors rounded-xl"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
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
                  {(data.programs?.length ?? 0) > 1 && resolveProgramName(session, data) && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                      {resolveProgramName(session, data)}
                    </span>
                  )}
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground ml-6">
                  {session.duration && <span>{session.duration} min</span>}
                  <span>{session.sets.filter(s => s.completed).length}/{session.sets.length} séries</span>
                  {session.difficulty && <span>RPE {session.difficulty}/10</span>}
                </div>
              </button>
              <button
                onClick={() => setConfirmDeleteId(session.id)}
                aria-label={`Supprimer la séance ${session.workoutTypeName}`}
                className="p-2 text-muted-foreground hover:text-destructive transition-colors rounded-xl"
              >
                <Trash2 size={16} />
              </button>
              <ChevronRight size={16} className="text-muted-foreground shrink-0" aria-hidden="true" />
            </div>
          ))}
        </div>

        {(isFutureDate || isToday) && daySessions.length === 0 && (
          plannedForDay ? (
            <div className={`glass-card p-4 mb-6 ${plannedForDay.testMaxMode ? 'border border-warning/30 bg-warning/5' : ''}`}>
              <h3 className={`text-sm font-bold mb-3 ${plannedForDay.testMaxMode ? 'text-warning' : 'text-foreground'}`}>
                {plannedForDay.testMaxMode ? '🎯 Test 1RM' : 'Planifier une séance'}
              </h3>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {!plannedForDay.testMaxMode && (
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `hsl(${getColorForType(plannedForDay.workoutTypeId)})` }} />
                  )}
                  <span className="text-sm text-foreground font-medium">
                    {data.workoutTypes.find(t => t.id === plannedForDay.workoutTypeId)?.name || plannedForDay.workoutTypeId}
                  </span>
                </div>
                <button
                  onClick={() => removePlannedSession(selectedDate)}
                  className="text-xs text-muted-foreground underline touch-target px-2 py-1"
                >
                  Retirer
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-3">
                Juste un repère visuel — aucune série n'est enregistrée. Disparaît automatiquement si non réalisée le jour venu.
              </p>
            </div>
          ) : (
            <>
              <div className="glass-card p-4 mb-4">
                <h3 className="text-sm font-bold text-foreground mb-3">Planifier une séance</h3>
                <div className="flex flex-wrap gap-2">
                  {activeWorkoutTypes.map(wt => (
                    <button
                      key={wt.id}
                      onClick={() => { setPlannedSession(selectedDate, wt.id); setSelectedDate(null); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-xs font-medium text-foreground active:scale-95 transition-transform"
                    >
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: `hsl(${wt.color})` }} />
                      {wt.name}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-3">
                  Juste un repère visuel — aucune série n'est enregistrée. Disparaît automatiquement si non réalisée le jour venu.
                </p>
              </div>

              <div className="glass-card p-4 mb-6">
                {testMaxPickerOpen ? (
                  <>
                    <h3 className="text-sm font-bold text-warning mb-3">Quelle séance tester en 1RM ?</h3>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {activeWorkoutTypes.map(wt => (
                        <button
                          key={wt.id}
                          onClick={() => { setPlannedSession(selectedDate, wt.id, true); setTestMaxPickerOpen(false); setSelectedDate(null); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-warning/10 border border-warning/30 text-xs font-medium text-warning active:scale-95 transition-transform"
                        >
                          {wt.name}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setTestMaxPickerOpen(false)}
                      className="text-xs text-muted-foreground underline touch-target px-2 py-1"
                    >
                      Annuler
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setTestMaxPickerOpen(true)}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold bg-warning/10 border border-warning/30 text-warning touch-target active:scale-95 transition-transform"
                  >
                    🎯 Jour de test — tester un 1RM
                  </button>
                )}
              </div>
            </>
          )
        )}

        {!isFutureDate && (
          <button
            onClick={() => {
              onDaySelect(selectedDate);
            }}
            className="w-full btn-neon font-semibold py-4 rounded-2xl text-sm flex items-center justify-center gap-2 transition-transform active:scale-95"
          >
            <Plus size={18} /> Ajouter une séance
          </button>
        )}
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
          {/* Separate goal/color from strength — cardio isn't counted toward weeklyGoal */}
          <div className="flex items-center justify-between mb-1.5 mt-2.5">
            <span className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
              <Activity size={10} className="text-accent-blue" /> Cardio
            </span>
            <span className="text-xs font-bold text-foreground">
              {thisWeekCardioSessions.length}/{cardioWeeklyGoal}
            </span>
          </div>
          <div className="h-2 bg-progress-track rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-blue rounded-full transition-all duration-500"
              style={{ width: `${cardioWeekProgress * 100}%` }}
            />
          </div>
        </div>
        <div className="glass-card p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-medium text-muted-foreground">Ce mois-ci</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-primary">{thisMonthSessions.length + thisMonthCardioSessions.length}</span>
            <span className="text-[10px] text-muted-foreground">séances</span>
          </div>
          <p className="text-[9px] text-muted-foreground mt-1">
            Le mois dernier : {lastMonthSessions.length + lastMonthCardioSessions.length} séance{lastMonthSessions.length + lastMonthCardioSessions.length > 1 ? 's' : ''}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} aria-label="Mois précédent" className="touch-target p-2 text-muted-foreground">
          <ChevronLeft size={20} />
        </button>
        <span className="text-lg font-semibold text-foreground">{monthName}</span>
        <button onClick={nextMonth} aria-label="Mois suivant" className="touch-target p-2 text-muted-foreground">
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
          const cardioSessions = cardioByDate[dateStr] || [];
          const hasDeload = sessions.some(s => s.isDeload);
          const isToday = dateStr === today;
          const planned = sessions.length === 0 ? plannedByDate[dateStr] : undefined;
          const dayLabel = new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
          const sessionsLabel = sessions.length === 0
            ? (planned ? `${planned.testMaxMode ? 'test 1RM prévu' : 'séance prévue'} : ${data.workoutTypes.find(t => t.id === planned.workoutTypeId)?.name || ''}` : 'aucune séance')
            : `${sessions.length} séance${sessions.length > 1 ? 's' : ''} : ${sessions.map(s => s.workoutTypeName).join(', ')}`;
          const cardioLabel = cardioSessions.length > 0 ? `, ${cardioSessions.length} activité${cardioSessions.length > 1 ? 's' : ''} cardio` : '';

          return (
            <button
              key={dayNum}
              onClick={() => handleDayClick(dateStr)}
              aria-label={`${dayLabel}${isToday ? ' (aujourd\'hui)' : ''} — ${sessionsLabel}${cardioLabel}`}
              className={`relative aspect-square flex flex-col items-center justify-center rounded-xl transition-colors touch-target ${
                isToday && sessions.length === 0 ? 'bg-primary/20 ring-1 ring-primary' : isToday ? 'ring-1 ring-primary' : 'active:bg-secondary'
              } ${planned ? 'border border-dashed' : ''}`}
              style={sessions.length > 0 ? {
                // A deload day's own workout-type color would look identical to any other
                // day and defeat the point of being able to spot recovery weeks at a
                // glance — orange wins over whatever color that session's type normally is.
                backgroundColor: hasDeload ? 'hsl(var(--warning) / 0.3)' : `hsl(${getColorForType(sessions[0].workoutTypeId)} / 0.25)`,
              } : planned ? {
                // Lower alpha than a real logged day (0.25) so a planned day reads as
                // tentative/translucent, never mistaken for a completed session. A test-1RM
                // day uses --warning instead of the séance's own color, same convention as
                // the "🎯 Tester un 1RM" button in WorkoutTab.
                backgroundColor: planned.testMaxMode ? 'hsl(var(--warning) / 0.15)' : `hsl(${getColorForType(planned.workoutTypeId)} / 0.12)`,
                borderColor: planned.testMaxMode ? 'hsl(var(--warning) / 0.6)' : `hsl(${getColorForType(planned.workoutTypeId)} / 0.5)`,
              } : undefined}
            >
              {/* Outline rather than a fill so a cardio day can be superimposed on a
                  strength day's background color instead of fighting over it. */}
              {cardioSessions.length > 0 && (() => {
                const Icon = CARDIO_ACTIVITY_TYPES.find(a => a.type === cardioSessions[0].activityType)?.icon || Activity;
                return (
                  <>
                    <div className="absolute inset-0 rounded-xl border-2 border-accent-blue pointer-events-none" />
                    <div className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-accent-blue flex items-center justify-center pointer-events-none">
                      <Icon size={8} strokeWidth={2.5} className="text-black" />
                    </div>
                  </>
                );
              })()}
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
        {data.workoutTypes
          .filter(t => !t.hidden && (!data.activeProgramId || !t.programId || t.programId === data.activeProgramId))
          .map(wt => (
            <div key={wt.id} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: `hsl(${wt.color})` }} />
              <span className="text-xs text-muted-foreground">{wt.name}</span>
            </div>
          ))}
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm border-2 border-accent-blue" />
          <span className="text-xs text-muted-foreground">Cardio</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-warning" />
          <span className="text-xs text-muted-foreground">Deload</span>
        </div>
      </div>
    </div>
  );
};

export default CalendarTab;
