/**
 * ══════════════════════════════════════════════════════════════════
 *  DODGE BLITZ — Ether Glimmer
 *  Tilt to survive. Don't stop moving.
 *  Sensor: motion (DeviceOrientationEvent) with touch fallback
 * ══════════════════════════════════════════════════════════════════
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
import { Particle, spawnBurst, updateAndDrawParticles } from '@/lib/particles';
import { ShakeState, triggerShake, applyShake } from '@/lib/screenShake';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import { CATEGORY_THEMES } from '@/lib/theme';
import SwipeInstructions from '@/components/SwipeInstructions';

const CATEGORY_ACCENT = CATEGORY_THEMES.sports.primaryAccent;

// ─── SPRITE CACHE ─────────────────────────────────────────────────────────────
const _spriteCache = new Map<string, HTMLImageElement>();
function _loadSprite(src: string): HTMLImageElement {
  if (_spriteCache.has(src)) return _spriteCache.get(src)!;
  const img = new Image();
  img.src = src;
  _spriteCache.set(src, img);
  return img;
}
if (typeof window !== 'undefined') {
  _loadSprite('/sprites/dodge-blitz/obstacle.svg');
  _loadSprite('/sprites/dodge-blitz/player.svg');
}

// ─── SPEC CONSTANTS ──────────────────────────────────────────────────────────

const GAME_ID      = 'dodge-blitz';
const PB_KEY       = 'pb_dodge-blitz';
const ACCENT       = '#06b6d4';
const DURATION     = 45;
const GAME_EMOJI   = '💨';
const GAME_TITLE   = 'Dodge Blitz';
const GAME_TAGLINE = 'Tilt to survive. Don\'t stop moving.';

const MAX_LIVES     = 5;   // increased from 3 for casual-player accessibility
const PLAYER_RADIUS = 18;
const MAX_PARTICLES = 50;

// ─── SPEED STAGES (pure function — no stale closure risk) ────────────────────

function getSpeedParams(elapsed: number): { speed: number; spawnMs: number } {
  if (elapsed < 15) return { speed: 1.8, spawnMs: 2800 };  // stage 1: very accessible — ~4.5s per obstacle
  if (elapsed < 30) return { speed: 5.8, spawnMs: 1200 };  // stage 2: medium challenge
  return { speed: 8.0, spawnMs: 900 };                     // stage 3: fast and intense
}

// ─── BEHAVIORAL SIGNALS ──────────────────────────────────────────────────────

interface Signals {
  obstaclesAvoided: number;   // total dodged
  collisions: number;         // hits taken
  tiltMagnitudes: number[];   // sampled abs gamma values (degrees)
  survivalTime: number;       // ms to first collision (DURATION*1000 if none)
  dodgesLeft: number;         // dodge count where player was left of obstacle
  dodgesRight: number;        // dodge count where player was right of obstacle
  score: number;              // internal points (+2 per dodge, +1 bonus after 20s, -5 per hit)
}

// ─── PERSONALITY CLASSIFICATION ──────────────────────────────────────────────

function getPersonality(sig: Signals): string {
  const avgTilt = sig.tiltMagnitudes.length > 0
    ? sig.tiltMagnitudes.reduce((a, b) => a + b, 0) / sig.tiltMagnitudes.length
    : 0;

  // Ghost: near-perfect survival, anticipatory movement
  if (sig.collisions === 0 || (sig.collisions <= 1 && sig.obstaclesAvoided >= 20)) {
    return 'Ghost 👻';
  }
  // Reactive: large tilts, high dodge count — big reactive corrections
  if (avgTilt > 12 && sig.obstaclesAvoided >= 15) {
    return 'Reactive 🔥';
  }
  // Controlled: subtle micro-adjustments, calm and efficient
  if (avgTilt < 8 && sig.collisions <= 3) {
    return 'Controlled 🧘';
  }
  // Survivor: fallback — adapts to chaos
  return 'Survivor 🌊';
}

// ─── GAME OBJECT TYPES ───────────────────────────────────────────────────────

interface Obstacle {
  id: number;
  x: number;
  y: number;
  speed: number;
  size: number;    // diamond half-width (visual spike taller)
  hit: boolean;
  passed: boolean;
}

interface TrailPoint {
  x: number;
  y: number;
  alpha: number;
}

interface SpeedLine {
  x: number;
  y: number;
  length: number;
  speed: number;
  alpha: number;
}

// ─── GAME STATE ───────────────────────────────────────────────────────────────

interface GameState {
  running: boolean;
  lives: number;
  timeLeft: number;
  sig: Signals;

  // Player
  playerX: number;           // normalized 0..1
  playerTrail: TrailPoint[];

  // Obstacles
  obstacles: Obstacle[];
  nextObstacleId: number;
  lastSpawnTime: number;

  // Visual FX
  screenFlash: number;       // 0..1 red flash
  shakeState: ShakeState;
  particles: Particle[];
  speedLines: SpeedLine[];

  // Input
  tiltX: number;             // normalized -1..1 from controller
  tiltRaw: number;           // approx gamma degrees (tiltX * 30)
  touchActive: boolean;
  touchDirection: number;    // -1, 0, or 1

  // Tracking
  gameStartTime: number;
  firstCollisionTime: number; // 0 = not yet hit
  tiltSampleFrame: number;

  accentColor: string;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function DodgeBlitzGame() {
  const theme        = useBrandTheme();
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const animRef      = useRef(0);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const tiltRef      = useRef<ReturnType<typeof createTiltController> | null>(null);
  const touchRef     = useRef(false);     // true = use touch fallback
  const endCalledRef = useRef(false);


  const stateRef = useRef<GameState>({
    running: false,
    lives: MAX_LIVES,
    timeLeft: DURATION,
    sig: {
      obstaclesAvoided: 0,
      collisions: 0,
      tiltMagnitudes: [],
      survivalTime: DURATION * 1000,
      dodgesLeft: 0,
      dodgesRight: 0,
      score: 0,
    },
    playerX: 0.5,
    playerTrail: [],
    obstacles: [],
    nextObstacleId: 0,
    lastSpawnTime: 0,
    screenFlash: 0,
    shakeState: { intensity: 0, duration: 0 },
    particles: [],
    speedLines: [],
    tiltX: 0,
    tiltRaw: 0,
    touchActive: false,
    touchDirection: 0,
    gameStartTime: 0,
    firstCollisionTime: 0,
    tiltSampleFrame: 0,
    accentColor: ACCENT,
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);

  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('💨');
  const { pops, triggerPop } = useScorePop();
  const prevScoreRef = useRef(0);
  const [streak, setStreak] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
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

  // Sync theme accent into state ref (rAF reads from stateRef to avoid stale closure)
  useEffect(() => {
    stateRef.current.accentColor = theme.colors.accent ?? ACCENT;
  }, [theme]);

  // ─── END GAME ──────────────────────────────────────────────────────────────

  const endGame = useCallback((forcedEnd: boolean) => {
    if (endCalledRef.current) return;
    endCalledRef.current = true;

    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    stopMusicRef.current?.();
    stopMusicRef.current = null;
    if (tiltRef.current) { tiltRef.current.stop(); }

    // Survival time: full duration if no collision
    if (s.firstCollisionTime === 0) {
      s.sig.survivalTime = DURATION * 1000;
    }

    sfx.success();
    hapticVictory();
    playVictoryFanfare();

    // Personal best tracking
    try {
      const prev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      if (s.sig.obstaclesAvoided > prev) {
        localStorage.setItem(PB_KEY, String(s.sig.obstaclesAvoided));
        setIsNewBest(true);
      }
    } catch { /* ignore */ }

    if (forcedEnd) setTimeLeft(0);
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  // ─── SPAWN OBSTACLES ───────────────────────────────────────────────────────

  const spawnObstacles = useCallback((canvas: HTMLCanvasElement, elapsed: number) => {
    const s = stateRef.current;
    // Don't spawn once all lives are gone (dramatic end effect window)
    if (s.lives <= 0) return;

    const now = Date.now();
    const { speed, spawnMs } = getSpeedParams(elapsed);
    if (now - s.lastSpawnTime < spawnMs) return;
    s.lastSpawnTime = now;

    // Count: 1 in slow, 1-2 in medium, 1-3 in fast
    let count = 1;
    if (elapsed >= 30) {
      const r = Math.random();
      if (r < 0.55) count = 2;
      else if (r < 0.65) count = 3;
    } else if (elapsed >= 15) {
      count = Math.random() < 0.45 ? 2 : 1;
    }

    const margin = 38;

    for (let i = 0; i < count; i++) {
      let x: number;
      if (count === 1) {
        x = margin + Math.random() * (window.innerWidth - margin * 2);
      } else {
        // Spread across segments so multiple obstacles are always passable
        const segment = window.innerWidth / count;
        x = segment * i + margin + Math.random() * Math.max(0, segment - margin * 2);
      }

      s.obstacles.push({
        id: s.nextObstacleId++,
        x,
        y: -32,
        speed: speed + Math.random() * 1.4,
        size: 14 + Math.random() * 9,
        hit: false,
        passed: false,
      });
    }
  }, []);

  // ─── GAME LOOP ─────────────────────────────────────────────────────────────

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const s = stateRef.current;

    // ── Full state reset ──────────────────────────────────────────────────
    endCalledRef.current = false;
    s.running = true;
    s.lives = MAX_LIVES;
    s.timeLeft = DURATION;
    s.sig = {
      obstaclesAvoided: 0,
      collisions: 0,
      tiltMagnitudes: [],
      survivalTime: DURATION * 1000,
      dodgesLeft: 0,
      dodgesRight: 0,
      score: 0,
    };
    s.playerX = 0.5;
    s.playerTrail = [];
    s.obstacles = [];
    s.nextObstacleId = 0;
    s.lastSpawnTime = 0;
    s.screenFlash = 0;
    s.shakeState = { intensity: 0, duration: 0 };
    s.particles = [];
    s.speedLines = [];
    s.tiltX = 0;
    s.touchDirection = 0;
    s.touchActive = false;
    s.gameStartTime = Date.now();
    s.firstCollisionTime = 0;
    s.tiltSampleFrame = 0;

    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');

    stopMusicRef.current = startMusic('drive');

    // ⚠️ setInterval only for 1-second timer
    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      // Tick every second
      sfx.tick();
      // Ramp up music BPM at speed stage transitions
      if (s.timeLeft === 30) increaseMusicTempo(162);
      if (s.timeLeft === 15) increaseMusicTempo(178);
      // Warning at 10s remaining
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 0) {
        // Timer expiry = survival success — do NOT play fail sound
        haptic([300]);
        endGame(false);
      }
    }, 1000);

    // ── rAF Loop ──────────────────────────────────────────────────────────
    const loop = () => {
      if (!s.running) return;

      const W = window.innerWidth;
      const H = window.innerHeight;
      const elapsed = (Date.now() - s.gameStartTime) / 1000;

      s.tiltSampleFrame++;

      // ── Player movement ─────────────────────────────────────────────────
      let moveDir = 0;
      if (!touchRef.current) {
        // Tilt control: tiltX is pre-smoothed normalized -1..1
        moveDir = s.tiltX * 1.1;
        // Sample tilt magnitude every ~20 frames
        if (s.tiltSampleFrame % 20 === 0 && Math.abs(s.tiltRaw) > 2) {
          s.sig.tiltMagnitudes.push(Math.abs(s.tiltRaw));
        }
      } else {
        // Touch fallback: hold left/right half of screen
        moveDir = s.touchDirection * 0.85;
        if (s.touchDirection !== 0 && s.tiltSampleFrame % 20 === 0) {
          // Use 8 as neutral-proxy magnitude for touch players
          s.sig.tiltMagnitudes.push(8);
        }
      }

      // Speed factor increases very slightly over time (player keeps control)
      const speedFactor = 0.016 + elapsed * 0.00008;
      s.playerX = Math.max(0.04, Math.min(0.96, s.playerX + moveDir * speedFactor));

      const playerPx = s.playerX * W;
      const playerPy = H * 0.76;    // bottom 30% of screen

      // ── Ghost trail ─────────────────────────────────────────────────────
      s.playerTrail.unshift({ x: playerPx, y: playerPy, alpha: 0.5 });
      if (s.playerTrail.length > 10) s.playerTrail.length = 10;
      for (let ti = 0; ti < s.playerTrail.length; ti++) {
        s.playerTrail[ti].alpha = (1 - ti / s.playerTrail.length) * 0.42;
      }

      // ── Spawn obstacles ─────────────────────────────────────────────────
      spawnObstacles(canvas, elapsed);

      // ── Speed lines (appear in fast stage) ──────────────────────────────
      if (elapsed >= 28 && s.speedLines.length < 28 && Math.random() < 0.4) {
        s.speedLines.push({
          x: Math.random() * W,
          y: -30,
          length: 30 + Math.random() * 55,
          speed: 10 + Math.random() * 8,
          alpha: 0.05 + Math.random() * 0.12,
        });
      }

      // ── Draw frame (shake context wraps all drawing) ─────────────────────
      ctx.save();
      applyShake(ctx, s.shakeState);

      // Background — dark cobalt/cyan gradient for speed vibe
      ctx.imageSmoothingEnabled = true;
      const dbBg = ctx.createRadialGradient(W * 0.5, H * 0.3, 0, W * 0.5, H * 0.6, Math.max(W, H) * 0.9);
      dbBg.addColorStop(0,   '#001525');
      dbBg.addColorStop(0.55, '#000d18');
      dbBg.addColorStop(1,   '#00060e');
      ctx.fillStyle = dbBg;
      ctx.fillRect(0, 0, W, H);

      // Vignette
      const dbVig = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.2, W * 0.5, H * 0.5, H * 0.85);
      dbVig.addColorStop(0, 'rgba(0,0,0,0)');
      dbVig.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = dbVig;
      ctx.fillRect(0, 0, W, H);

      // Speed lines
      if (s.speedLines.length > 0) {
        for (let si = s.speedLines.length - 1; si >= 0; si--) {
          const sl = s.speedLines[si];
          sl.y += sl.speed;
          if (sl.y > H + 40) { s.speedLines.splice(si, 1); continue; }
          ctx.save();
          ctx.strokeStyle = `rgba(6,182,212,${sl.alpha})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sl.x, sl.y);
          ctx.lineTo(sl.x, sl.y + sl.length);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Player trail — no shadowBlur here (perf: saves 10 shadow ops/frame)
      ctx.save();
      ctx.fillStyle = s.accentColor;
      for (const tp of s.playerTrail) {
        ctx.globalAlpha = tp.alpha;
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, PLAYER_RADIUS * 0.52, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // Player orb
      ctx.save();
      // Outer glow
      ctx.shadowBlur = 30;
      ctx.shadowColor = s.accentColor;
      // Radial gradient fill
      const gr = ctx.createRadialGradient(playerPx, playerPy, 0, playerPx, playerPy, PLAYER_RADIUS);
      gr.addColorStop(0, s.accentColor + 'ee');
      gr.addColorStop(1, s.accentColor + '44');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(playerPx, playerPy, PLAYER_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      // Ring
      ctx.strokeStyle = s.accentColor;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(playerPx, playerPy, PLAYER_RADIUS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // ── Obstacles ────────────────────────────────────────────────────────
      for (let oi = s.obstacles.length - 1; oi >= 0; oi--) {
        const obs = s.obstacles[oi];
        if (obs.hit) { s.obstacles.splice(oi, 1); continue; }

        obs.y += obs.speed;

        // Dodge check: obstacle passed the player row (only count if still alive)
        if (!obs.passed && obs.y > playerPy + PLAYER_RADIUS + obs.size) {
          obs.passed = true;
          // Successfully dodged (not hit while passing)
          s.sig.obstaclesAvoided++;
          const bonus = elapsed > 20 ? 1 : 0;
          s.sig.score += 2 + bonus;
          // Track direction bias
          if (playerPx < obs.x) s.sig.dodgesLeft++;
          else s.sig.dodgesRight++;
          setScoreDisplay(s.sig.obstaclesAvoided);
          sfx.collect();
        }

        // Off-screen cleanup
        if (obs.y > H + 55) { s.obstacles.splice(oi, 1); continue; }

        // Collision detection (only when lives remain and not yet passed)
        if (!obs.passed && !obs.hit && s.lives > 0) {
          const dx = playerPx - obs.x;
          const dy = playerPy - obs.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          // Hitbox: slightly forgiving — inner diamond radius + player radius
          if (dist < obs.size * 0.9 + PLAYER_RADIUS * 0.8) {
            obs.hit = true;
            s.lives--;
            s.sig.collisions++;
            s.sig.score = Math.max(0, s.sig.score - 5);

            // Record survival time on first collision
            if (s.firstCollisionTime === 0) {
              s.sig.survivalTime = Date.now() - s.gameStartTime;
              s.firstCollisionTime = s.sig.survivalTime;
            }

            // Impact effects
            s.screenFlash = 1.0;
            triggerShake(s.shakeState, 7, 10);
            spawnBurst(s.particles, playerPx, playerPy, '#ef4444', 20, 5);
            sfx.collision();
            haptic([200]);

            // Early end: loop keeps running ~350ms showing impact, then endGame fires
            if (s.lives <= 0) {
              setTimeout(() => { endGame(true); }, 350);
            }
          }
        }

        // Draw obstacle sprite
        ctx.save();
        ctx.shadowBlur = 18;
        ctx.shadowColor = '#f97316';
        const _obsImg = _loadSprite('/sprites/dodge-blitz/obstacle.svg');
        if (_obsImg.complete && _obsImg.naturalWidth > 0) {
          ctx.drawImage(_obsImg, obs.x - obs.size, obs.y - obs.size * 1.65, obs.size * 2, obs.size * 2.55);
        } else {
          ctx.translate(obs.x, obs.y);
          ctx.fillStyle = '#dc2626'; ctx.strokeStyle = '#f97316'; ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(0, -obs.size * 1.65); ctx.lineTo(obs.size * 0.68, 0);
          ctx.lineTo(0, obs.size * 0.90); ctx.lineTo(-obs.size * 0.68, 0);
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        ctx.restore();
      }

      // ── Particles ────────────────────────────────────────────────────────
      if (s.particles.length > 0) {
        updateAndDrawParticles(ctx, s.particles);
        if (s.particles.length > MAX_PARTICLES) s.particles.length = MAX_PARTICLES;
      }

      // ── Screen flash (red hit indicator) ─────────────────────────────────
      if (s.screenFlash > 0) {
        ctx.fillStyle = `rgba(239,68,68,${s.screenFlash * 0.30})`;
        ctx.fillRect(0, 0, W, H);
        s.screenFlash = Math.max(0, s.screenFlash - 0.065);
      }

      // ── Lives dots (glowing, drawn on canvas below HUD area) ───────────
      {
        const dotY = 162;
        const dotSpacing = 22;
        const dotRadius = 6;
        const totalW = (MAX_LIVES - 1) * dotSpacing;
        const startX = W / 2 - totalW / 2;
        ctx.save();
        for (let li = 0; li < MAX_LIVES; li++) {
          const dotX = startX + li * dotSpacing;
          const alive = li < s.lives;
          if (alive) {
            ctx.shadowBlur = 14;
            ctx.shadowColor = s.accentColor;
            ctx.fillStyle = s.accentColor;
          } else {
            ctx.shadowBlur = 0;
            ctx.fillStyle = 'rgba(255,255,255,0.13)';
          }
          ctx.beginPath();
          ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      ctx.restore(); // restore shake context

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame, spawnObstacles]);

  // ─── CANVAS SETUP + TOUCH INPUT ────────────────────────────────────────────
  // ⚠️ Register on canvas. Remove in cleanup.

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.style.width  = w + 'px';
      canvas.style.height = h + 'px';
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
      const ctx2 = canvas.getContext('2d');
      if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // Touch fallback: hold left/right half to move
    const onPointerDown = (e: PointerEvent) => {
      if (phase !== 'playing' || !touchRef.current) return;
      const s = stateRef.current;
      const rect = canvas.getBoundingClientRect();
      s.touchDirection = (e.clientX - rect.left) < rect.width / 2 ? -1 : 1;
      s.touchActive = true;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (phase !== 'playing' || !touchRef.current || !stateRef.current.touchActive) return;
      const rect = canvas.getBoundingClientRect();
      stateRef.current.touchDirection = (e.clientX - rect.left) < rect.width / 2 ? -1 : 1;
    };
    const onPointerUp = () => {
      if (!touchRef.current) return;
      stateRef.current.touchDirection = 0;
      stateRef.current.touchActive = false;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [phase]);

  // ─── CLEANUP ON UNMOUNT ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      stopMusicRef.current?.();
      if (tiltRef.current) tiltRef.current.stop();
    };
  }, []);

  // ─── PHASE TRANSITIONS ────────────────────────────────────────────────────

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    initAudio();
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);

    // Request DeviceOrientation permission (iOS requires explicit user gesture)
    const controller = createTiltController(
      (x, _y) => {
        stateRef.current.tiltX  = x;
        stateRef.current.tiltRaw = x * 30; // approx gamma degrees
      },
      { sensitivity: 1.2, smoothing: 0.4, deadzone: 2, clamp: 30 },
    );

    const granted = await controller.start();
    if (granted) {
      tiltRef.current  = controller;
      touchRef.current = false;
    } else {
      controller.stop();
      touchRef.current = true; // activate touch fallback
    }

    setPhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => {
    startLoop();
  }, [startLoop]);

  const handlePlayAgain = useCallback(async () => {
    // Stop previous tilt controller
    if (tiltRef.current) { tiltRef.current.stop(); tiltRef.current = null; }
    endCalledRef.current = false;
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setFinalSig(null);

    // Re-initialize tilt controller (skip start screen — player session already stored)
    const controller = createTiltController(
      (x, _y) => {
        stateRef.current.tiltX  = x;
        stateRef.current.tiltRaw = x * 30;
      },
      { sensitivity: 1.2, smoothing: 0.4, deadzone: 2, clamp: 30 },
    );
    const granted = await controller.start();
    if (granted) {
      tiltRef.current  = controller;
      touchRef.current = false;
    } else {
      controller.stop();
      touchRef.current = true;
    }

    setPhase('countdown');
  
    setIsNewBest(false);
    setStreak(0);
    prevScoreRef.current = 0;
  }, []);

  // ─── END SCREEN INSIGHTS ─────────────────────────────────────────────────

  const buildInsights = (sig: Signals) => {
    const avgTilt = sig.tiltMagnitudes.length > 0
      ? Math.round(sig.tiltMagnitudes.reduce((a, b) => a + b, 0) / sig.tiltMagnitudes.length)
      : 0;
    const survivalSec = Math.round(sig.survivalTime / 1000);

    return [
      {
        label: 'Dodges',
        value: `${sig.obstaclesAvoided}`,
        color: sig.obstaclesAvoided >= 25 ? '#4ade80' : sig.obstaclesAvoided >= 15 ? '#facc15' : '#ef4444',
      },
      {
        label: 'Collisions',
        value: `${sig.collisions}`,
        color: sig.collisions === 0 ? '#4ade80' : sig.collisions <= 2 ? '#facc15' : '#ef4444',
      },
      {
        label: 'Avg Tilt',
        value: `${avgTilt}°`,
        color: stateRef.current.accentColor,
      },
      {
        label: 'Survived',
        value: `${survivalSec}s`,
        color: survivalSec > 20 ? '#4ade80' : survivalSec >= 10 ? '#facc15' : '#ef4444',
      },
    ];
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <>
      {phase === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="dodge-blitz"
          steps={[{ icon: "📱", title: "Tilt to dodge", body: "Tilt your phone left and right to dodge incoming obstacles. On desktop? Hold left/right side of the screen." }, { icon: "⚡", title: "React fast", body: "Obstacles speed up as your score grows." }, { icon: "🔥", title: "Survive", body: "How long can you last?" }]}
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
          ctaLabel="Start →"
          sensorNote="Tilt your phone to dodge obstacles. On desktop? Hold left/right side of the screen."
          accentColor={theme.colors.accent ?? ACCENT}
          ctaTextColor="#000"
          onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #001525 0%, #000d18 55%, #00060e 100%)"
        >
          {/* ⚠️ Player name capture — required in every game */}
        </GameStartScreen>
      )}

      {/* ── Countdown ─────────────────────────────────────────────────────── */}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}

      {/* ── Canvas + HUD ──────────────────────────────────────────────────── */}
      {(phase === 'playing' || phase === 'countdown') && (
        <>
          {/* ⚠️ Canvas: full-bleed, touchAction none */}
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
          {/* ⚠️ HUD: TIME + DODGES minimum */}
          {phase === 'playing' && (
            <GameHUD
              accentColor={theme.colors.accent ?? ACCENT}
              items={[
                { label: 'TIME',   value: timeLeft,      danger: timeLeft <= 10, testId: 'timer' },
                { label: 'DODGES', value: scoreDisplay, testId: 'score' },
              ]}
            />
          )}
        </>
      )}

      {/* New best banner */}
      <AnimatePresence>
        {isNewBest && phase === 'done' && (
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
          score={String(finalSig.obstaclesAvoided)}
          personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)}
          accentColor={theme.colors.accent ?? ACCENT}
          onPlayAgain={handlePlayAgain}
          didWin={finalSig.obstaclesAvoided >= 20}
        />
      )}

      {/* ⚠️ Webhook fires exactly once after done phase renders */}
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
          <StreakBadge streak={streak} accentColor={CATEGORY_ACCENT} />
        </>
      )}
    </GameShell>
    </>
  );
}

// ─── WEBHOOK EMITTER ─────────────────────────────────────────────────────────
// Isolated component — fires exactly once on mount.

function WebhookEmitter({ theme, gameId, sig, personality, player }: {
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

    const avgTilt = sig.tiltMagnitudes.length > 0
      ? parseFloat((sig.tiltMagnitudes.reduce((a, b) => a + b, 0) / sig.tiltMagnitudes.length).toFixed(2))
      : 0;
    const total = sig.dodgesLeft + sig.dodgesRight;

    postWebhook(theme, gameId, {
      personality,
      score:              sig.obstaclesAvoided,
      obstaclesAvoided:   sig.obstaclesAvoided,
      collisions:         sig.collisions,
      tiltMagnitudes:     sig.tiltMagnitudes,
      survivalTime:       sig.survivalTime,
      dodgeDirectionBias: total > 0 ? parseFloat((sig.dodgesLeft / total).toFixed(3)) : 0.5,
      avgTiltMagnitude:   avgTilt,
    }, player);
  }, [theme, gameId, sig, personality, player]);

  return null;
}
