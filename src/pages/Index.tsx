import { useState, useEffect, useCallback } from 'react';
import { AppData, SessionLog } from '@/lib/types';
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

  useEffect(() => {
    saveData(data);
  }, [data]);

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

  const handleUpdateData = useCallback((partial: Partial<AppData>) => {
    setData(prev => ({ ...prev, ...partial }));
  }, []);

  if (!data.setupComplete) {
    return <SetupWizard onComplete={handleSetupComplete} />;
  }

  return (
    <div className="min-h-screen bg-background max-w-lg mx-auto relative">
      {activeTab === 0 && (
        <CalendarTab data={data} onDaySelect={handleDaySelect} onUpdateSession={handleUpdateSession} onDeleteSession={handleDeleteSession} />
      )}
      {/* WorkoutTab always mounted to preserve session state (timer, entered sets) across tab navigation */}
      <div style={{ display: activeTab === 1 ? 'block' : 'none' }}>
        <WorkoutTab
          data={data}
          onSaveSession={handleSaveSession}
          onUpdateData={handleUpdateData}
          selectedDate={selectedDate}
        />
      </div>
      {activeTab === 2 && <StatsTab data={data} />}
      <BottomTabBar activeTab={activeTab} onTabChange={(tab) => { setActiveTab(tab); }} />
    </div>
  );
};

export default Index;
