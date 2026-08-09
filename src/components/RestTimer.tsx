import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle, memo, CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Pause, Play, RotateCcw, X, Timer, Plus, Check } from 'lucide-react';
import { getSharedAudioContext, scheduleBeep, cancelBeep } from '@/lib/beep';
import OrbitRing from './OrbitRing';

interface RestTimerProps {
  defaultSeconds?: number;
}

// Where she's dragged the floating timer to — a UI preference, not training data, so it
// lives in its own localStorage key rather than AppData (no export/backup implications).
type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
const CORNER_STORAGE_KEY = 'fitness-tracker-timer-corner';
const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function loadCorner(): Corner {
  try {
    const stored = localStorage.getItem(CORNER_STORAGE_KEY);
    if ((CORNERS as string[]).includes(stored || '')) return stored as Corner;
  } catch { /* localStorage unavailable (private browsing, etc.) */ }
  return 'bottom-right';
}

function saveCorner(corner: Corner) {
  try { localStorage.setItem(CORNER_STORAGE_KEY, corner); } catch { /* ignore */ }
}

// Bottom stays a fixed 96px (clears the bottom tab bar, unchanged from the original,
// already-tested position) — top needs the notch/status-bar safe area instead, since
// nothing else on this fixed/portaled overlay accounts for it.
function cornerStyle(corner: Corner): CSSProperties {
  const style: CSSProperties = { position: 'fixed' };
  if (corner.startsWith('top')) style.top = 'calc(env(safe-area-inset-top, 0px) + 16px)';
  else style.bottom = 96;
  if (corner.endsWith('left')) style.left = 16;
  else style.right = 16;
  return style;
}

function nearestCorner(x: number, y: number): Corner {
  const vertical = y < window.innerHeight / 2 ? 'top' : 'bottom';
  const horizontal = x < window.innerWidth / 2 ? 'left' : 'right';
  return `${vertical}-${horizontal}` as Corner;
}

const formatDurationLabel = (totalSeconds: number): string => {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return s === 0 ? `${m}m` : `${m}m${s.toString().padStart(2, '0')}`;
};

// Imperative handle so other cards (e.g. the Cluster block) can start a rest countdown
// of their own duration on tap, synchronously within the click — needed so the audio
// context unlock still counts as happening within the user gesture on iOS.
export interface RestTimerHandle {
  startWithDuration: (seconds: number) => void;
}

