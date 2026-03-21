/**
 * ════════════════════════════════════════════════════════════════════
 *  ETHER MINI-GAMES — Snow Catch ❄️
 *  Holiday Christmas tilt-catch game.
 *  Canvas-based. DeviceOrientation tilt → basket movement.
 *  Three item types: snowflake (+1), golden flake (+3), icicle (-2).
 *  BLIZZARD event at 22s elapsed — 5s of chaos.
 * ════════════════════════════════════════════════════════════════════
 */

'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import GameShell from '@/components/GameShell';
import GameHUD from '@/components/GameHUD';
import GameStartScreen from '@/components/GameStartScreen';
import Countdown from '@/components/Countdown';
import EndScreen from '@/components/EndScreen';
import { initAudio, sfx, haptic, startMusic, increaseMusicTempo } from '@/lib/audio';
import { playScoreHit, playVictoryFanfare, playNearMiss } from '@/lib/audio';
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { createTiltController } from '@/lib/tilt';
import { ShakeState, triggerShake, applyShake } from '@/lib/screenShake';
import { Particle, spawnBurst, updateAndDrawParticles } from '@/lib/particles';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import { CATEGORY_THEMES } from '@/lib/theme';
import SwipeInstructions from '@/components/SwipeInstructions';

const CATEGORY_ACCENT = CATEGORY_THEMES.holiday.primaryAccent;

// ─── SPEC CONSTANTS ──────────────────────────────────────────────────────────

const GAME_ID        = 'snow-catch';
const PB_KEY       = 'pb_snow-catch';
const ACCENT         = '#93c5fd';
const DURATION       = 45;
const GAME_EMOJI     = '❄️';
const GAME_TITLE     = 'Snow Catch';
const GAME_TAGLINE   = 'Tilt to catch the snow. Dodge the icicles!';
const BASKET_WIDTH   = 80;
const BASKET_HEIGHT  = 46;
const BASKET_Y_FROM_BOTTOM = 88;   // px from canvas bottom to basket center
const TILT_SPEED     = 7;          // px/frame at full tilt (sensitivity applied separately)
const SPAWN_NORMAL   = 800;        // ms
const SPAWN_BLIZZARD = 200;        // ms
const BLIZZARD_AT    = 22;         // seconds elapsed
const BLIZZARD_DURATION = 5;       // seconds

// ─── TYPES ───────────────────────────────────────────────────────────────────

type FlakeType = 'snowflake' | 'golden_flake' | 'icicle';

interface Flake {
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: FlakeType;
  size: number;
  rotation: number;
  rotationSpeed: number;
}

interface Signals {
  score: number;
  goldenCaught: number;
  iciclesHit: number;
  maxStreak: number;
  blizzardSurvived: boolean;
  totalMissed: number;
  streakCurrent: number;
}

// ─── PERSONALITY CLASSIFICATION ──────────────────────────────────────────────

function getPersonality(sig: Signals): string {
  if (sig.blizzardSurvived && sig.score >= 25) return 'Blizzard Survivor 🌨️';
  if (sig.score >= 35 && sig.iciclesHit === 0)  return 'Snow Magnet ❄️';
  if (sig.goldenCaught >= 3)                    return 'Golden Hunter ✨';
  if (sig.score >= 20)                          return 'Winter Warrior 🧊';
  return 'First Snowfall 🌱';
}

// ─── GAME STATE ───────────────────────────────────────────────────────────────

interface GameState {
  running: boolean;
  timeLeft: number;
  elapsed: number;
  sig: Signals;
  flakes: Flake[];
  particles: Particle[];
  basketX: number;
  lastSpawnTime: number;
  shake: ShakeState;
  blizzardActive: boolean;
  blizzardOverlayAlpha: number;
  redFlashAlpha: number;
  scoreBeforeBlizzard: number;
  touchTargetX: number | null;
  useTouchFallback: boolean;
  accentColor: string;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ─── PURE DRAWING HELPERS ─────────────────────────────────────────────────────

function drawSnowflake(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, size: number, rotation: number,
  color: string, glow: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, size * 0.13);
  ctx.lineCap = 'round';
  if (glow) {
    ctx.shadowBlur = size * 2;
    ctx.shadowColor = color;
  }
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Main arm
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(cos * size, sin * size);
    ctx.stroke();
    // Side branches
    const mid = size * 0.55;
    const arm = size * 0.26;
    ctx.beginPath();
    ctx.moveTo(cos * mid - sin * arm, sin * mid + cos * arm);
    ctx.lineTo(cos * mid, sin * mid);
    ctx.lineTo(cos * mid + sin * arm, sin * mid - cos * arm);
    ctx.stroke();
  }
  ctx.restore();
}

