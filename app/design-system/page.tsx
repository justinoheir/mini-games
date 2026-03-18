'use client';

import React, { useEffect } from 'react';

// ─── DESIGN TOKENS (hardcoded for documentation) ─────────────────────────────
const BG_BASE      = '#08090f';
const BG_SURFACE   = '#0d1520';
const BG_ELEVATED  = '#111c2d';
const BG_OVERLAY   = 'rgba(13, 21, 32, 0.85)';

const BORDER        = '#1a2535';
const BORDER_SUBTLE = '#0f1a28';
const BORDER_STRONG = '#243548';

const ACCENT       = '#5b9fc0';
const ACCENT_HOVER = '#6fb3d4';
const ACCENT_DIM   = 'rgba(91, 159, 192, 0.15)';
const ACCENT_GLOW  = 'rgba(91, 159, 192, 0.30)';

const SUCCESS     = '#22c55e';
const SUCCESS_DIM = 'rgba(34, 197, 94, 0.15)';
const ERROR       = '#ef4444';
const ERROR_DIM   = 'rgba(239, 68, 68, 0.15)';
const WARNING     = '#f59e0b';
const WARNING_DIM = 'rgba(245, 158, 11, 0.15)';

const TEXT_PRIMARY   = '#e2e8f0';
const TEXT_SECONDARY = '#94a3b8';
const TEXT_MUTED     = '#64748b';

const GLASS_BG     = 'rgba(13, 21, 32, 0.7)';
const GLASS_BORDER = 'rgba(91, 159, 192, 0.12)';

const FONT = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface Swatch {
  name: string;
  hex: string;
  label: string;
}

interface SwatchGroup {
  group: string;
  swatches: Swatch[];
}

interface WeightVariant {
  weight: number;
  sample: string;
}

interface SpaceToken {
  token: string;
  px: number;
}

interface MetricCard {
  label: string;
  value: string;
  delta: string;
  positive: boolean;
  sub: string;
}

interface BadgeSpec {
  label: string;
  bg: string;
  color: string;
}

interface TimingToken {
  token: string;
  ms: number;
  display?: string;
}

interface EasingSpec {
  name: string;
  value: string;
  desc: string;
}

interface AntiPattern {
  bad: { label: string; ex: string };
  good: { label: string; ex: string };
}

interface VoiceRule {
  rule: string;
  bad: string;
  good: string;
}

// ─── DATA ────────────────────────────────────────────────────────────────────
const SWATCH_GROUPS: SwatchGroup[] = [
  {
    group: 'Backgrounds',
    swatches: [
      { name: '--color-bg-base',     hex: BG_BASE,    label: 'bg-base'     },
      { name: '--color-bg-surface',  hex: BG_SURFACE, label: 'bg-surface'  },
      { name: '--color-bg-elevated', hex: BG_ELEVATED,label: 'bg-elevated' },
      { name: '--color-bg-overlay',  hex: BG_OVERLAY, label: 'bg-overlay'  },
    ],
  },
  {
    group: 'Borders',
    swatches: [
      { name: '--color-border',        hex: BORDER,        label: 'border'        },
      { name: '--color-border-subtle', hex: BORDER_SUBTLE, label: 'border-subtle' },
      { name: '--color-border-strong', hex: BORDER_STRONG, label: 'border-strong' },
    ],
  },
  {
    group: 'Accent',
    swatches: [
      { name: '--color-accent',      hex: ACCENT,      label: 'accent'      },
      { name: '--color-accent-hover',hex: ACCENT_HOVER, label: 'accent-hover'},
      { name: '--color-accent-dim',  hex: ACCENT_DIM,  label: 'accent-dim'  },
      { name: '--color-accent-glow', hex: ACCENT_GLOW, label: 'accent-glow' },
    ],
  },
  {
    group: 'Semantic',
    swatches: [
      { name: '--color-success',     hex: SUCCESS,     label: 'success'     },
      { name: '--color-success-dim', hex: SUCCESS_DIM, label: 'success-dim' },
      { name: '--color-error',       hex: ERROR,       label: 'error'       },
      { name: '--color-error-dim',   hex: ERROR_DIM,   label: 'error-dim'   },
      { name: '--color-warning',     hex: WARNING,     label: 'warning'     },
      { name: '--color-warning-dim', hex: WARNING_DIM, label: 'warning-dim' },
    ],
  },
  {
    group: 'Text',
    swatches: [
      { name: '--color-text-primary',   hex: TEXT_PRIMARY,   label: 'text-primary'   },
      { name: '--color-text-secondary', hex: TEXT_SECONDARY, label: 'text-secondary' },
      { name: '--color-text-muted',     hex: TEXT_MUTED,     label: 'text-muted'     },
      { name: '--color-text-accent',    hex: ACCENT,         label: 'text-accent'    },
    ],
  },
  {
    group: 'Glass',
    swatches: [
      { name: '--glass-bg',     hex: GLASS_BG,     label: 'glass-bg'     },
      { name: '--glass-border', hex: GLASS_BORDER, label: 'glass-border' },
    ],
  },
];

