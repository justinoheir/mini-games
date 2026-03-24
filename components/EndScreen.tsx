'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trophy } from 'lucide-react';
import { motion } from 'framer-motion';
import Leaderboard from '@/components/Leaderboard';
import { getMockLeaderboard, LeaderboardEntry } from '@/lib/leaderboard';
import { recordGamePlayed } from '@/lib/gameStorage';

interface Insight {
  label: string;
  value: string;
  color: string;
}

/** Human-readable game titles keyed by gameId */
const GAME_TITLES: Record<string, string> = {
  'tilt-maze': 'Tilt Maze',
  'whisper-bomb': 'Whisper Bomb',
  'breath-rider': 'Breath Rider',
  'steady-hand': 'Steady Hand',
  'tunnel': 'Infinite Tunnel',
  'pulse-sphere': 'Pulse Sphere',
  'hoop-shot': 'Hoop Shot',
  'penalty-kick': 'Penalty Kick',
  'spiral-throw': 'Spiral Throw',
  'reflex-rally': 'Reflex Rally',
  'precision-putt': 'Precision Putt',
  'color-cascade': 'Color Cascade',
  'memory-grid': 'Memory Grid',
  'reaction-chain': 'Reaction Chain',
  'shadow-tap': 'Shadow Tap',
  'stack-drop': 'Stack Drop',
  'dodge-blitz': 'Dodge Blitz',
  'orbit-control': 'Orbit Control',
  'symbol-scan': 'Symbol Scan',
  'path-trace': 'Path Trace',
  'crowd-roar': 'Crowd Roar',
  'balance-beam': 'Balance Beam',
  'pitch-match': 'Pitch Match',
  // Holiday games
  'gift-rush': 'Gift Rush',
  'snow-catch': 'Snow Catch',
  'boo-blast': 'Boo Blast',
  'cauldron-bubble': 'Cauldron Bubble',
  'firework-launch': 'Firework Launch',
  'countdown-crush': 'Countdown Crush',
  'cupid-shot': 'Cupid Shot',
  'love-note': 'Love Note',
  'turkey-trot': 'Turkey Trot',
  'harvest-catch': 'Harvest Catch',
};

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
  brandId?: string;
  /** Text color for the Play Again CTA. Default '#000' (high contrast on bright accents). */
  ctaTextColor?: string;
  /** Optional content rendered between insight chips and buttons (e.g. RadarChart) */
  children?: React.ReactNode;
  /** Raw numeric score for persistent storage (separate from the formatted score string) */
  finalScore?: number;
  /** Game duration in ms for persistent storage */
  gameDurationMs?: number;
}

