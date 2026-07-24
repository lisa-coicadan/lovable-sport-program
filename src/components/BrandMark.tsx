import { useId } from 'react';

interface BrandMarkProps {
  size?: number;
  animated?: boolean;
  className?: string;
}

// Signature mark: a stylized neon dumbbell, ringed by the dotted workflow orbit —
// the same dot language reused functionally across the app for set and timer
// progress (see OrbitRing/SetDots). Colors always run the cyan -> violet ->
// magenta flow, the trio's "data / motion / identity" read per the brief.
const BrandMark = ({ size = 96, animated = true, className = '' }: BrandMarkProps) => {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const flowId = `bm-flow-${uid}`;
  const barId = `bm-bar-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="muscu lisa"
    >
      <defs>
        <linearGradient id={flowId} x1="10" y1="10" x2="90" y2="90" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="hsl(189 94% 55%)" />
          <stop offset="50%" stopColor="hsl(262 83% 66%)" />
          <stop offset="100%" stopColor="hsl(322 100% 60%)" />
        </linearGradient>
        <linearGradient id={barId} x1="19" y1="50" x2="81" y2="50" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="hsl(189 94% 55%)" />
          <stop offset="100%" stopColor="hsl(322 100% 60%)" />
        </linearGradient>
      </defs>

      <g className={animated ? 'motion-safe:animate-[spin_28s_linear_infinite]' : undefined} style={{ transformOrigin: '50px 50px' }}>
        <circle
          cx="50" cy="50" r="46"
          fill="none"
          stroke={`url(#${flowId})`}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="0.1 9.4"
          opacity="0.85"
        />
      </g>
      <circle cx="50" cy="4.3" r="2.8" fill="hsl(189 94% 55%)" className={animated ? 'animate-pulse-glow' : ''} />
      <circle cx="90.5" cy="65" r="2.8" fill="hsl(322 100% 60%)" className={animated ? 'animate-pulse-glow' : ''} />

      {/* Dumbbell — the sole mark now, sized up to fill the space and given a soft
          neon halo so it carries the identity on its own */}
      <g style={{ filter: 'drop-shadow(0 0 6px hsl(262 83% 66% / 0.45))' }}>
        <rect x="30" y="47" width="40" height="6" rx="3" fill={`url(#${barId})`} />

        {/* Left plate stack */}
        <rect x="13" y="39" width="7" height="22" rx="3.5" fill="hsl(189 94% 55%)" opacity="0.55" />
        <rect x="18" y="33" width="11" height="34" rx="5.5" fill="hsl(189 94% 55%)" />
        <rect x="20.5" y="37" width="3" height="10" rx="1.5" fill="hsl(0 0% 100%)" opacity="0.35" />

        {/* Right plate stack */}
        <rect x="71" y="33" width="11" height="34" rx="5.5" fill="hsl(322 100% 60%)" />
        <rect x="80" y="39" width="7" height="22" rx="3.5" fill="hsl(322 100% 60%)" opacity="0.55" />
        <rect x="76.5" y="37" width="3" height="10" rx="1.5" fill="hsl(0 0% 100%)" opacity="0.3" />
      </g>
    </svg>
  );
};

export default BrandMark;
