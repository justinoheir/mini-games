/**
 * ══════════════════════════════════════════════════════════════════
 *  JAVELIN THROW — Ether Glimmer
 *  Swipe upward with power and angle to throw the javelin for distance.
 *  Mechanic: swipe velocity → launch angle + power → physics arc
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
import { hapticScore, hapticFail, hapticVictory } from '@/lib/haptics';
import { useBrandTheme } from '@/lib/useBrandTheme';
import { postWebhook } from '@/lib/webhook';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
import { Particle, spawnBurst, updateAndDrawParticles } from '@/lib/particles';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';

// ── CONSTANTS ──────────────────────────────────────────────────────
const GAME_ID      = 'javelin-throw';
const PB_KEY       = 'pb_javelin-throw';
const ACCENT       = '#a78bfa';
const DURATION     = 30;
const GAME_EMOJI   = '🥇';
const GAME_TITLE   = 'Javelin Throw';
const GAME_TAGLINE = 'Swipe up with power and angle for max distance.';

const GRAVITY      = 0.22;    // pixels/frame²
const DRAG         = 0.0025;  // velocity drag coefficient
const JAVELIN_LEN  = 50;      // px
const PIXELS_PER_M = 8;       // screen pixels to "meters"

// ── TYPES ───────────────────────────────────────────────────────────
interface JavelinState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;    // radians, current flight angle
  active: boolean;
  landed: boolean;
  landX: number;
  distanceM: number;
}

interface ThrowRecord {
  distanceM: number;
  angle: number;
  power: number;
}

interface Signals {
  score: number;          // sum of all distances (points)
  bestThrow: number;      // meters, best single throw
  throws: number;
  goodThrows: number;     // throws > 30m
  optimalThrows: number;  // throws within optimal angle range (35-50°)
  maxStreak: number;
  streak: number;         // consecutive throws > prev best
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  javelin: JavelinState;
  throwHistory: ThrowRecord[];
  particles: Particle[];
  pointerStart: { x: number; y: number; time: number } | null;
  gameStartTime: number;
  athleteX: number;
  runPhase: number;
  isCharging: boolean;
  accentColor: string;
  prevBest: number;
  landMarkers: { x: number; dist: number; fresh: boolean }[];
  screenFlash: number;
  aimVector: { x: number; y: number } | null;
}

// ── PERSONALITY ─────────────────────────────────────────────────────
function getPersonality(sig: Signals): string {
  if (sig.bestThrow >= 70)               return 'Olympic Champion 🥇';
  if (sig.bestThrow >= 55 && sig.optimalThrows >= 3) return 'Technical Master 🎯';
  if (sig.bestThrow >= 50)               return 'Power Thrower ⚡';
  if (sig.optimalThrows >= 4)            return 'Angle Expert 📐';
  if (sig.goodThrows >= 4)               return 'Consistent Athlete 💪';
  if (sig.throws >= 8)                   return 'Never Quit 🔥';
  return 'Javelin Rookie 🏃';
}

// ── COMPONENT ───────────────────────────────────────────────────────
export default function JavelinThrowGame() {
  const theme      = useBrandTheme();
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const animRef    = useRef(0);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const endCalledRef = useRef(false);

  const stateRef = useRef<GState>({
    running: false, timeLeft: DURATION,
    sig: { score: 0, bestThrow: 0, throws: 0, goodThrows: 0, optimalThrows: 0, maxStreak: 0, streak: 0 },
    javelin: { x: 0, y: 0, vx: 0, vy: 0, angle: -Math.PI / 4, active: false, landed: false, landX: 0, distanceM: 0 },
    throwHistory: [], particles: [],
    pointerStart: null, gameStartTime: 0,
    athleteX: 0, runPhase: 0, isCharging: false,
    accentColor: ACCENT, prevBest: 0,
    landMarkers: [], screenFlash: 0,
    aimVector: null,
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [throwMsg, setThrowMsg]         = useState<{ text: string; color: string } | null>(null);
  const [isNewBest, setIsNewBest]       = useState(false);
  const { pops, triggerPop }            = useScorePop();
  const playerSessionRef                = useRef<PlayerSession | null>(null);
  const msgTimerRef                     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevScoreRef                    = useRef(0);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);
  useEffect(() => {
    if (scoreDisplay > prevScoreRef.current)
      triggerPop(`+${scoreDisplay - prevScoreRef.current}`, window.innerWidth / 2, 200);
    prevScoreRef.current = scoreDisplay;
  }, [scoreDisplay, triggerPop]);

  // ── END GAME ──────────────────────────────────────────────────────
  const endGame = useCallback(() => {
    if (endCalledRef.current) return;
    endCalledRef.current = true;
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    stopMusicRef.current?.(); stopMusicRef.current = null;
    sfx.gameOver();
    try {
      const prev = parseFloat(localStorage.getItem(PB_KEY) || '0');
      if (s.sig.bestThrow > prev) { localStorage.setItem(PB_KEY, String(s.sig.bestThrow)); setIsNewBest(true); }
    } catch { /* ignore */ }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  // ── GAME LOOP ────────────────────────────────────────────────────
  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const s = stateRef.current;

    endCalledRef.current = false;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, bestThrow: 0, throws: 0, goodThrows: 0, optimalThrows: 0, maxStreak: 0, streak: 0 };
    s.throwHistory = []; s.particles = [];
    s.pointerStart = null; s.gameStartTime = Date.now();
    s.prevBest = 0; s.landMarkers = []; s.screenFlash = 0;
    setScoreDisplay(0); setTimeLeft(DURATION);

    const W = window.innerWidth, H = window.innerHeight;
    s.athleteX = W * 0.15;
    const groundY = H * 0.72;
    s.javelin = { x: s.athleteX, y: groundY - 60, vx: 0, vy: 0, angle: -Math.PI * 0.42, active: false, landed: false, landX: 0, distanceM: 0 };

    stopMusicRef.current = startMusic('sports');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      sfx.tick();
      if (s.timeLeft === 10) sfx.warning();
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W2 = window.innerWidth, H2 = window.innerHeight;
      const groundY2 = H2 * 0.72;
      const now = Date.now();

      // Background — stadium/field
      const bg = ctx.createLinearGradient(0, 0, 0, H2);
      bg.addColorStop(0, '#0f172a');
      bg.addColorStop(0.55, '#0f1f3f');
      bg.addColorStop(1, '#0a1628');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W2, H2);

      // Stadium atmosphere - subtle gradient zones
      ctx.save();
      const atm = ctx.createRadialGradient(W2 * 0.5, H2 * 0.3, 0, W2 * 0.5, H2 * 0.5, W2 * 0.7);
      atm.addColorStop(0, 'rgba(167,139,250,0.04)');
      atm.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = atm; ctx.fillRect(0, 0, W2, H2);
      ctx.restore();

      // Field surface
      ctx.fillStyle = '#166534';
      ctx.fillRect(0, groundY2, W2, H2 - groundY2);
      ctx.fillStyle = '#15803d';
      ctx.fillRect(0, groundY2, W2, 6);

      // Distance markers on field
      const throwOriginX = s.athleteX;
      const markerInterval = 40; // every 40px = 5m approx
      for (let mi = 0; mi < 20; mi++) {
        const mx = throwOriginX + mi * markerInterval;
        if (mx > W2 - 20) break;
        const distM = Math.round(mi * markerInterval / PIXELS_PER_M);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(mx, groundY2, 2, 15);
        if (distM % 10 === 0 && distM > 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          ctx.font = '10px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`${distM}m`, mx, groundY2 + 26);
        }
      }

      // Previous land markers
      for (let mi = s.landMarkers.length - 1; mi >= 0; mi--) {
        const lm = s.landMarkers[mi];
        ctx.save();
        ctx.strokeStyle = lm.fresh ? '#fbbf24' : 'rgba(167,139,250,0.5)';
        ctx.lineWidth = lm.fresh ? 3 : 1.5;
        ctx.shadowBlur = lm.fresh ? 10 : 0; ctx.shadowColor = '#fbbf24';
        ctx.beginPath();
        ctx.moveTo(lm.x, groundY2 - 8); ctx.lineTo(lm.x, groundY2 + 8); ctx.stroke();
        ctx.fillStyle = lm.fresh ? '#fbbf24' : 'rgba(255,255,255,0.4)';
        ctx.font = `${lm.fresh ? 'bold ' : ''}11px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(`${lm.dist.toFixed(0)}m`, lm.x, groundY2 - 14);
        ctx.restore();
        if (lm.fresh) lm.fresh = false; // only fresh for one frame
      }

      // Aim vector preview
      if (s.aimVector && s.pointerStart && !s.javelin.active) {
        const av = s.aimVector;
        const aimLen = Math.sqrt(av.x * av.x + av.y * av.y);
        if (aimLen > 5) {
          ctx.save();
          ctx.strokeStyle = 'rgba(167,139,250,0.6)';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 6]);
          ctx.beginPath();
          const nx = av.x / aimLen, ny = av.y / aimLen;
          ctx.moveTo(s.javelin.x, s.javelin.y);
          ctx.lineTo(s.javelin.x + nx * 80, s.javelin.y + ny * 80);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      }

      // Javelin physics
      if (s.javelin.active) {
        // Drag force
        const speed = Math.sqrt(s.javelin.vx * s.javelin.vx + s.javelin.vy * s.javelin.vy);
        const dragMult = 1 - DRAG * speed;
        s.javelin.vx *= dragMult;
        s.javelin.vy = s.javelin.vy * dragMult + GRAVITY;
        s.javelin.x += s.javelin.vx;
        s.javelin.y += s.javelin.vy;

        // Flight angle tracks velocity
        if (speed > 0.5) {
          s.javelin.angle = Math.atan2(s.javelin.vy, s.javelin.vx);
        }

        // Landing
        if (s.javelin.y >= groundY2 - 6 && !s.javelin.landed) {
          s.javelin.landed = true;
          s.javelin.y = groundY2 - 6;
          const distM = Math.max(0, (s.javelin.x - throwOriginX) / PIXELS_PER_M);
          s.javelin.distanceM = distM;
          s.sig.throws++;

          // Scoring
          const launchAngleDeg = s.throwHistory.length > 0 ? s.throwHistory[s.throwHistory.length - 1].angle : 40;
          const isOptimal = launchAngleDeg >= 33 && launchAngleDeg <= 52;
          if (isOptimal) s.sig.optimalThrows++;
          if (distM >= 30) s.sig.goodThrows++;
          if (distM > s.sig.bestThrow) {
            s.sig.streak++;
            if (s.sig.streak > s.sig.maxStreak) s.sig.maxStreak = s.sig.streak;
            s.sig.bestThrow = distM;
            hapticVictory(); sfx.collect();
            s.screenFlash = 0.8;
          } else {
            s.sig.streak = 0;
            sfx.nearMiss(); haptic([20, 30, 20]);
          }

          const pts = Math.round(distM * 0.8);
          s.sig.score += pts;
          setScoreDisplay(s.sig.score);

          // Land marker
          s.landMarkers.push({ x: s.javelin.x, dist: distM, fresh: true });
          if (s.landMarkers.length > 6) s.landMarkers.shift();

          // Particles on land
          spawnBurst(s.particles, s.javelin.x, s.javelin.y, ACCENT, 12, 4);

          // Message
          const msg = distM >= 60 ? `🌟 ${distM.toFixed(0)}m — INCREDIBLE!` :
                      distM >= 45 ? `🎯 ${distM.toFixed(0)}m — Great throw!` :
                      distM >= 30 ? `💪 ${distM.toFixed(0)}m — Nice!` :
                      `${distM.toFixed(0)}m`;
          const color = distM >= 60 ? '#fde68a' : distM >= 45 ? '#86efac' : distM >= 30 ? '#7dd3fc' : '#94a3b8';
          setThrowMsg({ text: msg, color });
          if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
          msgTimerRef.current = setTimeout(() => {
            setThrowMsg(null);
            if (s.running) {
              s.javelin.active = false; s.javelin.landed = false;
              s.javelin.x = s.athleteX; s.javelin.y = groundY2 - 60;
              s.javelin.angle = -Math.PI * 0.42;
            }
          }, 1400);
        }
      }

      // Athlete
      s.runPhase += s.javelin.active ? 0 : 0.15;
      const legOsc = Math.sin(s.runPhase) * (s.isCharging ? 6 : 3);
      const athY = groundY2;

      ctx.save();
      ctx.translate(s.athleteX, athY);
      ctx.shadowBlur = 18; ctx.shadowColor = s.accentColor;
      ctx.fillStyle = s.accentColor;
      // Head
      ctx.beginPath(); ctx.arc(0, -62, 10, 0, Math.PI * 2); ctx.fill();
      // Torso
      ctx.fillRect(-5, -52, 10, 28);
      // Arm holding javelin
      if (!s.javelin.active) {
        ctx.strokeStyle = s.accentColor; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(5, -40); ctx.lineTo(30, -55); ctx.stroke();
      }
      // Left arm
      ctx.beginPath(); ctx.moveTo(-5, -40); ctx.lineTo(-20, -30); ctx.stroke();
      // Legs
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-3, -24); ctx.lineTo(-6 + legOsc, -4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(3, -24);  ctx.lineTo(6 - legOsc, -4);  ctx.stroke();
      ctx.restore();

      // Javelin
      ctx.save();
      ctx.translate(s.javelin.x, s.javelin.y);
      ctx.rotate(s.javelin.angle);
      ctx.shadowBlur = 14; ctx.shadowColor = s.accentColor;
      // Shaft
      ctx.strokeStyle = s.accentColor;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-JAVELIN_LEN * 0.35, 0); ctx.lineTo(JAVELIN_LEN * 0.65, 0); ctx.stroke();
      // Tip
      ctx.fillStyle = '#fde68a';
      ctx.beginPath();
      ctx.moveTo(JAVELIN_LEN * 0.65, 0);
      ctx.lineTo(JAVELIN_LEN * 0.65 + 12, -3);
      ctx.lineTo(JAVELIN_LEN * 0.65 + 12, 3);
      ctx.closePath(); ctx.fill();
      // Tail fin
      ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-JAVELIN_LEN * 0.35, 0); ctx.lineTo(-JAVELIN_LEN * 0.35 - 10, -8); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-JAVELIN_LEN * 0.35, 0); ctx.lineTo(-JAVELIN_LEN * 0.35 - 10, 8);  ctx.stroke();
      ctx.restore();

      // Optimal angle indicator (35-50° arc)
      if (!s.javelin.active && !s.javelin.landed) {
        ctx.save();
        ctx.translate(s.athleteX, groundY2 - 20);
        const arcR = 50;
        // Range arc
        ctx.strokeStyle = 'rgba(74,222,128,0.3)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(0, 0, arcR, -(Math.PI * 52 / 180 + Math.PI / 2), -(Math.PI * 33 / 180 + Math.PI / 2));
        // actually render upward to upper-right
        ctx.arc(0, 0, arcR, -Math.PI * 52 / 180, -Math.PI * 33 / 180, false);
        ctx.stroke();
        ctx.restore();
      }

      // Particles
      if (s.particles.length > 0) updateAndDrawParticles(ctx, s.particles);

      // Screen flash
      if (s.screenFlash > 0) {
        ctx.fillStyle = `rgba(167,139,250,${s.screenFlash * 0.2})`;
        ctx.fillRect(0, 0, W2, H2);
        s.screenFlash = Math.max(0, s.screenFlash - 0.06);
      }

      // Swipe hint
      if (!s.javelin.active && !s.javelin.landed) {
        ctx.save();
        ctx.globalAlpha = 0.4 + Math.sin(now * 0.003) * 0.15;
        ctx.fillStyle = '#c4b5fd';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('↗ Swipe up-right to throw', W2 / 2, H2 * 0.9);
        ctx.restore();
      }

      // Best distance display
      if (s.sig.bestThrow > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`Best: ${s.sig.bestThrow.toFixed(1)}m`, 20, H2 - 30);
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame, triggerPop]);

  // ── INPUT ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      canvas.width  = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      const ctx2 = canvas.getContext('2d');
      if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.running || s.javelin.active) return;
      s.pointerStart = { x: e.clientX, y: e.clientY, time: Date.now() };
      s.isCharging = true;
    };
    const onPointerMove = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.pointerStart) return;
      const dx = e.clientX - s.pointerStart.x;
      const dy = e.clientY - s.pointerStart.y;
      s.aimVector = { x: dx, y: dy };
    };
    const onPointerUp = (e: PointerEvent) => {
      const s = stateRef.current;
      s.isCharging = false;
      if (!s.running || !s.pointerStart || s.javelin.active) { s.pointerStart = null; s.aimVector = null; return; }
      const dx = e.clientX - s.pointerStart.x;
      const dy = e.clientY - s.pointerStart.y;
      const dt = Math.max(1, Date.now() - s.pointerStart.time);
      s.pointerStart = null; s.aimVector = null;

      const dist2d = Math.sqrt(dx * dx + dy * dy);
      if (dist2d < 25) return;

      // Velocity-based launch: faster swipe = more power
      // Invert Y since screen Y is downward
      const speedPx = dist2d / (dt / 1000);
      const power = Math.min(speedPx / 80, 18);
      const nx = dx / dist2d, ny = dy / dist2d;
      const vx = nx * power;
      const vy = ny * power;

      // Launch angle in degrees (0° = right, negative = upward)
      const launchAngleDeg = -(Math.atan2(-vy, vx) * 180 / Math.PI);
      s.throwHistory.push({ distanceM: 0, angle: launchAngleDeg, power });

      s.javelin.vx = vx; s.javelin.vy = vy;
      s.javelin.angle = Math.atan2(vy, vx);
      s.javelin.active = true; s.javelin.landed = false;

      hapticScore();
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
  }, []);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    stopMusicRef.current?.();
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio();
    setPhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => {
    startLoop();
    setPhase('playing');
  }, [startLoop]);

  const handlePlayAgain = useCallback(() => {
    endCalledRef.current = false;
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false);
    prevScoreRef.current = 0;
    setPhase('countdown');
  }, []);

  const buildInsights = (sig: Signals) => [
    { label: 'Best Throw',     value: `${sig.bestThrow.toFixed(1)}m`,  color: '#fbbf24' },
    { label: 'Good Throws',    value: `${sig.goodThrows}`,             color: '#4ade80' },
    { label: 'Optimal Angle',  value: `${sig.optimalThrows}x`,         color: theme.colors.accent ?? ACCENT },
    { label: 'Total Throws',   value: `${sig.throws}`,                 color: '#94a3b8' },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg, #0f172a 0%, #1e1b4b 100%)">

      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Step up to Throw →"
          sensorNote="Swipe up-right on screen to throw. Faster swipe = more power. Aim for 40°."
          accentColor={theme.colors.accent ?? ACCENT}
          ctaTextColor="#000"
          onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #1e1040 0%, #0f0828 60%, #05030f 100%)"
        />
      )}

      {phase === 'countdown' && (
        <Countdown onComplete={handleCountdownDone} accentColor={theme.colors.accent ?? ACCENT} />
      )}

      {(phase === 'playing' || phase === 'countdown') && (
        <>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none' }} />
          {phase === 'playing' && (
            <GameHUD accentColor={theme.colors.accent ?? ACCENT} items={[
              { label: 'TIME',  value: timeLeft,     danger: timeLeft <= 5, testId: 'timer' },
              { label: 'SCORE', value: scoreDisplay, testId: 'score' },
            ]} />
          )}
        </>
      )}

      <AnimatePresence>
        {throwMsg && phase === 'playing' && (
          <motion.div key="tmsg"
            initial={{ opacity: 0, y: 20, scale: 0.7 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -30, scale: 0.85 }}
            transition={{ duration: 0.28 }}
            style={{
              position: 'fixed', top: '24%', left: '50%', transform: 'translateX(-50%)',
              zIndex: 80, pointerEvents: 'none', fontSize: 22, fontWeight: 900,
              color: throwMsg.color, textShadow: `0 0 16px ${throwMsg.color}aa`, whiteSpace: 'nowrap',
            }}>
            {throwMsg.text}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isNewBest && phase === 'done' && (
          <motion.div key="nb" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)', zIndex: 90,
              background: 'linear-gradient(135deg, #fbbf24, #f59e0b)', borderRadius: 20, padding: '8px 20px',
              fontSize: 20, fontWeight: 900, color: '#000', whiteSpace: 'nowrap' }}>
            🏆 New Record!
          </motion.div>
        )}
      </AnimatePresence>

      {phase === 'done' && finalSig && (
        <EndScreen
          gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={`${finalSig.bestThrow.toFixed(1)}m`} personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT}
          onPlayAgain={handlePlayAgain} didWin={finalSig.bestThrow >= 40}
        />
      )}

      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}

      {phase === 'playing' && (
        <ScorePopEffect pops={pops} accentColor={theme.colors.accent ?? ACCENT} />
      )}
    </GameShell>
  );
}

// ── WEBHOOK EMITTER ─────────────────────────────────────────────────
function WebhookEmitter({ theme, sig, personality, player }: {
  theme: ReturnType<typeof useBrandTheme>;
  sig: Signals; personality: string; player: PlayerSession | null;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; fired.current = true;
    postWebhook(theme, GAME_ID, {
      personality, score: sig.score, bestThrow: sig.bestThrow,
      throws: sig.throws, optimalThrows: sig.optimalThrows,
    }, player);
  }, [theme, sig, personality, player]);
  return null;
}
