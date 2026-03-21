'use client';
import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { sfx } from '@/lib/audio';
import PlayerNameInput from '@/components/PlayerNameInput';

interface GameStartScreenProps {
  emoji: string;
  title: string;
  description: string;
  sensorNote?: string;
  ctaLabel?: string;
  accentColor: string;
  ctaTextColor?: string;
  /** Brand name passed to the consent screen */
  brandName?: string;
  /** Called with player name + avatar after registration + consent */
  onStart: (name: string, avatar: string) => void;
  /** Optional extra content shown between description and CTA (e.g. mic error messages) */
  children?: React.ReactNode;
  /**
   * Optional React node to render as the game icon instead of the emoji string.
   * Use a Lucide React icon component here to comply with the no-emoji-in-UI rule.
   * When provided, the emoji string is ignored for the start screen icon (emoji
   * is still passed through for other uses like the GameShell header).
   */
  iconNode?: React.ReactNode;
  /**
   * CSS gradient string for the start screen background.
   * E.g. 'radial-gradient(ellipse at 60% 40%, #1a0d2e 0%, #08090f 100%)'
   * Defaults to var(--color-bg) if not provided.
   */
  gradient?: string;
}

/** Returns true when no valid stored user exists — new players go straight to registration. */
function hasStoredUser(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = localStorage.getItem('mg_user');
    if (!raw) return false;
    const p = JSON.parse(raw);
    return !!(p.name || p.firstName);
  } catch {
    return false;
  }
}

/** Deterministic orb configs per position — avoids hydration mismatch */
const ORB_CONFIGS = [
  { w: 220, h: 220, top: '8%',  left: '10%',  delay: 0,    dur: 8,  opacity: 0.13 },
  { w: 160, h: 160, top: '55%', left: '72%',  delay: 2.5,  dur: 10, opacity: 0.10 },
  { w: 100, h: 100, top: '75%', left: '12%',  delay: 1.2,  dur: 7,  opacity: 0.09 },
  { w: 80,  h: 80,  top: '20%', left: '78%',  delay: 3.8,  dur: 9,  opacity: 0.08 },
];

export default function GameStartScreen({
  emoji,
  title,
  description,
  sensorNote,
  ctaLabel = 'Start Game →',
  accentColor,
  ctaTextColor = '#000',
  brandName,
  onStart,
  children,
  iconNode,
  gradient,
}: GameStartScreenProps) {
  const [showRegistration, setShowRegistration] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    if (!hasStoredUser()) {
      setShowRegistration(true);
    }
  }, []);

  // Parse accentColor to rgba for orbs
  const orbColor = accentColor;

  const background = gradient ?? 'var(--color-bg)';

  return (
    <>
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.25 }}
        style={{
          position: 'absolute',
          inset: 0,
          top: 56,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px 32px 40px',
          background,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {/* Floating orbs — idle ambient animation */}
        {mounted && ORB_CONFIGS.map((orb, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              width: orb.w,
              height: orb.h,
              top: orb.top,
              left: orb.left,
              borderRadius: '50%',
              background: orbColor,
              opacity: orb.opacity,
              filter: 'blur(40px)',
              animation: `gs-float-orb ${orb.dur}s ease-in-out ${orb.delay}s infinite alternate`,
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
        ))}

        {/* Pulsing ring on start icon */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <motion.div
            initial={{ y: -60, scale: 1.4, rotate: -18, opacity: 0 }}
            animate={{ y: 0, scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 18, delay: 0.05 }}
            style={{ fontSize: 80, lineHeight: 1, marginBottom: 20, textAlign: 'center', display: 'flex', justifyContent: 'center', position: 'relative' }}
          >
            {/* Pulsing ring behind icon */}
            <div style={{
              position: 'absolute',
              inset: -12,
              borderRadius: '50%',
              border: `2px solid ${accentColor}`,
              opacity: 0.35,
              animation: 'gs-pulse-ring 2.4s ease-in-out infinite',
              pointerEvents: 'none',
            }} />
            {iconNode ?? emoji}
          </motion.div>
        </div>

        <motion.h1
          initial={{ x: -30, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.18, duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          style={{
            color: '#fff',
            fontSize: 40,
            fontWeight: 900,
            margin: '0 0 12px',
            textAlign: 'center',
            letterSpacing: '-0.5px',
            lineHeight: 1.1,
            position: 'relative',
            zIndex: 1,
            textShadow: `0 2px 20px rgba(0,0,0,0.6), 0 0 40px ${orbColor}22`,
          }}
        >
          {title}
        </motion.h1>

        <motion.p
          initial={{ x: 30, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.25, duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          style={{
            color: 'var(--color-text-secondary)',
            fontSize: 18,
            textAlign: 'center',
            maxWidth: 300,
            lineHeight: 1.55,
            margin: '0 0 36px',
            position: 'relative',
            zIndex: 1,
          }}
        >
          {description}
        </motion.p>

        {children && (
          <div style={{ marginBottom: 16, width: '100%', maxWidth: 320, position: 'relative', zIndex: 1 }}>
            {children}
          </div>
        )}

        <motion.button
          initial={{ y: 14, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.28 }}
          whileTap={{ scale: 0.94 }}
          whileHover={{ scale: 1.02 }}
          data-testid="start-cta"
          onClick={() => { sfx.introTap(); setShowRegistration(true); }}
          style={{
            width: '100%',
            maxWidth: 320,
            height: 56,
            borderRadius: 14,
            border: 'none',
            backgroundColor: accentColor,
            color: ctaTextColor,
            fontSize: 20,
            fontWeight: 800,
            cursor: 'pointer',
            letterSpacing: '-0.3px',
            position: 'relative',
            zIndex: 1,
            boxShadow: `0 4px 24px ${accentColor}44`,
            transition: 'box-shadow 0.2s',
          }}
        >
          {ctaLabel}
        </motion.button>

        {sensorNote && (
          <p style={{
            color: 'rgba(255,255,255,0.55)',
            fontSize: 12,
            textAlign: 'center',
            marginTop: 12,
            position: 'relative',
            zIndex: 1,
          }}>
            {sensorNote}
          </p>
        )}
      </motion.div>

      {/* Registration + consent overlay */}
      {showRegistration && (
        <PlayerNameInput
          accentColor={accentColor}
          brandName={brandName}
          onReady={(name, avatar) => {
            setShowRegistration(false);
            onStart(name, avatar);
          }}
        />
      )}
    </>
  );
}
