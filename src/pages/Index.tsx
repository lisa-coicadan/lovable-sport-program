import { useState, useEffect, useCallback } from 'react';
import { AppData, SessionLog, CardioSession } from '@/lib/types';
import { loadData, saveData } from '@/lib/storage';
import SetupWizard from '@/components/SetupWizard';
import BottomTabBar from '@/components/BottomTabBar';
import CalendarTab from '@/components/CalendarTab';
import WorkoutTab from '@/components/WorkoutTab';
import StatsTab from '@/components/StatsTab';

const Index = () => {
  const [data, setData] = useState<AppData>(loadData);
  const [activeTab, setActiveTab] = useState(1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [sessionProgress, setSessionProgress] = useState<number | null>(null);
  // Hides BottomTabBar whenever a text field is focused anywhere in the app (not just one
  // specific modal) — on iOS the bar sits at z-50 above everything else, so with the
  // keyboard up it visually collides with whatever modal buttons happen to land near the
  // bottom of the shrunk viewport. Tracked globally via focus events rather than per-modal
  // state so any current or future text input gets this for free.
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    saveData(data);
  }, [data]);

  useEffect(() => {
    const opensKeyboard = (target: EventTarget | null): boolean => {
      if (target instanceof HTMLTextAreaElement) return true;
      if (target instanceof HTMLInputElement) {
        return !['checkbox', 'radio', 'range', 'button', 'submit', 'color', 'file'].includes(target.type);
      }
      return false;
    };
    const handleFocusIn = (e: FocusEvent) => { if (opensKeyboard(e.target)) setKeyboardOpen(true); };
    const handleFocusOut = (e: FocusEvent) => { if (opensKeyboard(e.target)) setKeyboardOpen(false); };
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  const handleSetupComplete = useCallback((partial: Partial<AppData>) => {
    setData(prev => ({ ...prev, ...partial }));
  }, []);

  const handleSaveSession = useCallback((session: SessionLog) => {
    setData(prev => ({
      ...prev,
      sessions: [...prev.sessions, session],
    }));
  }, []);

  const handleDaySelect = useCallback((date: string) => {
    setSelectedDate(date);
    setActiveTab(1);
  }, []);

  // `selectedDate` targets the session she's about to log at a specific past date (logging
  // retroactively from Calendar) — it must not silently keep applying to every session she
  // starts afterwards from the Séance tab directly, so it's cleared once actually consumed.
  const handleClearSelectedDate = useCallback(() => {
    setSelectedDate(null);
  }, []);

  const handleUpdateSession = useCallback((updated: SessionLog) => {
    setData(prev => ({
      ...prev,
      sessions: prev.sessions.map(s => s.id === updated.id ? updated : s),
    }));
  }, []);

  const handleDeleteSession = useCallback((sessionId: string) => {
    setData(prev => ({
      ...prev,
      sessions: prev.sessions.filter(s => s.id !== sessionId),
    }));
  }, []);

  const handleDeleteCardioSession = useCallback((cardioSessionId: string) => {
    setData(prev => ({
      ...prev,
      cardioSessions: (prev.cardioSessions || []).filter(s => s.id !== cardioSessionId),
    }));
  }, []);

  const handleUpdateCardioSession = useCallback((updated: CardioSession) => {
    setData(prev => ({
      ...prev,
      cardioSessions: (prev.cardioSessions || []).map(s => s.id === updated.id ? updated : s),
    }));
  }, []);

  const handleUpdateData = useCallback((partial: Partial<AppData>) => {
    setData(prev => ({ ...prev, ...partial }));
  }, []);

  if (!data.setupComplete) {
    return <SetupWizard onComplete={handleSetupComplete} />;
  }

  return (
    <div className="min-h-screen bg-background max-w-lg mx-auto relative overflow-x-hidden">
      {activeTab === 0 && (
        <CalendarTab data={data} onDaySelect={handleDaySelect} onUpdateSession={handleUpdateSession} onDeleteSession={handleDeleteSession} onDeleteCardioSession={handleDeleteCardioSession} onUpdateCardioSession={handleUpdateCardioSession} onUpdateData={handleUpdateData} />
      )}
      {/* WorkoutTab always mounted to preserve session state (timer, entered sets) across tab navigation */}
      <div style={{ display: activeTab === 1 ? 'block' : 'none' }}>
        <WorkoutTab
          data={data}
          onSaveSession={handleSaveSession}
          onUpdateData={handleUpdateData}
          selectedDate={selectedDate}
          onClearSelectedDate={handleClearSelectedDate}
          onProgressChange={setSessionProgress}
        />
      </div>
      {activeTab === 2 && <StatsTab data={data} onUpdateSession={handleUpdateSession} onDeleteSession={handleDeleteSession} onUpdateData={handleUpdateData} />}
      {!keyboardOpen && (
        <BottomTabBar activeTab={activeTab} onTabChange={(tab) => { setActiveTab(tab); }} sessionProgress={sessionProgress} />
      )}
    </div>
  );
};

export default Index;
