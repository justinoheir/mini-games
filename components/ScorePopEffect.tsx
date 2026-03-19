'use client';
/**
 * ScorePopEffect — animated score popup with optional particle burst.
 *
 * Usage:
 *   const { pops, triggerPop } = useScorePop();
 *   // On score:
 *   triggerPop('+10', x, y); // x/y = px position relative to parent container
 *   // In render:
 *   <ScorePopEffect pops={pops} />
 *
 * For milestone scores (×10, ×50, ×100), pass particles={true} to triggerPop.
 */

import { useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ScorePop {
  id: number;
  label: string;
  x: number;
  y: number;
  particles: boolean;
  size: 'normal' | 'big' | 'huge';
}

interface ScorePopEffectProps {
  pops: ScorePop[];
  accentColor?: string;
}

// ─── Particle dot ─────────────────────────────────────────────────────────────

function Particle({
  angle,
  color,
  distance,
}: {
  angle: number;
  color: string;
  distance: number;
}) {
  const rad = (angle * Math.PI) / 180;
  const tx = Math.cos(rad) * distance;
  const ty = Math.sin(rad) * distance;

  return (
    <motion.div
      initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
      animate={{ x: tx, y: ty, opacity: 0, scale: 0.3 }}
      transition={{ duration: 0.55, ease: [0, 0, 0.3, 1] }}
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: color,
        marginTop: -3,
        marginLeft: -3,
        pointerEvents: 'none',
      }}
    />
  );
}

// ─── Single pop item ──────────────────────────────────────────────────────────

function PopItem({ pop, accentColor }: { pop: ScorePop; accentColor: string }) {
  const particleCount = pop.size === 'huge' ? 12 : pop.size === 'big' ? 8 : 0;
  const particleColors = [accentColor, '#fff', '#facc15', accentColor];
  const fontSize = pop.size === 'huge' ? 36 : pop.size === 'big' ? 28 : 22;

  return (
    <motion.div
      key={pop.id}
      initial={{ y: 0, opacity: 1, scale: 0.7 }}
      animate={{ y: -52, opacity: 0, scale: 1 }}
      transition={{ duration: 0.62, ease: [0, 0, 0.3, 1] }}
      style={{
        position: 'absolute',
        left: pop.x,
        top: pop.y,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        zIndex: 500,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Particle burst */}
      {pop.particles && pop.size !== 'normal' && (
        <>
          {Array.from({ length: particleCount }, (_, i) => (
            <Particle
              key={i}
              angle={(360 / particleCount) * i}
              color={particleColors[i % particleColors.length]}
              distance={28 + Math.random() * 16}
            />
          ))}
        </>
      )}

      {/* Score text */}
      <motion.div
        initial={{ scale: 0.6 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 600, damping: 18 }}
        style={{
          fontSize,
          fontWeight: 900,
          color: pop.size === 'huge' ? '#facc15' : accentColor,
          lineHeight: 1,
          letterSpacing: '-0.5px',
          textShadow:
            pop.size !== 'normal'
              ? `0 0 20px ${accentColor}88`
              : undefined,
          whiteSpace: 'nowrap',
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
        }}
      >
        {pop.label}
      </motion.div>
    </motion.div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function ScorePopEffect({
  pops,
  accentColor = '#00ff88',
}: ScorePopEffectProps) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 500,
      }}
    >
      <AnimatePresence>
        {pops.map((pop) => (
          <PopItem key={pop.id} pop={pop} accentColor={accentColor} />
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

let _popId = 0;

/** Milestone thresholds that trigger particle bursts */
const MILESTONE_VALUES = new Set([10, 25, 50, 100, 250, 500]);

export function useScorePop() {
  const [pops, setPops] = useState<ScorePop[]>([]);

  /**
   * Trigger a score pop animation.
   *
   * @param label    Display text, e.g. "+10" or "×3 COMBO!"
   * @param x        Horizontal position (px) relative to parent container
   * @param y        Vertical position (px) relative to parent container
   * @param opts.milestone  Force particle burst (for milestone scores)
   * @param opts.huge       Use largest size + gold color (for big celebrations)
   */
  const triggerPop = useCallback(
    (
      label: string,
      x: number,
      y: number,
      opts: { milestone?: boolean; huge?: boolean } = {},
    ) => {
      // Parse numeric value from label like "+10", "3", "×5"
      const numMatch = label.match(/[\d.]+/);
      const numVal = numMatch ? parseFloat(numMatch[0]) : 0;
      const isMilestone = opts.milestone ?? MILESTONE_VALUES.has(numVal);
      const isHuge = opts.huge ?? numVal >= 100;

      const pop: ScorePop = {
        id: ++_popId,
        label,
        x,
        y,
        particles: isMilestone || isHuge,
        size: isHuge ? 'huge' : isMilestone ? 'big' : 'normal',
      };

      setPops((prev) => [...prev, pop]);

      // Auto-remove after animation completes
      setTimeout(() => {
        setPops((prev) => prev.filter((p) => p.id !== pop.id));
      }, 750);
    },
    [],
  );

  return { pops, triggerPop };
}