const TYPE_SCALE: Array<{ name: string; size: string; sample: string }> = [
  { name: 'text-xs',   size: '11px', sample: 'Timestamps & badges'        },
  { name: 'text-sm',   size: '13px', sample: 'Captions & labels'           },
  { name: 'text-base', size: '15px', sample: 'Body copy and UI text'       },
  { name: 'text-lg',   size: '17px', sample: 'Lead text and highlights'    },
  { name: 'text-xl',   size: '20px', sample: 'Section headers'             },
  { name: 'text-2xl',  size: '24px', sample: 'Card titles'                 },
  { name: 'text-3xl',  size: '30px', sample: 'Page titles'                 },
  { name: 'text-4xl',  size: '36px', sample: 'Hero subtitles'              },
  { name: 'text-5xl',  size: '48px', sample: 'Hero headlines'              },
  { name: 'text-6xl',  size: '64px', sample: 'Display'                     },
];

const WEIGHT_VARIANTS: WeightVariant[] = [
  { weight: 300, sample: 'Light — supporting text, descriptions'      },
  { weight: 400, sample: 'Regular — body copy and UI labels'          },
  { weight: 500, sample: 'Medium — button text, active states'        },
  { weight: 600, sample: 'SemiBold — card titles, nav items'          },
  { weight: 700, sample: 'Bold — headings, metrics, key data'         },
];

const SPACE_TOKENS: SpaceToken[] = [
  { token: '--space-1',  px: 4  },
  { token: '--space-2',  px: 8  },
  { token: '--space-3',  px: 12 },
  { token: '--space-4',  px: 16 },
  { token: '--space-5',  px: 20 },
  { token: '--space-6',  px: 24 },
  { token: '--space-8',  px: 32 },
  { token: '--space-10', px: 40 },
  { token: '--space-12', px: 48 },
  { token: '--space-16', px: 64 },
  { token: '--space-20', px: 80 },
  { token: '--space-24', px: 96 },
];

const BADGE_SPECS: BadgeSpec[] = [
  { label: 'success', bg: SUCCESS_DIM, color: SUCCESS  },
  { label: 'error',   bg: ERROR_DIM,   color: ERROR    },
  { label: 'warning', bg: WARNING_DIM, color: WARNING  },
  { label: 'info',    bg: ACCENT_DIM,  color: ACCENT   },
  { label: 'neutral', bg: 'rgba(100, 116, 139, 0.15)', color: TEXT_MUTED },
];

const METRIC_CARDS: MetricCard[] = [
  { label: 'Sales Lift',   value: '8×',   delta: '+700%', positive: true,  sub: 'Kraft Heinz' },
  { label: 'Data Quality', value: '83%',  delta: '+83%',  positive: true,  sub: 'RBC Bank'    },
  { label: 'Brand Power',  value: '+7pts',delta: '+7pts', positive: true,  sub: 'Budweiser'   },
];

const TIMING_TOKENS: TimingToken[] = [
  { token: '--duration-instant', ms: 100  },
  { token: '--duration-fast',    ms: 150  },
  { token: '--duration-base',    ms: 200  },
  { token: '--duration-slow',    ms: 300  },
  { token: '--duration-slower',  ms: 400  },
  { token: '--duration-aurora',  ms: 10000, display: '10s' },
];

