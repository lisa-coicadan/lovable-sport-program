interface SetDotsProps {
  /** One entry per set, true = completed. */
  states: boolean[];
  className?: string;
}

// Compact row of workflow dots summarizing an exercise's sets at a glance — the same
// orbit-dot language as BrandMark/OrbitRing, here strung along a line instead of a
// ring. Done sets glow green (the app's one "validated step" signal); everything else
// stays dim so the eye finds what's left, not what's already logged.
const SetDots = ({ states, className = '' }: SetDotsProps) => {
  if (states.length === 0) return null;
  return (
    <div className={`relative flex items-center gap-2 ${className}`}>
      <div className="absolute left-0.5 right-0.5 top-1/2 h-px bg-border -translate-y-1/2" />
      {states.map((done, i) => (
        <span
          key={i}
          className={`relative w-2 h-2 rounded-full shrink-0 transition-all ${
            done ? 'bg-success glow-success' : 'bg-secondary border border-border'
          }`}
        />
      ))}
    </div>
  );
};

export default SetDots;
