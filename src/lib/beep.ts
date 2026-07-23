// Shared Web Audio beep used by RestTimer and EmomTimer.

// Persistent AudioContext — created once on first user gesture.
// Web Audio API by default mixes with background media (Spotify/Apple Music on iOS)
// as long as we never touch an HTMLAudioElement.
let sharedCtx: AudioContext | null = null;
export const getSharedAudioContext = (): AudioContext | null => {
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
// Square wave + high pitch for cut-through; each pulse stacks the fundamental with its
// octave (extra perceived loudness/brightness) through a shared limiter so the stack
// doesn't harshly clip. A web page can't detect or duck another app's volume (Spotify/
// Apple Music), so this is the loudest tone we can generate on our own end — the
// ceiling of what's possible without a native app.
// Returns the oscillators so a caller can cancel them (pause/reset/duration change).
export const scheduleBeep = (when: number): OscillatorNode[] => {
  const ctx = getSharedAudioContext();
  if (!ctx) return [];
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -24;
  limiter.knee.value = 10;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  limiter.connect(ctx.destination);

  const pulses = [
    { offset: 0, freq: 1400 },
    { offset: 0.22, freq: 1400 },
  ];
  const oscillators: OscillatorNode[] = [];
  pulses.forEach(({ offset, freq }) => {
    const start = when + offset;
    // Fundamental + octave stacked for extra loudness, tamed by the shared limiter
    [{ f: freq, peak: 1 }, { f: freq * 2, peak: 0.6 }].forEach(({ f, peak }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = f;
      // Near-instant attack, short hold, quick decay — hits hard and sharp
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.002);
      gain.gain.setValueAtTime(peak, start + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
      osc.connect(gain);
      gain.connect(limiter);
      osc.start(start);
      osc.stop(start + 0.22);
      oscillators.push(osc);
    });
  });
  return oscillators;
};

// Cancels oscillators scheduled via scheduleBeep, whether or not they've started yet.
export const cancelBeep = (oscillators: OscillatorNode[]) => {
  oscillators.forEach(osc => {
    try { osc.stop(); } catch { /* already stopped/ended */ }
  });
};
