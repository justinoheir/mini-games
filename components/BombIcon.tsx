'use client';
/**
 * BombIcon — SVG bomb illustration used in Whisper Bomb.
 * Replaces emoji usage to comply with Ether no-emoji-in-gameplay-UI rule.
 */

interface BombIconProps {
  size?: number;
  fuseColor?: string;
  bodyColor?: string;
  strokeColor?: string;
}

export default function BombIcon({
  size = 90,
  fuseColor = '#00ff88',
  bodyColor = '#1a1a1a',
  strokeColor = '#ef4444',
}: BombIconProps) {
  const s = size;
  const cx = s * 0.5;
  const cy = s * 0.58;
  const r = s * 0.33;

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Fuse line */}
      <path
        d={`M${cx} ${cy - r} C${cx + s * 0.15} ${cy - r - s * 0.15} ${cx + s * 0.22} ${cy - r - s * 0.28} ${cx + s * 0.12} ${cy - r - s * 0.36}`}
        stroke={fuseColor}
        strokeWidth={s * 0.045}
        strokeLinecap="round"
        fill="none"
      />
      {/* Fuse spark */}
      <circle
        cx={cx + s * 0.12}
        cy={cy - r - s * 0.36}
        r={s * 0.06}
        fill="#ffcc00"
      />
      <circle
        cx={cx + s * 0.12}
        cy={cy - r - s * 0.36}
        r={s * 0.03}
        fill="#fff"
      />
      {/* Bomb body shadow */}
      <circle cx={cx + 2} cy={cy + 2} r={r} fill="rgba(0,0,0,0.5)" />
      {/* Bomb body */}
      <circle cx={cx} cy={cy} r={r} fill={bodyColor} stroke={strokeColor} strokeWidth={s * 0.028} />
      {/* Highlight */}
      <circle cx={cx - r * 0.3} cy={cy - r * 0.35} r={r * 0.2} fill="rgba(255,255,255,0.12)" />
      {/* Second highlight (smaller) */}
      <circle cx={cx - r * 0.18} cy={cy - r * 0.52} r={r * 0.08} fill="rgba(255,255,255,0.18)" />
    </svg>
  );
}