function drawIcicle(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, size: number, rotation: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  const h = size * 2.6;
  const w = size * 0.75;
  ctx.shadowBlur = 10;
  ctx.shadowColor = '#74c0fc';
  ctx.fillStyle = '#a5d8ff';
  ctx.strokeStyle = '#74c0fc';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.5);           // tip (pointing down)
  ctx.lineTo(-w * 0.5, -h * 0.5);  // top-left
  ctx.lineTo(w * 0.5, -h * 0.5);   // top-right
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Shine streak
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-w * 0.15, -h * 0.4);
  ctx.lineTo(-w * 0.05, h * 0.1);
  ctx.stroke();
  ctx.restore();
}

function drawBasket(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, width: number, accentColor: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  const r   = width * 0.52;
  const bh  = BASKET_HEIGHT * 0.58;
  // Drop shadow
  ctx.shadowBlur   = 18;
  ctx.shadowColor  = accentColor + '88';
  // Sack body
  ctx.fillStyle = '#b91c1c';
  ctx.beginPath();
  ctx.ellipse(0, 0, r, bh, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  // Fabric shading
  ctx.fillStyle = '#991b1b';
  ctx.beginPath();
  ctx.ellipse(r * 0.15, bh * 0.15, r * 0.65, bh * 0.55, 0.3, 0, Math.PI * 2);
  ctx.fill();
  // Highlight
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.22, -bh * 0.18, r * 0.28, bh * 0.28, -0.3, 0, Math.PI * 2);
  ctx.fill();
  // Belt / tie
  ctx.fillStyle = '#d97706';
  ctx.beginPath();
  ctx.ellipse(0, -bh * 0.48, r * 0.45, bh * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  // Knot
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath();
  ctx.arc(0, -bh * 0.56, bh * 0.12, 0, Math.PI * 2);
  ctx.fill();
  // Rim glow ring
  ctx.strokeStyle = accentColor + 'bb';
  ctx.lineWidth   = 2;
  ctx.shadowBlur  = 14;
  ctx.shadowColor = accentColor;
  ctx.beginPath();
  ctx.ellipse(0, 0, r + 5, bh + 5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawMountainSilhouette(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
): void {
  // Distant mountains — dark layer behind gameplay
  ctx.fillStyle = '#080f1a';
  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(0, H * 0.74);
  ctx.lineTo(W * 0.08, H * 0.60);
  ctx.lineTo(W * 0.16, H * 0.74);
  ctx.lineTo(W * 0.27, H * 0.54);
  ctx.lineTo(W * 0.36, H * 0.70);
  ctx.lineTo(W * 0.50, H * 0.50);
  ctx.lineTo(W * 0.64, H * 0.68);
  ctx.lineTo(W * 0.73, H * 0.57);
  ctx.lineTo(W * 0.82, H * 0.74);
  ctx.lineTo(W * 0.92, H * 0.62);
  ctx.lineTo(W,         H * 0.70);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();

  // Snow caps on mountain peaks
  ctx.fillStyle = 'rgba(180, 210, 255, 0.18)';
  const peaks: Array<[number, number]> = [
    [W * 0.27, H * 0.54],
    [W * 0.50, H * 0.50],
    [W * 0.73, H * 0.57],
  ];
  for (const [px, py] of peaks) {
    const capW = W * 0.06;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - capW, py + capW * 0.7);
    ctx.lineTo(px + capW, py + capW * 0.7);
    ctx.closePath();
    ctx.fill();
  }

  // Village silhouette strip
  ctx.fillStyle = '#060d17';
  const vy = H * 0.86;
  // House 1
  const h1x = W * 0.10;
  ctx.fillRect(h1x, vy, 20, 14);
  ctx.beginPath();
  ctx.moveTo(h1x - 3, vy); ctx.lineTo(h1x + 10, vy - 11); ctx.lineTo(h1x + 23, vy);
  ctx.fill();
  // House 2
  const h2x = W * 0.32;
  ctx.fillRect(h2x, vy - 2, 24, 16);
  ctx.beginPath();
  ctx.moveTo(h2x - 2, vy - 2); ctx.lineTo(h2x + 12, vy - 16); ctx.lineTo(h2x + 26, vy - 2);
  ctx.fill();
  // Church
  const tx = W * 0.58;
  ctx.fillRect(tx, vy - 4, 16, 18);
  ctx.fillRect(tx + 5, vy - 18, 6, 14);   // steeple
  ctx.fillRect(tx + 6, vy - 24, 4, 8);    // spire
  // House 3
  const h3x = W * 0.78;
  ctx.fillRect(h3x, vy, 22, 12);
  ctx.beginPath();
  ctx.moveTo(h3x - 2, vy); ctx.lineTo(h3x + 11, vy - 10); ctx.lineTo(h3x + 24, vy);
  ctx.fill();
  // Warm window glows
  ctx.fillStyle = 'rgba(255, 200, 80, 0.55)';
  ctx.fillRect(h1x + 4,  vy + 3,  6, 5);
  ctx.fillRect(h2x + 5,  vy + 2,  7, 6);
  ctx.fillRect(h2x + 14, vy + 2,  6, 6);
  ctx.fillRect(tx + 2,   vy + 2,  5, 5);
  ctx.fillRect(tx + 9,   vy + 2,  4, 5);
  ctx.fillRect(h3x + 4,  vy + 2,  6, 5);
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function SnowCatchGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const tiltRef      = useRef<ReturnType<typeof createTiltController> | null>(null);

  // ⚠️ All mutable game state in one ref — never in useState (stale closures in rAF)
  const stateRef = useRef<GameState>({
    running:              false,
    timeLeft:             DURATION,
    elapsed:              0,
    sig: {
      score: 0, goldenCaught: 0, iciclesHit: 0,
      maxStreak: 0, blizzardSurvived: false, totalMissed: 0, streakCurrent: 0,
    },
    flakes:               [],
    particles:            [],
    basketX:              0,
    lastSpawnTime:        0,
    shake:                { intensity: 0, duration: 0 },
    blizzardActive:       false,
    blizzardOverlayAlpha: 0,
    redFlashAlpha:        0,
    scoreBeforeBlizzard:  0,
    touchTargetX:         null,
    useTouchFallback:     false,
    accentColor:          ACCENT,
  });

  // React state — HUD values only
  const [phase, setPhase]               = useState<Phase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [streakDisplay, setStreakDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
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
  }, [scoreDisplay]); // triggerPop is stable
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  // Sync brand theme accent colour into ref (so rAF picks it up)
  useEffect(() => {
    stateRef.current.accentColor = theme.colors.accent ?? ACCENT;
  }, [theme]);

  // ─── SPAWN FLAKE ─────────────────────────────────────────────────────────

  const spawnFlake = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rand = Math.random();
    let type: FlakeType;
    if (rand < 0.65)      type = 'snowflake';
    else if (rand < 0.85) type = 'icicle';
    else                  type = 'golden_flake';

    const size =
      type === 'golden_flake' ? 15 + Math.random() * 7
      : type === 'icicle'     ? 9  + Math.random() * 6
      :                         8  + Math.random() * 12;

    const speedMin = type === 'icicle' ? 4 : type === 'golden_flake' ? 3 : 2;
    const speedMax = type === 'icicle' ? 8 : type === 'golden_flake' ? 6 : 5;
    const vy = speedMin + Math.random() * (speedMax - speedMin);
    const vx = (Math.random() - 0.5) * 1.5;

    stateRef.current.flakes.push({
      x:             size + Math.random() * (canvas.offsetWidth - size * 2),
      y:             -size * 2,
      vx,
      vy,
      type,
      size,
      rotation:      Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.08,
    });
  }, []);

  // ─── END GAME ─────────────────────────────────────────────────────────────

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (tiltRef.current) { tiltRef.current.stop(); tiltRef.current = null; }
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
    setPhase('done');
  }, []);

  // ─── GAME LOOP ────────────────────────────────────────────────────────────

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;

    const s = stateRef.current;

    // Reset state
    s.running              = true;
    s.timeLeft             = DURATION;
    s.elapsed              = 0;
    s.sig                  = { score: 0, goldenCaught: 0, iciclesHit: 0, maxStreak: 0, blizzardSurvived: false, totalMissed: 0, streakCurrent: 0 };
    s.flakes               = [];
    s.particles            = [];
    s.basketX              = canvas.offsetWidth / 2;
    s.lastSpawnTime        = performance.now();
    s.shake                = { intensity: 0, duration: 0 };
    s.blizzardActive       = false;
    s.blizzardOverlayAlpha = 0;
    s.redFlashAlpha        = 0;
    s.scoreBeforeBlizzard  = 0;
    s.touchTargetX         = null;

    setScoreDisplay(0);
    setStreakDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');

    stopMusicRef.current = startMusic('calm');

    // 1-second countdown timer
    timerRef.current = setInterval(() => {
      s.timeLeft--;
      s.elapsed++;
      setTimeLeft(s.timeLeft);

      // Blizzard start
      if (s.elapsed === BLIZZARD_AT && !s.blizzardActive) {
        s.blizzardActive      = true;
        s.scoreBeforeBlizzard = s.sig.score;
        sfx.warning();
        haptic([50, 30, 50, 30, 50]);
        increaseMusicTempo(130); // ramp up music for blizzard
      }
      // Blizzard end
      if (s.elapsed === BLIZZARD_AT + BLIZZARD_DURATION && s.blizzardActive) {
        s.blizzardActive = false;
        if (s.sig.score > s.scoreBeforeBlizzard) s.sig.blizzardSurvived = true;
        increaseMusicTempo(60); // ramp back to calm tempo
      }

      // Timer warning and urgency ticks
      if (s.timeLeft === 10) {
        sfx.warning();
        haptic([50, 30, 50]);
      } else if (s.timeLeft <= 5 && s.timeLeft > 0) {
        sfx.tick();
        haptic([20]);
      }

      if (s.timeLeft <= 0) {
        sfx.success(); // timer completion — triumphant, not fail
        haptic([30, 50, 100, 50, 150]);
        endGame();
      }
    }, 1000);

    spawnFlake();

    const loop = (now: number) => {
      if (!s.running) return;
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;

      // ── Basket movement ────────────────────────────────────────────────
      const tilt = tiltRef.current;
      if (tilt && !s.useTouchFallback) {
        const { x } = tilt.getValues();
        s.basketX += x * TILT_SPEED * (W / 390);
      } else if (s.touchTargetX !== null) {
        s.basketX += (s.touchTargetX - s.basketX) * 0.25;
      }
      s.basketX = Math.max(BASKET_WIDTH / 2, Math.min(W - BASKET_WIDTH / 2, s.basketX));

      // ── Spawn flakes ──────────────────────────────────────────────────
      const spawnInterval = s.blizzardActive ? SPAWN_BLIZZARD : SPAWN_NORMAL;
      if (now - s.lastSpawnTime >= spawnInterval) {
        spawnFlake();
        if (s.blizzardActive) { spawnFlake(); spawnFlake(); }
        s.lastSpawnTime = now;
      }

      // ── Update & detect catch ─────────────────────────────────────────
      const basketBottom = H - BASKET_Y_FROM_BOTTOM + BASKET_HEIGHT * 0.5;
      const basketTop    = basketBottom - BASKET_HEIGHT;
      const halfW        = BASKET_WIDTH * 0.5;

      for (let i = s.flakes.length - 1; i >= 0; i--) {
        const f = s.flakes[i];
        f.y += f.vy;
        f.x += f.vx;
        f.rotation += f.rotationSpeed;
        if (f.x < 0 || f.x > W) f.vx *= -1;

        const flakeBottom = f.y + f.size;

        // Catch zone
        if (
          flakeBottom >= basketTop &&
          flakeBottom <= basketBottom + 12 &&
          f.x >= s.basketX - halfW - f.size * 0.4 &&
          f.x <= s.basketX + halfW + f.size * 0.4
        ) {
          if (f.type === 'icicle') {
            s.sig.iciclesHit++;
            s.sig.score = Math.max(0, s.sig.score - 2);
            s.sig.streakCurrent = 0;
            s.redFlashAlpha = 0.55;
            triggerShake(s.shake, 10, 14);
            sfx.collision();
            haptic([200]);
            spawnBurst(s.particles, f.x, f.y, '#ef4444', 8, 3);
            setScoreDisplay(s.sig.score);
            setStreakDisplay(0);
          } else {
            const pts = f.type === 'golden_flake' ? 3 : 1;
            s.sig.score += pts;
            s.sig.streakCurrent++;
            if (s.sig.streakCurrent > s.sig.maxStreak) s.sig.maxStreak = s.sig.streakCurrent;
            if (f.type === 'golden_flake') {
              s.sig.goldenCaught++;
              sfx.success();
              haptic([30, 50, 100]);
              spawnBurst(s.particles, f.x, f.y, '#fbbf24', 16, 5);
            } else {
              sfx.shimmer();
              haptic([15]);
              spawnBurst(s.particles, f.x, f.y, s.accentColor, 10, 4);
            }
            setScoreDisplay(s.sig.score);
            setStreakDisplay(s.sig.streakCurrent);
          }
          s.flakes.splice(i, 1);
          continue;
        }

        // Missed — fell off screen
        if (f.y - f.size > H) {
          s.sig.totalMissed++;
          s.sig.streakCurrent = 0;
          setStreakDisplay(0);
          s.flakes.splice(i, 1);
        }
      }

      // ── Render ────────────────────────────────────────────────────────
      ctx.save();
      applyShake(ctx, s.shake);

      // Background
      ctx.fillStyle = '#0d1b2a';
      ctx.fillRect(0, 0, W, H);

      // Twinkling stars
      for (let j = 0; j < 48; j++) {
        const sx = (j * 137.508 + 23) % W;
        const sy = (j * 97.31 + 11) % (H * 0.52);
        const twinkle = 0.3 + 0.7 * Math.abs(Math.sin(now * 0.0008 + j * 0.9));
        ctx.globalAlpha = twinkle;
        ctx.fillStyle = j % 5 === 0 ? '#fde68a' : 'rgba(200,220,255,0.8)';
        ctx.beginPath();
        ctx.arc(sx, sy, 0.5 + (j % 3) * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Moon
      ctx.save();
      ctx.shadowBlur  = 24;
      ctx.shadowColor = '#c7d2fe';
      ctx.fillStyle   = '#e0e7ff';
      ctx.beginPath();
      ctx.arc(W * 0.82, H * 0.10, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0d1b2a';
      ctx.beginPath();
      ctx.arc(W * 0.82 + 10, H * 0.10 - 5, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Mountain/village silhouette
      drawMountainSilhouette(ctx, W, H);

      // Flakes
      for (const f of s.flakes) {
        if (f.type === 'icicle') {
          drawIcicle(ctx, f.x, f.y, f.size, f.rotation);
        } else if (f.type === 'golden_flake') {
          drawSnowflake(ctx, f.x, f.y, f.size, f.rotation, '#fbbf24', true);
        } else {
          drawSnowflake(ctx, f.x, f.y, f.size, f.rotation, s.accentColor, false);
        }
      }

      // Particles
      updateAndDrawParticles(ctx, s.particles);

      // Basket
      drawBasket(ctx, s.basketX, H - BASKET_Y_FROM_BOTTOM, BASKET_WIDTH, s.accentColor);

      ctx.restore(); // un-shake

      // Red flash overlay (icicle hit)
      if (s.redFlashAlpha > 0) {
        ctx.fillStyle = `rgba(239,68,68,${s.redFlashAlpha.toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
        s.redFlashAlpha = Math.max(0, s.redFlashAlpha - 0.045);
      }

      // Blizzard overlay — fade in/out
      if (s.blizzardActive) {
        s.blizzardOverlayAlpha = Math.min(1, s.blizzardOverlayAlpha + 0.06);
      } else {
        s.blizzardOverlayAlpha = Math.max(0, s.blizzardOverlayAlpha - 0.04);
      }

      if (s.blizzardOverlayAlpha > 0.01) {
        // Wind streaks
        ctx.save();
        ctx.globalAlpha = s.blizzardOverlayAlpha * 0.28;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth   = 0.5;
        for (let j = 0; j < 22; j++) {
          const wx = ((j * 67.3 + now * 0.32) % (W + 60)) - 30;
          const wy = (j * 41.1 + now * 0.14) % H;
          ctx.beginPath();
          ctx.moveTo(wx, wy);
          ctx.lineTo(wx - 35, wy + 9);
          ctx.stroke();
        }
        ctx.restore();

        // BLIZZARD text
        if (s.blizzardActive) {
          const pulse = 0.75 + 0.25 * Math.sin(now * 0.012);
          ctx.save();
          ctx.globalAlpha = pulse * s.blizzardOverlayAlpha;
          ctx.fillStyle   = '#ffffff';
          ctx.shadowBlur  = 28;
          ctx.shadowColor = s.accentColor;
          ctx.font        = `bold ${Math.round(Math.max(18, W * 0.066))}px system-ui, sans-serif`;
          ctx.textAlign   = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('BLIZZARD! ❄️❄️❄️', W / 2, H * 0.22);
          ctx.restore();
          // Continuous mild shake during blizzard
          triggerShake(s.shake, 2, 2);
        }
      }

      // Touch fallback hint
      if (s.useTouchFallback) {
        ctx.save();
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = '#ffffff';
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Drag to move basket', W / 2, H - 8);
        ctx.restore();
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame, spawnFlake]);

  // ─── CANVAS SETUP & RESIZE ────────────────────────────────────────────────

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
      if (stateRef.current.running) {
        stateRef.current.basketX = Math.min(
          Math.max(stateRef.current.basketX, BASKET_WIDTH / 2),
          canvas.offsetWidth - BASKET_WIDTH / 2,
        );
      }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // ─── POINTER INPUT (touch fallback) ──────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onPointerMove = (e: PointerEvent) => {
      if (!stateRef.current.running) return;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.offsetWidth / rect.width);
      stateRef.current.touchTargetX  = x;
      stateRef.current.useTouchFallback = true;
    };
    canvas.addEventListener('pointermove', onPointerMove);
    return () => canvas.removeEventListener('pointermove', onPointerMove);
  }, []);

  // ─── CLEANUP ON UNMOUNT ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
      if (tiltRef.current) tiltRef.current.stop();
    };
  }, []);

  // ─── PHASE TRANSITIONS ────────────────────────────────────────────────────

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    initAudio();
    // Stop any prior tilt session from play-again
    if (tiltRef.current) { tiltRef.current.stop(); tiltRef.current = null; }
    stateRef.current.useTouchFallback = false;

    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);

    const controller = createTiltController(
      (_x: number, _y: number) => { /* values polled via getValues() in rAF */ },
      { sensitivity: 0.9, smoothing: 0.45, deadzone: 2, clamp: 30 },
    );
    const granted = await controller.start();
    tiltRef.current = controller;
    if (!granted) stateRef.current.useTouchFallback = true;

    setPhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => {
    startLoop();
  }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
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

  const buildInsights = (sig: Signals) => [
    {
      label: 'Snow Caught',
      value: String(sig.score),
      color: ACCENT,
    },
    {
      label: 'Golden Flakes',
      value: String(sig.goldenCaught),
      color: '#fbbf24',
    },
    {
      label: 'Icicles Hit',
      value: String(sig.iciclesHit),
      color: sig.iciclesHit === 0 ? '#4ade80' : '#ef4444',
    },
    {
      label: 'Max Streak',
      value: `×${sig.maxStreak}`,
      color: ACCENT,
    },
  ];

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <>
      {phase === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="snow-catch"
          steps={[{ icon: "❄️", title: "Catch the snowflakes", body: "Tilt your device to move the catcher left and right." }, { icon: "⭐", title: "Big flakes = more", body: "Larger snowflakes score more points." }, { icon: "🔥", title: "Build a streak", body: "Catch consecutive flakes without missing for a bonus." }]}
          onDone={() => setShowInstructions(false)}
        />
      )}
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>

      {/* ── Start Screen ─────────────────────────────────────────────────── */}
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Allow Motion & Start"
          sensorNote="Tilt your phone left/right to move the basket"
          accentColor={theme.colors.accent ?? ACCENT}
          onStart={handleStart}
        />
      )}

      {/* ── Countdown ────────────────────────────────────────────────────── */}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}

      {/* ── Playing ──────────────────────────────────────────────────────── */}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas
            ref={canvasRef}
            style={{
              position:    'absolute',
              inset:       0,
              width:       '100%',
              height:      '100%',
              touchAction: 'none',
            }}
          />
          {phase === 'playing' && (
            <GameHUD
              accentColor={theme.colors.accent ?? ACCENT}
              items={[
                { label: 'TIME',       value: timeLeft,      danger: timeLeft <= 10 },
                { label: 'CAUGHT', value: scoreDisplay },
                { label: 'STREAK',     value: streakDisplay },
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

      {/* ── Webhook (fires once on mount) ────────────────────────────────── */}
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

// ─── WEBHOOK EMITTER ──────────────────────────────────────────────────────────

function WebhookEmitter({
  theme, gameId, sig, personality, player,
}: {
  theme:       ReturnType<typeof useBrandTheme>;
  gameId:      string;
  sig:         Signals;
  personality: string;
  player:      PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    postWebhook(theme, gameId, {
      personality,
      score:            sig.score,
      goldenCaught:     sig.goldenCaught,
      iciclesHit:       sig.iciclesHit,
      maxStreak:        sig.maxStreak,
      totalMissed:      sig.totalMissed,
      blizzardSurvived: sig.blizzardSurvived,
      streakCurrent:    sig.streakCurrent,
    }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
