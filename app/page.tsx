'use client';

import { useEffect, useState, useCallback } from 'react';
import NextLink from 'next/link';
import type React from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type GameCategory = 'skill' | 'sports' | 'holiday' | 'cognitive' | 'breath';

interface Game {
  id: string;
  title: string;
  tagline: string;
  href: string;
  accentColor: string;
  duration: string;
  icon: string; // Material Symbol name
  category: GameCategory;
}

// ─── Game Data ────────────────────────────────────────────────────────────────

const SKILL_GAMES: Game[] = [
  { id: 'tilt-maze',       title: 'Tilt Maze',       tagline: 'Roll the ball with your body',              href: '/games/tilt-maze',       accentColor: '#a855f7', duration: '60s', icon: 'explore',             category: 'skill'     },
  { id: 'whisper-bomb',    title: 'Whisper Bomb',    tagline: 'Stay silent. Defuse the bomb.',             href: '/games/whisper-bomb',    accentColor: '#ef4444', duration: '30s', icon: 'bomb',                category: 'breath'    },
  { id: 'breath-rider',    title: 'Breath Rider',    tagline: 'Fly with your breath',                      href: '/games/breath-rider',    accentColor: '#3b82f6', duration: '45s', icon: 'air',                 category: 'breath'    },
  { id: 'steady-hand',     title: 'Steady Hand',     tagline: 'Hold perfectly still. We dare you.',       href: '/games/steady-hand',     accentColor: '#22c55e', duration: '30s', icon: 'ads_click',           category: 'skill'     },
  { id: 'tunnel',          title: 'Infinite Tunnel', tagline: "Dodge the rings. Don't crash.",             href: '/games/tunnel',          accentColor: '#00ffff', duration: '60s', icon: 'bolt',                category: 'skill'     },
  { id: 'pulse-sphere',    title: 'Pulse Sphere',    tagline: 'Touch. Move. Breathe. Watch it respond.',   href: '/games/pulse-sphere',    accentColor: '#a855f7', duration: '60s', icon: 'pulmonology',         category: 'breath'    },
  { id: 'shadow-tap',      title: 'Shadow Tap',      tagline: "Tap what you see. Before it's gone.",       href: '/games/shadow-tap',      accentColor: '#64748b', duration: '45s', icon: 'dark_mode',           category: 'cognitive' },
  { id: 'color-cascade',   title: 'Color Cascade',   tagline: 'Match the color. Match the speed.',         href: '/games/color-cascade',   accentColor: '#f43f5e', duration: '45s', icon: 'palette',             category: 'cognitive' },
  { id: 'memory-grid',     title: 'Memory Grid',     tagline: 'Remember the pattern. Repeat it.',          href: '/games/memory-grid',     accentColor: '#8b5cf6', duration: '60s', icon: 'grid_view',           category: 'cognitive' },
  { id: 'reaction-chain',  title: 'Reaction Chain',  tagline: 'Tap fast. Keep the chain alive.',            href: '/games/reaction-chain',  accentColor: '#facc15', duration: '45s', icon: 'link',                category: 'cognitive' },
  { id: 'stack-drop',      title: 'Stack Drop',      tagline: "Drop it. Stack it. Don't tip it.",           href: '/games/stack-drop',      accentColor: '#f97316', duration: '60s', icon: 'layers',              category: 'skill'     },
  { id: 'dodge-blitz',     title: 'Dodge Blitz',     tagline: "Tilt to survive. Don't stop moving.",       href: '/games/dodge-blitz',     accentColor: '#06b6d4', duration: '45s', icon: 'swap_horiz',          category: 'skill'     },
  { id: 'crowd-roar',      title: 'Crowd Roar',      tagline: "Roar loud. Hold it. Don't fade.",            href: '/games/crowd-roar',      accentColor: '#ef4444', duration: '45s', icon: 'radio',               category: 'breath'    },
  { id: 'balance-beam',    title: 'Balance Beam',    tagline: 'Keep the ball on the beam. Stay still.',     href: '/games/balance-beam',    accentColor: '#f59e0b', duration: '60s', icon: 'balance',             category: 'skill'     },
  { id: 'path-trace',      title: 'Path Trace',      tagline: "Follow the line. Don't stray.",              href: '/games/path-trace',      accentColor: '#e879f9', duration: '45s', icon: 'edit',                category: 'skill'     },
  { id: 'pitch-match',     title: 'Pitch Match',     tagline: 'Hit the note. Hold it. Feel it.',             href: '/games/pitch-match',     accentColor: '#34d399', duration: '45s', icon: 'music_note',          category: 'breath'    },
  { id: 'symbol-scan',     title: 'Symbol Scan',     tagline: 'Find it. Tap it. Before the clock runs out.', href: '/games/symbol-scan',   accentColor: '#10b981', duration: '60s', icon: 'manage_search',       category: 'cognitive' },
];

