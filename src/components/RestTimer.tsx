import { useState, useEffect, useCallback, useRef } from 'react';
import { Pause, Play, RotateCcw, X, Timer } from 'lucide-react';

interface RestTimerProps {
  defaultSeconds?: number;
}

// Persistent AudioContext — created once on first user gesture.
// Web Audio API by default mixes with background media (Spotify/Apple Music on iOS)
// as long as we never touch an HTMLAudioElement.
let sharedCtx: AudioContext | null = null;
const getCtx = (): AudioContext | null => {
  try {
    if (!sharedCtx) {
      const AC = (window.AudioContext || (window as any).webkitAudioContext);
      if (!AC) return null;
      sharedCtx = new AC({ latencyHint: 'interactive' });
    }
    if (sharedCtx.state === 'suspended') sharedCtx.resume().catch(() => {});
    return sharedCtx;
  } catch {
    return null;
  }
};

const playBeep = () => {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  const beep = (start: number, freq: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    // Short, clean envelope — no click, no sustain — keeps it non-intrusive over music
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.35, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.2);
  };
  beep(now, 880);
  beep(now + 0.22, 1175);
};

const RestTimer = ({ defaultSeconds = 90 }: RestTimerProps) => {
  const [seconds, setSeconds] = useState(defaultSeconds);
  const [isRunning, setIsRunning] = useState(false);
  const [total, setTotal] = useState(defaultSeconds);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setTotal(defaultSeconds);
    setSeconds(defaultSeconds);
  }, [defaultSeconds]);

  useEffect(() => {
    if (!isRunning || seconds <= 0) return;
    const interval = setInterval(() => {
      setSeconds(s => {
        if (s <= 1) {
          setIsRunning(false);
          try {
            if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
          } catch {}
          playBeep();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning, seconds]);

  const reset = useCallback(() => {
    setSeconds(total);
    setIsRunning(false);
  }, [total]);

  const start = () => {
    // Prime the audio context on the user gesture so iOS allows playback later.
    getCtx();
    if (seconds === 0) setSeconds(total);
    setIsRunning(true);
  };

  const progress = total > 0 ? (seconds / total) * 100 : 0;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  // Floating button when collapsed
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={`fixed bottom-24 right-4 z-40 w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-90 ${
          isRunning ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-foreground'
        }`}
      >
        {isRunning ? (
          <span className="font-mono text-xs font-bold">{mins}:{secs.toString().padStart(2, '0')}</span>
        ) : (
          <Timer size={20} />
        )}
      </button>
    );
  }

  return (
    <div className="fixed bottom-24 right-4 z-40 glass-card p-4 shadow-2xl w-72">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-muted-foreground">Rest Timer</span>
        <button onClick={() => setExpanded(false)} className="text-muted-foreground p-1">
          <X size={16} />
        </button>
      </div>
      
      {/* Duration selector */}
      <div className="flex gap-1 mb-3">
        {[30, 60, 90, 120, 180, 300].map(t => (
          <button
            key={t}
            onClick={() => { setTotal(t); setSeconds(t); setIsRunning(false); }}
            className={`flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
              total === t ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
            }`}
          >
            {t < 60 ? `${t}s` : `${t / 60}m`}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative w-14 h-14">
          <svg className="w-14 h-14 -rotate-90" viewBox="0 0 64 64">
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
          <span className="absolute inset-0 flex items-center justify-center text-foreground font-mono font-bold text-xs">
            {mins}:{secs.toString().padStart(2, '0')}
          </span>
        </div>
        <div className="flex gap-2 flex-1">
          <button
            onClick={isRunning ? () => setIsRunning(false) : start}
            className="flex-1 touch-target bg-primary text-primary-foreground rounded-xl py-2.5 font-medium text-sm flex items-center justify-center gap-1.5 transition-transform active:scale-95"
          >
            {isRunning ? <Pause size={14} /> : <Play size={14} />}
            {isRunning ? 'Pause' : 'Start'}
          </button>
          <button
            onClick={reset}
            className="touch-target bg-secondary text-secondary-foreground rounded-xl px-3 py-2.5 transition-transform active:scale-95"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default RestTimer;
