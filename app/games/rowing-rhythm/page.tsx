/**
 * ══════════════════════════════════════════════════════════════════
 *  ROWING RHYTHM — Ether Glimmer
 *  Swipe LEFT then RIGHT alternating to row. Keep the rhythm.
 *  Mechanic: alternating swipe gestures with rhythm scoring
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
import StreakBadge from '@/components/StreakBadge';

// ── CONSTANTS ──────────────────────────────────────────────────────
const GAME_ID      = 'rowing-rhythm';
const PB_KEY       = 'pb_rowing-rhythm';
const ACCENT       = '#0ea5e9';
const DURATION     = 30;
const GAME_EMOJI   = '🚣';
const GAME_TITLE   = 'Rowing Rhythm';
const GAME_TAGLINE = 'Alternate L + R strokes. Find the rhythm.';

// Rhythm detection: ideal stroke interval
const IDEAL_INTERVAL_MS = 700; // ideal ms between strokes for perfect rhythm
const RHYTHM_TOLERANCE  = 250; // ±ms for "good" rhythm

// ── TYPES ───────────────────────────────────────────────────────────
type StrokeSide = 'left' | 'right' | 'none';
type StrokeQuality = 'perfect' | 'good' | 'miss';

interface WakeParticle {
  x: number; y: number; r: number; alpha: number; vx: number; vy: number;
}

interface OarAnim {
  side: StrokeSide;
  phase: number; // 0..1 animation progress
  quality: StrokeQuality;
}

interface Signals {
  score: number;
  strokes: number;
  perfectStrokes: number;
  goodStrokes: number;
  missedStrokes: number;
  maxStreak: number;
  streak: number;
  distanceM: number;   // meters rowed (visual)
}

type Phase = 'start' | 'countdown' | 'playing' | 'done';

interface GState {
  running: boolean;
  timeLeft: number;
  sig: Signals;
  lastSide: StrokeSide;
  lastStrokeTime: number;
  strokeIntervals: number[];   // ring buffer of recent intervals
  boatSpeed: number;           // pixels/frame (visual)
  boatSpeedTarget: number;
  waterOffset: number;         // scrolling water texture
  wakeParticles: WakeParticle[];
  oarAnims: OarAnim[];
  strokeFlash: { color: string; alpha: number };
  particles: Particle[];
  gameStartTime: number;
  accentColor: string;
  pointerStart: { x: number; y: number; time: number } | null;
  beatPhase: number; // 0..1 visual beat indicator
  beatInterval: number;
}

// ── PERSONALITY ─────────────────────────────────────────────────────
function getPersonality(sig: Signals): string {
  const total = sig.strokes;
  if (total === 0) return 'Dock Sitter 🛥️';
  const perfRate = total > 0 ? sig.perfectStrokes / total : 0;
  if (perfRate >= 0.7 && sig.maxStreak >= 8)   return 'Olympic Rower 🥇';
  if (perfRate >= 0.5)                          return 'Rhythm Machine 🎵';
  if (sig.strokes >= 30)                        return 'Power Stroke 💪';
  if (sig.maxStreak >= 10)                      return 'In the Zone 🌊';
  if (sig.goodStrokes + sig.perfectStrokes > sig.missedStrokes) return 'Steady Oars ⚓';
  return 'Learning the Catch 🚣';
}

// ── COMPONENT ───────────────────────────────────────────────────────
export default function RowingRhythmGame() {
  const theme      = useBrandTheme();
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const animRef    = useRef(0);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const endCalledRef = useRef(false);

  const stateRef = useRef<GState>({
    running: false, timeLeft: DURATION,
    sig: { score: 0, strokes: 0, perfectStrokes: 0, goodStrokes: 0, missedStrokes: 0, maxStreak: 0, streak: 0, distanceM: 0 },
    lastSide: 'none', lastStrokeTime: 0, strokeIntervals: [],
    boatSpeed: 0, boatSpeedTarget: 1,
    waterOffset: 0, wakeParticles: [],
    oarAnims: [], strokeFlash: { color: '#38bdf8', alpha: 0 },
    particles: [], gameStartTime: 0, accentColor: ACCENT,
    pointerStart: null, beatPhase: 0, beatInterval: IDEAL_INTERVAL_MS,
  });

  const [phase, setPhase]               = useState<Phase>('start');
  const [timeLeft, setTimeLeft]         = useState(DURATION);
  const [scoreDisplay, setScoreDisplay] = useState(0);
  const [finalSig, setFinalSig]         = useState<Signals | null>(null);
  const [strokeMsg, setStrokeMsg]       = useState<{ text: string; color: string } | null>(null);
  const [sidePrompt, setSidePrompt]     = useState<StrokeSide>('left');
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

  // ── STROKE HANDLER ────────────────────────────────────────────────
  const handleStroke = useCallback((side: 'left' | 'right') => {
    const s = stateRef.current;
    if (!s.running) return;

    const now = Date.now();
    const expectedSide = s.lastSide === 'left' ? 'right' : 'left';

    // Wrong side = miss
    if (s.lastSide !== 'none' && side !== expectedSide) {
      s.sig.missedStrokes++;
      s.sig.streak = 0; setStreak(0);
      s.boatSpeedTarget = Math.max(0.5, s.boatSpeedTarget - 0.3);
      sfx.nearMiss(); hapticFail();
      setStrokeMsg({ text: '❌ Wrong side!', color: '#fca5a5' });
      if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
      msgTimerRef.current = setTimeout(() => setStrokeMsg(null), 900);
      return;
    }

    // Rhythm check
    let quality: StrokeQuality = 'good';
    let points = 1;
    if (s.lastStrokeTime > 0) {
      const interval = now - s.lastStrokeTime;
      s.strokeIntervals.push(interval);
      if (s.strokeIntervals.length > 8) s.strokeIntervals.shift();
      const avgInterval = s.strokeIntervals.reduce((a, b) => a + b, 0) / s.strokeIntervals.length;
      s.beatInterval = avgInterval;
      const diff = Math.abs(interval - IDEAL_INTERVAL_MS);
      if (diff <= 100) {
        quality = 'perfect';
        points = 3;
        s.sig.perfectStrokes++;
      } else if (diff <= RHYTHM_TOLERANCE) {
        quality = 'good';
        points = 2;
        s.sig.goodStrokes++;
      } else {
        quality = 'good'; // still counts
        points = 1;
        s.sig.goodStrokes++;
      }
    } else {
      s.sig.goodStrokes++;
    }

    s.sig.strokes++;
    s.sig.streak++;
    if (s.sig.streak > s.sig.maxStreak) s.sig.maxStreak = s.sig.streak;
    const bonusMult = 1 + Math.floor(s.sig.streak / 5) * 0.5;
    const finalPts = Math.round(points * bonusMult);
    s.sig.score += finalPts;
    s.sig.distanceM += quality === 'perfect' ? 18 : quality === 'good' ? 12 : 6;
    s.lastSide = side;
    s.lastStrokeTime = now;

    // Boat speed boost
    s.boatSpeedTarget = Math.min(8, s.boatSpeedTarget + (quality === 'perfect' ? 1.2 : 0.7));

    // Oar animation
    s.oarAnims.push({ side, phase: 0, quality });
    if (s.oarAnims.length > 3) s.oarAnims.shift();

    // Stroke flash
    s.strokeFlash.color = quality === 'perfect' ? '#34d399' : '#38bdf8';
    s.strokeFlash.alpha = quality === 'perfect' ? 0.6 : 0.35;

    // Wake particles
    const W = window.innerWidth, H = window.innerHeight;
    const boatX = W / 2, boatY = H * 0.52;
    for (let i = 0; i < 8; i++) {
      const angle = Math.PI + (Math.random() - 0.5) * Math.PI * 0.6;
      const spd = 1.5 + Math.random() * 2.5;
      s.wakeParticles.push({
        x: boatX + (side === 'left' ? -30 : 30) + (Math.random() - 0.5) * 20,
        y: boatY + 20 + Math.random() * 10,
        r: 2 + Math.random() * 4,
        alpha: 0.6,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
      });
    }

    hapticScore();
    if (quality === 'perfect') {
      sfx.collect();
      setStrokeMsg({ text: '🌊 Perfect Catch!', color: '#34d399' });
    } else {
      sfx.collect();
      setStrokeMsg({ text: side === 'left' ? '← Pull!' : 'Pull! →', color: '#7dd3fc' });
    }

    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    msgTimerRef.current = setTimeout(() => setStrokeMsg(null), 700);

    setScoreDisplay(s.sig.score);
    setStreak(s.sig.streak);
    setSidePrompt(side === 'left' ? 'right' : 'left');
  }, []);

  // ── GAME LOOP ────────────────────────────────────────────────────
  const startLoop = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const s = stateRef.current;

    endCalledRef.current = false;
    s.running = true; s.timeLeft = DURATION;
    s.sig = { score: 0, strokes: 0, perfectStrokes: 0, goodStrokes: 0, missedStrokes: 0, maxStreak: 0, streak: 0, distanceM: 0 };
    s.lastSide = 'none'; s.lastStrokeTime = 0; s.strokeIntervals = [];
    s.boatSpeed = 0; s.boatSpeedTarget = 1;
    s.waterOffset = 0; s.wakeParticles = []; s.oarAnims = [];
    s.strokeFlash = { color: '#38bdf8', alpha: 0 };
    s.particles = []; s.gameStartTime = Date.now(); s.beatPhase = 0;
    setScoreDisplay(0); setTimeLeft(DURATION); setStreak(0); setSidePrompt('left');

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
      const now = Date.now();

      // Update beat phase
      s.beatPhase = (now % s.beatInterval) / s.beatInterval;

      // Smooth boat speed
      s.boatSpeed += (s.boatSpeedTarget - s.boatSpeed) * 0.08;
      s.boatSpeedTarget = Math.max(0.5, s.boatSpeedTarget - 0.012);
      s.waterOffset = (s.waterOffset + s.boatSpeed) % 80;

      // Background — river/water
      ctx.fillStyle = '#0c4a6e';
      ctx.fillRect(0, 0, W, H);

      // Water gradient
      const waterGrad = ctx.createLinearGradient(0, 0, 0, H);
      waterGrad.addColorStop(0, '#0369a1');
      waterGrad.addColorStop(0.5, '#0c4a6e');
      waterGrad.addColorStop(1, '#082f49');
      ctx.fillStyle = waterGrad;
      ctx.fillRect(0, 0, W, H);

      // River banks (sides)
      ctx.fillStyle = '#15803d';
      ctx.fillRect(0, 0, W * 0.12, H);
      ctx.fillRect(W * 0.88, 0, W * 0.12, H);
      // Bank edges
      ctx.fillStyle = '#166534';
      ctx.fillRect(W * 0.12, 0, 4, H);
      ctx.fillRect(W * 0.88 - 4, 0, 4, H);

      // Scrolling water ripples
      ctx.save();
      ctx.globalAlpha = 0.15;
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 1;
      for (let ri = 0; ri < 12; ri++) {
        const ry = ((ri * 75 + s.waterOffset * 2) % (H + 80)) - 80;
        ctx.beginPath();
        ctx.moveTo(W * 0.14, ry);
        ctx.bezierCurveTo(W * 0.3, ry - 8, W * 0.7, ry + 8, W * 0.86, ry);
        ctx.stroke();
      }
      ctx.restore();

      // Lane markers
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 2;
      ctx.setLineDash([20, 15]);
      ctx.beginPath();
      ctx.moveTo(W / 2, 0);
      ctx.lineTo(W / 2, H);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Distance markers scrolling
      for (let dm = 0; dm < 5; dm++) {
        const dmY = ((dm * 180 + s.waterOffset * 4) % (H + 40)) - 40;
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(s.sig.distanceM + (5 - dm) * 20)}m`, W * 0.08, dmY);
        ctx.fillText(`${Math.round(s.sig.distanceM + (5 - dm) * 20)}m`, W * 0.92, dmY);
        ctx.restore();
      }

      // Wake particles
      for (let wi = s.wakeParticles.length - 1; wi >= 0; wi--) {
        const wp = s.wakeParticles[wi];
        wp.x += wp.vx; wp.y += wp.vy + s.boatSpeed * 0.3;
        wp.alpha -= 0.025; wp.r *= 0.97;
        if (wp.alpha <= 0 || wp.r < 0.5) { s.wakeParticles.splice(wi, 1); continue; }
        ctx.beginPath();
        ctx.arc(wp.x, wp.y, wp.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(125,211,252,${wp.alpha})`;
        ctx.fill();
      }

      // Boat
      const boatX = W / 2, boatY = H * 0.52;
      const t = now / 1000;
      const bobY = Math.sin(t * 2.5 + s.boatSpeed * 0.3) * 2.5;

      ctx.save();
      ctx.translate(boatX, boatY + bobY);

      // Boat hull
      const boatW = 55, boatH = 18;
      ctx.shadowBlur = 18; ctx.shadowColor = s.accentColor;
      ctx.fillStyle = '#1e3a5f';
      ctx.beginPath();
      ctx.moveTo(-boatW, -boatH / 2);
      ctx.lineTo(boatW * 0.7, -boatH / 2);
      ctx.lineTo(boatW, 0);
      ctx.lineTo(boatW * 0.7, boatH / 2);
      ctx.lineTo(-boatW, boatH / 2);
      ctx.lineTo(-boatW * 1.1, 0);
      ctx.closePath();
      ctx.fill();
      // Boat stripe
      ctx.strokeStyle = s.accentColor;
      ctx.lineWidth = 2;
      ctx.stroke();
      // Rower silhouette
      ctx.fillStyle = s.accentColor;
      ctx.fillRect(-6, -boatH * 1.8, 12, boatH);
      ctx.beginPath(); ctx.arc(0, -boatH * 2.2, 7, 0, Math.PI * 2); ctx.fill();

      // Oars
      for (const oar of s.oarAnims) {
        oar.phase = Math.min(1, oar.phase + 0.06);
        const oarPhase = Math.sin(oar.phase * Math.PI);
        const oarLen = 70;
        const oarAngle = oar.side === 'left' ?
          (Math.PI * 0.65 + oarPhase * 0.35) :
          (-Math.PI * 0.65 - oarPhase * 0.35);
        ctx.save();
        ctx.strokeStyle = oar.quality === 'perfect' ? '#34d399' : '#94a3b8';
        ctx.lineWidth = 4;
        ctx.shadowBlur = oar.quality === 'perfect' ? 12 : 0;
        ctx.shadowColor = '#34d399';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(oarAngle) * oarLen, Math.sin(oarAngle) * oarLen);
        ctx.stroke();
        // Oar blade
        ctx.fillStyle = oar.quality === 'perfect' ? '#34d399' : '#64748b';
        ctx.beginPath();
        ctx.arc(Math.cos(oarAngle) * oarLen, Math.sin(oarAngle) * oarLen, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.restore(); // boat

      // Beat indicator (visual rhythm pulse)
      const beatAlpha = Math.pow(1 - s.beatPhase, 2) * 0.4;
      ctx.save();
      ctx.strokeStyle = `rgba(56,189,248,${beatAlpha})`;
      ctx.lineWidth = 2;
      const beatR = 30 + s.beatPhase * 20;
      ctx.beginPath(); ctx.arc(boatX, boatY, beatR, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();

      // Stroke flash
      if (s.strokeFlash.alpha > 0) {
        ctx.fillStyle = `${s.strokeFlash.color}${Math.round(s.strokeFlash.alpha * 30).toString(16).padStart(2, '0')}`;
        ctx.fillRect(0, 0, W, H);
        s.strokeFlash.alpha = Math.max(0, s.strokeFlash.alpha - 0.06);
      }

      // Speed indicator
      const speedBarW = Math.min(W * 0.6, 200);
      const speedBarH = 8;
      const speedBarX = (W - speedBarW) / 2;
      const speedBarY = H - 150;
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(speedBarX, speedBarY, speedBarW, speedBarH);
      ctx.fillStyle = s.accentColor;
      ctx.fillRect(speedBarX, speedBarY, speedBarW * (s.boatSpeed / 8), speedBarH);

      // Left/Right swipe zones
      const zoneH = H * 0.35, zoneW = W * 0.38;
      const zyT = H * 0.55;
      const activeLeft = s.lastSide !== 'left';
      const activeRight = s.lastSide !== 'right';

      ctx.save();
      ctx.globalAlpha = activeLeft ? 0.3 : 0.1;
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(0, zyT, zoneW, zoneH);
      ctx.globalAlpha = activeRight ? 0.3 : 0.1;
      ctx.fillRect(W - zoneW, zyT, zoneW, zoneH);
      ctx.globalAlpha = 1;

      // Arrow hints in zones
      ctx.font = 'bold 36px sans-serif';
      ctx.textAlign = 'center';
      ctx.globalAlpha = activeLeft ? 0.9 : 0.3;
      ctx.fillStyle = '#fff';
      ctx.fillText('←', zoneW / 2, zyT + zoneH / 2 + 12);
      ctx.globalAlpha = activeRight ? 0.9 : 0.3;
      ctx.fillText('→', W - zoneW / 2, zyT + zoneH / 2 + 12);
      ctx.restore();

      if (s.particles.length > 0) updateAndDrawParticles(ctx, s.particles);

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
  }, [endGame]);

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

    // Swipe detection
    const onPointerDown = (e: PointerEvent) => {
      stateRef.current.pointerStart = { x: e.clientX, y: e.clientY, time: Date.now() };
    };
    const onPointerUp = (e: PointerEvent) => {
      const s = stateRef.current;
      if (!s.pointerStart || !s.running) { s.pointerStart = null; return; }
      const dx = e.clientX - s.pointerStart.x;
      const dy = e.clientY - s.pointerStart.y;
      const dt = Date.now() - s.pointerStart.time;
      s.pointerStart = null;

      // Require horizontal swipe > 30px, ratio > 1.5, within 600ms
      if (Math.abs(dx) > 30 && Math.abs(dx) / Math.max(1, Math.abs(dy)) > 1.5 && dt < 600) {
        handleStroke(dx < 0 ? 'left' : 'right');
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [handleStroke]);

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
    { label: 'Distance',      value: `${sig.distanceM}m`,        color: '#38bdf8' },
    { label: 'Perfect Strokes', value: `${sig.perfectStrokes}`, color: '#34d399' },
    { label: 'Total Strokes', value: `${sig.strokes}`,           color: theme.colors.accent ?? ACCENT },
    { label: 'Best Streak',   value: `${sig.maxStreak}x`,        color: '#fde68a' },
  ];

  return (
    <GameShell title={GAME_TITLE} emoji={GAME_EMOJI} accentColor={theme.colors.accent ?? ACCENT}
      background="linear-gradient(180deg, #0c4a6e 0%, #082f49 100%)">

      {phase === 'start' && (
        <GameStartScreen
          emoji={GAME_EMOJI} title={GAME_TITLE} description={GAME_TAGLINE}
          ctaLabel="Row! →"
          sensorNote="Swipe LEFT then RIGHT alternating to row. Keep the rhythm for bonus points."
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
              { label: 'SCORE',  value: scoreDisplay,  testId: 'score' },
            ]} />
          )}
        </>
      )}

      {/* Stroke message */}
      <AnimatePresence>
        {strokeMsg && phase === 'playing' && (
          <motion.div key="smsg"
            initial={{ opacity: 0, y: 10, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            transition={{ duration: 0.2 }}
            style={{
              position: 'fixed', top: '30%', left: '50%', transform: 'translateX(-50%)',
              zIndex: 80, pointerEvents: 'none', fontSize: 24, fontWeight: 900,
              color: strokeMsg.color, textShadow: `0 0 14px ${strokeMsg.color}88`, whiteSpace: 'nowrap',
            }}>
            {strokeMsg.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Side prompt */}
      {phase === 'playing' && (
        <div style={{
          position: 'fixed', top: '13%', left: '50%', transform: 'translateX(-50%)',
          zIndex: 50, pointerEvents: 'none', fontSize: 13, color: 'rgba(255,255,255,0.5)',
          letterSpacing: 2, textTransform: 'uppercase',
        }}>
          {sidePrompt === 'left' ? '← Swipe Left' : 'Swipe Right →'}
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
          onPlayAgain={handlePlayAgain} didWin={finalSig.strokes >= 15}
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
      personality, score: sig.score, strokes: sig.strokes,
      distanceM: sig.distanceM, perfectStrokes: sig.perfectStrokes, maxStreak: sig.maxStreak,
    }, player);
  }, [theme, sig, personality, player]);
  return null;
}