const SPORTS_GAMES: Game[] = [
  { id: 'hoop-shot',      title: 'Hoop Shot',      tagline: 'Swipe to score. 60 seconds on the clock.',    href: '/games/hoop-shot',      accentColor: '#f97316', duration: '60s', icon: 'sports_basketball', category: 'sports' },
  { id: 'penalty-kick',   title: 'Penalty Kick',   tagline: 'Beat the keeper. Aim for the corners.',        href: '/games/penalty-kick',   accentColor: '#22c55e', duration: '60s', icon: 'sports_soccer',     category: 'sports' },
  { id: 'spiral-throw',   title: 'Spiral Throw',   tagline: "Lead your receiver. Don't throw behind.",      href: '/games/spiral-throw',   accentColor: '#f59e0b', duration: '60s', icon: 'sports_football',   category: 'sports' },
  { id: 'reflex-rally',   title: 'Reflex Rally',   tagline: "Return every shot. Don't miss.",               href: '/games/reflex-rally',   accentColor: '#84cc16', duration: '60s', icon: 'sports_tennis',     category: 'sports' },
  { id: 'precision-putt', title: 'Precision Putt', tagline: 'Read the green. Control the power.',           href: '/games/precision-putt', accentColor: '#86efac', duration: '60s', icon: 'sports_golf',       category: 'sports' },
];

const HOLIDAY_GAMES: Game[] = [
  { id: 'gift-rush',        title: 'Gift Rush',        tagline: "Swipe left or right. Fast. Santa's watching.", href: '/games/gift-rush',        accentColor: '#ef4444', duration: '45s', icon: 'redeem',        category: 'holiday' },
  { id: 'snow-catch',       title: 'Snow Catch',       tagline: "Tilt to catch the snow. Miss one and it's over.", href: '/games/snow-catch',    accentColor: '#93c5fd', duration: '45s', icon: 'ac_unit',       category: 'holiday' },
  { id: 'boo-blast',        title: 'Boo Blast',        tagline: "Tap the ghosts. They won't wait.",              href: '/games/boo-blast',        accentColor: '#a855f7', duration: '30s', icon: 'ghost',         category: 'holiday' },
  { id: 'cauldron-bubble',  title: 'Cauldron Bubble',  tagline: 'Blow to bubble. Too quiet = dead. Too loud = BOOM.', href: '/games/cauldron-bubble', accentColor: '#22c55e', duration: '45s', icon: 'science',  category: 'holiday' },
  { id: 'firework-launch',  title: 'Firework Launch',  tagline: 'Swipe to launch. Tap to detonate. Make it count.', href: '/games/firework-launch', accentColor: '#f59e0b', duration: '45s', icon: 'celebration', category: 'holiday' },
  { id: 'countdown-crush',  title: 'Countdown Crush',  tagline: 'Score before midnight. Every second counts.',   href: '/games/countdown-crush',  accentColor: '#fbbf24', duration: '30s', icon: 'timer',        category: 'holiday' },
  { id: 'cupid-shot',       title: 'Cupid Shot',       tagline: 'Aim. Wait. Shoot at the perfect moment.',       href: '/games/cupid-shot',       accentColor: '#f43f5e', duration: '45s', icon: 'favorite',     category: 'holiday' },
  { id: 'love-note',        title: 'Love Note',        tagline: 'Remember the sequence. Tap it back. From the heart.', href: '/games/love-note', accentColor: '#ec4899', duration: '60s', icon: 'mail',          category: 'holiday' },
  { id: 'turkey-trot',      title: 'Turkey Trot',      tagline: "The turkey's running. Prove you're faster.",    href: '/games/turkey-trot',      accentColor: '#f97316', duration: '30s', icon: 'directions_run', category: 'holiday' },
  { id: 'harvest-catch',    title: 'Harvest Catch',    tagline: "Tilt to catch the harvest. Skip the Brussels sprouts.", href: '/games/harvest-catch', accentColor: '#d97706', duration: '45s', icon: 'agriculture', category: 'holiday' },
];

