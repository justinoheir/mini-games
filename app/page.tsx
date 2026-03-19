'use client';

import { useEffect, useState } from 'react';
import NextLink from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Compass,
  Bomb,
  Wind,
  Target,
  Zap,
  Activity,
  Moon,
  Palette,
  Grid3x3,
  Link as ChainLink,
  Layers,
  Timer,
  Circle,
  Navigation,
  Flag,
  RotateCw,
  Gift,
  Ghost,
  Sparkles,
  Heart,
  Feather,
  Snowflake,
  FlaskConical,
  Clock,
  Mail,
  Wheat,
  Radio,
  ChevronsLeftRight,
  Pen,
  Music,
} from 'lucide-react';
import type React from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type GameIcon = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

type GameCategory = 'skill' | 'sports' | 'holiday' | 'cognitive' | 'breath';

interface Game {
  id: string;
  title: string;
  tagline: string;
  href: string;
  accentColor: string;
  duration: string;
  Icon: GameIcon;
  category: GameCategory;
}

// ─── Game Data ────────────────────────────────────────────────────────────────

const SKILL_GAMES: Game[] = [
  { id: 'tilt-maze',       title: 'Tilt Maze',       tagline: 'Roll the ball with your body',              href: '/games/tilt-maze',       accentColor: '#a855f7', duration: '60s', Icon: Compass,          category: 'skill'     },
  { id: 'whisper-bomb',    title: 'Whisper Bomb',    tagline: 'Stay silent. Defuse the bomb.',              href: '/games/whisper-bomb',    accentColor: '#ef4444', duration: '30s', Icon: Bomb,             category: 'breath'    },
  { id: 'breath-rider',    title: 'Breath Rider',    tagline: 'Fly with your breath',                       href: '/games/breath-rider',    accentColor: '#3b82f6', duration: '45s', Icon: Wind,             category: 'breath'    },
  { id: 'steady-hand',     title: 'Steady Hand',     tagline: 'Hold perfectly still. We dare you.',        href: '/games/steady-hand',     accentColor: '#22c55e', duration: '30s', Icon: Target,           category: 'skill'     },
  { id: 'tunnel',          title: 'Infinite Tunnel', tagline: "Dodge the rings. Don't crash.",              href: '/games/tunnel',          accentColor: '#00ffff', duration: '60s', Icon: Zap,              category: 'skill'     },
  { id: 'pulse-sphere',    title: 'Pulse Sphere',    tagline: 'Touch. Move. Breathe. Watch it respond.',    href: '/games/pulse-sphere',    accentColor: '#a855f7', duration: '60s', Icon: Activity,         category: 'breath'    },
  { id: 'shadow-tap',      title: 'Shadow Tap',      tagline: "Tap what you see. Before it's gone.",        href: '/games/shadow-tap',      accentColor: '#64748b', duration: '45s', Icon: Moon,             category: 'cognitive' },
  { id: 'color-cascade',   title: 'Color Cascade',   tagline: 'Match the color. Match the speed.',          href: '/games/color-cascade',   accentColor: '#f43f5e', duration: '45s', Icon: Palette,          category: 'cognitive' },
  { id: 'memory-grid',     title: 'Memory Grid',     tagline: 'Remember the pattern. Repeat it.',           href: '/games/memory-grid',     accentColor: '#8b5cf6', duration: '60s', Icon: Grid3x3,          category: 'cognitive' },
  { id: 'reaction-chain',  title: 'Reaction Chain',  tagline: 'Tap fast. Keep the chain alive.',             href: '/games/reaction-chain',  accentColor: '#facc15', duration: '45s', Icon: ChainLink,        category: 'cognitive' },
  { id: 'stack-drop',      title: 'Stack Drop',      tagline: "Drop it. Stack it. Don't tip it.",            href: '/games/stack-drop',      accentColor: '#f97316', duration: '60s', Icon: Layers,           category: 'skill'     },
  { id: 'dodge-blitz',     title: 'Dodge Blitz',     tagline: "Tilt to survive. Don't stop moving.",        href: '/games/dodge-blitz',     accentColor: '#06b6d4', duration: '45s', Icon: ChevronsLeftRight, category: 'skill'    },
  { id: 'crowd-roar',      title: 'Crowd Roar',      tagline: "Roar loud. Hold it. Don't fade.",             href: '/games/crowd-roar',      accentColor: '#ef4444', duration: '45s', Icon: Radio,            category: 'breath'    },
  { id: 'balance-beam',    title: 'Balance Beam',    tagline: 'Keep the ball on the beam. Stay still.',      href: '/games/balance-beam',    accentColor: '#f59e0b', duration: '60s', Icon: Activity,         category: 'skill'     },
  { id: 'path-trace',      title: 'Path Trace',      tagline: "Follow the line. Don't stray.",               href: '/games/path-trace',      accentColor: '#e879f9', duration: '45s', Icon: Pen,              category: 'skill'     },
  { id: 'pitch-match',     title: 'Pitch Match',     tagline: 'Hit the note. Hold it. Feel it.',              href: '/games/pitch-match',     accentColor: '#34d399', duration: '45s', Icon: Music,            category: 'breath'    },
  { id: 'symbol-scan',     title: 'Symbol Scan',     tagline: 'Find it. Tap it. Before the clock runs out.', href: '/games/symbol-scan',     accentColor: '#10b981', duration: '60s', Icon: Grid3x3,          category: 'cognitive' },
];

