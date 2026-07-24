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
const emitPulses = (
  when: number,
  pulses: { offset: number; freq: number }[],
  hold: number,
  decay: number,
): OscillatorNode[] => {
  const ctx = getSharedAudioContext();
  if (!ctx) return [];
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -24;
  limiter.knee.value = 10;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  limiter.connect(ctx.destination);

  const oscillators: OscillatorNode[] = [];
  pulses.forEach(({ offset, freq }) => {
    const start = when + offset;
    // Fundamental + octave stacked for extra loudness, tamed by the shared limiter
    [{ f: freq, peak: 1 }, { f: freq * 2, peak: 0.6 }].forEach(({ f, peak }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = f;
      // Near-instant attack, held hold duration, then decay — hits hard and sharp
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.002);
      gain.gain.setValueAtTime(peak, start + hold);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + decay);
      osc.connect(gain);
      gain.connect(limiter);
      osc.start(start);
      osc.stop(start + decay);
      oscillators.push(osc);
    });
  });
  return oscillators;
};

export const scheduleBeep = (when: number): OscillatorNode[] =>
  emitPulses(when, [{ offset: 0, freq: 1400 }, { offset: 0.22, freq: 1400 }], 0.12, 0.2);

// Longer, distinct signal for the very end of an EMOM (vs. the per-minute beep above):
// 3 pulses instead of 2, each held longer, so it's unmistakably the "done" sound.
export const scheduleFinalBeep = (when: number): OscillatorNode[] =>
  emitPulses(
    when,
    [{ offset: 0, freq: 1400 }, { offset: 0.3, freq: 1400 }, { offset: 0.6, freq: 1400 }],
    0.25,
    0.35,
  );

// Cancels oscillators scheduled via scheduleBeep, whether or not they've started yet.
export const cancelBeep = (oscillators: OscillatorNode[]) => {
  oscillators.forEach(osc => {
    try { osc.stop(); } catch { /* already stopped/ended */ }
  });
};
