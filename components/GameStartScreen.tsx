'use client';
import { motion } from 'framer-motion';

interface GameStartScreenProps {
  emoji: string;
  title: string;
  description: string;
  sensorNote?: string;
  ctaLabel: string;
  accentColor: string;
  ctaTextColor?: string;
  onStart: () => void;
  children?: React.ReactNode;
}

export default function GameStartScreen({
  emoji,
  title,
  description,
  sensorNote,
  ctaLabel,
  accentColor,
  ctaTextColor = '#000',
  onStart,
  children,
}: GameStartScreenProps) {
  return (
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
      <motion.div
        initial={{ scale: 0.4, rotate: -18, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 22, delay: 0.08 }}
        style={{ fontSize: 80, lineHeight: 1, marginBottom: 20, textAlign: 'center' }}
      >
        {emoji}
      </motion.div>

      <motion.h1
        initial={{ y: 18, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15, duration: 0.28 }}
        style={{
          color: '#fff',
          fontSize: 36,
          fontWeight: 900,
          margin: '0 0 12px',
          textAlign: 'center',
          letterSpacing: '-0.5px',
          lineHeight: 1.1,
        }}
      >
        {title}
      </motion.h1>

      <motion.p
        initial={{ y: 14, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.22, duration: 0.28 }}
        style={{
          color: 'var(--color-text-secondary)',
          fontSize: 16,
          textAlign: 'center',
          maxWidth: 300,
          lineHeight: 1.55,
          margin: '0 0 36px',
        }}
      >
        {description}
      </motion.p>

      {children && (
        <div style={{ marginBottom: 24, width: '100%', maxWidth: 320 }}>
          {children}
        </div>
      )}

      <motion.button
        initial={{ y: 14, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.28 }}
        whileTap={{ scale: 0.97 }}
        onClick={onStart}
        style={{
          width: '100%',
          maxWidth: 320,
          height: 56,
          borderRadius: 14,
          border: 'none',
          backgroundColor: accentColor,
          color: ctaTextColor,
          fontSize: 17,
          fontWeight: 800,
          cursor: 'pointer',
          letterSpacing: '-0.3px',
        }}
      >
        {ctaLabel}
      </motion.button>

      {sensorNote && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.55 }}
          transition={{ delay: 0.4 }}
          style={{
            color: 'var(--color-text-secondary)',
            fontSize: 12,
            textAlign: 'center',
            marginTop: 12,
          }}
        >
          {sensorNote}
        </motion.p>
      )}
    </motion.div>
  );
}