const EASING_SPECS: EasingSpec[] = [
  { name: '--ease-default', value: 'cubic-bezier(0.4, 0, 0.2, 1)',    desc: 'Standard transitions'        },
  { name: '--ease-in',      value: 'cubic-bezier(0.4, 0, 1, 1)',      desc: 'Element exits'               },
  { name: '--ease-out',     value: 'cubic-bezier(0, 0, 0.2, 1)',      desc: 'Element entrances'           },
  { name: '--ease-spring',  value: 'cubic-bezier(0.34, 1.56, 0.64, 1)', desc: 'Bouncy reveals, score pops'},
  { name: '--ease-snap',    value: 'cubic-bezier(0.2, 0, 0, 1)',      desc: 'Snappy tab switches'         },
];

const ANTI_PATTERNS: AntiPattern[] = [
  {
    bad:  { label: 'AI purple/pink blob gradients', ex: "background: #6366F1 (purple blobs)" },
    good: { label: 'Aurora in Ether blues/greens',  ex: "rgba(91, 159, 192, 0.15)" },
  },
  {
    bad:  { label: 'Hard black background', ex: "background: #000000" },
    good: { label: 'Ether base — depth matters', ex: "background: #08090f" },
  },
  {
    bad:  { label: 'Generic gray text color', ex: "color: #888888" },
    good: { label: 'Use the muted text token', ex: "color: #64748b (--color-text-muted)" },
  },
  {
    bad:  { label: 'System sans-serif fonts', ex: "font-family: sans-serif" },
    good: { label: 'Space Grotesk always', ex: "font-family: 'Space Grotesk', sans-serif" },
  },
  {
    bad:  { label: 'Linear easing', ex: "transition: all 200ms linear" },
    good: { label: 'cubic-bezier always', ex: "cubic-bezier(0.4, 0, 0.2, 1)" },
  },
  {
    bad:  { label: 'Dark mode toggle', ex: '"Switch to light mode" option' },
    good: { label: 'Dark is the only mode', ex: "Always: background: #08090f" },
  },
];

const VOICE_RULES: VoiceRule[] = [
  {
    rule: 'Numbers first. Period.',
    bad:  'Our platform significantly improves sales performance.',
    good: '8× sales lift. Measured. Repeatable.',
  },
  {
    rule: 'Certain, not arrogant.',
    bad:  'We think you should consider trying to measure your events.',
    good: 'Measure everything.',
  },
  {
    rule: 'Active voice.',
    bad:  'Emotion is captured by Ether at every touchpoint.',
    good: 'Ether captures emotion at every touchpoint.',
  },
  {
    rule: 'No AI slop. Ever.',
    bad:  'Unlock the power of seamlessly leveraging our cutting-edge platform.',
    good: 'Run a Glimmer. Get your data.',
  },
  {
    rule: 'Microcopy: direct.',
    bad:  "Oops! Looks like something went wrong! 🎉",
    good: "That didn't work. Try again.",
  },
  {
    rule: 'Empty states: action-driven.',
    bad:  "Looks like there's nothing here yet!",
    good: 'Nothing here yet. Run a Glimmer.',
  },
];

