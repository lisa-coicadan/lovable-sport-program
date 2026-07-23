import { useState, useEffect, useCallback, useRef } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { getSharedAudioContext, scheduleBeep, cancelBeep } from '@/lib/beep';

interface EmomTimerProps {
  totalMinutes: number;
}

// One continuous countdown for the whole EMOM duration, auto-beeping at every minute
// boundary (unlike RestTimer, which is manually re-triggered for each rest period).
// Beeps are (re)scheduled from the elapsed time so pausing/resuming keeps the same
// minute cadence instead of drifting.
const EmomTimer = ({ totalMinutes }: EmomTimerProps) => {
  const totalSeconds = totalMinutes * 60;
  const [seconds, setSeconds] = useState(totalSeconds);
  const [isRunning, setIsRunning] = useState(false);
  const endAtRef = useRef<number | null>(null);
  const scheduledBeepsRef = useRef<OscillatorNode[]>([]);

  const stopAndCancel = useCallback(() => {
    cancelBeep(scheduledBeepsRef.current);
    scheduledBeepsRef.current = [];
    endAtRef.current = null;
  }, []);

  // Recompute remaining time from wall-clock time rather than trusting the interval's
  // tick count: iOS throttles/pauses setInterval when the tab is backgrounded or the
  // screen locks, so a plain decrementing counter drifts or freezes.
  const syncFromWallClock = useCallback(() => {
    if (endAtRef.current === null) return;
    const remaining = Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000));
    if (remaining <= 0) {
      stopAndCancel();
      setIsRunning(false);
      setSeconds(totalSeconds); // ready for another round
      try {
        if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
      } catch { /* vibration unsupported/blocked */ }
      return;
    }
    setSeconds(remaining);
  }, [stopAndCancel, totalSeconds]);

  useEffect(() => {
    stopAndCancel();
    setSeconds(totalSeconds);
    setIsRunning(false);
  }, [totalSeconds, stopAndCancel]);

  useEffect(() => () => cancelBeep(scheduledBeepsRef.current), []);

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(syncFromWallClock, 1000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        getSharedAudioContext();
        syncFromWallClock();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isRunning, syncFromWallClock]);

  // Best-effort: keep the screen awake while the EMOM is running.
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

  // Schedules a beep at every upcoming minute boundary, computed from elapsed time so
  // resuming after a pause keeps firing on the original :00 marks instead of restarting
  // the minute count from the resume point. Must run synchronously from the click that
  // starts/resumes, for iOS to allow the audio context.
  const beginCountdown = useCallback((remaining: number) => {
    const ctx = getSharedAudioContext();
    const elapsed = totalSeconds - remaining;
    endAtRef.current = Date.now() + remaining * 1000;
    cancelBeep(scheduledBeepsRef.current);
    scheduledBeepsRef.current = [];
    if (ctx) {
      for (let boundary = Math.ceil((elapsed + 0.001) / 60) * 60; boundary <= totalSeconds; boundary += 60) {
        scheduledBeepsRef.current.push(...scheduleBeep(ctx.currentTime + (boundary - elapsed)));
      }
    }
    setIsRunning(true);
  }, [totalSeconds]);

  const start = () => beginCountdown(seconds === 0 ? totalSeconds : seconds);

  const pause = () => {
    syncFromWallClock();
    stopAndCancel();
    setIsRunning(false);
  };

  const reset = () => {
    stopAndCancel();
    setSeconds(totalSeconds);
    setIsRunning(false);
  };

  const progress = totalSeconds > 0 ? (seconds / totalSeconds) * 100 : 0;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const elapsedSeconds = totalSeconds - seconds;
  const currentMinute = Math.min(totalMinutes, Math.floor(elapsedSeconds / 60) + 1);

  return (
    <div className="flex items-center gap-3">
      <div className="relative w-14 h-14 shrink-0">
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
      <div className="flex-1">
        <p className="text-xs text-muted-foreground mb-1.5">
          {isRunning || elapsedSeconds > 0 ? `Minute ${currentMinute}/${totalMinutes}` : `${totalMinutes} minutes`}
        </p>
        <div className="flex gap-2">
          <button
            onClick={isRunning ? pause : start}
            className="flex-1 touch-target bg-primary text-primary-foreground rounded-xl py-2.5 font-medium text-sm flex items-center justify-center gap-1.5 transition-transform active:scale-95"
          >
            {isRunning ? <Pause size={14} /> : <Play size={14} />}
            {isRunning ? 'Pause' : 'Démarrer'}
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

export default EmomTimer;
