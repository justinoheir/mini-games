/**
 * ══════════════════════════════════════════════════════════════════
 *  FIREWORK LAUNCH — Ether Mini-Game | Holiday: New Year's
 *  Swipe upward to launch a firework rocket. Tap to detonate at peak.
 *  Score is based on how close to the peak you detonate.
 *
 *  Signals: score, perfectDetonations, totalLaunched, maxStreak,
 *           combosBurst, avgTimingMs
 *  Archetypes: Pyrotechnist 🎆 | Sky Painter ✨ | Precision Igniter 🎇 |
 *              Crowd Pleaser 🥳 | Almost Midnight 🕛 | Happy New Year! 🎉
 * ══════════════════════════════════════════════════════════════════
 */

'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic } from '@/lib/audio';
import { playScoreHit, playVictoryFanfare, playNearMiss } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import { CATEGORY_THEMES } from '@/lib/theme';
import SwipeInstructions from '@/components/SwipeInstructions';

const CATEGORY_ACCENT = CATEGORY_THEMES.holiday.primaryAccent;

// ─── SPEC CONSTANTS ───────────────────────────────────────────────────────────
const GAME_ID      = 'firework-launch';
const PB_KEY       = 'pb_firework-launch';
const ACCENT       = '#f59e0b';
const DURATION     = 45;
const GAME_EMOJI   = '🎆';
const GAME_TITLE   = 'Firework Launch';
const GAME_TAGLINE = 'Swipe to launch. Tap to detonate. Make it count.';
const BG_COLOR     = '#03010a';
const FIREWORK_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#ffffff'];
const PARTICLE_LIFETIME = 800; // ms
const TRAIL_MAX    = 24;
const FLOAT_LIFETIME = 1200; // ms
const PEAKED_TIMEOUT = 700;  // ms — auto-dud after this long at peak (allows full spec timing windows)

// ─── TYPES ────────────────────────────────────────────────────────────────────
type RocketPhase = 'rising' | 'peaked' | 'exploded';
type RocketType  = 'standard' | 'sparkler' | 'grand';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  radius: number;
  spawnTime: number;
}

interface TrailDot {
  x: number;
  y: number;
  age: number; // increments each frame
}

interface FloatingText {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  spawnTime: number;
}

interface Rocket {
  id: number;
  x: number;
  y: number;
  vy: number;
  vx: number;
  phase: RocketPhase;
  particles: Particle[];
  trail: TrailDot[];
  type: RocketType;
  colors: string[];
  peakStartTime: number;
  pointsMultiplier: number;
  isAutoFinale: boolean;
}

interface Building {
  x: number;
  w: number;
  h: number;
}

interface StarDot {
  x: number;
  y: number;
  r: number;
  alpha: number;
}

interface Signals {
  score: number;
  perfectDetonations: number;
  totalLaunched: number;
  maxStreak: number;
  streakCurrent: number;
  combosBurst: number;
  timingOffsets: number[]; // |vy| at detonation time
}

interface GameState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  rockets: Rocket[];
  floatingTexts: FloatingText[];
  nextId: number;
  consecutivePerfects: number;
  comboReady: boolean;
  screenFlash: number;       // 0–1 alpha
  screenFlashTime: number;
  streakResetPending: boolean;
  touchStartX: number;
  touchStartY: number;
  touchStartTime: number;
  accentColor: string;
  buildings: Building[];
  stars: StarDot[];
  lastAutoLaunchTime: number;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function pickRocketType(forceGrand: boolean): RocketType {
  if (forceGrand) return 'grand';
  const r = Math.random() * 100;
  if (r < 50) return 'standard';
  if (r < 80) return 'sparkler';
  return 'grand';
}

function randColor(): string {
  return FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
}

function pickColors(type: RocketType): string[] {
  if (type === 'standard') return [randColor()];
  if (type === 'sparkler')  return [randColor(), randColor()];
  return [randColor(), randColor(), randColor()];
}

function createParticles(
  x: number,
  y: number,
  colors: string[],
  count: number,
): Particle[] {
  const particles: Particle[] = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const angle  = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
    const speed  = 1.5 + Math.random() * 5;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: colors[Math.floor(Math.random() * colors.length)],
      radius: 2 + Math.random() * 3,
      spawnTime: now,
    });
  }
  return particles;
}

