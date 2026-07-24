import { useId } from 'react';

interface BrandMarkProps {
  size?: number;
  animated?: boolean;
  className?: string;
}

// Signature mark: a dumbbell fused with a flexed-muscle line, ringed by the dotted
// workflow orbit — the same dot language reused functionally across the app for set
// and timer progress (see OrbitRing/SetDots). Colors always run the cyan -> violet ->
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

      {/* Flexed-muscle line, fused into the bar beneath it */}
      <path
        d="M 30 48 C 35 23, 46 13, 50 30 C 54 13, 65 23, 70 48"
        fill="none"
        stroke={`url(#${flowId})`}
        strokeWidth="4.5"
        strokeLinecap="round"
      />

      {/* Dumbbell */}
      <rect x="28" y="47" width="44" height="6" rx="3" fill={`url(#${barId})`} />
      <rect x="15" y="41" width="6" height="18" rx="2.5" fill="hsl(189 94% 55%)" opacity="0.65" />
      <rect x="19" y="36" width="9" height="28" rx="3" fill="hsl(189 94% 55%)" />
      <rect x="72" y="36" width="9" height="28" rx="3" fill="hsl(322 100% 60%)" />
      <rect x="79" y="41" width="6" height="18" rx="2.5" fill="hsl(322 100% 60%)" opacity="0.65" />
    </svg>
  );
};

export default BrandMark;
