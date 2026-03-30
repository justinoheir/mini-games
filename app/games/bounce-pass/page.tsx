/**
 * ══════════════════════════════════════════════════════════════════
 *  BOUNCE PASS — Ether Glimmer
 *  Swipe to aim, release to send a bounce pass through defenders.
 *  Mechanic: swipe direction + power → ball bounces off court floor
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
import { ShakeState, triggerShake, applyShake } from '@/lib/screenShake';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';

// ── CONSTANTS ──────────────────────────────────────────────────────
const GAME_ID      = 'bounce-pass';
const PB_KEY       = 'pb_bounce-pass';
const ACCENT       = '#f97316';
const DURATION     = 30;
const GAME_EMOJI   = '🏀';
const GAME_TITLE   = 'Bounce Pass';
const GAME_TAGLINE = 'Swipe to bounce-pass through defenders.';

const BALL_RADIUS  = 18;
const DEFENDER_W   = 28;
const DEFENDER_H   = 70;

// ── TYPES ───────────────────────────────────────────────────────────
interface Defender {
  id: number;
  x: number;      // center
  y: number;      // center (fixed row)
  vx: number;     // horizontal movement
  w: number;
  h: number;
}

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  active: boolean;
  bounced: boolean;
  trail: { x: number; y: number }[];
}

interface Signals {
  score: number;
  passes: number;
  misses: number;
  maxStreak: number;
  streak: number;
  fastPasses: number;  // passes completed quickly
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  ball: Ball;
  defenders: Defender[];
  nextDefenderId: number;
  particles: Particle[];
  shakeState: ShakeState;
  pointerStart: { x: number; y: number; time: number } | null;
  aimLine: { x1: number; y1: number; x2: number; y2: number } | null;
  aimActive: boolean;
  gameStartTime: number;
  passStartTime: number;
  courtScale: number;
  accentColor: string;
  screenFlash: number;
  flashColor: string;
}

// ── PERSONALITY ─────────────────────────────────────────────────────
function getPersonality(sig: Signals): string {
  const total = sig.passes + sig.misses;
  if (total === 0) return 'Ball Carrier 🏀';
  const acc = sig.passes / total;
  if (acc >= 0.8 && sig.maxStreak >= 5)  return 'Point Guard 🎯';
  if (sig.fastPasses >= 5)               return 'Quick Hands ⚡';
  if (acc >= 0.7)                        return 'Sharp Passer 💫';
  if (sig.maxStreak >= 4)                return 'In the Groove 🌊';
  if (sig.passes >= 8)                   return 'Work Horse 💪';
  return 'Learning the Bounce 🔄';
}

// ── COMPONENT ───────────────────────────────────────────────────────
export default function BouncePassGame() {
  const theme      = useBrandTheme();
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const animRef    = useRef(0);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const endCalledRef = useRef(false);

  const stateRef = useRef<GState>({
    running: false, timeLeft: DURATION,
    sig: { score: 0, passes: 0, misses: 0, maxStreak: 0, streak: 0, fastPasses: 0 },
    ball: { x: 0, y: 0, vx: 0, vy: 0, active: false, bounced: false, trail: [] },
    defenders: [], nextDefenderId: 0,
    particles: [], shakeState: { intensity: 0, duration: 0 },
    pointerStart: null, aimLine: null, aimActive: false,
    gameStartTime: 0, passStartTime: 0, courtScale: 1,
    accentColor: ACCENT, screenFlash: 0, flashColor: '#4ade80',
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [passMsg, setPassMsg]           = useState<{ text: string; color: string } | null>(null);
  const [isNewBest, setIsNewBest]       = useState(false);
  const [streak, setStreak]             = useState(0);
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

  // ── SPAWN DEFENDERS ──────────────────────────────────────────────
  const spawnDefenders = useCallback((W: number, H: number, count: number) => {
    const s = stateRef.current;
    s.defenders = [];
    const rowY = H * 0.35;  // defender row Y
    const spread = W * 0.65;
    const startX = W * 0.18;

    for (let i = 0; i < count; i++) {
      const baseX = startX + (spread / (count - 1 || 1)) * i;
      s.defenders.push({
        id: s.nextDefenderId++,
        x: baseX,
        y: rowY,
        vx: (1.5 + Math.random() * 1.5) * (Math.random() < 0.5 ? 1 : -1),
        w: DEFENDER_W, h: DEFENDER_H,
      });
    }
  }, []);

  // ── RESET BALL ───────────────────────────────────────────────────
  const resetBall = useCallback(() => {
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;
    s.ball = {
      x: W / 2 + (Math.random() - 0.5) * 40,
      y: H * 0.8,
      vx: 0, vy: 0, active: false, bounced: false, trail: [],
    };
    s.aimLine = null; s.aimActive = false;
    s.passStartTime = Date.now();
  }, []);

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
      const prev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      if (s.sig.score > prev) { localStorage.setItem(PB_KEY, String(s.sig.score)); setIsNewBest(true); }
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
    s.sig = { score: 0, passes: 0, misses: 0, maxStreak: 0, streak: 0, fastPasses: 0 };
    s.nextDefenderId = 0; s.particles = [];
    s.shakeState = { intensity: 0, duration: 0 };
    s.screenFlash = 0; s.gameStartTime = Date.now();
    setScoreDisplay(0); setTimeLeft(DURATION); setStreak(0);

    const W = window.innerWidth, H = window.innerHeight;
    spawnDefenders(W, H, 2);

    s.ball = { x: W / 2, y: H * 0.8, vx: 0, vy: 0, active: false, bounced: false, trail: [] };
    s.passStartTime = Date.now();

    stopMusicRef.current = startMusic('sports');

    timerRef.current = setInterval(() => {
      s.timeLeft--;
      setTimeLeft(s.timeLeft);
      sfx.tick();
      if (s.timeLeft === 20) spawnDefenders(window.innerWidth, window.innerHeight, 3);
      if (s.timeLeft === 10) { sfx.warning(); spawnDefenders(window.innerWidth, window.innerHeight, 3); }
      if (s.timeLeft <= 0) endGame();
    }, 1000);

    const loop = () => {
      if (!s.running) return;
      const W2 = window.innerWidth, H2 = window.innerHeight;
      const now = Date.now();
      const elapsed = (now - s.gameStartTime) / 1000;
      const groundY  = H2 * 0.78;  // bounce floor
      const targetY  = H2 * 0.12;  // target receiver area
      const defRowY  = H2 * 0.35;

      ctx.save();
      applyShake(ctx, s.shakeState);

      // Court background
      const bg = ctx.createLinearGradient(0, 0, 0, H2);
      bg.addColorStop(0, '#1c1917');
      bg.addColorStop(1, '#292524');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W2, H2);

      // Court lines
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 2;
      // Center line
      ctx.beginPath(); ctx.moveTo(0, H2 / 2); ctx.lineTo(W2, H2 / 2); ctx.stroke();
      // Three-point arc (partial)
      ctx.beginPath(); ctx.arc(W2 / 2, H2 * 0.85, H2 * 0.28, Math.PI, 0); ctx.stroke();
      // Lane
      ctx.strokeRect(W2 * 0.3, H2 * 0.65, W2 * 0.4, H2 * 0.22);

      // Floor (court surface)
      ctx.fillStyle = '#7c2d12';
      ctx.fillRect(0, groundY, W2, H2 - groundY);
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(W2, groundY); ctx.stroke();

      // Target zone (receive area)
      const targetGrad = ctx.createLinearGradient(0, targetY - 20, 0, targetY + 20);
      targetGrad.addColorStop(0, 'rgba(74,222,128,0)');
      targetGrad.addColorStop(0.5, 'rgba(74,222,128,0.2)');
      targetGrad.addColorStop(1, 'rgba(74,222,128,0)');
      ctx.fillStyle = targetGrad;
      ctx.fillRect(W2 * 0.1, targetY - 20, W2 * 0.8, 40);
      ctx.strokeStyle = 'rgba(74,222,128,0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 5]);
      ctx.beginPath(); ctx.moveTo(W2 * 0.1, targetY); ctx.lineTo(W2 * 0.9, targetY); ctx.stroke();
      ctx.setLineDash([]);

      // Aim line preview (while holding)
      if (s.aimActive && s.aimLine && !s.ball.active) {
        const { x1, y1, x2, y2 } = s.aimLine;
        const vx = (x2 - x1) * 0.15;
        const vy = (y2 - y1) * 0.15;
        // Draw dotted trajectory (simple parabola preview)
        ctx.save();
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = 'rgba(249,115,22,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        // Simulate a few points
        let px = s.ball.x, py = s.ball.y;
        let pvx = vx, pvy = vy;
        let bounced = false;
        ctx.moveTo(px, py);
        for (let step = 0; step < 30; step++) {
          px += pvx; py += pvy; pvy += 0.4;
          if (py >= groundY && !bounced) { pvy = -pvy * 0.75; bounced = true; }
          ctx.lineTo(px, py);
          if (py > H2 + 20) break;
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Defenders
      const defSpeed = 1.5 + Math.min(3, elapsed * 0.08);
      for (const def of s.defenders) {
        def.x += def.vx * defSpeed;
        if (def.x < def.w / 2 + W2 * 0.05) { def.x = def.w / 2 + W2 * 0.05; def.vx = Math.abs(def.vx); }
        if (def.x > W2 - def.w / 2 - W2 * 0.05) { def.x = W2 - def.w / 2 - W2 * 0.05; def.vx = -Math.abs(def.vx); }

        ctx.save();
        ctx.shadowBlur = 10; ctx.shadowColor = '#ef4444';
        // Body
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(def.x - def.w / 2, def.y - def.h / 2, def.w, def.h * 0.7);
        // Head
        ctx.beginPath(); ctx.arc(def.x, def.y - def.h / 2 - 12, 12, 0, Math.PI * 2);
        ctx.fillStyle = '#fca5a5'; ctx.fill();
        // Arms raised (blocking)
        ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(def.x, def.y - def.h * 0.25);
        ctx.lineTo(def.x - 24, def.y - def.h * 0.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(def.x, def.y - def.h * 0.25);
        ctx.lineTo(def.x + 24, def.y - def.h * 0.5); ctx.stroke();
        ctx.restore();
      }

      // Ball physics
      if (s.ball.active) {
        s.ball.vy += 0.45; // gravity
        s.ball.vx *= 0.995; // air drag
        s.ball.x += s.ball.vx;
        s.ball.y += s.ball.vy;

        // Trail
        s.ball.trail.push({ x: s.ball.x, y: s.ball.y });
        if (s.ball.trail.length > 12) s.ball.trail.shift();

        // Bounce off floor
        if (s.ball.y >= groundY - BALL_RADIUS && !s.ball.bounced) {
          s.ball.y = groundY - BALL_RADIUS;
          s.ball.vy = -Math.abs(s.ball.vy) * 0.72;
          s.ball.bounced = true;
          sfx.nearMiss(); haptic([20]);
          spawnBurst(s.particles, s.ball.x, s.ball.y, '#fbbf24', 8, 3);
        }

        // Check collision with defenders
        let hitDefender = false;
        for (const def of s.defenders) {
          const inX = s.ball.x > def.x - def.w / 2 - BALL_RADIUS && s.ball.x < def.x + def.w / 2 + BALL_RADIUS;
          const inY = s.ball.y > def.y - def.h / 2 - BALL_RADIUS && s.ball.y < def.y + def.h * 0.25 + BALL_RADIUS;
          if (inX && inY) {
            hitDefender = true; break;
          }
        }

        if (hitDefender) {
          // Blocked
          s.sig.misses++;
          s.sig.streak = 0; setStreak(0);
          triggerShake(s.shakeState, 6, 8);
          s.screenFlash = 0.6; s.flashColor = '#ef4444';
          sfx.collision(); hapticFail();
          setPassMsg({ text: '🛡️ Blocked!', color: '#fca5a5' });
          if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
          msgTimerRef.current = setTimeout(() => setPassMsg(null), 900);
          s.ball.active = false;
          setTimeout(() => resetBall(), 600);
        } else if (s.ball.bounced && s.ball.y <= targetY + 30 && s.ball.y >= targetY - 50) {
          // Successful pass through!
          const passTime = (Date.now() - s.passStartTime) / 1000;
          s.sig.passes++;
          s.sig.streak++;
          if (s.sig.streak > s.sig.maxStreak) s.sig.maxStreak = s.sig.streak;
          if (passTime < 2.5) s.sig.fastPasses++;
          const pts = 1 + Math.floor(s.sig.streak / 3) + (passTime < 2 ? 1 : 0);
          s.sig.score += pts;
          setScoreDisplay(s.sig.score);
          setStreak(s.sig.streak);
          s.screenFlash = 0.5; s.flashColor = '#4ade80';
          spawnBurst(s.particles, s.ball.x, s.ball.y, '#4ade80', 18, 5);
          sfx.collect(); hapticScore();
          const msg = s.sig.streak >= 3 ? `🔥 ${s.sig.streak}x Streak!` : '✓ Nice Pass!';
          setPassMsg({ text: msg, color: '#86efac' });
          if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
          msgTimerRef.current = setTimeout(() => setPassMsg(null), 900);
          s.ball.active = false;
          setTimeout(() => resetBall(), 500);
        } else if (s.ball.y < -BALL_RADIUS - 20 || s.ball.x < -BALL_RADIUS - 20 || s.ball.x > window.innerWidth + BALL_RADIUS + 20) {
          // Out of bounds
          s.sig.misses++;
          s.sig.streak = 0; setStreak(0);
          sfx.nearMiss(); haptic([30, 20, 30]);
          setPassMsg({ text: '📤 Out of bounds', color: '#fca5a5' });
          if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
          msgTimerRef.current = setTimeout(() => setPassMsg(null), 900);
          s.ball.active = false;
          setTimeout(() => resetBall(), 500);
        }
      }

      // Draw ball trail
      for (let ti = 0; ti < s.ball.trail.length; ti++) {
        const tp = s.ball.trail[ti];
        ctx.globalAlpha = (ti / s.ball.trail.length) * 0.4;
        ctx.fillStyle = s.accentColor;
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, BALL_RADIUS * (0.3 + ti / s.ball.trail.length * 0.7), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Draw ball
      if (s.ball.active || !s.ball.active) {
        ctx.save();
        ctx.shadowBlur = 20; ctx.shadowColor = s.accentColor;
        const ballGrad = ctx.createRadialGradient(s.ball.x - 5, s.ball.y - 5, 2, s.ball.x, s.ball.y, BALL_RADIUS);
        ballGrad.addColorStop(0, '#fdba74');
        ballGrad.addColorStop(0.6, '#f97316');
        ballGrad.addColorStop(1, '#c2410c');
        ctx.fillStyle = ballGrad;
        ctx.beginPath(); ctx.arc(s.ball.x, s.ball.y, BALL_RADIUS, 0, Math.PI * 2); ctx.fill();
        // Basketball lines
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(s.ball.x - BALL_RADIUS, s.ball.y);
        ctx.lineTo(s.ball.x + BALL_RADIUS, s.ball.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s.ball.x, s.ball.y - BALL_RADIUS);
        ctx.lineTo(s.ball.x, s.ball.y + BALL_RADIUS); ctx.stroke();
        ctx.restore();
      }

      // Particles
      if (s.particles.length > 0) updateAndDrawParticles(ctx, s.particles);

      // Screen flash
      if (s.screenFlash > 0) {
        ctx.fillStyle = `${s.flashColor}${Math.round(s.screenFlash * 35).toString(16).padStart(2, '0')}`;
        ctx.fillRect(0, 0, W2, H2);
        s.screenFlash = Math.max(0, s.screenFlash - 0.07);
      }

      // Swipe hint
      if (!s.ball.active) {
        ctx.save();
        ctx.globalAlpha = 0.4 + Math.sin(now * 0.003) * 0.2;
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('↑ Swipe up to pass', W2 / 2, H2 * 0.88);
        ctx.restore();
      }

      ctx.restore(); // shake

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame, resetBall, spawnDefenders, triggerPop]);

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
      if (!s.running || s.ball.active) return;
      s.pointerStart = { x: e.clientX, y: e.clientY, time: Date.now() };
      s.aimActive = true;
      s.aimLine = { x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY };
    };
    const onPointerMove = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.aimActive || !s.aimLine) return;
      s.aimLine.x2 = e.clientX; s.aimLine.y2 = e.clientY;
    };
    const onPointerUp = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.running || !s.pointerStart) { s.aimActive = false; return; }
      const dx = e.clientX - s.pointerStart.x;
      const dy = e.clientY - s.pointerStart.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      s.pointerStart = null;
      s.aimActive = false; s.aimLine = null;

      if (dist < 20) return; // too short

      // Launch ball with swipe vector (invert Y so swipe up = ball goes up)
      const power = Math.min(dist / 6, 14);
      const nx = dx / dist, ny = dy / dist;
      s.ball.vx = nx * power * 0.85;
      s.ball.vy = ny * power * 1.1;
      s.ball.active = true; s.ball.bounced = false; s.ball.trail = [];
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
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false); setStreak(0);
    prevScoreRef.current = 0;
    setPhase('countdown');
  }, []);

  const buildInsights = (sig: Signals) => [
    { label: 'Passes Made', value: `${sig.passes}`,          color: '#4ade80' },
    { label: 'Blocked',     value: `${sig.misses}`,          color: sig.misses === 0 ? '#4ade80' : '#ef4444' },
    { label: 'Quick Passes', value: `${sig.fastPasses}`,     color: '#fbbf24' },
    { label: 'Best Streak', value: `${sig.maxStreak}x`,      color: theme.colors.accent ?? ACCENT },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg, #1c1917 0%, #292524 100%)">

      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Take the Court →"
          sensorNote="Swipe upward on the ball to throw a bounce pass. Find the gaps between defenders."
          accentColor={theme.colors.accent ?? ACCENT}
          ctaTextColor="#000"
          onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #2c1810 0%, #1a0e08 60%, #0d0603 100%)"
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
        {passMsg && phase === 'playing' && (
          <motion.div key="pmsg"
            initial={{ opacity: 0, y: 10, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
            style={{
              position: 'fixed', top: '25%', left: '50%', transform: 'translateX(-50%)',
              zIndex: 80, pointerEvents: 'none', fontSize: 24, fontWeight: 900,
              color: passMsg.color, textShadow: `0 0 14px ${passMsg.color}88`, whiteSpace: 'nowrap',
            }}>
            {passMsg.text}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isNewBest && phase === 'done' && (
          <motion.div key="nb" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', top: '10%', left: '50%', transform: 'translateX(-50%)', zIndex: 90,
              background: 'linear-gradient(135deg, #fbbf24, #f59e0b)', borderRadius: 20, padding: '8px 20px',
              fontSize: 20, fontWeight: 900, color: '#000', whiteSpace: 'nowrap' }}>
            🏆 New Best!
          </motion.div>
        )}
      </AnimatePresence>

      {phase === 'done' && finalSig && (
        <EndScreen
          gameId={GAME_ID} title={getPersonality(finalSig)} emoji={GAME_EMOJI}
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT}
          onPlayAgain={handlePlayAgain} didWin={finalSig.passes >= 8}
        />
      )}

      {phase === 'done' && finalSig && (
        <WebhookEmitter theme={theme} sig={finalSig} personality={getPersonality(finalSig)} player={playerSessionRef.current} />
      )}

      {phase === 'playing' && (
        <>
          <ScorePopEffect pops={pops} accentColor={theme.colors.accent ?? ACCENT} />
          <StreakBadge streak={streak} accentColor={theme.colors.accent ?? ACCENT} />
        </>
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
      personality, score: sig.score, passes: sig.passes,
      fastPasses: sig.fastPasses, maxStreak: sig.maxStreak,
    }, player);
  }, [theme, sig, personality, player]);
  return null;
}
