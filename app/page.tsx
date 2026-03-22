'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import type React from 'react';
import {
  type Game,
  type GameCategory,
  type Industry,
  ALL_GAMES,
  FEATURED_GAMES,
  NEW_ARRIVALS,
  CATEGORY_META,
  INDUSTRIES,
} from '@/lib/games';
import { getGlobalStats, type GlobalStats } from '@/lib/gameStorage';

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
            { label: 'Discover', active: true,  href: '/'         },
            { label: 'Library',  active: false, href: '/library'  },
            { label: 'Community', active: false, href: '#'         },
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
          { label: 'Discover',     icon: 'explore',        active: true,  href: '/'        },
          { label: 'Library',      icon: 'sports_esports', active: false, href: '/library' },
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
    { icon: 'explore',          label: 'Discover',     active: true,  href: '/'        },
    { icon: 'video_library',    label: 'Library',      active: false, href: '/library' },
    { icon: 'emoji_events',     label: 'Achievements', active: false, href: '#'        },
    { icon: 'group',            label: 'Community',    active: false, href: '#'        },
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

// ─── Hero Section ─────────────────────────────────────────────────────────────

// ─── Brand Analyzer Section ────────────────────────────────────────────────

interface BrandResult {
  companyName: string;
  primaryColor: string;
  ogImage: string | null;
  industry: string;
}

const INDUSTRY_LABELS: Record<string, string> = {
  cpg: 'CPG', food_bev: 'Food & Bev', sports: 'Sports', technology: 'Technology',
  healthcare: 'Healthcare', finance: 'Finance', retail: 'Retail', automotive: 'Automotive',
};

