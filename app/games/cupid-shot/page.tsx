/**
 * ══════════════════════════════════════════════════════════════════
 *  CUPID SHOT — Valentine's Day precision timing game
 *  Holiday: valentines | Sensor: touch | Duration: 45s
 *  A heart oscillates across screen — tap when it aligns with the bullseye.
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

const GAME_ID      = 'cupid-shot';
const PB_KEY       = 'pb_cupid-shot';
const ACCENT       = '#f43f5e';
const DURATION     = 45;
const GAME_EMOJI   = '💘';
const GAME_TITLE   = 'Cupid Shot';
const GAME_TAGLINE = 'Aim. Wait. Shoot at the perfect moment.';

const HEART_SIZE    = 30;  // radius-equivalent for the heart path
const RELOAD_MS     = 1500;
const GOLDEN_CHANCE = 0.10;
const MAX_PARTICLES = 180;
const TRAIL_LENGTH  = 14;

/** Progression stages: seconds elapsed → target count + oscillation speed */
const PROGRESSION: Array<{ atSecond: number; count: number; speed: number; label: string }> = [
  { atSecond: 0,  count: 1, speed: 1.0, label: 'Finding love…' },
  { atSecond: 15, count: 2, speed: 1.4, label: 'Hearts racing!' },
  { atSecond: 30, count: 3, speed: 1.8, label: 'Love is complicated' },
];

/** Score tiers based on |targetX - bullseyeX| */
const TIERS: Array<{ maxDist: number; pts: number; label: string; color: string }> = [
  { maxDist: 15,       pts: 5, label: "CUPID'S ARROW 💘", color: '#fbbf24' },
  { maxDist: 30,       pts: 3, label: 'LOVE SHOT 💕',     color: '#f43f5e' },
  { maxDist: 55,       pts: 1, label: 'CLOSE ❤️',         color: '#fb7185' },
  { maxDist: Infinity, pts: 0, label: 'MISSED 💔',        color: '#6b7280' },
];

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface HeartTarget {
  id: number;
  /** Oscillation phase offset (radians) — keeps targets out of sync */
  phase: number;
  /** Vertical position as fraction of canvas height (fixed per target) */
  yFrac: number;
  /** Base oscillation speed multiplier */
  baseSpeed: number;
  isGolden: boolean;
  /** Timestamp when the reload cooldown ends (0 = ready to shoot) */
  reloadUntil: number;
  /** Timestamp when the hit-flash animation ends */
  flashUntil: number;
  /** Whether this target slot is currently active */
  active: boolean;
  /** Current computed canvas X (updated every frame) */
  x: number;
  /** Current computed canvas Y (computed from yFrac every frame) */
  y: number;
  /** Recent position history for trail rendering */
  trail: Array<{ x: number; y: number }>;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;   // 1 → 0
  decay: number;  // subtracted from life each frame
  color: string;
  size: number;
  rotation: number;
  rotSpeed: number;
  type: 'petal' | 'burst' | 'shard';
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;   // 1 → 0
  vy: number;
  scale: number;
}

interface ArrowAnim {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  progress: number;  // 0 → 1
  color: string;
}

interface Signals {
  score: number;
  bullseyes: number;
  shotsTotal: number;
  hitShots: number;      // shots that scored ≥ 1 pt
  maxStreak: number;
  streakCurrent: number;
  goldenHearts: number;
}

interface GState {
  running: boolean;
  timeLeft: number;
  elapsedMs: number;
  targets: HeartTarget[];
  particles: Particle[];
  floats: FloatText[];
  arrows: ArrowAnim[];
  sig: Signals;
  lastTs: number;
  progressPhase: number;
  bullseyePulse: number;
  petalTimer: number;
}

type GamePhase = 'start' | 'countdown' | 'playing' | 'done';

// ─── CANVAS HELPERS ───────────────────────────────────────────────────────────

/**
 * Draw a heart shape centered at (cx, cy) with approximate radius r.
 * Uses two bezier curves — one for each lobe.
 */
function heartPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.beginPath();
  // Bottom tip of the heart
  ctx.moveTo(cx, cy + r * 0.75);
  // Left lobe
  ctx.bezierCurveTo(
    cx - r * 1.75, cy + r * 0.2,
    cx - r * 1.75, cy - r * 0.75,
    cx, cy - r * 0.2,
  );
  // Right lobe
  ctx.bezierCurveTo(
    cx + r * 1.75, cy - r * 0.75,
    cx + r * 1.75, cy + r * 0.2,
    cx, cy + r * 0.75,
  );
  ctx.closePath();
}