const SPORTS_GAMES: Game[] = [
  { id: 'hoop-shot',      title: 'Hoop Shot',      tagline: 'Swipe to score. 60 seconds on the clock.',     href: '/games/hoop-shot',      accentColor: '#f97316', duration: '60s', Icon: Circle,     category: 'sports' },
  { id: 'penalty-kick',   title: 'Penalty Kick',   tagline: 'Beat the keeper. Aim for the corners.',         href: '/games/penalty-kick',   accentColor: '#22c55e', duration: '60s', Icon: Navigation, category: 'sports' },
  { id: 'spiral-throw',   title: 'Spiral Throw',   tagline: "Lead your receiver. Don't throw behind.",       href: '/games/spiral-throw',   accentColor: '#f59e0b', duration: '60s', Icon: RotateCw,   category: 'sports' },
  { id: 'reflex-rally',   title: 'Reflex Rally',   tagline: "Return every shot. Don't miss.",                href: '/games/reflex-rally',   accentColor: '#84cc16', duration: '60s', Icon: Timer,      category: 'sports' },
  { id: 'precision-putt', title: 'Precision Putt', tagline: 'Read the green. Control the power.',            href: '/games/precision-putt', accentColor: '#86efac', duration: '60s', Icon: Flag,       category: 'sports' },
];

