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

interface Game {
  id: string;
  title: string;
  tagline: string;
  href: string;
  accentColor: string;
  duration: string;
  Icon: GameIcon;
}

// ─── Game Data ────────────────────────────────────────────────────────────────

const SKILL_GAMES: Game[] = [
  { id: 'tilt-maze',       title: 'Tilt Maze',       tagline: 'Roll the ball with your body',             href: '/games/tilt-maze',       accentColor: '#a855f7', duration: '60s', Icon: Compass    },
  { id: 'whisper-bomb',    title: 'Whisper Bomb',    tagline: 'Stay silent. Defuse the bomb.',             href: '/games/whisper-bomb',    accentColor: '#ef4444', duration: '30s', Icon: Bomb       },
  { id: 'breath-rider',    title: 'Breath Rider',    tagline: 'Fly with your breath',                      href: '/games/breath-rider',    accentColor: '#3b82f6', duration: '45s', Icon: Wind       },
  { id: 'steady-hand',     title: 'Steady Hand',     tagline: 'Hold perfectly still. We dare you.',       href: '/games/steady-hand',     accentColor: '#22c55e', duration: '30s', Icon: Target     },
  { id: 'tunnel',          title: 'Infinite Tunnel', tagline: "Dodge the rings. Don't crash.",             href: '/games/tunnel',          accentColor: '#00ffff', duration: '60s', Icon: Zap        },
  { id: 'pulse-sphere',    title: 'Pulse Sphere',    tagline: 'Touch. Move. Breathe. Watch it respond.',   href: '/games/pulse-sphere',    accentColor: '#a855f7', duration: '60s', Icon: Activity   },
  { id: 'shadow-tap',      title: 'Shadow Tap',      tagline: "Tap what you see. Before it's gone.",       href: '/games/shadow-tap',      accentColor: '#64748b', duration: '45s', Icon: Moon       },
  { id: 'color-cascade',   title: 'Color Cascade',   tagline: 'Match the color. Match the speed.',         href: '/games/color-cascade',   accentColor: '#f43f5e', duration: '45s', Icon: Palette    },
  { id: 'memory-grid',     title: 'Memory Grid',     tagline: 'Remember the pattern. Repeat it.',          href: '/games/memory-grid',     accentColor: '#8b5cf6', duration: '60s', Icon: Grid3x3   },
  { id: 'reaction-chain',  title: 'Reaction Chain',  tagline: 'Tap fast. Keep the chain alive.',            href: '/games/reaction-chain',  accentColor: '#facc15', duration: '45s', Icon: ChainLink },
  { id: 'stack-drop',      title: 'Stack Drop',      tagline: "Drop it. Stack it. Don't tip it.",           href: '/games/stack-drop',      accentColor: '#f97316', duration: '60s', Icon: Layers    },
  { id: 'dodge-blitz',    title: 'Dodge Blitz',    tagline: 'Tilt to survive. Don\'t stop moving.',        href: '/games/dodge-blitz',    accentColor: '#06b6d4', duration: '45s', Icon: ChevronsLeftRight },
  { id: 'crowd-roar',     title: 'Crowd Roar',      tagline: "Roar loud. Hold it. Don't fade.",             href: '/games/crowd-roar',      accentColor: '#ef4444', duration: '45s', Icon: Radio     },
  { id: 'balance-beam',   title: 'Balance Beam',    tagline: 'Keep the ball on the beam. Stay still.',      href: '/games/balance-beam',    accentColor: '#f59e0b', duration: '60s', Icon: Activity  },
  { id: 'path-trace',     title: 'Path Trace',      tagline: "Follow the line. Don't stray.",               href: '/games/path-trace',      accentColor: '#e879f9', duration: '45s', Icon: Pen       },
  { id: 'pitch-match',   title: 'Pitch Match',     tagline: 'Hit the note. Hold it. Feel it.',              href: '/games/pitch-match',     accentColor: '#34d399', duration: '45s', Icon: Music     },
  { id: 'symbol-scan',   title: 'Symbol Scan',     tagline: 'Find it. Tap it. Before the clock runs out.',  href: '/games/symbol-scan',     accentColor: '#10b981', duration: '60s', Icon: Grid3x3   },
];

