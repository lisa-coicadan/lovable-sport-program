import { Calendar, Dumbbell, BarChart3 } from 'lucide-react';

interface BottomTabBarProps {
  activeTab: number;
  onTabChange: (tab: number) => void;
}

const tabs = [
  { icon: Calendar, label: 'Calendar' },
  { icon: Dumbbell, label: 'Workout' },
  { icon: BarChart3, label: 'Stats' },
];

const BottomTabBar = ({ activeTab, onTabChange }: BottomTabBarProps) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/90 backdrop-blur-xl border-t border-border safe-bottom">
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
                className={active ? 'text-tab-active' : 'text-tab-inactive'}
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