// ─── PARTICLE FACTORY ─────────────────────────────────────────────────────────

function spawnPetal(W: number): Particle {
  const petalColors = ['#f43f5e', '#fb7185', '#fda4af', '#fecdd3', '#fbbf24', '#f9a8d4'];
  return {
    x: Math.random() * W,
    y: -20,
    vx: (Math.random() - 0.5) * 1.4,
    vy: 0.6 + Math.random() * 1.2,
    life: 1,
    decay: 0.0015 + Math.random() * 0.0015,
    color: petalColors[Math.floor(Math.random() * petalColors.length)],
    size: 7 + Math.random() * 9,
    rotation: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.06,
    type: 'petal',
  };
}

function spawnBurst(x: number, y: number, isGolden: boolean): Particle[] {
  const pts: Particle[] = [];
  const count = 12 + Math.floor(Math.random() * 6);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
    const speed = 2.5 + Math.random() * 4;
    pts.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1,
      life: 1,
      decay: 0.022 + Math.random() * 0.018,
      color: isGolden ? '#fbbf24' : (Math.random() > 0.4 ? '#f43f5e' : '#fb7185'),
      size: 4 + Math.random() * 7,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.18,
      type: 'burst',
    });
  }
  return pts;
}

function spawnShards(x: number, y: number): Particle[] {
  const pts: Particle[] = [];
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.random() * 0.8;
    const speed = 1.8 + Math.random() * 2.5;
    pts.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      decay: 0.014 + Math.random() * 0.012,
      color: '#9ca3af',
      size: 7 + Math.random() * 6,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.22,
      type: 'shard',
    });
  }
  return pts;
}

// ─── INITIAL STATE FACTORY ────────────────────────────────────────────────────

function makeTargets(): HeartTarget[] {
  // Three target slots with different phases and vertical positions
  const phases = [0, Math.PI * 0.7, Math.PI * 1.35];
  const yFracs = [0.38, 0.57, 0.73];
  return [0, 1, 2].map(i => ({
    id: i,
    phase: phases[i],
    yFrac: yFracs[i],
    baseSpeed: 1.0,
    isGolden: Math.random() < GOLDEN_CHANCE,
    reloadUntil: 0,
    flashUntil: 0,
    active: i === 0,  // only first target starts active
    x: 0,
    y: 0,
    trail: [],
  }));
}

function makeSig(): Signals {
  return {
    score: 0,
    bullseyes: 0,
    shotsTotal: 0,
    hitShots: 0,
    maxStreak: 0,
    streakCurrent: 0,
    goldenHearts: 0,
  };
}

// ─── PERSONALITY ──────────────────────────────────────────────────────────────

