'use client';
import { useState, useEffect } from 'react';
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
}: GameStartScreenProps) {
  // Always start false (SSR-safe). After mount, check localStorage: if no stored user
  // exists (new player), auto-show registration so the name input is immediately visible.
  // This avoids a React hydration mismatch from reading localStorage during SSR.
  const [showRegistration, setShowRegistration] = useState(false);
  useEffect(() => {
    if (!hasStoredUser()) {
      setShowRegistration(true);
    }
  }, []);

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
          background: 'var(--color-bg)',
          overflowY: 'auto',
        }}
      >
        {/* Icon — Lucide icon component preferred (iconNode), emoji fallback */}
        <motion.div
          initial={{ y: -60, scale: 1.4, rotate: -18, opacity: 0 }}
          animate={{ y: 0, scale: 1, rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 18, delay: 0.05 }}
          style={{ fontSize: 80, lineHeight: 1, marginBottom: 20, textAlign: 'center', display: 'flex', justifyContent: 'center' }}
        >
          {iconNode ?? emoji}
        </motion.div>

        <motion.h1
          initial={{ x: -30, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.18, duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          style={{
            color: '#fff', fontSize: 40, fontWeight: 900,
            margin: '0 0 12px', textAlign: 'center',
            letterSpacing: '-0.5px', lineHeight: 1.1,
          }}
        >
          {title}
        </motion.h1>

        <motion.p
          initial={{ x: 30, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.25, duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          style={{
            color: 'var(--color-text-secondary)', fontSize: 18,
            textAlign: 'center', maxWidth: 300, lineHeight: 1.55,
            margin: '0 0 36px',
          }}
        >
          {description}
        </motion.p>

        {children && (
          <div style={{ marginBottom: 16, width: '100%', maxWidth: 320 }}>
            {children}
          </div>
        )}

        <motion.button
          initial={{ y: 14, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.28 }}
          whileTap={{ scale: 0.97 }}
          data-testid="start-cta"
          onClick={() => { sfx.introTap(); setShowRegistration(true); }}
          style={{
            width: '100%', maxWidth: 320, height: 56, borderRadius: 14, border: 'none',
            backgroundColor: accentColor, color: ctaTextColor,
            /* 20px = 15pt bold → WCAG "large text" → 3:1 contrast threshold */
            fontSize: 20, fontWeight: 800, cursor: 'pointer', letterSpacing: '-0.3px',
          }}
        >
          {ctaLabel}
        </motion.button>

        {sensorNote && (
          <p style={{
            color: 'rgba(255,255,255,0.55)', fontSize: 12,
            textAlign: 'center', marginTop: 12,
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