const HOLIDAY_GAMES: Game[] = [
  { id: 'gift-rush',        title: 'Gift Rush',        tagline: "Swipe left or right. Fast. Santa's watching.", href: '/games/gift-rush',        accentColor: '#ef4444', duration: '45s', Icon: Gift,         category: 'holiday' },
  { id: 'snow-catch',       title: 'Snow Catch',       tagline: "Tilt to catch the snow. Miss one and it's over.", href: '/games/snow-catch',    accentColor: '#93c5fd', duration: '45s', Icon: Snowflake,    category: 'holiday' },
  { id: 'boo-blast',        title: 'Boo Blast',        tagline: "Tap the ghosts. They won't wait.",              href: '/games/boo-blast',        accentColor: '#a855f7', duration: '30s', Icon: Ghost,        category: 'holiday' },
  { id: 'cauldron-bubble',  title: 'Cauldron Bubble',  tagline: 'Blow to bubble. Too quiet = dead. Too loud = BOOM.', href: '/games/cauldron-bubble', accentColor: '#22c55e', duration: '45s', Icon: FlaskConical, category: 'holiday' },
  { id: 'firework-launch',  title: 'Firework Launch',  tagline: 'Swipe to launch. Tap to detonate. Make it count.', href: '/games/firework-launch', accentColor: '#f59e0b', duration: '45s', Icon: Sparkles,    category: 'holiday' },
  { id: 'countdown-crush',  title: 'Countdown Crush',  tagline: 'Score before midnight. Every second counts.',   href: '/games/countdown-crush',  accentColor: '#fbbf24', duration: '30s', Icon: Clock,        category: 'holiday' },
  { id: 'cupid-shot',       title: 'Cupid Shot',       tagline: 'Aim. Wait. Shoot at the perfect moment.',       href: '/games/cupid-shot',       accentColor: '#f43f5e', duration: '45s', Icon: Heart,        category: 'holiday' },
  { id: 'love-note',        title: 'Love Note',        tagline: 'Remember the sequence. Tap it back. From the heart.', href: '/games/love-note', accentColor: '#ec4899', duration: '60s', Icon: Mail,         category: 'holiday' },
  { id: 'turkey-trot',      title: 'Turkey Trot',      tagline: "The turkey's running. Prove you're faster.",    href: '/games/turkey-trot',      accentColor: '#f97316', duration: '30s', Icon: Feather,      category: 'holiday' },
  { id: 'harvest-catch',    title: 'Harvest Catch',    tagline: "Tilt to catch the harvest. Skip the Brussels sprouts.", href: '/games/harvest-catch', accentColor: '#d97706', duration: '45s', Icon: Wheat, category: 'holiday' },
];

const ALL_GAMES: Game[] = [...SKILL_GAMES, ...SPORTS_GAMES, ...HOLIDAY_GAMES];

// Hero rotation pool
const FEATURED_GAMES: Game[] = [
  SKILL_GAMES[0],   // tilt-maze
  SKILL_GAMES[1],   // whisper-bomb
  SKILL_GAMES[4],   // tunnel
  SKILL_GAMES[9],   // reaction-chain
  HOLIDAY_GAMES[2], // boo-blast
  HOLIDAY_GAMES[4], // firework-launch
];

// "New Arrivals"
const NEW_ARRIVAL_IDS = ['harvest-catch', 'love-note', 'countdown-crush', 'cauldron-bubble', 'snow-catch'];
const NEW_ARRIVALS: Game[] = NEW_ARRIVAL_IDS
  .map(id => ALL_GAMES.find(g => g.id === id))
  .filter((g): g is Game => g !== undefined);

// ─── Category badge config ────────────────────────────────────────────────────