const ALL_GAMES: Game[] = [...SKILL_GAMES, ...SPORTS_GAMES, ...HOLIDAY_GAMES];

const FEATURED_GAMES: Game[] = [
  SKILL_GAMES[0],
  SKILL_GAMES[1],
  SKILL_GAMES[4],
  SKILL_GAMES[9],
  HOLIDAY_GAMES[2],
  HOLIDAY_GAMES[4],
];

const NEW_ARRIVAL_IDS = ['harvest-catch', 'love-note', 'countdown-crush', 'cauldron-bubble', 'snow-catch'];
const NEW_ARRIVALS: Game[] = NEW_ARRIVAL_IDS
  .map(id => ALL_GAMES.find(g => g.id === id))
  .filter((g): g is Game => g !== undefined);

// ─── Category config ──────────────────────────────────────────────────────────

const CATEGORY_META: Record<GameCategory, { label: string }> = {
  skill:     { label: 'SKILL'   },
  sports:    { label: 'SPORTS'  },
  holiday:   { label: 'HOLIDAY' },
  cognitive: { label: 'BRAIN'   },
  breath:    { label: 'BREATH'  },
};

// ─── TopNavBar ────────────────────────────────────────────────────────────────

function TopNavBar() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <header style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        height: 64,
        background: 'rgba(19,19,19,0.7)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderBottom: '1px solid rgba(63,72,78,0.2)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        gap: 32,
      }}>
        {/* Logo */}
        <div style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 700,
          fontSize: 18,
          letterSpacing: '0.15em',
          color: '#84d0f9',
          textTransform: 'uppercase',
          flexShrink: 0,
        }}>
          GLIMMERS
        </div>

        {/* Nav links — center (hidden on mobile) */}
        <nav className="hidden md:flex top-nav-links" style={{ gap: 32, flex: 1, justifyContent: 'center' }}>
          {[
            { label: 'Discover', active: true },
            { label: 'Library', active: false },
            { label: 'Community', active: false },
          ].map(item => (
            <button key={item.label} style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 14,
              fontWeight: item.active ? 600 : 400,
              color: item.active ? '#84d0f9' : '#bfc8ce',
              padding: '4px 0',
              borderBottom: item.active ? '2px solid #84d0f9' : '2px solid transparent',
              transition: 'color 0.2s, border-color 0.2s',
            }}>
              {item.label}
            </button>
          ))}
        </nav>

        {/* Right: search + icons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, marginLeft: 'auto' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            background: '#201f1f',
            border: '1px solid rgba(63,72,78,0.3)',
            borderRadius: 8,
            padding: '6px 12px',
            gap: 8,
          }} className="top-search">
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#bfc8ce' }}>search</span>
            <input
              placeholder="Search games..."
              style={{
                background: 'none',
                border: 'none',
                outline: 'none',
                color: '#e5e2e1',
                fontSize: 13,
                fontFamily: "'Space Grotesk', sans-serif",
                width: 140,
              }}
            />
          </div>
          {/* Mobile-only search icon */}
          <button className="top-search-icon-mobile" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 22, color: '#bfc8ce' }}>search</span>
          </button>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 22, color: '#bfc8ce' }}>account_circle</span>
          </button>
          {/* Hamburger — mobile only */}
          <button
            className="md:hidden"
            onClick={() => setMenuOpen(true)}
            style={{ background: 'none', border: 'none', color: '#84d0f9', cursor: 'pointer', padding: 4 }}
          >
            <span className="material-symbols-outlined">menu</span>
          </button>
        </div>
      </header>

      {/* Mobile drawer overlay */}
      {menuOpen && (
        <div
          onClick={() => setMenuOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200 }}
        />
      )}

      {/* Mobile drawer */}
      <div style={{
        position: 'fixed', top: 0, left: 0, height: '100%', width: 'min(75vw, 280px)',
        background: '#1c1b1b', zIndex: 201,
        transform: menuOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.3s ease',
        overflowY: 'auto',
        padding: '20px 0',
      }}>
        {/* Drawer header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px 24px' }}>
          <span style={{ color: '#84d0f9', fontWeight: 900, fontSize: 18, fontFamily: "'Space Grotesk',sans-serif", letterSpacing: '-0.03em' }}>GLIMMERS</span>
          <button onClick={() => setMenuOpen(false)} style={{ background: 'none', border: 'none', color: '#bfc8ce', cursor: 'pointer' }}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Drawer nav items */}
        {[
          { label: 'Discover',     icon: 'explore',       active: true  },
          { label: 'Library',      icon: 'sports_esports', active: false },
          { label: 'Achievements', icon: 'military_tech', active: false },
          { label: 'Community',    icon: 'groups',        active: false },
        ].map(item => (
          <button key={item.label} onClick={() => setMenuOpen(false)} style={{
            display: 'flex', alignItems: 'center', gap: 14, width: '100%',
            padding: '14px 20px', background: item.active ? '#201f1f' : 'none', border: 'none',
            color: item.active ? '#84d0f9' : '#bfc8ce', cursor: 'pointer',
            fontFamily: "'Manrope',sans-serif", fontSize: 11, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.1em',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>{item.icon}</span>
            {item.label}
          </button>
        ))}

        {/* Pro Account */}
        <div style={{ margin: '24px 16px 0', padding: 14, background: '#2a2a2a', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 6, background: 'rgba(132,208,249,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#84d0f9' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>bolt</span>
          </div>
          <div>
            <div style={{ color: '#e5e2e1', fontSize: 9, fontWeight: 900, letterSpacing: '0.15em', textTransform: 'uppercase' }}>Pro Account</div>
            <div style={{ color: '#feb967', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>Active Plan</div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── SideNavBar ───────────────────────────────────────────────────────────────

function SideNavBar() {
  const navItems = [
    { icon: 'explore',          label: 'Discover',     active: true  },
    { icon: 'video_library',    label: 'Library',      active: false },
    { icon: 'emoji_events',     label: 'Achievements', active: false },
    { icon: 'group',            label: 'Community',    active: false },
  ];

  return (
    <aside className="side-nav" style={{
      position: 'fixed',
      top: 64,
      left: 0,
      bottom: 0,
      width: 256,
      background: '#1c1b1b',
      borderRight: '1px solid rgba(63,72,78,0.15)',
      flexDirection: 'column',
      zIndex: 40,
      overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{ padding: '24px 20px 16px' }}>
        <div style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 700,
          fontSize: 15,
          color: '#84d0f9',
          marginBottom: 2,
        }}>
          Aetheric Console
        </div>
        <div style={{
          fontFamily: "'Manrope', sans-serif",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.15em',
          color: '#bfc8ce',
          textTransform: 'uppercase',
        }}>
          Precision Gaming
        </div>
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, padding: '8px 12px' }}>
        {navItems.map(item => (
          <button key={item.label} style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 12px',
            borderRadius: 8,
            background: item.active ? '#201f1f' : 'transparent',
            border: 'none',
            cursor: 'pointer',
            marginBottom: 2,
          }}>
            <span className="material-symbols-outlined" style={{
              fontSize: 22,
              color: item.active ? '#84d0f9' : '#bfc8ce',
            }}>
              {item.icon}
            </span>
            <span style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 14,
              fontWeight: item.active ? 600 : 400,
              color: item.active ? '#e5e2e1' : '#bfc8ce',
            }}>
              {item.label}
            </span>
            {item.active && (
              <div style={{
                marginLeft: 'auto',
                width: 3,
                height: 16,
                borderRadius: 2,
                background: '#84d0f9',
              }} />
            )}
          </button>
        ))}
      </nav>

      {/* Pro Account card */}
      <div style={{ padding: '12px 16px 24px' }}>
        <div style={{
          background: 'linear-gradient(135deg, #201f1f, #2a2a2a)',
          border: '1px solid rgba(63,72,78,0.3)',
          borderRadius: 12,
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: 'linear-gradient(135deg, #84d0f9, #4a99c0)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#002d40' }}>bolt</span>
          </div>
          <div>
            <div style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.1em',
              color: '#e5e2e1',
              textTransform: 'uppercase',
            }}>
              Pro Account
            </div>
            <div style={{
              fontFamily: "'Manrope', sans-serif",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.12em',
              color: '#feb967',
              textTransform: 'uppercase',
            }}>
              Active Plan
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