function generateBuildings(W: number, H: number): Building[] {
  const buildings: Building[] = [];
  let x = 0;
  while (x < W + 60) {
    const w = 18 + Math.random() * 38;
    const h = 28 + Math.random() * 110;
    buildings.push({ x, w, h });
    x += w + 1 + Math.random() * 5;
  }
  return buildings;
}

function generateStars(W: number, H: number): StarDot[] {
  const stars: StarDot[] = [];
  for (let i = 0; i < 120; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * H * 0.85,
      r: 0.5 + Math.random() * 1.5,
      alpha: 0.3 + Math.random() * 0.7,
    });
  }
  return stars;
}

// ─── PERSONALITY ─────────────────────────────────────────────────────────────
function getPersonality(sig: Signals): string {
  const avgTiming =
    sig.timingOffsets.length > 0
      ? sig.timingOffsets.reduce((a, b) => a + b, 0) / sig.timingOffsets.length
      : 999;

  if (sig.perfectDetonations >= 8 && sig.maxStreak >= 4) return 'Pyrotechnist 🎆';
  if (sig.combosBurst >= 2)                               return 'Sky Painter ✨';
  if (avgTiming < 200 && sig.timingOffsets.length >= 3)  return 'Precision Igniter 🎇';
  if (sig.score >= 30)                                    return 'Crowd Pleaser 🥳';
  if (sig.score >= 15)                                    return 'Almost Midnight 🕛';
  return 'Happy New Year! 🎉';
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────
export default function FireworkLaunchGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);

  const stateRef = useRef<GameState>({
    running:           false,
    timeLeft:          DURATION,
    sig: {
      score: 0,
      perfectDetonations: 0,
      totalLaunched: 0,
      maxStreak: 0,
      streakCurrent: 0,
      combosBurst: 0,
      timingOffsets: [],
    },
    rockets:            [],
    floatingTexts:      [],
    nextId:             0,
    consecutivePerfects: 0,
    comboReady:         false,
    screenFlash:        0,
    screenFlashTime:    0,
    streakResetPending: false,
    touchStartX:        0,
    touchStartY:        0,
    touchStartTime:     0,
    accentColor:        ACCENT,
    buildings:          [],
    stars:              [],
    lastAutoLaunchTime: 0,
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streakDisplay, setStreakDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎆');
  const { pops, triggerPop } = useScorePop();
  const [streak, setStreak] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const prevScoreRef = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const numScore = typeof scoreDisplay === 'number' ? scoreDisplay : 0;
    if (numScore > prevScoreRef.current) {
      triggerPop(`+${numScore - prevScoreRef.current}`, window.innerWidth / 2, 200);
      hapticScore();
      playScoreHit('default', numScore - prevScoreRef.current);
      setStreak(Math.floor(numScore / 5));
    }
    prevScoreRef.current = numScore;
  }, [scoreDisplay]); // triggerPop is stable
  const playerSessionRef                = useRef<PlayerSession | null>(null);
  const phaseRef                        = useRef<Phase>('start');

  useEffect(() => {
    stateRef.current.accentColor = theme.colors.accent ?? ACCENT;
  }, [theme]);

  // ─── DETONATION ──────────────────────────────────────────────────────────
  const detonateRockets = useCallback((tapX: number, tapY: number) => {
    const s = stateRef.current;
    let anyDetonated = false;

    s.rockets.forEach(rocket => {
      if (rocket.phase !== 'rising' && rocket.phase !== 'peaked') return;
      if (rocket.isAutoFinale) return;

      anyDetonated = true;

      // Use actual milliseconds from peak — spec: perfect < 100ms, great < 300ms, nice < 600ms
      const timingMs = rocket.phase === 'peaked'
        ? Date.now() - rocket.peakStartTime
        : 9999; // detonated while still rising = way too early

      // Only record timing for actual peak attempts (not pre-peak taps)
      if (rocket.phase === 'peaked') {
        s.sig.timingOffsets.push(timingMs);
      }

      let pts = 0;
      let label = '';
      let labelColor = '#888';
      let isPerfect = false;

      if (timingMs < 100) {
        pts = 5; label = 'PERFECT ✨'; labelColor = '#ffffff'; isPerfect = true;
      } else if (timingMs < 300) {
        pts = 3; label = 'GREAT! 🎆'; labelColor = '#f59e0b';
      } else if (timingMs < 600) {
        pts = 1; label = 'Nice 🎇'; labelColor = '#22c55e';
      } else {
        pts = 0; label = 'Dud 💨'; labelColor = '#ef4444';
      }

      const finalPts = Math.round(pts * rocket.pointsMultiplier);

      if (finalPts > 0) {
        s.sig.score += finalPts;
        s.sig.streakCurrent++;
        if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
        setScoreDisplay(s.sig.score);
        setStreakDisplay(s.sig.streakCurrent);
      } else {
        s.sig.streakCurrent = 0;
        setStreakDisplay(0);
      }

      if (isPerfect) {
        s.sig.perfectDetonations++;
        s.consecutivePerfects++;
        if (s.consecutivePerfects >= 3) {
          s.comboReady = true;
          s.sig.combosBurst++;
          s.consecutivePerfects = 0;
        }
        // Big burst + screen flash
        rocket.particles = createParticles(rocket.x, rocket.y, rocket.colors, 90);
        s.screenFlash = 0.6;
        s.screenFlashTime = Date.now();
        sfx.success();
        sfx.boom();
        haptic([30, 20, 80]);
      } else if (pts > 0) {
        rocket.particles = createParticles(rocket.x, rocket.y, rocket.colors, 60);
        sfx.collect();
        haptic([30]);
      } else {
        s.consecutivePerfects = 0;
        rocket.particles = createParticles(rocket.x, rocket.y, ['#555', '#444'], 20);
        sfx.collision();
        haptic([60]);
      }

      // Floating score label
      if (finalPts > 0 || pts === 0) {
        const displayLabel = rocket.pointsMultiplier > 1
          ? `${label} ×${rocket.pointsMultiplier.toFixed(1)}`
          : label;
        s.floatingTexts.push({
          id: s.nextId++,
          x: rocket.x,
          y: rocket.y - 20,
          text: finalPts > 0 ? `+${finalPts}  ${displayLabel}` : displayLabel,
          color: labelColor,
          spawnTime: Date.now(),
        });
      }

      rocket.phase = 'exploded';
    });

    // Unused tapX/tapY avoids TS "unused var" — just reference them
    void tapX; void tapY;
    return anyDetonated;
  }, []);

  // ─── LAUNCH ROCKET ────────────────────────────────────────────────────────
  const launchRocket = useCallback((
    clientX: number,
    clientY: number,
    endClientX: number,
    endClientY: number,
    touchTime: number,
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.offsetWidth  / rect.width;
    const scaleY = canvas.offsetHeight / rect.height;

    const startCX = (clientX  - rect.left) * scaleX;
    const startCY = (clientY  - rect.top)  * scaleY;
    const endCX   = (endClientX - rect.left) * scaleX;
    const endCY   = (endClientY - rect.top)  * scaleY;

    const deltaYClient = clientY - endClientY; // positive = swiped up
    const swipeTime = Math.max(50, Date.now() - touchTime);
    const swipeVel  = deltaYClient / swipeTime; // px/ms upward

    const initialVy = -Math.min(22, Math.max(8, swipeVel * 14));
    const swipeDX   = endCX - startCX;
    const initialVx = swipeDX / swipeTime * 0.5;

    const isFinale    = s.timeLeft <= 5;
    const rocketType  = pickRocketType(isFinale);
    const colors      = pickColors(rocketType);
    const multiplier  = rocketType === 'grand' ? 1.5 : 1;

    const launchX = startCX;
    const launchY = startCY;

    if (s.comboReady) {
      // Combo: 3 rockets side by side, 3× points each
      s.comboReady = false;
      for (let i = -1; i <= 1; i++) {
        s.rockets.push({
          id: s.nextId++,
          x: launchX + i * 40,
          y: launchY,
          vy: initialVy * (0.9 + Math.random() * 0.2),
          vx: initialVx + i * 0.3,
          phase: 'rising',
          particles: [],
          trail: [],
          type: 'grand',
          colors: pickColors('grand'),
          peakStartTime: 0,
          pointsMultiplier: 3,
          isAutoFinale: false,
        });
      }
      s.sig.totalLaunched += 3;
      // Floating "COMBO!" label
      s.floatingTexts.push({
        id: s.nextId++,
        x: launchX,
        y: launchY - 40,
        text: '🎆 COMBO BURST! 🎆',
        color: '#f59e0b',
        spawnTime: Date.now(),
      });
      sfx.boom();
      haptic([50, 30, 50, 30, 100]);
    } else if (rocketType === 'sparkler') {
      // Sparkler: 2 rockets
      for (let i = 0; i < 2; i++) {
        s.rockets.push({
          id: s.nextId++,
          x: launchX + (i === 0 ? -18 : 18),
          y: launchY,
          vy: initialVy,
          vx: initialVx + (i === 0 ? -0.4 : 0.4),
          phase: 'rising',
          particles: [],
          trail: [],
          type: 'sparkler',
          colors,
          peakStartTime: 0,
          pointsMultiplier: multiplier,
          isAutoFinale: false,
        });
      }
      s.sig.totalLaunched += 2;
    } else {
      s.rockets.push({
        id: s.nextId++,
        x: launchX,
        y: launchY,
        vy: initialVy,
        vx: initialVx,
        phase: 'rising',
        particles: [],
        trail: [],
        type: rocketType,
        colors,
        peakStartTime: 0,
        pointsMultiplier: multiplier,
        isAutoFinale: false,
      });
      s.sig.totalLaunched++;
    }

    sfx.whoosh();
    haptic([15]);
  }, []);

  // ─── END GAME ────────────────────────────────────────────────────────────
  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    // Personal best tracking
    try {
      const _pbPrev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      const _pbVal = parseFloat(String(s.sig?.score ?? 0));
      if (!isNaN(_pbVal) && _pbVal > _pbPrev) {
        localStorage.setItem(PB_KEY, String(Math.round(_pbVal)));
        setIsNewBest(true);
      }
    } catch { /* ignore */ }


    setFinalSig({ ...s.sig });
    phaseRef.current = 'done';
    setPhase('done');
  }, []);

  // ─── GAME LOOP ────────────────────────────────────────────────────────────
  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    // Reset state
    s.running           = true;
    s.timeLeft          = DURATION;
    s.sig               = {
      score: 0, perfectDetonations: 0, totalLaunched: 0,
      maxStreak: 0, streakCurrent: 0, combosBurst: 0, timingOffsets: [],
    };
    s.rockets            = [];
    s.floatingTexts      = [];
    s.nextId             = 0;
    s.consecutivePerfects = 0;
    s.comboReady         = false;
    s.screenFlash        = 0;
    s.screenFlashTime    = 0;
    s.streakResetPending = false;
    s.lastAutoLaunchTime = 0;
    s.buildings          = generateBuildings(canvas.offsetWidth, canvas.offsetHeight);
    s.stars              = generateStars(canvas.offsetWidth, canvas.offsetHeight);

    setScoreDisplay(0);
    setStreakDisplay(0);
    setTimeLeft(DURATION);
    phaseRef.current = 'playing';
    setPhase('playing');
    stopMusicRef.current = startMusic('drive');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      // Flush pending streak reset (deferred from rAF auto-dud)
      if (s.streakResetPending) {
        s.streakResetPending = false;
        setStreakDisplay(s.sig.streakCurrent);
      }
      if (s.timeLeft <= 5) sfx.tick();
      if (s.timeLeft <= 0) { sfx.success(); haptic([30, 20, 80]); endGame(); }
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      const now = Date.now();

      // ── Background ───────────────────────────────────────────────────────
      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(0, 0, W, H);

      // ── Stars ────────────────────────────────────────────────────────────
      s.stars.forEach(star => {
        ctx.beginPath();
        ctx.globalAlpha = star.alpha * (0.7 + 0.3 * Math.sin(now / 1200 + star.x));
        ctx.fillStyle = '#ffffff';
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      // ── Auto-launch grand finale in last 5s ───────────────────────────────
      if (s.timeLeft <= 5 && now - s.lastAutoLaunchTime > 700) {
        const activeCount = s.rockets.filter(r => r.phase !== 'exploded').length;
        if (activeCount === 0) {
          s.lastAutoLaunchTime = now;
          const fx = 60 + Math.random() * (W - 120);
          const fy = H * 0.95;
          s.rockets.push({
            id: s.nextId++,
            x: fx,
            y: fy,
            vy: -(12 + Math.random() * 6),
            vx: (Math.random() - 0.5) * 0.5,
            phase: 'rising',
            particles: [],
            trail: [],
            type: 'grand',
            colors: pickColors('grand'),
            peakStartTime: 0,
            pointsMultiplier: 1,
            isAutoFinale: true,
          });
        }
      }

      // ── Rockets ──────────────────────────────────────────────────────────
      s.rockets.forEach(rocket => {
        if (rocket.phase === 'rising') {
          // Physics
          rocket.y  += rocket.vy;
          rocket.x  += rocket.vx;
          rocket.vy *= 0.94;

          // Add trail dot
          rocket.trail.unshift({ x: rocket.x, y: rocket.y, age: 0 });
          if (rocket.trail.length > TRAIL_MAX) rocket.trail.pop();
          rocket.trail.forEach(dot => { dot.age++; });

          // Transition to peaked
          if (Math.abs(rocket.vy) < 1.0) {
            rocket.phase = 'peaked';
            rocket.peakStartTime = now;

            // Auto-launch auto-finale rockets detonate at peak
            if (rocket.isAutoFinale) {
              rocket.particles = createParticles(rocket.x, rocket.y, rocket.colors, 70);
              rocket.phase = 'exploded';
            }
          }

        } else if (rocket.phase === 'peaked') {
          // Keep drifting
          rocket.y  += rocket.vy;
          rocket.x  += rocket.vx;
          rocket.vy *= 0.94;

          rocket.trail.unshift({ x: rocket.x, y: rocket.y, age: 0 });
          if (rocket.trail.length > TRAIL_MAX) rocket.trail.pop();
          rocket.trail.forEach(dot => { dot.age++; });

          // Auto-detonate as dud after timeout
          if (!rocket.isAutoFinale && now - rocket.peakStartTime > PEAKED_TIMEOUT) {
            rocket.phase = 'exploded';
            s.sig.streakCurrent = 0;
            s.consecutivePerfects = 0;
            s.streakResetPending = true; // defer setState out of rAF loop
            rocket.particles = createParticles(rocket.x, rocket.y, ['#444', '#555'], 18);
            s.floatingTexts.push({
              id: s.nextId++,
              x: rocket.x,
              y: rocket.y - 20,
              text: 'Dud 💨',
              color: '#666',
              spawnTime: now,
            });
            sfx.collision();
          }
        }

        // ── Draw trail ────────────────────────────────────────────────────
        if (rocket.phase !== 'exploded') {
          rocket.trail.forEach((dot, i) => {
            const alpha = Math.max(0, 1 - i / TRAIL_MAX);
            ctx.save();
            ctx.globalAlpha = alpha * 0.8;
            ctx.shadowBlur  = 6;
            ctx.shadowColor = rocket.colors[0];
            ctx.fillStyle   = rocket.colors[0];
            ctx.beginPath();
            ctx.arc(dot.x, dot.y, Math.max(1, 3 - i * 0.12), 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          });

          // Draw rocket body
          ctx.save();
          ctx.shadowBlur  = 18;
          ctx.shadowColor = rocket.colors[0];
          ctx.fillStyle   = '#ffffff';
          ctx.beginPath();
          ctx.arc(rocket.x, rocket.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          // Peaked indicator — pulsing ring
          if (rocket.phase === 'peaked' && !rocket.isAutoFinale) {
            const pulse = 0.5 + 0.5 * Math.sin(now / 60);
            ctx.save();
            ctx.globalAlpha = 0.6 * pulse;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth   = 2;
            ctx.shadowBlur  = 10;
            ctx.shadowColor = '#ffffff';
            ctx.beginPath();
            ctx.arc(rocket.x, rocket.y, 12 + pulse * 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }
        }

        // ── Draw particles ────────────────────────────────────────────────
        rocket.particles.forEach(p => {
          const age    = now - p.spawnTime;
          const pAlpha = Math.max(0, 1 - age / PARTICLE_LIFETIME);
          if (pAlpha <= 0) return;
          p.x  += p.vx;
          p.y  += p.vy;
          p.vy += 0.06; // gravity
          p.vx *= 0.98;
          p.vy *= 0.98;
          ctx.save();
          ctx.globalAlpha = pAlpha;
          ctx.shadowBlur  = 8;
          ctx.shadowColor = p.color;
          ctx.fillStyle   = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius * pAlpha, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });
      });

      // ── Floating texts ────────────────────────────────────────────────────
      s.floatingTexts.forEach(ft => {
        const age   = now - ft.spawnTime;
        const alpha = Math.max(0, 1 - age / FLOAT_LIFETIME);
        const dy    = (age / FLOAT_LIFETIME) * 50;
        if (alpha <= 0) return;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font        = 'bold 17px system-ui, sans-serif';
        ctx.textAlign   = 'center';
        ctx.fillStyle   = ft.color;
        ctx.shadowBlur  = 12;
        ctx.shadowColor = ft.color;
        ctx.fillText(ft.text, ft.x, ft.y - dy);
        ctx.restore();
      });

      // ── City skyline ──────────────────────────────────────────────────────
      ctx.save();
      ctx.fillStyle = '#0b0b1e';
      s.buildings.forEach(b => {
        ctx.fillRect(b.x, H - b.h, b.w, b.h);
      });
      // Building window lights — tiny dots
      ctx.fillStyle = 'rgba(255, 220, 100, 0.45)';
      s.buildings.forEach(b => {
        for (let wy = H - b.h + 8; wy < H - 6; wy += 10) {
          for (let wx = b.x + 4; wx < b.x + b.w - 4; wx += 8) {
            if (Math.sin(wx * 7 + wy * 3) > 0.4) {
              ctx.fillRect(wx, wy, 3, 3);
            }
          }
        }
      });
      ctx.restore();

      // ── Screen flash (on perfect) ─────────────────────────────────────────
      if (s.screenFlash > 0) {
        const elapsed = now - s.screenFlashTime;
        const flashAlpha = Math.max(0, s.screenFlash - elapsed / 350);
        s.screenFlash = flashAlpha;
        if (flashAlpha > 0) {
          ctx.save();
          ctx.globalAlpha = flashAlpha * 0.35;
          ctx.fillStyle   = '#ffffff';
          ctx.fillRect(0, 0, W, H);
          ctx.restore();
        }
      }

      // ── HUD hint when no active rockets ──────────────────────────────────
      const activeRockets = s.rockets.filter(r => r.phase !== 'exploded');
      if (activeRockets.length === 0 && s.timeLeft > 5) {
        ctx.save();
        ctx.globalAlpha = 0.45 + 0.15 * Math.sin(now / 500);
        ctx.font         = '15px system-ui, sans-serif';
        ctx.textAlign    = 'center';
        ctx.fillStyle    = '#ffffff';
        ctx.fillText('↑  Swipe up to launch', W / 2, H * 0.72);
        ctx.restore();
      } else if (activeRockets.filter(r => !r.isAutoFinale).length > 0) {
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.15 * Math.sin(now / 300);
        ctx.font         = '14px system-ui, sans-serif';
        ctx.textAlign    = 'center';
        ctx.fillStyle    = '#ffffff';
        ctx.fillText('Tap to detonate!', W / 2, H * 0.88);
        ctx.restore();
      }

      // Grand finale countdown overlay
      if (s.timeLeft <= 5 && s.timeLeft > 0) {
        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.font        = 'bold 22px system-ui, sans-serif';
        ctx.textAlign   = 'center';
        ctx.fillStyle   = '#f59e0b';
        ctx.shadowBlur  = 20;
        ctx.shadowColor = '#f59e0b';
        ctx.fillText('✨ GRAND FINALE ✨', W / 2, 52);
        ctx.restore();
      }

      // ── Combo ready badge ────────────────────────────────────────────────
      if (s.comboReady) {
        ctx.save();
        ctx.globalAlpha = 0.85 + 0.15 * Math.sin(now / 200);
        ctx.font        = 'bold 18px system-ui, sans-serif';
        ctx.textAlign   = 'center';
        ctx.fillStyle   = '#f59e0b';
        ctx.shadowBlur  = 24;
        ctx.shadowColor = '#f59e0b';
        ctx.fillText('🎆 COMBO READY — SWIPE! 🎆', W / 2, H * 0.6);
        ctx.restore();
      }

      // ── Cleanup dead rockets & texts ──────────────────────────────────────
      s.rockets = s.rockets.filter(r => {
        if (r.phase !== 'exploded') return true;
        const oldestParticle = r.particles.reduce(
          (oldest, p) => Math.min(oldest, p.spawnTime), now,
        );
        return now - oldestParticle < PARTICLE_LIFETIME + 200;
      });
      s.floatingTexts = s.floatingTexts.filter(
        ft => now - ft.spawnTime < FLOAT_LIFETIME,
      );

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  // ─── CANVAS SETUP & TOUCH ─────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
      const ctx2 = canvas.getContext('2d');
      if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Regenerate skyline on resize
      const s = stateRef.current;
      if (s.buildings.length === 0 || canvas.offsetWidth !== s.buildings[s.buildings.length - 1].x) {
        s.buildings = generateBuildings(canvas.offsetWidth, canvas.offsetHeight);
        s.stars     = generateStars(canvas.offsetWidth, canvas.offsetHeight);
      }
    };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phaseRef.current !== 'playing') return;
      const s = stateRef.current;
      s.touchStartX    = e.clientX;
      s.touchStartY    = e.clientY;
      s.touchStartTime = Date.now();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (phaseRef.current !== 'playing') return;
      const s = stateRef.current;
      if (!s.running) return;

      const deltaY = s.touchStartY - e.clientY; // positive = swiped up
      const deltaX = Math.abs(e.clientX - s.touchStartX);

      if (deltaY > 60 && deltaY > deltaX && s.touchStartY > window.innerHeight / 2) {
        // Swipe up from bottom half → launch
        launchRocket(
          s.touchStartX,
          s.touchStartY,
          e.clientX,
          e.clientY,
          s.touchStartTime,
        );
      } else if (Math.abs(deltaY) < 20 && deltaX < 20) {
        // Tap → detonate
        detonateRockets(e.clientX, e.clientY);
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup',   onPointerUp);

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup',   onPointerUp);
    };
  }, [launchRocket, detonateRockets]);

  // ─── CLEANUP ─────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current)  clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, []);

  // ─── PHASE TRANSITIONS ────────────────────────────────────────────────────
  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    await initAudio();
    sfx.click();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    phaseRef.current = 'countdown';
    setPhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => {
    startLoop();
  }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    phaseRef.current = 'start';
    setPhase('start');
    setScoreDisplay(0);
    setStreakDisplay(0);
    setTimeLeft(DURATION);
    setFinalSig(null);
  
    setIsNewBest(false);
    setStreak(0);
    prevScoreRef.current = 0;
  }, []);

  // ─── END SCREEN INSIGHTS ─────────────────────────────────────────────────
  const buildInsights = (sig: Signals) => {
    // timingOffsets now stores actual ms from peak (only for peaked detonations)
    const avgTiming =
      sig.timingOffsets.length > 0
        ? Math.round(sig.timingOffsets.reduce((a, b) => a + b, 0) / sig.timingOffsets.length)
        : 0;
    const accuracy =
      sig.totalLaunched > 0
        ? Math.round((sig.perfectDetonations / sig.totalLaunched) * 100)
        : 0;

    return [
      {
        label: 'Fireworks Launched',
        value: String(sig.totalLaunched),
        color: ACCENT,
      },
      {
        label: 'Perfect Shots',
        value: String(sig.perfectDetonations),
        color: sig.perfectDetonations >= 5 ? '#4ade80' : '#facc15',
      },
      {
        label: 'Best Streak',
        value: `×${sig.maxStreak}`,
        color: sig.maxStreak >= 3 ? '#4ade80' : ACCENT,
      },
      {
        label: 'Avg Timing',
        value: avgTiming > 0 ? `${avgTiming}ms off` : '—',
        color: avgTiming < 150 ? '#4ade80' : avgTiming < 350 ? '#facc15' : '#ef4444',
      },
    ];
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <>
      {phase === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="firework-launch"
          steps={[{ icon: "☝️", title: "Swipe UP to launch", body: "Swipe upward from the bottom of the screen to fire a rocket." }, { icon: "💥", title: "Tap to detonate", body: "Tap anywhere while the rocket is in the air to explode it." }, { icon: "🎯", title: "Peak = more points", body: "Detonate at the top of the arc for a PERFECT score and streak bonus." }]}
          onDone={() => setShowInstructions(false)}
        />
      )}
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>

      {/* ── Start Screen ──────────────────────────────────────────────────── */}
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Launch 🎆"
          accentColor={theme.colors.accent ?? ACCENT}
          ctaTextColor="#000"
          onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #0a0818 0%, #060510 55%, #020208 100%)"
        />
      )}

      {/* ── Countdown ─────────────────────────────────────────────────────── */}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}

      {/* ── Playing ───────────────────────────────────────────────────────── */}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              touchAction: 'none',
            }}
          />
          {phase === 'playing' && (
            <GameHUD
              accentColor={theme.colors.accent ?? ACCENT}
              items={[
                { label: 'TIME', value: timeLeft, danger: timeLeft <= 10 },
                { label: 'SCORE 🎆', value: scoreDisplay },
                { label: 'STREAK ✨', value: streakDisplay },
              ]}
            />
          )}
        </>
      )}
      {/* New best banner */}
      <AnimatePresence>
        {isNewBest && (
          <motion.div
            key="new-best"
            initial={{ opacity: 0, y: -20, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, delay: 0.5 }}
            style={{
              position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)',
              zIndex: 90, pointerEvents: 'none',
              background: 'linear-gradient(135deg, #fbbf24, #f59e0b)',
              borderRadius: 20, padding: '8px 20px', fontSize: 20,
              fontWeight: 900, color: '#000', whiteSpace: 'nowrap',
              boxShadow: '0 4px 20px rgba(251,191,36,0.5)',
            }}
          >
            🏆 New Best!
          </motion.div>
        )}
      </AnimatePresence>



      {/* ── End Screen ────────────────────────────────────────────────────── */}
      {phase === 'done' && finalSig && (
        <EndScreen
          gameId={GAME_ID}
          title={getPersonality(finalSig)}
          emoji={GAME_EMOJI}
          score={String(finalSig.score)}
          personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)}
          accentColor={theme.colors.accent ?? ACCENT}
          onPlayAgain={handlePlayAgain}
          didWin={finalSig.score >= 15}
        />
      )}

      {/* ── Webhook ───────────────────────────────────────────────────────── */}
      {phase === 'done' && finalSig && (
        <WebhookEmitter
          theme={theme}
          gameId={GAME_ID}
          sig={finalSig}
          personality={getPersonality(finalSig)}
          player={playerSessionRef.current}
        />
      )}
      {phase === 'playing' && (
        <>
          <ScorePopEffect pops={pops} accentColor={CATEGORY_ACCENT} />
          <StreakBadge streak={streakDisplay} accentColor={CATEGORY_ACCENT} />
        </>
      )}
    </GameShell>
    </>
  );
}

// ─── WEBHOOK EMITTER ─────────────────────────────────────────────────────────
function WebhookEmitter({
  theme,
  gameId,
  sig,
  personality,
  player,
}: {
  theme: ReturnType<typeof useBrandTheme>;
  gameId: string;
  sig: Signals;
  personality: string;
  player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    // timingOffsets stores actual ms from peak — compute true avgTimingMs
    const avgTiming =
      sig.timingOffsets.length > 0
        ? Math.round(sig.timingOffsets.reduce((a, b) => a + b, 0) / sig.timingOffsets.length)
        : null;
    postWebhook(
      theme,
      gameId,
      {
        personality,
        score:              sig.score,
        perfectDetonations: sig.perfectDetonations,
        totalLaunched:      sig.totalLaunched,
        maxStreak:          sig.maxStreak,
        combosBurst:        sig.combosBurst,
        avgTimingMs:        avgTiming,
      },
      player,
    );
  }, [theme, gameId, sig, personality, player]);
  return null;
}