const SPORTS_GAMES: Game[] = [
  { id: 'hoop-shot',      title: 'Hoop Shot',      tagline: 'Swipe to score. 60 seconds on the clock.',     href: '/games/hoop-shot',      accentColor: '#f97316', duration: '60s', Icon: Circle     },
  { id: 'penalty-kick',   title: 'Penalty Kick',   tagline: 'Beat the keeper. Aim for the corners.',         href: '/games/penalty-kick',   accentColor: '#22c55e', duration: '60s', Icon: Navigation },
  { id: 'spiral-throw',   title: 'Spiral Throw',   tagline: "Lead your receiver. Don't throw behind.",       href: '/games/spiral-throw',   accentColor: '#f59e0b', duration: '60s', Icon: RotateCw   },
  { id: 'reflex-rally',   title: 'Reflex Rally',   tagline: "Return every shot. Don't miss.",                href: '/games/reflex-rally',   accentColor: '#84cc16', duration: '60s', Icon: Timer      },
  { id: 'precision-putt', title: 'Precision Putt', tagline: 'Read the green. Control the power.',            href: '/games/precision-putt', accentColor: '#86efac', duration: '60s', Icon: Flag       },
];

const HOLIDAY_GAMES: Game[] = [
  { id: 'gift-rush',        title: 'Gift Rush',        tagline: "Swipe left or right. Fast. Santa's watching.", href: '/games/gift-rush',        accentColor: '#ef4444', duration: '45s', Icon: Gift        },
  { id: 'snow-catch',       title: 'Snow Catch',       tagline: "Tilt to catch the snow. Miss one and it's over.", href: '/games/snow-catch',    accentColor: '#93c5fd', duration: '45s', Icon: Snowflake   },
  { id: 'boo-blast',        title: 'Boo Blast',        tagline: "Tap the ghosts. They won't wait.",              href: '/games/boo-blast',        accentColor: '#a855f7', duration: '30s', Icon: Ghost       },
  { id: 'cauldron-bubble',  title: 'Cauldron Bubble',  tagline: 'Blow to bubble. Too quiet = dead. Too loud = BOOM.', href: '/games/cauldron-bubble', accentColor: '#22c55e', duration: '45s', Icon: FlaskConical },
  { id: 'firework-launch',  title: 'Firework Launch',  tagline: 'Swipe to launch. Tap to detonate. Make it count.', href: '/games/firework-launch', accentColor: '#f59e0b', duration: '45s', Icon: Sparkles    },
  { id: 'countdown-crush',  title: 'Countdown Crush',  tagline: 'Score before midnight. Every second counts.',   href: '/games/countdown-crush',  accentColor: '#fbbf24', duration: '30s', Icon: Clock       },
  { id: 'cupid-shot',       title: 'Cupid Shot',       tagline: 'Aim. Wait. Shoot at the perfect moment.',       href: '/games/cupid-shot',       accentColor: '#f43f5e', duration: '45s', Icon: Heart       },
  { id: 'love-note',        title: 'Love Note',        tagline: 'Remember the sequence. Tap it back. From the heart.', href: '/games/love-note', accentColor: '#ec4899', duration: '60s', Icon: Mail        },
  { id: 'turkey-trot',      title: 'Turkey Trot',      tagline: "The turkey's running. Prove you're faster.",    href: '/games/turkey-trot',      accentColor: '#f97316', duration: '30s', Icon: Feather     },
  { id: 'harvest-catch',    title: 'Harvest Catch',    tagline: "Tilt to catch the harvest. Skip the Brussels sprouts.", href: '/games/harvest-catch', accentColor: '#d97706', duration: '45s', Icon: Wheat },
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

// "New Arrivals" — last games added to the platform
const NEW_ARRIVAL_IDS = ['harvest-catch', 'love-note', 'countdown-crush', 'cauldron-bubble', 'snow-catch'];
const NEW_ARRIVALS: Game[] = NEW_ARRIVAL_IDS
  .map(id => ALL_GAMES.find(g => g.id === id))
  .filter((g): g is Game => g !== undefined);

// ─── Netflix Game Card ────────────────────────────────────────────────────────

function NetflixCard({ game }: { game: Game }) {
  const { Icon } = game;

  return (
    <div className="game-card-netflix" data-testid="game-card">
      {/* Main game link */}
      <NextLink href={game.href} style={{ textDecoration: 'none', display: 'block', height: '100%' }}>
        <motion.div
          whileHover={{
            scale: 1.05,
            boxShadow: `0 0 0 2px ${game.accentColor}99, 0 8px 32px ${game.accentColor}44`,
          }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          style={{
            height: '100%',
            background: `linear-gradient(160deg, ${game.accentColor}cc 0%, ${game.accentColor}55 45%, #08090f 100%)`,
            borderRadius: 12,
            border: `1px solid ${game.accentColor}33`,
            display: 'flex',
            flexDirection: 'column',
            padding: '12px 12px 14px',
            cursor: 'pointer',
            position: 'relative',
          }}
        >
          {/* Duration badge — top right */}
          <div
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
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

          {/* Large decorative icon — centered */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0.3,
            }}
          >
            <Icon size={80} color="white" />
          </div>

          {/* Bottom text */}
          <div style={{ flexShrink: 0, paddingBottom: 18 }}>
            <div
              style={{
                color: '#ffffff',
                fontWeight: 700,
                fontSize: 15,
                lineHeight: 1.25,
                marginBottom: 5,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {game.title}
            </div>
            <div
              style={{
                color: 'rgba(255,255,255,0.6)',
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
        </motion.div>
      </NextLink>

      {/* QA button — bottom corner, subtle, above main link */}
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
          color: 'rgba(255,255,255,0.28)',
          border: '1px solid rgba(255,255,255,0.1)',
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

function CarouselRow({ title, games }: { title: string; games: Game[] }) {
  if (games.length === 0) return null;

  return (
    <div style={{ marginBottom: 40 }}>
      <div
        style={{
          padding: '0 20px',
          marginBottom: 14,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.65)',
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
        }}
      >
        {title}
      </div>
      <div className="carousel-row" style={{ paddingLeft: 20, paddingRight: 20 }}>
        {games.map((game) => (
          <NetflixCard key={game.id} game={game} />
        ))}
      </div>
    </div>
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

      // Count plays per game
      const counts: Record<string, number> = {};
      played.forEach((id) => {
        counts[id] = (counts[id] || 0) + 1;
      });
      setPlayCounts(counts);

      // Most played row
      const mp = [...ALL_GAMES]
        .filter((g) => counts[g.id] > 0)
        .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0))
        .slice(0, 12);
      setMostPlayed(mp);

      // Set featured to first unplayed game in the featured pool
      const firstUnplayed = FEATURED_GAMES.findIndex((g) => !played.includes(g.id));
      if (firstUnplayed !== -1) {
        setFeaturedIndex(firstUnplayed);
      }
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
        transition: 'opacity 0.3s ease',
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
          background: 'rgba(8, 9, 15, 0.88)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        {/* Wordmark — full Ether logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img
            src="/brand/ether-wordmark-transparent-light.png"
            alt="Ether"
            style={{
              height: 28,
              width: 'auto',
              objectFit: 'contain',
              flexShrink: 0,
            }}
          />
        </div>

        {/* User avatar — only if logged in */}
        {userName && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                color: 'rgba(255,255,255,0.65)',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
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
          height: '40vh',
          minHeight: 260,
          maxHeight: 500,
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
                radial-gradient(ellipse 120% 100% at 70% 30%, ${featuredGame.accentColor}28 0%, transparent 60%),
                radial-gradient(ellipse 60% 80% at 20% 80%, ${featuredGame.accentColor}15 0%, transparent 50%),
                #08090f
              `,
            }}
          />
        </AnimatePresence>

        {/* Large decorative icon — background */}
        <AnimatePresence mode="wait">
          <motion.div
            key={featuredGame.id + '-icon'}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 0.07, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            style={{
              position: 'absolute',
              right: '8%',
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
            }}
          >
            <FeaturedIcon size={200} color={featuredGame.accentColor} />
          </motion.div>
        </AnimatePresence>

        {/* Bottom gradient fade */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to top, #08090f 0%, transparent 55%)',
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
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.45, ease: 'easeOut' }}
            >
              {/* Title */}
              <h1
                style={{
                  color: '#ffffff',
                  fontSize: 'clamp(36px, 8vw, 56px)',
                  fontWeight: 800,
                  margin: '0 0 6px',
                  letterSpacing: '-0.03em',
                  lineHeight: 1.1,
                  fontFamily: "'Space Grotesk', system-ui, sans-serif",
                }}
              >
                {featuredGame.title}
              </h1>

              {/* Tagline */}
              <p
                style={{
                  color: 'rgba(255,255,255,0.65)',
                  fontSize: 15,
                  margin: '0 0 18px',
                  lineHeight: 1.5,
                  maxWidth: 320,
                }}
              >
                {featuredGame.tagline}
              </p>

              {/* CTA button */}
              <NextLink href={featuredGame.href} style={{ textDecoration: 'none' }}>
                <motion.div
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ duration: 0.15 }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    background: featuredGame.accentColor,
                    color: '#08090f',
                    fontWeight: 800,
                    fontSize: 15,
                    padding: '12px 26px',
                    borderRadius: 10,
                    letterSpacing: '-0.01em',
                    cursor: 'pointer',
                    fontFamily: "'Space Grotesk', system-ui, sans-serif",
                    boxShadow: `0 4px 24px ${featuredGame.accentColor}55`,
                  }}
                >
                  Play Now →
                </motion.div>
              </NextLink>
            </motion.div>
          </AnimatePresence>

          {/* Dot indicators */}
          <div
            style={{
              display: 'flex',
              gap: 6,
              marginTop: 16,
            }}
          >
            {FEATURED_GAMES.map((_, i) => (
              <button
                key={i}
                onClick={() => setFeaturedIndex(i)}
                style={{
                  width: i === featuredIndex ? 20 : 6,
                  height: 6,
                  borderRadius: 999,
                  background: i === featuredIndex ? featuredGame.accentColor : 'rgba(255,255,255,0.2)',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                }}
                aria-label={`Featured game ${i + 1}`}
              />
            ))}
          </div>
        </div>

        {/* Powered by Ether badge — bottom right of hero */}
        <div
          style={{
            position: 'absolute',
            bottom: 20,
            right: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            opacity: 0.4,
            pointerEvents: 'none',
          }}
        >
          <img
            src="/brand/ether-wordmark-light.jpg"
            alt="Ether"
            style={{
              height: 16,
              width: 'auto',
              mixBlendMode: 'screen',
            }}
          />
        </div>

        {/* Ether stripe — bottom edge of hero */}
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
      <div style={{ paddingTop: 36 }}>
        <CarouselRow title="🎮 Skill Games" games={[...SKILL_GAMES, ...SPORTS_GAMES]} />
        <EtherStripe opacity={0.25} margin="4px 0 20px" />
        <CarouselRow title="🎉 Holiday Games" games={HOLIDAY_GAMES} />
        {mostPlayed.length > 0 && (
          <>
            <EtherStripe opacity={0.25} margin="4px 0 20px" />
            <CarouselRow title="🔥 Most Played" games={mostPlayed} />
          </>
        )}
        <EtherStripe opacity={0.25} margin="4px 0 20px" />
        <CarouselRow title="⭐ New Arrivals" games={NEW_ARRIVALS} />
      </div>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer
        style={{
          borderTop: '1px solid rgba(255,255,255,0.05)',
          marginTop: 16,
          paddingTop: 0,
        }}
      >
        {/* Ether stripe at top of footer */}
        <EtherStripe opacity={0.5} margin="0 0 28px" />

        {/* Wordmark + tagline */}
        <div
          style={{
            textAlign: 'center',
            padding: '0 20px 48px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          {/* "Powered by ETHER" */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span
              style={{
                color: 'rgba(255,255,255,0.3)',
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
              style={{
                height: 18,
                width: 'auto',
                opacity: 0.75,
              }}
            />
          </div>

          {/* Copyright */}
          <div
            style={{
              color: 'rgba(255,255,255,0.15)',
              fontSize: 11,
              fontWeight: 400,
              letterSpacing: '0.06em',
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
            }}
          >
            © 2026 Ether
          </div>
        </div>
      </footer>
    </div>
  );
}