// ─── Hero Section ─────────────────────────────────────────────────────────────

function HeroSection({ game, index, total, onDotClick }: {
  game: Game;
  index: number;
  total: number;
  onDotClick: (i: number) => void;
}) {
  return (
    <section className="hero-section" style={{
      width: '100%',
      height: 500,
      borderRadius: 16,
      background: '#1c1b1b',
      position: 'relative',
      overflow: 'hidden',
      marginBottom: 80,
    }}>
      {/* Decorative bg icon */}
      <div style={{
        position: 'absolute',
        right: -20,
        top: '50%',
        transform: 'translateY(-50%)',
        fontSize: 280,
        color: 'white',
        filter: 'grayscale(100%)',
        opacity: 0.06,
        pointerEvents: 'none',
        lineHeight: 1,
      }}>
        <span className="material-symbols-outlined" style={{ fontSize: 280 }}>{game.icon}</span>
      </div>

      {/* Colored ambient glow */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(ellipse 60% 80% at 80% 40%, ${game.accentColor}18 0%, transparent 60%)`,
        pointerEvents: 'none',
      }} />

      {/* Bottom overlay gradient */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(to top, #131313 0%, rgba(19,19,19,0.4) 50%, transparent 100%)',
        pointerEvents: 'none',
      }} />

      {/* Content — bottom left */}
      <div className="hero-content" style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '0 40px 40px',
        zIndex: 10,
      }}>
        {/* Badge */}
        <div style={{
          display: 'inline-block',
          background: 'rgba(132,208,249,0.1)',
          color: '#84d0f9',
          padding: '4px 12px',
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          marginBottom: 12,
          fontFamily: "'Space Grotesk', sans-serif",
        }}>
          Featured Experience
        </div>

        {/* Title */}
        <h1 className="hero-title" style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 'clamp(42px, 7vw, 64px)',
          fontWeight: 700,
          letterSpacing: '-0.04em',
          color: '#e5e2e1',
          textTransform: 'uppercase',
          margin: '0 0 10px',
          lineHeight: 1.0,
        }}>
          {game.title}
        </h1>

        {/* Description */}
        <p className="hero-desc" style={{
          fontFamily: "'Manrope', sans-serif",
          fontSize: 15,
          color: '#bfc8ce',
          margin: '0 0 24px',
          maxWidth: 480,
          lineHeight: 1.6,
        }}>
          {game.tagline}
        </p>

        {/* Buttons */}
        <div className="hero-btns" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <NextLink href={game.href} style={{ textDecoration: 'none' }}>
            <button className="hero-btn" style={{
              background: 'linear-gradient(135deg, #84d0f9, #4a99c0)',
              color: '#002d40',
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 700,
              fontSize: 14,
              padding: '12px 32px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              letterSpacing: '0.02em',
            }}>
              LAUNCH CORE
            </button>
          </NextLink>
          <button className="hero-btn" style={{
            background: '#2a2a2a',
            color: '#e5e2e1',
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 500,
            fontSize: 14,
            padding: '12px 24px',
            borderRadius: 8,
            border: '1px solid rgba(63,72,78,0.4)',
            cursor: 'pointer',
          }}>
            VIEW INTEL
          </button>
        </div>

        {/* Dot indicators */}
        <div style={{ display: 'flex', gap: 6, marginTop: 20 }}>
          {Array.from({ length: total }).map((_, i) => (
            <button
              key={i}
              onClick={() => onDotClick(i)}
              style={{
                width: i === index ? 24 : 6,
                height: 4,
                borderRadius: 999,
                background: i === index ? '#84d0f9' : 'rgba(255,255,255,0.2)',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                transition: 'all 0.3s ease',
                flexShrink: 0,
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Skill Challenges Section ─────────────────────────────────────────────────

function SkillChallengesSection({ firstGame }: { firstGame: Game }) {
  return (
    <section className="section-mb" style={{ marginBottom: 96 }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 className="section-h2" style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 30,
            fontWeight: 700,
            color: '#e5e2e1',
            margin: 0,
            letterSpacing: '-0.02em',
          }}>
            Skill Challenges
          </h2>
          <p style={{
            fontFamily: "'Manrope', sans-serif",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.2em',
            color: '#bfc8ce',
            textTransform: 'uppercase',
            margin: '4px 0 0',
          }}>
            Global Competition Matrix
          </p>
        </div>
        <a href="#" style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: 13,
          fontWeight: 600,
          color: '#84d0f9',
          textDecoration: 'none',
        }}>
          Open Arena →
        </a>
      </div>

      {/* Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 24,
      }} className="skill-challenges-grid">
        {/* Large card */}
        <div style={{
          gridColumn: 'span 2',
          background: '#1c1b1b',
          borderRadius: 16,
          padding: 32,
          border: '1px solid rgba(63,72,78,0.15)',
        }} className="skill-large-card skill-large-pad">
          {/* Live badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <div style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#feb967',
              flexShrink: 0,
            }} />
            <span style={{
              fontFamily: "'Manrope', sans-serif",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.2em',
              color: '#bfc8ce',
              textTransform: 'uppercase',
            }}>
              Live Tournament
            </span>
          </div>

          <h3 className="skill-h3" style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 28,
            fontWeight: 700,
            color: '#e5e2e1',
            margin: '0 0 8px',
            letterSpacing: '-0.02em',
          }}>
            Circuit Breaker
          </h3>
          <p style={{
            fontFamily: "'Manrope', sans-serif",
            fontSize: 14,
            color: '#bfc8ce',
            margin: '0 0 32px',
            lineHeight: 1.6,
            maxWidth: 400,
          }}>
            Push your reaction speed to the limit. The global leaderboard resets every 24 hours.
          </p>

          {/* Chips */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{
              background: 'rgba(132,208,249,0.08)',
              border: '1px solid rgba(132,208,249,0.2)',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 12,
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 600,
              color: '#84d0f9',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>group</span>
              Participants 12.4k
            </div>
            <div style={{
              background: 'rgba(254,185,103,0.08)',
              border: '1px solid rgba(254,185,103,0.2)',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 12,
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 600,
              color: '#feb967',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>timer</span>
              Time Remaining 04:22:18
            </div>
          </div>
        </div>

        {/* Small card */}
        <div style={{
          background: '#201f1f',
          borderRadius: 16,
          padding: 32,
          border: '1px solid rgba(63,72,78,0.15)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}>
          <div>
            <span className="material-symbols-outlined" style={{
              fontSize: 40,
              color: '#84d0f9',
              display: 'block',
              marginBottom: 16,
            }}>
              precision_manufacturing
            </span>
            <h3 style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 22,
              fontWeight: 700,
              color: '#e5e2e1',
              margin: '0 0 8px',
              letterSpacing: '-0.02em',
            }}>
              Neural Link
            </h3>
            <p style={{
              fontFamily: "'Manrope', sans-serif",
              fontSize: 13,
              color: '#bfc8ce',
              margin: 0,
              lineHeight: 1.6,
            }}>
              Synchronize your cognitive response patterns with the network.
            </p>
          </div>
          <button style={{
            marginTop: 24,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 13,
            fontWeight: 700,
            color: '#84d0f9',
            padding: 0,
            textAlign: 'left',
          }}>
            Enter Sync →
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── New Arrivals Section ─────────────────────────────────────────────────────

function NewArrivalsSection() {
  return (
    <section className="section-mb" style={{ marginBottom: 96 }}>
      <h2 className="section-h2" style={{
        fontFamily: "'Space Grotesk', sans-serif",
        fontSize: 30,
        fontWeight: 700,
        color: '#e5e2e1',
        margin: '0 0 24px',
        letterSpacing: '-0.02em',
      }}>
        New Arrivals
      </h2>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 24,
      }} className="new-arrivals-grid">
        {NEW_ARRIVALS.map(game => (
          <NextLink key={game.id} href={game.href} style={{ textDecoration: 'none' }}>
            <div className="new-arrival-card">
              {/* Image area */}
              <div style={{
                aspectRatio: '3/4',
                background: '#1c1b1b',
                borderRadius: 12,
                position: 'relative',
                overflow: 'hidden',
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                {/* Centered icon */}
                <span className="material-symbols-outlined new-arrival-icon" style={{
                  fontSize: 80,
                  color: 'white',
                  opacity: 0.15,
                }}>
                  {game.icon}
                </span>

                {/* NEW badge */}
                <div style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  background: '#84d0f9',
                  color: '#002d40',
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: '0.15em',
                  padding: '3px 8px',
                  borderRadius: 4,
                  fontFamily: "'Space Grotesk', sans-serif",
                  textTransform: 'uppercase',
                }}>
                  NEW
                </div>
              </div>

              {/* Text */}
              <div className="arrival-title" style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: 16,
                fontWeight: 700,
                color: '#e5e2e1',
                marginBottom: 4,
              }}>
                {game.title}
              </div>
              <div style={{
                fontFamily: "'Manrope', sans-serif",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.15em',
                color: '#bfc8ce',
                textTransform: 'uppercase',
              }}>
                {CATEGORY_META[game.category].label}
              </div>
            </div>
          </NextLink>
        ))}
      </div>
    </section>
  );
}

// ─── Precision Network Section ────────────────────────────────────────────────

function PrecisionNetworkSection() {
  const activities = [
    { color: '#84d0f9', user: 'ARC_7742',   action: 'achieved rank S+ in Tilt Maze',   time: '2s ago'  },
    { color: '#3f484e', user: 'NEO_PRISM',  action: 'completed Reaction Chain x32',   time: '8s ago'  },
    { color: '#feb967', user: 'VXLR_09',   action: 'set new record — Steady Hand',    time: '15s ago' },
  ];

  return (
    <section className="section-mb" style={{ marginBottom: 96 }}>
      <div className="precision-pad" style={{
        background: '#1c1b1b',
        borderRadius: 20,
        padding: 40,
        border: '1px solid rgba(63,72,78,0.15)',
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 48,
        }} className="precision-network-layout">
          {/* Left column */}
          <div style={{ flex: 1 }} className="precision-left">
            <h2 className="section-h2" style={{
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 30,
              fontWeight: 700,
              color: '#e5e2e1',
              margin: '0 0 12px',
              letterSpacing: '-0.02em',
            }}>
              Precision Network
            </h2>
            <p style={{
              fontFamily: "'Manrope', sans-serif",
              fontSize: 14,
              color: '#bfc8ce',
              margin: '0 0 28px',
              lineHeight: 1.7,
              maxWidth: 380,
            }}>
              Join 4,200+ precision gamers competing in real-time. Track your performance, climb global leaderboards, and unlock exclusive achievements.
            </p>

            {/* Overlapping avatars */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 28 }}>
              {['#84d0f9', '#feb967', '#a855f7'].map((color, i) => (
                <div key={i} style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: color,
                  border: '2px solid #1c1b1b',
                  marginLeft: i > 0 ? -10 : 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  fontWeight: 700,
                  color: '#131313',
                  fontFamily: "'Space Grotesk', sans-serif",
                }}>
                  {['A', 'N', 'V'][i]}
                </div>
              ))}
              <div style={{
                marginLeft: 12,
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: 13,
                fontWeight: 600,
                color: '#84d0f9',
              }}>
                +4.2k players online
              </div>
            </div>

            <button className="precision-btn" style={{
              background: '#4a99c0',
              color: '#001d2a',
              fontFamily: "'Space Grotesk', sans-serif",
              fontWeight: 700,
              fontSize: 14,
              padding: '12px 28px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              letterSpacing: '0.05em',
              minHeight: 44,
            }}>
              JOIN UPLINK
            </button>
          </div>

          {/* Right column — live feed terminal */}
          <div style={{ flex: 1 }} className="precision-right">
            <div style={{
              background: '#0e0e0e',
              borderRadius: 12,
              padding: 24,
              border: '1px solid rgba(63,72,78,0.2)',
            }}>
              {/* Terminal header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <span style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.2em',
                  color: '#bfc8ce',
                  textTransform: 'uppercase',
                }}>
                  Live Feed
                </span>
                <span style={{
                  fontFamily: "'Manrope', sans-serif",
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#feb967',
                }}>
                  0.02ms Latency
                </span>
              </div>

              {/* Activity items */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {activities.map((item, i) => (
                  <div key={i} className={i >= 2 ? 'feed-item-hide' : ''} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{
                      width: 3,
                      height: 36,
                      borderRadius: 2,
                      background: item.color,
                      flexShrink: 0,
                      marginTop: 2,
                    }} />
                    <div>
                      <div style={{
                        fontFamily: "'Space Grotesk', sans-serif",
                        fontSize: 12,
                        fontWeight: 700,
                        color: '#e5e2e1',
                        marginBottom: 2,
                      }}>
                        {item.user}
                      </div>
                      <div style={{
                        fontFamily: "'Manrope', sans-serif",
                        fontSize: 11,
                        color: '#bfc8ce',
                      }}>
                        {item.action}
                      </div>
                    </div>
                    <div style={{
                      marginLeft: 'auto',
                      fontFamily: "'Manrope', sans-serif",
                      fontSize: 10,
                      color: 'rgba(191,200,206,0.5)',
                      flexShrink: 0,
                    }}>
                      {item.time}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── All Games Section ────────────────────────────────────────────────────────

function AllGamesSection() {
  return (
    <section className="section-mb" style={{ marginBottom: 96 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 className="section-h2" style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 30,
            fontWeight: 700,
            color: '#e5e2e1',
            margin: 0,
            letterSpacing: '-0.02em',
          }}>
            All Games
          </h2>
          <p style={{
            fontFamily: "'Manrope', sans-serif",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.15em',
            color: '#bfc8ce',
            textTransform: 'uppercase',
            margin: '4px 0 0',
          }}>
            {ALL_GAMES.length} Experiences Available
          </p>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: 16,
      }}>
        {ALL_GAMES.map(game => (
          <NextLink key={game.id} href={game.href} style={{ textDecoration: 'none' }}>
            <div className="all-game-card" style={{
              background: '#1c1b1b',
              borderRadius: 12,
              padding: 16,
              border: '1px solid rgba(63,72,78,0.12)',
              cursor: 'pointer',
              transition: 'background 0.2s, transform 0.2s',
            }}>
              {/* Icon area */}
              <div className="all-game-icon-area" style={{
                height: 80,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 12,
              }}>
                <span className="material-symbols-outlined" style={{
                  fontSize: 48,
                  color: 'white',
                  opacity: 0.2,
                }}>
                  {game.icon}
                </span>
              </div>

              {/* Title */}
              <div style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontSize: 13,
                fontWeight: 700,
                color: '#e5e2e1',
                marginBottom: 4,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {game.title}
              </div>

              {/* Category + duration */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{
                  fontFamily: "'Manrope', sans-serif",
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: '0.12em',
                  color: '#bfc8ce',
                  textTransform: 'uppercase',
                }}>
                  {CATEGORY_META[game.category].label}
                </span>
                <span style={{
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: 10,
                  color: 'rgba(191,200,206,0.5)',
                }}>
                  {game.duration}
                </span>
              </div>
            </div>
          </NextLink>
        ))}
      </div>
    </section>
  );
}

// ─── Bottom Nav Bar (mobile) ──────────────────────────────────────────────────

function BottomNavBar() {
  const items = [
    { icon: 'explore',       label: 'Discover', active: true  },
    { icon: 'video_library', label: 'Library',  active: false },
    { icon: 'emoji_events',  label: 'Rewards',  active: false },
  ];

  return (
    <nav className="bottom-nav" style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      background: 'rgba(28,27,27,0.7)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      borderTop: '1px solid rgba(63,72,78,0.1)',
      display: 'flex',
      zIndex: 50,
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {items.map(item => (
        <button key={item.label} style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '10px 0',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          gap: 4,
        }}>
          <span className="material-symbols-outlined" style={{
            fontSize: 22,
            color: item.active ? '#84d0f9' : '#bfc8ce',
          }}>
            {item.icon}
          </span>
          <span style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontSize: 10,
            fontWeight: item.active ? 700 : 400,
            color: item.active ? '#84d0f9' : '#bfc8ce',
            letterSpacing: '0.05em',
          }}>
            {item.label}
          </span>
        </button>
      ))}
    </nav>
  );
}

// ─── Floating Action Button ───────────────────────────────────────────────────

function FloatingActionButton() {
  return (
    <button className="fab" style={{
      position: 'fixed',
      bottom: 32,
      right: 32,
      width: 56,
      height: 56,
      borderRadius: '50%',
      background: 'linear-gradient(135deg, #84d0f9, #4a99c0)',
      border: 'none',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 4px 24px rgba(132,208,249,0.4)',
      zIndex: 45,
    }}>
      <span className="material-symbols-outlined" style={{ fontSize: 26, color: '#002d40' }}>play_arrow</span>
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Load play data for initial featured index
    try {
      const played: string[] = JSON.parse(localStorage.getItem('mg_played') || '[]');
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

  const handleDotClick = useCallback((i: number) => setFeaturedIndex(i), []);
  const featuredGame = FEATURED_GAMES[featuredIndex] ?? FEATURED_GAMES[0];

  return (
    <div style={{
      background: '#131313',
      minHeight: '100vh',
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.35s ease',
      fontFamily: "'Space Grotesk', sans-serif",
    }}>
      <TopNavBar />
      <SideNavBar />

      {/* Main canvas */}
      <main style={{
        paddingTop: 80,
        paddingBottom: 96,
        paddingLeft: 24,
        paddingRight: 24,
      }} className="main-canvas">
        {/* Inner content — constrained width */}
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          {/* Hero */}
          <div className="hero-mt" style={{ marginTop: 48 }}>
            <HeroSection
              game={featuredGame}
              index={featuredIndex}
              total={FEATURED_GAMES.length}
              onDotClick={handleDotClick}
            />
          </div>

          <NewArrivalsSection />
          <PrecisionNetworkSection />
          <AllGamesSection />
        </div>
      </main>

      <BottomNavBar />
      <FloatingActionButton />
    </div>
  );
}

