/**
 * ══════════════════════════════════════════════════════════════════
 *  SKI SLALOM — Ether Glimmer
 *  Tilt to steer through gates. Speed increases. Don't hit the poles.
 *  Sensor: DeviceOrientationEvent (tilt) with touch fallback
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
import { createTiltController } from '@/lib/tilt';
import { Particle, spawnBurst, updateAndDrawParticles } from '@/lib/particles';
import { ShakeState, triggerShake, applyShake } from '@/lib/screenShake';
import { motion, AnimatePresence } from 'framer-motion';
import ScorePopEffect, { useScorePop } from '@/components/ScorePopEffect';
import StreakBadge from '@/components/StreakBadge';
import SwipeInstructions from '@/components/SwipeInstructions';

// ── CONSTANTS ──────────────────────────────────────────────────────
const GAME_ID      = 'ski-slalom';
const PB_KEY       = 'pb_ski-slalom';
const ACCENT       = '#38bdf8';
const DURATION     = 45;
const GAME_EMOJI   = '⛷️';
const GAME_TITLE   = 'Ski Slalom';
const GAME_TAGLINE = 'Tilt to carve. Thread every gate.';
const MAX_LIVES    = 3;
const SKIER_RADIUS = 16;

// Speed/gap stages
function getStageParams(elapsed: number): { speed: number; spawnMs: number; gapPx: number } {
  if (elapsed < 12)  return { speed: 2.8, spawnMs: 2400, gapPx: 115 };
  if (elapsed < 12.5) {
    const t = (elapsed - 12) / 0.5;
    return { speed: 2.8 + t * 1.5, spawnMs: Math.round(2400 - t * 500), gapPx: Math.round(115 - t * 20) };
  }
  if (elapsed < 26)  return { speed: 4.3, spawnMs: 1900, gapPx: 95 };
  if (elapsed < 26.5) {
    const t = (elapsed - 26) / 0.5;
    return { speed: 4.3 + t * 2.5, spawnMs: Math.round(1900 - t * 500), gapPx: Math.round(95 - t * 18) };
  }
  return { speed: 6.8, spawnMs: 1400, gapPx: 77 };
}

// ── TYPES ───────────────────────────────────────────────────────────
interface Gate {
  id: number;
  y: number;
  gapCx: number;   // gap center X (pixels)
  gapPx: number;   // gap width
  color: string;   // alternating red/blue
  passed: boolean;
  hit: boolean;
  near: boolean;
}

interface Signals {
  score: number;
  gatesPassed: number;
  gateMisses: number;
  collisions: number;
  maxStreak: number;
  streak: number;
  nearMisses: number;
  totalGates: number;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GState {
  running: boolean;
  lives: number;
  timeLeft: number;
  sig: Signals;
  skierX: number;        // normalized 0–1
  tiltX: number;
  touchDir: number;
  touchActive: boolean;
  gates: Gate[];
  nextGateId: number;
  lastSpawnTime: number;
  gameStartTime: number;
  particles: Particle[];
  shakeState: ShakeState;
  screenFlash: number;
  snowParticles: { x: number; y: number; speed: number; size: number }[];
  accentColor: string;
  trailPoints: { x: number; y: number; alpha: number }[];
}

// ── PERSONALITY ─────────────────────────────────────────────────────
function getPersonality(sig: Signals): string {
  const acc = sig.totalGates > 0 ? sig.gatesPassed / sig.totalGates : 0;
  if (sig.collisions === 0 && sig.gatesPassed >= 18) return 'Slalom King 🏆';
  if (acc >= 0.85 && sig.maxStreak >= 8)              return 'Precision Carver 🎯';
  if (sig.collisions <= 1 && sig.gatesPassed >= 15)   return 'Clean Rider 🌟';
  if (sig.gatesPassed >= 20)                          return 'Speed Demon 💨';
  if (sig.nearMisses >= 6)                            return 'Edge Pusher ⚡';
  return 'Snow Rookie 🎿';
}

// ── COMPONENT ───────────────────────────────────────────────────────
export default function SkiSlalomGame() {
  const theme      = useBrandTheme();
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const animRef    = useRef(0);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const tiltRef    = useRef<ReturnType<typeof createTiltController> | null>(null);
  const touchRef   = useRef(false);
  const endCalledRef = useRef(false);

  const stateRef = useRef<GState>({
    running: false, lives: MAX_LIVES, timeLeft: DURATION,
    sig: { score: 0, gatesPassed: 0, gateMisses: 0, collisions: 0, maxStreak: 0, streak: 0, nearMisses: 0, totalGates: 0 },
    skierX: 0.5, tiltX: 0, touchDir: 0, touchActive: false,
    gates: [], nextGateId: 0, lastSpawnTime: 0, gameStartTime: 0,
    particles: [], shakeState: { intensity: 0, duration: 0 }, screenFlash: 0,
    snowParticles: [], accentColor: ACCENT,
    trailPoints: [],
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [playerName, setPlayerName]     = useState('');
  const [isNewBest, setIsNewBest]       = useState(false);
  const [streak, setStreak]             = useState(0);
  const { pops, triggerPop }            = useScorePop();
  const playerSessionRef                = useRef<PlayerSession | null>(null);
  const prevScoreRef                    = useRef(0);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  useEffect(() => {
    if (scoreDisplay > prevScoreRef.current) {
      triggerPop(`+${scoreDisplay - prevScoreRef.current}`, window.innerWidth / 2, 200);
    }
    prevScoreRef.current = scoreDisplay;
  }, [scoreDisplay, triggerPop]);

  // ── END GAME ────────────────────────────────────────────────────
  const endGame = useCallback(() => {
    if (endCalledRef.current) return;
    endCalledRef.current = true;
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    stopMusicRef.current?.(); stopMusicRef.current = null;
    tiltRef.current?.stop();

    sfx.gameOver(); hapticFail();
    try {
      const prev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      if (s.sig.gatesPassed > prev) { localStorage.setItem(PB_KEY, String(s.sig.gatesPassed)); setIsNewBest(true); }
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
    s.running = true; s.lives = MAX_LIVES; s.timeLeft = DURATION;
    s.sig = { score: 0, gatesPassed: 0, gateMisses: 0, collisions: 0, maxStreak: 0, streak: 0, nearMisses: 0, totalGates: 0 };
    s.skierX = 0.5; s.tiltX = 0; s.touchDir = 0;
    s.gates = []; s.nextGateId = 0; s.lastSpawnTime = 0;
    s.particles = []; s.shakeState = { intensity: 0, duration: 0 }; s.screenFlash = 0;
    s.trailPoints = []; s.gameStartTime = Date.now();
    // Spawn initial snow particles
    s.snowParticles = Array.from({ length: 60 }, () => ({
      x: Math.random() * (window.innerWidth || 400),
      y: Math.random() * (window.innerHeight || 800),
      speed: 0.5 + Math.random() * 1.2,
      size: 1 + Math.random() * 2,
    }));

    setScoreDisplay(0); setTimeLeft(DURATION); setStreak(0);

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
      const W = window.innerWidth, H = window.innerHeight;
      const elapsed = (Date.now() - s.gameStartTime) / 1000;
      const { speed, spawnMs, gapPx } = getStageParams(elapsed);
      const skierY = H * 0.72;

      // Player movement
      let moveDir = touchRef.current ? s.touchDir * 0.8 : s.tiltX * 1.0;
      const speedFactor = 0.015 + elapsed * 0.00005;
      s.skierX = Math.max(0.04, Math.min(0.96, s.skierX + moveDir * speedFactor));
      const skierPx = s.skierX * W;

      // Spawn gate
      const now = Date.now();
      if (now - s.lastSpawnTime > spawnMs) {
        s.lastSpawnTime = now;
        const margin = gapPx / 2 + 30;
        const gapCx = margin + Math.random() * (W - margin * 2);
        s.gates.push({
          id: s.nextGateId++, y: -40,
          gapCx, gapPx,
          color: s.nextGateId % 2 === 0 ? '#ef4444' : '#3b82f6',
          passed: false, hit: false, near: false,
        });
        s.sig.totalGates++;
      }

      // Draw background (mountain/snow)
      ctx.save();
      applyShake(ctx, s.shakeState);

      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#e0f2fe');
      bg.addColorStop(0.5, '#bae6fd');
      bg.addColorStop(1, '#f0f9ff');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Snow particles
      for (const sp of s.snowParticles) {
        sp.y += sp.speed + speed * 0.3;
        if (sp.y > H + 5) sp.y = -5;
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // Speed lines in fast stage
      if (elapsed > 26) {
        for (let i = 0; i < 3; i++) {
          const lx = Math.random() * W;
          const len = 15 + Math.random() * 25;
          ctx.strokeStyle = 'rgba(186,230,253,0.5)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(lx, Math.random() * H); ctx.lineTo(lx, Math.random() * H + len); ctx.stroke();
        }
      }

      // Process gates
      for (let gi = s.gates.length - 1; gi >= 0; gi--) {
        const gate = s.gates[gi];
        gate.y += speed;

        const leftPoleX  = gate.gapCx - gate.gapPx / 2;
        const rightPoleX = gate.gapCx + gate.gapPx / 2;
        const poleW = 12, poleH = 36;
        const flagH = 18;

        // Gate pass detection
        if (!gate.passed && !gate.hit && gate.y > skierY + SKIER_RADIUS) {
          gate.passed = true;
          // Check if skier threaded gap
          const inGap = skierPx > leftPoleX + poleW / 2 && skierPx < rightPoleX - poleW / 2;
          if (inGap) {
            s.sig.gatesPassed++;
            s.sig.streak++;
            if (s.sig.streak > s.sig.maxStreak) s.sig.maxStreak = s.sig.streak;
            const points = 1 + Math.floor(s.sig.streak / 3);
            s.sig.score += points;
            sfx.collect(); hapticScore();
            spawnBurst(s.particles, gate.gapCx, gate.y, gate.color, 10, 4);
            setScoreDisplay(s.sig.gatesPassed);
            setStreak(s.sig.streak);
          } else {
            // Missed gate — check if they even passed through near-ish
            s.sig.gateMisses++;
            s.sig.streak = 0;
            setStreak(0);
            sfx.nearMiss(); haptic([20, 30, 20]);
          }
        }

        // Collision: hit pole while passing through gate zone
        if (!gate.passed && !gate.hit && s.lives > 0) {
          const gateZone = gate.y >= skierY - SKIER_RADIUS * 2 && gate.y <= skierY + SKIER_RADIUS * 2;
          if (gateZone) {
            const hitLeft  = skierPx < leftPoleX + poleW / 2 + SKIER_RADIUS * 0.7;
            const hitRight = skierPx > rightPoleX - poleW / 2 - SKIER_RADIUS * 0.7;
            if (hitLeft || hitRight) {
              gate.hit = true;
              s.lives--; s.sig.collisions++;
              s.sig.streak = 0; setStreak(0);
              s.screenFlash = 1.0;
              triggerShake(s.shakeState, 8, 10);
              spawnBurst(s.particles, skierPx, skierY, '#ef4444', 18, 5);
              sfx.collision(); hapticFail();
              if (s.lives <= 0) { setTimeout(() => endGame(), 400); }
            }
            // Near miss tracking
            const distToEdge = hitLeft ? (leftPoleX + poleW / 2 - skierPx + SKIER_RADIUS * 0.7) : (skierPx - rightPoleX + poleW / 2 + SKIER_RADIUS * 0.7);
            if (distToEdge < SKIER_RADIUS * 1.5 && !gate.near) {
              gate.near = true; s.sig.nearMisses++;
            }
          }
        }

        if (gate.y > H + 60) { s.gates.splice(gi, 1); continue; }

        // Draw gate
        ctx.save();
        const opacity = gate.hit ? 0.3 : 1;
        ctx.globalAlpha = opacity;

        // Gate connecting rope/line
        ctx.strokeStyle = gate.color + '88';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(leftPoleX + poleW / 2, gate.y - poleH / 2);
        ctx.lineTo(rightPoleX - poleW / 2, gate.y - poleH / 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Left pole
        ctx.fillStyle = gate.color;
        ctx.shadowBlur = 8; ctx.shadowColor = gate.color;
        ctx.fillRect(leftPoleX, gate.y - poleH, poleW, poleH);
        // Left flag
        ctx.beginPath();
        ctx.moveTo(leftPoleX + poleW, gate.y - poleH);
        ctx.lineTo(leftPoleX + poleW + 20, gate.y - poleH + flagH / 2);
        ctx.lineTo(leftPoleX + poleW, gate.y - poleH + flagH);
        ctx.closePath();
        ctx.fill();

        // Right pole (opposite color)
        const rightColor = gate.color === '#ef4444' ? '#3b82f6' : '#ef4444';
        ctx.fillStyle = rightColor;
        ctx.shadowColor = rightColor;
        ctx.fillRect(rightPoleX - poleW, gate.y - poleH, poleW, poleH);
        ctx.beginPath();
        ctx.moveTo(rightPoleX - poleW, gate.y - poleH);
        ctx.lineTo(rightPoleX - poleW - 20, gate.y - poleH + flagH / 2);
        ctx.lineTo(rightPoleX - poleW, gate.y - poleH + flagH);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
      }

      // Skier trail
      s.trailPoints.unshift({ x: skierPx, y: skierY, alpha: 0.4 });
      if (s.trailPoints.length > 8) s.trailPoints.length = 8;
      for (let ti = 0; ti < s.trailPoints.length; ti++) {
        s.trailPoints[ti].alpha = (1 - ti / s.trailPoints.length) * 0.35;
      }
      ctx.fillStyle = s.accentColor;
      for (const tp of s.trailPoints) {
        ctx.globalAlpha = tp.alpha;
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, SKIER_RADIUS * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Draw skier (triangle body + ski lines)
      ctx.save();
      ctx.translate(skierPx, skierY);
      ctx.shadowBlur = 20; ctx.shadowColor = s.accentColor;
      // Body
      ctx.fillStyle = s.accentColor;
      ctx.beginPath();
      ctx.moveTo(0, -SKIER_RADIUS);
      ctx.lineTo(SKIER_RADIUS * 0.7, SKIER_RADIUS * 0.5);
      ctx.lineTo(-SKIER_RADIUS * 0.7, SKIER_RADIUS * 0.5);
      ctx.closePath();
      ctx.fill();
      // Head
      ctx.fillStyle = '#fde68a';
      ctx.beginPath();
      ctx.arc(0, -SKIER_RADIUS - 6, 6, 0, Math.PI * 2);
      ctx.fill();
      // Skis
      ctx.strokeStyle = '#1e40af';
      ctx.lineWidth = 3;
      ctx.shadowBlur = 0;
      const lean = moveDir * 8;
      ctx.beginPath();
      ctx.moveTo(-12 + lean, SKIER_RADIUS * 0.5);
      ctx.lineTo(-16 + lean, SKIER_RADIUS + 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(12 + lean, SKIER_RADIUS * 0.5);
      ctx.lineTo(16 + lean, SKIER_RADIUS + 5);
      ctx.stroke();
      ctx.restore();

      // Particles
      if (s.particles.length > 0) updateAndDrawParticles(ctx, s.particles);

      // Screen flash
      if (s.screenFlash > 0) {
        ctx.fillStyle = `rgba(239,68,68,${s.screenFlash * 0.28})`;
        ctx.fillRect(0, 0, W, H);
        s.screenFlash = Math.max(0, s.screenFlash - 0.07);
      }

      // Lives (ski icons)
      const lifeY = 160;
      for (let li = 0; li < MAX_LIVES; li++) {
        const lx = W / 2 - (MAX_LIVES - 1) * 18 + li * 36;
        ctx.save();
        ctx.globalAlpha = li < s.lives ? 1 : 0.2;
        ctx.font = '20px serif';
        ctx.textAlign = 'center';
        ctx.fillText('⛷️', lx, lifeY);
        ctx.restore();
      }

      ctx.restore(); // shake

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  // ── CANVAS + INPUT SETUP ────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width  = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      canvas.width  = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      const ctx2 = canvas.getContext('2d');
      if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const onPointerDown = (e: PointerEvent) => {
      if (!touchRef.current) return;
      stateRef.current.touchDir = e.clientX < window.innerWidth / 2 ? -1 : 1;
      stateRef.current.touchActive = true;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!touchRef.current || !stateRef.current.touchActive) return;
      stateRef.current.touchDir = e.clientX < window.innerWidth / 2 ? -1 : 1;
    };
    const onPointerUp = () => { stateRef.current.touchDir = 0; stateRef.current.touchActive = false; };

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
    tiltRef.current?.stop();
  }, []);

  // ── PHASE HANDLERS ─────────────────────────────────────────────
  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio();
    const ctrl = createTiltController(
      (x) => { stateRef.current.tiltX = x; },
      { sensitivity: 1.1, smoothing: 0.38, deadzone: 2.5, clamp: 28 },
    );
    const granted = await ctrl.start();
    if (granted) { tiltRef.current = ctrl; touchRef.current = false; }
    else { ctrl.stop(); touchRef.current = true; }
    setPhase('countdown');
  }, []);

  const handleCountdownDone = useCallback(() => {
    startLoop();
    setPhase('playing');
  }, [startLoop]);

  const handlePlayAgain = useCallback(async () => {
    tiltRef.current?.stop(); tiltRef.current = null;
    endCalledRef.current = false;
    setScoreDisplay(0); setTimeLeft(DURATION); setFinalSig(null); setIsNewBest(false); setStreak(0);
    prevScoreRef.current = 0;
    const ctrl = createTiltController(
      (x) => { stateRef.current.tiltX = x; },
      { sensitivity: 1.1, smoothing: 0.38, deadzone: 2.5, clamp: 28 },
    );
    const granted = await ctrl.start();
    if (granted) { tiltRef.current = ctrl; touchRef.current = false; }
    else { ctrl.stop(); touchRef.current = true; }
    setPhase('countdown');
  }, []);

  const buildInsights = (sig: Signals) => [
    { label: 'Gates Cleared', value: `${sig.gatesPassed}`, color: sig.gatesPassed >= 20 ? '#4ade80' : sig.gatesPassed >= 10 ? '#facc15' : '#ef4444' },
    { label: 'Crashes',       value: `${sig.collisions}`, color: sig.collisions === 0 ? '#4ade80' : sig.collisions <= 1 ? '#facc15' : '#ef4444' },
    { label: 'Best Streak',   value: `${sig.maxStreak}x`,  color: theme.colors.accent ?? ACCENT },
    { label: 'Near Misses',   value: `${sig.nearMisses}`,  color: '#a78bfa' },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg, #e0f2fe 0%, #bae6fd 50%, #f0f9ff 100%)">

      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Hit the Slopes →"
          sensorNote="Tilt your phone to steer. Hold left/right side as fallback."
          accentColor={theme.colors.accent ?? ACCENT}
          ctaTextColor="#fff"
          onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #0c2a4a 0%, #071928 60%, #020d15 100%)"
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
              { label: 'TIME',   value: timeLeft,      danger: timeLeft <= 5, testId: 'timer' },
              { label: 'GATES',  value: scoreDisplay,  testId: 'score' },
            ]} />
          )}
        </>
      )}

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
          score={String(finalSig.gatesPassed)} personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT}
          onPlayAgain={handlePlayAgain} didWin={finalSig.gatesPassed >= 15}
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
    postWebhook(theme, GAME_ID, { personality, score: sig.gatesPassed, gatesPassed: sig.gatesPassed,
      collisions: sig.collisions, maxStreak: sig.maxStreak, nearMisses: sig.nearMisses }, player);
  }, [theme, sig, personality, player]);
  return null;
}
