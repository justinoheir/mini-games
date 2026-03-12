'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import CrossGameProfile from '@/components/CrossGameProfile';
import { getOverallTopPlayers, LeaderboardEntry } from '@/lib/leaderboard';

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

function GameCard({
  game,
  played,
  personality,
}: {
  game: typeof ALL_GAMES[0];
  played: boolean;
  personality?: string;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <Link href={game.href} style={{ textDecoration: 'none' }} data-testid="game-card">
      <div
        style={{
          backgroundColor: hovered ? 'var(--color-surface-raised)' : 'var(--color-surface)',
          border: played
            ? `1px solid ${game.accentColor}44`
            : '1px solid var(--color-border)',
          borderLeft: played
            ? `3px solid ${game.accentColor}`
            : hovered
            ? '1px solid var(--color-border-strong)'
            : '1px solid var(--color-border)',
          borderRadius: 'var(--radius-card)',
          height: 96,
          padding: '0 16px 0 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          cursor: 'pointer',
          boxShadow: played ? `0 0 20px ${game.accentColor}12` : 'none',
          transition: 'background 0.15s, transform 0.15s, box-shadow 0.15s',
          transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
          position: 'relative',
          overflow: 'hidden',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Shimmer overlay for played cards */}
        {played && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(90deg, transparent 0%, ${game.accentColor}08 50%, transparent 100%)`,
              backgroundSize: '200% 100%',
              animation: 'shimmer 3s linear infinite',
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Emoji circle */}
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: `radial-gradient(circle at 40% 40%, ${game.accentColor}33 0%, transparent 70%)`,
            boxShadow: `0 0 12px ${game.accentColor}22`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 28,
            flexShrink: 0,
          }}
        >
          {game.emoji}
        </div>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              color: 'var(--color-text)',
              fontWeight: 700,
              fontSize: 17,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              letterSpacing: '-0.2px',
            }}
          >
            {game.title}
          </div>
          <div
            style={{
              color: 'var(--color-text-secondary)',
              fontSize: 13,
              marginTop: 3,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {game.tagline}
          </div>
        </div>

        {/* Right badge + arrow */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 5,
            flexShrink: 0,
          }}
        >
          {played && personality ? (
            <div
              style={{
                backgroundColor: `${game.accentColor}22`,
                color: game.accentColor,
                fontSize: 11,
                fontWeight: 700,
                padding: '4px 10px',
                borderRadius: 8,
                whiteSpace: 'nowrap',
                border: `1px solid ${game.accentColor}44`,
                boxShadow: `0 0 8px ${game.accentColor}22`,
              }}
            >
              {personality}
            </div>
          ) : !played ? (
            <div
              style={{
                backgroundColor: 'transparent',
                color: 'var(--color-text-secondary)',
                fontSize: 11,
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: 8,
                border: '1px solid var(--color-border)',
              }}
            >
              {game.duration}
            </div>
          ) : null}
          <span
            style={{
              color: played ? game.accentColor : 'var(--color-text-secondary)',
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            {played ? '✓' : '›'}
          </span>
        </div>
      </div>
    </Link>
  );
}

function SectionHeader({ icon, label }: { icon: string; label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 12,
      }}
    >
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span
        style={{
          color: 'var(--color-text)',
          fontSize: 12,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: 1,
          background: 'var(--color-border-strong)',
          marginLeft: 4,
        }}
      />
    </div>
  );
}

const PODIUM_MEDALS = ['🥇', '🥈', '🥉'];

function ChampionsTeaser() {
  const [topPlayers, setTopPlayers] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    setTopPlayers(getOverallTopPlayers());
  }, []);

  if (topPlayers.length === 0) return null;

  return (
    <div
      style={{
        marginTop: 28,
        backgroundColor: 'var(--color-surface)',
        border: '1px solid rgba(0,255,136,0.18)',
        borderRadius: 16,
        padding: '16px 16px 14px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle glow */}
      <div
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          height: 2,
          background: 'linear-gradient(90deg, transparent, rgba(0,255,136,0.5), transparent)',
        }}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 14 }}>🏆</span>
        <span
          style={{
            color: 'var(--color-text)',
            fontSize: 12,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
          }}
        >
          This Week&apos;s Champions
        </span>
        <span
          style={{
            color: 'var(--color-text-secondary)',
            fontSize: 11,
            marginLeft: 'auto',
          }}
        >
          All games
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {topPlayers.map((player, i) => (
          <div
            key={player.playerId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>
              {PODIUM_MEDALS[i]}
            </span>
            <span style={{ fontSize: 20, width: 28, textAlign: 'center' }}>
              {player.avatar}
            </span>
            <span
              style={{
                color: 'var(--color-text)',
                fontSize: 14,
                fontWeight: 600,
                flex: 1,
              }}
            >
              {player.name}
            </span>
            <span
              style={{
                color: i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : '#cd7f32',
                fontSize: 14,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {player.score.toLocaleString()} pts
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [playedCount, setPlayedCount] = useState(0);
  const [scores, setScores] = useState<Record<string, { score: string; personality?: string }>>({});
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const userRaw = localStorage.getItem('mg_user');
      if (!userRaw) {
        router.replace('/onboarding');
        return;
      }
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
        padding: '48px 16px 56px',
        transition: 'opacity 0.3s',
        opacity: visible ? 1 : 0,
        position: 'relative',
      }}
    >
      {/* Atmospheric radial gradient */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 600,
          height: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,255,136,0.05) 0%, transparent 70%)',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      <div style={{ maxWidth: 480, margin: '0 auto', position: 'relative', zIndex: 1 }}>
        {/* Wordmark */}
        <div style={{ marginBottom: 20 }}>
          <span
            style={{
              color: 'var(--color-accent)',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
            }}
          >
            ⚡ ETHER
          </span>
        </div>

        {/* Hero */}
        <div style={{ marginBottom: 32 }}>
          <h1
            style={{
              color: 'var(--color-text)',
              fontSize: 36,
              fontWeight: 700,
              margin: '0 0 8px',
              letterSpacing: '-0.5px',
              lineHeight: 1.1,
            }}
          >
            Play. Reveal yourself.
          </h1>
          <p
            style={{
              color: 'var(--color-text-secondary)',
              fontSize: 15,
              margin: '0 0 20px',
              lineHeight: 1.5,
            }}
          >
            11 games. 60 seconds each. Real signals.
          </p>

          {/* Progress pill */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-pill)',
              padding: '6px 14px',
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: 'var(--color-accent)',
                animation: 'dot-pulse 1.8s ease-in-out infinite',
              }}
            />
            <span style={{ color: 'var(--color-text)', fontSize: 13, fontWeight: 700 }}>
              {playedCount} of {ALL_GAMES.length} played
            </span>
          </div>
        </div>

        {/* Skill Games section */}
        <div style={{ marginBottom: 8 }}>
          <SectionHeader icon="🎮" label="Skill Games" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {SKILL_GAMES.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                played={!!scores[game.id]}
                personality={scores[game.id]?.personality}
              />
            ))}
          </div>
        </div>

        {/* Sports Games section */}
        <div style={{ marginTop: 28, marginBottom: 8 }}>
          <SectionHeader icon="⚽" label="Sports Games" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {SPORTS_GAMES.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                played={!!scores[game.id]}
                personality={scores[game.id]?.personality}
              />
            ))}
          </div>
        </div>

        {/* Champions teaser leaderboard */}
        <ChampionsTeaser />

        {/* Cross-game behavioral profile — shown after 3+ games */}
        {playedCount >= 3 && (
          <div style={{ marginTop: 28 }}>
            <CrossGameProfile scores={scores} />
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            marginTop: 40,
            paddingTop: 20,
            borderTop: '1px solid var(--color-border)',
            textAlign: 'center',
          }}
        >
          <span
            style={{
              color: 'var(--color-text-secondary)',
              fontSize: 12,
              fontWeight: 500,
              opacity: 0.6,
            }}
          >
            ⚡ Powered by Ether
          </span>
        </div>
      </div>
    </main>
  );
}