const NAV_ITEMS: Array<{ href: string; label: string }> = [
  { href: '#colors',       label: 'Colors'        },
  { href: '#typography',   label: 'Typography'    },
  { href: '#spacing',      label: 'Spacing'       },
  { href: '#components',   label: 'Components'    },
  { href: '#motion',       label: 'Motion'        },
  { href: '#antipatterns', label: 'Anti-Patterns' },
  { href: '#voice',        label: 'Voice'         },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function SectionHeader({ label, title }: { label: string; title: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 16,
      marginBottom: 32, paddingBottom: 16,
      borderBottom: `1px solid ${BORDER}`,
    }}>
      <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, color: ACCENT, opacity: 0.5 }}>
        {label}
      </span>
      <h2 style={{
        margin: 0, fontSize: 28, fontWeight: 700,
        color: TEXT_PRIMARY, letterSpacing: '-0.02em',
        fontFamily: FONT,
      }}>
        {title}
      </h2>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      margin: '0 0 12px',
      fontSize: 11, fontWeight: 600, letterSpacing: '0.1em',
      textTransform: 'uppercase' as const, color: TEXT_MUTED,
      fontFamily: FONT,
    }}>
      {children}
    </p>
  );
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────
export default function DesignSystemPage() {
  useEffect(() => {
    document.title = 'Ether Design System';
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');

        html { scroll-behavior: smooth; }

        @keyframes auroraFloat {
          0%   { opacity: 0.55; transform: scale(1.00) translate(0%,    0%  ); }
          25%  { opacity: 0.75; transform: scale(1.04) translate(1.5%,  -1%  ); }
          50%  { opacity: 0.60; transform: scale(0.97) translate(-1%,   1.5%); }
          75%  { opacity: 0.80; transform: scale(1.03) translate(-1.5%, -0.5%); }
          100% { opacity: 0.55; transform: scale(1.00) translate(0%,    0%  ); }
        }

        @keyframes dsSlideUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: 0.01ms !important;
            transition-duration: 0.01ms !important;
          }
        }

        ::-webkit-scrollbar            { width: 6px; }
        ::-webkit-scrollbar-track      { background: #08090f; }
        ::-webkit-scrollbar-thumb      { background: #1a2535; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover{ background: #243548; }

        .ds-nav-link {
          color: #94a3b8;
          text-decoration: none;
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          padding: 16px 12px;
          transition: color 150ms cubic-bezier(0, 0, 0.2, 1);
          display: block;
        }
        .ds-nav-link:hover { color: #5b9fc0; }

        .ds-btn-primary {
          background: #5b9fc0;
          color: #ffffff;
          padding: 12px 24px;
          border-radius: 8px;
          font-family: 'Space Grotesk', sans-serif;
          font-size: 15px;
          font-weight: 600;
          letter-spacing: 0.01em;
          border: none;
          cursor: pointer;
          transition: all 150ms cubic-bezier(0, 0, 0.2, 1);
          line-height: 1;
        }
        .ds-btn-primary:hover {
          background: #6fb3d4;
          box-shadow: 0 0 24px rgba(91, 159, 192, 0.30);
          transform: translateY(-1px);
        }
        .ds-btn-primary:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .ds-btn-ghost {
          background: transparent;
          border: 1px solid #243548;
          color: #94a3b8;
          padding: 11px 23px;
          border-radius: 8px;
          font-family: 'Space Grotesk', sans-serif;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all 150ms cubic-bezier(0, 0, 0.2, 1);
          line-height: 1;
        }
        .ds-btn-ghost:hover {
          border-color: #5b9fc0;
          color: #5b9fc0;
        }

        .ds-card {
          background: #0d1520;
          border: 1px solid #1a2535;
          border-radius: 12px;
          padding: 24px;
          transition: border-color 200ms cubic-bezier(0, 0, 0.2, 1),
                      box-shadow   200ms cubic-bezier(0, 0, 0.2, 1);
        }
        .ds-card:hover {
          border-color: #243548;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        }

        .ds-card-glass {
          background: rgba(13, 21, 32, 0.7);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(91, 159, 192, 0.12);
          border-radius: 12px;
          padding: 24px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
          transition: border-color 200ms cubic-bezier(0, 0, 0.2, 1);
        }
        .ds-card-glass:hover {
          border-color: rgba(91, 159, 192, 0.25);
        }

        .ds-metric-card {
          background: #0d1520;
          border: 1px solid #1a2535;
          border-radius: 12px;
          padding: 24px;
          transition: border-color 200ms cubic-bezier(0, 0, 0.2, 1),
                      box-shadow   200ms cubic-bezier(0, 0, 0.2, 1);
        }
        .ds-metric-card:hover {
          border-color: rgba(91, 159, 192, 0.3);
          box-shadow: 0 0 24px rgba(91, 159, 192, 0.12);
        }

        .ds-swatch-wrap {
          transition: transform 150ms cubic-bezier(0, 0, 0.2, 1);
          width: 120px;
          flex-shrink: 0;
        }
        .ds-swatch-wrap:hover { transform: scale(1.04); }

        .ds-antipattern-bad {
          background: rgba(239, 68, 68, 0.06);
          border: 1px solid rgba(239, 68, 68, 0.18);
          border-radius: 8px;
          padding: 16px;
        }
        .ds-antipattern-good {
          background: rgba(34, 197, 94, 0.06);
          border: 1px solid rgba(34, 197, 94, 0.18);
          border-radius: 8px;
          padding: 16px;
        }

        @media (max-width: 640px) {
          .ds-voice-grid { grid-template-columns: 1fr !important; }
          .ds-easing-grid { grid-template-columns: 1fr 1fr !important; }
          .ds-motion-row  { flex-direction: column; gap: 4px !important; }
        }
      `}</style>

      <div style={{ backgroundColor: BG_BASE, minHeight: '100vh', fontFamily: FONT, color: TEXT_PRIMARY }}>

        {/* ── STICKY NAV ──────────────────────────────────────────────────── */}
        <nav style={{
          position: 'sticky', top: 0, zIndex: 100,
          backgroundColor: 'rgba(8, 9, 15, 0.92)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          borderBottom: `1px solid ${BORDER}`,
        }}>
          <div style={{
            maxWidth: 1200, margin: '0 auto',
            padding: '0 24px',
            display: 'flex', alignItems: 'center',
            overflowX: 'auto', scrollbarWidth: 'none',
          }}>
            <span style={{
              fontWeight: 700, fontSize: 13, color: ACCENT,
              marginRight: 8, whiteSpace: 'nowrap',
              padding: '16px 12px 16px 0',
              fontFamily: FONT,
            }}>
              ⚡ Ether DS
            </span>
            {NAV_ITEMS.map(({ href, label }) => (
              <a key={href} href={href} className="ds-nav-link">{label}</a>
            ))}
          </div>
        </nav>

        {/* ── HERO ────────────────────────────────────────────────────────── */}
        <section style={{ position: 'relative', overflow: 'hidden', padding: '96px 24px 80px', textAlign: 'center' }}>
          {/* Aurora blobs */}
          <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
            <div style={{
              position: 'absolute', width: '65%', height: '65%',
              top: '-15%', left: '17%',
              background: 'radial-gradient(ellipse, rgba(91, 159, 192, 0.18) 0%, transparent 68%)',
              filter: 'blur(48px)',
              animation: 'auroraFloat 10s ease-in-out infinite',
            }} />
            <div style={{
              position: 'absolute', width: '42%', height: '42%',
              bottom: '-5%', right: '8%',
              background: 'radial-gradient(ellipse, rgba(34, 197, 94, 0.10) 0%, transparent 68%)',
              filter: 'blur(56px)',
              animation: 'auroraFloat 13s ease-in-out infinite reverse',
            }} />
            <div style={{
              position: 'absolute', width: '38%', height: '38%',
              bottom: '5%', left: '4%',
              background: 'radial-gradient(ellipse, rgba(99, 102, 241, 0.10) 0%, transparent 68%)',
              filter: 'blur(52px)',
              animation: 'auroraFloat 16s ease-in-out infinite 4s',
            }} />
          </div>

          <div style={{ position: 'relative', zIndex: 1, maxWidth: 760, margin: '0 auto', animation: 'dsSlideUp 500ms cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>
            {/* Version badge */}
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              marginBottom: 28,
              background: ACCENT_DIM,
              border: `1px solid ${GLASS_BORDER}`,
              borderRadius: 9999,
              padding: '5px 14px',
              fontSize: 11, fontWeight: 700, letterSpacing: '0.09em',
              textTransform: 'uppercase', color: ACCENT,
              fontFamily: FONT,
            }}>
              v1.0 · 2026
            </span>

            <h1 style={{
              fontFamily: FONT, fontWeight: 700,
              fontSize: 'clamp(38px, 7.5vw, 80px)',
              letterSpacing: '-0.03em', lineHeight: 1.08,
              color: TEXT_PRIMARY, margin: '0 0 22px',
            }}>
              ether design system
            </h1>

            <p style={{
              fontSize: 'clamp(15px, 2.2vw, 19px)', fontWeight: 400,
              color: TEXT_SECONDARY,
              margin: '0 auto', lineHeight: 1.65,
              maxWidth: 480, fontFamily: FONT,
            }}>
              The source of truth for all Ether UI. Mini-games, dashboards, marketing — everything inherits from here.
            </p>
          </div>
        </section>

        {/* ── MAIN CONTENT ────────────────────────────────────────────────── */}
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px 96px' }}>

          {/* ── 01 COLOR PALETTE ──────────────────────────────────────────── */}
          <section id="colors" style={{ marginBottom: 88 }}>
            <SectionHeader label="01" title="Color Palette" />

            {SWATCH_GROUPS.map(({ group, swatches }) => (
              <div key={group} style={{ marginBottom: 36 }}>
                <p style={{
                  margin: '0 0 14px',
                  fontSize: 11, fontWeight: 600, letterSpacing: '0.1em',
                  textTransform: 'uppercase', color: TEXT_MUTED, fontFamily: FONT,
                }}>
                  {group}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                  {swatches.map(({ name, hex, label }) => (
                    <div key={name} className="ds-swatch-wrap">
                      <div style={{
                        height: 52, borderRadius: 8,
                        backgroundColor: hex,
                        border: `1px solid ${BORDER}`,
                        marginBottom: 10,
                      }} />
                      <p style={{ margin: 0, fontFamily: MONO, fontSize: 11, fontWeight: 600, color: TEXT_PRIMARY }}>{label}</p>
                      <p style={{ margin: '3px 0 0', fontFamily: MONO, fontSize: 10, color: TEXT_MUTED, wordBreak: 'break-all', lineHeight: 1.4 }}>{hex}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>

          {/* ── 02 TYPOGRAPHY ─────────────────────────────────────────────── */}
          <section id="typography" style={{ marginBottom: 88 }}>
            <SectionHeader label="02" title="Typography" />

            {/* Type scale */}
            <div style={{ marginBottom: 36 }}>
              <FieldLabel>Type Scale — Space Grotesk</FieldLabel>
              <div style={{
                background: BG_SURFACE, border: `1px solid ${BORDER}`,
                borderRadius: 12, padding: '8px 24px',
                display: 'flex', flexDirection: 'column',
              }}>
                {TYPE_SCALE.map(({ name, size, sample }) => (
                  <div key={name} style={{
                    display: 'flex', alignItems: 'baseline',
                    gap: 16, padding: '14px 0',
                    borderBottom: `1px solid ${BORDER_SUBTLE}`,
                  }}>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: TEXT_MUTED, minWidth: 84, flexShrink: 0 }}>{name}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: ACCENT, minWidth: 36, flexShrink: 0 }}>{size}</span>
                    <span style={{ fontSize: size, fontWeight: 500, color: TEXT_PRIMARY, lineHeight: 1.2, wordBreak: 'break-word' }}>{sample}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Weight variants */}
            <div style={{ marginBottom: 36 }}>
              <FieldLabel>Weight Variants — 300 → 700</FieldLabel>
              <div style={{
                background: BG_SURFACE, border: `1px solid ${BORDER}`,
                borderRadius: 12, padding: '8px 24px',
              }}>
                {WEIGHT_VARIANTS.map(({ weight, sample }) => (
                  <div key={weight} style={{
                    display: 'flex', alignItems: 'center', gap: 16,
                    padding: '12px 0',
                    borderBottom: `1px solid ${BORDER_SUBTLE}`,
                  }}>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: TEXT_MUTED, minWidth: 36, flexShrink: 0 }}>{weight}</span>
                    <span style={{ fontSize: 17, fontWeight: weight, color: TEXT_PRIMARY, fontFamily: FONT }}>{sample}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* JetBrains Mono metrics */}
            <div>
              <FieldLabel>JetBrains Mono — Metrics & Data</FieldLabel>
              <div style={{
                background: BG_SURFACE, border: `1px solid ${BORDER}`,
                borderRadius: 12, padding: 24,
              }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 40 }}>
                  {[
                    { label: 'SALES LIFT',   value: '8×',   sub: 'Kraft Heinz' },
                    { label: 'DATA QUALITY', value: '83%',  sub: 'RBC Bank'    },
                    { label: 'BRAND POWER',  value: '+7pts',sub: 'Budweiser'   },
                  ].map(({ label, value, sub }) => (
                    <div key={label}>
                      <p style={{ margin: '0 0 4px', fontFamily: MONO, fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: TEXT_MUTED }}>{label}</p>
                      <p style={{ margin: 0, fontFamily: MONO, fontSize: 40, fontWeight: 700, color: TEXT_PRIMARY, letterSpacing: '-0.02em', lineHeight: 1 }}>{value}</p>
                      <p style={{ margin: '4px 0 0', fontFamily: MONO, fontSize: 11, color: ACCENT }}>{sub}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* ── 03 SPACING ────────────────────────────────────────────────── */}
          <section id="spacing" style={{ marginBottom: 88 }}>
            <SectionHeader label="03" title="Spacing Scale" />
            <div style={{
              background: BG_SURFACE, border: `1px solid ${BORDER}`,
              borderRadius: 12, padding: 24,
            }}>
              {SPACE_TOKENS.map(({ token, px }) => (
                <div key={token} className="ds-motion-row" style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: TEXT_MUTED, minWidth: 104, textAlign: 'right', flexShrink: 0 }}>{token}</span>
                  <div style={{
                    height: 20,
                    width: Math.min(px * 3, 480),
                    background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_DIM})`,
                    borderRadius: 4,
                    flexShrink: 0,
                  }} />
                  <span style={{ fontFamily: MONO, fontSize: 11, color: ACCENT, flexShrink: 0 }}>{px}px</span>
                </div>
              ))}
            </div>
          </section>

          {/* ── 04 COMPONENTS ─────────────────────────────────────────────── */}
          <section id="components" style={{ marginBottom: 88 }}>
            <SectionHeader label="04" title="Components" />

            {/* Buttons */}
            <div style={{ marginBottom: 32 }}>
              <FieldLabel>Buttons</FieldLabel>
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center',
                padding: 24,
                background: BG_SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12,
              }}>
                <button className="ds-btn-primary">Primary Action</button>
                <button className="ds-btn-ghost">Ghost Button</button>
                <button className="ds-btn-primary" disabled>Disabled</button>
              </div>
            </div>

            {/* Cards */}
            <div style={{ marginBottom: 32 }}>
              <FieldLabel>Cards</FieldLabel>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
                <div className="ds-card">
                  <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: TEXT_MUTED, fontFamily: FONT }}>Default Card</p>
                  <p style={{ margin: 0, fontSize: 14, color: TEXT_SECONDARY, lineHeight: 1.6, fontFamily: FONT }}>Surface level. Used for content panels, dashboards, and data containers.</p>
                </div>
                <div className="ds-card-glass">
                  <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: TEXT_MUTED, fontFamily: FONT }}>Glass Card</p>
                  <p style={{ margin: 0, fontSize: 14, color: TEXT_SECONDARY, lineHeight: 1.6, fontFamily: FONT }}>Frosted glass treatment. For modals, overlays, and hero-layer content.</p>
                </div>
              </div>
            </div>

            {/* Badges */}
            <div style={{ marginBottom: 32 }}>
              <FieldLabel>Badges — 5 Variants</FieldLabel>
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
                padding: 24,
                background: BG_SURFACE, border: `1px solid ${BORDER}`, borderRadius: 12,
              }}>
                {BADGE_SPECS.map(({ label, bg, color }) => (
                  <span key={label} style={{
                    display: 'inline-flex', alignItems: 'center',
                    padding: '3px 9px', borderRadius: 9999,
                    background: bg, color,
                    fontSize: 11, fontWeight: 600,
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                    fontFamily: FONT,
                  }}>
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {/* Metric Cards */}
            <div>
              <FieldLabel>Metric Cards</FieldLabel>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16 }}>
                {METRIC_CARDS.map(({ label, value, delta, positive, sub }) => (
                  <div key={label} className="ds-metric-card">
                    <p style={{ margin: '0 0 6px', fontFamily: MONO, fontSize: 10, fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: TEXT_MUTED }}>{label}</p>
                    <p style={{ margin: '0 0 8px', fontFamily: MONO, fontSize: 38, fontWeight: 700, color: TEXT_PRIMARY, letterSpacing: '-0.02em', lineHeight: 1 }}>{value}</p>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: positive ? SUCCESS : ERROR }}>{delta}</span>
                      <span style={{ fontFamily: MONO, fontSize: 11, color: TEXT_MUTED }}>{sub}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── 05 MOTION ─────────────────────────────────────────────────── */}
          <section id="motion" style={{ marginBottom: 88 }}>
            <SectionHeader label="05" title="Motion" />

            {/* Timing */}
            <div style={{ marginBottom: 32 }}>
              <FieldLabel>Timing Tokens</FieldLabel>
              <div style={{
                background: BG_SURFACE, border: `1px solid ${BORDER}`,
                borderRadius: 12, padding: 24,
                display: 'flex', flexDirection: 'column', gap: 14,
              }}>
                {TIMING_TOKENS.map(({ token, ms, display }) => (
                  <div key={token} className="ds-motion-row" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: TEXT_MUTED, minWidth: 164, flexShrink: 0 }}>{token}</span>
                    <div style={{
                      height: 8,
                      width: Math.min(ms / 28, 360),
                      background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_DIM})`,
                      borderRadius: 4, flexShrink: 0,
                    }} />
                    <span style={{ fontFamily: MONO, fontSize: 11, color: ACCENT, flexShrink: 0 }}>{display ?? `${ms}ms`}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Easing */}
            <div>
              <FieldLabel>Easing Functions</FieldLabel>
              <div style={{
                background: BG_SURFACE, border: `1px solid ${BORDER}`,
                borderRadius: 12, padding: '8px 24px',
              }}>
                {EASING_SPECS.map(({ name, value, desc }) => (
                  <div key={name} className="ds-easing-grid" style={{
                    display: 'grid',
                    gridTemplateColumns: '192px 1fr 1fr',
                    gap: 16, alignItems: 'center',
                    padding: '14px 0',
                    borderBottom: `1px solid ${BORDER_SUBTLE}`,
                  }}>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: TEXT_MUTED }}>{name}</span>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: ACCENT }}>{value}</span>
                    <span style={{ fontSize: 12, color: TEXT_SECONDARY, fontFamily: FONT }}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── 06 ANTI-PATTERNS ──────────────────────────────────────────── */}
          <section id="antipatterns" style={{ marginBottom: 88 }}>
            <SectionHeader label="06" title="Anti-Patterns" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
              {ANTI_PATTERNS.map(({ bad, good }, idx) => (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="ds-antipattern-bad">
                    <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: ERROR, fontFamily: FONT }}>❌ Never</p>
                    <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY, fontFamily: FONT }}>{bad.label}</p>
                    <code style={{ fontFamily: MONO, fontSize: 11, color: ERROR, opacity: 0.85 }}>{bad.ex}</code>
                  </div>
                  <div className="ds-antipattern-good">
                    <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: SUCCESS, fontFamily: FONT }}>✅ Instead</p>
                    <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: TEXT_PRIMARY, fontFamily: FONT }}>{good.label}</p>
                    <code style={{ fontFamily: MONO, fontSize: 11, color: SUCCESS, opacity: 0.85 }}>{good.ex}</code>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── 07 BRAND VOICE ────────────────────────────────────────────── */}
          <section id="voice" style={{ marginBottom: 88 }}>
            <SectionHeader label="07" title="Brand Voice" />

            <div style={{
              marginBottom: 28, padding: '20px 24px',
              background: BG_SURFACE, border: `1px solid ${BORDER}`,
              borderRadius: 12,
            }}>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 500, color: TEXT_PRIMARY, fontStyle: 'italic', lineHeight: 1.6, fontFamily: FONT }}>
                {'"Copy should feel like '}
                <span style={{ color: ACCENT, fontWeight: 600 }}>Ray Dalio</span>
                {' wrote it, '}
                <span style={{ color: ACCENT, fontWeight: 600 }}>Walt Disney</span>
                {' approved it, and '}
                <span style={{ color: ACCENT, fontWeight: 600 }}>Steve Jobs</span>
                {' shipped it."'}
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {VOICE_RULES.map(({ rule, bad, good }) => (
                <div key={rule} style={{
                  background: BG_SURFACE, border: `1px solid ${BORDER}`,
                  borderRadius: 12, padding: 20,
                }}>
                  <p style={{ margin: '0 0 14px', fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: ACCENT, fontFamily: FONT }}>{rule}</p>
                  <div className="ds-voice-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div style={{
                      padding: '12px 16px',
                      background: 'rgba(239, 68, 68, 0.06)',
                      border: '1px solid rgba(239, 68, 68, 0.15)',
                      borderRadius: 8,
                    }}>
                      <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: ERROR, fontFamily: FONT }}>❌ Don&apos;t</p>
                      <p style={{ margin: 0, fontSize: 14, color: TEXT_SECONDARY, lineHeight: 1.55, fontFamily: FONT }}>{bad}</p>
                    </div>
                    <div style={{
                      padding: '12px 16px',
                      background: 'rgba(34, 197, 94, 0.06)',
                      border: '1px solid rgba(34, 197, 94, 0.15)',
                      borderRadius: 8,
                    }}>
                      <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: SUCCESS, fontFamily: FONT }}>✅ Do</p>
                      <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: TEXT_PRIMARY, lineHeight: 1.55, fontFamily: FONT }}>{good}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Footer */}
          <div style={{
            textAlign: 'center', paddingTop: 48,
            borderTop: `1px solid ${BORDER}`,
          }}>
            <p style={{ margin: 0, fontSize: 13, color: TEXT_MUTED, fontFamily: FONT }}>
              Ether Design System · v1.0 · 2026 · Built with ⚔️ by Mara Kael
            </p>
          </div>

        </div>
      </div>
    </>
  );
}