// memo: WorkoutTab re-renders very frequently during a session (every keystroke in a
// reps/weight field, every drag reorder...) — without this, each of those re-renders
// this too, on top of its own internal 1s tick, doubling up main-thread work at
// unpredictable moments and making the countdown more likely to stall/skip a step.
const RestTimer = memo(forwardRef<RestTimerHandle, RestTimerProps>(({ defaultSeconds = 90 }, ref) => {
  const [seconds, setSeconds] = useState(defaultSeconds);
  const [isRunning, setIsRunning] = useState(false);
  const [total, setTotal] = useState(defaultSeconds);
  const [expanded, setExpanded] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customMin, setCustomMin] = useState('');
  const [customSec, setCustomSec] = useState('');
  const [corner, setCorner] = useState<Corner>(loadCorner);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const endAtRef = useRef<number | null>(null);
  const scheduledBeepRef = useRef<OscillatorNode[]>([]);
  // Flips true the moment any tick notices the shared AudioContext isn't 'running' while
  // the page is fully visible — WebKit can idle-auto-suspend it mid-countdown for power
  // saving (a rest period is mostly silence until the very end) or drop it during a brief
  // audio-session interruption (call, Siri, a notification sound, a Bluetooth route
  // change), none of which fire `visibilitychange`. Once flagged, we no longer trust the
  // beep scheduled at countdown-start and replay a fresh one from a guaranteed-live
  // context when the countdown ends — see syncFromWallClock below.
  const suspectedMissRef = useRef(false);
  // Not state: read synchronously in the pointerup/click handlers to distinguish a tap
  // (open the panel) from a drag (reposition) without waiting for a re-render.
  const dragStateRef = useRef<{ startX: number; startY: number; dragging: boolean } | null>(null);

  // Recompute remaining time from wall-clock time rather than trusting the interval's
  // tick count: iOS throttles/pauses setInterval when the tab is backgrounded or the
  // screen locks, so a plain decrementing counter drifts or freezes.
  //
  // `resumed: true` means we're finding out the rest period is over specifically because
  // the page just came back to the foreground (screen unlock, app switch back...) — iOS in
  // particular routinely suspends the Web Audio context while the screen is locked, so the
  // beep scheduled at countdown-start can silently never sound even though it was
  // correctly scheduled (this was the "sonne 3 fois sur 4" flakiness: it played fine
  // whenever she kept the screen on, and silently dropped whenever it locked). Firing a
  // fresh beep right now, on the just-resumed (guaranteed-running) context, is the only
  // way to make it reliable — the normal foreground path is left alone so it doesn't
  // double up when the original scheduled beep already played on time.
  const syncFromWallClock = useCallback((opts?: { resumed?: boolean }) => {
    if (endAtRef.current === null) return;
    // Cheap every-tick poll: getSharedAudioContext() also nudges resume() as a side
    // effect, so this both detects AND actively retries recovery, once a second, for as
    // long as the countdown runs — not just on the visibilitychange edge below.
    const liveCheck = getSharedAudioContext();
    if (liveCheck && liveCheck.state !== 'running' && document.visibilityState === 'visible') {
      suspectedMissRef.current = true;
    }
    const remaining = Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000));
    if (remaining <= 0) {
      endAtRef.current = null;
      cancelBeep(scheduledBeepRef.current);
      scheduledBeepRef.current = [];
      setIsRunning(false);
      setSeconds(total); // auto-reset, ready for the next rest period
      if (opts?.resumed || suspectedMissRef.current) {
        const ctx = getSharedAudioContext();
        if (ctx) scheduleBeep(ctx.currentTime);
      }
      suspectedMissRef.current = false;
      try {
        if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
      } catch { /* vibration unsupported/blocked */ }
      return;
    }
    setSeconds(remaining);
  }, [total]);

  const stopAndCancel = useCallback(() => {
    cancelBeep(scheduledBeepRef.current);
    scheduledBeepRef.current = [];
    endAtRef.current = null;
  }, []);

  useEffect(() => {
    stopAndCancel();
    setTotal(defaultSeconds);
    setSeconds(defaultSeconds);
    setIsRunning(false); // stopAndCancel only clears the beep/endAt — without this a
    // countdown in progress when defaultSeconds changes would stay "running" forever
    // with nothing left to drive it.
  }, [defaultSeconds, stopAndCancel]);

  // Cancel any pending scheduled beep if the timer unmounts mid-countdown.
  useEffect(() => () => cancelBeep(scheduledBeepRef.current), []);

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(syncFromWallClock, 1000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const ctx = getSharedAudioContext(); // try to resume the audio context now that we're back in the foreground
        // The rest period hasn't ended yet — iOS may well have suspended the audio
        // context at some point while backgrounded, silently dropping the beep
        // originally scheduled in beginCountdown (its absolute AudioContext time can
        // already be in the past by the time the context resumes). Rescheduling fresh,
        // right now, on a context we just confirmed is live, is the only way to
        // guarantee it still sounds — this is what actually fixed the "sonne 3 fois sur
        // 4" flakiness, the previous fix only covered resuming AFTER expiry below.
        if (ctx && endAtRef.current !== null) {
          const remainingMs = endAtRef.current - Date.now();
          if (remainingMs > 0) {
            cancelBeep(scheduledBeepRef.current);
            scheduledBeepRef.current = scheduleBeep(ctx.currentTime + remainingMs / 1000);
          }
        }
        syncFromWallClock({ resumed: true });
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

  // Primes/resumes the audio context and schedules the end-of-rest beep. Must be called
  // synchronously from a user gesture (click handler) for iOS to allow the audio context.
  const beginCountdown = useCallback((duration: number) => {
    const ctx = getSharedAudioContext();
    endAtRef.current = Date.now() + duration * 1000;
    suspectedMissRef.current = false;
    cancelBeep(scheduledBeepRef.current);
    scheduledBeepRef.current = ctx ? scheduleBeep(ctx.currentTime + duration) : [];
    setIsRunning(true);
  }, []);

  const start = () => {
    const runFor = seconds === 0 ? total : seconds;
    if (seconds === 0) setSeconds(total);
    beginCountdown(runFor);
  };

  useImperativeHandle(ref, () => ({
    startWithDuration: (secs: number) => {
      stopAndCancel();
      setTotal(secs);
      setSeconds(secs);
      setExpanded(true);
      beginCountdown(secs);
    },
  }), [stopAndCancel, beginCountdown]);

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

  const applyCustomDuration = () => {
    const m = parseInt(customMin, 10) || 0;
    const s = parseInt(customSec, 10) || 0;
    const t = m * 60 + s;
    if (t <= 0) return;
    applyDuration(t);
    setCustomOpen(false);
    setCustomMin('');
    setCustomSec('');
  };

  const progress = total > 0 ? (seconds / total) * 100 : 0;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  // Drag-to-reposition on the collapsed circle only — a 10px threshold before it counts
  // as a drag (rather than a tap) keeps normal taps opening the panel as before, and the
  // button visually follows the finger via a transform so it doesn't feel inert mid-drag.
  const onDragPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    dragStateRef.current = { startX: e.clientX, startY: e.clientY, dragging: false };
  };

  const onDragPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const state = dragStateRef.current;
    if (!state) return;
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    if (!state.dragging && Math.hypot(dx, dy) > 10) {
      state.dragging = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (state.dragging) setDragOffset({ x: dx, y: dy });
  };

  const onDragPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const state = dragStateRef.current;
    if (state?.dragging) {
      const next = nearestCorner(e.clientX, e.clientY);
      setCorner(next);
      saveCorner(next);
    }
    setDragOffset(null);
  };

  const onCollapsedClick = () => {
    // A drag that just ended shouldn't also open the panel — pointerup already handled it.
    if (dragStateRef.current?.dragging) { dragStateRef.current = null; return; }
    dragStateRef.current = null;
    setExpanded(true);
  };

  // Rendered via a portal straight into document.body — a `position: fixed` element
  // still resolves relative to any ANCESTOR that has an active/lingering `transform`
  // (this is spec behavior, not a bug in one engine), and iOS Safari standalone-PWA mode
  // has repeatedly proven more sensitive to this than desktop browsers even when no such
  // ancestor is visible on inspection. A portal sidesteps the question entirely: the DOM
  // node is a direct child of <body>, so no intermediate ancestor can ever hijack it.

  // Floating button when collapsed
  if (!expanded) {
    return createPortal(
      <div style={cornerStyle(corner)} className="z-40">
        {isRunning && <div className="absolute inset-0 bg-primary/40 rounded-full blur-xl animate-pulse-glow" />}
        <button
          onClick={onCollapsedClick}
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerUp}
          onPointerCancel={() => { dragStateRef.current = null; setDragOffset(null); }}
          // touch-action must be 'none' from the very first touch, not just once the 10px
          // threshold trips — iOS/Android decide whether a touch is a scroll gesture right
          // at touchstart, and won't hand pointermove events back to us mid-gesture once
          // they've claimed it. Setting this only while `dragOffset` is truthy (i.e. after
          // dragging was already detected) was too late, which read as "slow/difficult to
          // drag" since most attempts got eaten as a page scroll before ever registering.
          style={{ touchAction: 'none', ...(dragOffset ? { transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` } : {}) }}
          className={`relative w-14 h-14 rounded-full flex items-center justify-center shadow-lg active:scale-90 ${
            dragOffset ? '' : 'transition-all'
          } ${isRunning ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-foreground'}`}
        >
          {isRunning ? (
            <span className="font-mono text-xs font-bold">{mins}:{secs.toString().padStart(2, '0')}</span>
          ) : (
            <Timer size={20} />
          )}
        </button>
      </div>,
      document.body
    );
  }

  // `.glass-card` applies `position: relative` (needed by its own ::before glow layer)
  // via a utilities-layer rule declared AFTER Tailwind's own `.fixed` utility in
  // index.css — same specificity, same layer, so it silently won and this panel was
  // rendering in normal flow instead of pinned to the viewport. Every other
  // fixed-overlay + glass-card pairing in the app already avoids this by keeping them
  // on separate elements (see the confirm dialogs in SettingsPanel/WorkoutTab) — this
  // was the one place that combined both classes on the same node.
  return createPortal(
    <div style={cornerStyle(corner)} className="z-40 w-72">
      <div className="glass-card p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-muted-foreground">Minuteur de repos</span>
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
              {formatDurationLabel(t)}
            </button>
          ))}
          <button
            onClick={() => setCustomOpen(v => !v)}
            className={`flex-1 py-1.5 rounded-lg flex items-center justify-center transition-colors ${
              customOpen ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
            }`}
            aria-label="Durée personnalisée"
            aria-pressed={customOpen}
          >
            <Plus size={12} />
          </button>
        </div>

        {customOpen && (
          <div className="flex items-center gap-1.5 mb-3">
            <input
              type="number"
              inputMode="numeric"
              value={customMin}
              onChange={e => setCustomMin(e.target.value)}
              placeholder="min"
              className="w-14 bg-secondary rounded-lg text-foreground text-sm text-center outline-none font-mono py-1.5"
              aria-label="Minutes"
            />
            <span className="text-muted-foreground text-xs">'</span>
            <input
              type="number"
              inputMode="numeric"
              value={customSec}
              onChange={e => setCustomSec(e.target.value)}
              placeholder="sec"
              className="w-14 bg-secondary rounded-lg text-foreground text-sm text-center outline-none font-mono py-1.5"
              aria-label="Secondes"
            />
            <button
              onClick={applyCustomDuration}
              className="touch-target flex-1 flex items-center justify-center bg-primary text-primary-foreground rounded-lg py-1.5"
              aria-label="Valider la durée personnalisée"
            >
              <Check size={14} />
            </button>
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="relative w-14 h-14">
            <OrbitRing progress={progress / 100} size={56} />
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
    </div>,
    document.body
  );
}));

RestTimer.displayName = 'RestTimer';

export default RestTimer;