const CATEGORY_META: Record<GameCategory, { label: string; color: string; bg: string }> = {
  skill:     { label: 'SKILL',     color: '#a855f7', bg: 'rgba(168,85,247,0.15)' },
  sports:    { label: 'SPORTS',    color: '#f97316', bg: 'rgba(249,115,22,0.15)' },
  holiday:   { label: 'HOLIDAY',   color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },
  cognitive: { label: 'BRAIN',     color: '#6366f1', bg: 'rgba(99,102,241,0.15)' },
  breath:    { label: 'BREATH',    color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
};

// ─── Game Card ────────────────────────────────────────────────────────────────

function GameCard({ game, rank }: { game: Game; rank?: number }) {
  const { Icon } = game;
  const cat = CATEGORY_META[game.category];

  return (
    <div
      className="game-card-netflix"
      data-testid="game-card"
      style={{ position: 'relative' }}
    >
      {/* Main game link */}
      <NextLink href={game.href} style={{ textDecoration: 'none', display: 'block', height: '100%' }}>
        <motion.div
          whileHover={{
            scale: 1.05,
            boxShadow: `0 0 0 2px ${game.accentColor}99, 0 8px 32px ${game.accentColor}44`,
          }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 400, damping: 22 }}
          style={{
            height: '100%',
            background: `linear-gradient(160deg, ${game.accentColor}cc 0%, ${game.accentColor}55 45%, #08090f 100%)`,
            borderRadius: 14,
            border: `1px solid ${game.accentColor}33`,
            display: 'flex',
            flexDirection: 'column',
            padding: '12px 12px 14px',
            cursor: 'pointer',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Shimmer highlight on top edge */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 1,
              background: `linear-gradient(to right, transparent, ${game.accentColor}66, transparent)`,
              pointerEvents: 'none',
            }}
          />

          {/* Top row: duration + category */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 4,
            }}
          >
            {/* Category badge */}
            <div
              style={{
                background: cat.bg,
                color: cat.color,
                fontSize: 9,
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
                fontWeight: 800,
                padding: '2px 7px',
                borderRadius: 999,
                letterSpacing: '0.1em',
                lineHeight: 1.6,
              }}
            >
              {cat.label}
            </div>

            {/* Duration badge */}
            <div
              style={{
                background: 'rgba(0,0,0,0.55)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                color: 'rgba(255,255,255,0.9)',
                fontSize: 11,
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 600,
                padding: '3px 8px',
                borderRadius: 999,
                letterSpacing: '0.02em',
                lineHeight: 1.6,
              }}
            >
              {game.duration}
            </div>
          </div>

          {/* Large decorative icon — centered */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0.25,
              paddingBottom: 4,
            }}
          >
            <Icon size={72} color="white" strokeWidth={1.5} />
          </div>

          {/* Bottom text */}
          <div style={{ flexShrink: 0, paddingBottom: rank !== undefined ? 0 : 4 }}>
            <div
              style={{
                color: '#ffffff',
                fontWeight: 700,
                fontSize: 14,
                lineHeight: 1.25,
                marginBottom: 4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
              }}
            >
              {game.title}
            </div>
            <div
              style={{
                color: 'rgba(255,255,255,0.55)',
                fontSize: 11,
                lineHeight: 1.4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {game.tagline}
            </div>
          </div>

          {/* Rank badge for "Most Played" */}
          {rank !== undefined && (
            <div
              style={{
                position: 'absolute',
                top: 8,
                left: 8,
                background: game.accentColor,
                color: '#000',
                fontSize: 10,
                fontWeight: 900,
                width: 20,
                height: 20,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
              }}
            >
              {rank}
            </div>
          )}
        </motion.div>
      </NextLink>

      {/* QA button — bottom corner */}
      <NextLink
        href={`/qa?game=${game.id}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          bottom: 10,
          right: 10,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.5px',
          padding: '2px 6px',
          borderRadius: 4,
          background: 'rgba(0,0,0,0.5)',
          color: 'rgba(255,255,255,0.25)',
          border: '1px solid rgba(255,255,255,0.08)',
          textDecoration: 'none',
          zIndex: 10,
          lineHeight: 1.6,
          display: 'block',
        }}
      >
        QA
      </NextLink>
    </div>
  );
}

// ─── Carousel Row ─────────────────────────────────────────────────────────────

function CarouselRow({
  title,
  emoji,
  games,
  showRanks = false,
}: {
  title: string;
  emoji?: string;
  games: Game[];
  showRanks?: boolean;
}) {
  if (games.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      style={{ marginBottom: 40 }}
    >
      {/* Row header */}
      <div
        style={{
          padding: '0 20px',
          marginBottom: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {emoji && (
          <span style={{ fontSize: 16, lineHeight: 1 }}>{emoji}</span>
        )}
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.65)',
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
          }}
        >
          {title}
        </span>
        <div
          style={{
            flex: 1,
            height: 1,
            background: 'linear-gradient(to right, rgba(255,255,255,0.07), transparent)',
            marginLeft: 8,
          }}
        />
        <span
          style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.3)',
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            fontWeight: 600,
          }}
        >
          {games.length} games
        </span>
      </div>

      {/* Scrollable cards */}
      <div className="carousel-row" style={{ paddingLeft: 20, paddingRight: 20 }}>
        {games.map((game, i) => (
          <GameCard key={game.id} game={game} rank={showRanks ? i + 1 : undefined} />
        ))}
      </div>
    </motion.div>
  );
}

// ─── Ether Stripe Divider ─────────────────────────────────────────────────────

function EtherStripe({ opacity = 0.35, margin = '0' }: { opacity?: number; margin?: string }) {
  return (
    <div
      style={{
        height: 2,
        margin,
        background:
          'repeating-linear-gradient(to right, #5b9fc0 0px, #5b9fc0 80px, transparent 80px, transparent 100px)',
        opacity,
      }}
    />
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ playCounts }: { playCounts: Record<string, number> }) {
  const totalPlays = Object.values(playCounts).reduce((s, n) => s + n, 0);
  const gamesPlayed = Object.keys(playCounts).filter((k) => playCounts[k] > 0).length;

  if (totalPlays === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.3 }}
      style={{
        margin: '0 20px 24px',
        padding: '10px 16px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 12,
        display: 'flex',
        gap: 24,
        alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span
          style={{
            fontSize: 20,
            fontWeight: 900,
            color: '#00ff88',
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            letterSpacing: '-0.5px',
            lineHeight: 1,
          }}
        >
          {totalPlays}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: 'rgba(255,255,255,0.4)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
          }}
        >
          Total Plays
        </span>
      </div>
      <div
        style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.08)' }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span
          style={{
            fontSize: 20,
            fontWeight: 900,
            color: '#a855f7',
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            letterSpacing: '-0.5px',
            lineHeight: 1,
          }}
        >
          {gamesPlayed}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: 'rgba(255,255,255,0.4)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
          }}
        >
          Games Tried
        </span>
      </div>
      <div
        style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.08)' }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span
          style={{
            fontSize: 20,
            fontWeight: 900,
            color: '#facc15',
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            letterSpacing: '-0.5px',
            lineHeight: 1,
          }}
        >
          {ALL_GAMES.length - gamesPlayed}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: 'rgba(255,255,255,0.4)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
          }}
        >
          To Discover
        </span>
      </div>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [userName, setUserName] = useState<string | null>(null);
  const [playCounts, setPlayCounts] = useState<Record<string, number>>({});
  const [mostPlayed, setMostPlayed] = useState<Game[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Load user name
    try {
      const userRaw = localStorage.getItem('mg_user');
      if (userRaw) {
        const user = JSON.parse(userRaw) as { name?: string };
        if (user?.name) {
          setUserName(user.name.split(' ')[0]);
        }
      }
    } catch { /* ignore */ }

    // Load play data
    try {
      const played: string[] = JSON.parse(localStorage.getItem('mg_played') || '[]');
      const counts: Record<string, number> = {};
      played.forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
      setPlayCounts(counts);

      const mp = [...ALL_GAMES]
        .filter((g) => counts[g.id] > 0)
        .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0))
        .slice(0, 12);
      setMostPlayed(mp);

      const firstUnplayed = FEATURED_GAMES.findIndex((g) => !played.includes(g.id));
      if (firstUnplayed !== -1) setFeaturedIndex(firstUnplayed);
    } catch { /* ignore */ }

    setTimeout(() => setVisible(true), 30);
  }, []);

  // Auto-rotate hero every 6s
  useEffect(() => {
    const timer = setInterval(() => {
      setFeaturedIndex((i) => (i + 1) % FEATURED_GAMES.length);
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  const featuredGame = FEATURED_GAMES[featuredIndex] ?? FEATURED_GAMES[0];
  const FeaturedIcon = featuredGame.Icon;

  return (
    <div
      style={{
        background: '#08090f',
        minHeight: '100vh',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.35s ease',
        fontFamily: "'Space Grotesk', system-ui, sans-serif",
      }}
    >
      {/* ── Sticky Header ──────────────────────────────────────── */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          height: 56,
          background: 'rgba(8, 9, 15, 0.9)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        {/* Wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img
            src="/brand/ether-wordmark-transparent-light.png"
            alt="Ether"
            style={{ height: 28, width: 'auto', objectFit: 'contain', flexShrink: 0 }}
          />
        </div>

        {/* Game count pill */}
        <div
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 999,
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 700,
            color: 'rgba(255,255,255,0.45)',
            letterSpacing: '0.06em',
          }}
        >
          {ALL_GAMES.length} GAMES
        </div>

        {/* User avatar */}
        {userName && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: 500 }}>
              {userName}
            </span>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #5b9fc0 0%, #a855f7 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                fontWeight: 700,
                color: '#fff',
                flexShrink: 0,
                boxShadow: '0 2px 8px rgba(91,159,192,0.4)',
              }}
            >
              {userName[0].toUpperCase()}
            </div>
          </div>
        )}
      </header>

      {/* ── Hero Section ───────────────────────────────────────── */}
      <section
        style={{
          position: 'relative',
          height: '42vh',
          minHeight: 280,
          maxHeight: 520,
          overflow: 'hidden',
        }}
      >
        {/* Animated background */}
        <AnimatePresence mode="wait">
          <motion.div
            key={featuredGame.id + '-bg'}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7, ease: 'easeInOut' }}
            style={{
              position: 'absolute',
              inset: 0,
              background: `
                radial-gradient(ellipse 130% 110% at 75% 25%, ${featuredGame.accentColor}30 0%, transparent 60%),
                radial-gradient(ellipse 70% 90% at 15% 85%, ${featuredGame.accentColor}18 0%, transparent 50%),
                #08090f
              `,
            }}
          />
        </AnimatePresence>

        {/* Large decorative icon — background */}
        <AnimatePresence mode="wait">
          <motion.div
            key={featuredGame.id + '-icon'}
            initial={{ opacity: 0, scale: 0.75, rotate: -10 }}
            animate={{ opacity: 0.08, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 1.15, rotate: 8 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            style={{
              position: 'absolute',
              right: '6%',
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
            }}
          >
            <FeaturedIcon size={220} color={featuredGame.accentColor} strokeWidth={1} />
          </motion.div>
        </AnimatePresence>

        {/* Subtle noise texture overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E\")",
            backgroundSize: '200px',
            pointerEvents: 'none',
            opacity: 0.6,
          }}
        />

        {/* Bottom gradient fade */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to top, #08090f 0%, rgba(8,9,15,0.3) 55%, transparent 100%)',
            pointerEvents: 'none',
          }}
        />

        {/* Hero content */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: '0 24px 28px',
          }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={featuredGame.id + '-text'}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              {/* Category chip */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  background: `${featuredGame.accentColor}22`,
                  border: `1px solid ${featuredGame.accentColor}44`,
                  borderRadius: 999,
                  padding: '3px 10px',
                  marginBottom: 10,
                  fontSize: 10,
                  fontWeight: 800,
                  color: featuredGame.accentColor,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                }}
              >
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: featuredGame.accentColor, display: 'inline-block' }} />
                FEATURED
              </div>

              {/* Title */}
              <h1
                style={{
                  color: '#ffffff',
                  fontSize: 'clamp(38px, 9vw, 58px)',
                  fontWeight: 900,
                  margin: '0 0 6px',
                  letterSpacing: '-0.03em',
                  lineHeight: 1.05,
                  fontFamily: "'Space Grotesk', system-ui, sans-serif",
                  textShadow: '0 2px 20px rgba(0,0,0,0.5)',
                }}
              >
                {featuredGame.title}
              </h1>

              {/* Tagline */}
              <p
                style={{
                  color: 'rgba(255,255,255,0.6)',
                  fontSize: 15,
                  margin: '0 0 20px',
                  lineHeight: 1.5,
                  maxWidth: 300,
                }}
              >
                {featuredGame.tagline}
              </p>

              {/* CTA row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <NextLink href={featuredGame.href} style={{ textDecoration: 'none' }}>
                  <motion.div
                    whileHover={{ scale: 1.04, boxShadow: `0 6px 28px ${featuredGame.accentColor}66` }}
                    whileTap={{ scale: 0.96 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 22 }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      background: featuredGame.accentColor,
                      color: '#08090f',
                      fontWeight: 800,
                      fontSize: 15,
                      padding: '13px 24px',
                      borderRadius: 12,
                      letterSpacing: '-0.01em',
                      cursor: 'pointer',
                      fontFamily: "'Space Grotesk', system-ui, sans-serif",
                      boxShadow: `0 4px 20px ${featuredGame.accentColor}44`,
                    }}
                  >
                    ▶ Play Now
                  </motion.div>
                </NextLink>

                {/* Duration pill */}
                <div
                  style={{
                    background: 'rgba(0,0,0,0.55)',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                    color: 'rgba(255,255,255,0.7)',
                    fontSize: 12,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontWeight: 600,
                    padding: '6px 12px',
                    borderRadius: 999,
                    border: '1px solid rgba(255,255,255,0.1)',
                    letterSpacing: '0.02em',
                  }}
                >
                  ⏱ {featuredGame.duration}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Dot indicators */}
          <div style={{ display: 'flex', gap: 5, marginTop: 18 }}>
            {FEATURED_GAMES.map((_, i) => (
              <button
                key={i}
                onClick={() => setFeaturedIndex(i)}
                aria-label={`Featured game ${i + 1}`}
                style={{
                  width: i === featuredIndex ? 24 : 6,
                  height: 4,
                  borderRadius: 999,
                  background:
                    i === featuredIndex
                      ? featuredGame.accentColor
                      : 'rgba(255,255,255,0.18)',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  flexShrink: 0,
                }}
              />
            ))}
          </div>
        </div>

        {/* Ether stripe — bottom edge */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 2,
            background:
              'repeating-linear-gradient(to right, #5b9fc0 0px, #5b9fc0 80px, transparent 80px, transparent 100px)',
            opacity: 0.5,
          }}
        />
      </section>

      {/* ── Category Rows ──────────────────────────────────────── */}
      <div style={{ paddingTop: 32 }}>
        {/* Personal stats — only if player has history */}
        <StatsBar playCounts={playCounts} />

        {/* Most Played — personalized row first */}
        {mostPlayed.length > 0 && (
          <>
            <CarouselRow emoji="🔥" title="Most Played" games={mostPlayed} showRanks />
            <EtherStripe opacity={0.2} margin="0 0 20px" />
          </>
        )}

        <CarouselRow emoji="🎮" title="Skill Games" games={SKILL_GAMES} />
        <EtherStripe opacity={0.2} margin="0 0 20px" />

        <CarouselRow emoji="🏟️" title="Sports Games" games={SPORTS_GAMES} />
        <EtherStripe opacity={0.2} margin="0 0 20px" />

        <CarouselRow emoji="🎉" title="Holiday Games" games={HOLIDAY_GAMES} />
        <EtherStripe opacity={0.2} margin="0 0 20px" />

        <CarouselRow emoji="⭐" title="New Arrivals" games={NEW_ARRIVALS} />
      </div>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer
        style={{
          borderTop: '1px solid rgba(255,255,255,0.04)',
          marginTop: 16,
          paddingTop: 0,
        }}
      >
        <EtherStripe opacity={0.45} margin="0 0 28px" />
        <div
          style={{
            textAlign: 'center',
            padding: '0 20px 52px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                color: 'rgba(255,255,255,0.28)',
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: '0.08em',
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
              }}
            >
              Powered by
            </span>
            <img
              src="/brand/ether-wordmark-transparent-light.png"
              alt="Ether"
              style={{ height: 18, width: 'auto', opacity: 0.65 }}
            />
          </div>
          <div
            style={{
              color: 'rgba(255,255,255,0.12)',
              fontSize: 11,
              fontWeight: 400,
              letterSpacing: '0.06em',
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
            }}
          >
            © 2026 Ether · {ALL_GAMES.length} games · Play anywhere
          </div>
        </div>
      </footer>
    </div>
  );
}
