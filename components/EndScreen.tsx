'use client';
import { useEffect, useRef, useState } from 'react';
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

/** Parse a numeric value from score strings like "42 pts", "3.2s", "7" */
function parseScoreNum(s: string): number {
  const m = s.match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
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
  const [displayScore, setDisplayScore] = useState('0');
  const [isNewBest, setIsNewBest] = useState(false);
  const [copyConfirm, setCopyConfirm] = useState(false);

  // Personal best check + localStorage save
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('mg_scores') || '{}');
      const prevEntry = stored[gameId];
      const newNum = parseScoreNum(score);
      const prevNum = prevEntry ? parseScoreNum(prevEntry.score) : -Infinity;
      // Check if this is a new best (higher is better for most games)
      if (newNum > prevNum || !prevEntry) {
        setIsNewBest(true);
      }
      // Save after comparison
      stored[gameId] = { score, personality, timestamp: Date.now() };
      localStorage.setItem('mg_scores', JSON.stringify(stored));

      const played: string[] = JSON.parse(localStorage.getItem('mg_played') || '[]');
      if (!played.includes(gameId)) {
        played.push(gameId);
        localStorage.setItem('mg_played', JSON.stringify(played));
      }
    } catch { /* ignore */ }
  }, [gameId, score, personality]);

  // Score count-up animation
  useEffect(() => {
    const target = parseScoreNum(score);
    const suffix = score.replace(/[\d.]+/, '');
    if (target === 0 || isNaN(target)) {
      setDisplayScore(score);
      return;
    }
    const duration = 600;
    const start = performance.now();
    const isFloat = score.includes('.');
    const raf = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = eased * target;
      setDisplayScore((isFloat ? current.toFixed(1) : Math.round(current).toString()) + suffix);
      if (progress < 1) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
  }, [score]);

  // Confetti — always fires, more on win
  useEffect(() => {
    if (confettiDone.current) return;
    confettiDone.current = true;
    import('canvas-confetti').then(({ default: confetti }) => {
      confetti({
        particleCount: didWin ? 160 : 60,
        spread: didWin ? 90 : 60,
        origin: { y: 0.35 },
      });
    });
  }, [didWin]);

  const handleShare = async () => {
    const text = `I'm ${personality} 🎮 I scored ${score} in ${title} — what's your type?\nhttps://mini-games-green.vercel.app`;
    try {
      if (navigator.share) {
        await navigator.share({ text, title: 'Ether Mini Games' });
      } else {
        await navigator.clipboard.writeText(text);
        setCopyConfirm(true);
        setTimeout(() => setCopyConfirm(false), 2000);
      }
    } catch { /* user cancelled */ }
  };

  const useGrid = insights.length === 4;

  return (
    <motion.div
      data-testid="end-screen"
      initial={{ y: 64, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(ellipse 80% 60% at 50% 0%, ${accentColor}18 0%, #08090f 60%)`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '80px 20px 32px',
        overflowY: 'auto',
        zIndex: 90,
      }}
    >
      {/* Big emoji with bounce animation */}
      <motion.div
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 18, delay: 0.1 }}
        style={{ fontSize: 80, marginBottom: 16, lineHeight: 1 }}
      >
        {emoji}
      </motion.div>

      {/* Personality label */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.22 }}
        style={{
          color: '#fff',
          fontSize: 28,
          fontWeight: 700,
          textAlign: 'center',
          marginBottom: 8,
          letterSpacing: '-0.3px',
        }}
      >
        {title}
      </motion.div>

      {/* Score — HUGE */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 22, delay: 0.3 }}
        style={{
          color: accentColor,
          fontSize: 80,
          fontWeight: 900,
          letterSpacing: '-2px',
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          textShadow: `0 0 32px ${accentColor}55`,
        }}
      >
        {displayScore}
      </motion.div>

      {/* Personal best badge */}
      {isNewBest && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5, type: 'spring', stiffness: 400 }}
          style={{
            color: accentColor,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            marginTop: 8,
            marginBottom: 4,
            animation: 'sparkle 1.5s ease-in-out infinite',
          }}
        >
          ✦ New Personal Best
        </motion.div>
      )}

      {/* Insight chips */}
      {insights.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38 }}
          style={{
            display: useGrid ? 'grid' : 'flex',
            gridTemplateColumns: useGrid ? '1fr 1fr' : undefined,
            flexDirection: useGrid ? undefined : 'column',
            gap: 8,
            width: '100%',
            maxWidth: 360,
            marginTop: 20,
            marginBottom: 20,
          }}
        >
          {insights.map((ins, i) => (
            <div
              key={i}
              style={{
                background: `${ins.color}15`,
                borderLeft: `3px solid ${ins.color}`,
                borderRadius: 10,
                padding: '10px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
              }}
            >
              <span style={{ color: 'var(--color-text-secondary)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{ins.label}</span>
              <span style={{ color: ins.color, fontWeight: 700, fontSize: 15 }}>{ins.value}</span>
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
        {/* Share button */}
        <button
          onClick={handleShare}
          style={{
            backgroundColor: 'transparent',
            color: accentColor,
            border: `1px solid ${accentColor}66`,
            borderRadius: 12,
            height: 52,
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
            width: '100%',
            letterSpacing: '-0.2px',
          }}
        >
          {copyConfirm ? '✓ Copied!' : '↗ Share Result'}
        </button>

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
            letterSpacing: '-0.2px',
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
