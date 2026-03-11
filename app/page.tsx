'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const SKILL_GAMES = [
  {
    id: 'tilt-maze',
    emoji: '🌀',
    title: 'Tilt Maze',
    tagline: 'Roll the ball with your body',
    href: '/games/tilt-maze',
    accentColor: '#a855f7',
    duration: '60s',
  },
  {
    id: 'whisper-bomb',
    emoji: '💣',
    title: 'Whisper Bomb',
    tagline: 'Stay silent. Defuse the bomb.',
    href: '/games/whisper-bomb',
    accentColor: '#ef4444',
    duration: '30s',
  },
  {
    id: 'breath-rider',
    emoji: '🌬️',
    title: 'Breath Rider',
    tagline: 'Fly with your breath',
    href: '/games/breath-rider',
    accentColor: '#3b82f6',
    duration: '45s',
  },
  {
    id: 'steady-hand',
    emoji: '🎯',
    title: 'Steady Hand',
    tagline: 'How steady are you really?',
    href: '/games/steady-hand',
    accentColor: '#eab308',
    duration: '60s',
  },
  {
    id: 'tunnel',
    emoji: '🚀',
    title: 'Infinite Tunnel',
    tagline: "Dodge the rings. Don't crash.",
    href: '/games/tunnel',
    accentColor: '#00ffff',
    duration: '60s',
  },
  {
    id: 'pulse-sphere',
    emoji: '🔮',
    title: 'Pulse Sphere',
    tagline: 'Touch. Move. Breathe. Watch it respond.',
    href: '/games/pulse-sphere',
    accentColor: '#a855f7',
    duration: '60s',
  },
];

const SPORTS_GAMES = [
  {
    id: 'hoop-shot',
    emoji: '🏀',
    title: 'Hoop Shot',
    tagline: 'Swipe to score. 60 seconds on the clock.',
    href: '/games/hoop-shot',
    accentColor: '#f97316',
    duration: '60s',
  },
  {
    id: 'penalty-kick',
    emoji: '⚽',
    title: 'Penalty Kick',
    tagline: 'Beat the keeper. Aim for the corners.',
    href: '/games/penalty-kick',
    accentColor: '#22c55e',
    duration: '60s',
  },
  {
    id: 'spiral-throw',
    emoji: '🏈',
    title: 'Spiral Throw',
    tagline: "Lead your receiver. Don't throw behind.",
    href: '/games/spiral-throw',
    accentColor: '#f59e0b',
    duration: '60s',
  },
  {
    id: 'reflex-rally',
    emoji: '🎾',
    title: 'Reflex Rally',
    tagline: "Return every shot. Don't miss.",
    href: '/games/reflex-rally',
    accentColor: '#84cc16',
    duration: '60s',
  },
  {
    id: 'precision-putt',
    emoji: '🏌️',
    title: 'Precision Putt',
    tagline: 'Read the green. Control the power.',
    href: '/games/precision-putt',
    accentColor: '#86efac',
    duration: '60s',
  },
];

const ALL_GAMES = [...SKILL_GAMES, ...SPORTS_GAMES];

function GameCard({ game, played, score }: { game: typeof ALL_GAMES[0]; played: boolean; score?: string }) {
  return (
    <Link href={game.href} style={{ textDecoration: 'none' }}>
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          border: played
            ? `1px solid var(--color-border)`
            : '1px solid var(--color-border)',
          borderLeft: played ? `3px solid ${game.accentColor}` : '1px solid var(--color-border)',
          borderRadius: 'var(--radius-card)',
          height: 88,
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          cursor: 'pointer',
          boxShadow: played ? `0 0 16px ${game.accentColor}14` : 'none',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface-raised)')}
        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface)')}
      >
        {/* Emoji circle */}
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            backgroundColor: `${game.accentColor}22`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 26,
            flexShrink: 0,
          }}
        >
          {game.emoji}
        </div>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'var(--color-text)', fontWeight: 700, fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{game.title}</div>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: 13, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{game.tagline}</div>
        </div>

        {/* Right */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          {played && score ? (
            <div style={{
              backgroundColor: `${game.accentColor}22`,
              color: game.accentColor,
              fontSize: 11,
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: 8,
              whiteSpace: 'nowrap',
            }}>
              {score}
            </div>
          ) : (
            <div style={{
              backgroundColor: 'var(--color-surface-raised)',
              color: 'var(--color-text-secondary)',
              fontSize: 11,
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: 8,
            }}>
              {game.duration}
            </div>
          )}
          {played ? (
            <span style={{ color: game.accentColor, fontSize: 16, lineHeight: 1 }}>✓</span>
          ) : (
            <span style={{ color: 'var(--color-text-secondary)', fontSize: 16, lineHeight: 1 }}>›</span>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function Home() {
  const router = useRouter();
  const [userName, setUserName] = useState<string | null>(null);
  const [playedCount, setPlayedCount] = useState(0);
  const [scores, setScores] = useState<Record<string, { score: string }>>({});
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const userRaw = localStorage.getItem('mg_user');
      if (!userRaw) {
        router.replace('/onboarding');
        return;
      }
      const user = JSON.parse(userRaw);
      setUserName(user.name || 'Friend');
      const played: string[] = JSON.parse(localStorage.getItem('mg_played') || '[]');
      setPlayedCount(played.length);
      const sc = JSON.parse(localStorage.getItem('mg_scores') || '{}');
      setScores(sc);
    } catch {
      router.replace('/onboarding');
    }
    setTimeout(() => setVisible(true), 30);
  }, [router]);

  return (
    <main
      style={{
        background: 'var(--color-bg)',
        minHeight: '100vh',
        padding: '48px 16px 40px',
        transition: 'opacity 0.3s',
        opacity: visible ? 1 : 0,
      }}
    >
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        {/* Wordmark */}
        <div style={{ marginBottom: 24 }}>
          <span style={{ color: 'var(--color-text-secondary)', fontSize: 13, fontWeight: 600, letterSpacing: '0.04em' }}>
            ⚡ Ether
          </span>
        </div>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ color: 'var(--color-text)', fontSize: 32, fontWeight: 800, margin: '0 0 8px', letterSpacing: '-0.5px', lineHeight: 1.15 }}>
            What kind of player{'\u00a0'}are you?
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 16, margin: '0 0 20px', lineHeight: 1.5 }}>
            11 micro-games. 60 seconds each. Real behavioral insights.
          </p>

          {/* Progress pill */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-pill)',
            padding: '6px 14px',
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--color-accent)' }} />
            <span style={{ color: 'var(--color-text)', fontSize: 13, fontWeight: 700 }}>
              {playedCount} of {ALL_GAMES.length} played
            </span>
          </div>
        </div>

        {/* Skill Games section */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
            🎮 Skill Games
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {SKILL_GAMES.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                played={!!scores[game.id]}
                score={scores[game.id]?.score}
              />
            ))}
          </div>
        </div>

        {/* Sports Games section */}
        <div style={{ marginTop: 24, marginBottom: 8 }}>
          <div style={{ color: 'var(--color-text-secondary)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
            ⚽ Sports Games
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {SPORTS_GAMES.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                played={!!scores[game.id]}
                score={scores[game.id]?.score}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 11, textAlign: 'center', marginTop: 32, opacity: 0.5 }}>
          All games use mic, motion sensors, or camera for deeper insights.
        </p>
      </div>

      <style>{`
        @keyframes cardIn {
          0%   { transform: translateY(20px); opacity: 0; }
          100% { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </main>
  );
}
