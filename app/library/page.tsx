'use client';

import { useEffect, useState } from 'react';
import type React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type Game,
  type GameCategory,
  type Industry,
  ALL_GAMES,
  CATEGORY_META,
  INDUSTRIES,
} from '@/lib/games';

// ─── Filter config ────────────────────────────────────────────────────────────

type FilterKey = 'All' | 'Skill' | 'Sports' | 'Holiday' | 'Brain' | 'Breath';

const FILTERS: FilterKey[] = ['All', 'Skill', 'Sports', 'Holiday', 'Brain', 'Breath'];

const FILTER_TO_CATEGORY: Record<FilterKey, GameCategory | null> = {
  All:     null,
  Skill:   'skill',
  Sports:  'sports',
  Holiday: 'holiday',
  Brain:   'cognitive',
  Breath:  'breath',
};

// ─── TopNavBar ────────────────────────────────────────────────────────────────

function TopNavBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();

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
        <NextLink href="/" style={{ textDecoration: 'none' }}>
          <div style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 700,
            fontSize: 18,
            letterSpacing: '0.15em',
            color: '#84d0f9',
            textTransform: 'uppercase',
            flexShrink: 0,
            cursor: 'pointer',
          }}>
            GLIMMERS
          </div>
        </NextLink>

        {/* Nav links — center (hidden on mobile) */}
        <nav className="hidden md:flex top-nav-links" style={{ gap: 32, flex: 1, justifyContent: 'center' }}>
          {[
            { label: 'Discover',  active: false, href: '/'        },
            { label: 'Library',   active: true,  href: '/library' },
            { label: 'Community', active: false, href: '#'        },
          ].map(item => (
            <NextLink key={item.label} href={item.href} style={{ textDecoration: 'none' }}>
              <button style={{
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
            </NextLink>
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
          { label: 'Discover',     icon: 'explore',        active: false, href: '/'        },
          { label: 'Library',      icon: 'sports_esports', active: true,  href: '/library' },
          { label: 'Achievements', icon: 'military_tech',  active: false, href: '#'        },
          { label: 'Community',    icon: 'groups',         active: false, href: '#'        },
        ].map(item => (
          <NextLink key={item.label} href={item.href} style={{ textDecoration: 'none' }}>
            <button onClick={() => setMenuOpen(false)} style={{
              display: 'flex', alignItems: 'center', gap: 14, width: '100%',
              padding: '14px 20px', background: item.active ? '#201f1f' : 'none', border: 'none',
              color: item.active ? '#84d0f9' : '#bfc8ce', cursor: 'pointer',
              fontFamily: "'Manrope',sans-serif", fontSize: 11, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.1em',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>{item.icon}</span>
              {item.label}
            </button>
          </NextLink>
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
    { icon: 'explore',       label: 'Discover',     active: false, href: '/'        },
    { icon: 'video_library', label: 'Library',      active: true,  href: '/library' },
    { icon: 'emoji_events',  label: 'Achievements', active: false, href: '#'        },
    { icon: 'group',         label: 'Community',    active: false, href: '#'        },
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
          <NextLink key={item.label} href={item.href} style={{ textDecoration: 'none' }}>
            <button style={{
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
          </NextLink>
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

// ─── BottomNavBar ─────────────────────────────────────────────────────────────

function BottomNavBar() {
  const router = useRouter();
  const items = [
    { icon: 'explore',       label: 'Discover', active: false, onClick: () => router.push('/')        },
    { icon: 'video_library', label: 'Library',  active: true,  onClick: () => router.push('/library') },
    { icon: 'emoji_events',  label: 'Rewards',  active: false, onClick: () => {}                      },
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
        <button key={item.label} onClick={item.onClick} style={{
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

// ─── GameCard ─────────────────────────────────────────────────────────────────

function GameCard({ game, played }: { game: Game; played: boolean }) {
  const category = CATEGORY_META[game.category].label;

  return (
    <NextLink href={game.href} style={{ textDecoration: 'none' }}>
      <div style={{
        background: '#1c1b1b',
        borderRadius: 8,
        overflow: 'hidden',
        cursor: 'pointer',
      }}>
        {/* Square thumbnail area */}
        <div style={{
          aspectRatio: '1',
          background: '#111115',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 56, color: 'white', opacity: 0.12 }}>
            {game.icon}
          </span>

          {/* Category chip top-left */}
          <div style={{
            position: 'absolute', top: 8, left: 8,
            background: '#201f1f', color: '#bfc8ce',
            fontSize: 8, fontWeight: 700,
            padding: '3px 8px', borderRadius: 2,
            textTransform: 'uppercase', letterSpacing: '0.1em',
            fontFamily: "'Manrope',sans-serif",
          }}>
            {category}
          </div>

          {/* Played badge top-right */}
          {played && (
            <div style={{
              position: 'absolute', top: 8, right: 8,
              background: 'rgba(132,208,249,0.15)', color: '#84d0f9',
              fontSize: 8, fontWeight: 700,
              padding: '3px 8px', borderRadius: 2,
              textTransform: 'uppercase', letterSpacing: '0.1em',
              border: '1px solid rgba(132,208,249,0.2)',
              fontFamily: "'Manrope',sans-serif",
            }}>
              PLAYED
            </div>
          )}
        </div>

        {/* Info below */}
        <div style={{ padding: '12px 12px 14px' }}>
          <div style={{
            color: '#e5e2e1', fontWeight: 700, fontSize: 14,
            fontFamily: "'Space Grotesk',sans-serif", marginBottom: 2,
          }}>
            {game.title}
          </div>
          <div style={{
            color: 'rgba(191,200,206,0.6)', fontSize: 10, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.1em',
            fontFamily: "'Manrope',sans-serif",
          }}>
            {game.duration} · {category}
          </div>
        </div>
      </div>
    </NextLink>
  );
}

// ─── Library Page ─────────────────────────────────────────────────────────────

export default function LibraryPage() {
  const [activeFilter, setActiveFilter] = useState<FilterKey>('All');
  const [selectedIndustry, setSelectedIndustry] = useState<Industry | null>(null);
  const [playedIds, setPlayedIds] = useState<string[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('mg_played') || '[]');
      if (Array.isArray(stored)) setPlayedIds(stored);
    } catch { /* ignore */ }
    setTimeout(() => setVisible(true), 30);
  }, []);

  const filteredGames = ALL_GAMES.filter(game => {
    const targetCat = FILTER_TO_CATEGORY[activeFilter];
    const categoryOk = targetCat === null || game.category === targetCat;
    const industryOk = selectedIndustry === null || game.industries.includes(selectedIndustry);
    return categoryOk && industryOk;
  });

  const gamesPlayed = ALL_GAMES.filter(g => playedIds.includes(g.id)).length;

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

      <main style={{
        paddingTop: 80,
        paddingBottom: 96,
        paddingLeft: 24,
        paddingRight: 24,
      }} className="main-canvas">
        <div style={{ maxWidth: 1200, margin: '0 auto', paddingTop: 32 }}>

          {/* Stats header */}
          <div style={{ marginBottom: 32 }}>
            <h1 style={{
              color: '#e5e2e1',
              fontSize: 'clamp(2rem,5vw,3rem)',
              fontWeight: 900,
              fontFamily: "'Space Grotesk',sans-serif",
              letterSpacing: '-0.03em',
              margin: '0 0 4px',
            }}>
              Library
            </h1>
            <p style={{ color: '#bfc8ce', fontSize: 13, fontFamily: "'Manrope',sans-serif", margin: 0 }}>
              {filteredGames.length} experiences · {gamesPlayed} played
            </p>
          </div>

          {/* Category filter pills */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {FILTERS.map(f => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                style={{
                  background: activeFilter === f ? '#84d0f9' : '#201f1f',
                  color: activeFilter === f ? '#003549' : '#bfc8ce',
                  border: 'none',
                  borderRadius: 4,
                  padding: '8px 16px',
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: "'Manrope',sans-serif",
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  cursor: 'pointer',
                  transition: 'background 0.2s, color 0.2s',
                }}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Industry filter pills */}
          <div style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            marginBottom: 24,
            paddingBottom: 4,
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          } as React.CSSProperties}>
            {INDUSTRIES.map(ind => (
              <button
                key={ind.id}
                onClick={() => setSelectedIndustry(selectedIndustry === ind.id ? null : ind.id)}
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  background: selectedIndustry === ind.id ? 'rgba(132,208,249,0.15)' : 'transparent',
                  color: selectedIndustry === ind.id ? '#84d0f9' : 'rgba(191,200,206,0.5)',
                  border: selectedIndustry === ind.id ? '1px solid rgba(132,208,249,0.3)' : '1px solid rgba(63,72,78,0.2)',
                  borderRadius: 4,
                  padding: '6px 12px',
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: "'Manrope',sans-serif",
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.2s ease',
                }}
              >
                <span style={{ fontSize: 12 }}>{ind.icon}</span>
                {ind.label}
              </button>
            ))}
          </div>

          {/* Game grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 16,
          }} className="library-grid">
            {filteredGames.map(game => (
              <GameCard
                key={game.id}
                game={game}
                played={playedIds.includes(game.id)}
              />
            ))}
          </div>

        </div>
      </main>

      <BottomNavBar />
    </div>
  );
}
