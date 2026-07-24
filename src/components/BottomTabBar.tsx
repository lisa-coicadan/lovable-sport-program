import { Calendar, Dumbbell, BarChart3 } from 'lucide-react';

interface BottomTabBarProps {
  activeTab: number;
  onTabChange: (tab: number) => void;
  // Completed-sets fraction (0-1) of the live session, or null/undefined when none is in
  // progress — shown as a thin fill along the top edge of the bar, visible from any tab.
  sessionProgress?: number | null;
}

const tabs = [
  { icon: Calendar, label: 'Calendrier' },
  { icon: Dumbbell, label: 'Séance' },
  { icon: BarChart3, label: 'Stats' },
];

const BottomTabBar = ({ activeTab, onTabChange, sessionProgress }: BottomTabBarProps) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/90 backdrop-blur-xl border-t border-border safe-bottom">
      {sessionProgress != null && (
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-secondary/50 overflow-hidden">
          <div
            className="h-full bg-success transition-all duration-300"
            style={{ width: `${Math.round(sessionProgress * 100)}%`, boxShadow: '0 0 6px hsl(var(--success) / 0.7)' }}
          />
        </div>
      )}
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {tabs.map((tab, i) => {
          const active = activeTab === i;
          return (
            <button
              key={tab.label}
              onClick={() => onTabChange(i)}
              className="touch-target flex flex-col items-center justify-center gap-0.5 flex-1 transition-colors"
            >
              <tab.icon
                size={22}
                className={active ? 'text-tab-active drop-shadow-[0_0_6px_hsl(var(--tab-active)/0.7)]' : 'text-tab-inactive'}
                strokeWidth={active ? 2.5 : 1.8}
              />
              <span className={`text-[10px] font-medium ${active ? 'text-tab-active' : 'text-tab-inactive'}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomTabBar;
