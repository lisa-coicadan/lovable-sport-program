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
      const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
      if (!AC) return null;
      sharedCtx = new AC({ latencyHint: 'interactive' });
    }
    if (sharedCtx.state === 'suspended') sharedCtx.resume().catch(() => {});
    return sharedCtx;
  } catch {
    return null;
  }
};

// Schedules 2 sharp, loud beeps in a row starting at the given AudioContext time.
// Scheduled ahead of time (rather than played from a setInterval tick) so it still
// fires on the audio clock even if iOS throttles the page's JS timers in the background.
// Square wave + near-max gain + high pitch: a web page can't detect or duck another
// app's volume (Spotify/Apple Music), so this is the loudest/most piercing tone we can
// generate on our own end — the ceiling of what's possible without a native app.
// Returns the oscillators so a caller can cancel them (pause/reset/duration change).
const scheduleBeep = (when: number): OscillatorNode[] => {
  const ctx = getCtx();
  if (!ctx) return [];
  const pulses = [
    { offset: 0, freq: 1400 },
    { offset: 0.22, freq: 1400 },
  ];
  return pulses.map(({ offset, freq }) => {
    const start = when + offset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    // Fast attack, short hold, quick decay — loud and sharp without clipping
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.9, start + 0.005);
    gain.gain.setValueAtTime(0.9, start + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.22);
    return osc;
  });
};

// Cancels oscillators scheduled via scheduleBeep, whether or not they've started yet.
const cancelBeep = (oscillators: OscillatorNode[]) => {
  oscillators.forEach(osc => {
    try { osc.stop(); } catch { /* already stopped/ended */ }
  });
};

const RestTimer = ({ defaultSeconds = 90 }: RestTimerProps) => {
  const [seconds, setSeconds] = useState(defaultSeconds);
  const [isRunning, setIsRunning] = useState(false);
  const [total, setTotal] = useState(defaultSeconds);
  const [expanded, setExpanded] = useState(false);
  const endAtRef = useRef<number | null>(null);
  const scheduledBeepRef = useRef<OscillatorNode[]>([]);

  // Recompute remaining time from wall-clock time rather than trusting the interval's
  // tick count: iOS throttles/pauses setInterval when the tab is backgrounded or the
  // screen locks, so a plain decrementing counter drifts or freezes.
  const syncFromWallClock = useCallback(() => {
    if (endAtRef.current === null) return;
    const remaining = Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000));
    setSeconds(remaining);
    if (remaining <= 0) {
      setIsRunning(false);
      try {
        if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
      } catch { /* vibration unsupported/blocked */ }
    }
  }, []);

  const stopAndCancel = useCallback(() => {
    cancelBeep(scheduledBeepRef.current);
    scheduledBeepRef.current = [];
    endAtRef.current = null;
  }, []);

  useEffect(() => {
    stopAndCancel();
    setTotal(defaultSeconds);
    setSeconds(defaultSeconds);
  }, [defaultSeconds, stopAndCancel]);

  // Cancel any pending scheduled beep if the timer unmounts mid-countdown.
  useEffect(() => () => cancelBeep(scheduledBeepRef.current), []);

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(syncFromWallClock, 1000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        getCtx(); // try to resume the audio context now that we're back in the foreground
        syncFromWallClock();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isRunning, syncFromWallClock]);

  // Best-effort: keep the screen awake while resting. iOS auto-locks the screen quickly,
  // which throttles the timer and can prevent the scheduled beep from being heard.
  // No-ops silently if unsupported or refused (e.g. Low Power Mode).
  useEffect(() => {
    if (!isRunning) return;
    const nav = navigator as Navigator & {
      wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
    };
    if (!nav.wakeLock) return;
    let sentinel: { release(): Promise<void> } | null = null;
    let cancelled = false;
    nav.wakeLock.request('screen').then(s => {
      if (cancelled) { s.release().catch(() => {}); return; }
      sentinel = s;
    }).catch(() => {});
    return () => {
      cancelled = true;
      sentinel?.release().catch(() => {});
    };
  }, [isRunning]);

  const reset = useCallback(() => {
    stopAndCancel();
    setSeconds(total);
    setIsRunning(false);
  }, [total, stopAndCancel]);

  const start = () => {
    const ctx = getCtx(); // Prime/resume the audio context on this user gesture.
    const runFor = seconds === 0 ? total : seconds;
    if (seconds === 0) setSeconds(total);
    endAtRef.current = Date.now() + runFor * 1000;
    cancelBeep(scheduledBeepRef.current);
    scheduledBeepRef.current = ctx ? scheduleBeep(ctx.currentTime + runFor) : [];
    setIsRunning(true);
  };

  const pause = () => {
    syncFromWallClock();
    stopAndCancel();
    setIsRunning(false);
  };

  const applyDuration = (t: number) => {
    stopAndCancel();
    setTotal(t);
    setSeconds(t);
    setIsRunning(false);
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
            onClick={() => applyDuration(t)}
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
            onClick={isRunning ? pause : start}
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
