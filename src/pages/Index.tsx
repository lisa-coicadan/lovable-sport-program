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

  const handleUpdate531 = useCallback((cycle: number, week: number, tm: number) => {
    setData(prev => ({
      ...prev,
      fiveThreeOne: { ...prev.fiveThreeOne, currentCycle: cycle, currentWeek: week, trainingMax: tm },
    }));
  }, []);

  const handleDaySelect = useCallback((date: string) => {
    // Switch to workout tab when selecting a day
    setActiveTab(1);
  }, []);

  if (!data.setupComplete) {
    return <SetupWizard onComplete={handleSetupComplete} />;
  }

  return (
    <div className="min-h-screen bg-background max-w-lg mx-auto relative">
      {activeTab === 0 && <CalendarTab data={data} onDaySelect={handleDaySelect} />}
      {activeTab === 1 && (
        <WorkoutTab data={data} onSaveSession={handleSaveSession} onUpdate531={handleUpdate531} />
      )}
      {activeTab === 2 && <StatsTab data={data} />}
      <BottomTabBar activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
};

export default Index;
