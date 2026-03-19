import { BRANDS, DEFAULT_THEME, BrandTheme } from './brands';

// ─── CSS Variable Application ─────────────────────────────────────────────────

export function getTheme(brandId?: string | null): BrandTheme {
  if (!brandId) return DEFAULT_THEME;
  return BRANDS[brandId] ?? DEFAULT_THEME;
}

export function applyTheme(theme: BrandTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--color-primary',        theme.colors.primary);
  root.style.setProperty('--color-accent',         theme.colors.accent);
  root.style.setProperty('--color-bg',             theme.colors.background);
  root.style.setProperty('--color-card',           theme.colors.card);
  root.style.setProperty('--color-text',           theme.colors.text);
  root.style.setProperty('--color-text-secondary', theme.colors.textSecondary);
  if (theme.font) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(theme.font)}&display=swap`;
    document.head.appendChild(link);
    root.style.setProperty('--font-family', `'${theme.font}', sans-serif`);
  }
}

// ─── Base Color Tokens ────────────────────────────────────────────────────────

export const COLORS = {
  // Core palette
  bg:            '#08090f',
  bgAlt:         '#0b0c15',
  card:          '#0e1018',
  cardHover:     '#13151f',
  border:        'rgba(255,255,255,0.07)',
  borderStrong:  'rgba(255,255,255,0.14)',

  // Text
  text:          '#f0f4ff',
  textMuted:     '#6b7a99',
  textFaint:     'rgba(255,255,255,0.35)',
  textDisabled:  'rgba(255,255,255,0.2)',

  // Semantic
  danger:        '#ef4444',
  dangerGlow:    'rgba(239,68,68,0.4)',
  warning:       '#facc15',
  warningGlow:   'rgba(250,204,21,0.4)',
  success:       '#22c55e',
  successGlow:   'rgba(34,197,94,0.4)',

  // Brand
  ether:         '#00ff88',
  etherGlow:     'rgba(0,255,136,0.35)',
  etherBlue:     '#5b9fc0',

  // Category accents
  sports: {
    orange:      '#f97316',
    green:       '#22c55e',
    amber:       '#f59e0b',
    red:         '#ef4444',
  },
  cognitive: {
    purple:      '#8b5cf6',
    cyan:        '#00ffff',
    indigo:      '#6366f1',
    violet:      '#a855f7',
  },
  holiday: {
    red:         '#ef4444',
    gold:        '#fbbf24',
    pink:        '#ec4899',
    green:       '#22c55e',
    blue:        '#93c5fd',
  },
  breath: {
    blue:        '#3b82f6',
    teal:        '#14b8a6',
    lavender:    '#a78bfa',
    sky:         '#38bdf8',
  },
} as const;

// ─── Animation Constants ──────────────────────────────────────────────────────

export const SPRINGS = {
  /** Snappy UI — buttons, cards, small interactions */
  snappy: { type: 'spring', stiffness: 400, damping: 22 } as const,

  /** Dramatic — countdowns, score reveals, power moments */
  dramatic: { type: 'spring', stiffness: 600, damping: 20, mass: 0.8 } as const,

  /** Gentle — end screens, overlays, modals */
  gentle: { type: 'spring', stiffness: 280, damping: 26 } as const,

  /** Bouncy — celebratory, holiday games, delight moments */
  bouncy: { type: 'spring', stiffness: 500, damping: 18 } as const,

  /** Tight — HUD value changes, live data */
  tight: { type: 'spring', stiffness: 500, damping: 32 } as const,
} as const;

export const EASINGS = {
  /** Standard UI ease — natural feel */
  standard:    [0.22, 1, 0.36, 1] as const,
  /** Ease out — elements entering */
  out:         [0, 0, 0.3, 1] as const,
  /** Ease in-out — transitions */
  inOut:       [0.4, 0, 0.2, 1] as const,
  /** Overshoot — playful bouncy */
  overshoot:   [0.34, 1.56, 0.64, 1] as const,
} as const;

export const DURATIONS = {
  instant:     100,
  fast:        200,
  normal:      300,
  slow:        500,
  xSlow:       800,
} as const;

// ─── Glow / Shadow Helpers ────────────────────────────────────────────────────

/** Returns a CSS box-shadow glow string for a given color */
export function colorGlow(hex: string, intensity: 'subtle' | 'normal' | 'strong' = 'normal'): string {
  const opacities = { subtle: '33', normal: '55', strong: '88' };
  const spreads   = { subtle: '12px', normal: '24px', strong: '48px' };
  const op = opacities[intensity];
  const sp = spreads[intensity];
  return `0 0 ${sp} ${hex}${op}`;
}

/** Returns a CSS text-shadow glow for score numbers */
export function scoreGlow(hex: string): string {
  return `0 0 32px ${hex}55, 0 0 8px ${hex}33`;
}

/** Returns a radial gradient background suitable for game cards */
export function cardGradient(accentColor: string): string {
  return `linear-gradient(160deg, ${accentColor}cc 0%, ${accentColor}55 45%, ${COLORS.bg} 100%)`;
}

/** Returns a hero background radial gradient for game screens */
export function heroGradient(accentColor: string): string {
  return `
    radial-gradient(ellipse 120% 100% at 70% 30%, ${accentColor}28 0%, transparent 60%),
    radial-gradient(ellipse 60% 80% at 20% 80%, ${accentColor}15 0%, transparent 50%),
    ${COLORS.bg}
  `;
}

// ─── Touch Target Helpers ─────────────────────────────────────────────────────

/** Minimum touch target size per Apple HIG / WCAG 2.5.5 */
export const TOUCH = {
  min:     44,
  primary: 52,
  cta:     56,
} as const;

// ─── Category Theme Packs ─────────────────────────────────────────────────────

export interface CategoryTheme {
  name: string;
  primaryAccent: string;
  secondaryAccent: string;
  bgTint: string;
  labelSpacing: string;
  labelWeight: number;
  animationStyle: 'fast' | 'deliberate' | 'bouncy' | 'flowing';
}

export const CATEGORY_THEMES: Record<string, CategoryTheme> = {
  sports: {
    name:            'Sports',
    primaryAccent:   COLORS.sports.orange,
    secondaryAccent: COLORS.sports.green,
    bgTint:          'rgba(249,115,22,0.08)',
    labelSpacing:    '0.08em',
    labelWeight:     800,
    animationStyle:  'fast',
  },
  cognitive: {
    name:            'Cognitive',
    primaryAccent:   COLORS.cognitive.purple,
    secondaryAccent: COLORS.cognitive.cyan,
    bgTint:          'rgba(139,92,246,0.06)',
    labelSpacing:    '0.04em',
    labelWeight:     600,
    animationStyle:  'deliberate',
  },
  holiday: {
    name:            'Holiday',
    primaryAccent:   COLORS.holiday.red,
    secondaryAccent: COLORS.holiday.gold,
    bgTint:          'rgba(239,68,68,0.08)',
    labelSpacing:    '0.02em',
    labelWeight:     700,
    animationStyle:  'bouncy',
  },
  breath: {
    name:            'Breath / Mic',
    primaryAccent:   COLORS.breath.blue,
    secondaryAccent: COLORS.breath.teal,
    bgTint:          'rgba(59,130,246,0.07)',
    labelSpacing:    '0.06em',
    labelWeight:     500,
    animationStyle:  'flowing',
  },
} as const;

// ─── Typography Scale ─────────────────────────────────────────────────────────

export const TYPE = {
  scoreHuge:    { fontSize: 80, fontWeight: 900, letterSpacing: '-2px',   lineHeight: 1 },
  scoreLarge:   { fontSize: 48, fontWeight: 900, letterSpacing: '-1px',   lineHeight: 1 },
  scoreMedium:  { fontSize: 36, fontWeight: 900, letterSpacing: '-0.5px', lineHeight: 1 },
  hudValue:     { fontSize: 40, fontWeight: 900, letterSpacing: '-0.5px', lineHeight: 1 },
  hudLabel:     { fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', lineHeight: 1 },
  gameTitle:    { fontSize: 40, fontWeight: 900, letterSpacing: '-0.5px', lineHeight: 1.1 },
  sectionLabel: { fontSize: 13, fontWeight: 700, letterSpacing: '0.12em' },
  body:         { fontSize: 16, fontWeight: 400, lineHeight: 1.55 },
  caption:      { fontSize: 12, fontWeight: 500, letterSpacing: '0.04em' },
} as const;