function getPersonality(sig: Signals): string {
  const acc = sig.shotsTotal > 0 ? (sig.hitShots / sig.shotsTotal) * 100 : 0;
  if (sig.bullseyes >= 8 && acc >= 80)          return 'Cupid Himself 💘';
  if (sig.goldenHearts >= 2 && sig.bullseyes >= 5) return 'True Love ❤️‍🔥';
  if (acc >= 85)                                  return 'Sharpshooter 🏹';
  if (sig.shotsTotal >= 20 && sig.score >= 20)   return 'Hopeless Romantic 💕';
  return 'Still Searching 💔';
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function CupidShot() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const phaseRef     = useRef<GamePhase>('start');

  // ⚠️ All mutable game state lives in one ref — never useState inside rAF
  const stateRef = useRef<GState>({
    running: false,
    timeLeft: DURATION,
    elapsedMs: 0,
    targets: [],
    particles: [],
    floats: [],
    arrows: [],
    sig: makeSig(),
    lastTs: 0,
    progressPhase: 0,
    bullseyePulse: 0,
    petalTimer: 0,
  });

  // Only React state values that drive re-renders
  const [gamePhase, setGamePhase]       = useState<GamePhase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);

  const [arrowsDisplay, setArrowsDisplay] = useState(0);  // tracks shotsTotal for HUD

  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
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
  }, [scoreDisplay]);
  const playerSessionRef                = useRef<PlayerSession | null>(null);
  const warningFiredRef                 = useRef(false);

  // Keep phaseRef in sync so canvas pointer listener can check without stale closure
  useEffect(() => { phaseRef.current = gamePhase; }, [gamePhase]);

  // End screen completion sound — fires once when game transitions to 'done'
  useEffect(() => {
    if (gamePhase !== 'done' || !finalSig) return;
    const t = setTimeout(() => {
      if (finalSig.score >= 30) {
        sfx.success();   // rewarding arpeggio for a strong score
      } else {
        sfx.shimmer();   // softer chime for low/no score
      }
    }, 380); // brief delay — lets the fail/time-up sound clear first
    return () => clearTimeout(t);
  }, [gamePhase, finalSig]);

  // Sync brand accent into a ref so rAF can read it without stale closure issues
  const accentRef = useRef(ACCENT);
  useEffect(() => { accentRef.current = theme.colors.accent ?? ACCENT; }, [theme]);

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
    setGamePhase('done');
  }, []);

  // ─── GAME LOOP ───────────────────────────────────────────────────────────

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const s = stateRef.current;

    // ── Reset all state ──
    s.running       = true;
    s.timeLeft      = DURATION;
    s.elapsedMs     = 0;
    s.sig           = makeSig();
    s.progressPhase = 0;
    s.bullseyePulse = 0;
    s.petalTimer    = 0;
    s.particles     = [];
    s.floats        = [];
    s.arrows        = [];
    s.targets       = makeTargets();
    s.lastTs        = 0;
    warningFiredRef.current = false;

    setScoreDisplay(0);
    setArrowsDisplay(0);
    setTimeLeft(DURATION);
    setGamePhase('playing');

    stopMusicRef.current = startMusic('calm');

    // 1-second countdown via setInterval (animation via rAF only)
    timerRef.current = setInterval(() => {
      const st = stateRef.current;
      st.timeLeft--;
      setTimeLeft(st.timeLeft);
      // Timer warning: audio + haptic at 10s remaining
      if (st.timeLeft === 10 && !warningFiredRef.current) {
        warningFiredRef.current = true;
        sfx.warning();
        haptic([50, 30, 50]);
      }
      if (st.timeLeft <= 0) {
        sfx.fail();
        haptic([300]);
        endGame();
      }
    }, 1000);

    // ─── rAF LOOP ──────────────────────────────────────────────────────────
    const loop = (ts: number) => {
      if (!s.running) return;

      const dt = s.lastTs > 0 ? Math.min(ts - s.lastTs, 50) : 16.67;
      s.lastTs     = ts;
      s.elapsedMs += dt;

      const W           = canvas.offsetWidth;
      const H           = canvas.offsetHeight;
      const elapsedSec  = s.elapsedMs / 1000;
      const bullseyeX   = W / 2;
      const bullseyeY   = H * 0.42;
      const amplitude   = (W / 2) * 0.76;

      // ── Progression phase check ────────────────────────────────────────
      let curPhase = 0;
      for (let i = PROGRESSION.length - 1; i >= 0; i--) {
        if (elapsedSec >= PROGRESSION[i].atSecond) { curPhase = i; break; }
      }
      if (curPhase !== s.progressPhase) {
        s.progressPhase = curPhase;
        const prog = PROGRESSION[curPhase];
        for (let i = 0; i < s.targets.length; i++) {
          const wasActive = s.targets[i].active;
          s.targets[i].active    = i < prog.count;
          s.targets[i].baseSpeed = prog.speed;
          // New targets that just unlocked: randomize golden
          if (!wasActive && s.targets[i].active) {
            s.targets[i].isGolden    = Math.random() < GOLDEN_CHANCE;
            s.targets[i].reloadUntil = 0;
            s.targets[i].trail       = [];
          }
        }
      }

      // ── Update target positions ────────────────────────────────────────
      const now = Date.now();
      for (const t of s.targets) {
        if (!t.active) continue;
        const speedMult = t.isGolden ? 1.6 : 1.0;
        t.x = bullseyeX + Math.sin(elapsedSec * t.baseSpeed * speedMult + t.phase) * amplitude;
        t.y = H * t.yFrac;
        // Trail
        t.trail.unshift({ x: t.x, y: t.y });
        if (t.trail.length > TRAIL_LENGTH) t.trail.pop();
      }

      // ── Bullseye pulse ─────────────────────────────────────────────────
      s.bullseyePulse = (s.bullseyePulse + dt * 0.004) % (Math.PI * 2);

      // ── Rose petal spawn ───────────────────────────────────────────────
      s.petalTimer -= dt;
      if (s.petalTimer <= 0) {
        const petalCount = s.particles.filter(p => p.type === 'petal').length;
        if (petalCount < 28) {
          s.particles.push(spawnPetal(W));
        }
        s.petalTimer = 500 + Math.random() * 400;
      }

      // ── Update particles ───────────────────────────────────────────────
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const p = s.particles[i];
        p.x        += p.vx;
        p.y        += p.vy;
        p.rotation += p.rotSpeed;
        p.life     -= p.decay;
        if (p.life <= 0 || p.y > H + 40) {
          s.particles.splice(i, 1);
        }
      }
      if (s.particles.length > MAX_PARTICLES) {
        s.particles.splice(0, s.particles.length - MAX_PARTICLES);
      }

      // ── Update float texts ─────────────────────────────────────────────
      for (let i = s.floats.length - 1; i >= 0; i--) {
        const f = s.floats[i];
        f.y    += f.vy;
        f.life -= 0.016;
        if (f.life <= 0) s.floats.splice(i, 1);
      }

      // ── Update arrow animations ────────────────────────────────────────
      for (let i = s.arrows.length - 1; i >= 0; i--) {
        s.arrows[i].progress += dt / 260;
        if (s.arrows[i].progress >= 1) s.arrows.splice(i, 1);
      }

      // ════════════════════════════════════════════════════════════════════
      //  DRAW
      // ════════════════════════════════════════════════════════════════════

      ctx.imageSmoothingEnabled = true;

      // ── Background ────────────────────────────────────────────────────
      ctx.fillStyle = '#0f0508';
      ctx.fillRect(0, 0, W, H);

      // Pink radial glow centered at bullseye
      const glow = ctx.createRadialGradient(bullseyeX, bullseyeY, 0, bullseyeX, bullseyeY, W * 0.65);
      glow.addColorStop(0,   'rgba(244, 63, 94, 0.13)');
      glow.addColorStop(0.5, 'rgba(244, 63, 94, 0.05)');
      glow.addColorStop(1,   'rgba(15, 5, 8, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      // ── Rose petals (background layer) ────────────────────────────────
      for (const p of s.particles) {
        if (p.type !== 'petal') continue;
        ctx.save();
        ctx.globalAlpha = p.life * 0.65;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle   = p.color;
        ctx.shadowBlur  = 4;
        ctx.shadowColor = p.color;
        // Draw as a small elongated ellipse (petal shape)
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 0.35, p.size, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ── Bullseye (fixed at center) ─────────────────────────────────────
      const pulse = 1 + Math.sin(s.bullseyePulse) * 0.05;
      // Three concentric heart rings
      for (let ring = 3; ring >= 1; ring--) {
        const ringR   = ring * 24 * pulse;
        const alpha   = ring === 1 ? 0.85 : ring === 2 ? 0.5 : 0.22;
        const lWidth  = ring === 1 ? 2.5 : 1.5;
        const blur    = ring === 1 ? 14 : 7;
        ctx.save();
        ctx.globalAlpha  = alpha;
        ctx.strokeStyle  = '#f43f5e';
        ctx.lineWidth    = lWidth;
        ctx.shadowBlur   = blur;
        ctx.shadowColor  = '#f43f5e';
        heartPath(ctx, bullseyeX, bullseyeY, ringR);
        ctx.stroke();
        ctx.restore();
      }
      // Center dot
      ctx.save();
      ctx.fillStyle   = '#fbbf24';
      ctx.shadowBlur  = 18;
      ctx.shadowColor = '#fbbf24';
      ctx.beginPath();
      ctx.arc(bullseyeX, bullseyeY, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // ── Target trails ──────────────────────────────────────────────────
      for (const t of s.targets) {
        if (!t.active || t.trail.length < 2) continue;
        for (let i = 1; i < t.trail.length; i++) {
          const frac  = 1 - i / t.trail.length;
          const alpha = frac * 0.45;
          const size  = HEART_SIZE * 0.5 * frac;
          ctx.save();
          ctx.globalAlpha  = alpha;
          ctx.fillStyle    = t.isGolden ? '#fbbf24' : '#f43f5e';
          ctx.shadowBlur   = 6;
          ctx.shadowColor  = t.isGolden ? '#fde68a' : '#f43f5e';
          heartPath(ctx, t.trail[i].x, t.trail[i].y, size);
          ctx.fill();
          ctx.restore();
        }
      }

      // ── Heart targets ──────────────────────────────────────────────────
      for (const t of s.targets) {
        if (!t.active) continue;

        const isReloading = now < t.reloadUntil;
        const isFlashing  = now < t.flashUntil;

        // During reload (after flash), hide the heart
        if (isReloading && !isFlashing) continue;

        // Compute flash alpha oscillation
        let alpha = 1.0;
        if (isFlashing) {
          const elapsed = now - (t.flashUntil - 350);
          alpha = 0.35 + 0.65 * Math.abs(Math.sin((elapsed / 350) * Math.PI * 3));
        }

        const heartColor = t.isGolden ? '#fbbf24' : '#f43f5e';
        const glowColor  = t.isGolden ? '#fde68a' : '#fda4af';

        ctx.save();
        ctx.globalAlpha  = alpha;
        ctx.shadowBlur   = t.isGolden ? 28 : 20;
        ctx.shadowColor  = glowColor;
        ctx.fillStyle    = heartColor;
        heartPath(ctx, t.x, t.y, HEART_SIZE);
        ctx.fill();

        // Extra glow pass for golden hearts (sparkle feel)
        if (t.isGolden) {
          ctx.shadowBlur  = 40;
          ctx.shadowColor = '#fbbf24';
          ctx.globalAlpha = alpha * 0.4;
          heartPath(ctx, t.x, t.y, HEART_SIZE * 1.15);
          ctx.fill();
        }
        ctx.restore();
      }

      // ── Burst & shard particles (foreground) ──────────────────────────
      for (const p of s.particles) {
        if (p.type === 'petal') continue;
        ctx.save();
        ctx.globalAlpha = p.life;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);

        if (p.type === 'burst') {
          ctx.fillStyle   = p.color;
          ctx.shadowBlur  = 8;
          ctx.shadowColor = p.color;
          heartPath(ctx, 0, 0, p.size);
          ctx.fill();
        } else {
          // shard: small triangle fragment
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(0, -p.size);
          ctx.lineTo(p.size * 0.65, p.size * 0.55);
          ctx.lineTo(-p.size * 0.65, p.size * 0.55);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      // ── Arrow animations ───────────────────────────────────────────────
      for (const a of s.arrows) {
        const t    = Math.min(a.progress, 1);
        const ex   = a.fromX + (a.toX - a.fromX) * t;
        const ey   = a.fromY + (a.toY - a.fromY) * t;
        const fade = 1 - a.progress * 0.55;

        ctx.save();
        ctx.globalAlpha  = fade;
        ctx.strokeStyle  = a.color;
        ctx.lineWidth    = 2.5;
        ctx.shadowBlur   = 10;
        ctx.shadowColor  = a.color;
        ctx.lineCap      = 'round';

        // Shaft
        ctx.beginPath();
        ctx.moveTo(a.fromX, a.fromY);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        // Arrowhead
        if (a.progress > 0.05) {
          const angle   = Math.atan2(a.toY - a.fromY, a.toX - a.fromX);
          const headLen = 14;
          ctx.fillStyle    = a.color;
          ctx.shadowBlur   = 14;
          ctx.shadowColor  = a.color;
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(
            ex - headLen * Math.cos(angle - 0.42),
            ey - headLen * Math.sin(angle - 0.42),
          );
          ctx.lineTo(
            ex - headLen * Math.cos(angle + 0.42),
            ey - headLen * Math.sin(angle + 0.42),
          );
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      // ── Floating score texts ───────────────────────────────────────────
      for (const f of s.floats) {
        ctx.save();
        ctx.globalAlpha  = f.life;
        ctx.fillStyle    = f.color;
        ctx.shadowBlur   = 10;
        ctx.shadowColor  = f.color;
        ctx.font         = `900 ${Math.round(16 * f.scale)}px system-ui, sans-serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(f.text, f.x, f.y);
        ctx.restore();
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  // ─── TAP HANDLER ─────────────────────────────────────────────────────────

  const handleTap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    if (!s.running) return;

    const W          = canvas.offsetWidth;
    const H          = canvas.offsetHeight;
    const bullseyeX  = W / 2;
    const now        = Date.now();

    s.sig.shotsTotal++;

    let bestTierIdx: number = TIERS.length - 1;   // default = miss
    let bestTarget: HeartTarget | null = null;
    let anyHit = false;
    let goldenHit = false;  // set when a golden heart is scored — overrides tier audio

    // Evaluate all active, non-reloading targets
    for (const t of s.targets) {
      if (!t.active)          continue;
      if (now < t.reloadUntil) continue;  // still cooling down

      const dist = Math.abs(t.x - bullseyeX);

      // Find score tier
      let tierIdx = TIERS.length - 1;
      for (let i = 0; i < TIERS.length; i++) {
        if (dist <= TIERS[i].maxDist) { tierIdx = i; break; }
      }

      const tier       = TIERS[tierIdx];
      const multiplier = t.isGolden ? 3 : 1;
      const pts        = tier.pts * multiplier;

      if (pts > 0) {
        s.sig.score  += pts;
        s.sig.hitShots++;
        anyHit = true;

        if (tier.pts === 5)               s.sig.bullseyes++;
        if (t.isGolden && tier.pts >= 3) {
          s.sig.goldenHearts++;
          goldenHit = true;  // triggers sfx.defuse() per spec audio.goldenHeartSound
        }

        // Hit burst particles
        const bursts = spawnBurst(t.x, t.y, t.isGolden);
        s.particles.push(...bursts);
      } else {
        // Miss shard particles
        const shards = spawnShards(t.x, t.y);
        s.particles.push(...shards);
      }

      // Floating score label
      s.floats.push({
        x:     t.x,
        y:     t.y - 45,
        text:  t.isGolden && pts > 0 ? `TRUE LOVE 💛 ×${multiplier}` : tier.label,
        color: t.isGolden && pts > 0 ? '#fbbf24' : tier.color,
        life:  1,
        vy:    -1.3,
        scale: pts >= 5 ? 1.35 : 1,
      });

      // Set reload cooldown + flash
      t.reloadUntil = now + RELOAD_MS;
      t.flashUntil  = now + 350;

      // Track best-scoring target for the arrow
      if (bestTarget === null || tierIdx < bestTierIdx) {
        bestTierIdx = tierIdx;
        bestTarget  = t;
      }
    }

    // Streak tracking
    if (anyHit) {
      s.sig.streakCurrent++;
      if (s.sig.streakCurrent > s.sig.maxStreak) {
        s.sig.maxStreak = s.sig.streakCurrent;
      }
    } else {
      s.sig.streakCurrent = 0;
    }

    setScoreDisplay(s.sig.score);
    setArrowsDisplay(s.sig.shotsTotal);

    // Arrow animation from bottom-center toward the best-scoring target
    const arrowTarget = bestTarget ?? (s.targets.find(t => t.active) ?? null);
    if (arrowTarget) {
      s.arrows.push({
        fromX:    bullseyeX,
        fromY:    H,
        toX:      arrowTarget.x,
        toY:      arrowTarget.y,
        progress: 0,
        color:    TIERS[bestTierIdx].color,
      });
    }

    // Audio & haptics
    // Spec: goldenHeartSound = "defuse" — overrides tier audio when a golden heart is hit
    if (goldenHit) {
      sfx.defuse();
      haptic([30, 50, 30, 50, 100]);
    } else if (bestTierIdx === 0) {
      // Bullseye — best shot
      sfx.success();
    hapticVictory();
    playVictoryFanfare();
    } else if (bestTierIdx <= 2) {
      // Partial hit
      sfx.collect();
      haptic([30]);
    } else {
      // Miss
      sfx.nearMiss();
      haptic([40]);
    }
  }, []);

  // ─── CANVAS SETUP & RESIZE ───────────────────────────────────────────────

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
    };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (phaseRef.current !== 'playing') return;
      e.preventDefault();
      handleTap();
    };
    canvas.addEventListener('pointerdown', onPointerDown);

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
    };
  }, [handleTap]);

  // ─── CLEANUP ON UNMOUNT ──────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, []);

  // ─── PHASE TRANSITIONS ───────────────────────────────────────────────────

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    await initAudio();
    sfx.click();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    setGamePhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => {
    startLoop();
  }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    setGamePhase('start');
    setScoreDisplay(0);
    setArrowsDisplay(0);
    setTimeLeft(DURATION);
    setFinalSig(null);
  
    setIsNewBest(false);
    setStreak(0);
    prevScoreRef.current = 0;
  }, []);

  // ─── INSIGHTS ────────────────────────────────────────────────────────────

  function buildInsights(sig: Signals) {
    const acc = sig.shotsTotal > 0
      ? Math.round((sig.hitShots / sig.shotsTotal) * 100)
      : 0;
    return [
      {
        label: "Cupid's Arrows",
        value: String(sig.bullseyes),
        color: sig.bullseyes >= 5 ? '#fbbf24' : ACCENT,
      },
      {
        label: 'Accuracy',
        value: `${acc}%`,
        color: acc >= 70 ? '#4ade80' : acc >= 40 ? '#facc15' : '#ef4444',
      },
      {
        label: 'Love Score',
        value: String(sig.score),
        color: theme.colors.accent ?? ACCENT,
      },
      {
        label: 'Golden Hearts',
        value: String(sig.goldenHearts),
        color: sig.goldenHearts > 0 ? '#fbbf24' : 'rgba(255,255,255,0.4)',
      },
    ];
  }

  // ─── RENDER ──────────────────────────────────────────────────────────────

  const accent = theme.colors.accent ?? ACCENT;

  return (
    <>
      {gamePhase === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="cupid-shot"
          steps={[{ icon: "💘", title: "Aim with Cupid", body: "Tilt or swipe to aim Cupid's arrow." }, { icon: "❤️", title: "Hit the hearts", body: "Shoot your arrow to hit floating hearts." }, { icon: "🔥", title: "Chain shots", body: "Hit multiple hearts in a row for a combo bonus." }]}
          onDone={() => setShowInstructions(false)}
        />
      )}
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={accent}>

      {/* ── Start Screen ─────────────────────────────────────────────────── */}
      {gamePhase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Shoot Your Shot 🏹"
          accentColor={accent}
          onStart={handleStart}
        />
      )}

      {/* ── Countdown ────────────────────────────────────────────────────── */}
      {gamePhase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={accent} />
      )}

      {/* ── Playing (canvas + HUD) ────────────────────────────────────────── */}
      {(gamePhase === 'playing' || gamePhase === 'countdown') && (
        <>
          <canvas
            ref={canvasRef}
            style={{
              position:    'absolute',
              inset:       0,
              width:       '100%',
              height:      '100%',
              touchAction: 'none',
              cursor:      'crosshair',
            }}
          />
          {gamePhase === 'playing' && (
            <GameHUD
              accentColor={accent}
              items={[
                { label: 'TIME',          value: timeLeft,      danger: timeLeft <= 10 },
                { label: 'LOVE SCORE 💕', value: scoreDisplay },
                { label: 'ARROWS 🏹',     value: arrowsDisplay },
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



      {/* ── End Screen ───────────────────────────────────────────────────── */}
      {gamePhase === 'done' && finalSig && (
        <EndScreen
          gameId={GAME_ID}
          title={getPersonality(finalSig)}
          emoji={GAME_EMOJI}
          score={String(finalSig.score)}
          personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)}
          accentColor={accent}
          onPlayAgain={handlePlayAgain}
          didWin={finalSig.score >= 30}
        />
      )}

      {/* ── Webhook emitter ───────────────────────────────────────────────── */}
      {gamePhase === 'done' && finalSig && (
        <WebhookEmitter
          theme={theme}
          gameId={GAME_ID}
          sig={finalSig}
          personality={getPersonality(finalSig)}
          player={playerSessionRef.current}
        />
      )}

      {gamePhase === 'playing' && (
        <>
          <ScorePopEffect pops={pops} accentColor={CATEGORY_ACCENT} />
          <StreakBadge streak={streak} accentColor={CATEGORY_ACCENT} />
        </>
      )}
    </GameShell>
    </>
  );
}

// ─── WEBHOOK EMITTER ─────────────────────────────────────────────────────────
// Isolated component — postWebhook fires exactly once on mount.

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

    const acc = sig.shotsTotal > 0
      ? parseFloat((sig.hitShots / sig.shotsTotal).toFixed(3))
      : 0;

    postWebhook(
      theme,
      gameId,
      {
        personality,
        score:       sig.score,
        bullseyes:   sig.bullseyes,
        shotsTotal:  sig.shotsTotal,
        hitShots:    sig.hitShots,
        accuracy:    acc,
        maxStreak:   sig.maxStreak,
        goldenHearts: sig.goldenHearts,
      },
      player,
    );
  }, [theme, gameId, sig, personality, player]);

  return null;
}