/** Parse a numeric value from score strings like "42 pts", "3.2s", "7", "87%" */
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
  brandId = 'ether',
  ctaTextColor = '#000',
  children,
  finalScore,
  gameDurationMs,
}: EndScreenProps) {
  const router = useRouter();
  const confettiDone = useRef(false);
  const [displayScore, setDisplayScore] = useState('0');
  const [isNewBest, setIsNewBest] = useState(false);
  const [copyConfirm, setCopyConfirm] = useState(false);
  const [leaderboardVisible, setLeaderboardVisible] = useState(false);
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);

  // Persist game record on mount
  useEffect(() => {
    if (gameId && finalScore !== undefined) {
      recordGamePlayed(gameId, finalScore, gameDurationMs ?? 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Personal best check + localStorage save
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('mg_scores') || '{}');
      const prevEntry = stored[gameId];
      const newNum = parseScoreNum(score);
      const prevNum = prevEntry ? parseScoreNum(prevEntry.score) : -Infinity;
      if ((newNum > prevNum || !prevEntry) && newNum > 0) {
        setIsNewBest(true);
      }
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
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = eased * target;
      setDisplayScore((isFloat ? current.toFixed(1) : Math.round(current).toString()) + suffix);
      if (progress < 1) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
  }, [score]);

  // Confetti — rendered on a dedicated canvas at z-index:10 (BEHIND the result content at z-index:90)
  // IMPORTANT: never use the default confetti() call — it renders at z-index:2147483647 and covers text
  useEffect(() => {
    if (confettiDone.current) return;
    confettiDone.current = true;
    import('canvas-confetti').then(({ default: confetti }) => {
      const canvas = document.createElement('canvas');
      canvas.style.cssText =
        'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:10;';
      document.body.appendChild(canvas);
      const myConfetti = confetti.create(canvas, { resize: true, useWorker: false });
      myConfetti({
        particleCount: didWin ? 160 : 60,
        spread: didWin ? 90 : 60,
        origin: { y: 0.25 },
      });
      // Remove canvas after animation completes
      setTimeout(() => canvas.remove(), 4000);
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

  const handleShowLeaderboard = () => {
    try {
      const userRaw = localStorage.getItem('mg_user');
      const user = userRaw ? JSON.parse(userRaw) : null;
      const numericScore = parseScoreNum(score);
      const entries = getMockLeaderboard(
        gameId,
        user ? { name: user.name, lastName: user.lastName ?? '', avatar: user.avatar ?? '⚡' } : null,
        numericScore,
        personality,
        brandId,
      );
      setLeaderboardEntries(entries);
    } catch {
      setLeaderboardEntries(getMockLeaderboard(gameId, null, parseScoreNum(score), personality, brandId));
    }
    setLeaderboardVisible(true);
  };

  // Show leaderboard overlay
  if (leaderboardVisible) {
    return (
      <Leaderboard
        entries={leaderboardEntries}
        gameTitle={GAME_TITLES[gameId] ?? title}
        accentColor={accentColor}
        brandName="Ether"
        onClose={() => setLeaderboardVisible(false)}
        onPlayAgain={() => {
          setLeaderboardVisible(false);
          onPlayAgain();
        }}
      />
    );
  }

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
        background: `radial-gradient(ellipse 100% 70% at 50% -10%, ${accentColor}28 0%, ${accentColor}08 40%, #060810 100%)`,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 90,
      }}
    >
      {/* Scrollable content area */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '72px 20px 16px',
      }}>
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
              <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 16, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{ins.label}</span>
              <span style={{ color: ins.color, fontWeight: 700, fontSize: 16 }}>{ins.value}</span>
            </div>
          ))}
        </motion.div>
      )}

      {/* Optional game-specific visual content (e.g. RadarChart) */}
      {children && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.42 }}
          style={{ width: '100%', maxWidth: 360, display: 'flex', justifyContent: 'center', marginBottom: 8 }}
        >
          {children}
        </motion.div>
      )}

      {/* Secondary buttons: share, leaderboard, all games */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.44 }}
        style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 360 }}
      >
        {/* Share button */}
        <button
          onClick={handleShare}
          style={{
            backgroundColor: 'transparent',
            color: accentColor,
            border: `1px solid ${accentColor}66`,
            borderRadius: 12,
            height: 48,
            fontSize: 17,
            fontWeight: 700,
            cursor: 'pointer',
            width: '100%',
            letterSpacing: '-0.2px',
          }}
        >
          {copyConfirm ? '✓ Copied!' : '↗ Share Result'}
        </button>

        {/* Leaderboard button */}
        <button
          onClick={handleShowLeaderboard}
          style={{
            backgroundColor: `${accentColor}18`,
            color: accentColor,
            border: `1px solid ${accentColor}44`,
            borderRadius: 12,
            height: 48,
            fontSize: 17,
            fontWeight: 700,
            cursor: 'pointer',
            width: '100%',
            letterSpacing: '-0.2px',
          }}
        >
          <Trophy size={17} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />See Leaderboard →
        </button>

        <button
          onClick={() => router.push('/')}
          style={{
            backgroundColor: 'transparent',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            height: 48,
            fontSize: 17,
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
          textAlign: 'center',
          marginTop: 16,
          marginBottom: 8,
          opacity: 0.35,
        }}
      >
        <img src="/brand/ether-wordmark-transparent-light.png" alt="Ether" style={{ height: 16, display: 'inline-block', verticalAlign: 'middle' }} />
      </p>
      </div>{/* end scrollable content */}

      {/* Sticky Play Again — always visible at bottom, never requires scrolling */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.44, type: 'spring', stiffness: 300, damping: 28 }}
        style={{
          flexShrink: 0,
          padding: '12px 20px 20px',
          background: `linear-gradient(transparent, ${accentColor}12 0%, #08090f 40%)`,
          backgroundColor: '#08090f',
        }}
      >
        <motion.button
          onClick={onPlayAgain}
          whileTap={{ scale: 0.93 }}
          whileHover={{ scale: 1.03 }}
          transition={{ type: 'spring', stiffness: 500, damping: 22 }}
          style={{
            backgroundColor: accentColor,
            color: ctaTextColor,
            border: 'none',
            borderRadius: 12,
            height: 56,
            fontSize: 20,
            fontWeight: 800,
            cursor: 'pointer',
            width: '100%',
            maxWidth: 360,
            display: 'block',
            margin: '0 auto',
            letterSpacing: '-0.2px',
            boxShadow: `0 4px 28px ${accentColor}55`,
          }}
        >
          Play Again ↺
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
