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
import { createTiltController } from '@/lib/tilt';
import { savePlayerSession, PlayerSession } from '@/lib/playerSession';
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
  _loadSprite('/sprites/penalty-kick/ball.svg');
}

const ACCENT = '#22c55e';
const GAME_ID = 'penalty-kick';
const PB_KEY       = 'pb_penalty-kick';
const MAX_SHOTS = 10;

interface FloatText { x: number; y: number; text: string; color: string; alpha: number; vy: number; }
interface Signals {
  shots: number; goals: number; cornerShots: number;
  powerSum: number; curveShots: number; postSaveGoals: number;
  lastSavedResult: boolean; adaptCount: number;
}
type Phase = 'start' | 'countdown' | 'playing' | 'done';

function getPersonality(sig: Signals): string {
  const total = sig.shots || 1;
  const cornerRate = sig.cornerShots / total;
  const powerAvg = sig.powerSum / total;
  const curveRate = sig.curveShots / total;
  if (cornerRate > 0.6 && powerAvg >= 50 && powerAvg <= 80) return '🎯 Composed Finisher';
  if (powerAvg > 80) return '💥 Power Shooter';
  if (curveRate > 0.4) return '🌀 Trickster';
  return '⚽ Striker';
}

export default function PenaltyKick() {
  const theme = useBrandTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stopMusicRef = useRef<(() => void) | null>(null);
  const animRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tiltRef = useRef<ReturnType<typeof createTiltController> | null>(null);
  const [phase, setPhase] = useState<Phase>('start');
  const [showInstructions, setShowInstructions] = useState(true);
  const [shotsState, setShotsState] = useState(0);
  const [goalsDisplay, setGoalsDisplay] = useState(0);
  const [finalSig, setFinalSig] = useState<Signals | null>(null);
  const [playerName, setPlayerName]   = useState('');
  const [playerAvatar, setPlayerAvatar] = useState('🎮');
  const { pops, triggerPop } = useScorePop();
  const [streak, setStreak] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const prevScoreRef = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const numScore = typeof goalsDisplay === 'number' ? goalsDisplay : 0;
    if (numScore > prevScoreRef.current) {
      triggerPop(`+${numScore - prevScoreRef.current}`, window.innerWidth / 2, 200);
      hapticScore();
      playScoreHit('default', numScore - prevScoreRef.current);
      setStreak(Math.floor(numScore / 5));
    }
    prevScoreRef.current = numScore;
  }, [goalsDisplay]); // triggerPop is stable
  const playerSessionRef              = useRef<PlayerSession | null>(null);

  const stateRef = useRef({
    running: false,
    shots: 0,
    goals: 0,
    // Ball
    ballX: 0, ballY: 0, ballVX: 0, ballVY: 0, ballInFlight: false,
    ballRadius: 16,
    // Keeper
    keeperX: 0, keeperY: 0, keeperW: 44, keeperH: 70,
    keeperVX: 0, keeperDiving: false, keeperDiveDir: 0,
    // Goal dimensions
    goalX: 0, goalY: 0, goalW: 0, goalH: 0,
    // Aim reticle
    aimX: 0, aimY: 0, dragging: false, dragStartX: 0, dragStartY: 0, dragStartTime: 0,
    power: 0, charging: false,
    // Curve from tilt
    curveX: 0,
    // Float texts
    floats: [] as FloatText[],
    // Signals
    sig: {
      shots:0, goals:0, cornerShots:0, powerSum:0, curveShots:0,
      postSaveGoals:0, lastSavedResult:false, adaptCount:0
    } as Signals,
    // Result
    resultText: '', resultColor: '', resultTimer: 0,
    phase: 'ready' as 'ready' | 'flying' | 'result',
    keeperFlash: '',
    particles: [] as Particle[],
    shake: { intensity: 0, duration: 0 } as ShakeState,
  });

  const endGame = useCallback(() => {
    const s = stateRef.current;
    s.running = false;
    cancelAnimationFrame(animRef.current);
    if (timerRef.current) clearTimeout(timerRef.current);
    tiltRef.current?.stop();
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    const finalSigSnap = { ...s.sig };
    setFinalSig(finalSigSnap);
    setPhase('done');
    postWebhook(theme, GAME_ID, {
      score: `${finalSigSnap.goals}/${MAX_SHOTS}`,
      personality: getPersonality(finalSigSnap),
      signals: { goals: finalSigSnap.goals, shots: finalSigSnap.shots, cornerShots: finalSigSnap.cornerShots },
    }, playerSessionRef.current);
  }, [theme]);

  const resetRound = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;
    s.ballX = W / 2; s.ballY = H * 0.75;
    s.ballVX = 0; s.ballVY = 0; s.ballInFlight = false;
    s.keeperX = W / 2; s.keeperDiving = false; s.keeperVX = 0;
    s.aimX = W / 2; s.aimY = H * 0.35;
    s.dragging = false; s.charging = false; s.power = 0;
    s.phase = 'ready';
    s.curveX = 0;
    s.resultText = ''; s.resultTimer = 0;
  }, []);

  const startLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;
    const W = window.innerWidth, H = window.innerHeight;

    s.running = true;
    s.shots = 0; s.goals = 0;
    s.sig = { shots:0, goals:0, cornerShots:0, powerSum:0, curveShots:0, postSaveGoals:0, lastSavedResult:false, adaptCount:0 };
    s.floats = [];
    s.particles = []; s.shake = { intensity: 0, duration: 0 };
    setGoalsDisplay(0);
    setShotsState(0);

    // Goal at top
    s.goalW = W * 0.6; s.goalH = H * 0.18;
    s.goalX = (W - s.goalW) / 2;
    s.goalY = H * 0.08;
    s.keeperY = s.goalY + s.goalH * 0.25;
    s.keeperW = W * 0.1; s.keeperH = H * 0.12;

    resetRound();
    setPhase('playing');
    stopMusicRef.current = startMusic('tense');

    const loop = () => {
      if (!s.running) return;
      ctx.save();
      applyShake(ctx, s.shake);
      // Football pitch — rich deep grass gradient
      const bg = ctx.createRadialGradient(W * 0.5, H * 0.4, 0, W * 0.5, H * 0.7, Math.max(W, H) * 0.9);
      bg.addColorStop(0,   '#0a2008');
      bg.addColorStop(0.5, '#061505');
      bg.addColorStop(1,   '#030a02');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Vignette
      const pkVig = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.2, W * 0.5, H * 0.5, H * 0.85);
      pkVig.addColorStop(0, 'rgba(0,0,0,0)');
      pkVig.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = pkVig;
      ctx.fillRect(0, 0, W, H);

      // Grass lines
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 5; i++) {
        ctx.beginPath(); ctx.moveTo(0, H*i/5); ctx.lineTo(W, H*i/5); ctx.stroke();
      }

      // Goal net (grid)
      const gx = s.goalX, gy = s.goalY, gw = s.goalW, gh = s.goalH;
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
      for (let xi = 0; xi <= 8; xi++) {
        const nx = gx + gw*xi/8;
        ctx.beginPath(); ctx.moveTo(nx, gy); ctx.lineTo(nx, gy+gh); ctx.stroke();
      }
      for (let yi = 0; yi <= 5; yi++) {
        const ny = gy + gh*yi/5;
        ctx.beginPath(); ctx.moveTo(gx, ny); ctx.lineTo(gx+gw, ny); ctx.stroke();
      }
      // Goal posts
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(gx, gy+gh); ctx.lineTo(gx, gy); ctx.lineTo(gx+gw, gy); ctx.lineTo(gx+gw, gy+gh);
      ctx.stroke();

      // Keeper
      const kx = s.keeperX, ky = s.keeperY;
      const kw = s.keeperW, kh = s.keeperH;
      if (s.keeperDiving) {
        ctx.save();
        ctx.translate(kx, ky);
        ctx.rotate(s.keeperDiveDir * 0.5);
        ctx.fillStyle = '#84cc16';
        ctx.fillRect(-kw*1.5, -kh/2, kw*3, kh/2);
        ctx.restore();
      } else {
        ctx.fillStyle = '#84cc16';
        ctx.beginPath();
        ctx.roundRect(kx - kw/2, ky - kh, kw, kh, 6);
        ctx.fill();
        // Head
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath(); ctx.arc(kx, ky - kh - 10, 12, 0, Math.PI*2); ctx.fill();
      }
      // Keeper move (before shot)
      if (s.phase === 'ready' && !s.keeperDiving) {
        s.keeperX += Math.sin(Date.now()/900) * 1.5;
        s.keeperX = Math.max(gx + kw/2, Math.min(gx + gw - kw/2, s.keeperX));
      }
      if (s.keeperDiving) {
        s.keeperX += s.keeperVX;
        s.keeperX = Math.max(gx, Math.min(gx + gw, s.keeperX));
      }

      // Ball flight
      if (s.phase === 'flying') {
        s.ballVX += (s.curveX * 0.15);
        s.ballX += s.ballVX;
        s.ballY += s.ballVY;
        const t = (s.ballY - (s.goalY + s.goalH)) / ((H*0.75) - (s.goalY + s.goalH));
        const scale = 0.3 + t * 0.7;
        const br = Math.max(4, s.ballRadius * scale);
        // Ball sprite
        ctx.save(); ctx.shadowBlur = 8; ctx.shadowColor = '#fff';
        const _ballImg = _loadSprite('/sprites/penalty-kick/ball.svg');
        if (_ballImg.complete && _ballImg.naturalWidth > 0) {
          ctx.drawImage(_ballImg, s.ballX - br, s.ballY - br, br * 2, br * 2);
        } else {
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.ballX, s.ballY, br, 0, Math.PI*2); ctx.fill();
        }
        ctx.restore();

        // Check goal (guard: only once per flight — phase check mirrors the miss path)
        if (s.phase === 'flying' && s.ballY < s.goalY + s.goalH && s.ballY > s.goalY &&
            s.ballX > gx && s.ballX < gx + gw) {
          // Check keeper save
          const keeperLeft = s.keeperX - s.keeperW * (s.keeperDiving ? 1.5 : 0.5);
          const keeperRight = s.keeperX + s.keeperW * (s.keeperDiving ? 1.5 : 0.5);
          const saved = s.ballX > keeperLeft && s.ballX < keeperRight;
          s.phase = 'result';
          s.sig.shots++;
          setShotsState(s.sig.shots);
          s.sig.powerSum += s.power;
          if (Math.abs(s.curveX) > 3) s.sig.curveShots++;

          // Corner check — use actual ball X (accounts for curve), not aim position
          const leftThird = gx + gw * 0.25;
          const rightThird = gx + gw * 0.75;
          if (s.ballX < leftThird || s.ballX > rightThird) s.sig.cornerShots++;

          if (saved) {
            s.sig.lastSavedResult = true;
            sfx.collision(); hapticFail();
            triggerShake(s.shake, 6, 10);
            spawnBurst(s.particles, s.ballX, s.ballY, '#ef4444', 14, 5);
            s.resultText = 'SAVED!'; s.resultColor = '#ef4444';
            s.floats.push({ x: W/2, y: H/2, text:'SAVED!', color:'#ef4444', alpha:1, vy:-1.5 });
            // sfx.boom() already fired at kick time (handleTouchEnd) for powerful shots — no double-boom here
          } else {
            s.goals++;
            s.sig.goals = s.goals; // keep goal count in sync
            setGoalsDisplay(s.goals);
            if (s.sig.lastSavedResult) { s.sig.postSaveGoals++; s.sig.adaptCount++; }
            s.sig.lastSavedResult = false;
            // Delay success so it follows collect, not stacks with it
            sfx.collect(); setTimeout(() => sfx.success(), 100); haptic([60, 30, 60]);
            spawnBurst(s.particles, s.ballX, s.goalY + s.goalH / 2, '#4ade80', 24, 8);
            s.resultText = 'GOAL!'; s.resultColor = '#4ade80';
            s.floats.push({ x: W/2, y: H/2, text:'GOAL!', color:'#4ade80', alpha:1, vy:-1.5 });
            // sfx.boom() already fired at kick time (handleTouchEnd) for powerful shots — no double-boom here
          }
          s.resultTimer = 90;
          if (s.sig.shots >= MAX_SHOTS) {
            setTimeout(() => endGame(), 1500);
          } else {
            setTimeout(() => resetRound(), 1500);
          }
        }
        // Wide/over
        if (s.ballY < s.goalY - 40 || s.ballX < gx - 40 || s.ballX > gx + gw + 40) {
          if (s.phase === 'flying') {
            s.phase = 'result';
            s.sig.shots++;
            setShotsState(s.sig.shots);
            s.sig.powerSum += s.power;
            sfx.fail(); haptic([150]);
            triggerShake(s.shake, 4, 6);
            spawnBurst(s.particles, Math.max(20, Math.min(W-20, s.ballX)), Math.max(20, Math.min(H-20, s.ballY)), '#f97316', 10, 4);
            s.floats.push({ x: W/2, y: H/2, text:'MISS!', color:'#f97316', alpha:1, vy:-1.5 });
            s.resultTimer = 60;
            if (s.sig.shots >= MAX_SHOTS) setTimeout(() => endGame(), 1500);
            else setTimeout(() => resetRound(), 1500);
          }
        }
      }

      // Draw ball (when not flying)
      if (s.phase !== 'flying') {
        const br = s.ballRadius;
        ctx.save(); ctx.shadowBlur = 8; ctx.shadowColor = '#fff';
        const _ballImg2 = _loadSprite('/sprites/penalty-kick/ball.svg');
        if (_ballImg2.complete && _ballImg2.naturalWidth > 0) {
          ctx.drawImage(_ballImg2, s.ballX - br, s.ballY - br, br * 2, br * 2);
        } else {
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.ballX, s.ballY, br, 0, Math.PI*2); ctx.fill();
        }
        ctx.restore();
      }

      // Aim reticle + curve arc
      if (s.phase === 'ready') {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2;
        // Straight line
        ctx.setLineDash([6,4]);
        ctx.beginPath(); ctx.moveTo(s.ballX, s.ballY); ctx.lineTo(s.aimX, s.aimY); ctx.stroke();
        ctx.setLineDash([]);
        // Reticle
        ctx.strokeStyle = ACCENT; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.aimX, s.aimY, 18, 0, Math.PI*2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s.aimX-22, s.aimY); ctx.lineTo(s.aimX+22, s.aimY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s.aimX, s.aimY-22); ctx.lineTo(s.aimX, s.aimY+22); ctx.stroke();
        ctx.restore();

        // Power bar (right side)
        if (s.charging) {
          const barH = 150;
          const barY = H/2 - barH/2;
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(W - 36, barY, 20, barH);
          const fillH = barH * (s.power / 100);
          const pct = s.power / 100;
          const barColor = pct < 0.5 ? '#4ade80' : pct < 0.8 ? '#fbbf24' : '#ef4444';
          ctx.fillStyle = barColor;
          ctx.fillRect(W - 36, barY + barH - fillH, 20, fillH);
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
          ctx.strokeRect(W - 36, barY, 20, barH);
        }
      }

      // Float texts
      s.floats = s.floats.filter(f => f.alpha > 0.02);
      s.floats.forEach(f => {
        ctx.save(); ctx.globalAlpha = f.alpha;
        ctx.fillStyle = f.color; ctx.font = 'bold 42px sans-serif';
        ctx.textAlign = 'center'; ctx.fillText(f.text, f.x, f.y); ctx.restore();
        f.y += f.vy; f.alpha *= 0.97;
      });

      // Particles layer (outside shake transform)
      ctx.restore();
      updateAndDrawParticles(ctx, s.particles);
      // HUD drawn by DOM overlay GameHUD component

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
  }, [endGame, resetRound]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const s = stateRef.current;
    if (!s.running || s.phase !== 'ready') return;
    e.preventDefault();
    const t = e.touches[0];
    s.dragStartX = t.clientX; s.dragStartY = t.clientY; s.dragStartTime = Date.now();
    s.dragging = true; s.charging = true; s.power = 0;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const s = stateRef.current;
    if (!s.dragging) return;
    e.preventDefault();
    const t = e.touches[0];
    s.aimX = t.clientX; s.aimY = t.clientY;
    const dt = Date.now() - s.dragStartTime;
    s.power = Math.min(100, dt / 10);
    s.curveX = tiltRef.current?.getValues().x ?? 0;
    s.curveX *= 8;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const s = stateRef.current;
    if (!s.dragging || s.phase !== 'ready') return;
    s.dragging = false; s.charging = false;
    s.phase = 'flying';
    const dx = s.aimX - s.ballX;
    const dy = s.aimY - s.ballY;
    const dist = Math.sqrt(dx*dx+dy*dy);
    const spd = 4 + s.power * 0.12;
    s.ballVX = (dx / dist) * spd;
    s.ballVY = (dy / dist) * spd;
    // Keeper reaction — adapts each shot (uses sig.shots which is updated correctly)
    const keeperSaveRate = 0.5 + (s.sig.shots * 0.025);
    const reacts = Math.random() < keeperSaveRate;
    if (reacts) {
      const shotDir = dx > 0 ? 1 : -1;
      s.keeperDiving = true;
      s.keeperDiveDir = shotDir;
      s.keeperVX = shotDir * 6;
    }
    sfx.click();
    if (s.power > 85) { sfx.boom(); haptic([200]); }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = window.innerWidth  * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width  = window.innerWidth  + 'px';
    canvas.style.height = window.innerHeight + 'px';
    const ctx2 = canvas.getContext('2d');
    if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    const onResize = () => {
      const d = window.devicePixelRatio || 1;
      canvas.width  = window.innerWidth  * d;
      canvas.height = window.innerHeight * d;
      canvas.style.width  = window.innerWidth  + 'px';
      canvas.style.height = window.innerHeight + 'px';
      const c2 = canvas.getContext('2d');
      if (c2) c2.setTransform(d, 0, 0, d, 0, 0);
    };
    const onForceEnd = () => { if (stateRef.current.running) endGame(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('game:force-end', onForceEnd);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('game:force-end', onForceEnd);
      cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearTimeout(timerRef.current);
      tiltRef.current?.stop();
      if (stopMusicRef.current) stopMusicRef.current();
    };
  }, [endGame]);

  const handleStart = useCallback(async (name: string, avatar: string) => {
    setPlayerName(name);
    setPlayerAvatar(avatar);
    playerSessionRef.current = savePlayerSession(GAME_ID, name, avatar);
    await initAudio(); sfx.click();
    const ctrl = createTiltController(() => {}, { sensitivity: 1.0, smoothing: 0.3, deadzone: 3 });
    tiltRef.current = ctrl;
    await ctrl.start();
    setPhase('countdown');
  }, []);

  const handlePlayAgain = useCallback(() => {
    if (stopMusicRef.current) { stopMusicRef.current(); stopMusicRef.current = null; }
    stateRef.current.running = false;
    cancelAnimationFrame(animRef.current);
    tiltRef.current?.stop();
    setPhase('start');
  
    setIsNewBest(false);
    setStreak(0);
    prevScoreRef.current = 0;
  }, []);

  const sig = finalSig;
  const goals = sig?.goals ?? 0;

  return (
    <>
      {phase === 'start' && showInstructions && (
        <SwipeInstructions
          gameId="penalty-kick"
          steps={[{ icon: "👆", title: "Swipe to kick", body: "Swipe in the direction you want to shoot." }, { icon: "⚽", title: "Aim for gaps", body: "The goalkeeper moves — find the open corner." }, { icon: "🥅", title: "Score goals", body: "You have 5 shots. Score as many as possible." }]}
          onDone={() => setShowInstructions(false)}
        />
      )}
    <GameShell title="Penalty Kick" emoji="⚽" accentColor={ACCENT} theme={theme}
      background="radial-gradient(ellipse at 20% 0%, rgba(255,255,220,0.08) 0%, transparent 50%), radial-gradient(ellipse at 80% 0%, rgba(255,255,220,0.08) 0%, transparent 50%), radial-gradient(ellipse at 50% 110%, #1a5c2a 0%, #0d2e14 40%, #051209 70%, #020808 100%)">
      <canvas
        ref={canvasRef}
        style={{ display: phase === 'playing' ? 'block' : 'none', position: 'absolute', top: 0, left: 0 }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
      {phase === 'playing' && (
        <GameHUD
          items={[
            { label: 'GOALS', value: goalsDisplay,              testId: 'score' },
            { label: 'SHOTS', value: `${shotsState}/${MAX_SHOTS}`, testId: 'timer' },
          ]}
          accentColor={ACCENT}
        />
      )}
      {phase === 'countdown' && <Countdown onComplete={startLoop} accentColor={ACCENT} />}
      {phase === 'start' && (
        <GameStartScreen
          emoji="⚽"
          title="Penalty Kick"
          description="Drag to aim, hold to charge power. Tilt for curve. Beat the keeper."
          sensorNote="Uses motion sensors"
          ctaLabel="Start Kicking →"
          accentColor={ACCENT}
          onStart={handleStart}
          gradient="radial-gradient(ellipse 80% 70% at 50% 30%, #001a08 0%, #000e04 55%, #000602 100%)"
        />
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

      {phase === 'done' && sig && (
        <EndScreen
          gameId={GAME_ID}
          title={getPersonality(sig)}
          emoji="⚽"
          score={`${goals}/${MAX_SHOTS}`}
          personality={getPersonality(sig)}
          insights={[
            { label: 'Goals Scored', value: `${goals}`, color: ACCENT },
            { label: 'Avg Power', value: `${sig.shots > 0 ? Math.round(sig.powerSum/sig.shots) : 0}%`, color: '#fbbf24' },
            { label: 'Corner Rate', value: `${sig.shots > 0 ? Math.round(sig.cornerShots/sig.shots*100) : 0}%`, color: '#c084fc' },
            { label: 'Curve Shots', value: `${sig.curveShots}`, color: '#60a5fa' },
          ]}
          accentColor={ACCENT}
          onPlayAgain={handlePlayAgain}
          didWin={goals >= 5}
          finalScore={goals}
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
