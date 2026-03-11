'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';

interface Insight {
  label: string;
  value: string;
  color: string;
}

interface EndScreenProps {
  gameId: string;
  title: string;
  emoji: string;
  score: string;
  personality: string;
  insights: Insight[];
  accentColor: string;
  onPlayAgain: () => void;
  didWin?: boolean;
}

export default function EndScreen({
  gameId,
  title,
  emoji,
  score,
  personality,
  insights,
  accentColor,
  onPlayAgain,
  didWin,
}: EndScreenProps) {
  const router = useRouter();
  const confettiDone = useRef(false);

  useEffect(() => {
    try {
      const scores = JSON.parse(localStorage.getItem('mg_scores') || '{}');
      scores[gameId] = { score, personality, timestamp: Date.now() };
      localStorage.setItem('mg_scores', JSON.stringify(scores));
      const played: string[] = JSON.parse(localStorage.getItem('mg_played') || '[]');
      if (!played.includes(gameId)) {
        played.push(gameId);
        localStorage.setItem('mg_played', JSON.stringify(played));
      }
    } catch { /* ignore */ }
  }, [gameId, score, personality]);

  useEffect(() => {
    if (didWin && !confettiDone.current) {
      confettiDone.current = true;
      import('canvas-confetti').then(({ default: confetti }) => {
        confetti({ particleCount: 140, spread: 80, origin: { y: 0.35 } });
      });
    }
  }, [didWin]);

  return (
    <motion.div
      data-testid="end-screen"
      initial={{ y: 64, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: 'var(--color-bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '80px 20px 32px',
        overflowY: 'auto',
        zIndex: 90,
      }}
    >
      {/* Big emoji */}
      <motion.div
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 340, damping: 18, delay: 0.12 }}
        style={{ fontSize: 72, marginBottom: 16, lineHeight: 1 }}
      >
        {emoji}
      </motion.div>

      {/* Personality / title */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.22 }}
        style={{ color: '#fff', fontSize: 26, fontWeight: 800, textAlign: 'center', marginBottom: 8 }}
      >
        {title}
      </motion.div>

      {/* Score */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 22, delay: 0.3 }}
        style={{
          color: accentColor,
          fontSize: 52,
          fontWeight: 900,
          letterSpacing: '-1.5px',
          marginBottom: 24,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {score}
      </motion.div>

      {/* Insights */}
      {insights.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38 }}
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-card)',
            padding: '4px 20px',
            width: '100%',
            maxWidth: 360,
            marginBottom: 20,
          }}
        >
          {insights.map((ins, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '11px 0',
                borderBottom: i < insights.length - 1 ? '1px solid var(--color-border)' : 'none',
              }}
            >
              <span style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>{ins.label}</span>
              <span style={{ color: ins.color, fontWeight: 700, fontSize: 14 }}>{ins.value}</span>
            </div>
          ))}
        </motion.div>
      )}

      {/* Buttons */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.44 }}
        style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 360 }}
      >
        <button
          onClick={onPlayAgain}
          style={{
            backgroundColor: accentColor,
            color: '#000',
            border: 'none',
            borderRadius: 12,
            height: 52,
            fontSize: 16,
            fontWeight: 800,
            cursor: 'pointer',
            width: '100%',
          }}
        >
          Play Again
        </button>
        <button
          onClick={() => router.push('/')}
          style={{
            backgroundColor: 'transparent',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            height: 52,
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
            width: '100%',
          }}
        >
          ← All Games
        </button>
      </motion.div>

      <p
        style={{
          color: 'var(--color-text-secondary)',
          fontSize: 11,
          textAlign: 'center',
          marginTop: 20,
          opacity: 0.35,
        }}
      >
        ⚡ Powered by Ether
      </p>
    </motion.div>
  );
}