function BrandAnalyzerSection() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BrandResult | null>(null);
  const [error, setError] = useState('');

  const analyze = async () => {
    if (!url.trim()) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await fetch(`/api/analyze-brand?url=${encodeURIComponent(url.trim())}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
    } catch { setError('Could not analyze that URL. Try another.'); }
    finally { setLoading(false); }
  };

  const suggested = result
    ? ALL_GAMES.filter(g => (g as Game & { industries?: string[] }).industries?.includes(result.industry)).slice(0, 6)
    : [];

  return (
    <section style={{ padding: '32px 16px 28px', borderBottom: '1px solid rgba(63,72,78,0.12)', marginTop: 72 }}>
      <div style={{ maxWidth: 520 }}>
        <p style={{ color: '#bfc8ce', fontSize: 10, fontWeight: 700, fontFamily: "'Manrope',sans-serif", textTransform: 'uppercase', letterSpacing: '0.18em', margin: '0 0 8px' }}>
          Try It For Your Brand
        </p>
        <h2 style={{ color: '#e5e2e1', fontSize: 'clamp(1.3rem,4vw,1.75rem)', fontWeight: 900, fontFamily: "'Space Grotesk',sans-serif", letterSpacing: '-0.03em', margin: '0 0 20px', lineHeight: 1.2 }}>
          See Glimmers in your brand colors
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && analyze()}
            placeholder="yourbrand.com"
            style={{ flex: 1, background: '#201f1f', border: '1px solid rgba(63,72,78,0.4)', borderRadius: 6, padding: '12px 14px', color: '#e5e2e1', fontSize: 14, fontFamily: "'Manrope',sans-serif", outline: 'none' }}
          />
          <button onClick={analyze} disabled={loading} style={{ background: loading ? '#2a2a2a' : 'linear-gradient(135deg,#84d0f9,#4a99c0)', color: loading ? '#bfc8ce' : '#003549', border: 'none', borderRadius: 6, padding: '12px 18px', fontWeight: 700, fontSize: 13, fontFamily: "'Space Grotesk',sans-serif", cursor: loading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
            {loading ? 'Analyzing…' : 'Analyze →'}
          </button>
        </div>
        {error && <p style={{ color: '#feb967', fontSize: 12, marginTop: 8, fontFamily: "'Manrope',sans-serif" }}>{error}</p>}
      </div>

      {result && (
        <div style={{ marginTop: 24 }}>
          {/* Brand card */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: '#1c1b1b', borderRadius: 8, border: `1px solid ${result.primaryColor}44`, marginBottom: 20, maxWidth: 420 }}>
            {result.ogImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={result.ogImage} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            )}
            <div style={{ width: 14, height: 14, borderRadius: '50%', background: result.primaryColor, flexShrink: 0 }} />
            <div>
              <div style={{ color: '#e5e2e1', fontWeight: 700, fontSize: 14, fontFamily: "'Space Grotesk',sans-serif" }}>{result.companyName}</div>
              <div style={{ color: '#bfc8ce', fontSize: 10, fontFamily: "'Manrope',sans-serif", textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>
                {INDUSTRY_LABELS[result.industry] ?? result.industry} · {result.primaryColor}
              </div>
            </div>
          </div>

          {/* Suggested games */}
          {suggested.length > 0 && (
            <>
              <p style={{ color: '#bfc8ce', fontSize: 10, fontWeight: 700, fontFamily: "'Manrope',sans-serif", textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 12, padding: '0 0 0 0' }}>
                Recommended for {result.companyName}
              </p>
              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'none' } as React.CSSProperties}>
                {suggested.map(game => (
                  <NextLink key={game.id} href={`${game.href}?brandName=${encodeURIComponent(result.companyName)}&brandColor=${encodeURIComponent(result.primaryColor)}`} style={{ textDecoration: 'none', flexShrink: 0 }}>
                    <div style={{ width: 140, background: '#1c1b1b', borderRadius: 8, overflow: 'hidden', border: `1px solid ${result.primaryColor}33` }}>
                      <div style={{ height: 68, background: '#111115', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: 32, color: result.primaryColor, opacity: 0.8 }}>{game.icon}</span>
                      </div>
                      <div style={{ padding: '10px 12px' }}>
                        <div style={{ color: '#e5e2e1', fontSize: 12, fontWeight: 700, fontFamily: "'Space Grotesk',sans-serif", marginBottom: 4 }}>{game.title}</div>
                        <div style={{ color: result.primaryColor, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: "'Manrope',sans-serif" }}>Preview →</div>
                      </div>
                    </div>
                  </NextLink>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
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
          <NextLink href={`/qa?game=${game.id}`} style={{ textDecoration: 'none' }}>
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
          </NextLink>
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

// ─── Industry Game Card ───────────────────────────────────────────────────────

function IndustryGameCard({ game }: { game: Game }) {
  return (
    <NextLink href={game.href} style={{ textDecoration: 'none', flexShrink: 0 }}>
      <div style={{
        width: 'clamp(160px, 42vw, 200px)',
        background: '#1c1b1b',
        borderRadius: 8,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          height: 80,
          background: '#111115',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}>
          <span className="material-symbols-outlined" style={{
            fontSize: 36,
            color: game.accentColor,
            opacity: 0.6,
          }}>
            {game.icon}
          </span>
        </div>
        <div style={{ padding: '10px 12px' }}>
          <div style={{
            color: '#e5e2e1',
            fontWeight: 700,
            fontSize: 13,
            fontFamily: "'Space Grotesk',sans-serif",
          }}>
            {game.title}
          </div>
          <div style={{
            color: 'rgba(191,200,206,0.6)',
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontFamily: "'Manrope',sans-serif",
            marginTop: 2,
          }}>
            {game.duration}
          </div>
        </div>
      </div>
    </NextLink>
  );
}

// ─── Browse by Industry Section ───────────────────────────────────────────────

function BrowseByIndustrySection() {
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const industryGames = selectedIndustry
    ? ALL_GAMES.filter(g => g.industries.includes(selectedIndustry as Industry))
    : [];

  return (
    <section style={{ marginBottom: 40, paddingTop: 8 }}>
      <div style={{
        padding: '0 16px',
        marginBottom: 14,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <h2 style={{
            color: '#e5e2e1',
            fontSize: 18,
            fontWeight: 700,
            fontFamily: "'Space Grotesk',sans-serif",
            margin: 0,
          }}>
            Browse by Industry
          </h2>
          <p style={{
            color: '#bfc8ce',
            fontSize: 11,
            fontFamily: "'Manrope',sans-serif",
            margin: '2px 0 0',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}>
            Find the right experience for your audience
          </p>
        </div>
      </div>

      {/* Industry pill row */}
      <div style={{
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        padding: '0 16px 4px',
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
              gap: 6,
              background: selectedIndustry === ind.id ? '#84d0f9' : '#201f1f',
              color: selectedIndustry === ind.id ? '#003549' : '#bfc8ce',
              border: 'none',
              borderRadius: 4,
              padding: '10px 16px',
              fontSize: 12,
              fontWeight: 700,
              fontFamily: "'Manrope',sans-serif",
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.2s ease',
            }}
          >
            <span>{ind.icon}</span>
            {ind.label}
          </button>
        ))}
      </div>

      {/* Industry games row */}
      {selectedIndustry && (
        <div style={{ marginTop: 16 }}>
          <div style={{
            padding: '0 16px',
            marginBottom: 10,
            color: '#bfc8ce',
            fontSize: 11,
            fontFamily: "'Manrope',sans-serif",
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}>
            {industryGames.length} experiences for {INDUSTRIES.find(i => i.id === selectedIndustry)?.label}
          </div>
          <div style={{
            display: 'flex',
            gap: 12,
            overflowX: 'auto',
            padding: '0 16px 8px',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          } as React.CSSProperties}>
            {industryGames.map(game => (
              <IndustryGameCard key={game.id} game={game} />
            ))}
          </div>
        </div>
      )}
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
        paddingLeft: 16,
      }}>
        New Arrivals
      </h2>

      {/* Horizontal scroll with fade edges */}
      <div style={{ position: 'relative' }}>
        <div
          className="new-arrivals-row"
          style={{
            display: 'flex',
            gap: 12,
            overflowX: 'auto',
            paddingLeft: 16,
            paddingRight: 16,
            paddingBottom: 8,
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            WebkitOverflowScrolling: 'touch',
          } as React.CSSProperties}
        >
          {NEW_ARRIVALS.map(game => (
            <NextLink key={game.id} href={game.href} style={{ textDecoration: 'none', flexShrink: 0 }}>
              <div className="new-arrival-card" style={{
                flexShrink: 0,
                width: 'clamp(140px, 38vw, 180px)',
              }}>
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
                  marginBottom: 8,
                }}>
                  {CATEGORY_META[game.category].label}
                </div>
                <NextLink href={`/qa?game=${game.id}`} onClick={(e) => e.stopPropagation()} style={{ textDecoration: 'none', display: 'block' }}>
                  <div style={{
                    background: 'rgba(132,208,249,0.07)',
                    border: '1px solid rgba(132,208,249,0.15)',
                    borderRadius: 4,
                    padding: '5px 0',
                    textAlign: 'center',
                    color: '#84d0f9',
                    fontSize: 9,
                    fontWeight: 700,
                    fontFamily: "'Manrope', sans-serif",
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                  }}>
                    VIEW INTEL
                  </div>
                </NextLink>
              </div>
            </NextLink>
          ))}
        </div>
        {/* Right fade */}
        <div style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 8,
          width: 48,
          background: 'linear-gradient(to left, #131313, transparent)',
          pointerEvents: 'none',
        }} />
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
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

              {/* Intel button */}
              <NextLink href={`/qa?game=${game.id}`} onClick={(e) => e.stopPropagation()} style={{ textDecoration: 'none', display: 'block' }}>
                <div style={{
                  background: 'rgba(132,208,249,0.07)',
                  border: '1px solid rgba(132,208,249,0.15)',
                  borderRadius: 4,
                  padding: '5px 0',
                  textAlign: 'center',
                  color: '#84d0f9',
                  fontSize: 9,
                  fontWeight: 700,
                  fontFamily: "'Manrope', sans-serif",
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                }}>
                  VIEW INTEL
                </div>
              </NextLink>
            </div>
          </NextLink>
        ))}
      </div>
    </section>
  );
}

// ─── Bottom Nav Bar (mobile) ──────────────────────────────────────────────────

function BottomNavBar() {
  const router = useRouter();
  const items = [
    { icon: 'explore',       label: 'Discover', active: true,  onClick: () => router.push('/')        },
    { icon: 'video_library', label: 'Library',  active: false, onClick: () => router.push('/library') },
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
  const [returnStats, setReturnStats] = useState<GlobalStats | null>(null);

  useEffect(() => {
    // Load play data for initial featured index
    try {
      const played: string[] = JSON.parse(localStorage.getItem('mg_played') || '[]');
      const firstUnplayed = FEATURED_GAMES.findIndex((g) => !played.includes(g.id));
      if (firstUnplayed !== -1) setFeaturedIndex(firstUnplayed);
    } catch { /* ignore */ }

    // Load return-user stats
    const s = getGlobalStats();
    if (s.totalGamesPlayed > 0) setReturnStats(s);

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
          {/* Brand Analyzer */}
          <BrandAnalyzerSection />

          {/* Hero */}
          <div className="hero-mt" style={{ marginTop: 48 }}>
            <HeroSection
              game={featuredGame}
              index={featuredIndex}
              total={FEATURED_GAMES.length}
              onDotClick={handleDotClick}
            />
          </div>

          {/* Return-user stats banner */}
          {returnStats && returnStats.totalGamesPlayed > 0 && (
            <div style={{ padding: '12px 16px', background: '#1c1b1b', borderRadius: 8, border: '1px solid rgba(63,72,78,0.1)', margin: '16px 0 0', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <div>
                <div style={{ color: '#84d0f9', fontWeight: 900, fontSize: 22, fontFamily: "'Space Grotesk',sans-serif" }}>{returnStats.totalGamesPlayed}</div>
                <div style={{ color: '#bfc8ce', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.12em', fontFamily: "'Manrope',sans-serif" }}>Games Played</div>
              </div>
              {returnStats.favoritGame && (
                <div>
                  <div style={{ color: '#feb967', fontWeight: 900, fontSize: 22, fontFamily: "'Space Grotesk',sans-serif" }}>{ALL_GAMES.find(g => g.id === returnStats.favoritGame)?.title ?? '—'}</div>
                  <div style={{ color: '#bfc8ce', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.12em', fontFamily: "'Manrope',sans-serif" }}>Favourite Game</div>
                </div>
              )}
              <div>
                <div style={{ color: '#e5e2e1', fontWeight: 900, fontSize: 22, fontFamily: "'Space Grotesk',sans-serif" }}>{returnStats.lastActiveAt ? new Date(returnStats.lastActiveAt).toLocaleDateString('en', { month: 'short', day: 'numeric' }) : '—'}</div>
                <div style={{ color: '#bfc8ce', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.12em', fontFamily: "'Manrope',sans-serif" }}>Last Active</div>
              </div>
            </div>
          )}

          <BrowseByIndustrySection />

          <NewArrivalsSection />

          <AllGamesSection />
        </div>
      </main>

      <BottomNavBar />
      <FloatingActionButton />
    </div>
  );
}

