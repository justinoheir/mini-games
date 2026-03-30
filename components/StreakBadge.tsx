'use client';
/**
 * StreakBadge — combo streak counter with fire animation.
 *
 * Usage:
 *   <StreakBadge streak={5} accentColor="#f97316" />
 *
 * Props:
 *   streak      - Current streak count. Renders nothing if < 3.
 *   accentColor - Game accent color (used as base glow)
 *   position    - Where on screen. Default: 'bottom-center'
 *   onBreak     - Called when streak drops back to < 3 (for animation timing)
 */

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Flame } from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface StreakBadgeProps {
  streak: number;
  accentColor?: string;
  position?: 'bottom-center' | 'top-center' | 'inline';
  style?: React.CSSProperties;
}

// ─── Tier Config ──────────────────────────────────────────────────────────────

function getStreakTier(streak: number) {
  if (streak >= 20) return { flames: 3, color: '#ff3d00', glow: 'rgba(255,61,0,0.6)',  textColor: '#fff',    pulse: true,  shake: true  };
  if (streak >= 10) return { flames: 2, color: '#ff6d00', glow: 'rgba(255,109,0,0.5)', textColor: '#fff',    pulse: true,  shake: false };
  if (streak >= 5)  return { flames: 1, color: '#f97316', glow: 'rgba(249,115,22,0.45)', textColor: '#fff',  pulse: true,  shake: false };
  return                   { flames: 1, color: '#facc15', glow: 'rgba(250,204,21,0.35)', textColor: '#1a1a1a', pulse: false, shake: false };
}

// ─── Fire flicker particles ───────────────────────────────────────────────────

function FireParticle({ index, color }: { index: number; color: string }) {
  const delay = (index * 0.13) % 0.4;
  const xOffset = (index % 3 - 1) * 8;

  return (
    <motion.div
      style={{
        position: 'absolute',
        bottom: '100%',
        left: '50%',
        width: 4,
        height: 4,
        borderRadius: '50%',
        background: color,
        marginLeft: xOffset - 2,
        pointerEvents: 'none',
      }}
      animate={{
        y: [-4, -14, -10, -20],
        opacity: [0, 0.8, 0.6, 0],
        scale: [0.5, 1, 0.8, 0.2],
      }}
      transition={{
        duration: 0.6,
        delay,
        repeat: Infinity,
        ease: 'easeOut',
      }}
    />
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function StreakBadge({
  streak,
  accentColor = '#f97316',
  position = 'bottom-center',
  style,
}: StreakBadgeProps) {
  const prevStreak = useRef(streak);
  const [isBreaking, setIsBreaking] = useState(false);
  const [displayStreak, setDisplayStreak] = useState(streak);

  // Detect streak break (going from ≥3 down to <3)
  useEffect(() => {
    const prev = prevStreak.current;
    if (prev >= 3 && streak < 3) {
      setIsBreaking(true);
      setTimeout(() => {
        setIsBreaking(false);
        setDisplayStreak(streak);
      }, 280);
    } else {
      setDisplayStreak(streak);
    }
    prevStreak.current = streak;
  }, [streak]);

  // Milestone celebration at ×10
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    if (streak === 10) {
      setCelebrating(true);
      setTimeout(() => setCelebrating(false), 1200);
    }
  }, [streak]);

  const visible = displayStreak >= 3 && !isBreaking;
  if (!visible && !isBreaking) return null;

  const tier = getStreakTier(displayStreak);

  const positionStyle: React.CSSProperties =
    position === 'bottom-center'
      ? { position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 200 }
      : position === 'top-center'
      ? { position: 'absolute', top: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 200 }
      : {};

  return (
    <AnimatePresence>
      {!isBreaking && (
        <motion.div
          key={`streak-${displayStreak}`}
          initial={{ scale: 0.5, opacity: 0, y: 12 }}
          animate={{
            scale: celebrating ? [1, 1.18, 0.95, 1.08, 1] : 1,
            opacity: 1,
            y: 0,
          }}
          exit={{ scale: 0.3, opacity: 0, rotate: -15 }}
          transition={
            celebrating
              ? { duration: 0.6, times: [0, 0.2, 0.5, 0.8, 1] }
              : { type: 'spring', stiffness: 500, damping: 20 }
          }
          style={{
            ...positionStyle,
            ...style,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: `linear-gradient(135deg, ${tier.color}22 0%, ${tier.color}11 100%)`,
            border: `1.5px solid ${tier.color}55`,
            borderRadius: 999,
            padding: '7px 14px 7px 10px',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            boxShadow: tier.pulse
              ? `0 0 24px ${tier.glow}, 0 0 8px ${tier.glow}, inset 0 1px 0 rgba(255,255,255,0.1)`
              : `0 2px 12px rgba(0,0,0,0.4)`,
            userSelect: 'none',
            pointerEvents: 'none',
            position: position === 'inline' ? 'relative' : positionStyle.position,
          }}
        >
          {/* Fire particles (only for streaks ≥ 5) */}
          {displayStreak >= 5 && (
            <div style={{ position: 'relative', width: 0, height: 0 }}>
              {[0, 1, 2].map((i) => (
                <FireParticle key={i} index={i} color={tier.color} />
              ))}
            </div>
          )}

          {/* Fire label — Lucide Flame icons (no emoji per design rules) */}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, lineHeight: 1 }}>
            {Array.from({ length: tier.flames }).map((_, i) => (
              <Flame key={i} size={displayStreak >= 10 ? 18 : 16} color={tier.textColor === '#fff' ? '#fff' : tier.color} />
            ))}
          </span>

          {/* Count */}
          <AnimatePresence mode="popLayout">
            <motion.span
              key={displayStreak}
              initial={{ y: -8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              style={{
                fontSize: displayStreak >= 10 ? 22 : 18,
                fontWeight: 900,
                color: tier.textColor,
                lineHeight: 1,
                letterSpacing: '-0.5px',
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
                fontVariantNumeric: 'tabular-nums',
                textShadow: displayStreak >= 5 ? `0 0 12px ${tier.color}` : 'none',
              }}
            >
              {displayStreak}
            </motion.span>
          </AnimatePresence>

          {/* "STREAK" label */}
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: tier.color,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              lineHeight: 1,
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              opacity: 0.85,
            }}
          >
            STREAK
          </span>

          {/* Milestone glow ring */}
          {celebrating && (
            <motion.div
              initial={{ scale: 0.8, opacity: 0.8 }}
              animate={{ scale: 2.5, opacity: 0 }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
              style={{
                position: 'absolute',
                inset: -2,
                borderRadius: 999,
                border: `2px solid ${tier.color}`,
                pointerEvents: 'none',
              }}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
