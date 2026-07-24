interface OrbitRingProps {
  /** Fraction of the ring still lit, 0..1 (matches "time/steps remaining"). */
  progress: number;
  size?: number;
}

const DOTS = 32;

// Circular timer progress rendered as a ring of dots instead of a solid stroke —
// the same dotted-workflow language as BrandMark's orbit, reused functionally here
// as the rest/EMOM countdown indicator. Lit dots run cyan -> violet -> magenta.
const OrbitRing = ({ progress, size = 56 }: OrbitRingProps) => {
  const clamped = Math.max(0, Math.min(1, progress));
  const lit = Math.round(clamped * DOTS);

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="-rotate-90">
      {Array.from({ length: DOTS }).map((_, i) => {
        const angle = (i / DOTS) * 2 * Math.PI;
        const cx = 32 + 27 * Math.cos(angle);
        const cy = 32 + 27 * Math.sin(angle);
        const isLit = i < lit;
        const color = i < DOTS / 3 ? 'hsl(189 94% 55%)' : i < (2 * DOTS) / 3 ? 'hsl(262 83% 66%)' : 'hsl(322 100% 60%)';
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={isLit ? 1.9 : 1.3}
            fill={isLit ? color : 'hsl(var(--progress-track))'}
            opacity={isLit ? 1 : 0.7}
          />
        );
      })}
    </svg>
  );
};

export default OrbitRing;
