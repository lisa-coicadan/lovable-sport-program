import { useState, useEffect, useCallback } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';

interface RestTimerProps {
  defaultSeconds?: number;
  onComplete?: () => void;
}

const RestTimer = ({ defaultSeconds = 60, onComplete }: RestTimerProps) => {
  const [seconds, setSeconds] = useState(defaultSeconds);
  const [isRunning, setIsRunning] = useState(false);
  const [total, setTotal] = useState(defaultSeconds);

  useEffect(() => {
    if (!isRunning || seconds <= 0) return;
    const interval = setInterval(() => {
      setSeconds(s => {
        if (s <= 1) {
          setIsRunning(false);
          onComplete?.();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning, seconds, onComplete]);

  const reset = useCallback(() => {
    setSeconds(total);
    setIsRunning(false);
  }, [total]);

  const start = () => {
    if (seconds === 0) setSeconds(total);
    setIsRunning(true);
  };

  const progress = total > 0 ? (seconds / total) * 100 : 0;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-muted-foreground">Rest Timer</span>
        <div className="flex gap-1">
          {[30, 60, 90, 120].map(t => (
            <button
              key={t}
              onClick={() => { setTotal(t); setSeconds(t); setIsRunning(false); }}
              className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
                total === t ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
              }`}
            >
              {t}s
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="relative w-16 h-16">
          <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" stroke="hsl(var(--progress-track))" strokeWidth="4" />
            <circle
              cx="32" cy="32" r="28" fill="none"
              stroke="hsl(var(--progress-fill))"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 28}`}
              strokeDashoffset={`${2 * Math.PI * 28 * (1 - progress / 100)}`}
              className="transition-all duration-1000 ease-linear"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-foreground font-mono font-bold text-sm">
            {mins}:{secs.toString().padStart(2, '0')}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={isRunning ? () => setIsRunning(false) : start}
            className="touch-target bg-primary text-primary-foreground rounded-xl px-5 py-2.5 font-medium text-sm flex items-center gap-1.5 transition-transform active:scale-95"
          >
            {isRunning ? <Pause size={16} /> : <Play size={16} />}
            {isRunning ? 'Pause' : 'Start'}
          </button>
          <button
            onClick={reset}
            className="touch-target bg-secondary text-secondary-foreground rounded-xl px-3 py-2.5 transition-transform active:scale-95"
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default RestTimer;
