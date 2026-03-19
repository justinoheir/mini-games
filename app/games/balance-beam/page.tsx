/**
 * ══════════════════════════════════════════════════════════════════
 *  BALANCE BEAM — Ether Mini-Game
 *  Tilt your phone to balance a ball on a beam for 60 seconds.
 *  Sensor: DeviceOrientation (motion), touch fallback available.
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
import { createTiltController } from '@/lib/tilt';
import { Particle, spawnBurst, updateAndDrawParticles } from '@/lib/particles';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import { CATEGORY_THEMES } from '@/lib/theme';
import SwipeInstructions from '@/components/SwipeInstructions';

const CATEGORY = CATEGORY_THEMES.sports;

// ─── SPEC CONSTANTS ────────────────────────────────────────────────────────────
const GAME_ID      = 'balance-beam';
const PB_KEY       = 'pb_balance-beam';
const ACCENT       = '#f59e0b';
const DURATION     = 60;
const GAME_EMOJI   = '⚖️';
const GAME_TITLE   = 'Balance Beam';
const GAME_TAGLINE = 'Keep the ball on the beam. Stay still.';

const BALL_RADIUS    = 12;
const BEAM_HEIGHT    = 18;
const BEAM_FRAC      = 0.70;   // beam = 70% of canvas width
const BEAM_Y_FRAC    = 0.55;   // beam at 55% canvas height
const MAX_BEAM_ANGLE = 25 * (Math.PI / 180); // ±25 degrees max rotation
const GRAVITY_SCALE  = 0.45;   // physics: how fast ball accelerates
const FRICTION       = 0.94;   // velocity damping per frame
const DANGER_FRAC    = 0.75;   // >75% toward edge = danger zone
const SAFE_FRAC      = 0.50;   // <50% = safely back to center (recovery)

// ─── WIND PARTICLES ──────────────────────────────────────────────────────────
interface WindParticle {
  x: number;
  y: number;
  vx: number;
  len: number;
  alpha: number;
  color: string;
}

// ─── SIGNALS ──────────────────────────────────────────────────────────────────
interface Signals {
  timeOnBeam:         number;   // ms total
  falls:              number;   // count
  microAdjustmentRate: number;  // adjustments/second (computed at end)
  avgTiltDeviation:   number;   // degrees (computed at end)
  recoveries:         number;   // count
  score:              number;   // final score
  // internal accumulators
  microAdjustCount:   number;
  tiltDeviationSum:   number;
  tiltSampleCount:    number;
}

// ─── GAME STATE ────────────────────────────────────────────────────────────────
interface GameState {
  running:            boolean;
  timeLeft:           number;
  gameElapsedMs:      number;
  lastFrameTime:      number;
  beamAngle:          number;   // current beam rotation in radians
  ballX:              number;   // px from beam center (negative = left)
  ballVX:             number;   // px/frame velocity
  fallAnimating:      boolean;
  fallSX:             number;   // screen coords during fall anim
  fallSY:             number;
  fallVX:             number;
  fallVY:             number;
  touchLeftHeld:      boolean;
  touchRightHeld:     boolean;
  touchTiltValue:     number;   // smoothed touch tilt, -1..1
  usingTouchFallback: boolean;
  streakMs:           number;   // unbroken ms on beam (for multiplier)
  nextWindTime:       number;   // gameElapsedMs threshold for next gust
  windParticles:      WindParticle[];
  particles:          Particle[];
  ballInDangerZone:   boolean;
  prevBeamAngle:      number;
  accentColor:        string;
  sig:                Signals;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

// ─── PERSONALITY CLASSIFICATION ───────────────────────────────────────────────
function getPersonality(sig: Signals): string {
  const beamSecs = sig.timeOnBeam / 1000;
  if (beamSecs > 45 && sig.falls <= 1 && sig.avgTiltDeviation < 5)  return 'Zen Master 🧘';
  if (sig.microAdjustmentRate > 3 && sig.falls <= 2)                return 'Micromanager 🔄';
  if (sig.recoveries >= 5 && sig.falls <= 3)                        return 'Bold Corrector 💪';
  return 'Learning Curve 🌊';
}

// ─── CANVAS HELPERS ───────────────────────────────────────────────────────────
function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

function lighten(hex: string, amt: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${Math.min(255, r + amt)}, ${Math.min(255, g + amt)}, ${Math.min(255, b + amt)})`;
}

function darken(hex: string, amt: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${Math.max(0, r - amt)}, ${Math.max(0, g - amt)}, ${Math.max(0, b - amt)})`;
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────
export default function BalanceBeamGame() {
  const theme          = useBrandTheme();
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const animRef        = useRef(0);
  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef   = useRef<(() => void) | null>(null);
  const tiltCtrlRef    = useRef<ReturnType<typeof createTiltController> | null>(null);

  const stateRef = useRef<GameState>({
    running:            false,
    timeLeft:           DURATION,
    gameElapsedMs:      0,
    lastFrameTime:      0,
    beamAngle:          0,
    ballX:              0,
    ballVX:             0,
    fallAnimating:      false,
    fallSX:             0,
    fallSY:             0,
    fallVX:             0,
    fallVY:             0,
    touchLeftHeld:      false,
    touchRightHeld:     false,
    touchTiltValue:     0,
    usingTouchFallback: false,
    streakMs:           0,
    nextWindTime:       14000 + Math.random() * 6000,
    windParticles:      [],
    particles:          [],
    ballInDangerZone:   false,
    prevBeamAngle:      0,
    accentColor:        ACCENT,
    sig: {
      timeOnBeam:          0,
      falls:               0,
      microAdjustmentRate: 0,
      avgTiltDeviation:    0,
      recoveries:          0,
      score:               0,
      microAdjustCount:    0,
      tiltDeviationSum:    0,
      tiltSampleCount:     0,
    },
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [playerName, setPlayerName]     = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const { pops, triggerPop } = useScorePop();
  const [streak, setStreak] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const prevScoreRef = useRef(0);
  useEffect(() => {
    if (scoreDisplay > prevScoreRef.current) {
      triggerPop(`+${scoreDisplay - prevScoreRef.current}`, window.innerWidth / 2, 200);
    }
    prevScoreRef.current = scoreDisplay;
  }, [scoreDisplay, triggerPop]);
  const playerSessionRef                = useRef<PlayerSession | null>(null);

  // Sync brand theme into state for rAF loop
  useEffect(() => {
    stateRef.current.accentColor = theme.colors.accent ?? ACCENT;
  }, [theme]);

  // ─── END GAME ──────────────────────────────────────────────────────────────
  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current)   { clearInterval(timerRef.current); timerRef.current = null; }
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    if (tiltCtrlRef.current)  { tiltCtrlRef.current.stop(); }

    // Finalize computed signals
    if (s.sig.tiltSampleCount > 0) {
      s.sig.avgTiltDeviation = s.sig.tiltDeviationSum / s.sig.tiltSampleCount;
    }
    const gameSeconds = s.gameElapsedMs / 1000;
    s.sig.microAdjustmentRate = gameSeconds > 0
      ? s.sig.microAdjustCount / gameSeconds
      : 0;

    haptic([30, 50, 30, 50, 100]);
    sfx.success();
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

  // ─── GAME LOOP ─────────────────────────────────────────────────────────────
  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;

    // ── Reset ─────────────────────────────────────────────────────────────────
    s.running            = true;
    s.timeLeft           = DURATION;
    s.gameElapsedMs      = 0;
    s.lastFrameTime      = performance.now();
    s.beamAngle          = 0;
    s.ballX              = 0;
    s.ballVX             = 0;
    s.fallAnimating      = false;
    s.touchTiltValue     = 0;
    s.touchLeftHeld      = false;
    s.touchRightHeld     = false;
    s.streakMs           = 0;
    s.nextWindTime       = 14000 + Math.random() * 6000;
    s.windParticles      = [];
    s.particles          = [];
    s.ballInDangerZone   = false;
    s.prevBeamAngle      = 0;
    s.sig = {
      timeOnBeam: 0, falls: 0, microAdjustmentRate: 0, avgTiltDeviation: 0,
      recoveries: 0, score: 0, microAdjustCount: 0, tiltDeviationSum: 0, tiltSampleCount: 0,
    };

    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setPhase('playing');

    stopMusicRef.current = startMusic('calm');

    // ⚠️ setInterval for 1-second countdown only
    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      setScoreDisplay(Math.floor(s.sig.score)); // update once/second
      if (s.timeLeft <= 0) { endGame(); }
    }, 1000);

    // ── Local helpers ─────────────────────────────────────────────────────────

    const triggerFall = (beamCX: number, beamCY: number) => {
      const cosA = Math.cos(s.beamAngle);
      const sinA = Math.sin(s.beamAngle);
      const beamLocalY = -(BEAM_HEIGHT / 2 + BALL_RADIUS);
      const bsx = beamCX + s.ballX * cosA - beamLocalY * sinA;
      const bsy = beamCY + s.ballX * sinA + beamLocalY * cosA;

      s.fallAnimating    = true;
      s.fallSX           = bsx;
      s.fallSY           = bsy;
      s.fallVX           = s.ballVX * 0.4;
      s.fallVY           = 1.5;
      s.ballX            = 0;
      s.ballVX           = 0;
      s.sig.falls++;
      s.streakMs         = 0;
      s.ballInDangerZone = false;

      sfx.collision();
      haptic([200]);
      spawnBurst(s.particles, bsx, bsy, s.accentColor, 10, 3);

      // Respawn ball at center after 500ms
      setTimeout(() => {
        if (!stateRef.current.running) return;
        stateRef.current.fallAnimating = false;
        stateRef.current.ballX         = 0;
        stateRef.current.ballVX        = 0;
      }, 500);
    };

    const triggerWindGust = (beamCX: number, beamCY: number, W: number) => {
      const dir     = Math.random() > 0.5 ? 1 : -1;
      const impulse = dir * (1.5 + Math.random() * 2.0);
      s.ballVX     += impulse;
      s.nextWindTime = s.gameElapsedMs + 12000 + Math.random() * 8000;

      sfx.whoosh();

      const count = 8 + Math.floor(Math.random() * 6);
      for (let i = 0; i < count; i++) {
        const startX = dir > 0 ? -60 : W + 60;
        s.windParticles.push({
          x:     startX,
          y:     beamCY - 40 + Math.random() * 80,
          vx:    dir * (9 + Math.random() * 7),
          len:   20 + Math.random() * 35,
          alpha: 0.6 + Math.random() * 0.35,
          color: s.accentColor,
        });
      }
    };

    // ── rAF Loop ──────────────────────────────────────────────────────────────
    const loop = (timestamp: number) => {
      if (!s.running) return;

      const deltaMs = Math.min(timestamp - s.lastFrameTime, 50);
      s.lastFrameTime   = timestamp;
      s.gameElapsedMs  += deltaMs;

      const W        = canvas.width;
      const H        = canvas.height;
      const beamHalfLen = W * (BEAM_FRAC / 2);
      const beamCX   = W / 2;
      const beamCY   = H * BEAM_Y_FRAC;

      // ── Touch fallback tilt ──────────────────────────────────────────────
      if (s.usingTouchFallback) {
        const target     = s.touchLeftHeld ? -0.7 : s.touchRightHeld ? 0.7 : 0;
        s.touchTiltValue += (target - s.touchTiltValue) * 0.08;
        s.beamAngle       = s.touchTiltValue * MAX_BEAM_ANGLE;
      }

      // ── Micro-adjustment tracking ────────────────────────────────────────
      const angleChange = Math.abs(s.beamAngle - s.prevBeamAngle);
      if (angleChange > 0.001 && angleChange < 3 * (Math.PI / 180)) {
        s.sig.microAdjustCount++;
      }
      s.prevBeamAngle = s.beamAngle;

      // ── Tilt deviation tracking ──────────────────────────────────────────
      const tiltDeg = Math.abs(s.beamAngle) * (180 / Math.PI);
      s.sig.tiltDeviationSum += tiltDeg;
      s.sig.tiltSampleCount++;

      // ── Physics (only when ball is on beam) ─────────────────────────────
      if (!s.fallAnimating) {
        const acc  = Math.sin(s.beamAngle) * GRAVITY_SCALE;
        s.ballVX  += acc;
        s.ballVX  *= FRICTION;
        s.ballX   += s.ballVX;

        // Wind gust check
        if (s.gameElapsedMs >= s.nextWindTime) {
          triggerWindGust(beamCX, beamCY, W);
        }

        const ballFrac = Math.abs(s.ballX) / beamHalfLen;

        // Danger zone → recovery tracking
        if (ballFrac > DANGER_FRAC && !s.ballInDangerZone) {
          s.ballInDangerZone = true;
          sfx.nearMiss();
        } else if (ballFrac < SAFE_FRAC && s.ballInDangerZone) {
          // Recovery!
          s.ballInDangerZone = false;
          s.sig.recoveries++;
          s.sig.score += 10;
          sfx.collect();
          haptic([15]);
          spawnBurst(s.particles, beamCX, beamCY, s.accentColor, 8, 3);
        }

        // Fall check
        if (Math.abs(s.ballX) > beamHalfLen) {
          triggerFall(beamCX, beamCY);
        } else {
          // Score accumulation
          const multiplier = s.streakMs >= 40000 ? 2.0 : s.streakMs >= 20000 ? 1.5 : 1.0;
          s.sig.timeOnBeam += deltaMs;
          s.sig.score      += (deltaMs / 100) * multiplier;
          s.streakMs       += deltaMs;
        }
      } else {
        // Fall animation: ball arcs off screen
        s.fallVY += 0.45;
        s.fallSY += s.fallVY;
        s.fallSX += s.fallVX;
      }

      // ══ DRAW ═════════════════════════════════════════════════════════════

      // Background
      ctx.fillStyle = '#08090f';
      ctx.fillRect(0, 0, W, H);

      // Subtle radial vignette
      const vig = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.15, W * 0.5, H * 0.5, H * 0.75);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);

      // Ground shadow under beam (ambient)
      ctx.save();
      ctx.globalAlpha = 0.18;
      const shadowGrad = ctx.createRadialGradient(beamCX, beamCY + 24, 0, beamCX, beamCY + 24, beamHalfLen * 0.8);
      shadowGrad.addColorStop(0, s.accentColor);
      shadowGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = shadowGrad;
      ctx.fillRect(beamCX - beamHalfLen, beamCY, beamHalfLen * 2, 40);
      ctx.restore();

      // ── Wind particles ───────────────────────────────────────────────────
      for (let i = s.windParticles.length - 1; i >= 0; i--) {
        const wp = s.windParticles[i];
        wp.x    += wp.vx;
        wp.alpha -= 0.022;
        if (wp.alpha <= 0 || wp.x < -120 || wp.x > W + 120) {
          s.windParticles.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.globalAlpha = wp.alpha * 0.7;
        ctx.strokeStyle = wp.color;
        ctx.lineWidth   = 1.5;
        ctx.lineCap     = 'round';
        ctx.beginPath();
        ctx.moveTo(wp.x, wp.y);
        ctx.lineTo(wp.x - wp.vx * 3.5, wp.y);
        ctx.stroke();
        ctx.restore();
      }

      // ── Beam ─────────────────────────────────────────────────────────────
      const beamW  = beamHalfLen * 2;
      const cosA   = Math.cos(s.beamAngle);
      const sinA   = Math.sin(s.beamAngle);
      const tiltFrac = Math.abs(s.beamAngle) / MAX_BEAM_ANGLE;
      const ac     = s.accentColor;
      const { r: ar, g: ag, b: ab } = hexToRgb(ac);

      ctx.save();
      ctx.translate(beamCX, beamCY);
      ctx.rotate(s.beamAngle);

      // Tilt glow (accent side glows more when tilted)
      if (tiltFrac > 0.25) {
        const glowDir = s.beamAngle > 0 ? 1 : -1;
        const glowGrad = ctx.createLinearGradient(-beamHalfLen, 0, beamHalfLen, 0);
        if (glowDir > 0) {
          glowGrad.addColorStop(0, 'rgba(0,0,0,0)');
          glowGrad.addColorStop(1, `rgba(${ar},${ag},${ab},${0.35 * tiltFrac})`);
        } else {
          glowGrad.addColorStop(0, `rgba(${ar},${ag},${ab},${0.35 * tiltFrac})`);
          glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
        }
        ctx.fillStyle = glowGrad;
        ctx.fillRect(-beamHalfLen, -BEAM_HEIGHT / 2 - 6, beamW, BEAM_HEIGHT + 12);
      }

      // Beam body — warm amber gradient
      ctx.shadowBlur  = 10;
      ctx.shadowColor = `rgba(${ar},${ag},${ab},0.55)`;
      const beamGrad = ctx.createLinearGradient(0, -BEAM_HEIGHT / 2, 0, BEAM_HEIGHT / 2);
      beamGrad.addColorStop(0,   lighten(ac, 40));
      beamGrad.addColorStop(0.4, ac);
      beamGrad.addColorStop(1,   darken(ac, 35));
      ctx.fillStyle = beamGrad;
      drawRoundRect(ctx, -beamHalfLen, -BEAM_HEIGHT / 2, beamW, BEAM_HEIGHT, BEAM_HEIGHT / 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Beam top highlight
      ctx.strokeStyle = `rgba(255,255,255,0.22)`;
      ctx.lineWidth   = 1;
      drawRoundRect(ctx, -beamHalfLen, -BEAM_HEIGHT / 2, beamW, BEAM_HEIGHT, BEAM_HEIGHT / 2);
      ctx.stroke();

      // Danger zone indicators (subtle end markers that brighten when ball is near)
      if (s.ballInDangerZone) {
        const endAlpha = 0.3 + 0.4 * tiltFrac;
        ctx.fillStyle = `rgba(239, 68, 68, ${endAlpha})`;
        // Left end cap glow
        if (s.ballX < 0) {
          drawRoundRect(ctx, -beamHalfLen, -BEAM_HEIGHT / 2, 20, BEAM_HEIGHT, BEAM_HEIGHT / 2);
          ctx.fill();
        } else {
          drawRoundRect(ctx, beamHalfLen - 20, -BEAM_HEIGHT / 2, 20, BEAM_HEIGHT, BEAM_HEIGHT / 2);
          ctx.fill();
        }
      }

      ctx.restore();

      // ── Ball (on beam) ───────────────────────────────────────────────────
      if (!s.fallAnimating) {
        const beamLocalY = -(BEAM_HEIGHT / 2 + BALL_RADIUS);
        const ballSX = beamCX + s.ballX * cosA - beamLocalY * sinA;
        const ballSY = beamCY + s.ballX * sinA + beamLocalY * cosA;

        // Shadow on beam surface
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle   = '#000';
        ctx.beginPath();
        ctx.ellipse(
          beamCX + s.ballX * cosA,
          beamCY + s.ballX * sinA,
          BALL_RADIUS * 0.85,
          3.5,
          s.beamAngle,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.restore();

        // Ball glow
        ctx.save();
        ctx.shadowBlur  = 18;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.55)';

        // Radial gradient for sphere look
        const ballGrad = ctx.createRadialGradient(
          ballSX - BALL_RADIUS * 0.3, ballSY - BALL_RADIUS * 0.35, 0,
          ballSX, ballSY, BALL_RADIUS,
        );
        ballGrad.addColorStop(0,   '#ffffff');
        ballGrad.addColorStop(0.4, '#e2e8f0');
        ballGrad.addColorStop(1,   '#94a3b8');

        ctx.fillStyle = ballGrad;
        ctx.beginPath();
        ctx.arc(ballSX, ballSY, BALL_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
      }

      // ── Falling ball animation ───────────────────────────────────────────
      if (s.fallAnimating && s.fallSY < H + 60) {
        const fadeAlpha = Math.max(0, 1 - (s.fallSY - (H * BEAM_Y_FRAC)) / (H * 0.5));
        ctx.save();
        ctx.globalAlpha = fadeAlpha;
        ctx.shadowBlur  = 10;
        ctx.shadowColor = 'rgba(255,255,255,0.35)';
        ctx.fillStyle   = '#cbd5e1';
        ctx.beginPath();
        ctx.arc(s.fallSX, s.fallSY, BALL_RADIUS * 0.85, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
      }

      // ── Particles ────────────────────────────────────────────────────────
      updateAndDrawParticles(ctx, s.particles);

      // ── Multiplier badge (shown when active) ─────────────────────────────
      if (!s.fallAnimating && s.streakMs > 0) {
        const mult = s.streakMs >= 40000 ? 2.0 : s.streakMs >= 20000 ? 1.5 : 1.0;
        if (mult > 1) {
          ctx.save();
          ctx.globalAlpha = 0.75;
          ctx.font        = `700 18px 'Space Grotesk', sans-serif`;
          ctx.textAlign   = 'center';
          ctx.fillStyle   = ac;
          ctx.shadowBlur  = 8;
          ctx.shadowColor = ac;
          ctx.fillText(`${mult}×`, W / 2, H * BEAM_Y_FRAC - beamHalfLen * 0.45);
          ctx.shadowBlur  = 0;
          ctx.restore();
        }
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  // ─── CANVAS SETUP + INPUT ──────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.running || !s.usingTouchFallback) return;
      const rect = canvas.getBoundingClientRect();
      const cx   = (e.clientX - rect.left) * (canvas.width / rect.width);
      if (cx < canvas.width / 2) {
        s.touchLeftHeld  = true;
        s.touchRightHeld = false;
      } else {
        s.touchRightHeld = true;
        s.touchLeftHeld  = false;
      }
    };

    const onPointerUp = () => {
      stateRef.current.touchLeftHeld  = false;
      stateRef.current.touchRightHeld = false;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup',   onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown',   onPointerDown);
      canvas.removeEventListener('pointerup',     onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  // ─── CLEANUP ON UNMOUNT ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animRef.current);
      if (timerRef.current)     clearInterval(timerRef.current);
      if (stopMusicRef.current) stopMusicRef.current();
      if (tiltCtrlRef.current)  tiltCtrlRef.current.stop();
    };
  }, []);

  // ─── PHASE TRANSITIONS ────────────────────────────────────────────────────
  const handleStart = useCallback((name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    (async () => {
      initAudio();
      playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);

      const controller = createTiltController(
        (x) => {
          if (!stateRef.current.usingTouchFallback) {
            // Phone tilts right → x positive → beam tilts right → ball rolls right
            stateRef.current.beamAngle = x * MAX_BEAM_ANGLE;
          }
        },
        { sensitivity: 1.0, smoothing: 0.5, clamp: 30 },
      );

      const granted = await controller.start();
      tiltCtrlRef.current = controller;
      stateRef.current.usingTouchFallback = !granted;

      setPhase('countdown');
    })();
  }, []);

  const handleCountdownDone = useCallback(() => {
    startLoop();
  }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    if (tiltCtrlRef.current) { tiltCtrlRef.current.stop(); tiltCtrlRef.current = null; }
    setPhase('start');
    setScoreDisplay(0);
    setTimeLeft(DURATION);
    setFinalSig(null);
  }, []);

  // ─── END SCREEN INSIGHTS ─────────────────────────────────────────────────
  const buildInsights = (sig: Signals) => {
    const balanceSec   = Math.round(sig.timeOnBeam / 1000);
    const stabilityDeg = Math.round(sig.avgTiltDeviation * 10) / 10;

    return [
      {
        label: 'Balance Time',
        value: `${balanceSec}s`,
        color: balanceSec > 50 ? '#4ade80' : balanceSec >= 30 ? '#facc15' : '#ef4444',
      },
      {
        label: 'Falls',
        value: `${sig.falls}`,
        color: sig.falls === 0 ? '#4ade80' : sig.falls <= 2 ? '#facc15' : '#ef4444',
      },
      {
        label: 'Recoveries',
        value: `${sig.recoveries}`,
        color: theme.colors.accent ?? ACCENT,
      },
      {
        label: 'Stability',
        value: `${stabilityDeg}°`,
        color: stabilityDeg < 5 ? '#4ade80' : stabilityDeg <= 12 ? '#facc15' : '#ef4444',
      },
    ];
  };

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <>
      {phase === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="balance-beam"
          steps={[{ icon: "📱", title: "Tilt to balance", body: "Tilt your device left and right to stay on the beam." }, { icon: "⚖️", title: "Stay centered", body: "Too far either way and you fall off." }, { icon: "🏆", title: "Beat your time", body: "Balance as long as possible to set a new best." }]}
          onDone={() => setShowInstructions(false)}
        />
      )}
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}>

      {/* ── Start Screen ────────────────────────────────────────────────── */}
      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI}
          title={GAME_TITLE}
          description={GAME_TAGLINE}
          ctaLabel="Allow Motion"
          accentColor={theme.colors.accent ?? ACCENT}
          ctaTextColor="#000"
          onStart={handleStart}
          sensorNote="Tilt to balance · touch controls if motion is denied"
        >
        </GameStartScreen>
      )}

      {/* ── Countdown ───────────────────────────────────────────────────── */}
      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}

      {/* ── Playing (canvas + HUD) ───────────────────────────────────────── */}
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
                { label: 'TIME',    value: timeLeft,     danger: timeLeft <= 10 },
                { label: 'BALANCE', value: scoreDisplay },
              ]}
            />
          )}
          {phase === 'playing' && (
            <>
              <ScorePopEffect pops={pops} accentColor={CATEGORY.primaryAccent} />
              <StreakBadge streak={streak} accentColor={CATEGORY.primaryAccent} />
            </>
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



      {/* ── End Screen ──────────────────────────────────────────────────── */}
      {phase === 'done' && finalSig && (
        <EndScreen
          gameId={GAME_ID}
          title={getPersonality(finalSig)}
          emoji={GAME_EMOJI}
          score={String(Math.floor(finalSig.score))}
          personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)}
          accentColor={theme.colors.accent ?? ACCENT}
          onPlayAgain={handlePlayAgain}
          didWin={finalSig.falls <= 2}
        />
      )}

      {/* ── Webhook emitter ─────────────────────────────────────────────── */}
      {phase === 'done' && finalSig && (
        <WebhookEmitter
          theme={theme}
          gameId={GAME_ID}
          sig={finalSig}
          personality={getPersonality(finalSig)}
          player={playerSessionRef.current}
        />
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
      score:               Math.floor(sig.score),
      timeOnBeam:          sig.timeOnBeam,
      falls:               sig.falls,
      microAdjustmentRate: parseFloat(sig.microAdjustmentRate.toFixed(3)),
      avgTiltDeviation:    parseFloat(sig.avgTiltDeviation.toFixed(2)),
      recoveries:          sig.recoveries,
    }, player);
  }, [theme, gameId, sig, personality, player]);
  return null;
}
