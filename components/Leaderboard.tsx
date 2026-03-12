'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { LeaderboardEntry } from '@/lib/leaderboard';

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  gameTitle: string;
  accentColor: string;
  brandName?: string;
  onClose: () => void;
  onPlayAgain: () => void;
}

const RANK_COLORS: Record<number, string> = {
  1: '#ffd700',
  2: '#c0c0c0',
  3: '#cd7f32',
};

const RANK_ICONS: Record<number, string> = {
  1: '👑',
  2: '🥈',
  3: '🥉',
};

export default function Leaderboard({
  entries,
  gameTitle,
  accentColor,
  brandName = 'Ether',
  onClose,
  onPlayAgain,
}: LeaderboardProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentPlayerEntry = entries.find(e => e.isCurrentPlayer);

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 40 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(ellipse 80% 50% at 50% 0%, ${accentColor}14 0%, #08090f 55%)`,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        zIndex: 95,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '24px 20px 16px',
          textAlign: 'center',
          flexShrink: 0,
        }}
      >
        <motion.div
          initial={{ scale: 0, rotate: -15 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 18, delay: 0.05 }}
          style={{ fontSize: 40, lineHeight: 1, marginBottom: 10 }}
        >
          🏆
        </motion.div>
        <h2
          style={{
            color: 'var(--color-text)',
            fontSize: 22,
            fontWeight: 800,
            margin: '0 0 4px',
            letterSpacing: '-0.4px',
          }}
        >
          {gameTitle} — Top Players
        </h2>
        <p
          style={{
            color: 'var(--color-text-secondary)',
            fontSize: 13,
            margin: 0,
          }}
        >
          {brandName} · All time
        </p>

        {/* Current player's rank badge */}
        {currentPlayerEntry && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4, type: 'spring', stiffness: 400 }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 12,
              backgroundColor: `${accentColor}18`,
              border: `1px solid ${accentColor}55`,
              borderRadius: 20,
              padding: '6px 14px',
            }}
          >
            <span style={{ fontSize: 16 }}>{currentPlayerEntry.avatar}</span>
            <span style={{ color: accentColor, fontSize: 13, fontWeight: 700 }}>
              You ranked #{currentPlayerEntry.rank}
            </span>
          </motion.div>
        )}
      </div>

      {/* Leaderboard list */}
      <div
        style={{
          flex: 1,
          padding: '0 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {mounted && entries.map((entry, i) => {
          const rankColor = RANK_COLORS[entry.rank] ?? 'var(--color-text-secondary)';
          const isTop3 = entry.rank <= 3;
          const isYou = !!entry.isCurrentPlayer;

          return (
            <motion.div
              key={entry.playerId}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + i * 0.03, duration: 0.3 }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                borderRadius: 12,
                backgroundColor: isYou
                  ? `${accentColor}15`
                  : isTop3
                  ? 'rgba(255,255,255,0.04)'
                  : 'var(--color-surface)',
                border: isYou
                  ? `1px solid ${accentColor}44`
                  : isTop3
                  ? `1px solid ${rankColor}33`
                  : '1px solid var(--color-border)',
                boxShadow: isTop3
                  ? `0 0 16px ${rankColor}12`
                  : 'none',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {/* Top 3 shimmer */}
              {isTop3 && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: `linear-gradient(90deg, transparent 0%, ${rankColor}07 50%, transparent 100%)`,
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 3s linear infinite',
                    pointerEvents: 'none',
                  }}
                />
              )}

              {/* Rank */}
              <div
                style={{
                  width: 28,
                  textAlign: 'center',
                  flexShrink: 0,
                }}
              >
                {isTop3 ? (
                  <span style={{ fontSize: 18 }}>{RANK_ICONS[entry.rank]}</span>
                ) : (
                  <span
                    style={{
                      color: rankColor,
                      fontSize: isTop3 ? 18 : 13,
                      fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    #{entry.rank}
                  </span>
                )}
              </div>

              {/* Avatar */}
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: isTop3
                    ? `radial-gradient(circle, ${rankColor}33 0%, transparent 70%)`
                    : 'rgba(255,255,255,0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  flexShrink: 0,
                  border: isYou ? `2px solid ${accentColor}66` : 'none',
                }}
              >
                {entry.avatar}
              </div>

              {/* Name + personality */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      color: isYou ? accentColor : 'var(--color-text)',
                      fontSize: 15,
                      fontWeight: isYou ? 800 : 600,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {entry.name}
                  </span>
                  {isYou && (
                    <span
                      style={{
                        backgroundColor: accentColor,
                        color: '#000',
                        fontSize: 9,
                        fontWeight: 900,
                        padding: '2px 6px',
                        borderRadius: 4,
                        letterSpacing: '0.08em',
                        flexShrink: 0,
                      }}
                    >
                      YOU
                    </span>
                  )}
                </div>
                <div
                  style={{
                    color: 'var(--color-text-secondary)',
                    fontSize: 11,
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {entry.personality}
                </div>
              </div>

              {/* Score */}
              <div
                style={{
                  textAlign: 'right',
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    color: isTop3 ? rankColor : isYou ? accentColor : 'var(--color-text)',
                    fontSize: 17,
                    fontWeight: 800,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {entry.score}
                </span>
                <div
                  style={{
                    color: 'var(--color-text-secondary)',
                    fontSize: 10,
                    marginTop: 1,
                  }}
                >
                  pts
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Bottom buttons */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        style={{
          padding: '20px 16px 32px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          flexShrink: 0,
        }}
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
    </motion.div>
  );
}
