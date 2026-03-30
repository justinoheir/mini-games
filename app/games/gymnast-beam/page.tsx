/**
 * ══════════════════════════════════════════════════════════════════
 *  GYMNAST BEAM — Ether Glimmer
 *  Hold device steady while beam wobbles. Tap at the perfect moment.
 *  Sensor: DeviceOrientationEvent for balance detection
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

// ── CONSTANTS ──────────────────────────────────────────────────────
const GAME_ID      = 'gymnast-beam';
const PB_KEY       = 'pb_gymnast-beam';
const ACCENT       = '#f472b6';
const DURATION     = 30;
const GAME_EMOJI   = '🤸';
const GAME_TITLE   = 'Gymnast Beam';
const GAME_TAGLINE = 'Stay balanced. Tap at the perfect moment.';

// Beam balance window: angles within this range = "balanced"
const BALANCE_THRESHOLD = 14; // degrees
const PERFECT_THRESHOLD = 6;  // degrees — inner "perfect" zone

// ── TYPES ───────────────────────────────────────────────────────────
type MoveResult = 'perfect' | 'good' | 'wobbly' | 'fell';

interface Signals {
  score: number;
  perfectMoves: number;
  goodMoves: number;
  wobblyMoves: number;
  falls: number;
  streak: number;
  maxStreak: number;
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  beamAngle: number;     // degrees, positive = right tilt
  beamVelocity: number;  // angular velocity
  tiltInput: number;     // normalized -1..1 from device
  touchInput: number;    // touch fallback -1..1
  lastTapTime: number;
  tapCooldown: boolean;
  particles: Particle[];
  shakeState: ShakeState;
  flashColor: string;
  flashAlpha: number;
  screenGlow: number;    // 0..1 green glow on success
  gymnast: {
    jumpOffset: number;   // Y offset for jump animation
    jumping: boolean;
    jumpVy: number;
    armAngle: number;     // arm spread
    pose: 'stand' | 'jump' | 'fall' | 'celebrate';
    fallAngle: number;
  };
  wobbleIntensity: number; // increases over time
  gameStartTime: number;
  lastMoveResult: MoveResult | null;
  lastMoveTime: number;
  accentColor: string;
}

// ── PERSONALITY ─────────────────────────────────────────────────────
function getPersonality(sig: Signals): string {
  const total = sig.perfectMoves + sig.goodMoves + sig.wobblyMoves;
  if (total === 0) return 'Novice Gymnast 🎀';
  const perfRate = sig.perfectMoves / total;
  if (sig.falls === 0 && perfRate >= 0.7)  return 'Olympic Gold 🥇';
  if (sig.falls <= 1 && perfRate >= 0.5)   return 'Elite Gymnast 🌟';
  if (sig.falls === 0)                     return 'Steady Performer 💪';
  if (sig.perfectMoves >= 6)               return 'Risk Taker ⚡';
  if (sig.falls >= 3)                      return 'Fearless Tumbler 🎭';
  return 'Beam Walker 🤸';
}

// ── COMPONENT ───────────────────────────────────────────────────────
export default function GymnastBeamGame() {
  const theme      = useBrandTheme();
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const animRef    = useRef(0);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const tiltRef    = useRef<ReturnType<typeof createTiltController> | null>(null);
  const endCalledRef = useRef(false);

  const stateRef = useRef<GState>({
    running: false, timeLeft: DURATION,
    sig: { score: 0, perfectMoves: 0, goodMoves: 0, wobblyMoves: 0, falls: 0, streak: 0, maxStreak: 0 },
    beamAngle: 0, beamVelocity: 0,
    tiltInput: 0, touchInput: 0,
    lastTapTime: 0, tapCooldown: false,
    particles: [], shakeState: { intensity: 0, duration: 0 },
    flashColor: '#ef4444', flashAlpha: 0, screenGlow: 0,
    gymnast: { jumpOffset: 0, jumping: false, jumpVy: 0, armAngle: 0, pose: 'stand', fallAngle: 0 },
    wobbleIntensity: 1.0, gameStartTime: 0,
    lastMoveResult: null, lastMoveTime: 0,
    accentColor: ACCENT,
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [moveMsg, setMoveMsgState]      = useState<{ text: string; color: string } | null>(null);
  const [isNewBest, setIsNewBest]       = useState(false);
  const [streak, setStreak]             = useState(0);
  const { pops, triggerPop }            = useScorePop();
  const playerSessionRef                = useRef<PlayerSession | null>(null);
  const moveMsgTimerRef                 = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { stateRef.current.accentColor = theme.colors.accent ?? ACCENT; }, [theme]);

  // ── END GAME ──────────────────────────────────────────────────────
  const endGame = useCallback(() => {
    if (endCalledRef.current) return;
    endCalledRef.current = true;
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    stopMusicRef.current?.(); stopMusicRef.current = null;
    tiltRef.current?.stop();
    sfx.gameOver();
    try {
      const prev = parseInt(localStorage.getItem(PB_KEY) || '0', 10);
      if (s.sig.score > prev) { localStorage.setItem(PB_KEY, String(s.sig.score)); setIsNewBest(true); }
    } catch { /* ignore */ }
    setFinalSig({ ...s.sig });
    setPhase('done');
  }, []);

  // ── PERFORM MOVE (tap handler) ─────────────────────────────────
  const performMove = useCallback(() => {
    const s = stateRef.current;
    if (!s.running || s.tapCooldown) return;
    s.tapCooldown = true;
    setTimeout(() => { s.tapCooldown = false; }, 500);

    const absAngle = Math.abs(s.beamAngle);
    const g = s.gymnast;

    if (absAngle <= PERFECT_THRESHOLD) {
      // Perfect
      s.sig.perfectMoves++;
      s.sig.streak++;
      if (s.sig.streak > s.sig.maxStreak) s.sig.maxStreak = s.sig.streak;
      const pts = 3 + Math.floor(s.sig.streak / 3);
      s.sig.score += pts;
      s.screenGlow = 1.0;
      g.jumping = true; g.jumpVy = -12; g.pose = 'jump'; g.armAngle = 1.2;
      spawnBurst(s.particles, window.innerWidth / 2, window.innerHeight * 0.42, ACCENT, 20, 6);
      sfx.collect(); hapticScore();
      setScoreDisplay(s.sig.score);
      setStreak(s.sig.streak);
      setMoveMsgState({ text: '⭐ Perfect!', color: '#fde68a' });
      triggerPop(`+${pts}`, window.innerWidth / 2, window.innerHeight * 0.35);
      s.lastMoveResult = 'perfect'; s.lastMoveTime = Date.now();
    } else if (absAngle <= BALANCE_THRESHOLD) {
      // Good
      s.sig.goodMoves++;
      s.sig.streak++;
      if (s.sig.streak > s.sig.maxStreak) s.sig.maxStreak = s.sig.streak;
      s.sig.score += 1;
      g.jumping = true; g.jumpVy = -8; g.pose = 'jump'; g.armAngle = 0.6;
      sfx.collect(); haptic([30]);
      setScoreDisplay(s.sig.score);
      setStreak(s.sig.streak);
      setMoveMsgState({ text: '✓ Good!', color: '#86efac' });
      s.lastMoveResult = 'good'; s.lastMoveTime = Date.now();
    } else {
      // Too wobbly — fell!
      s.sig.wobblyMoves++;
      s.sig.streak = 0; setStreak(0);
      s.sig.falls++;
      g.pose = 'fall'; g.falling = true as any; g.fallAngle = absAngle > 0 ? 60 : -60;
      triggerShake(s.shakeState, 8, 12);
      s.flashColor = '#ef4444'; s.flashAlpha = 0.5;
      sfx.collision(); hapticFail();
      setMoveMsgState({ text: '💥 Too wobbly!', color: '#fca5a5' });
      s.lastMoveResult = 'fell'; s.lastMoveTime = Date.now();
      // Reset after fall animation
      setTimeout(() => { s.gymnast.pose = 'stand'; s.gymnast.fallAngle = 0; }, 800);
    }

    if (moveMsgTimerRef.current) clearTimeout(moveMsgTimerRef.current);
    moveMsgTimerRef.current = setTimeout(() => setMoveMsgState(null), 1200);
  }, [triggerPop]);

  // ── GAME LOOP ────────────────────────────────────────────────────
  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const s = stateRef.current;

    endCalledRef.current = false;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, perfectMoves: 0, goodMoves: 0, wobblyMoves: 0, falls: 0, streak: 0, maxStreak: 0 };
    s.beamAngle = 0; s.beamVelocity = 2; // small initial velocity
    s.tiltInput = 0; s.touchInput = 0;
    s.particles = []; s.shakeState = { intensity: 0, duration: 0 };
    s.flashAlpha = 0; s.screenGlow = 0; s.wobbleIntensity = 1.0;
    s.gymnast = { jumpOffset: 0, jumping: false, jumpVy: 0, armAngle: 0, pose: 'stand', fallAngle: 0 };
    s.tapCooldown = false; s.gameStartTime = Date.now();
    setScoreDisplay(0); setTimeLeft(DURATION); setStreak(0);

    stopMusicRef.current = startMusic('tense');

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

      // Wobble intensity increases over time
      s.wobbleIntensity = 1.0 + elapsed * 0.08;

      // Beam physics: pendulum with tilt input
      const tilt = (s.tiltInput + s.touchInput) * 0.8;
      const gravity = 0.18 * s.wobbleIntensity;
      s.beamVelocity += gravity * Math.sin((s.beamAngle * Math.PI) / 180) + tilt * 1.2;
      s.beamVelocity *= 0.92; // damping
      s.beamAngle += s.beamVelocity;
      // Clamp beam angle
      s.beamAngle = Math.max(-55, Math.min(55, s.beamAngle));

      // Gymnast jump physics
      const g = s.gymnast;
      if (g.jumping) {
        g.jumpOffset += g.jumpVy;
        g.jumpVy += 1.2;
        if (g.jumpOffset >= 0) { g.jumpOffset = 0; g.jumping = false; g.jumpVy = 0; g.pose = 'stand'; g.armAngle = 0; }
      }

      // Background
      ctx.save();
      applyShake(ctx, s.shakeState);

      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#1a0030');
      bg.addColorStop(1, '#0d0018');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Arena spotlights
      ctx.save();
      const spot1 = ctx.createRadialGradient(W * 0.3, H * 0.2, 0, W * 0.3, H * 0.6, W * 0.5);
      spot1.addColorStop(0, 'rgba(244,114,182,0.08)');
      spot1.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = spot1; ctx.fillRect(0, 0, W, H);
      const spot2 = ctx.createRadialGradient(W * 0.7, H * 0.15, 0, W * 0.7, H * 0.55, W * 0.45);
      spot2.addColorStop(0, 'rgba(167,139,250,0.07)');
      spot2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = spot2; ctx.fillRect(0, 0, W, H);
      ctx.restore();

      // Screen glow on success
      if (s.screenGlow > 0) {
        ctx.fillStyle = `rgba(244,114,182,${s.screenGlow * 0.12})`;
        ctx.fillRect(0, 0, W, H);
        s.screenGlow = Math.max(0, s.screenGlow - 0.04);
      }

      // Flash
      if (s.flashAlpha > 0) {
        ctx.fillStyle = `rgba(239,68,68,${s.flashAlpha * 0.4})`;
        ctx.fillRect(0, 0, W, H);
        s.flashAlpha = Math.max(0, s.flashAlpha - 0.06);
      }

      // Balance zone indicator (arc at bottom of screen)
      const indCx = W / 2, indCy = H - 80, indR = 60;
      ctx.save();
      // Red zone (outer)
      ctx.strokeStyle = 'rgba(239,68,68,0.5)';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(indCx, indCy, indR, Math.PI, 2 * Math.PI);
      ctx.stroke();
      // Yellow zone
      const balFrac = BALANCE_THRESHOLD / 55;
      const balAng = Math.PI + balFrac * Math.PI;
      ctx.strokeStyle = 'rgba(250,204,21,0.7)';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(indCx, indCy, indR, Math.PI + (1 - balFrac) * Math.PI / 2, 2 * Math.PI - (1 - balFrac) * Math.PI / 2);
      ctx.stroke();
      // Green zone (center)
      const perfFrac = PERFECT_THRESHOLD / 55;
      ctx.strokeStyle = 'rgba(74,222,128,0.9)';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(indCx, indCy, indR, Math.PI + (1 - perfFrac) * Math.PI / 2, 2 * Math.PI - (1 - perfFrac) * Math.PI / 2);
      ctx.stroke();
      // Needle (current beam angle)
      const needleAng = Math.PI + ((s.beamAngle + 55) / 110) * Math.PI;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.shadowBlur = 8; ctx.shadowColor = '#fff';
      ctx.beginPath();
      ctx.moveTo(indCx, indCy);
      ctx.lineTo(indCx + Math.cos(needleAng) * indR, indCy + Math.sin(needleAng) * indR);
      ctx.stroke();
      ctx.restore();

      // Beam (rotated)
      const beamCx = W / 2, beamCy = H * 0.45;
      const beamHalfW = Math.min(W * 0.38, 140);
      const beamRad = (s.beamAngle * Math.PI) / 180;

      ctx.save();
      ctx.translate(beamCx, beamCy);
      ctx.rotate(beamRad);
      // Beam support legs
      ctx.strokeStyle = '#7c3aed';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(-beamHalfW, 0); ctx.lineTo(-beamHalfW, 45); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(beamHalfW, 0); ctx.lineTo(beamHalfW, 45); ctx.stroke();
      // Beam body
      const beamGrad = ctx.createLinearGradient(-beamHalfW, -8, beamHalfW, 8);
      beamGrad.addColorStop(0, '#7c3aed');
      beamGrad.addColorStop(0.5, '#a855f7');
      beamGrad.addColorStop(1, '#7c3aed');
      ctx.fillStyle = beamGrad;
      ctx.shadowBlur = 15; ctx.shadowColor = s.accentColor;
      ctx.fillRect(-beamHalfW, -8, beamHalfW * 2, 16);
      ctx.restore();

      // Gymnast
      ctx.save();
      const gx = beamCx + Math.sin(beamRad) * 0; // gymnast stays centered on beam
      const beamSurfaceY = beamCy + Math.sin(beamRad) * 0 - 8; // top of beam
      const gy = beamSurfaceY + g.jumpOffset;

      ctx.translate(gx, gy);
      if (g.pose === 'fall') {
        ctx.rotate((g.fallAngle * Math.PI) / 180);
      }

      ctx.shadowBlur = 20; ctx.shadowColor = s.accentColor;

      // Body
      ctx.fillStyle = s.accentColor;
      // Head
      ctx.beginPath(); ctx.arc(0, -42, 10, 0, Math.PI * 2); ctx.fill();
      // Torso
      ctx.fillRect(-5, -32, 10, 28);
      // Arms (spread based on arm angle)
      const armSpread = g.pose === 'jump' ? Math.PI / 2 * g.armAngle : Math.PI / 6;
      ctx.lineWidth = 4; ctx.strokeStyle = s.accentColor;
      ctx.shadowBlur = 10;
      // Left arm
      ctx.beginPath();
      ctx.moveTo(-5, -24);
      ctx.lineTo(-5 - Math.cos(armSpread) * 24, -24 - Math.sin(armSpread) * 12);
      ctx.stroke();
      // Right arm
      ctx.beginPath();
      ctx.moveTo(5, -24);
      ctx.lineTo(5 + Math.cos(armSpread) * 24, -24 - Math.sin(armSpread) * 12);
      ctx.stroke();
      // Legs
      if (g.pose === 'jump' && g.jumpOffset < -5) {
        // Tucked jump
        ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(-14, 14); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(4, -4);  ctx.lineTo(14, 14);  ctx.stroke();
      } else {
        // Standing
        ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(-7, 22); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(4, -4);  ctx.lineTo(7, 22);  ctx.stroke();
      }
      ctx.restore();

      // Particles
      if (s.particles.length > 0) updateAndDrawParticles(ctx, s.particles);

      ctx.restore(); // shake

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

  // ── INPUT SETUP ─────────────────────────────────────────────────
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

    // Tap to perform move
    const onTap = (e: PointerEvent) => {
      if (stateRef.current.running) {
        performMove();
        e.preventDefault();
      }
    };
    canvas.addEventListener('pointerdown', onTap);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onTap);
    };
  }, [performMove]);

  useEffect(() => () => {
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    stopMusicRef.current?.();
    tiltRef.current?.stop();
    if (moveMsgTimerRef.current) clearTimeout(moveMsgTimerRef.current);
  }, []);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    initAudio();
    const ctrl = createTiltController(
      (x, y) => {
        stateRef.current.tiltInput = x * 0.7 + y * 0.3;
      },
      { sensitivity: 1.0, smoothing: 0.4, deadzone: 1.5, clamp: 25 },
    );
    const granted = await ctrl.start();
    if (granted) tiltRef.current = ctrl;
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
    const ctrl = createTiltController(
      (x, y) => { stateRef.current.tiltInput = x * 0.7 + y * 0.3; },
      { sensitivity: 1.0, smoothing: 0.4, deadzone: 1.5, clamp: 25 },
    );
    const granted = await ctrl.start();
    if (granted) tiltRef.current = ctrl;
    setPhase('countdown');
  }, []);

  const buildInsights = (sig: Signals) => [
    { label: 'Perfect Moves', value: `${sig.perfectMoves}`, color: '#fde68a' },
    { label: 'Good Moves',    value: `${sig.goodMoves}`,    color: '#86efac' },
    { label: 'Falls',         value: `${sig.falls}`,        color: sig.falls === 0 ? '#4ade80' : '#ef4444' },
    { label: 'Best Streak',   value: `${sig.maxStreak}x`,   color: theme.colors.accent ?? ACCENT },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg, #1a0030 0%, #0d0018 100%)">

      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Take the Beam →"
          sensorNote="Tilt gently to steady the beam. Tap when the needle is in the green zone."
          accentColor={theme.colors.accent ?? ACCENT}
          ctaTextColor="#000"
          onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #2d0050 0%, #160028 60%, #080010 100%)"
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
              { label: 'TIME',  value: timeLeft,      danger: timeLeft <= 5, testId: 'timer' },
              { label: 'SCORE', value: scoreDisplay,  testId: 'score' },
            ]} />
          )}
        </>
      )}

      {/* Move result message */}
      <AnimatePresence>
        {moveMsg && phase === 'playing' && (
          <motion.div key="move-msg"
            initial={{ opacity: 0, scale: 0.7, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, y: -30, scale: 0.8 }}
            transition={{ duration: 0.25 }}
            style={{
              position: 'fixed', top: '22%', left: '50%', transform: 'translateX(-50%)',
              zIndex: 80, pointerEvents: 'none', fontSize: 26, fontWeight: 900,
              color: moveMsg.color, textShadow: `0 0 14px ${moveMsg.color}88`, whiteSpace: 'nowrap',
            }}
          >
            {moveMsg.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* TAP instruction */}
      {phase === 'playing' && (
        <div style={{
          position: 'fixed', bottom: '14%', left: '50%', transform: 'translateX(-50%)',
          zIndex: 50, pointerEvents: 'none', fontSize: 14, color: 'rgba(255,255,255,0.45)',
          letterSpacing: 2, textTransform: 'uppercase',
        }}>
          Tap when green ↑
        </div>
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
          score={String(finalSig.score)} personality={getPersonality(finalSig)}
          insights={buildInsights(finalSig)} accentColor={theme.colors.accent ?? ACCENT}
          onPlayAgain={handlePlayAgain} didWin={finalSig.score >= 10}
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
      personality, score: sig.score,
      perfectMoves: sig.perfectMoves, falls: sig.falls, maxStreak: sig.maxStreak,
    }, player);
  }, [theme, sig, personality, player]);
  return null;
}
